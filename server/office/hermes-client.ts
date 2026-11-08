import {ProviderLimitError,quotaInfo,type LimitInfo} from './provider-limit.js'
import type { HermesEndpoint } from '../settings.js'

// Talks to one brand's Hermes container through its Runs API (docs/spike-hermes.md): a run is
// created with the agent's role as instructions, then polled until it ends. /v1/runs, unlike chat
// completions, reports failures as a failed status instead of an HTTP 200 reply.

export interface RunRequest {
  resumeRunId?:string
  onRunCreated?:(id:string)=>Promise<void>

  images?: string[]
  input: string
  instructions: string
  sessionId: string
  /** Leave both unset for the container default (Codex). */
  model?: string
  provider?: string
  reasoningEffort?: 'low' | 'high'
}

export interface RunResult {
  limit?:LimitInfo
  checkpointReused?:boolean

  cacheReadTokens?: number | null
  cacheWriteTokens?: number | null
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  output: string
  model: string
  inputTokens: number
  outputTokens: number
}

export interface HermesClient {
  invalidateLastCompleted?():Promise<void>
  run(endpoint: HermesEndpoint, request: RunRequest, idempotencyKey: string): Promise<RunResult>
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
interface HermesUsage {input_tokens?:number;output_tokens?:number;cache_read_tokens?:number;cache_write_tokens?:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number;input_tokens_details?:{cached_tokens?:number};prompt_tokens_details?:{cached_tokens?:number}}
export function cacheUsage(usage?:HermesUsage) {
  const valid=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
  return {cacheReadTokens:valid(usage?.cache_read_tokens??usage?.cache_read_input_tokens??usage?.input_tokens_details?.cached_tokens??usage?.prompt_tokens_details?.cached_tokens),cacheWriteTokens:valid(usage?.cache_write_tokens??usage?.cache_creation_input_tokens)}
}

async function httpFailure(response:Response){
 const body=(await response.text()).slice(0,32000)
 const busy=response.status===429&&/concurrent|active runs|server busy|run capacity/i.test(body)
 const limit=busy?undefined:quotaInfo(body,response.headers,Date.now(),response.status)
 if(limit)throw new ProviderLimitError('Provider membatasi permintaan (HTTP '+response.status+'). '+body.slice(0,500),limit)
 throw new HermesError('Hermes HTTP '+response.status+': '+body.slice(0,500),busy,response.status>=400&&response.status<500&&response.status!==408&&response.status!==429)
}
export function createHermesClient(options: { pollMs?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): HermesClient {
  const pollMs = options.pollMs ?? 3000
  const timeoutMs = options.timeoutMs ?? 20 * 60 * 1000
  const fetcher = options.fetcher ?? fetch
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  return {
    async run(endpoint, request, idempotencyKey) {
      const headers = { Authorization: `Bearer ${endpoint.key}`, 'Content-Type': 'application/json' }
      if(request.images?.length) {
        const response=await fetcher(`${endpoint.url}/v1/responses`,{method:'POST',headers:{...headers,'Idempotency-Key':idempotencyKey},signal:AbortSignal.timeout(timeoutMs),body:JSON.stringify({input:[{role:'user',content:[{type:'input_text',text:request.input},...request.images.map(url=>({type:'input_image',image_url:url}))]}],instructions:request.instructions,session_id:request.sessionId,provider:request.provider??'openai-codex',...(request.model?{model:request.model}:{}),...(request.reasoningEffort?{model_options:{reasoning_effort:request.reasoningEffort}}:{})})})
        if(!response.ok)await httpFailure(response)
        const data=await response.json() as {id?:string;status?:string;model?:string;output_text?:string;output?:Array<{content?:Array<{type?:string;text?:string}>}>;usage?:HermesUsage;error?:unknown}
        const output=data.output_text ?? data.output?.flatMap(item=>item.content??[]).filter(part=>part.type==='output_text').map(part=>part.text??'').join('\n') ?? ''
        return {limit:data.status==='failed'?quotaInfo(data.error??output,response.headers):undefined,...cacheUsage(data.usage),runId:data.id??request.sessionId,status:data.status==='failed'?'failed':'completed',output,model:data.model??request.model??'hermes-agent',inputTokens:data.usage?.input_tokens??0,outputTokens:data.usage?.output_tokens??0}
      }
      let runId=request.resumeRunId
      if(!runId){
      const created = await fetcher(`${endpoint.url}/v1/runs`, {
        method: 'POST',
        signal:AbortSignal.timeout(timeoutMs),
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
      if (!created.ok)await httpFailure(created)
      runId=(await created.json() as {run_id:string}).run_id
      if(!runId)throw new HermesError('Hermes tidak memberikan run_id.',false)
      await request.onRunCreated?.(runId)
      }
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        await sleep(pollMs)
        const polled = await fetcher(`${endpoint.url}/v1/runs/${encodeURIComponent(runId)}`, { headers,signal:AbortSignal.timeout(Math.min(timeoutMs,30000)) })
        if(polled.status===404)return {runId,status:'failed',output:'Hermes tidak lagi menyimpan run ini; tahap perlu dicoba ulang.',model:request.model??'hermes-agent',inputTokens:0,outputTokens:0}
        if (!polled.ok){if(polled.status===429||polled.status===401||polled.status===403)await httpFailure(polled);continue}
        const run = await polled.json() as { status: string; output?: string; model?: string; usage?: HermesUsage;error?:unknown }
        if (!TERMINAL.has(run.status)) continue
        return {
          limit:run.status==='failed'?quotaInfo(run.error??run.output,polled.headers):undefined,
          ...cacheUsage(run.usage),
          runId,
          status: run.status as RunResult['status'],
          output: run.output ?? (typeof run.error==='string'?run.error:run.error?JSON.stringify(run.error):''),
          model: run.model ?? 'hermes-agent',
          inputTokens: run.usage?.input_tokens ?? 0,
          outputTokens: run.usage?.output_tokens ?? 0,
        }
      }
      throw new HermesError(`Run ${runId} melewati batas waktu ${Math.round(timeoutMs / 60000)} menit; run tersimpan untuk diperiksa ulang.`, false)
    },
  }
}

/** A failure talking to Hermes itself (not the model); `busy` when it hit its concurrent-run cap. */
export class HermesError extends Error {
  constructor(message: string, readonly busy: boolean, readonly permanent=false) { super(message) }
}

/**
 * Whether a failed run ran out of the subscription quota (Codex usage limit), so the task waits for
 * the reset instead of failing (FR-12).
 */
export function isQuotaFailure(output: string): boolean {
  return /usage limit|quota|rate.?limit|too many requests|\b429\b|limit (has been )?reached|try again (in|at|later)/i.test(output)
}
