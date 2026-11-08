// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { Office } from './pages/Office.tsx'
import type { OfficeBrand } from './office-api.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
class Socket {
  static instances: Socket[] = []
  onmessage?: () => void
  onopen?: () => void
  onclose?: () => void
  constructor(public url: string) { Socket.instances.push(this) }
  close() {}
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Socket.instances = []; document.body.replaceChildren() })
it('uses the office API, falls back to 2D and refreshes statuses on a brand event without moving floors', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.stubGlobal('WebSocket', Socket)
  let brands: OfficeBrand[] = [{ id: 'otca', name: 'Official OTCA', color: '#CB9D31', paused: false,
    agents: [{ brandId: 'otca', agentType: 'manager', active: true, paused: false, status: 'working', currentTask: 'Rencana event' }],
    summary: { queued: 2, approvals: 0, waitingQuota: 0 } }]
  const fetcher = vi.fn((path: string) => {
    expect(path).toBe('/api/office/brands')
    return Promise.resolve(new Response(JSON.stringify(brands)))
  })
  vi.stubGlobal('fetch', fetcher)
  const host = document.body.appendChild(document.createElement('div'))
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<Office/>); await Promise.resolve() })
    expect(fetcher.mock.calls.length).toBe(1)
    expect(host.textContent).toContain('Rencana event')
    expect(host.textContent).toContain('Antre: 2')
    expect(host.querySelector('canvas')).toBeNull()
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Kualitas grafis"]')?.disabled).toBe(true)
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Reset kamera')?.disabled).toBe(true)
    expect(Socket.instances[0].url).toContain('/api/office/ws?brand=otca')
    brands = [{ ...brands[0], agents: [{ ...brands[0].agents[0], status: 'waiting_quota', currentTask: null }], summary: { queued: 0, approvals: 0, waitingQuota: 1 } }]
    await act(async () => { Socket.instances[0].onmessage?.(); await Promise.resolve() })
    expect(host.textContent).toContain('Tidur (kuota)')
    expect(host.textContent).toContain('Menunggu kuota: 1')
    expect(host.querySelector('[aria-label="Lantai kantor"] [aria-pressed="true"]')?.textContent).toContain('Official OTCA')
    expect(fetcher.mock.calls.every((args) => String(args[0]).startsWith('/api/office/brands'))).toBe(true)
    const reads = fetcher.mock.calls.length
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === 'G · Bersama')!.click() })
    expect(host.querySelectorAll('.room-control-grid article')).toHaveLength(6)
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Gym & Fitness: jeda"]')!.click() })
    expect(host.querySelector('[aria-label="Gym & Fitness: mulai"]')?.getAttribute('aria-pressed')).toBe('false')
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === 'Ganti latihan')!.click() })
    expect(host.textContent).toContain('Cardio')
    expect(fetcher.mock.calls.length).toBe(reads)
  } finally { await act(async () => root.unmount()) }
})
