import { revisionSource,applyVideoEdits } from './video-revision.js'
import { verifyRemoteSource } from './engine-remote.js'
import { engineSource } from './engine-source.js'
import { nativeStoryboard,nativeVideo } from './native-storyboard.js'
import sharp from 'sharp'
import { curatedDesign } from './curated-designs.js'
import { imageSlots,type Material } from './production-materials.js'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { z } from 'zod'
import { contentKnowledge } from './production-knowledge.js'
import { runProductionProcess } from './production-process.js'
import { videoPlanSchema } from './video-plan.js'
import type { VideoSource } from './video-attachments.js'

export const PRODUCTION_BRANDS:Record<string,string>={otca:'otca',infojerman:'info-jerman',ciaomanda:'ciao-manda',jepangkoey:'jepang-koey'}
export interface ProductionConfig { contentRoot?:string; videoRoot?:string; workDir:string; browserDir?:string }
const videoInput=z.object({preset:z.string().regex(/^[a-z0-9-]{1,100}(@[0-9.]+)?$/),seed:z.number().int().min(0).max(2147483647).default(1),plan:videoPlanSchema.optional(),sourceVersion:z.string().regex(/^[a-f0-9]{20,64}$/).optional(),sources:z.array(z.object({attachmentId:z.string().uuid(),taskId:z.string().uuid()}).strict()).max(10).optional()}).strict()
const requestSchema=z.object({title:z.string().trim().min(1).max(160),brief:z.string().trim().min(1).max(12000),spec:z.record(z.string(),z.unknown()).optional(),video:videoInput.optional(),chatAssets:z.array(z.object({attachmentId:z.string().uuid(),chatTaskId:z.string().uuid(),path:z.string().max(200)}).strict()).max(10).optional(),assetBindings:z.array(z.object({assetId:z.string().uuid(),path:z.string().regex(/^(?:slides\.\d+\.(?:[a-zA-Z0-9_]+\.)*(?:\d+\.)*src|background\.src)$/)}).strict()).max(10).optional()}).strict()
export type ProductionRequest=z.infer<typeof requestSchema>
export interface ProducedFile {name:string;mime:string;data:Buffer}
export interface ProductionResult {content:string;files:ProducedFile[];report:Record<string,unknown>}
export class ProductionQaError extends Error {
  constructor(readonly issues:Array<{slide:number;code:string;message:string}>){super('QA desain belum lulus: '+issues.map(i=>`slide ${i.slide}: ${i.message}`).join('; '))}
}
const scriptRoot=resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts').replace(/[\\/]build[\\/]scripts$/,sep+'scripts')
function cachedText(path:string){return readFileSync(path,'utf8')}

export function validateProductionRequest(agent:string,brand:string,input:unknown):ProductionRequest {
  if(!PRODUCTION_BRANDS[brand])throw new Error('Brand produksi tidak dikenal.')
  const request=requestSchema.parse(input)
  if(agent==='content-creator'){
    if(!request.spec||request.video)throw new Error('Content Creator memerlukan spesifikasi JSON carousel.')
    if(request.spec.brand!==PRODUCTION_BRANDS[brand])throw new Error('Brand spesifikasi harus sama dengan brand agent.')
    if(!Array.isArray(request.spec.slides)||request.spec.slides.length<1||request.spec.slides.length>10)throw new Error('Spesifikasi memerlukan 1–10 slide.')
    if(Buffer.byteLength(JSON.stringify(request.spec),'utf8')>80000)throw new Error('Spesifikasi terlalu besar (maksimal 80 KB).')
    // Renderers resolve images from disk. Limit incoming asset references to this brand and stock.
    const visit=(value:unknown,key='')=>{
      if(typeof value==='string'){
        if(['mascot','icon','id'].includes(key)&&!/^[-a-z0-9]+$/.test(value))throw new Error('ID aset tidak valid.')
        if(key==='position'&&!/^[a-zA-Z0-9% .-]+$/.test(value))throw new Error('Posisi gambar tidak valid.')
        if(['src','image','file','path'].includes(key)){
          const path=value.replace(/\\/g,'/')
          if(path.includes('..')||!['assets/stock/',`assets/brands/${PRODUCTION_BRANDS[brand]}/`,`assets/icons/${PRODUCTION_BRANDS[brand]}/`,`assets/decor/${PRODUCTION_BRANDS[brand]}/`].some(root=>path.startsWith(root)))throw new Error('Aset harus berasal dari pustaka lokal brand ini atau stock bersama.')
        }
      }else if(Array.isArray(value))value.forEach(v=>visit(v,key))
      else if(value&&typeof value==='object')Object.entries(value).forEach(([k,v])=>visit(v,k))
    }
    visit(request.spec)
    const bindings=[...(request.assetBindings??[]),...(request.chatAssets??[])]
    if(new Set(bindings.map(b=>b.path)).size!==bindings.length||bindings.some(b=>!imageSlots(request.spec!).includes(b.path)))throw new Error('Pilih slot gambar yang tersedia pada desain ini.')
  }else if(agent==='video-editor'){
    if(!request.video||request.spec)throw new Error('Video Editor memerlukan preset video.')
  }else throw new Error('Mesin produksi hanya tersedia untuk Content Creator dan Video Editor.')
  return request
}

