// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AgentNotes } from './AgentNotes.tsx'
import type { AgentNote } from '../office-api.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const note = (patch: Partial<AgentNote>): AgentNote => ({ id: 'n1', brandId: 'otca', agentType: 'manager', kind: 'rule', title: 'Sapaan', body: 'Mulai dengan salam.', active: true, createdBy: 'pengguna', updatedBy: 'pengguna', createdAt: '2026-11-04T01:00:00Z', updatedAt: '2026-11-04T01:00:00Z', ...patch })
const click = (host: HTMLElement, text: string) => act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent === text)!.click() })

it('lists this agent and brand-wide notes, and adds, switches off and deletes through the brand notes route', async () => {
  let stored = [note({}), note({ id: 'n2', agentType: null, title: 'Untuk semua', kind: 'memory' }), note({ id: 'n3', agentType: 'event-specialist', title: 'Milik agent lain' })]
  const fetcher = vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method === 'POST') { stored = [...stored, note({ id: 'n4', ...JSON.parse(String(options.body)) })]; return new Response(JSON.stringify(stored.at(-1))) }
    if (options?.method === 'PUT') { stored = stored.map((item) => item.id === path.split('/').pop() ? { ...item, ...JSON.parse(String(options.body)) } : item); return new Response('{}') }
    if (options?.method === 'DELETE') { stored = stored.filter((item) => item.id !== path.split('/').pop()); return new Response('{"deleted":true}') }
    return new Response(JSON.stringify(stored))
  })
  vi.stubGlobal('fetch', fetcher)
  const host = document.body.appendChild(document.createElement('div')), root = createRoot(host)
  try {
    await act(async () => { root.render(<AgentNotes brandId="otca" agentType="manager" agentName="Manager"/>) })
    expect(host.textContent).toContain('Sapaan')
    expect(host.textContent).toContain('Untuk semua')
    expect(host.textContent).toContain('Semua agent')
    expect(host.textContent).not.toContain('Milik agent lain')

    await click(host, 'Tambah catatan')
    const set = (selector: string, value: string) => {
      const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
      const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => { set('input[type=text]', 'Harga'); set('textarea', 'Tulis dalam rupiah.') })
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    const post = fetcher.mock.calls.find(([, options]) => options?.method === 'POST')!
    expect(post[0]).toBe('/api/office/brands/otca/notes')
    expect(JSON.parse(String(post[1]!.body))).toEqual({ kind: 'rule', title: 'Harga', body: 'Tulis dalam rupiah.', agentType: 'manager' })
    expect(host.textContent).toContain('Harga')

    await click(host, 'Nonaktifkan')
    expect(fetcher.mock.calls.some(([path, options]) => path === '/api/office/brands/otca/notes/n1' && options?.method === 'PUT' && String(options.body) === '{"active":false}')).toBe(true)

    await click(host, 'Hapus')
    expect(host.textContent).toContain('Hapus catatan ini?')
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
    await click(host, 'Ya, hapus')
    expect(fetcher.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(true)
    expect(fetcher.mock.calls.every(([path]) => path.startsWith('/api/office/brands/otca/'))).toBe(true)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
