import { describe, expect, it } from 'vitest'
import { LITELLM_POOLS, poolStatuses } from './pools.js'

describe('LiteLLM pools', () => {
  it('keeps the blueprint budgets: umum $20, video $20, gambar $10', () => {
    expect(Object.fromEntries(LITELLM_POOLS.map((pool) => [pool.id, pool.budgetUsd]))).toEqual({ 'pool-umum': 20, 'pool-video': 20, 'pool-gambar': 10 })
  })

  it('counts only LiteLLM spend, by the aliases each pool may call', () => {
    const [umum, video, gambar] = poolStatuses([
      { source: 'litellm', model: 'final', costUsd: 4 },
      { source: 'litellm', model: 'cepat', costUsd: 1 },
      { source: 'litellm', model: 'video', costUsd: 2 },
      { source: 'litellm', model: 'gambar', costUsd: 3 },
      { source: 'codex', model: 'gpt-6-sol', costUsd: 99 },
    ])
    expect(umum.spentUsd).toBe(5)
    expect(video.spentUsd).toBe(3)
    expect(gambar.spentUsd).toBe(3)
  })

  it('raises the alert at 50, 80 and 100 percent of the budget', () => {
    const alertFor = (spent: number) => poolStatuses([{ source: 'litellm', model: 'gambar', costUsd: spent }]).find((pool) => pool.id === 'pool-gambar')?.alert
    expect(alertFor(4.99)).toBe('ok')
    expect(alertFor(5)).toBe('50')
    expect(alertFor(8)).toBe('80')
    expect(alertFor(10)).toBe('over')
  })
})
