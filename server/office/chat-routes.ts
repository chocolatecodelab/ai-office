import { chatLimits } from './chat-limits.js'
import express, { type Router, type Request, type Response } from 'express'
import type { OfficeServices } from './index.js'
import { ChatWorkspace } from './chat-workspace.js'
import { chatSkills, selectedSkills, skillExecution } from './chat-skills.js'
import { agentContextFiles } from '../otca-context.js'
import { selectOfficialContext } from './context-policy.js'
import { validateMemoryChoices } from './memory-choices.js'
import { videoUploadLimit } from './video-attachments.js'
import { compactChat } from './chat-memory.js'
import { routeFor } from './model-routes.js'

const DRIVE='https://www.googleapis.com/drive/v3/files'
const driveId=(id:string)=>{if(!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw new Error('ID Drive tidak valid.');return id}
async function limitedBytes(response:globalThis.Response) {
  if(!response.ok)throw new Error(`Google Drive belum dapat dibaca (HTTP ${response.status}). Hubungkan ulang bila izin telah dicabut.`)
  const reader=response.body?.getReader();if(!reader)throw new Error('Berkas Drive kosong.')
  const chunks:Uint8Array[]=[];let size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>chatLimits().uploadBytes)throw new Error(`Berkas Drive melebihi batas server ${chatLimits().uploadBytes/1024/1024} MB.`);chunks.push(value)}}finally{await reader.cancel()}
  return Buffer.concat(chunks)
}
export function installChatRoutes(router:Router,services:Promise<OfficeServices>) {
  const owner=async(request:Request)=>{
    const office=await services,brand=String(request.params.brand),agent=String(request.params.agent)
    if(!(await office.store.agents(brand)).some(a=>a.agentType===agent && a.active))throw new Error('Agent tidak tersedia pada brand ini.')
    return {office,brand,agent,chat:office.chat ?? new ChatWorkspace(office.store)}
  }
  type Owner=Awaited<ReturnType<typeof owner>>
  const handle=(work:(o:Owner,r:Request)=>Promise<unknown>)=>async(r:Request,s:Response)=>{try{s.json(await work(await owner(r),r))}catch(e){s.status(400).json({error:e instanceof Error?e.message:String(e)})}}
  const base='/brands/:brand/agents/:agent'
  router.post(`${base}/video-attachments`,handle(async(o,r)=>{
    const length=r.get('Content-Length')
    return o.office.videoAttachments.upload(o.brand,o.agent,decodeURIComponent(r.get('X-File-Name')??''),r,length?Number(length):undefined)
  }))
  router.post(`${base}/context-preview`,handle(async(o,r)=>{
    const message=r.body?.message
    if(typeof message!=='string' || !message.trim() || message.length>12000)throw new Error('Tulis pesan 1–12.000 karakter untuk meninjau konteks.')
    const skills=selectedSkills(o.agent,r.body?.skills)
    const files=o.office.contextDir?agentContextFiles(o.office.contextDir,o.agent,o.brand)??[]:[]
    const official=selectOfficialContext(files,o.agent,message,r.body?.delegate!==true)
    return {
      ...await o.chat.previewNotes(o.brand,o.agent,message,r.body?.useMemory!==false,validateMemoryChoices(r.body??{})),
      official:{core:official.core.map(f=>f.path),references:official.references.map(f=>f.path),available:files.length,characters:official.selectedChars,version:official.version},
      skills:skills.map(s=>({id:s.id,name:s.name,execution:skillExecution(s.id)})),
    }
  }))
  router.get(`${base}/document-progress`,handle(async o=>(await o.office.store.db.query(`SELECT DISTINCT a.id,a.name,a.processing FROM tasks t JOIN chat_inputs i ON i.task_id=t.id AND i.brand_id=t.brand_id JOIN chat_attachments a ON a.id=ANY(i.attachment_ids) AND a.brand_id=t.brand_id WHERE t.brand_id=$1 AND t.agent_type=$2 AND t.status IN ('queued','running','revision','waiting_quota','failed') AND a.mime='application/pdf' AND NOT a.removed`,[o.brand,o.agent])).rows))
  router.get(`${base}/attachments`,handle(async o=>o.chat.attachments(o.brand,o.agent)))
  router.post(`${base}/attachments`,(req,res,next)=>{express.raw({type:'application/octet-stream',limit:chatLimits().uploadBytes})(req,res,error=>{if(error){res.status(413).json({error:`Berkas melebihi batas server ${chatLimits().uploadBytes/1024/1024} MB.`});return}next()})},handle(async(o,r)=>{
    if(!Buffer.isBuffer(r.body))throw new Error('Kirim berkas sebagai data biner.')
    return o.chat.upload(o.brand,o.agent,decodeURIComponent(r.get('X-File-Name')??''),r.body)
  }))
  router.delete(`${base}/attachments/:id`,handle(async(o,r)=>{
    const result=await o.chat.removeAttachment(o.brand,o.agent,String(r.params.id))
    await o.office.videoAttachments.cleanupRemoved(o.brand,o.agent,String(r.params.id))
    return result
  }))
  router.get(`${base}/attachments/:id/file`,async(r,s)=>{
    try {
      const o=await owner(r),task=typeof r.query.task==='string'?await o.office.store.task(o.brand,r.query.task):undefined
      if(r.query.task && (!task || task.agentType!==o.agent))throw new Error('Tugas bukan milik agent ini.')
      const file=task?await o.chat.taskAttachment(task,String(r.params.id)):await o.chat.attachment(o.brand,o.agent,String(r.params.id))
      if(!file){s.status(404).json({error:'Lampiran sudah dihapus atau tidak ditemukan.'});return}
      if(file.mime.startsWith('video/')){
        const source=await o.office.videoAttachments.file(o.brand,file.agent_type,String(r.params.id))
        if(!source)throw new Error('Footage tidak tersedia.')
        s.type(source.mime).set({'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,'X-Content-Type-Options':'nosniff'}).sendFile(source.path)
        return
      }
      s.set({'Content-Type':file.mime,'Content-Disposition':`${r.query.inline==='1'&&['application/pdf','image/jpeg'].includes(file.mime)?'inline':'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}).send(file.data)
    } catch {s.status(400).json({error:'Lampiran belum dapat dibaca.'})}
  })
  router.get(`${base}/attachments/:id/preview`,handle(async(o,r)=>{const file=await o.chat.attachment(o.brand,o.agent,String(r.params.id));if(!file)throw new Error('Lampiran tidak ditemukan.');return {name:file.name,mime:file.mime,text:file.extracted,warning:file.warning}}))
  router.get(`${base}/chat-evidence`,handle(async o=>o.chat.evidence(o.brand,o.agent)))
  router.get(`${base}/chat-memory`,handle(async o=>o.chat.memory(o.brand,o.agent)))
  router.put(`${base}/chat-memory`,handle(async(o,r)=>o.chat.updateMemory(o.brand,o.agent,r.body??{})))
  router.post(`${base}/compact-memory`,handle(async o=>{
    const endpoint=o.office.settings?.hermes(o.brand)
    if(!endpoint || !o.office.hermes)throw new Error('Hermes belum terhubung untuk meringkas memori.')
    const taskRow=(await o.office.store.db.query(
      `SELECT id, brand_id AS "brandId", agent_type AS "agentType", kind, title, brief, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM tasks WHERE brand_id=$1 AND agent_type=$2 AND kind='konten.chat' AND status='done' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [o.brand,o.agent]
    )).rows[0]
    if(!taskRow)return {compacted:false,message:'Belum ada percakapan selesai untuk diringkas.'}
    const route=routeFor({agentType:o.agent,urgent:false,complex:false},o.office.settings?.engineProfile??'dev')
    await compactChat(o.chat,taskRow,o.office.hermes,endpoint,route,{force:true})
    const mem=await o.chat.memory(o.brand,o.agent)
    return {compacted:true,summary:mem.summary,revision:mem.revision}
  }))
  router.get(`${base}/capabilities`,handle(async o=>{
    const connections=await o.office.store.connections(),mode=(await o.office.store.integrationModes()).get(o.brand)?.get('drive')??'mock'
    const drive=connections.some(c=>c.brandId===o.brand && c.service==='drive' && c.status==='active') && mode!=='mock'
    return {limits:{...chatLimits(),videoUploadBytes:videoUploadLimit()},skills:chatSkills(o.agent).map(({id,name,description})=>({id,name,description,execution:skillExecution(id),source:skillExecution(id)==='tool'?'Tool aplikasi':'Panduan kerja',available:true})),connectors:[{id:'office-files',name:'Berkas brand',available:true,description:'Pilih hasil kerja tersimpan dari brand ini. Akses baca.'},{id:'drive',name:'Google Drive',available:drive,description:drive?'Pilih dokumen dari akun brand yang terhubung. Akses baca.':'Hubungkan akun brand dan aktifkan mode Drive di Pengaturan.'}],plugins:[],note:'Tool aplikasi mengeksekusi pencarian atau perhitungan. Panduan kerja mengarahkan cara agent menjawab. Pilihan dan hasil tercatat pada pesan.'}
  }))
  router.get(`${base}/sources/office-files`,handle(async o=>o.office.store.assetList(o.brand,100)))
  router.post(`${base}/sources/office-files`,handle(async(o,r)=>{
    const asset=await o.office.store.asset(o.brand,String(r.body?.id??''))
    if(!asset)throw new Error('Berkas tidak ditemukan di brand ini.')
    // Use the stored textual source for generated PDFs instead of re-parsing a rendering.
    const name=(asset.name??asset.title).replace(/\.[^.]+$/,'').slice(0,150)+'.md'
    return o.chat.upload(o.brand,o.agent,name,Buffer.from(asset.content,'utf8'),`Berkas brand · ${asset.name??asset.title}`)
  }))
  const driveToken=async(o:Owner)=>{
    if(((await o.office.store.integrationModes()).get(o.brand)?.get('drive')??'mock')==='mock')throw new Error('Aktifkan koneksi Drive brand ini di Pengaturan terlebih dahulu.')
    return o.office.connections.accessToken(o.brand,'drive')
  }
  router.get(`${base}/sources/drive`,handle(async(o,r)=>{
    const token=await driveToken(o),parent=typeof r.query.folder==='string'&&r.query.folder?` and '${driveId(r.query.folder)}' in parents`:''
    const search=typeof r.query.q==='string'?r.query.q.slice(0,120).replace(/\\/g,'\\\\').replace(/'/g,"\\'") : ''
    const query=new URLSearchParams({q:`trashed=false${parent}${search?` and name contains '${search}'`:''}`,pageSize:'50',fields:'files(id,name,mimeType,size)',orderBy:'modifiedTime desc'})
    const response=await fetch(`${DRIVE}?${query}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error(`Daftar Drive belum tersedia (HTTP ${response.status}).`)
    return (await response.json() as {files:unknown[]}).files
  }))
  router.post(`${base}/sources/drive`,handle(async(o,r)=>{
    const token=await driveToken(o),id=driveId(String(r.body?.id??'')),headers={Authorization:`Bearer ${token}`}
    const metadata=await fetch(`${DRIVE}/${id}?fields=id,name,mimeType,size`,{headers,signal:AbortSignal.timeout(15000)})
    if(!metadata.ok)throw new Error('Berkas tidak dapat diakses dengan koneksi Drive brand ini.')
    const file=await metadata.json() as {name:string;mimeType:string;size?:string}
    if(Number(file.size??0)>chatLimits().uploadBytes)throw new Error(`Berkas Drive melebihi batas server ${chatLimits().uploadBytes/1024/1024} MB.`)
    const doc=file.mimeType==='application/vnd.google-apps.document'
    const content=await fetch(doc?`${DRIVE}/${id}/export?mimeType=text%2Fplain`:`${DRIVE}/${id}?alt=media`,{headers,signal:AbortSignal.timeout(20000)})
    return o.chat.upload(o.brand,o.agent,doc?file.name+'.txt':file.name,await limitedBytes(content),'Google Drive · '+file.name)
  }))
}
