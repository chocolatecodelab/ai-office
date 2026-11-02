// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Office } from './pages/Office.tsx'
import { agentSpot, initialFloor, liveBuilding } from './office3d/live.ts'
import type { AgentStatus, OfficeBrand } from './office-api.ts'

const brands: OfficeBrand[] = [{ id: 'otca', name: 'OTCA', color: '#CB9D31', paused: false, summary:{queued:1,approvals:1,waitingQuota:1}, agents: [
  { brandId: 'otca', agentType: 'manager', active: true, paused: false, status: 'waiting_approval', currentTask: 'Review tema' },
  { brandId: 'otca', agentType: 'event-specialist', active: true, paused: false, status: 'idle', currentTask: null },
] }]
afterEach(() => { vi.unstubAllGlobals();vi.restoreAllMocks() })
describe('live office', () => {
  it('places idle agents downstairs and all six other statuses at their own desk', () => {
    const layout = liveBuilding(brands)
    expect(agentSpot(layout, 'otca', 'manager', 'idle', 0)?.floor).toBe(0)
    for (const status of ['working', 'waiting_quota', 'waiting_approval', 'revision', 'error', 'paused'] as AgentStatus[]) {
      expect(agentSpot(layout, 'otca', 'manager', status, 0)?.key).toBe(status==='error' ? 'otca:manager:error' : 'otca:manager')
    }
    expect(initialFloor(brands, layout)).toBe(1)
  })
  it('loads only new office endpoints and renders real counters and agents in 2D', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('WebSocket', undefined)
    vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(null)
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/brands') ? brands : url.includes('approvals') ? [{ id: 'approval-1' }] : [{ status: 'queued' }, { status: 'waiting_quota' }] }))
    vi.stubGlobal('fetch', fetcher)
    const host = document.createElement('div')
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<Office/>) })
      expect(host.querySelector('canvas')).toBeNull()
      expect(host.textContent).toContain('Antre: 1')
      expect(host.textContent).toContain('Approval terbuka: 1')
      expect(host.textContent).toContain('Menunggu kuota: 1')
      expect(host.textContent).toContain('Review tema')
      expect(fetcher.mock.calls.every(([url]) => url.startsWith('/api/office/'))).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})
