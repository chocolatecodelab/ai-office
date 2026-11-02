import { useEffect, useRef } from 'react'

// Client side of the blueprint office API (server/office): types, requests, and the live change
// feed that tells a page to reload when its brand's tasks, approvals or events change.

export type TaskStatus = 'queued' | 'running' | 'waiting_quota' | 'waiting_approval' | 'revision' | 'approved' | 'done' | 'failed' | 'paused' | 'cancelled'
export type AgentStatus = 'idle' | 'working' | 'waiting_quota' | 'waiting_approval' | 'revision' | 'error' | 'paused'

export interface OfficeTask {
  id: string; brandId: string; agentType: string; eventId: string | null; kind: string; title: string; brief: string
  priority: number; urgent: boolean; complex: boolean; status: TaskStatus; attempts: number
  result: string | null; error: string | null; retryAt: string | null; createdAt: string; updatedAt: string
}

export interface OfficeAgent { brandId: string; agentType: string; active: boolean; paused: boolean; status: AgentStatus; currentTask: string | null }
export interface OfficeBrand { id: string; name: string; color: string; paused: boolean; agents: OfficeAgent[] }

export interface OfficeApproval {
  id: string; taskId: string; brandId: string; approvalType: string; approver: string
  decision: 'approved' | 'rejected' | null; note: string | null; createdAt: string; task: OfficeTask | undefined
}

export interface EventDetails { tanggal?: string; harga?: string; narasumber?: string; target?: string; objective?: string; benefit?: string; lokasi?: string }
export interface OfficeEvent { id: string; brandId: string; title: string; brief: string; details: EventDetails; createdAt: string }
export interface EventStage { id: string; label: string; level: string; available: boolean; ready: boolean; missing: string[]; task: OfficeTask | null }
export interface SpeakerQuestion { id: string; position: number; speaker: string; question: string; answer: string | null; status: 'belum_dikirim' | 'terkirim' | 'dijawab' }
export interface EventDetail { event: OfficeEvent; stages: EventStage[]; questions: SpeakerQuestion[] }

export interface IntegrationStatus { service: string; label: string; mode: 'mock' | 'sandbox' | 'live'; note: string }
export interface OfficeStatus { integrations: IntegrationStatus[] }

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

export async function officeRequest<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
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
      socket.onmessage = () => latest.current()
      socket.onclose = () => { if (!closed) retry = setTimeout(connect, 3000) }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); socket?.close() }
  }, [brand])
}
