import { engineSource } from './engine-source.js'
import { readFile, realpath } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { createHash } from 'node:crypto'
import type { ProductionResult } from './production-engines.js'

/** Snapshot existing native artwork; never executes HTML or changes native approvals. */
export async function nativeStoryboard(root:string,project:string,file:string,sourceHashes:string[]):Promise<ProductionResult>{
  if(!/^[a-z0-9_-]{1,120}$/.test(project)||!/^storyboard(?:-[a-z0-9]+)?\.html$/.test(file))throw new Error('Identitas storyboard tidak valid.')
  const projects=await realpath(resolve(root,'proyek')),dir=await realpath(resolve(projects,project))
  if(!dir.startsWith(projects+sep))throw new Error('Proyek di luar pustaka native.')
  const out=await realpath(resolve(dir,'out'))
  if(!out.startsWith(dir+sep))throw new Error('Folder keluaran tidak valid.')
  const source=JSON.parse(await readFile(resolve(dir,'cache/sumber.json'),'utf8'))
  // Only an explicitly bound footage hash can authorize importing a native project.
  const digest=source?.utama?.sha256
  if(!sourceHashes.length||!sourceHashes.some(h=>h.toLowerCase()===digest?.toLowerCase()))throw new Error('Footage proyek native tidak cocok dengan tugas ini.')
  const path=await realpath(resolve(out,file))
  if(!path.startsWith(out+sep))throw new Error('HTML di luar keluaran native.')
  let html=await readFile(path,'utf8'),total=Buffer.byteLength(html)
  const images:Array<{path:string;sha256:string}>=[]
  const replacements=new Map<string,string>()
  for(const match of html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)){
    const url=match[1];if(replacements.has(url))continue
    if(!/^[a-zA-Z0-9_./-]+\.(png|jpe?g|webp)$/i.test(url)||url.split('/').includes('..'))throw new Error('Sumber gambar storyboard harus berkas lokal di dalam keluaran.')
    const image=await realpath(resolve(out,url));if(!image.startsWith(out+sep))throw new Error('Gambar keluar dari folder storyboard.')
    const bytes=await readFile(image);total+=bytes.length;if(total>40*1024*1024)throw new Error('Paket storyboard melebihi 40 MB.')
    const ext=extname(image).slice(1).toLowerCase(),mime=ext==='jpg'?'jpeg':ext
    replacements.set(url,`data:image/${mime};base64,${bytes.toString('base64')}`)
    images.push({path:url,sha256:createHash('sha256').update(bytes).digest('hex')})
  }
  if(!images.length)throw new Error('Storyboard native tidak memiliki gambar adegan.')
  html=html.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi,(_all,a,url,b)=>a+replacements.get(url)+b)
  html='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data:; style-src &#39;unsafe-inline&#39;;">'+html
  const provenance={stage:'native-visual-snapshot',project,file,sourceHashes,images,htmlSha256:createHash('sha256').update(html).digest('hex'),approval:'pending',renderedByOffice:false}
  return {content:`Storyboard visual native tersedia: ${project}.\n${images.length} gambar dipaketkan untuk review. Ini snapshot hasil pipeline native; belum ada persetujuan atau render final dari AI Office.`,files:[{name:'storyboard-visual.html',mime:'text/html',data:Buffer.from(html)},{name:'storyboard-provenance.json',mime:'application/json',data:Buffer.from(JSON.stringify(provenance,null,2))}],report:provenance}
}

export async function nativeVideo(root:string,project:string,sourceHashes:string[]):Promise<ProductionResult>{
  if(!/^[a-z0-9_-]{1,120}$/.test(project))throw new Error('Identitas proyek tidak valid.')
  const projects=await realpath(resolve(root,'proyek')),dir=await realpath(resolve(projects,project))
  if(!dir.startsWith(projects+sep))throw new Error('Proyek di luar pustaka native.')
  const read=async(name:string)=>{const path=await realpath(resolve(dir,name));if(!path.startsWith(dir+sep))throw new Error('Berkas keluar dari proyek.');return readFile(path)}
  const source=JSON.parse((await read('cache/sumber.json')).toString())
  if(!sourceHashes.some(h=>h===source?.utama?.sha256))throw new Error('Footage proyek tidak cocok dengan tugas ini.')
  const provenance=JSON.parse((await read('out/render-provenance.json')).toString())
  if(provenance.stage!=='encoded-and-verified'||!provenance.videoSha256||!provenance.approval?.compositionSha256)throw new Error('Render belum selesai diverifikasi.')
  const data=await read(`out/${project}.mp4`)
  if(data.length>500*1024*1024||createHash('sha256').update(data).digest('hex')!==provenance.videoSha256)throw new Error('Berkas video berubah atau melebihi batas impor.')
  const qa=await read('out/qa-report.md')
  const sourceVersion=engineSource(root)
  const extras=[]
  for(const [name,mime] of [['thumbnail.png','image/png'],['thumbnail-grid.png','image/png'],['thumbnail-qa.json','application/json'],['subtitle.srt','text/plain'],['subtitle.vtt','text/vtt']])extras.push({name,mime,data:await read('out/'+name)})
  const thumbnailQa=JSON.parse(extras.find(f=>f.name==='thumbnail-qa.json')!.data.toString())
  if(thumbnailQa.status!=='LULUS')throw new Error('Thumbnail belum lolos pemeriksaan layout.')
  const delivery={version:1,source:sourceVersion,videoSha256:provenance.videoSha256,thumbnailTemplate:thumbnailQa.template,review:'Cover baru perlu review manusia; render video memakai sumber yang tercatat pada render-provenance.json',files:extras.map(f=>({name:f.name,sha256:createHash('sha256').update(f.data).digest('hex')}))}
  if(engineSource(root).fingerprint!==sourceVersion.fingerprint)throw new Error('Mesin berubah selama pengemasan. Ulangi pengemasan hasil.')
  return {content:'Video selesai dirender. Paket hasil berisi MP4, cover 9:16 dan 3:4, subtitle, serta laporan pemeriksaan. Review artistik akhir tetap diperlukan sebelum publikasi.',files:[{name:`${project}.mp4`,mime:'video/mp4',data},...extras,{name:'delivery-manifest.json',mime:'application/json',data:Buffer.from(JSON.stringify(delivery,null,2))},{name:'qa-report.md',mime:'text/markdown',data:qa},{name:'render-provenance.json',mime:'application/json',data:Buffer.from(JSON.stringify(provenance,null,2))}],report:{...provenance,delivery,stage:'video-review'}}
}
