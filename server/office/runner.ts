import type { HermesEndpoint } from '../settings.js'
import { HermesError, isQuotaFailure, type HermesClient } from './hermes-client.js'
import { routeFor, type EngineProfile } from './model-routes.js'
import { agentInstructions, taskInput } from './prompts.js'
import { RUNNABLE } from './status.js'
import type { OfficeStore } from './store.js'

// Runs one task on its brand's Hermes and maps the outcome onto the task status machine:
// done → waiting_approval (a chat reply finishes as done); Codex quota used up → waiting_quota until the reset; other failures are
// retried twice (FR-13) before the task is marked failed.

export const MAX_ATTEMPTS = 3 // the first try plus 2 retries
export const QUOTA_WAIT_MS = 30 * 60 * 1000
const RETRY_BACKOFF_MS = [0, 60_000, 5 * 60_000]

/** What the queue does next with the task. */
export type RunOutcome =
  | { next: 'none' }
  | { next: 'retry'; delayMs: number }

export interface RunnerDeps {
  store: OfficeStore
  hermes: HermesClient
  endpoint(brandId: string): HermesEndpoint | undefined
  contextDir: string
  brandName(brandId: string): Promise<string>
  /** Which model table to use (model-routes.ts); dev runs everything on Codex. */
  profile?: EngineProfile
}

export async function runTask(deps: RunnerDeps, brandId: string, taskId: string): Promise<RunOutcome> {
  const { store } = deps
  const task = await store.task(brandId, taskId)
  if (!task || !RUNNABLE.includes(task.status)) return { next: 'none' }
  if (await store.isPaused(brandId, task.agentType)) {
    await store.transition(brandId, taskId, 'paused', { actor: 'sistem', reason: 'kill switch aktif' })
    return { next: 'none' }
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
    const instructions = agentInstructions(deps.contextDir, task.agentType, brandId, await deps.brandName(brandId), task.kind === 'konten.chat')
    let input = taskInput(running, await store.revisionNotes(brandId, taskId))
    if (task.kind === 'konten.chat') {
      const history = (await store.tasks(brandId)).filter(item => item.agentType === task.agentType && item.kind === 'konten.chat' && item.id !== task.id && item.createdAt < task.createdAt && item.result).slice(0,10).reverse()
      input = `Percakapan dengan pengguna. Jawab pesan terbaru sesuai peran; boleh meminta klarifikasi. Hasil belum merupakan izin publikasi atau aksi eksternal.\n\n${history.map(item => `Pengguna: ${item.brief.slice(0,6000)}\nAgent: ${item.result!.slice(0,10000)}`).join('\n\n')}\n\nPesan terbaru: ${input}`
    }
    const runStarted = Date.now()
    const result = await deps.hermes.run(endpoint, {
      input, instructions, sessionId: `task-${taskId}`,
      model: route.model, provider: route.provider, reasoningEffort: route.reasoningEffort,
    }, `${taskId}:${attempt}:${running.updatedAt}`)
    const durationMs = Date.now() - runStarted
    // The kill switch may have been pulled while the run was in flight; park the task instead of filing its result.
    if (await store.isPaused(brandId, task.agentType)) {
      await store.transition(brandId, taskId, 'paused', { actor: 'sistem', reason: 'kill switch aktif saat tugas berjalan' })
      return { next: 'none' }
    }
    if (result.status === 'completed' && result.output.trim()) {
      const output = { content: result.output.trim(), runId: result.runId, source: route.source, model: route.model ?? result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs }
      if (task.kind === 'konten.chat') await store.completeChat(brandId, taskId, output)
      else await store.submitForApproval(brandId, taskId, output)
      return { next: 'none' }
    }
    return fail(result.output || `Run berakhir dengan status ${result.status}.`, route.source === 'codex' && isQuotaFailure(result.output))
  } catch (error) {
    if (error instanceof HermesError && error.busy) {
      // Hermes is at its concurrent-run cap: try again shortly without counting an attempt.
      await store.transition(brandId, taskId, 'queued', { actor: 'sistem', reason: 'Hermes sedang penuh', patch: { attempts: task.attempts } })
      return { next: 'retry', delayMs: 30_000 }
    }
    return fail(error instanceof Error ? error.message : String(error), false)
  }
}