export class ProductionEngines {
  private healthCache=new Map<string,{at:number;value:Awaited<ReturnType<ProductionEngines['probe']>>}>()
  constructor(readonly config:ProductionConfig){}
  root(agent:string){return agent==='content-creator'?this.config.contentRoot:agent==='video-editor'?this.config.videoRoot:undefined}
  async health(agent:string){
    const cached=this.healthCache.get(agent)
    if(cached&&Date.now()-cached.at<30000)return cached.value
    const value=await this.probe(agent)
    this.healthCache.set(agent,{at:Date.now(),value})
    return value
  }
  private async probe(agent:string){
    const root=this.root(agent)
    const required=agent==='content-creator'?['src/render/render.ts','node_modules/tsx/dist/loader.mjs','node_modules/playwright/package.json']:['pipeline/scripts/video.py','.venv/Scripts/python.exe','remotion/package.json']
    const checks=required.map(file=>({name:file,ready:!!root&&existsSync(join(root,file))}))
    let runtime:string|undefined
    let error:string|undefined
    if(root&&checks.every(c=>c.ready))try{
      runtime=agent==='content-creator'?await runProductionProcess(process.execPath,['--import',pathToFileURL(join(root,'node_modules/tsx/dist/loader.mjs')).href,join(scriptRoot,'production-content.mjs'),'--check',root],root,{timeoutMs:20000,env:this.config.browserDir?{PLAYWRIGHT_BROWSERS_PATH:this.config.browserDir}:undefined}):await runProductionProcess(join(root,'.venv/Scripts/python.exe'),['--version'],root,{timeoutMs:10000})
    }catch(e){error=e instanceof Error?e.message:String(e)}
    let remote:Awaited<ReturnType<typeof verifyRemoteSource>>|undefined
    if(root&&runtime&&!error)try{remote=await verifyRemoteSource(root)}catch(e){error=e instanceof Error?e.message:String(e)}
    let source:ReturnType<typeof engineSource>|undefined
    if(root&&runtime&&!error)try{source=engineSource(root)}catch(e){error=e instanceof Error?e.message:String(e)}
    return {...(source?{source}:{}),...(remote?{remote}:{}),configured:!!root,ready:!!runtime&&!error,checks,runtime:runtime?.trim(),error,mode:agent==='video-editor'?'project-preparation':'render-and-qa'}
  }
  context(agent:string,brand:string,message=''){
    const root=this.root(agent),slug=PRODUCTION_BRANDS[brand]
    if(!root||!slug)return {text:'',version:'unconfigured',files:[] as string[]}
    if(agent==='content-creator'){const context=contentKnowledge(root,slug,message),source=engineSource(root);return {...context,source,version:createHash('sha256').update(context.version+source.fingerprint).digest('hex').slice(0,20)}}
    const paths=['thumbnail/README.md','AGENTS.md','ATURAN_KERJA.md','pipeline/skill/SKILL.md','konteks/KONTEKS_11_caption-premium-full-frame_v0.1.md','konteks/KONTEKS_12_kurasi-motion-premium_v0.1.md','konteks/KONTEKS_13_motion-hidup_v0.1.md']
    const files=paths.filter(path=>existsSync(join(root,path)))
    const source=engineSource(root)
    const text=files.map(path=>`=== ${path} ===\n${cachedText(join(root,path))}`).join('\n\n')
    if(text.length>60000)throw new Error('Aturan mesin video melebihi anggaran konteks. Periksa modul yang dipilih sebelum produksi.')
    return {text,files,source,version:createHash('sha256').update(text+source.fingerprint).digest('hex').slice(0,20)}
  }
  compositionContract(){
    if(!this.config.contentRoot)throw new Error('Kontrak mesin Content Creator belum tersedia.')
    const source=cachedText(join(this.config.contentRoot,'src/schema.ts'))
    if(source.length>50000)throw new Error('Kontrak mesin terlalu besar untuk dimuat aman.')
    return source
  }
  async visualReferences(brand:string){
    const paths:Record<string,string>={otca:'docs/preview/otca-jalur-profil.jpg',infojerman:'docs/preview/ij-b1-b2-final.jpg',ciaomanda:'docs/preview/ciao-pilot-standar.jpg',jepangkoey:'docs/preview/jk-standar-baru.jpg'}
    const path=paths[brand],root=this.config.contentRoot
    if(!root||!path||!existsSync(join(root,path)))throw new Error('Referensi visual kurasi belum tersedia untuk brand ini.')
    const data=await readFile(join(root,path))
    return {path,sha256:createHash('sha256').update(data).digest('hex'),image:'data:image/jpeg;base64,'+(await sharp(data).resize({width:1400,withoutEnlargement:true}).jpeg({quality:85}).toBuffer()).toString('base64')}
  }
  carouselTemplate(brand:string,slideCount?:number):Record<string,unknown>{
    const root=this.config.contentRoot,slug=PRODUCTION_BRANDS[brand]
    if(!root||!slug)throw new Error('Mesin Content Creator belum dikonfigurasi.')
    const design=curatedDesign(root,slug)
    const spec=structuredClone(design.spec)
    if(slideCount&&(slideCount<3||slideCount>10))throw new Error('Carousel memerlukan 3–10 slide.')
    return {...spec,_officeDesign:design.provenance}
  }

