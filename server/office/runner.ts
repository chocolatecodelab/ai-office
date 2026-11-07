import {adaptiveQuotaWait} from './quota-recovery.js'
import {checkpointHermes} from './task-checkpoints.js'
import {quotaInfo,limitFromError,type LimitInfo} from './provider-limit.js'
import {videoIntent,videoIntentInstructions} from './video-intent.js'
import {wantsFinalVideoRender} from './custom-motion.js'
import {wantsVideoRevision,videoRevisionInstructions,wantsPreviewRefresh} from './video-revision.js'
import { activeVideoProject,wantsThumbnailRevision,thumbnailInstructions,executeThumbnailRevision,VideoSourceChoiceRequired } from './thumbnail-chat.js'
import { ProductionSourceChoiceRequired } from './production-projects.js'
import { privateResearchClient } from './research-privacy.js'
import type { ProductionEngines } from './production-engines.js'
import { runProductionJob } from './production-worker.js'
import { carouselImageChoices,applyCarouselCopy,carouselChatPlan,dispatchCarouselChat,wantsCarousel } from './chat-production.js'
import { agentContextFiles } from '../otca-context.js'
import { selectOfficialContext,boundedHistory } from './context-policy.js'
import type { HermesEndpoint } from '../settings.js'
import { HermesError, type HermesClient } from './hermes-client.js'
import { routeFor, type EngineProfile } from './model-routes.js'
import { notesPrompt } from './agent-notes.js'
import { agentInstructions, taskInput } from './prompts.js'
import { RUNNABLE } from './status.js'
import type { OfficeStore,Task } from './store.js'
import { dependencyApproved,dependencyTasks,readyChildren,orchestrationState, parseManagerPlan, persistManagerPlan, planningInstructions } from './orchestration.js'
import { dependencyContext } from './dependency-context.js'
import type { DocumentRuntime } from './document-processing.js'
import type { ChatWorkspace } from './chat-workspace.js'
import { compactChat } from './chat-memory.js'
import { wantsVideoPlan,parseVideoPlan,videoPlanInstructions } from './video-plan.js'
import { dispatchVideoPlan } from './chat-video-production.js'
import type { VideoAttachments } from './video-attachments.js'

// Runs one task on its brand's Hermes and maps the outcome onto the task status machine:
// done → waiting_approval (a chat reply finishes as done); Codex quota used up → waiting_quota until the reset; other failures are
// retried twice (FR-13) before the task is marked failed.

export const MAX_ATTEMPTS = 3 // the first try plus 2 retries
export const QUOTA_WAIT_MS = 30 * 60 * 1000
const RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000]

/** What the queue does next with the task. */
export type RunOutcome =
  | { next: 'none' }
  | { next: 'retry'; delayMs: number; children?: Array<{brandId:string;id:string;priority:number}> }

export interface RunnerDeps {
  videoAttachments?:VideoAttachments
  production?: ProductionEngines
  chat?: ChatWorkspace
  store: OfficeStore
  hermes: HermesClient
  endpoint(brandId: string): HermesEndpoint | undefined
  contextDir: string
  brandName(brandId: string): Promise<string>
  /** Which model table to use (model-routes.ts); dev runs everything on Codex. */
  profile?: EngineProfile
}

export async function runTask(deps: RunnerDeps, brandId: string, taskId: string): Promise<RunOutcome> {
  const task=await deps.store.task(brandId,taskId)
  if(!task || !deps.store.db)return runTaskOnce(deps,brandId,taskId)
  // Queue retries/recovery can overlap for parent and child tasks. One lease spans each whole run.
  const client=await deps.store.db.connect()
  const key=`task:${brandId}:${taskId}`
  let locked=false
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked
    if(!locked)return {next:'retry',delayMs:15000}
    return await runTaskOnce({...deps,hermes:task.kind==='konten.riset'?deps.hermes:checkpointHermes(deps.store,task,deps.hermes)},brandId,taskId)
  } finally {
    if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined)
    client.release()
  }
}

