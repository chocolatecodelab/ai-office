import { imageSlots,type ChatImageBinding } from './production-materials.js'
import { transaction } from '../db/index.js'
import type { OfficeStore, Task } from './store.js'
import type { RunResult } from './hermes-client.js'
import { validateProductionRequest, type ProductionEngines } from './production-engines.js'
import { registerProductionVersion,ProductionSourceChoiceRequired } from './production-projects.js'
import { ChatWorkspace } from './chat-workspace.js'

const edit=/\b(edit|revisi|ubah|ganti|perbaiki)\b/i
/** Only the user's latest direct request enables execution, never an attachment or prior reply. */
export function wantsCarousel(message:string){
  if(/\b(jangan|belum|tanpa)\s+(?:di)?(?:buat|render|edit)|^(?:bagaimana|gimana|apakah|apa itu|bisakah|bisa\s+(?:tidak|nggak|kah))\b/i.test(message.trim()))return false
  return /\b(buat(?:kan)?|bikin(?:kan)?|hasilkan|render|desain(?:kan)?|edit|revisi|ubah|ganti|perbaiki)\b/i.test(message)&&(/\bcarousel\b/i.test(message)||(edit.test(message)&&/\b(slide|caption)\b/i.test(message)))
}
export interface CopySlot {path:string;value:string;maxChars:number}
export function carouselCopySlots(spec:Record<string,unknown>):CopySlot[]{
  const slots:CopySlot[]=[]
  const keys=new Set(['headline','sub','cta','t','head','label','note','intent'])
  const visit=(value:unknown,path:string,key:string)=>{
    if(typeof value==='string'&&keys.has(key)&&value.trim())slots.push({path,value,maxChars:key==='label'?Math.min(value.length,3):Math.max(value.length,12)})
    else if(Array.isArray(value))value.forEach((item,index)=>visit(item,`${path}.${index}`,''))
    else if(value&&typeof value==='object')Object.entries(value).forEach(([key,item])=>visit(item,`${path}.${key}`,key))
  }
  visit(spec.slides,'slides','')
  slots.push({path:'caption',value:typeof spec.caption==='string'?spec.caption:'',maxChars:1800})
  return slots
}
export async function carouselChatPlan(store:OfficeStore,engines:ProductionEngines,task:Task){
  const bound=task.kind==='konten.carousel-produksi'&&task.status==='revision'?task.id:(await store.db.query("SELECT payload->>'sourceTaskId' AS source FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='production_revision_requested' ORDER BY id DESC LIMIT 1",[task.brandId,task.id])).rows[0]?.source??(await store.db.query('SELECT production_source_task_id AS source FROM chat_inputs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[task.brandId,task.agentType,task.id])).rows[0]?.source
  const candidates=bound?(await store.db.query('SELECT payload,task_id FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id::text=$3',[task.brandId,task.agentType,bound])).rows:(await store.db.query(`SELECT p.payload,p.task_id,v.project_id FROM production_jobs p JOIN tasks child ON child.id=p.task_id AND child.brand_id=p.brand_id LEFT JOIN production_versions v ON v.task_id=child.id AND v.brand_id=child.brand_id WHERE p.brand_id=$1 AND p.agent_type=$2 AND child.created_at<$3 AND child.status IN ('waiting_approval','approved','done') AND EXISTS(SELECT 1 FROM assets a WHERE a.task_id=child.id AND a.brand_id=child.brand_id AND a.name='slide-01.png' AND a.storage_key IS NOT NULL) ORDER BY child.created_at DESC`,[task.brandId,task.agentType,task.createdAt])).rows
  if(!bound&&edit.test(task.brief)&&new Set(candidates.map(p=>p.project_id??p.task_id)).size>1)throw new ProductionSourceChoiceRequired('Ada beberapa proyek carousel. Pilih hasil yang ingin direvisi melalui menu percakapan → Proyek dan versi, lalu kirim ulang arahan Anda.')
  if(!bound&&edit.test(task.brief)&&!candidates.length)throw new ProductionSourceChoiceRequired('Belum ada hasil carousel untuk direvisi. Buat carousel terlebih dahulu atau pilih hasil melalui Proyek dan versi.')
  const previous=candidates[0]
  if(!(await engines.health('content-creator')).ready)throw new Error('Mesin Content Creator belum siap untuk merender carousel dari chat.')
  if(bound&&!previous)throw new Error('Sumber revisi tidak tersedia pada brand dan agent ini.')
  const revising=(edit.test(task.brief)||task.status==='revision')&&!!previous&&(task.kind==='konten.chat'||!!bound)
  const requestedSlides=task.brief.match(/\b(\d{1,2})\s*slide\b/i)?.[1]
  const spec=structuredClone(revising?previous.payload.spec:engines.carouselTemplate(task.brandId,requestedSlides?Number(requestedSlides):undefined)) as Record<string,unknown>
  if(!revising&&spec._officeDesign)spec._officeDesign={...(spec._officeDesign as Record<string,unknown>),contextVersion:engines.context('content-creator',task.brandId,task.brief).version}
  if(!revising){delete spec.rubric;spec.verified_claims=[];spec.brief={problem:task.brief,angle:'Sesuai arahan pengguna',key_message:task.brief,cta:{type:'other'},sources:[],risks:['Draf perlu review manusia.'],references:[]}}
  const workspace=new ChatWorkspace(store)
  const selected=await workspace.input(task)
  const attachments=await Promise.all(selected.attachmentIds.map(id=>workspace.taskAttachment(task,id)))
  const images=attachments.filter((image):image is NonNullable<typeof image>=>!!image&&['image/png','image/jpeg','image/webp'].includes(image.mime)).map(image=>({id:image.id,name:image.name}))
  const imagePaths=imageSlots(spec)
  const imageInstructions=images.length? '\nBAHAN GAMBAR PESAN INI: '+JSON.stringify(images)+'\nSLOT GAMBAR TERSEDIA: '+JSON.stringify(imagePaths)+'\nTambahkan images:[{attachmentId,path}] pada JSON untuk memakai lampiran sesuai arahan pengguna. Setiap lampiran wajib dicatat: images untuk gambar yang dipakai, referenceIds:[attachmentId] untuk bahan yang hanya menjadi referensi. Untuk foto tutor/orang, gunakan slot foto yang sesuai dan pertahankan gambar asli; jangan mengarang wajah. Jangan mengganti foto tutor menjadi latar tanpa arahan. Jika hanya referensi gaya, gunakan referenceOnly:true. Bila arahan ambigu, gambar tidak dapat ditempatkan sesuai permintaan, atau slot yang diminta tidak tersedia, balas HANYA {"question":"Pertanyaan singkat dan spesifik"}. Jangan diam-diam menggunakan aset bawaan untuk gambar yang diminta pengguna. Gambar ini hanya untuk draf; jangan klaim izin publikasi atau simpan permanen tanpa permintaan.':''
  const composition=(!revising||/layout|komposisi|maskot|ikon|spasi|padding|ukuran|tata|hierarki|desain|ruang kosong/i.test(task.brief))&&!!spec._officeDesign
  const compositionInstructions=composition?'\nMODE KOMPOSISI KURASI WAJIB: kontrak edits di atas digantikan. Pada revisi, pertahankan isi, fakta, sumber dan bahan yang tidak diminta berubah, serta jumlah slide kecuali pengguna meminta jumlah baru. Balas JSON {"spec":{...spesifikasi lengkap...},"images":[...],"referenceIds":[...]}. Susun komposisi dan copy baru mengikuti patterns.md yang wajib; contoh di bawah adalah REFERENSI, bukan teks atau topik yang harus disalin. Boleh mengubah jumlah slide sesuai permintaan (3–10), memilih/mengatur ulang blok komposisi free dan layout yang sudah didemonstrasikan. Blok free mendukung k: title,text,card,big,bubble,pill,icon,mascot,scene,cta,bar,ring,photo,rows,grid,panel,tile,col,list,tip,step dengan x,y,w,h dalam persen 0–100; jangan melewati bidang slide. Teks dan komponen harus sesuai brief; jangan mewarisi topik, judul, ikon bertulisan produk/level yang tidak relevan. Gunakan hanya aset brand ini dan stock yang tersedia pada referensi. Pertahankan latar, logo, footer, font, dan identitas sesuai aturan wajib. Jangan menyatakan fakta atau sumber telah diverifikasi; verified_claims harus kosong dan rubric jangan diisi. Jangan menulis status tool seperti belum dirender/belum dapat ditinjau di brief.risks; sistem menjalankan render dan review setelah jawaban ini. risks hanya risiko fakta, editorial, dan izin. brief harus sesuai permintaan baru dengan struktur persis {problem:string,angle:string,key_message:string,audience?:string,cta:{type:"comment"|"link_bio"|"dm"|"save"|"other",keyword?:string},sources:[{claim:string,source:string,url?:string,check?:boolean}],risks:string[],references:string[]}. Setiap sumber harus memiliki claim dan source; jangan gunakan title/name sebagai pengganti. Bila sumber belum tersedia jangan membuat entri palsu; jelaskan kebutuhan verifikasi dalam risks. Jika komposisi tidak dapat dibuat, gunakan question. Jumlah slide yang diminta: '+(requestedSlides??'sesuai kebutuhan brief')+'\nREFERENSI DESAIN KURASI LENGKAP:\n'+JSON.stringify(spec)+'\nKONTRAK VALIDASI MESIN (definisi field dan enum; bukan kode yang dijalankan):\n'+engines.compositionContract():''
  const slots=carouselCopySlots(spec)
  return {spec,revising,composition,requestedSlides:requestedSlides?Number(requestedSlides):revising?(spec.slides as unknown[]).length:undefined,slots,images,imagePaths,chatTaskId:task.id,chatAssets:revising?previous?.payload.chatAssets??[]:[],assetBindings:revising?previous?.payload.assetBindings??[]:[],sourceTaskId:revising?previous?.task_id:undefined,instructions:`\n\nTOOL PRODUKSI CAROUSEL AKTIF: pengguna meminta berkas carousel jadi. Backend akan merender setelah Anda menyusun copy, bukan sekadar memberikan naskah. ${revising?'Revisi versi sumber carousel yang terikat pada pesan ini; ubah hanya bagian yang diminta.':'Gunakan dasar desain brand yang sudah tersedia; ganti SEMUA slot teks lama dengan konten baru yang sesuai brief. Jangan membawa klaim, angka produk, harga, atau janji hasil dari contoh lama.'}\nBalas HANYA JSON valid berbentuk {"edits":[{"path":"slides.0.headline","value":"Teks baru"},...]} tanpa Markdown atau pembungkus file. Path harus dari daftar slot berikut. ${revising?'Slot yang tidak diubah boleh dihilangkan.':'Setiap slot wajib muncul tepat sekali, termasuk caption.'} Pertahankan highlight ** bila membantu. Jangan melampaui maxChars pada slot visual; tulis pendek agar muat. Susun copy yang utuh dan proporsional. Jangan menyebut render sudah selesai, membuat skor QA sendiri, atau mengklaim sumber telah diverifikasi. Jumlah slide mengikuti dasar desain (${(spec.slides as unknown[]).length}); jika pengguna meminta jumlah lain, sesuaikan melalui diskusi, jangan mengklaim jumlah yang berbeda.\nSLOT DESAIN:\n${JSON.stringify(slots)}${imageInstructions}${compositionInstructions}`}
}
export function applyCarouselCopy(plan:Pick<Awaited<ReturnType<typeof carouselChatPlan>>,'spec'|'slots'|'revising'> & {composition?:boolean;requestedSlides?:number},output:string){
  const raw=JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')) as {edits?:Array<{path:string;value:string}>}
  if(plan.composition){
    const full=(raw as unknown as {spec?:Record<string,unknown>}).spec
    if(!full||full.brand!==plan.spec.brand||!Array.isArray(full.slides)||full.slides.length<3||full.slides.length>10||(plan.requestedSlides&&full.slides.length!==plan.requestedSlides))throw new Error('Komposisi baru belum sesuai brand atau jumlah slide yang diminta.')
    if(plan.spec.background&&!full.background)throw new Error('Komposisi baru menghilangkan latar foto referensi brand. Perbaiki sesuai aturan visual wajib.')
    const brand=Object.keys({otca:1,infojerman:1,ciaomanda:1,jepangkoey:1}).find(b=>({otca:'otca',infojerman:'info-jerman',ciaomanda:'ciao-manda',jepangkoey:'jepang-koey'} as Record<string,string>)[b]===full.brand)!
    const spec:Record<string,unknown>={...full,verified_claims:[],_officeDesign:plan.spec._officeDesign};delete spec.rubric
    const brief=spec.brief as Record<string,unknown>|undefined
    if(brief&&Array.isArray(brief.sources))brief.sources=brief.sources.map(source=>source&&typeof source==='object'?{...source,check:true}:source)
    validateProductionRequest('content-creator',brand,{title:'Komposisi dari chat',brief:'Draf untuk review manusia',spec})
    return spec
  }
  if(!Array.isArray(raw.edits)||!raw.edits.length||raw.edits.length>200)throw new Error('Agent belum memberikan perubahan teks carousel yang valid.')
  const spec=structuredClone(plan.spec),seen=new Set<string>()
  for(const item of raw.edits){
    const slot=plan.slots.find(slot=>slot.path===item.path)
    if(!slot||seen.has(item.path)||typeof item.value!=='string'||!item.value.trim()||item.value.length>Math.max(slot.maxChars*2,100))throw new Error('Perubahan teks carousel tidak sesuai kontrak desain.')
    if(item.path.endsWith('.label')&&item.value.length>slot.maxChars)throw new Error('Label carousel terlalu panjang untuk kolom desain.')
    seen.add(item.path)
    const parts=item.path.split('.');let target=spec as Record<string,unknown>
    for(const part of parts.slice(0,-1))target=target[part] as Record<string,unknown>
    target[parts.at(-1)!]=item.value
  }
  if(!plan.revising&&plan.slots.some(slot=>!seen.has(slot.path)))throw new Error('Copy carousel belum lengkap; ada teks contoh yang belum diganti.')
  return spec
}
export function carouselImageChoices(plan:Pick<Awaited<ReturnType<typeof carouselChatPlan>>,'images'|'imagePaths'|'chatTaskId'|'chatAssets'|'assetBindings'>,output:string){
 const raw=JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))
 if(typeof raw.question==='string'&&raw.question.trim())return {question:raw.question.trim().slice(0,1500),chatAssets:[],assetBindings:[]}
 const pathsAvailable=raw.spec&&typeof raw.spec==='object'?imageSlots(raw.spec):plan.imagePaths
 const selected=raw.images??[]
 if(!Array.isArray(selected)||selected.length>10)throw new Error('Pilihan gambar tidak valid.')
 if(selected.some(item=>!item||!plan.images.some((image:{id:string})=>image.id===item.attachmentId)||!pathsAvailable.includes(item.path)))throw new Error('Agent memilih gambar atau slot yang tidak tersedia pada pesan ini.')
 if(plan.images.length&&!selected.length&&raw.referenceOnly!==true)return {question:'Gambar lampiran ini ingin digunakan sebagai latar, foto utama, atau referensi gaya? Sebutkan juga slide tujuannya.',chatAssets:[],assetBindings:[]}
 const refs=raw.referenceIds??[]
 if(!Array.isArray(refs)||refs.some((id:unknown)=>!plan.images.some((image:{id:string})=>image.id===id)))throw new Error('Referensi gambar tidak tersedia.')
 const accounted=new Set([...selected.map((item:{attachmentId:string})=>item.attachmentId),...refs])
 if(plan.images.some((image:{id:string})=>!accounted.has(image.id))&&raw.referenceOnly!==true)return {question:'Saya perlu memastikan fungsi setiap gambar. Sebutkan gambar mana untuk desain dan mana yang hanya menjadi referensi, beserta slide tujuannya.',chatAssets:[],assetBindings:[]}
 const paths=new Set<string>()
 const mapped:ChatImageBinding[]=selected.map((item:{attachmentId:string;path:string})=>{
  if(!plan.images.some((image:{id:string})=>image.id===item.attachmentId)||!plan.imagePaths.includes(item.path)||paths.has(item.path))throw new Error('Agent memilih gambar atau slot yang tidak tersedia pada pesan ini.')
  paths.add(item.path);return {attachmentId:item.attachmentId,path:item.path,chatTaskId:plan.chatTaskId}
 })
 return {question:undefined,chatAssets:[...plan.chatAssets.filter((b:ChatImageBinding)=>!paths.has(b.path)),...mapped],assetBindings:plan.assetBindings.filter((b:{path:string})=>!paths.has(b.path))}
}
export async function dispatchCarouselChat(store:OfficeStore,task:Task,spec:Record<string,unknown>,result:RunResult,usage:{source:'codex'|'litellm';model:string;durationMs:number},sourceTaskId?:string,assetBindings:Array<{assetId:string;path:string}>=[],chatAssets:ChatImageBinding[]=[]){
  const payload=validateProductionRequest('content-creator',task.brandId,{title:task.brief.slice(0,160),brief:task.brief,spec,assetBindings,chatAssets})
  return transaction(store.db,async tx=>{
    await tx.query('SELECT id FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[task.brandId,task.id])
    const parent=await store.task(task.brandId,task.id,tx)
    if(parent?.status!=='running')throw new Error('Permintaan chat sudah dihentikan.')
    if(task.kind==='konten.carousel-produksi'){
      const manager=task.parentId?await store.task(task.brandId,task.parentId,tx):undefined
      if(manager?.kind!=='konten.orchestrasi'||manager.status==='cancelled')throw new Error('Workflow Manager tidak tersedia untuk produksi ini.')
      const existing=(await tx.query('SELECT task_id FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[task.brandId,task.id])).rows[0]
      if(!existing){
        await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,task.brandId,task.agentType,JSON.stringify(payload)])
        await registerProductionVersion(tx,task.brandId,task.agentType,task.id,payload.title,sourceTaskId)
      }
      else await tx.query("UPDATE production_jobs SET payload=$3,stage='queued',report='{}',updated_at=now() WHERE brand_id=$1 AND task_id=$2",[task.brandId,task.id,JSON.stringify(payload)])
      await tx.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,task.brandId,usage.source,usage.model,result.inputTokens,result.outputTokens,usage.durationMs])
      await store.logEvent(tx,task,'delegated_production_dispatched',{runId:result.runId,tool:'carousel-render'})
      return store.transition(task.brandId,task.id,'queued',{actor:'agent:content-creator',reason:'Spesifikasi siap; menunggu render dan QA',patch:{attempts:0,result:'Spesifikasi siap. Menunggu render carousel dan pemeriksaan QA.'}},tx)
    }
    const existing=(await tx.query("SELECT id FROM tasks WHERE brand_id=$1 AND parent_id=$2 AND kind='konten.produksi'",[task.brandId,task.id])).rows[0]
    if(existing)return (await store.task(task.brandId,existing.id,tx))!
    const child=await store.createTask(task.brandId,{agentType:'content-creator',kind:'konten.produksi',title:payload.title,brief:payload.brief,parentId:task.id,createdBy:'agent:content-creator'},tx)
    await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[child.id,task.brandId,task.agentType,JSON.stringify(payload)])
    await registerProductionVersion(tx,task.brandId,task.agentType,child.id,String(spec.slides instanceof Array?(spec.slides[0] as {headline?:string})?.headline??payload.title:payload.title),sourceTaskId)
    await tx.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,task.brandId,usage.source,usage.model,result.inputTokens,result.outputTokens,usage.durationMs])
    if(sourceTaskId)await store.logEvent(tx,child,'carousel_source',{sourceTaskId})
    await store.logEvent(tx,task,'chat_production_dispatched',{taskId:child.id,runId:result.runId,tool:'carousel-render'})
    await tx.query("UPDATE tasks SET result='Copy selesai. Sedang menyiapkan gambar carousel dan memeriksa QA…' WHERE brand_id=$1 AND id=$2",[task.brandId,task.id])
    return child
  })
}
