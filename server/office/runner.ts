import type { HermesEndpoint } from '../settings.js'
import { HermesError, isQuotaFailure, type HermesClient } from './hermes-client.js'
import { agentInstructions, taskInput } from './prompts.js'
import { RUNNABLE } from './status.js'
import type { OfficeStore, Task } from './store.js'

// Runs one task on its brand's Hermes and maps the outcome onto the task status machine:
// done → waiting_approval; Codex quota used up → waiting_quota until the reset; other failures are
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
}

/** Codex for normal work; urgent work goes to the Claude pool through LiteLLM (FR-12). */
export function routeFor(task: Pick<Task, 'urgent' | 'complex'>): { source: 'codex' | 'litellm'; model?: string; provider?: string; reasoningEffort: 'low' | 'high' } {
  if (task.urgent) return { source: 'litellm', provider: 'litellm', model: task.complex ? 'final' : 'cepat', reasoningEffort: task.complex ? 'high' : 'low' }
  return { source: 'codex', reasoningEffort: task.complex ? 'high' : 'low' }
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
  const route = routeFor(task)
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
    const instructions = agentInstructions(deps.contextDir, task.agentType, brandId, await deps.brandName(brandId))
    const input = taskInput(running, await store.revisionNotes(brandId, taskId))
    const result = await deps.hermes.run(endpoint, {
      input, instructions, sessionId: `task-${taskId}`,
      model: route.model, provider: route.provider, reasoningEffort: route.reasoningEffort,
    }, `${taskId}:${attempt}:${running.updatedAt}`)
    if (result.status === 'completed' && result.output.trim()) {
      await store.submitForApproval(brandId, taskId, { content: result.output.trim(), runId: result.runId, source: route.source, model: route.model ?? result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens })
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
