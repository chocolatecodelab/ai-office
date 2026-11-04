import { createServer } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { probeHttp, probeTcp, systemHealth } from './health.js'

describe('system health', () => {
  it('reports an HTTP service as up, down, or unreachable', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('no', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await probeHttp('a', 'http://x/health', fetcher as unknown as typeof fetch)).toMatchObject({ ok: true, detail: 'menjawab' })
    expect(await probeHttp('b', 'http://x/health', fetcher as unknown as typeof fetch)).toMatchObject({ ok: false, detail: 'HTTP 503' })
    expect(await probeHttp('c', 'http://x/health', fetcher as unknown as typeof fetch)).toMatchObject({ ok: false, detail: 'tidak terjangkau' })
  })

  it('probes a TCP port that is open and one that is closed', async () => {
    const server = createServer().listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const port = (server.address() as { port: number }).port
    expect(await probeTcp('open', `redis://127.0.0.1:${port}`)).toMatchObject({ ok: true })
    await new Promise((resolve) => server.close(resolve))
    expect(await probeTcp('closed', `redis://127.0.0.1:${port}`)).toMatchObject({ ok: false, detail: 'tidak terjangkau' })
    expect(await probeTcp('bad', 'bukan alamat')).toMatchObject({ ok: false, detail: 'alamat tidak valid' })
  })

  it('checks the database, Redis, LiteLLM and every gateway, naming a gateway without a URL', async () => {
    const fetcher = vi.fn(async () => new Response('ok', { status: 200 }))
    const checks = await systemHealth({
      db: { query: async () => undefined }, redisUrl: 'bukan alamat', litellmUrl: 'http://litellm:4000/',
      gateways: [{ brandName: 'Official OTCA', url: 'http://otca:8642' }, { brandName: 'Info Jerman', url: undefined }],
      fetcher: fetcher as unknown as typeof fetch,
    })
    expect(checks.map((check) => [check.name, check.ok])).toEqual([['Postgres', true], ['Redis', false], ['LiteLLM', true], ['Hermes · Official OTCA', true], ['Hermes · Info Jerman', false]])
    expect(fetcher).toHaveBeenCalledWith('http://litellm:4000/health/liveliness', expect.anything())
    expect(checks[4].detail).toBe('belum dikonfigurasi')
  })
})
