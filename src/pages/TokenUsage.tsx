import { useState } from 'react'
import { formatCompact, formatNumber } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { UsageSnapshot } from '../types.ts'
import { USAGE_PERIODS, formatCost, sourceLabel, type Period } from '../usage.ts'

function share(part: number, whole: number): string {
  if (whole <= 0) return '0%'
  const value = (part / whole) * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

interface Row { key: string; label: string; value: number; detail: string; muted?: boolean; note?: string }

/** One horizontal bar per row, scaled to the largest; the exact numbers are in the tooltip. */
function BarRows({ label, rows, total, unit = 'tokens' }: { label: string; rows: Row[]; total: number; unit?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value))
  return <div className="usage-bars" role="list" aria-label={label}>{rows.map((row) => <div role="listitem" key={row.key} className={row.muted ? 'muted-row' : undefined} title={row.detail}>
    <span className="usage-name">{row.label}</span>
    <span className="usage-track">{row.note ? <em>{row.note}</em> : <i style={{ width: `${row.value > 0 ? Math.max(2, (row.value / max) * 100) : 0}%` }}/>}</span>
    <b>{row.note ? '' : formatCompact(row.value)}</b>
    <small>{row.note ? '' : unit === 'tokens' ? share(row.value, total) : ''}</small>
  </div>)}</div>
}

/** Token usage of every agent: totals, ranking by agent, by kind of work and by model. */
export function TokenUsage({ initialDays = 7 }: { initialDays?: Period }) {
  const [days, setDays] = useState<Period>(initialDays)
  const usage = usePolling<UsageSnapshot>(`/api/usage?days=${days}`, 60_000)
  const data = usage.status === 'ready' && Array.isArray(usage.data.agents) ? usage.data : undefined
  const totals = data?.totals
  const agentRows: Row[] = (data?.agents ?? []).map((agent) => agent.usage
    ? { key: agent.agent, label: agent.agent, value: agent.usage.totalTokens, muted: agent.usage.totalTokens === 0,
      detail: `${agent.agent}: ${formatNumber(agent.usage.totalTokens)} tokens (${formatNumber(agent.usage.inputTokens)} in / ${formatNumber(agent.usage.outputTokens)} out) · ${formatNumber(agent.usage.sessions)} sessions · est. ${formatCost(agent.usage.costUsd)}${agent.usage.topSession ? ` · biggest session ${formatNumber(agent.usage.topSession.tokens)} tokens (${agent.usage.topSession.date})` : ''}` }
    : { key: agent.agent, label: agent.agent, value: 0, muted: true, note: 'Not Available', detail: `${agent.agent}: ${agent.error ?? 'Claude insights could not be read.'}` })
  const sourceTotal = (data?.sources ?? []).reduce((sum, source) => sum + source.tokens, 0)
  const modelTotal = (data?.models ?? []).reduce((sum, model) => sum + model.tokens, 0)
  const top = data?.agents.find((agent) => (agent.usage?.totalTokens ?? 0) > 0)

  return <article className="card usage-card">
    <div className="usage-head">
      <p className="eyebrow">TOKEN USAGE · LAST {days === 1 ? '24 HOURS' : `${days} DAYS`}</p>
      <div className="period-toggle" role="group" aria-label="Period">{USAGE_PERIODS.map((period) => <button type="button" key={period} aria-pressed={days === period} className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period === 1 ? '24H' : `${period}D`}</button>)}</div>
    </div>
    {usage.status === 'pending' && <p className="muted">Membaca data penggunaan token kru Claude…</p>}
    {usage.status === 'failed' && <p className="muted">Not Available — {usage.message}</p>}
    {data && totals && <>
      <dl className="metric-grid">
        <div><dt>Total tokens</dt><dd>{formatCompact(totals.totalTokens)}</dd></div>
        <div><dt>Input / output</dt><dd>{formatCompact(totals.inputTokens)} / {formatCompact(totals.outputTokens)}</dd></div>
        <div><dt>Est. cost</dt><dd>{formatCost(totals.costUsd)}</dd></div>
        <div><dt>Sessions</dt><dd>{formatNumber(totals.sessions)}</dd></div>
        <div><dt>Messages</dt><dd>{formatNumber(totals.messages)}</dd></div>
        <div><dt>Tool calls</dt><dd>{formatNumber(totals.toolCalls)}</dd></div>
      </dl>
      {top?.usage && <p className="card-note">Top consumer: <b>{top.agent}</b> · {formatCompact(top.usage.totalTokens)} tokens · {share(top.usage.totalTokens, totals.totalTokens)} of all</p>}
      {totals.totalTokens === 0 && agentRows.every((row) => !row.note) ? <p className="muted">No sessions in this period.</p> : <div className="usage-sections">
        <section><h3>By agent</h3><BarRows label="Tokens by agent" rows={agentRows} total={totals.totalTokens}/></section>
        {data.sources.length > 0 && <section><h3>By kind of work</h3><BarRows label="Tokens by kind of work" total={sourceTotal} rows={data.sources.map((source) => ({ key: source.source, label: sourceLabel(source.source), value: source.tokens, detail: `${sourceLabel(source.source)}: ${formatNumber(source.tokens)} tokens · ${formatNumber(source.sessions)} sessions` }))}/></section>}
        {data.models.length > 0 && <section><h3>By model</h3><BarRows label="Tokens by model" total={modelTotal} rows={data.models.slice(0, 6).map((model) => ({ key: model.model, label: model.model, value: model.tokens, detail: `${model.model}: ${formatNumber(model.tokens)} tokens · ${formatNumber(model.sessions)} sessions` }))}/></section>}
        {data.tools.length > 0 && <section><h3>Top tools</h3><BarRows label="Tool calls" unit="calls" total={0} rows={data.tools.slice(0, 5).map((tool) => ({ key: tool.tool, label: tool.tool, value: tool.calls, detail: `${tool.tool}: ${formatNumber(tool.calls)} calls` }))}/></section>}
      </div>}
      <p className="card-note">Statistik penggunaan token model Claude per agen. Rincian per model dan peran kerja mencakup estimasi token percakapan dan eksekusi tool.</p>
    </>}
  </article>
}
