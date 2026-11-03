import { describe, expect, it, vi } from 'vitest'
import { langfuseUsage } from './langfuse-usage.js'

const config = { baseUrl: 'https://langfuse.example', publicKey: 'pk-test', secretKey: 'sk-test' }
const now = new Date('2026-11-03T12:00:00Z')

function page(data: unknown[], cursor?: string): Response {
  return new Response(JSON.stringify({ data, meta: { cursor: cursor ?? null } }), { status: 200 })
}

describe('langfuse usage', () => {
  it('reads nothing when Langfuse is not configured', async () => {
    const fetcher = vi.fn()
    expect(await langfuseUsage(undefined, 7, now, fetcher as unknown as typeof fetch)).toMatchObject({ status: 'off', generations: 0 })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('follows the cursor and sums generations per model, leaving out other observation types', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(page(Array.from({ length: 500 }, (_, index) => ({ type: index === 0 ? 'CHAIN' : 'GENERATION', model: 'gpt-6-sol', environment: 'ai-office-l1', usageDetails: { input: 10, output: 2 }, costDetails: { total: 0.001 } })), 'next'))
      .mockResolvedValueOnce(page([{ type: 'GENERATION', model: 'claude-sonnet-5-5', environment: 'ai-office-l2', usageDetails: { input: 5, output: 1, cache_read_input_tokens: 100 }, costDetails: { total: 0.5 } }]))

    const usage = await langfuseUsage(config, 7, now, fetcher as unknown as typeof fetch)

    expect(usage.status).toBe('ok')
    expect(usage.generations).toBe(500)
    expect(usage.models.map((row) => row.model)).toEqual(['gpt-6-sol', 'claude-sonnet-5-5'])
    expect(usage.models[0]).toMatchObject({ generations: 499, inputTokens: 4990, outputTokens: 998 })
    expect(usage.models[1]).toMatchObject({ inputTokens: 105, outputTokens: 1 })
    expect(usage.environments).toEqual(['ai-office-l1', 'ai-office-l2'])
    expect(fetcher.mock.calls[1][0]).toContain('cursor=next')
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: `Basic ${Buffer.from('pk-test:sk-test').toString('base64')}` })
  })

  it('reports Langfuse errors without failing the page', async () => {
    const fetcher = vi.fn(async () => new Response('forbidden', { status: 403 }))
    expect(await langfuseUsage(config, 1, now, fetcher as unknown as typeof fetch)).toMatchObject({ status: 'error', message: 'Langfuse menjawab HTTP 403.' })
  })
})
