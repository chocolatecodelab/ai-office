import { createHash,randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir,rm } from 'node:fs/promises'
import { resolve,sep,join } from 'node:path'
import { Transform,type Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { transaction } from '../db/index.js'
import { audit,type OfficeStore } from './store.js'
import { runProductionProcess } from './production-process.js'
import { chatLimits } from './chat-limits.js'
import { ChatWorkspace } from './chat-workspace.js'
export interface VideoSource {id:string;name:string;path:string;sha256:string}

export function videoUploadLimit(env:NodeJS.ProcessEnv=process.env) {
  const megabytes=Number(env.OFFICE_VIDEO_UPLOAD_MAX_MB??512)
  if(!Number.isSafeInteger(megabytes)||megabytes<1||megabytes>1024)throw new Error('OFFICE_VIDEO_UPLOAD_MAX_MB harus 1–1024.')
  return megabytes*1024*1024
}

export class VideoAttachments {
  constructor(private readonly store:OfficeStore,private readonly root:string){}
  private path(key:string) {
    const path=resolve(this.root,key)
    if(!path.startsWith(resolve(this.root)+sep))throw new Error('Lokasi video tidak valid.')
    return path
  }

  async upload(brand:string,agent:string,name:string,input:Readable,length?:number) {
    if(!['manager','video-editor'].includes(agent))throw new Error('Unggah footage melalui Manager atau Video Editor.')
    if(!/^[a-z0-9-]+$/.test(brand))throw new Error('Brand tidak valid.')
    const extension=name.split('.').at(-1)?.toLowerCase()
    if(!extension||!['mp4','mov','webm'].includes(extension))throw new Error('Pilih video MP4, MOV, atau WebM.')
    if(name.length>200||/[\\/]/.test(name)||Array.from(name).some(character=>character.charCodeAt(0)<32))throw new Error('Nama video tidak valid.')
    const maximum=videoUploadLimit()
    if(length!==undefined&&(!Number.isSafeInteger(length)||length<1||length>maximum))throw new Error(`Video maksimal ${maximum/1024/1024} MB.`)
    const key=`${brand}/${randomUUID()}.${extension}`,path=this.path(key)
    await mkdir(join(this.root,brand),{recursive:true})
    let bytes=0,saved=false
    const hash=createHash('sha256')
    try{
      await pipeline(input,new Transform({transform(chunk:Buffer,_encoding,callback){
        bytes+=chunk.length
        if(bytes>maximum){callback(new Error('Video melebihi batas unggahan server.'));return}
        hash.update(chunk);callback(null,chunk)
      }}),createWriteStream(path,{flags:'wx'}))
      const probe=JSON.parse(await runProductionProcess('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,mp4,m4a,3gp,3g2,mj2,matroska,webm','-show_entries','format=duration:stream=codec_type,width,height','-of','json',path],this.root,{timeoutMs:30000})) as {format?:{duration?:string};streams?:Array<{codec_type:string;width?:number;height?:number}>}
      const video=probe.streams?.find(stream=>stream.codec_type==='video'),duration=Number(probe.format?.duration)
      if(!video?.width||!video.height||!Number.isFinite(duration)||duration<=0)throw new Error('Berkas belum dapat dibaca sebagai footage video.')
      const metadata={duration,width:video.width,height:video.height,audio:!!probe.streams?.some(stream=>stream.codec_type==='audio')}
      const extracted=`Footage pengguna: ${name}. Durasi ${duration.toFixed(2)} detik, ${video.width}×${video.height}, audio ${metadata.audio?'tersedia':'tidak tersedia'}. Isi ucapan belum ditranskrip. Metadata ini belum merupakan analisis isi atau gerak video.`
      const result=await transaction(this.store.db,async tx=>{
        await tx.query('SELECT agent_type FROM agents WHERE brand_id=$1 AND agent_type=$2 FOR UPDATE',[brand,agent])
        const count=(await tx.query('SELECT count(*)::int AS n FROM chat_attachments WHERE brand_id=$1 AND agent_type=$2 AND NOT removed',[brand,agent])).rows[0].n
        if(count>=chatLimits().libraryFiles)throw new Error('Pustaka lampiran penuh.')
        const used=Number((await tx.query("SELECT coalesce(sum(size),0) AS bytes FROM chat_attachments WHERE brand_id=$1 AND agent_type=$2 AND mime LIKE 'video/%' AND NOT removed",[brand,agent])).rows[0].bytes)
        const quota=Number(process.env.OFFICE_VIDEO_LIBRARY_MAX_MB??4096)*1024*1024
        if(!Number.isSafeInteger(quota)||quota<=0||used+bytes>quota)throw new Error('Kapasitas pustaka footage telah tercapai. Atur OFFICE_VIDEO_LIBRARY_MAX_MB atau hapus footage yang tidak dipakai.')
        const mime=extension==='mov'?'video/quicktime':extension==='webm'?'video/webm':'video/mp4'
        const attachment=(await tx.query(`INSERT INTO chat_attachments(brand_id,agent_type,name,mime,size,extracted,warning,source) VALUES($1,$2,$3,$4,$5,$6,$7,'Unggahan footage') RETURNING id,name,mime,size,warning,source,created_at AS "createdAt"`,[brand,agent,name,mime,bytes,extracted,'Metadata video tersedia. Transkripsi dan storyboard visual belum dibuat.'])).rows[0]
        await tx.query('INSERT INTO chat_video_files(attachment_id,brand_id,storage_key,sha256,metadata) VALUES($1,$2,$3,$4,$5)',[attachment.id,brand,key,hash.digest('hex'),JSON.stringify(metadata)])
        await audit(tx,{actor:'pengguna-lokal',action:'chat.video.upload',objectType:'chat-attachment',objectId:attachment.id,brandId:brand,after:{name,size:bytes,...metadata}})
        return attachment
      })
      saved=true
      return result
    }finally{if(!saved)await rm(path,{force:true}).catch(()=>undefined)}
  }

  async file(brand:string,agent:string,id:string) {
    const row=(await this.store.db.query('SELECT a.name,a.mime,v.storage_key FROM chat_video_files v JOIN chat_attachments a ON a.id=v.attachment_id AND a.brand_id=v.brand_id WHERE a.brand_id=$1 AND a.agent_type=$2 AND a.id::text=$3 AND NOT a.removed',[brand,agent,id])).rows[0]
    return row?{path:this.path(row.storage_key),name:row.name,mime:row.mime}:undefined
  }

  async material(brand:string,taskId:string,attachmentId:string):Promise<VideoSource> {
    const task=await this.store.task(brand,taskId)
    if(!task||task.agentType!=='video-editor'||!['konten.chat','video.rencana-produksi'].includes(task.kind))throw new Error('Permintaan footage tidak tersedia pada brand ini.')
    const chat=new ChatWorkspace(this.store),selected=await chat.input(task)
    if(!selected.attachmentIds.includes(attachmentId))throw new Error('Footage belum dipilih pada permintaan ini.')
    const attachment=await chat.taskAttachment(task,attachmentId)
    const row=(await this.store.db.query('SELECT storage_key,sha256 FROM chat_video_files WHERE brand_id=$1 AND attachment_id::text=$2',[brand,attachmentId])).rows[0]
    if(!attachment||!attachment.mime.startsWith('video/')||!row)throw new Error('Footage sudah dihapus atau tidak tersedia.')
    return {id:attachmentId,name:attachment.name,path:this.path(row.storage_key),sha256:row.sha256}
  }

  async cleanupRemoved(brand:string,agent:string,id:string) {
    const row=(await this.store.db.query('SELECT v.storage_key FROM chat_video_files v JOIN chat_attachments a ON a.id=v.attachment_id AND a.brand_id=v.brand_id WHERE a.brand_id=$1 AND a.agent_type=$2 AND a.id::text=$3 AND a.removed',[brand,agent,id])).rows[0]
    if(row)await rm(this.path(row.storage_key),{force:true}).catch(()=>console.warn('Salinan footage yang dihapus belum dapat dibersihkan dari disk.'))
  }
}
