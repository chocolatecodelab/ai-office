import { createHash } from 'node:crypto'
import sharp from 'sharp'
import type { OfficeStore } from './store.js'
import { ChatWorkspace } from './chat-workspace.js'
export interface Material {path:string;id:string;data:Buffer;source:string;license:string;evidence:string;sha256:string}
export interface ChatImageBinding {attachmentId:string;chatTaskId:string;path:string}
export async function chatMaterials(store:OfficeStore,brand:string,bindings:ChatImageBinding[]):Promise<Material[]>{
 const result:Material[]=[]
 for(const b of bindings){
  const task=await store.task(brand,b.chatTaskId)
  if(!task||task.agentType!=='content-creator'||!['konten.chat','konten.carousel-produksi'].includes(task.kind))throw new Error('Permintaan produksi sumber tidak tersedia pada brand ini.')
  const workspace=new ChatWorkspace(store)
  const input=await workspace.input(task)
  const row=input.attachmentIds.includes(b.attachmentId)?await workspace.taskAttachment(task,b.attachmentId):undefined
  if(!row||!row.data||!['image/png','image/jpeg','image/webp'].includes(row.mime))throw new Error('Gambar lampiran tidak tersedia pada percakapan dan brand ini. Unggah ulang bahan yang ingin dipakai.')
  const data=await sharp(row.data,{limitInputPixels:40000000}).rotate().png().toBuffer()
  result.push({id:row.id,path:b.path,data,source:`Lampiran chat: ${row.name}; ${row.source}`,license:'Bahan pengguna untuk draf ini; izin publikasi belum diverifikasi',evidence:`Pesan pengguna ${b.chatTaskId}`,sha256:createHash('sha256').update(data).digest('hex')})
 }
 return result
}
export function imageSlots(spec:Record<string,unknown>){
 const paths:string[]=[]
 const visit=(v:unknown,p:string)=>{if(Array.isArray(v))v.forEach((x,i)=>visit(x,p?`${p}.${i}`:String(i)));else if(v&&typeof v==='object')for(const [key,x]of Object.entries(v)){const path=p?`${p}.${key}`:key;if(key==='src'&&typeof x==='string'&&(path.startsWith('slides.')||path==='background.src'))paths.push(path);else visit(x,path)}}
 visit(spec,'');return paths
}
export async function productionMaterials(store:OfficeStore,brand:string,bindings:Array<{assetId:string;path:string}>):Promise<Material[]>{
 const result:Material[]=[]
 for(const binding of bindings){
  const row=(await store.db.query(`SELECT l.id,l.source,l.license,l.evidence,l.status,a.data,a.mime FROM brand_asset_library l JOIN chat_attachments a ON a.id=l.attachment_id AND a.brand_id=l.brand_id WHERE l.id=$1 AND l.brand_id=$2 AND a.agent_type='content-creator' AND NOT a.removed`,[binding.assetId,brand])).rows[0]
  if(!row||row.status!=='cleared'||!row.evidence)throw new Error('Aset tidak tersedia atau izin penggunaannya belum aktif pada brand ini.')
  if(!['image/png','image/jpeg','image/webp'].includes(row.mime)||!row.data)throw new Error('Pilih bahan PNG, JPG, atau WebP untuk penempatan gambar.')
  // Decode and re-encode; no SVG, remote requests, metadata, or arbitrary file paths reach the renderer.
  const data=await sharp(row.data,{limitInputPixels:40000000}).rotate().png().toBuffer()
  result.push({...binding,id:row.id,data,source:row.source,license:row.license,evidence:row.evidence,sha256:createHash('sha256').update(data).digest('hex')})
 }
 return result
}
