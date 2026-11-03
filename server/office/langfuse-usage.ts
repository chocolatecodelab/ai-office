import type { LangfuseConfig } from '../settings.js'

// Usage read back from Langfuse, where the Hermes gateways trace every model call (generation). It runs
// on the server only: the keys never reach the browser. Codex runs on ChatGPT Plus, so the cost Langfuse
// reports is an estimate from its price table, not a bill.

export interface LangfuseModelUsage { model: string; generations: number; inputTokens: number; outputTokens: number; costUsd: number }

export interface LangfuseUsage {
  status: 'off' | 'ok' | 'error'
  message?: string
  generations: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  environments: string[]
  models: LangfuseModelUsage[]
}

interface RawObservation {
  type?: string
  model?: string | null
  environment?: string
  usageDetails?: Record<string, number> | null
  costDetails?: Record<string, number> | null
}

const PAGE_LIMIT = 500
const MAX_PAGES = 20 // at most 10 000 generations per read; the view says so when it is cut short
const TIMEOUT_MS = 10_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const empty = (status: 'off' | 'error', message?: string): LangfuseUsage => ({ status, message, generations: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, environments: [], models: [] })

export async function langfuseUsage(config: LangfuseConfig | undefined, days: number, now = new Date(), fetcher: typeof fetch = fetch): Promise<LangfuseUsage> {
  if (!config) return empty('off')
  try {
    const auth = `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`
    const observations: RawObservation[] = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        fromStartTime: new Date(now.getTime() - days * DAY_MS).toISOString(),
        toStartTime: new Date(now.getTime() + HOUR_MS).toISOString(),
        limit: String(PAGE_LIMIT),
        fields: 'core,basic,usage,model',
      })
      if (cursor) params.set('cursor', cursor)
      const response = await fetcher(`${config.baseUrl}/api/public/v2/observations?${params}`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) return empty('error', `Langfuse menjawab HTTP ${response.status}.`)
      const body = await response.json() as { data?: RawObservation[]; meta?: { cursor?: string | null } }
      observations.push(...(body.data ?? []).filter((item) => item.type === 'GENERATION'))
      cursor = body.meta?.cursor ?? undefined
      if (!cursor || (body.data ?? []).length < PAGE_LIMIT) break
    }
    return summarize(observations)
  } catch (error) {
    return empty('error', error instanceof Error ? error.message : String(error))
  }
}

export function summarize(observations: RawObservation[]): LangfuseUsage {
  const byModel = new Map<string, LangfuseModelUsage>()
  const environments = new Set<string>()
  for (const item of observations) {
    const model = item.model || 'tidak diketahui'
    const row = byModel.get(model) ?? { model, generations: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    row.generations += 1
    // Langfuse keeps cache reads apart from input; Postgres' input_tokens counts them, so add them back.
    row.inputTokens += (item.usageDetails?.input ?? 0) + (item.usageDetails?.cache_read_input_tokens ?? 0)
    row.outputTokens += item.usageDetails?.output ?? 0
    row.costUsd += item.costDetails?.total ?? 0
    byModel.set(model, row)
    if (item.environment) environments.add(item.environment)
  }
  const models = [...byModel.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens))
  const total = (field: 'generations' | 'inputTokens' | 'outputTokens' | 'costUsd') => models.reduce((sum, row) => sum + row[field], 0)
  return { status: 'ok', generations: total('generations'), inputTokens: total('inputTokens'), outputTokens: total('outputTokens'), costUsd: total('costUsd'), environments: [...environments].sort(), models }
}
