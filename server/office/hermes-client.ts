import type { HermesEndpoint } from '../settings.js'

// Talks to one brand's Hermes container through its Runs API (docs/spike-hermes.md): a run is
// created with the agent's role as instructions, then polled until it ends. /v1/runs, unlike chat
// completions, reports failures as a failed status instead of an HTTP 200 reply.

export interface RunRequest {
  input: string
  instructions: string
  sessionId: string
  /** Leave both unset for the container default (Codex). */
  model?: string
  provider?: string
  reasoningEffort?: 'low' | 'high'
}

export interface RunResult {
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  output: string
  model: string
  inputTokens: number
  outputTokens: number
}

export interface HermesClient {
  run(endpoint: HermesEndpoint, request: RunRequest, idempotencyKey: string): Promise<RunResult>
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export function createHermesClient(options: { pollMs?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): HermesClient {
  const pollMs = options.pollMs ?? 3000
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000
  const fetcher = options.fetcher ?? fetch
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  return {
    async run(endpoint, request, idempotencyKey) {
      const headers = { Authorization: `Bearer ${endpoint.key}`, 'Content-Type': 'application/json' }
      const created = await fetcher(`${endpoint.url}/v1/runs`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          input: request.input,
          instructions: request.instructions,
          session_id: request.sessionId,
          ...(request.model ? { model: request.model } : {}),
          ...(request.provider ? { provider: request.provider } : {}),
          ...(request.reasoningEffort ? { model_options: { reasoning_effort: request.reasoningEffort } } : {}),
        }),
      })
      if (!created.ok) throw new HermesError(`Hermes menolak run: HTTP ${created.status} ${(await created.text()).slice(0, 300)}`, created.status === 429)
      const { run_id: runId } = await created.json() as { run_id: string }
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        await sleep(pollMs)
        const polled = await fetcher(`${endpoint.url}/v1/runs/${encodeURIComponent(runId)}`, { headers })
        if (!polled.ok) continue
        const run = await polled.json() as { status: string; output?: string; model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
        if (!TERMINAL.has(run.status)) continue
        return {
          runId,
          status: run.status as RunResult['status'],
          output: run.output ?? '',
          model: run.model ?? 'hermes-agent',
          inputTokens: run.usage?.input_tokens ?? 0,
          outputTokens: run.usage?.output_tokens ?? 0,
        }
      }
      await fetcher(`${endpoint.url}/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST', headers }).catch(() => undefined)
      throw new HermesError(`Run ${runId} melewati batas waktu ${Math.round(timeoutMs / 60000)} menit dan dihentikan.`, false)
    },
  }
}

/** A failure talking to Hermes itself (not the model); `busy` when it hit its concurrent-run cap. */
export class HermesError extends Error {
  constructor(message: string, readonly busy: boolean) { super(message) }
}

/**
 * Whether a failed run ran out of the subscription quota (Codex usage limit), so the task waits for
 * the reset instead of failing (FR-12).
 */
export function isQuotaFailure(output: string): boolean {
  return /usage limit|quota|rate.?limit|too many requests|\b429\b|limit (has been )?reached|try again (in|at|later)/i.test(output)
}