async function runTaskOnce(deps: RunnerDeps, brandId: string, taskId: string): Promise<RunOutcome> {
  const { store } = deps
  const task = await store.task(brandId, taskId)
  if (!task || !RUNNABLE.includes(task.status)) return { next: 'none' }
  if (await store.isPaused(brandId, task.agentType)) {
    await store.transition(brandId, taskId, 'paused', { actor: 'sistem', reason: 'kill switch aktif' })
    return { next: 'none' }
  }
  if(task.status==='waiting_quota'&&task.retryAt&&Date.parse(task.retryAt)>Date.now())return {next:'retry',delayMs:Date.parse(task.retryAt)-Date.now()}
  if(['konten.produksi','video.proyek'].includes(task.kind))return runProductionJob(deps,task)
  if(task.kind==='konten.carousel-produksi'&&task.status!=='revision'&&(await store.db.query('SELECT task_id FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[brandId,taskId])).rows[0])return runProductionJob(deps,task)
  if(task.kind==='video.rencana-produksi'&&task.status!=='revision'&&(await store.db.query('SELECT task_id FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[brandId,taskId])).rows[0])return runProductionJob(deps,task)
  if(task.kind==='konten.chat'&&['content-creator','video-editor'].includes(task.agentType)){
    const child=(await store.db.query("SELECT id FROM tasks WHERE brand_id=$1 AND parent_id=$2 AND kind IN ('konten.produksi','video.proyek') ORDER BY created_at LIMIT 1",[brandId,taskId])).rows[0]
    if(child){
      const production=await store.task(brandId,child.id)
      if(production){
        await store.transition(brandId,taskId,'running',{actor:'worker:production',reason:'melanjutkan produksi dari chat'})
        if(['waiting_approval','approved','done'].includes(production.status))await store.completeProductionChat(brandId,taskId,production.id)
        else if(production.status==='failed'){
          await store.transition(brandId,production.id,'queued',{actor:'worker:production',reason:'Pengguna mencoba ulang produksi dari chat'})
          return {next:'retry',delayMs:15000,children:[{brandId,id:production.id,priority:production.priority}]}
        }
        else if(production.status==='cancelled')await store.transition(brandId,taskId,'failed',{actor:'worker:production',patch:{error:'Produksi telah dibatalkan. Buat permintaan baru untuk melanjutkan.'}})
        else return {next:'retry',delayMs:15000,children:[{brandId,id:production.id,priority:production.priority}]}
        return {next:'none'}
      }
    }
  }
  let predecessors:Task[]=[]
  if(task.parentId) {
    const parent=await store.task(brandId,task.parentId)
    if(parent?.kind==='konten.orchestrasi' && parent.status==='cancelled') {
      await store.transition(brandId,taskId,'cancelled',{actor:'sistem',reason:'Tugas Manager dibatalkan'})
      return {next:'none'}
    }
    if(parent?.kind==='konten.orchestrasi'){
      const state=await orchestrationState(store,parent)
      if(!state)throw new Error('Rencana Manager untuk tugas ini tidak ditemukan.')
      predecessors=dependencyTasks(state,task)
      if(!predecessors.every(dependencyApproved))return parent.status==='failed'?{next:'none'}:{next:'retry',delayMs:15000}
    }
  }
  const orchestrating=task.agentType==='manager' && task.kind==='konten.orchestrasi'
  const orchestration=orchestrating ? await orchestrationState(store,task) : undefined
  if(orchestration) {
    const blocked=orchestration.children.filter(child=>['failed','cancelled'].includes(child.status))
    if(blocked.length) {
      await store.transition(brandId,taskId,'running',{actor:'agent:manager'})
      await store.transition(brandId,taskId,'failed',{actor:'agent:manager',reason:'Delegasi memerlukan penanganan',patch:{error:`Periksa tugas spesialis: ${blocked.map(c=>c.title).join(', ')}. Pulihkan tugas tersebut sebelum mencoba ulang Manager.`}})
      return {next:'none'}
    }
    if(!orchestration.children.length || orchestration.children.some(child=>!['approved','done'].includes(child.status))) {
      return {next:'retry',delayMs:15000,children:readyChildren(orchestration)}
    }
  }
  const endpoint = deps.endpoint(brandId)
  if (!endpoint) {
    await store.transition(brandId, taskId, 'running', { actor: 'sistem' })
    await store.transition(brandId, taskId, 'failed', { actor: 'sistem', reason: 'Hermes brand belum dikonfigurasi', patch: { error: `Container Hermes untuk brand ${brandId} belum dikonfigurasi.` } })
    return { next: 'none' }
  }

  const attempt = task.attempts + 1
  const running = await store.transition(brandId, taskId, 'running', { actor: `agent:${task.agentType}`, reason: `percobaan ${attempt}`, patch: { attempts: attempt, started_at: new Date().toISOString(), retry_at: null } })
  const route = routeFor(task, deps.profile, (await store.routeOverrides()).get(task.agentType))
  const fail = async (message: string, quota: boolean,limit?:LimitInfo): Promise<RunOutcome> => {
    if (quota) {
      limit=await adaptiveQuotaWait(store,task,limit??{retryAt:new Date(Date.now()+QUOTA_WAIT_MS).toISOString(),timingSource:'fallback',reason:message})
      const retryAt = new Date(limit?.retryAt??Date.now()+QUOTA_WAIT_MS)
      const delayMs=Math.max(1000,retryAt.getTime()-Date.now())
      // A quota wait is not the task's fault, so it does not use up a retry.
      await store.transition(brandId, taskId, 'waiting_quota', { actor: 'sistem', reason: 'provider membatasi pemakaian', patch: { error: message+(limit?.timingSource==='provider'?' · Waktu retry dari provider.':' · Waktu reset tidak tersedia; pemeriksaan pemulihan otomatis dengan jeda adaptif.'), retry_at: retryAt.toISOString(), attempts: task.attempts } })
      await store.logEvent(store.db,task,'quota_wait',{retryAt:retryAt.toISOString(),timingSource:limit?.timingSource??'fallback',provider:route.provider??route.source})
      return { next: 'retry', delayMs }
    }
    if (attempt < MAX_ATTEMPTS) {
      await store.transition(brandId, taskId, 'queued', { actor: 'sistem', reason: `gagal, dicoba lagi (${attempt}/${MAX_ATTEMPTS})`, patch: { error: message } })
      return { next: 'retry', delayMs: RETRY_BACKOFF_MS[attempt] ?? 5 * 60_000 }
    }
    await store.transition(brandId, taskId, 'failed', { actor: 'sistem', reason: `gagal ${MAX_ATTEMPTS} kali`, patch: { error: message } })
    return { next: 'none' }
  }

  try {
    if(task.agentType==='video-editor'&&task.kind==='konten.chat'&&wantsFinalVideoRender(task.brief)){
      const source=await activeVideoProject(store,task)
      try{
        if(!source||!deps.production)throw new Error('Belum ada preview proyek aktif untuk dirender.')
        await executeThumbnailRevision(deps,task,source,'{}','render')
      }catch(error){if((await store.task(brandId,taskId))?.status!=='cancelled'){const paused=await store.isPaused(brandId,task.agentType);await store.transition(brandId,taskId,paused?'paused':'failed',{actor:'worker:production',patch:{error:error instanceof Error?error.message:String(error)}})}}
      return {next:'none'}
    }
    if(task.agentType==='video-editor'&&task.kind==='konten.chat'&&wantsPreviewRefresh(task.brief)){
      const source=await activeVideoProject(store,task)
      if(!source||!deps.production)throw new Error('Proyek preview aktif belum tersedia.')
      const current=await deps.production.videoRevisionContext(brandId,source.project)
      await executeThumbnailRevision(deps,task,source,JSON.stringify({edits:[{type:'heading',scene:1,lines:current.props.scenes[0].heading}]}),'video')
      return {next:'none'}
    }
    const hermesRaw=task.agentType==='content-creator' && task.kind==='konten.riset' ? privateResearchClient(deps.hermes,async counts=>{await store.db.query('INSERT INTO task_events(task_id,brand_id,type,payload) VALUES($1,$2,$3,$4)',[task.id,brandId,'research_privacy',JSON.stringify({policy:'direct-identifiers-v1',counts,scope:'text-only',manualReviewRequired:true})])}) : deps.hermes
    const hermes=task.kind==='konten.riset'?checkpointHermes(store,task,hermesRaw):hermesRaw
    const contextRuntime:DocumentRuntime={run:async(request,key)=>{const started=Date.now();const result=await hermes.run(endpoint,{...request,model:route.model,provider:route.provider,reasoningEffort:'low'},key);await store.db.query('INSERT INTO cost_events (task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',[task.id,brandId,route.source,route.model??result.model,result.inputTokens,result.outputTokens,Date.now()-started]);return result}}
    const chatContext=deps.chat ? await deps.chat.prepare(task,contextRuntime) : undefined
    const dependencies=await dependencyContext(store,task,orchestration?.children??predecessors,contextRuntime)
    const contextFiles=agentContextFiles(deps.contextDir,task.agentType,brandId)??[]
    const selectedContext=selectOfficialContext(contextFiles,task.agentType,task.brief,task.kind==='konten.chat')
    const additionalNotes=chatContext?.notesText??notesPrompt(await store.notesFor(brandId,task.agentType))
    let instructions = agentInstructions(deps.contextDir, task.agentType, brandId, await deps.brandName(brandId), task.kind === 'konten.chat','',task.brief)
    const continuation=task.kind==='konten.chat'&&task.agentType==='content-creator'?(await store.db.query("SELECT payload->>'brief' AS brief FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='carousel_continuation' ORDER BY id DESC LIMIT 1",[brandId,task.id])).rows[0]?.brief:undefined
    const productionTask=continuation?{...task,brief:continuation+'\nArahan terbaru: '+task.brief}:task
    if(task.kind==='konten.carousel-produksi'&&!deps.production)throw new Error('Mesin produksi carousel belum tersedia untuk delegasi Manager.')
    const carouselPlan=deps.production&&task.agentType==='content-creator'&&((task.kind==='konten.chat'&&wantsCarousel(productionTask.brief))||task.kind==='konten.carousel-produksi')?await carouselChatPlan(store,deps.production,productionTask):undefined
    let videoProject:Awaited<ReturnType<typeof activeVideoProject>>=undefined,sourceChoice:VideoSourceChoiceRequired|undefined
    if(task.agentType==='video-editor'&&task.kind==='konten.chat'){
      try{videoProject=await activeVideoProject(store,task)}catch(error){if(!(error instanceof VideoSourceChoiceRequired))throw error;sourceChoice=error}
    }
    let interpreted:'thumbnail'|'video'|'answer'='answer'
    if((videoProject||sourceChoice)&&!wantsThumbnailRevision(task.brief)&&!wantsVideoRevision(task.brief)&&!wantsVideoPlan(task.brief)){
      const began=Date.now(),intent=await hermes.run(endpoint,{model:route.model,provider:route.provider,reasoningEffort:'low',sessionId:'video-intent-'+task.id,instructions:videoIntentInstructions,input:JSON.stringify({message:task.brief,activeProject:videoProject??{requiresSelection:true}})},task.id+':intent:'+attempt)
      await store.db.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,brandId,route.source,route.model??intent.model,intent.inputTokens,intent.outputTokens,Date.now()-began])
      if(intent.status==='completed'){try{interpreted=videoIntent.parse(JSON.parse(intent.output.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,'').replace(/\s*\x60\x60\x60$/,''))).intent}catch{/* Unclear classification stays a conversation. */}}
    }
    const thumbnailRequested=task.agentType==='video-editor'&&task.kind==='konten.chat'&&(wantsThumbnailRevision(task.brief)||interpreted==='thumbnail')
    if(sourceChoice&&(thumbnailRequested||wantsVideoRevision(task.brief)||interpreted==='video'))throw sourceChoice
    if(thumbnailRequested&&(!videoProject||!deps.production))throw new Error('Proyek thumbnail aktif belum terhubung ke percakapan ini. Pilih hasil sumber yang ingin direvisi.')
    const editingVideo=!thumbnailRequested&&!!videoProject&&task.kind==='konten.chat'&&(wantsVideoRevision(task.brief)||interpreted==='video')
    const revisionContext=editingVideo?await deps.production!.videoRevisionContext(brandId,videoProject!.project):undefined
    const videoRequested=!editingVideo&&!thumbnailRequested&&task.agentType==='video-editor'&&((task.kind==='konten.chat'&&wantsVideoPlan(task.brief))||task.kind==='video.rencana-produksi')
    if(videoRequested&&!(await deps.production?.health('video-editor'))?.ready)throw new Error('Mesin Video Editor belum siap untuk menyiapkan proyek.')
    const videoPresets=videoRequested?await deps.production!.presets():undefined
    if(videoRequested&&!videoPresets?.length)throw new Error('Preset Video Editor belum tersedia.')
    const engineContext=deps.production&&['content-creator','video-editor'].includes(task.agentType)&&(editingVideo||thumbnailRequested||videoRequested||!!carouselPlan||/konten|carousel|render|video|reels|storyboard|edit|preset|motion|subtitle|naskah|desain|produksi/i.test(task.brief))?deps.production.context(task.agentType,brandId,task.brief):undefined
    if(engineContext?.text)instructions+=`\n\nREFERENSI MESIN PRODUKSI LOKAL (versi ${engineContext.version}): gunakan sesuai brand dan tugas; aturan resmi dan approval AI Office tetap berlaku. Ketersediaan dokumen bukan bukti pipeline sudah dijalankan. Content Creator dapat merender carousel melalui tool chat. Jangan mengklaim berkas selesai sebelum tool menghasilkan berkas. Video masih mengikuti kemampuan pipeline yang tersedia.\n${engineContext.text}`
    if(task.agentType==='content-creator' && task.kind==='konten.riset')instructions+='\n\nMODE RISET AUDIENS: hasilkan bagian sumber dan cakupan data, pertanyaan/kebutuhan audiens anonim, tema dan angle konten, bukti kutipan yang telah disamarkan, serta keterbatasan dan pemeriksaan privasi. Jangan menebak identitas dari penanda DIHAPUS. Frekuensi hanya boleh disebut jika dapat dihitung dari sumber; jangan mengklaim mewakili seluruh audiens. Nama bebas, alamat tersirat, dan detail sensitif tetap memerlukan review manusia. Ini riset, bukan izin publikasi.'
    if(chatContext?.skills.length)instructions+='\n\nSKILL APLIKASI YANG DIPILIH PENGGUNA:\n'+chatContext.skills.map(s=>`${s.name}: ${s.instruction}`).join('\n\n')
    let input = taskInput(running, await store.revisionNotes(brandId, taskId))
    if(dependencies.text)input+='\n\n'+dependencies.text
    const active=orchestrating && !orchestration ? (await store.agents(brandId)).filter(a=>a.active && a.agentType!=='manager').map(a=>a.agentType) : []
    if(orchestrating && !orchestration)instructions+=planningInstructions(active)
    if(orchestration) {
      instructions+='\n\nMODE RANGKUMAN MANAGER: rangkum hanya hasil spesialis yang telah disetujui berikut. Sebutkan pemilik tiap hasil, batasan, dan langkah berikutnya. Jangan mengklaim publikasi atau aksi eksternal sudah dilakukan. Hasil rangkuman tetap masuk approval manusia.'
      input+=`\n\nRencana: ${orchestration.plan.summary}\n\n`+orchestration.children.map(child=>`### ${child.agentType}: ${child.title}\nStatus: ${child.status}\nHasil berversi tersedia pada asset_handoff yang disertakan.`).join('\n\n')
    }
    let historyMetrics:Record<string,unknown>={}
    if (task.kind === 'konten.chat') {
      const history = (await store.tasks(brandId)).filter(item => item.brandId === brandId && item.agentType === task.agentType && item.kind === 'konten.chat' && item.id !== task.id && item.createdAt < task.createdAt && item.result).slice(0,50)
      const historyBudget=Number(process.env.OFFICE_CHAT_HISTORY_CHARS??12000)
      if(!Number.isSafeInteger(historyBudget)||historyBudget<1000||historyBudget>100000)throw new Error('OFFICE_CHAT_HISTORY_CHARS harus 1000–100000.')
      const bounded=boundedHistory(history,historyBudget)
      const historyText=bounded.turns.map(item=>`Pengguna: ${item.brief}\nAgent: ${item.result}`).join('\n\n')
      historyMetrics={historyChars:historyText.length,historyTurns:bounded.turns.length,historyBudgetChars:historyBudget,historyAvailableTurns:history.length,baselineHistoryChars:history.slice(0,10).map(t=>t.brief.slice(0,6000)+(t.result??'').slice(0,10000)).join('\n').length}
      input = `Percakapan dengan pengguna. Jawab pesan terbaru sesuai peran; boleh meminta klarifikasi. Hasil belum merupakan izin publikasi atau aksi eksternal.\n\n${historyText}\n\nPesan terbaru: ${input}`
    }
    if(additionalNotes)input+='\n\n'+additionalNotes
    if(videoProject)instructions+='\nKEMAMPUAN REVISI: alat thumbnail mengubah margin, teks dan foto; alat komposisi yang didukung membuat preview edit judul/layout/art/ukuran/gradasi dan koreksi kata subtitle. Render final dapat diminta setelah preview versi terbaru ditinjau dengan perintah eksplisit render; animasi baru dapat dibuat melalui layer bentuk/teks/path dan keyframe, tanpa kode bebas. Jangan mengatakan proyek hilang bila metadata sumber tersedia; jelaskan operasi yang benar-benar bisa dilakukan.'
    if(videoProject)input+='\n\nProyek video aktif dari hasil tersimpan (bukan unggahan yang hilang): '+JSON.stringify(videoProject)
    if(editingVideo)instructions+=videoRevisionInstructions({project:revisionContext!.project,props:revisionContext!.props})
    if(thumbnailRequested)instructions+=thumbnailInstructions({...videoProject,settings:deps.production!.thumbnailSettings(brandId,videoProject!.project)})
    if(videoRequested){
      const revisionSource=(await store.db.query("SELECT payload->>'sourceTaskId' AS id FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='video_revision_requested' ORDER BY id DESC LIMIT 1",[brandId,taskId])).rows[0]?.id
      const previous=(task.status==='revision'||revisionSource)?(await store.db.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[brandId,task.agentType,revisionSource??taskId])).rows[0]?.payload?.video?.plan:undefined
      if(previous)input+='\n\nRencana sebelumnya yang perlu direvisi; pertahankan bagian yang tidak diminta berubah:\n'+JSON.stringify(previous)
    }
    if(chatContext?.extra)input+='\n\n'+chatContext.extra
    const designReference=carouselPlan?.composition&&deps.production?await deps.production.visualReferences(brandId):undefined
    if(designReference)instructions+='\nGambar terakhir pada input adalah REFERENSI VISUAL KURASI BRAND, bukan lampiran pengguna. Pelajari skala teks, kepadatan, bentuk kartu, maskot, dan ritme antar-slide. Jangan menyalin topik atau jumlah slide referensi.'
    if(carouselPlan)instructions+=carouselPlan.instructions
    if(videoRequested)instructions+=videoPlanInstructions(videoPresets)
    if(deps.chat)await deps.chat.recordContext(task,{...historyMetrics,contextVersion:selectedContext.version,coreVersion:selectedContext.coreVersion,officialFiles:contextFiles.length,coreFiles:selectedContext.core.map(f=>f.path),referenceFiles:selectedContext.references.map(f=>f.path),officialSourceChars:selectedContext.fullChars,officialSelectedChars:selectedContext.selectedChars,systemChars:instructions.length,inputChars:input.length,notesChars:additionalNotes.length,documentChars:chatContext?.extra.length??0,mainInputTokens:null,mainOutputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,responseMs:null,cacheStatus:'awaiting-provider-report'})
    if(deps.chat&&engineContext)await deps.chat.recordContext(task,{productionContextVersion:engineContext.version,productionContextFiles:engineContext.files})
    const runStarted = Date.now()
    const result = await hermes.run(endpoint, {
      input, instructions, sessionId: `task-${taskId}`,
      ...((chatContext?.images.length||designReference)?{images:[...(chatContext?.images??[]),...(designReference?[designReference.image]:[])]}:{}),
      model: route.model, provider: route.provider, reasoningEffort: carouselPlan?.composition?'high':route.reasoningEffort,
    }, `${taskId}:${attempt}:${running.updatedAt}`)
    if(engineContext&&deps.production?.context(task.agentType,brandId,task.brief).version!==engineContext.version)throw new Error('Versi mesin berubah saat agent menyusun jawaban. Ulangi permintaan dengan sumber terbaru.')
    const durationMs = Date.now() - runStarted
    if(deps.chat)await deps.chat.recordContext(task,{mainInputTokens:result.inputTokens,mainOutputTokens:result.outputTokens,cacheReadTokens:result.cacheReadTokens??null,cacheWriteTokens:result.cacheWriteTokens??null,responseMs:durationMs,cacheStatus:result.cacheReadTokens===undefined||result.cacheReadTokens===null?'not-reported':'reported'})
    if((await store.task(brandId,taskId))?.status==='cancelled')return {next:'none'}
    if(task.parentId && (await store.task(brandId,task.parentId))?.status==='cancelled') {
      await store.transition(brandId,taskId,'cancelled',{actor:'sistem',reason:'Tugas induk dibatalkan saat spesialis bekerja'})
      return {next:'none'}
    }
    // The kill switch may have been pulled while the run was in flight; park the task instead of filing its result.
    if (await store.isPaused(brandId, task.agentType)) {
      await store.transition(brandId, taskId, 'paused', { actor: 'sistem', reason: 'kill switch aktif saat tugas berjalan' })
      return { next: 'none' }
    }
    if (result.status === 'completed' && result.output.trim()) {
      if(thumbnailRequested||editingVideo){
        await store.db.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,brandId,route.source,route.model??result.model,result.inputTokens,result.outputTokens,durationMs])
        const revision=await executeThumbnailRevision(deps,task,videoProject!,result.output,editingVideo?'video':'thumbnail')
        if(revision.question)await store.completeChat(brandId,taskId,{content:revision.question,runId:result.runId,source:route.source,model:route.model??result.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,durationMs})
        return {next:'none'}
      }
      if(videoRequested){
        const plan=parseVideoPlan(result.output,videoPresets!)
        if(plan.question){
          if(task.kind!=='konten.chat')throw new Error(`Rencana video memerlukan arahan: ${plan.question}`)
          await store.completeChat(brandId,taskId,{content:plan.question,runId:result.runId,source:route.source,model:route.model??result.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,durationMs})
          return {next:'none'}
        }
        const job=await dispatchVideoPlan(store,task,{...plan.video!,sourceVersion:engineContext?.version},result,{source:route.source,model:route.model??result.model,durationMs})
        return job.id===taskId?{next:'retry',delayMs:0}:{next:'retry',delayMs:15000,children:[{brandId,id:job.id,priority:job.priority}]}
      }
      if(carouselPlan){
        const choices=carouselImageChoices(carouselPlan,result.output)
        if(choices.question&&task.kind==='konten.carousel-produksi')throw new Error(`Produksi memerlukan arahan tambahan: ${choices.question}`)
        if(choices.question){await store.logEvent(store.db,task,'carousel_clarification',{brief:productionTask.brief,attachmentIds:carouselPlan.images.map((i:{id:string})=>i.id)});await store.completeChat(brandId,taskId,{content:choices.question,runId:result.runId,source:route.source,model:route.model??result.model,inputTokens:result.inputTokens,outputTokens:result.outputTokens,durationMs});return {next:'none'}}
        const spec=applyCarouselCopy(carouselPlan,result.output)
        const child=await dispatchCarouselChat(store,productionTask,spec,result,{source:route.source,model:route.model??result.model,durationMs},carouselPlan.sourceTaskId,choices.assetBindings,choices.chatAssets)
        if(child.id===taskId)return {next:'retry',delayMs:0}
        return {next:'retry',delayMs:15000,children:[{brandId,id:child.id,priority:child.priority}]}
      }
      const output = { content: result.output.trim(), runId: result.runId, source: route.source, model: route.model ?? result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs,cacheReadTokens:result.cacheReadTokens,cacheWriteTokens:result.cacheWriteTokens }
      if(orchestrating && !orchestration) {
        const plan=parseManagerPlan(result.output,active)
        await persistManagerPlan(store,task,plan,output)
        const state=await orchestrationState(store,task)
        return {next:'retry',delayMs:15000,children:state?readyChildren(state):[]}
      }
      if (task.kind === 'konten.chat') {
        await store.completeChat(brandId, taskId, output)
        if(deps.chat && (await deps.chat.input(task)).useMemory) {
          try{await compactChat(deps.chat,task,deps.hermes,endpoint,route)}catch{console.warn(`Ringkasan memori ${brandId}/${task.agentType} belum diperbarui; jawaban chat tetap tersimpan.`)}
        }
      }
      else await store.submitForApproval(brandId, taskId, output)
      return { next: 'none' }
    }
    return fail(result.output || `Run berakhir dengan status ${result.status}.`,!!(result.limit??quotaInfo(result.output)),result.limit??quotaInfo(result.output))
  } catch (error) {
    if(error instanceof ProductionSourceChoiceRequired){
      await store.completeChat(brandId,taskId,{content:error.message,runId:'source-choice-'+taskId,source:route.source,model:'system',inputTokens:0,outputTokens:0})
      return {next:'none'}
    }
    const limit=limitFromError(error)
    if(limit)return fail(error instanceof Error?error.message:String(error),true,limit)
    if(error instanceof SyntaxError||(error instanceof Error&&error.name==='ZodError'))await deps.hermes.invalidateLastCompleted?.()
    if(error instanceof HermesError && error.permanent) {
      await store.transition(brandId,taskId,'failed',{actor:'sistem',reason:error.message,patch:{error:error.message}})
      return {next:'none'}
    }
    if (error instanceof HermesError && error.busy) {
      // Hermes is at its concurrent-run cap: try again shortly without counting an attempt.
      await store.transition(brandId, taskId, 'queued', { actor: 'sistem', reason: 'Hermes sedang penuh', patch: { attempts: task.attempts } })
      return { next: 'retry', delayMs: 30_000 }
    }
    return fail(error instanceof Error ? error.message : String(error), false)
  }
}