  async run(agent:string,brand:string,id:string,attempt:number,input:unknown,signal?:AbortSignal,materials:Material[]=[],videoSources:VideoSource[]=[]):Promise<ProductionResult>{
    const request=validateProductionRequest(agent,brand,input),root=this.root(agent)
    if(!root)throw new Error('Lokasi mesin produksi belum dikonfigurasi.')
    if(!/^[a-f0-9-]{36}$/.test(id)||!Number.isSafeInteger(attempt)||attempt<1)throw new Error('Identitas tugas produksi tidak valid.')
    const work=resolve(this.config.workDir,brand,agent,id,String(attempt))
    await mkdir(work,{recursive:true})
    const recorded=request.spec?._officeDesign as {referenceSha256?:string;contextVersion?:string}|undefined
    const initialDesign=recorded?curatedDesign(root,PRODUCTION_BRANDS[brand]).provenance:undefined
    if(recorded){
      const current=curatedDesign(root,PRODUCTION_BRANDS[brand])
      if(recorded.referenceSha256!==current.provenance.referenceSha256||(recorded.contextVersion&&recorded.contextVersion!==this.context(agent,brand,request.brief).version))throw new Error('Referensi desain atau aturan brand berubah sejak penyusunan. Buat ulang dari chat agar memakai kurasi terbaru.')
    }
    const remoteVerification=await verifyRemoteSource(root)
    const initialSource=engineSource(root)
    if(request.video?.plan&&!request.video.sourceVersion)throw new Error('Rencana video lama belum mencatat versi mesin. Susun ulang dari chat sebelum produksi.')
    if(request.video?.sourceVersion&&request.video.sourceVersion!==this.context(agent,brand,request.brief).version)throw new Error('Mesin video atau aturan berubah sejak rencana dibuat. Susun ulang dari chat dengan versi terbaru.')
    const staged=structuredClone(request)
    if((request.assetBindings?.length??0)+(request.chatAssets?.length??0)!==materials.length)throw new Error('Bahan produksi belum diverifikasi.')
    for(const material of materials){
      if(!request.assetBindings?.some(b=>b.path===material.path&&b.assetId===material.id)&&!request.chatAssets?.some(b=>b.path===material.path&&b.attachmentId===material.id))throw new Error('Bahan produksi tidak cocok dengan pilihan pengguna.')
      const path=join(work,'material-'+material.id+'.png');await writeFile(path,material.data)
      const parts=material.path.split('.');let target=staged.spec as Record<string,unknown>
      for(const part of parts.slice(0,-1))target=target[part] as Record<string,unknown>
      target[parts.at(-1)!]=path
    }
    const context=this.context(agent,brand,request.brief)
    if((request.video?.sources?.length??0)!==videoSources.length||videoSources.some(source=>!request.video?.sources?.some(binding=>binding.attachmentId===source.id)))throw new Error('Sumber footage belum diverifikasi untuk tugas ini.')
    await writeFile(join(work,'request.json'),JSON.stringify({...staged,video_sources:videoSources,brand:PRODUCTION_BRANDS[brand],slug:`office-${id}-${attempt}`,contextVersion:context.version,engineSource:initialSource},null,2))
    const executable=agent==='content-creator'?process.execPath:join(root,'.venv/Scripts/python.exe')
    const args=agent==='content-creator'?['--import',pathToFileURL(join(root,'node_modules/tsx/dist/loader.mjs')).href,join(scriptRoot,'production-content.mjs'),root,work]:[join(scriptRoot,'production-video.py'),root,work]
    try{await runProductionProcess(executable,args,root,{timeoutMs:agent==='content-creator'?600000:120000,signal,env:{...(this.config.browserDir?{PLAYWRIGHT_BROWSERS_PATH:this.config.browserDir}:{}),...(agent==='video-editor'?{VIDEO_TEMP:join(work,'.temporary')}:{})}})}
    catch(error){
      const failure=join(work,'failure.json')
      if(existsSync(failure)){const report=JSON.parse(await readFile(failure,'utf8'));if(report.type==='qa')throw new ProductionQaError(report.issues)}
      throw error
    }
    await verifyRemoteSource(root)
    if(engineSource(root).fingerprint!==initialSource.fingerprint||this.context(agent,brand,request.brief).version!==context.version)throw new Error('Sumber mesin berubah saat produksi. Hasil ditahan; ulangi dengan versi terbaru.')
    if(initialDesign){
      const finalDesign=curatedDesign(root,PRODUCTION_BRANDS[brand]).provenance
      if(finalDesign.engineCommit!==initialDesign.engineCommit||finalDesign.referenceSha256!==initialDesign.referenceSha256||this.context(agent,brand,request.brief).version!==context.version)throw new Error('Sumber mesin atau aturan brand berubah saat render. Hasil tidak disimpan; ulangi produksi dengan sumber terbaru.')
    }
    const report=JSON.parse(await readFile(join(work,'result.json'),'utf8')) as {directory:string;status:string;files:string[]}
    const directory=await realpath(report.directory),base=await realpath(work)
    if(directory!==base&&!directory.startsWith(base+sep))throw new Error('Hasil pipeline di luar folder tugas.')
    const files:ProducedFile[]=[{name:'engine-source.json',mime:'application/json',data:Buffer.from(JSON.stringify(initialSource,null,2))}]
    let total=0
    const mime:Record<string,string>={png:'image/png',json:'application/json',md:'text/markdown',html:'text/html',srt:'text/plain'}
    for(const name of report.files){
      if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(name))throw new Error('Nama hasil pipeline tidak valid.')
      const path=await realpath(join(directory,name))
      if(!path.startsWith(base+sep))throw new Error('Berkas hasil di luar folder tugas.')
      const data=await readFile(path);total+=data.length
      if(total>100*1024*1024||files.length>=30)throw new Error('Hasil produksi melebihi batas impor 100 MB / 30 berkas.')
      files.push({name,mime:mime[name.split('.').pop()??'']??'application/octet-stream',data})
    }
    if(materials.length)files.push({name:'asset-provenance.json',mime:'application/json',data:Buffer.from(JSON.stringify(materials.map(m=>({id:m.id,path:m.path,source:m.source,license:m.license,evidence:m.evidence,sha256:m.sha256})),null,2))})
    if(initialDesign)files.push({name:'design-provenance.json',mime:'application/json',data:Buffer.from(JSON.stringify({...initialDesign,contextVersion:context.version,contextFiles:context.files},null,2))})
    const status=agent==='content-creator'?'Render dan QA selesai; perlu review manusia.':request.video?.plan?'Naskah dan rencana adegan siap ditinjau. Timing subtitle masih estimasi; storyboard visual dan render penuh menunggu bahan serta persetujuan pipeline.':'Proyek video disiapkan. Beat-sheet masih draf; belum ada render video atau persetujuan storyboard.'
    return {content:`${request.title}\n\n${status}\n\nStatus pipeline: ${report.status}\n\n${files.map(f=>`- ${f.name}`).join('\n')}`,files,report:{remoteVerification,source:initialSource,status:report.status,contextVersion:context.version,contextFiles:context.files,files:files.map(f=>f.name),designProvenance:request.spec?._officeDesign,stage:agent==='content-creator'?'review':request.video?.plan?'narrative-plan':'draft-project'}}
  }
  async renderRevision(brand:string,id:string,project:string,hashes:string[],approval:Record<string,unknown>,signal?:AbortSignal,onProgress?:(percent:number)=>void):Promise<ProductionResult>{
    const root=this.config.videoRoot;if(!root||!/^[-a-f0-9]{36}$/.test(id))throw new Error('Tugas render tidak valid.')
    const source=await this.videoRevisionContext(brand,project)
    if(source.project!==project)throw new Error('Buat preview revisi video terlebih dahulu sebelum render final.')
    const recorded=JSON.parse(await readFile(join(source.dir,'cache/sumber.json'),'utf8'))
    if(!hashes.includes(recorded.utama?.sha256))throw new Error('Footage tidak sesuai izin tugas.')
    const digest=(x:Buffer)=>createHash('sha256').update(x).digest('hex')
    if(digest(await readFile(join(source.dir,'revision-props.json')))!==approval.propsSha256||digest(await readFile(join(root,'remotion/src/OfficeRevision.tsx')))!==approval.compositionSha256||digest(await readFile(join(source.dir,'out/revision-preview.html')))!==approval.previewSha256)throw new Error('Preview atau mesin berubah. Buat dan tinjau preview terbaru sebelum render.')
    await verifyRemoteSource(root);const before=engineSource(root),work=join(this.config.workDir,brand,'render-revision',id,String(Date.now())),target='office-render-'+id+'-'+Date.now()
    await mkdir(join(work,'temporary'),{recursive:true});await writeFile(join(work,'request.json'),JSON.stringify({project,target,approval,engineSource:before,segmentCache:join(this.config.workDir,brand,'render-cache',createHash('sha256').update(JSON.stringify({pipeline:'segmented-h26418-v1',props:approval.propsSha256,composition:approval.compositionSha256,footage:approval.staticFootageSha256,engine:before.fingerprint})).digest('hex'))}))
    await runProductionProcess(process.execPath,[join(scriptRoot,'render-video-revision.mjs'),root,work],root,{timeoutMs:1800000,signal,onOutput:text=>{for(const m of text.matchAll(/Render (\d+)%/g))onProgress?.(Number(m[1]))},env:{TEMP:join(work,'temporary'),TMP:join(work,'temporary'),VIDEO_TEMP:join(work,'temporary')}})
    await verifyRemoteSource(root);if(engineSource(root).fingerprint!==before.fingerprint)throw new Error('Versi mesin berubah; render ditahan.')
    return nativeVideo(root,target,hashes)
  }
  async videoRevisionContext(brand:string,project:string){
    this.thumbnailSettings(brand,project)
    if(!this.config.videoRoot)throw new Error('Mesin belum tersedia.')
    return revisionSource(this.config.videoRoot,project)
  }
  async reviseVideo(brand:string,id:string,project:string,edits:unknown,hashes:string[]):Promise<ProductionResult>{
    const root=this.config.videoRoot;if(!root||!/^[-a-f0-9]{36}$/.test(id))throw new Error('Identitas revisi tidak valid.')
    const source=await this.videoRevisionContext(brand,project),recorded=JSON.parse(await readFile(join(source.dir,'cache/sumber.json'),'utf8'))
    if(!hashes.includes(recorded.utama?.sha256))throw new Error('Footage tidak cocok dengan izin proyek.')
    const applied=applyVideoEdits(source.props,edits)
    await verifyRemoteSource(root);const before=engineSource(root)
    const work=join(this.config.workDir,brand,'revision',id,String(Date.now())),target='office-revision-'+id+'-'+Date.now()
    await mkdir(join(work,'temporary'),{recursive:true});await writeFile(join(work,'request.json'),JSON.stringify({...applied,sourceProject:source.project,latestSourceProject:project,target}))
    await runProductionProcess(process.execPath,[join(scriptRoot,'revise-video.mjs'),root,work],root,{timeoutMs:600000,env:{TEMP:join(work,'temporary'),TMP:join(work,'temporary'),VIDEO_TEMP:join(work,'temporary')}})
    await verifyRemoteSource(root);if(engineSource(root).fingerprint!==before.fingerprint)throw new Error('Mesin berubah; preview ditahan.')
    const report=JSON.parse(await readFile(join(work,'result.json'),'utf8')),files:ProducedFile[]=[]
    for(const name of report.files){if(!/^[-a-z0-9.]+$/.test(name))throw new Error('Nama hasil tidak valid.');files.push({name,mime:name.endsWith('.png')?'image/png':name.endsWith('.html')?'text/html':name.endsWith('.json')?'application/json':'text/plain',data:await readFile(join(root,'proyek',target,'out',name))})}
    return {content:'Preview revisi video siap ditinjau. Hanya adegan yang terpengaruh ditampilkan. MP4 sebelumnya tetap; render final versi baru belum dijalankan.',files,report:{...report,source:before,sourceProject:source.project,videoRerendered:false,stage:'revision-preview'}}
  }
  thumbnailSettings(brand:string,project:string){
    const root=this.config.videoRoot
    if(!root||!/^[-a-z0-9_]{1,120}$/.test(project))throw new Error('Proyek tidak valid.')
    const m=JSON.parse(readFileSync(join(root,'proyek',project,'manifest.json'),'utf8'))
    if(m.thumbnail?.brand!==PRODUCTION_BRANDS[brand])throw new Error('Proyek bukan milik brand ini.')
    return {headline:m.thumbnail.headline,subheadline:m.thumbnail.subheadline,frame_time:m.thumbnail.frame_time,margin:m.thumbnail.margin}
  }
  async reviseThumbnail(brand:string,id:string,project:string,patch:Record<string,unknown>,hashes:string[]):Promise<ProductionResult>{
    const root=this.config.videoRoot
    if(!root||!/^[-a-f0-9]{36}$/.test(id))throw new Error('Mesin atau tugas tidak valid.')
    this.thumbnailSettings(brand,project)
    const base=await realpath(join(root,'proyek')),source=await realpath(join(base,project))
    if(!source.startsWith(base+sep))throw new Error('Proyek di luar pustaka.')
    const recorded=JSON.parse(await readFile(join(source,'cache/sumber.json'),'utf8'))
    if(!hashes.includes(recorded.utama?.sha256))throw new Error('Footage proyek tidak cocok dengan izin tugas.')
    await verifyRemoteSource(root);const before=engineSource(root)
    const target='office-thumbnail-'+id+'-'+Date.now(),work=join(this.config.workDir,brand,'thumbnail',id,String(Date.now()))
    await mkdir(work,{recursive:true});await writeFile(join(work,'request.json'),JSON.stringify({project,target,patch}))
    await runProductionProcess(join(root,'.venv/Scripts/python.exe'),[join(scriptRoot,'revise-thumbnail.py'),root,work],root,{timeoutMs:120000,env:{VIDEO_TEMP:join(work,'temporary'),TEMP:join(work,'temporary'),TMP:join(work,'temporary')}})
    await verifyRemoteSource(root);if(engineSource(root).fingerprint!==before.fingerprint)throw new Error('Mesin berubah saat revisi; hasil ditahan.')
    const out=await realpath(join(base,target,'out'));if(!out.startsWith(base+sep))throw new Error('Hasil di luar pustaka.')
    const files:ProducedFile[]=[]
    for(const name of ['thumbnail.png','thumbnail-grid.png','thumbnail-qa.json','thumbnail-revision.json'])files.push({name,mime:name.endsWith('.png')?'image/png':'application/json',data:await readFile(join(out,name))})
    if(JSON.parse(files[2].data.toString()).status!=='LULUS')throw new Error('QA thumbnail belum lulus.')
    return {content:'Thumbnail direvisi sesuai arahan. Cover 9:16 dan 3:4 tersedia untuk ditinjau. MP4 tidak dirender ulang.',files,report:{project:target,sourceProject:project,source:before,stage:'thumbnail-review',videoRerendered:false}}
  }
  async nativeStoryboard(project:string,file:string,hashes:string[]){
    if(!this.config.videoRoot)throw new Error('Mesin video belum dikonfigurasi.');return nativeStoryboard(this.config.videoRoot,project,file,hashes)
  }
  async nativeVideo(project:string,hashes:string[]){
    if(!this.config.videoRoot)throw new Error('Mesin video belum dikonfigurasi.');return nativeVideo(this.config.videoRoot,project,hashes)
  }
  async presets(){
    if(!this.config.videoRoot)return []
    const root=join(this.config.videoRoot,'preset')
    if(!existsSync(root))return []
    return (await readdir(root)).filter(name=>name.endsWith('.json')&&!name.startsWith('_')).map(name=>{const data=JSON.parse(cachedText(join(root,name)));return {id:(data._meta?.id??name.replace(/^PRESET_\d+_/,'').replace(/_v[\d.]+\.json$/,'')) as string,label:(data.label??data._meta?.id??name) as string}})
  }
}
