import { useEffect, useRef } from 'react'

// Client side of the blueprint office API (server/office): types, requests, and the live change
// feed that tells a page to reload when its brand's tasks, approvals or events change.

export type TaskStatus = 'queued' | 'running' | 'waiting_quota' | 'waiting_approval' | 'revision' | 'approved' | 'done' | 'failed' | 'paused' | 'cancelled'
export type AgentStatus = 'idle' | 'working' | 'waiting_quota' | 'waiting_approval' | 'revision' | 'error' | 'paused'

export interface OfficeTask {
  id: string; brandId: string; agentType: string; eventId: string | null; kind: string; title: string; brief: string
  priority: number; urgent: boolean; complex: boolean; status: TaskStatus; attempts: number
  result: string | null; error: string | null; retryAt: string | null; createdAt: string; updatedAt: string
  /** Chat replies only: the reply without its file blocks, and the files it carried. */
  text?: string; artifacts?: Array<{ name: string; content: string; assetId?: string; mime?: string }>
}

export interface OfficeAgent { brandId: string; agentType: string; active: boolean; paused: boolean; status: AgentStatus; currentTask: string | null; retryAt?: string | null }
export interface OfficeBrand { id: string; name: string; color: string; paused: boolean; agents: OfficeAgent[]; summary?: { queued: number; approvals: number; waitingQuota: number } }

export interface ContentQc { scope:'text-only'; checks:Array<{label:string;status:'pass'|'warning'|'manual';note:string}> }

export interface TaskUsageView { runs: number; inputTokens: number; outputTokens: number; durationMs: number | null; source: 'codex' | 'litellm'; model: string }

export interface OfficeApproval {
  usage?: TaskUsageView | null
  qc?: ContentQc
  id: string; taskId: string; brandId: string; approvalType: string; approver: string
  decision: 'approved' | 'rejected' | null; note: string | null; createdAt: string; task: OfficeTask | undefined
}

export interface EventDetails { tanggal?: string; harga?: string; narasumber?: string; target?: string; objective?: string; benefit?: string; lokasi?: string }
export interface OfficeEvent { id: string; brandId: string; title: string; brief: string; details: EventDetails; createdAt: string }
export interface EventStage { id: string; label: string; level: string; available: boolean; ready: boolean; missing: string[]; task: OfficeTask | null }
export interface SpeakerQuestion { id: string; position: number; speaker: string; question: string; answer: string | null; status: 'belum_dikirim' | 'terkirim' | 'dijawab' }
export interface EventDetail { event: OfficeEvent; stages: EventStage[]; questions: SpeakerQuestion[] }

export interface IntegrationStatus { service: string; label: string; mode: 'mock' | 'sandbox' | 'live'; note: string }
export type IntegrationMode = 'mock' | 'sandbox' | 'live'
export interface OfficeIntegrations {
  brands: Array<{ id: string; name: string }>
  redirectUri?: string
  encryptionReady: boolean
  services: Array<{
    service: string; label: string; purpose: string; level: string; auth: 'oauth' | 'api-key'; vars: string[]; file: string; howTo: string
    adapterReady: boolean; connected: boolean; missing: string[]; oneClick: boolean; modeOptions: IntegrationMode[]
    modes: Record<string, { requested: IntegrationMode; effective: IntegrationMode; account?: { email: string; status: 'active' | 'needs_reauth'; connectedAt: string } }>
  }>
}
export interface OfficeStatus { integrations: IntegrationStatus[] }

export interface OfficeSettingsView {
  access: { actor: string; sso: boolean; note: string }
  roles: Array<{ id: string; label: string; note?: string }>
  integrations: IntegrationStatus[]
  pools: Array<{ id: string; label: string; budgetUsd: number; models: string[]; spentUsd: number; percent: number; alert: 'ok' | '50' | '80' | 'over' }>
  gateways: Array<{ brandId: string; name: string; configured: boolean }>
  langfuse: { configured: boolean }
}

