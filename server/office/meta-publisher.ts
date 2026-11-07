import { createHmac, timingSafeEqual } from 'node:crypto'
import sharp from 'sharp'
import { transaction, type Queryable } from '../db/index.js'
import { encryptionKey } from '../integrations/crypto.js'
import { MetaGraph, metaConfiguration, type MetaAccount, type MetaCheckpoint } from '../integrations/meta-publishing.js'
import type { OfficeStore } from './store.js'
import { recordSocialPublication } from './social-schedule.js'

interface ImageAsset {id:string;name:string;mime:string}
interface ApprovedSchedule {
  id:string;brand_id:string;platform:string;scheduled_at:Date;status:string;asset_id:string;asset_version:number;
  task_id:string;approval_id:string;caption:string;source_task_id:string;assets:ImageAsset[];publication_asset_id:string|null
}

async function approvedSchedule(db:Queryable,brand:string,id:string):Promise<ApprovedSchedule> {
  const row=(await db.query(`SELECT s.*,a.content AS caption,p.source_task_id,p.assets,p.publication_asset_id
    FROM social_schedule s
    JOIN tasks t ON t.id=s.task_id AND t.brand_id=s.brand_id AND t.status='approved'
    JOIN approvals r ON r.id=s.approval_id AND r.brand_id=s.brand_id AND r.task_id=t.id AND r.decision='approved' AND r.approval_type='publikasi'
    JOIN assets a ON a.id=s.asset_id AND a.brand_id=s.brand_id AND a.task_id=t.id AND a.version=s.asset_version AND a.content=t.result
    JOIN approved_packages p ON p.smm_task_id=t.id AND p.brand_id=s.brand_id
    WHERE s.brand_id=$1 AND s.id=$2`,[brand,id])).rows[0] as ApprovedSchedule|undefined
  if(!row||row.publication_asset_id!==row.asset_id)throw new Error('Versi caption atau paket Approved belum cocok dengan persetujuan publikasi.')
  return row
}

function slideAssets(assets:ImageAsset[]) {
  const slides=assets.filter(asset=>/^slide-\d+\.(png|jpe?g)$/i.test(asset.name))
    .sort((a,b)=>Number(a.name.match(/\d+/)![0])-Number(b.name.match(/\d+/)![0]))
  if(slides.length<1||slides.length>10)throw new Error('Paket publikasi memerlukan 1–10 slide gambar.')
  return slides
}

function mediaSignature(key:string,brand:string,schedule:string,asset:string,expires:string) {
  return createHmac('sha256',encryptionKey(key)).update(JSON.stringify([brand,schedule,asset,expires])).digest('hex')
}

export class MetaPublisher {
  constructor(private readonly store:OfficeStore,private readonly envDir?:string,private readonly fetcher:typeof fetch=fetch,private readonly env:NodeJS.ProcessEnv=process.env) {}

  async readiness(brand:string,platform:string) {
    if(!['instagram','facebook'].includes(platform))throw new Error('Platform tidak didukung.')
    const configured=metaConfiguration(brand,platform,this.envDir,this.env)
    const mode=(await this.store.integrationModes()).get(brand)?.get('meta-graph')??'mock'
    return {ready:configured.ready&&mode==='live',configured:configured.ready,mode,missing:configured.missing,problems:configured.problems,pageId:configured.config.pageId,instagramId:configured.config.instagramId}
  }

  async check(brand:string,platform:string) {
    const ready=await this.readiness(brand,platform)
    if(!ready.configured)throw new Error(`Konfigurasi Meta belum lengkap: ${[...ready.missing,...ready.problems].join(', ')}`)
    return new MetaGraph(metaConfiguration(brand,platform,this.envDir,this.env).config,this.fetcher).check(platform)
  }

