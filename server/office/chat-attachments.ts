import { chatLimits } from './chat-limits.js'
import sharp from 'sharp'
import { Worker } from 'node:worker_threads'
import { extname } from 'node:path'

export const ATTACHMENT_LIMIT=chatLimits().uploadBytes
const TYPES:Record<string,string>={txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'}
// Parse complex documents away from the server event loop, bounded in time and JS heap.
function documentText(data:Buffer):Promise<string> {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const mammoth=require('mammoth');const r=await mammoth.extractRawText({buffer:Buffer.from(workerData.data)});parentPort.postMessage(r.value)})().catch(()=>parentPort.postMessage({error:true}))`,{eval:true,workerData:{data},resourceLimits:{maxOldGenerationSizeMb:128}})
    let settled=false
    const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();if(error)reject(error);else resolve(value!)}
    const timer=setTimeout(()=>finish(new Error('Pembacaan dokumen terlalu lama. Gunakan dokumen yang lebih kecil.')),60000)
    worker.once('message',(value:unknown)=>typeof value==='string'?finish(undefined,value):finish(new Error('Dokumen tidak dapat dibaca. Pastikan berkas valid dan tidak dilindungi sandi.')))
    worker.once('error',()=>finish(new Error('Dokumen terlalu kompleks atau tidak valid.')))
    worker.once('exit',()=>{if(!settled)finish(new Error('Pembacaan dokumen terhenti.'))})
  })
}
export async function readAttachment(rawName:string,data:Buffer) {
  const name=[...(rawName.replaceAll('\\','/').split('/').pop()??'')].filter(c=>c.charCodeAt(0)>=32).join('').slice(0,180)
  const extension=extname(name).slice(1).toLowerCase(),mime=TYPES[extension]
  if(!name || !mime)throw new Error('Format yang didukung: PDF, DOCX, TXT, MD, CSV, JSON, PNG, JPG, dan WebP.')
  if(!data.length || data.length>ATTACHMENT_LIMIT)throw new Error(`Ukuran berkas harus 1 byte sampai ${ATTACHMENT_LIMIT/1024/1024} MB.`)
  if(mime.startsWith('image/')) {
    const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const jpeg=data[0]===255 && data[1]===216 && data[2]===255
    const webp=data.subarray(0,4).toString()==='RIFF' && data.subarray(8,12).toString()==='WEBP'
    if(!png && !jpeg && !webp)throw new Error('Isi berkas bukan gambar PNG, JPG, atau WebP yang valid.')
    const image=sharp(data,{limitInputPixels:20000000,animated:false})
    const meta=await image.metadata()
    if(!['jpeg','png','webp'].includes(meta.format ?? ''))throw new Error('Isi gambar tidak sesuai format yang didukung.')
    const normalized=await image.rotate().resize(1600,1600,{fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer()
    return {name,mime:'image/jpeg',data:normalized,extracted:'',warning:'Gambar dianalisis melalui model multimodal saat pesan dikirim.'}
  }
  if(extension==='pdf' && !data.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('Isi berkas bukan PDF yang valid.')
  if(extension==='docx' && data.subarray(0,2).toString()!=='PK')throw new Error('Isi berkas bukan DOCX yang valid.')
  if(extension==='pdf')return {name,mime,data,extracted:'',warning:'PDF akan dibaca lengkap secara bertahap saat pesan dikirim. Pilih rentang halaman bila hanya bagian tertentu diperlukan.'}
  const text=extension==='docx'?await documentText(data):new TextDecoder('utf-8',{fatal:true}).decode(data)
  if(text.includes('\u0000'))throw new Error('Berkas teks berisi data biner. Gunakan teks UTF-8.')
  if(!text.trim())throw new Error('Tidak ada teks yang bisa dibaca.')
  return {name,mime,data,extracted:text,warning:''}
}