export type Weight = 'simple' | 'complex' | 'urgent'
export interface AgentRoute { source: 'codex' | 'litellm'; model?: string; reasoningEffort: 'low' | 'high' }
export interface ModelEntry { agentType: string; simple: AgentRoute; complex: AgentRoute; urgent: AgentRoute; defaults: Record<Weight, AgentRoute>; overridden: Weight[] }
export interface OfficeModels { profile: 'dev' | 'prod'; codexModels: string[]; claudeAliases: string[]; agents: ModelEntry[] }
export interface ModelTestResult { ok: boolean; status: string; reply: string; inputTokens: number; outputTokens: number; durationMs: number }

export interface HealthCheck { name: string; ok: boolean; detail: string; ms: number }
export interface AssetItem { id: string; taskId: string; brandId: string; brandName: string; kind: string; version: number; name: string | null; mime: string | null; downloadable: boolean; size: number; excerpt: string; title: string; agentType: string; createdAt: string }
export type NoteKind = 'rule' | 'memory'
export interface AgentNote { id: string; brandId: string; agentType: string | null; kind: NoteKind; title: string; body: string; active: boolean; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string }
export type AssetPreview = { type: 'document' | 'html'; html: string } | { type: 'text'; text: string }
export interface OfficeAssets { assets: AssetItem[]; drive?: IntegrationStatus }

export interface ActivityItem {
  at: string; brandId: string; brandName: string; kind: 'audit' | 'status'; actor: string; action: string; title: string | null
  from?: TaskStatus; to?: TaskStatus; reason?: string | null
}

export interface CalendarEntry { id: string; brandId: string; brandName: string; title: string; tanggal: string | null; date?: string; time?: string }
export interface OfficeCalendar { entries: CalendarEntry[]; googleCalendar?: IntegrationStatus }

export interface UsageFigures { runs: number; tokens: number; inputTokens: number; outputTokens: number; costUsd: number }
export interface LangfuseModelUsage { model: string; generations: number; inputTokens: number; outputTokens: number; costUsd: number }
export interface LangfuseUsage extends Omit<UsageFigures, 'runs' | 'tokens'> { status: 'off' | 'ok' | 'error'; message?: string; generations: number; environments: string[]; models: LangfuseModelUsage[] }
export interface OfficeUsage {
  days: 1 | 7 | 30
  totals: UsageFigures
  brands: Array<UsageFigures & { brandId: string; label: string }>
  agents: Array<UsageFigures & { brandId: string; agentType: string; brandName: string }>
  kinds: Array<UsageFigures & { kind: string }>
  models: Array<UsageFigures & { source: string; model: string }>
  langfuse: LangfuseUsage
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'Antre', running: 'Dikerjakan', waiting_quota: 'Menunggu kuota', waiting_approval: 'Menunggu approval',
  revision: 'Revisi', approved: 'Disetujui', done: 'Selesai', failed: 'Gagal', paused: 'Dijeda', cancelled: 'Dibatalkan',
}

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Siap', working: 'Bekerja', waiting_quota: 'Tidur (kuota)', waiting_approval: 'Menunggu approval', revision: 'Revisi', error: 'Error', paused: 'Dijeda',
}

export const AGENT_NAMES: Record<string, string> = {
  manager: 'Manager', 'event-specialist': 'Event Specialist', 'content-creator': 'Content Creator',
  'video-editor': 'Video Editor', 'social-media-manager': 'Social Media Manager', 'digital-marketing': 'Digital Marketing',
}

export class OfficeRequestError extends Error {}

export async function officeRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/office${path}`, {
    method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new OfficeRequestError(data.error ?? `HTTP ${response.status}`)
  return data as T
}

/** Calls `onChange` whenever the server reports a change for the brand; reconnects after drops. */
export function useOfficeLive(brand: string, onChange: () => void): void {
  const latest = useRef(onChange)
  latest.current = onChange
  useEffect(() => {
    if (typeof WebSocket === 'undefined') return
    let socket: WebSocket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    let closed = false
    const connect = () => {
      const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${scheme}://${window.location.host}/api/office/ws?brand=${encodeURIComponent(brand)}`)
      // Recover changes made before connecting or while the connection was down.
      socket.onopen = () => latest.current()
      socket.onmessage = () => latest.current()
      socket.onclose = () => { if (!closed) retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); socket?.close() }
  }, [brand])
}