  async arm(brand:string,id:string,caption:unknown,actor:string) {
    const preview=(await this.store.db.query('SELECT platform FROM social_schedule WHERE brand_id=$1 AND id=$2',[brand,id])).rows[0]
    if(!preview)throw new Error('Jadwal tidak ditemukan di brand ini.')
    const ready=await this.readiness(brand,preview.platform)
    if(!ready.ready)throw new Error('Lengkapi koneksi Meta dan aktifkan mode Live untuk brand ini.')
    await this.check(brand,preview.platform)
    const config=metaConfiguration(brand,preview.platform,this.envDir,this.env).config
    const account:MetaAccount={pageId:config.pageId,instagramId:config.instagramId,version:config.version}
    return transaction(this.store.db,async tx=>{
      const lease=(await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[`publish:${brand}:${id}`])).rows[0]
      if(!lease.locked)throw new Error('Pengiriman sedang diproses. Tunggu hasilnya sebelum mencoba lagi.')
      await tx.query('SELECT id FROM social_schedule WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brand,id])
      const schedule=await approvedSchedule(tx,brand,id)
      if(schedule.status!=='planned')throw new Error('Hanya jadwal yang belum terbit yang dapat diaktifkan.')
      const text=typeof caption==='string'?caption.trim():''
      if(!text||text.length>2200||!schedule.caption.replace(/\r\n/g,'\n').includes(text.replace(/\r\n/g,'\n')))throw new Error('Pilih caption maksimal 2.200 karakter dari hasil yang sudah disetujui. Perubahan isi memerlukan review baru.')
      slideAssets(schedule.assets)
      const existing=(await tx.query('SELECT * FROM social_deliveries WHERE brand_id=$1 AND schedule_id=$2',[brand,id])).rows[0]
      if(existing&&(existing.account.pageId!==account.pageId||(schedule.platform==='instagram'&&existing.account.instagramId!==account.instagramId)||existing.account.version!==account.version))throw new Error('Akun tujuan berubah. Buat persetujuan publikasi dan jadwal baru untuk akun tujuan yang baru.')
      if(existing&&existing.caption!==text)throw new Error('Caption pengiriman sudah dikunci. Gunakan caption yang sama untuk mencoba ulang.')
      if(existing&&['publishing','uncertain','published','preparing'].includes(existing.state))throw new Error('Pengiriman sedang berjalan atau membutuhkan pemeriksaan hasil. Periksa akun platform sebelum mencoba lagi.')
      await tx.query(`INSERT INTO social_deliveries(schedule_id,brand_id,account,caption,armed_by) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(schedule_id) DO UPDATE SET state='queued',error=NULL,updated_at=now()`,[id,brand,JSON.stringify(account),text,actor])
      await this.store.logEvent(tx,{brandId:brand,id:schedule.task_id},'publication_api_armed',{scheduleId:id,account,assetId:schedule.asset_id,actor})
      return {scheduleId:id,scheduledAt:schedule.scheduled_at}
    })
  }

