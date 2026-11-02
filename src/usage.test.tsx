import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TokenUsage } from './pages/TokenUsage.tsx'
import { formatCost, sourceLabel } from './usage.ts'

describe('token usage view', () => {
  it('labels kinds of work and formats estimated costs', () => {
    expect(sourceLabel('kanban')).toBe('Kanban tasks')
    expect(sourceLabel('cron')).toBe('Cron jobs')
    expect(sourceLabel('matrix')).toBe('Matrix')
    expect(formatCost(undefined)).toBe('—')
    expect(formatCost(0.0123)).toBe('$0.0123')
    expect(formatCost(27.584)).toBe('$27.58')
  })

  it('offers the three periods and starts by loading every agent', () => {
    const markup = renderToStaticMarkup(<TokenUsage/>)
    expect(markup).toContain('TOKEN USAGE · LAST 7 DAYS')
    for (const label of ['24H', '7D', '30D']) expect(markup).toContain(`>${label}<`)
    expect(markup).toContain('Membaca data penggunaan token kru Claude')
  })
})
