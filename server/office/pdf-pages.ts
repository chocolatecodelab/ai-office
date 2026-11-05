import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
/** PDF native rendering runs in an isolated process; parser crashes cannot terminate the API. */
export function pdfRead(data:Buffer,action:'info'|'text'|'image',pages:number[]=[]):Promise<unknown> {
  return new Promise((resolve,reject)=>{
    const source=`console.log=()=>{};let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',async()=>{try{const w=JSON.parse(input);const {PDFParse}=require('pdf-parse');const p=new PDFParse({data:new Uint8Array(Buffer.from(w.data,'base64'))});try{let value;if(w.action==='info')value=(await p.getInfo()).total;else if(w.action==='text')value=(await p.getText({partial:w.pages})).pages.map(p=>({page:p.num,text:p.text}));else value=(await p.getScreenshot({partial:w.pages,desiredWidth:1400,imageDataUrl:true,imageBuffer:false})).pages.map(p=>p.dataUrl);process.stdout.write(JSON.stringify({value}))}finally{await p.destroy()}}catch{process.stdout.write(JSON.stringify({error:true}));process.exitCode=1}})`
    const child=spawn(process.execPath,['--max-old-space-size=256','-e',source],{cwd:fileURLToPath(new URL('../..',import.meta.url)),windowsHide:true,stdio:['pipe','pipe','pipe']})
    let output='',done=false
    const finish=(error?:Error,value?:unknown)=>{if(done)return;done=true;clearTimeout(timer);child.kill();if(error)reject(error);else resolve(value)}
    const timer=setTimeout(()=>finish(new Error('Tahap pembacaan PDF melewati batas waktu. Progres tersimpan; coba ulang atau pilih rentang halaman.')),60000)
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk})
    child.stderr.resume();child.stdin.on('error',()=>{})
    child.once('error',()=>finish(new Error('Proses pembaca PDF tidak dapat dimulai.')))
    child.once('close',()=>{try{const result=JSON.parse(output);if(result.error)throw new Error();finish(undefined,result.value)}catch{finish(new Error('PDF tidak dapat dibaca. Periksa berkas rusak atau sandi; progres sebelumnya tetap tersimpan.'))}})
    child.stdin.end(JSON.stringify({data:data.toString('base64'),action,pages}))
  })
}
export async function renderPdfPages(data:Buffer,pages?:number[]):Promise<string[]> {
  const selection=pages??Array.from({length:Number(await pdfRead(data,'info'))},(_,i)=>i+1)
  return await pdfRead(data,'image',selection) as string[]
}
export function pageSelection(range:string|undefined,total:number):number[]{
  if(!range?.trim())return Array.from({length:total},(_,i)=>i+1)
  const pages=new Set<number>()
  for(const piece of range.split(',')){const m=piece.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('Rentang halaman tidak valid. Contoh: 1-5,8,12-15.');const start=Number(m[1]),end=Number(m[2]??m[1]);if(start<1||end<start||end>total)throw new Error(`Rentang halaman harus berada di 1–${total}.`);for(let p=start;p<=end;p++)pages.add(p)}
  return [...pages].sort((a,b)=>a-b)
}
