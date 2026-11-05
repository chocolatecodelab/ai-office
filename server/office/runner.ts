import { privateResearchClient } from './research-privacy.js'
import { agentContextFiles } from '../otca-context.js'
import { selectOfficialContext,boundedHistory } from './context-policy.js'
import type { HermesEndpoint } from '../settings.js'
import { HermesError, isQuotaFailure, type HermesClient } from './hermes-client.js'
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
    return await runTaskOnce(deps,brandId,taskId)
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
  const fail = async (message: string, quota: boolean): Promise<RunOutcome> => {
    if (quota) {
      const retryAt = new Date(Date.now() + QUOTA_WAIT_MS)
      // A quota wait is not the task's fault, so it does not use up a retry.
      await store.transition(brandId, taskId, 'waiting_quota', { actor: 'sistem', reason: 'kuota Codex habis', patch: { error: message, retry_at: retryAt.toISOString(), attempts: task.attempts } })
      return { next: 'retry', delayMs: QUOTA_WAIT_MS }
    }
    if (attempt < MAX_ATTEMPTS) {
      await store.transition(brandId, taskId, 'queued', { actor: 'sistem', reason: `gagal, dicoba lagi (${attempt}/${MAX_ATTEMPTS})`, patch: { error: message } })
      return { next: 'retry', delayMs: RETRY_BACKOFF_MS[attempt] ?? 5 * 60_000 }
    }
    await store.transition(brandId, taskId, 'failed', { actor: 'sistem', reason: `gagal ${MAX_ATTEMPTS} kali`, patch: { error: message } })
    return { next: 'none' }
  }

  try {
    const hermes=task.agentType==='content-creator' && task.kind==='konten.riset' ? privateResearchClient(deps.hermes,async counts=>{await store.db.query('INSERT INTO task_events(task_id,brand_id,type,payload) VALUES($1,$2,$3,$4)',[task.id,brandId,'research_privacy',JSON.stringify({policy:'direct-identifiers-v1',counts,scope:'text-only',manualReviewRequired:true})])}) : deps.hermes
    const contextRuntime:DocumentRuntime={run:async(request,key)=>{const started=Date.now();const result=await hermes.run(endpoint,{...request,model:route.model,provider:route.provider,reasoningEffort:'low'},key);await store.db.query('INSERT INTO cost_events (task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',[task.id,brandId,route.source,route.model??result.model,result.inputTokens,result.outputTokens,Date.now()-started]);return result}}
    const chatContext=deps.chat ? await deps.chat.prepare(task,contextRuntime) : undefined
    const dependencies=await dependencyContext(store,task,orchestration?.children??predecessors,contextRuntime)
    const contextFiles=agentContextFiles(deps.contextDir,task.agentType,brandId)??[]
    const selectedContext=selectOfficialContext(contextFiles,task.agentType,task.brief,task.kind==='konten.chat')
    const additionalNotes=chatContext?.notesText??notesPrompt(await store.notesFor(brandId,task.agentType))
    let instructions = agentInstructions(deps.contextDir, task.agentType, brandId, await deps.brandName(brandId), task.kind === 'konten.chat','',task.brief)
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
    if(chatContext?.extra)input+='\n\n'+chatContext.extra
    if(deps.chat)await deps.chat.recordContext(task,{...historyMetrics,contextVersion:selectedContext.version,coreVersion:selectedContext.coreVersion,officialFiles:contextFiles.length,coreFiles:selectedContext.core.map(f=>f.path),referenceFiles:selectedContext.references.map(f=>f.path),officialSourceChars:selectedContext.fullChars,officialSelectedChars:selectedContext.selectedChars,systemChars:instructions.length,inputChars:input.length,notesChars:additionalNotes.length,documentChars:chatContext?.extra.length??0,mainInputTokens:null,mainOutputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,responseMs:null,cacheStatus:'awaiting-provider-report'})
    const runStarted = Date.now()
    const result = await hermes.run(endpoint, {
      input, instructions, sessionId: `task-${taskId}`,
      ...(chatContext?.images.length?{images:chatContext.images}:{}),
      model: route.model, provider: route.provider, reasoningEffort: route.reasoningEffort,
    }, `${taskId}:${attempt}:${running.updatedAt}`)
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
    return fail(result.output || `Run berakhir dengan status ${result.status}.`, route.source === 'codex' && isQuotaFailure(result.output))
  } catch (error) {
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
