import { describe, expect, it, vi } from 'vitest'
import { loadSnapshot } from './request-state.ts'

describe('loadSnapshot', () => {
  it('returns failed with an actionable reason when a request rejects or responds non-OK', async () => {
    const rejected = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'))
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    const stale = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }))
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'Permission denied: x' }), { status: 403 }))

    await expect(loadSnapshot('/api/tasks', rejected)).resolves.toMatchObject({ status: 'failed', message: expect.stringContaining('could not be reached') })
    await expect(loadSnapshot('/api/tasks', unavailable)).resolves.toMatchObject({ status: 'failed', httpStatus: 503, message: 'The OTCA API answered HTTP 503.' })
    await expect(loadSnapshot('/api/memory', stale)).resolves.toMatchObject({ status: 'failed', httpStatus: 404, message: expect.stringContaining('running older code') })
    await expect(loadSnapshot('/api/folders', denied)).resolves.toMatchObject({ status: 'failed', httpStatus: 403, message: 'Permission denied: x (HTTP 403)' })
  })
})