  async cancel(brand:string,id:string,actor:string) {
    return transaction(this.store.db,async tx=>{
      const lease=(await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[`publish:${brand}:${id}`])).rows[0]
      if(!lease.locked)throw new Error('Pengiriman sedang diproses. Tunggu konfirmasi Meta.')
      const result=await tx.query("UPDATE social_deliveries SET state='cancelled',updated_at=now() WHERE brand_id=$1 AND schedule_id=$2 AND state IN ('queued','failed','cancelled') RETURNING schedule_id",[brand,id])
      if(!result.rows[0])throw new Error('Pengiriman ini sudah berjalan atau perlu diperiksa di akun platform.')
      const schedule=(await tx.query('SELECT task_id FROM social_schedule WHERE brand_id=$1 AND id=$2',[brand,id])).rows[0]
      await this.store.logEvent(tx,{brandId:brand,id:schedule.task_id},'publication_api_cancelled',{scheduleId:id,actor})
      return {cancelled:true}
    })
  }

  async run(brand:string,id:string) {
    const client=await this.store.db.connect()
    let locked=false
    try{
      locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[`publish:${brand}:${id}`])).rows[0].locked
      if(!locked)return
      const delivery=(await client.query('SELECT * FROM social_deliveries WHERE brand_id=$1 AND schedule_id=$2',[brand,id])).rows[0]
      if(!delivery||['published','cancelled','uncertain'].includes(delivery.state))return
      if(delivery.state==='publishing'&&!delivery.provider_id){
        await client.query("UPDATE social_deliveries SET state='uncertain',error=$3,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,id,'Konfirmasi pengiriman terputus. Periksa akun platform dan catat tautan jika sudah terbit.'])
        return
      }
      const schedule=await approvedSchedule(client,brand,id)
      if(schedule.status!=='planned')return
      if(new Date(schedule.scheduled_at).getTime()>Date.now())throw new Error('Waktu tayang belum tiba.')
      if(await this.store.isPaused(brand,'social-media-manager'))throw new Error('Agent atau brand sedang dijeda.')
      const ready=await this.readiness(brand,schedule.platform)
      if(!ready.ready)throw new Error('Koneksi Meta belum siap atau mode Live dinonaktifkan.')
      const config=metaConfiguration(brand,schedule.platform,this.envDir,this.env).config
      const account=delivery.account as MetaAccount
      if(account.pageId!==config.pageId||(schedule.platform==='instagram'&&account.instagramId!==config.instagramId)||account.version!==config.version)throw new Error('Akun Meta tujuan berubah sejak jadwal diaktifkan.')
      const graph=new MetaGraph(config,this.fetcher)
      let providerId=delivery.provider_id as string|null
      if(!providerId){
        await graph.check(schedule.platform)
        await client.query("UPDATE social_deliveries SET state='preparing',error=NULL,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,id])
        const expires=String(Math.floor(Date.now()/1000)+3600)
        const images:string[]=[]
        for(const slide of slideAssets(schedule.assets)){
          await this.image(brand,slide.id)
          const signature=mediaSignature(config.mediaKey,brand,id,slide.id,expires)
          images.push(`${config.publicUrl}/publication-media/${brand}/${id}/${slide.id}.jpg?expires=${expires}&signature=${signature}`)
        }
        let checkpoint=delivery.checkpoint as MetaCheckpoint
        await graph.prepare(schedule.platform,images,delivery.caption,checkpoint,async value=>{
          checkpoint=value
          await client.query('UPDATE social_deliveries SET checkpoint=$3,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2',[brand,id,JSON.stringify(value)])
        })
        if(await this.store.isPaused(brand,'social-media-manager')||!(await this.readiness(brand,schedule.platform)).ready)throw new Error('Pengiriman dihentikan karena agent dijeda atau koneksi Live dinonaktifkan.')
        // Persist intent before the external publication. An unknown outcome requires reconciliation.
        await client.query("UPDATE social_deliveries SET state='publishing',updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,id])
        try{providerId=await graph.publish(schedule.platform,delivery.caption,checkpoint)}catch(error){
          await client.query("UPDATE social_deliveries SET state='uncertain',error=$3,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,id,error instanceof Error?error.message:'Konfirmasi Meta terputus.'])
          return
        }
        await client.query('UPDATE social_deliveries SET provider_id=$3,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2',[brand,id,providerId])
      }
      const url=await graph.permalink(providerId,schedule.platform)
      const receipt=await recordSocialPublication(this.store,brand,id,{postUrl:url,publishedAt:new Date().toISOString()},'worker:meta')
      await client.query("UPDATE social_deliveries SET state='published',error=NULL,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,id])
      return receipt.sourceTaskId
    }catch(error){
      if(locked)await client.query(`UPDATE social_deliveries SET state=CASE WHEN provider_id IS NOT NULL THEN 'publishing' WHEN state='publishing' THEN 'uncertain' ELSE 'failed' END,error=$3,updated_at=now()
        WHERE brand_id=$1 AND schedule_id=$2 AND state NOT IN ('published','uncertain','cancelled')`,[brand,id,error instanceof Error?error.message:'Pengiriman gagal.'])
      throw error
    }finally{
      if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[`publish:${brand}:${id}`]).catch(()=>undefined)
      client.release()
    }
  }

  private async image(brand:string,asset:string) {
    const file=await this.store.assetFile(brand,asset)
    if(!file||!['image/png','image/jpeg'].includes(file.mime))throw new Error('Gambar Approved tidak tersedia.')
    const image=sharp(file.data),metadata=await image.metadata()
    const ratio=(metadata.width??0)/(metadata.height??1)
    if(!metadata.width||metadata.width<320||ratio<0.8||ratio>1.91)throw new Error('Ukuran atau rasio slide belum sesuai publikasi feed. Gunakan lebar minimal 320 px dan rasio 4:5 hingga 1,91:1.')
    return image.resize({width:1440,withoutEnlargement:true}).jpeg({quality:92}).toBuffer()
  }

  async media(brand:string,id:string,asset:string,expires:string,signature:string) {
    if(!/^\d{10}$/.test(expires)||Number(expires)<Date.now()/1000||Number(expires)>Date.now()/1000+3600||!/^[a-f0-9]{64}$/.test(signature))throw new Error('Tautan gambar tidak valid atau kedaluwarsa.')
    const schedule=await approvedSchedule(this.store.db,brand,id)
    const config=metaConfiguration(brand,schedule.platform,this.envDir,this.env).config
    const expected=mediaSignature(config.mediaKey,brand,id,asset,expires)
    if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw new Error('Tautan gambar tidak valid.')
    const delivery=(await this.store.db.query('SELECT state FROM social_deliveries WHERE brand_id=$1 AND schedule_id=$2',[brand,id])).rows[0]
    if(schedule.status!=='planned'||!delivery||!['preparing','publishing'].includes(delivery.state)||!slideAssets(schedule.assets).some(slide=>slide.id===asset))throw new Error('Gambar belum tersedia untuk pengiriman ini.')
    return this.image(brand,asset)
  }
}
