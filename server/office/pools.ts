// LiteLLM budget pools (blueprint Bab 10, L0-06). The same figures as POOLS in scripts/litellm-setup.mjs,
// which creates them; that script is the source, so change both together. Spend is read from the
// LiteLLM rows in cost_events, grouped by the model alias each pool may call.

export const LITELLM_POOLS = [
  { id: 'pool-umum', label: 'Umum (teks)', budgetUsd: 20, models: ['cepat', 'final'] },
  { id: 'pool-video', label: 'Video', budgetUsd: 20, models: ['video', 'cepat'] },
  { id: 'pool-gambar', label: 'Gambar', budgetUsd: 10, models: ['gambar'] },
] as const

// Alerts at 50, 80 and 100 percent of the budget (docs/PLAN.md: "alert budget 50/80/100%").
export type PoolAlert = 'ok' | '50' | '80' | 'over'

export interface PoolStatus { id: string; label: string; budgetUsd: number; models: string[]; spentUsd: number; percent: number; alert: PoolAlert }

export function poolStatuses(models: Array<{ source: string; model: string; costUsd: number }>): PoolStatus[] {
  return LITELLM_POOLS.map((pool) => {
    const spentUsd = models
      .filter((row) => row.source === 'litellm' && (pool.models as readonly string[]).includes(row.model))
      .reduce((sum, row) => sum + row.costUsd, 0)
    const percent = pool.budgetUsd > 0 ? (spentUsd / pool.budgetUsd) * 100 : 0
    const alert: PoolAlert = percent >= 100 ? 'over' : percent >= 80 ? '80' : percent >= 50 ? '50' : 'ok'
    return { id: pool.id, label: pool.label, budgetUsd: pool.budgetUsd, models: [...pool.models], spentUsd, percent, alert }
  })
}
