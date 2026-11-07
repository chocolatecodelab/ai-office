import {adaptiveQuotaWait} from './quota-recovery.js'
import type {VideoSource} from './video-attachments.js'
import {renderedCheckpoint} from './render-checkpoint.js'
import {limitFromError} from './provider-limit.js'
import { parseVisualReview,visualSlideImages } from './production-visual-review.js'
import { productionMaterials,chatMaterials } from './production-materials.js'
import type { RunnerDeps, RunOutcome } from './runner.js'
import type { Task } from './store.js'
import { ProductionQaError, type ProductionResult } from './production-engines.js'
import { applyCarouselCopy, carouselCopySlots } from './chat-production.js'
import { routeFor } from './model-routes.js'
import { agentInstructions } from './prompts.js'

export async function runProductionJob(deps:RunnerDeps,task:Task):Promise<RunOutcome>{
  const {store,production}=deps
  const job=(await store.db.query('SELECT * FROM production_jobs WHERE brand_id=$1 AND task_id=$2 AND agent_type=$3',[task.brandId,task.id,task.agentType])).rows[0]
  await store.transition(task.brandId,task.id,'running',{actor:'worker:production',patch:{attempts:task.attempts+1,started_at:new Date().toISOString()}})
  if(!production||!job){await store.transition(task.brandId,task.id,'failed',{actor:'worker:production',patch:{error:'Konfigurasi atau permintaan produksi tidak ditemukan.'}});return {next:'none'}}
  // Video engine and content renderer share CPU/GPU; serialize all local production runs.
  const client=await store.db.connect()
  let locked=false
  const abort=new AbortController()
  let checking=false
  const monitor=setInterval(()=>{if(checking)return;checking=true;void Promise.all([store.task(task.brandId,task.id),store.isPaused(task.brandId,task.agentType),task.parentId?store.task(task.brandId,task.parentId):undefined]).then(([latest,paused,parent])=>{if(latest?.status==='cancelled'||paused||parent?.status==='cancelled')abort.abort()}).finally(()=>{checking=false}).catch(()=>abort.abort())},1500)
  try{
    if(task.status==='revision')throw new Error('Perbarui spesifikasi dalam tugas produksi baru sesuai catatan reviewer; input lama tidak dirender ulang otomatis.')
    locked=(await client.query('SELECT pg_try_advisory_lock(7234017) AS locked')).rows[0].locked
    if(!locked){await store.transition(task.brandId,task.id,'queued',{actor:'worker:production',reason:'menunggu mesin produksi lokal',patch:{attempts:task.attempts}});return {next:'retry',delayMs:15000}}
    await store.db.query("UPDATE production_jobs SET stage='running',updated_at=now() WHERE brand_id=$1 AND task_id=$2",[task.brandId,task.id])
    let result:ProductionResult|undefined
    let payload=job.payload
    const visualHistory:Array<ReturnType<typeof parseVisualReview>>=[]
    let technicalRepairs=0,visualRepairs=0
    for(let repair=0;repair<=4;repair++){
      try{
        const sources:VideoSource[]=[]
        for(const source of payload.video?.sources??[]){
          if(!deps.videoAttachments)throw new Error('Pustaka footage belum tersedia.')
          sources.push(await deps.videoAttachments.material(task.brandId,source.taskId,source.attachmentId))
        }
        const materials=[...await productionMaterials(store,task.brandId,payload.assetBindings??[]),...await chatMaterials(store,task.brandId,payload.chatAssets??[])]
        result=await renderedCheckpoint(store,task,{payload,version:production.context(task.agentType,task.brandId,task.brief).version,materials:materials.map(m=>m.sha256),sources:sources.map(s=>s.sha256)},()=>production.run(task.agentType,task.brandId,task.id,(task.attempts+1)*10+repair,payload,abort.signal,materials,sources))
        if(task.parentId&&payload.spec?._officeDesign){
          const parent=await store.task(task.brandId,task.kind==='konten.carousel-produksi'?task.id:task.parentId),endpoint=deps.endpoint(task.brandId)
          if(!parent||!endpoint)throw new Error('Reviewer visual tidak tersedia.')
          const route=routeFor({...parent,complex:true},deps.profile,(await store.routeOverrides()).get(parent.agentType))
          const reference=await production.visualReferences(task.brandId)
          const images=await visualSlideImages(result.files)
          const started=Date.now()
          await store.db.query('UPDATE tasks SET result=$3,updated_at=now() WHERE brand_id=$1 AND id=$2',[task.brandId,parent.id,'Gambar sudah dirender. Sedang meninjau hierarki, keterbacaan, dan komposisi terhadap referensi brand…'])
          await store.logEvent(store.db,parent,'carousel_visual_review',{round:repair+1,reference:reference.path,referenceSha256:reference.sha256})
          const review=await deps.hermes.run(endpoint,{model:route.model,provider:route.provider,reasoningEffort:'high',sessionId:`visual-review-${task.id}-${task.attempts}-${repair}`,images:[reference.image,...images],instructions:'Anda reviewer visual carousel. Gambar pertama adalah referensi kurasi, gambar berikutnya hasil render urut slide 1 dst. Bandingkan skala headline/body, keterbacaan pada ukuran feed, hierarki, kepadatan isi, penggunaan ikon/maskot, margin, padding, rongga kosong, dan variasi komposisi. Periksa transisi foto ke hitam sampai kedua tepi, skala dan posisi maskot, serta susunan panel sesuai fungsi slide. Tandai blocking bila overlay membentuk persegi gelap atau komposisi bertentangan dengan aturan kurasi. Nilai kesetaraan kualitas visual terhadap referensi, bukan kemiripan topik. Jangan menerima slide yang jauh lebih kecil teksnya, generik, terlalu kosong, atau maskot/ikon tidak relevan. Temuan blocking wajib spesifik ke slide dan perubahan yang dapat dilakukan pada spec; saran selera ringan gunakan suggestion. Jangan mengarang sumber, hasil ukur pixel, skor manusia, atau persetujuan publikasi. Balas hanya JSON {"summary":"...","issues":[{"slide":1,"severity":"blocking|suggestion","message":"..."}]}. Tidak ada masalah: issues kosong.',input:'Brief pengguna: '+parent.brief+'\nAturan brand:\n'+production.context(task.agentType,task.brandId,parent.brief).text+'\nSpec saat ini:\n'+JSON.stringify(payload.spec)},`${task.id}:visual:${task.attempts}:${repair}`)
          await store.db.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[parent.id,task.brandId,route.source,route.model??review.model,review.inputTokens,review.outputTokens,Date.now()-started])
          if(review.status!=='completed')throw new Error('Tinjauan visual belum berhasil. Tidak dianggap lulus.')
          const assessment=parseVisualReview(review.output);visualHistory.push(assessment)
          if(abort.signal.aborted)throw new Error('Tugas dihentikan saat peninjauan visual.')
          if(!assessment.passed&&visualRepairs<2)throw new ProductionQaError(assessment.issues.filter(i=>i.severity==='blocking').map(i=>({slide:i.slide,code:'VISUAL_REVIEW',message:i.message})))
          result.report.visualReview={...assessment,rounds:visualHistory.length,reference:reference.path,referenceSha256:reference.sha256}
          if(!assessment.passed){result.report.status='PERLU_REVISI_VISUAL';result.content+='\nTinjauan visual AI masih menemukan masalah. Draf ini perlu revisi dan review manusia.'}
          result.files.push({name:'visual-review.json',mime:'application/json',data:Buffer.from(JSON.stringify({assessment:'AI, bukan keputusan manusia',reference:{path:reference.path,sha256:reference.sha256},rounds:visualHistory},null,2))})
          result.report.files=result.files.map(f=>f.name)
        }
        break
      }
      catch(error){
        if(!(error instanceof ProductionQaError)||!task.parentId)throw error
        const visualFailure=error.issues.some(i=>i.code==='VISUAL_REVIEW')
        if(visualFailure){if(visualRepairs>=2)throw error;visualRepairs++}
        else{if(technicalRepairs>=2)throw error;technicalRepairs++}
        const parent=await store.task(task.brandId,task.kind==='konten.carousel-produksi'?task.id:task.parentId),endpoint=deps.endpoint(task.brandId)
        if(!parent||!['konten.chat','konten.carousel-produksi'].includes(parent.kind)||parent.status!=='running'||!endpoint||abort.signal.aborted)throw error
        const route=routeFor(parent,deps.profile,(await store.routeOverrides()).get(parent.agentType))
        const slots=carouselCopySlots(payload.spec)
        const compositionRepair=!!payload.spec._officeDesign
        const repairInstructions=compositionRepair?'\nKONTRAK KOMPOSISI: instruksi edits di atas diganti. Balas hanya JSON {"spec":{...spesifikasi lengkap yang diperbaiki...}}. Perbaiki copy atau posisi/ukuran blok penyebab QA, pertahankan jumlah slide, makna, aset dan semua path slot gambar. Jangan mengisi verified_claims/rubric. Jangan memasukkan status proses seperti belum dirender atau belum bisa ditinjau ke brief.risks; sistem menjalankan render dan review setelah perbaikan ini. Jangan menghapus unsur brand wajib atau melewati QA.\nATURAN WAJIB:\n'+production.context(task.agentType,task.brandId,parent.brief).text+'\nKONTRAK MESIN WAJIB, jangan mengarang enum/field:\n'+production.compositionContract():''
        await store.logEvent(store.db,parent,'carousel_qa_repair',{attempt:repair+1,phase:visualFailure?'visual':'technical',issues:error.issues})
        await store.db.query('UPDATE tasks SET result=$3,updated_at=now() WHERE brand_id=$1 AND id=$2',[task.brandId,parent.id,'Gambar sedang diperbaiki berdasarkan pemeriksaan QA desain…'])
        const start=Date.now()
        const answer=await deps.hermes.run(endpoint,{model:route.model,provider:route.provider,reasoningEffort:compositionRepair?'high':route.reasoningEffort,sessionId:`carousel-repair-${task.id}-${task.attempts}-${repair}`,instructions:agentInstructions(deps.contextDir,parent.agentType,task.brandId,await deps.brandName(task.brandId))+'\nTOOL PERBAIKAN COPY: balas hanya JSON {"edits":[{"path":"slides.1.blocks.0.t","value":"Teks"}]}. Perbaiki hanya teks pada slide yang gagal QA. Pertahankan makna brief dan teks lain. Pendekkan agar muat, label wajib <= maxChars (gunakan angka singkat bila kolom sempit). Jangan mengubah layout, aset, atau melewati QA.'+repairInstructions,input:`Brief: ${parent.brief}\nQA: ${JSON.stringify(error.issues)}\nSlot copy: ${JSON.stringify(slots)}${compositionRepair?'\nSPEC SAAT INI:\n'+JSON.stringify(payload.spec):''}`},`${task.id}:repair:${task.attempts}:${repair}`)
        await store.db.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[parent.id,task.brandId,route.source,route.model??answer.model,answer.inputTokens,answer.outputTokens,Date.now()-start])
        if(answer.status!=='completed')throw new Error('Agent belum berhasil memperbaiki copy setelah QA.')
        const spec=applyCarouselCopy({spec:payload.spec,slots,revising:true,composition:compositionRepair,requestedSlides:payload.spec.slides.length},answer.output)
        payload={...payload,spec}
        await store.db.query('UPDATE production_jobs SET payload=$3,updated_at=now() WHERE brand_id=$1 AND task_id=$2',[task.brandId,task.id,JSON.stringify(payload)])
      }
    }
    if(!result)throw new Error('Pipeline tidak menghasilkan berkas.')
    await productionMaterials(store,task.brandId,payload.assetBindings??[])
    await chatMaterials(store,task.brandId,payload.chatAssets??[])
    for(const source of payload.video?.sources??[]){
      if(!deps.videoAttachments)throw new Error('Pustaka footage belum tersedia.')
      await deps.videoAttachments.material(task.brandId,source.taskId,source.attachmentId)
    }
    await store.submitProduction(task.brandId,task.id,result)
    return {next:'none'}
  }catch(error){
    let limit=limitFromError(error)
    if(limit&&(await store.task(task.brandId,task.id))?.status==='running'){
      limit=await adaptiveQuotaWait(store,task,limit)
      await store.transition(task.brandId,task.id,'waiting_quota',{actor:'worker:production',reason:'review menunggu kuota provider',patch:{error:(error instanceof Error?error.message:String(error))+' · '+(limit.timingSource==='provider'?'Jadwal dari provider.':'Waktu reset tidak tersedia; menunggu pemeriksaan ulang.'),retry_at:limit.retryAt,attempts:task.attempts}})
      await store.db.query("UPDATE production_jobs SET stage='waiting_quota',updated_at=now() WHERE brand_id=$1 AND task_id=$2",[task.brandId,task.id])
      await store.logEvent(store.db,task,'quota_wait',{...limit,stage:'production-review'})
      return {next:'retry',delayMs:Math.max(1000,Date.parse(limit.retryAt)-Date.now())}
    }
    if(error instanceof SyntaxError||(error instanceof Error&&error.name==='ZodError'))await deps.hermes.invalidateLastCompleted?.()
    const current=await store.task(task.brandId,task.id)
    if(current?.status==='running')await store.transition(task.brandId,task.id,await store.isPaused(task.brandId,task.agentType)?'paused':'failed',{actor:'worker:production',patch:{error:error instanceof Error?error.message:String(error)}})
    if(task.parentId){const parent=await store.task(task.brandId,task.parentId);if(parent?.kind==='konten.chat'&&parent.status==='running')await store.transition(task.brandId,parent.id,'failed',{actor:'worker:production',patch:{error:`Produksi belum berhasil: ${error instanceof Error?error.message:String(error)}`}})}
    await store.db.query("UPDATE production_jobs SET stage='stopped',updated_at=now() WHERE brand_id=$1 AND task_id=$2",[task.brandId,task.id])
    return {next:'none'}
  }finally{clearInterval(monitor);if(locked)await client.query('SELECT pg_advisory_unlock(7234017)').catch(()=>undefined);client.release()}
}
