import { transaction } from '../db/index.js'
import type { OfficeStore } from './store.js'

export function scheduleInput(value:unknown,now=Date.now()) {
 const input=value as {platform?:unknown;scheduledAt?:unknown}|null
 if(!input || !['instagram','facebook'].includes(String(input.platform)))throw new Error('Pilih platform instagram atau facebook.')
 if(typeof input.scheduledAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(input.scheduledAt))throw new Error('Jadwal harus ISO8601 dengan zona waktu.')
 const time=Date.parse(input.scheduledAt)
 const calendarDay=new Date(input.scheduledAt.slice(0,10)+'T00:00:00Z')
 if(!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0,10)!==input.scheduledAt.slice(0,10))throw new Error('Tanggal kalender tidak valid.')
 if(!Number.isFinite(time)||time<=now)throw new Error('Jadwal harus di masa depan.')
 return {platform:String(input.platform),scheduledAt:new Date(time).toISOString()}
}

export function publicationInput(value:unknown,platform:string,now=Date.now()) {
 const input=value as {postUrl?:unknown;publishedAt?:unknown}|null
 if(typeof input?.postUrl!=='string'||typeof input.publishedAt!=='string')throw new Error('Isi tautan posting dan waktu publikasi.')
 let url:URL
 try{url=new URL(input.postUrl)}catch{throw new Error('Tautan posting tidak valid.')}
 const host=url.hostname.replace(/^www\./,'')
 const valid=platform==='instagram'?host==='instagram.com'&&/^\/(p|reel)\/[^/]+\/?$/.test(url.pathname):platform==='facebook'&&['facebook.com','m.facebook.com','fb.watch'].includes(host)&&url.pathname!=='/'
 if(url.protocol!=='https:'||url.username||url.password||!valid)throw new Error('Gunakan tautan posting HTTPS dari platform yang dipilih.')
 if(!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(input.publishedAt)||!Number.isFinite(Date.parse(input.publishedAt))||Date.parse(input.publishedAt)>now)throw new Error('Waktu publikasi harus valid dan sudah terjadi.')
 return {postUrl:url.toString(),publishedAt:new Date(input.publishedAt).toISOString()}
}

export async function recordSocialPublication(store:OfficeStore,brand:string,scheduleId:string,input:unknown,actor:string) {
 return transaction(store.db,async tx=>{
  if(actor!=='worker:meta'){
   const lease=(await tx.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[`publish:${brand}:${scheduleId}`])).rows[0]
   if(!lease.locked)throw new Error('Pengiriman Meta sedang diproses. Tunggu konfirmasi sebelum mencatat publikasi.')
  }
  const schedule=(await tx.query('SELECT * FROM social_schedule WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brand,scheduleId])).rows[0]
  if(!schedule||!['planned','published'].includes(schedule.status))throw new Error('Jadwal aktif tidak ditemukan di brand ini.')
  const delivery=(await tx.query('SELECT state,provider_id FROM social_deliveries WHERE brand_id=$1 AND schedule_id=$2',[brand,scheduleId])).rows[0]
  if(actor!=='worker:meta'&&delivery&&(delivery.state==='preparing'||(delivery.state==='publishing'&&!delivery.provider_id)))throw new Error('Pengiriman Meta sedang berlangsung. Tunggu hasil sebelum mencatat publikasi.')
  const receipt=publicationInput(input,schedule.platform)
  const approval=(await tx.query("SELECT id FROM approvals WHERE brand_id=$1 AND id=$2 AND task_id=$3 AND approval_type='publikasi' AND decision='approved'",[brand,schedule.approval_id,schedule.task_id])).rows[0]
  if(!approval)throw new Error('Persetujuan publikasi tidak ditemukan.')
  const pack=(await tx.query('SELECT * FROM approved_packages WHERE brand_id=$1 AND smm_task_id=$2',[brand,schedule.task_id])).rows[0]
  if(!pack)throw new Error('Jadwal belum terhubung dengan paket Approved.')
  const existing=(await tx.query('SELECT * FROM social_publications WHERE brand_id=$1 AND schedule_id=$2',[brand,scheduleId])).rows[0]
  if(existing){
   if(existing.post_url!==receipt.postUrl||new Date(existing.published_at).toISOString()!==receipt.publishedAt)throw new Error('Publikasi ini sudah dicatat dengan data berbeda.')
   return {sourceTaskId:pack.source_task_id,publication:existing}
  }
  const publication=(await tx.query('INSERT INTO social_publications(brand_id,schedule_id,package_id,post_url,published_at,recorded_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[brand,scheduleId,pack.id,receipt.postUrl,receipt.publishedAt,actor])).rows[0]
  await tx.query("UPDATE social_schedule SET status='published' WHERE brand_id=$1 AND id=$2",[brand,scheduleId])
  await tx.query("UPDATE social_deliveries SET state='published',error=NULL,updated_at=now() WHERE brand_id=$1 AND schedule_id=$2",[brand,scheduleId])
  await tx.query("UPDATE approved_packages SET drive_status='pending' WHERE brand_id=$1 AND id=$2",[brand,pack.id])
  await store.logEvent(tx,{brandId:brand,id:schedule.task_id},'publication_recorded',{scheduleId,...receipt,actor,delivery:actor==='worker:meta'?'meta-api':'manual-confirmation'})
  return {sourceTaskId:pack.source_task_id,publication}
 })
}

export async function planSocialPost(store:OfficeStore,brand:string,taskId:string,input:unknown,actor:string) {
 const plan=scheduleInput(input)
 return transaction(store.db,async tx=>{
  const row=(await tx.query('SELECT * FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brand,taskId])).rows[0]
  if(!row || row.agent_type!=='social-media-manager' || row.kind!=='publikasi.caption' || row.status!=='approved')throw new Error('Jadwal hanya untuk caption SMM brand ini yang sudah disetujui untuk publikasi.')
  const approval=(await tx.query('SELECT * FROM approvals WHERE brand_id=$1 AND task_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[brand,taskId])).rows[0]
  if(approval?.decision!=='approved'||approval.approval_type!=='publikasi')throw new Error('Approval publikasi yang sah diperlukan.')
  const asset=(await tx.query('SELECT * FROM assets WHERE brand_id=$1 AND task_id=$2 AND kind=$3 ORDER BY version DESC LIMIT 1',[brand,taskId,row.kind])).rows[0]
  if(!asset || asset.content!==row.result)throw new Error('Versi hasil yang disetujui tidak cocok.')
  const existing=(await tx.query('SELECT * FROM social_schedule WHERE brand_id=$1 AND task_id=$2 AND platform=$3',[brand,taskId,plan.platform])).rows[0]
  if(existing){
   if(existing.asset_id!==asset.id || existing.scheduled_at.toISOString()!==plan.scheduledAt || existing.status!=='planned')throw new Error('Jadwal berbeda sudah tersedia; jangan menimpa tanpa review baru.')
   return {...existing,delivery:'local-plan-only'}
  }
  const result=(await tx.query('INSERT INTO social_schedule(brand_id,task_id,asset_id,asset_version,approval_id,platform,scheduled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[brand,taskId,asset.id,asset.version,approval.id,plan.platform,plan.scheduledAt,actor])).rows[0]
  await store.logEvent(tx,{id:taskId,brandId:brand},'social_schedule',{id:result.id,assetId:asset.id,version:asset.version,approvalId:approval.id,...plan,delivery:'local-plan-only',actor})
  return {...result,delivery:'local-plan-only'}
 })
}
