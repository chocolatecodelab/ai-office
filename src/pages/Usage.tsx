import { useState } from 'react'
import { formatCompact, formatNumber } from '../format.ts'
import { AGENT_NAMES, type LangfuseUsage, type OfficeUsage, type UsageFigures } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { PageTitle } from '../ui.tsx'
import { USAGE_PERIODS, formatCost, type Period } from '../usage.ts'
import { BarRows, type Row } from './TokenUsage.tsx'

const SOURCE_NAMES: Record<string, string> = { codex: 'Codex · ChatGPT Plus', litellm: 'Claude via LiteLLM' }

function usageRow(key: string, label: string, figures: UsageFigures): Row {
  return {
    key, label, value: figures.tokens,
    detail: `${label}: ${formatNumber(figures.tokens)} token (${formatNumber(figures.inputTokens)} input / ${formatNumber(figures.outputTokens)} output) · ${formatNumber(figures.runs)} run`,
  }
}

/** Token use of the whole office from Postgres, with Langfuse's view of the same model calls beside it. */
export function Usage() {
  const [days, setDays] = useState<Period>(7)
  const usage = usePolling<OfficeUsage>(`/api/office/usage?days=${days}`, 60_000)
  return <>
    <PageTitle eyebrow="USAGE" title="Usage">Pemakaian token dan estimasi biaya kantor per brand, agen, jenis pekerjaan, dan model, dibandingkan dengan pembacaan Langfuse.</PageTitle>
    <article className="card usage-card">
      <div className="usage-head">
        <p className="eyebrow">TOKEN · {days === 1 ? '24 JAM' : `${days} HARI`}</p>
        <div className="period-toggle" role="group" aria-label="Periode">{USAGE_PERIODS.map((period) => <button type="button" key={period} aria-pressed={days === period} className={days === period ? 'active' : ''} onClick={() => setDays(period)}>{period === 1 ? '24H' : `${period}D`}</button>)}</div>
      </div>
      {usage.status === 'pending' && <p className="muted">Membaca pemakaian kantor…</p>}
      {usage.status === 'failed' && <p className="muted">Belum tersedia — {usage.message}</p>}
      {usage.status === 'ready' && <UsageBody data={usage.data}/>}
    </article>
  </>
}

function UsageBody({ data }: { data: OfficeUsage }) {
  const { totals } = data
  if (totals.runs === 0) return <p className="muted">Belum ada pemakaian dalam periode ini.</p>
  return <>
    <dl className="metric-grid">
      <div><dt>Total token</dt><dd>{formatCompact(totals.tokens)}</dd></div>
      <div><dt>Input / output</dt><dd>{formatCompact(totals.inputTokens)} / {formatCompact(totals.outputTokens)}</dd></div>
      <div><dt>Run</dt><dd>{formatNumber(totals.runs)}</dd></div>
      <div><dt>Biaya LiteLLM</dt><dd>{formatCost(totals.costUsd)}</dd></div>
    </dl>
    <p className="card-note">Input termasuk token yang dibaca dari cache. Codex berjalan di langganan ChatGPT Plus, jadi tidak dihitung per token; biaya di atas hanya dari LiteLLM.</p>
    <div className="usage-sections">
      <section><h3>Per brand</h3><BarRows label="Token per brand" total={totals.tokens} rows={data.brands.map((brand) => usageRow(brand.brandId, brand.label, brand))}/></section>
      <section><h3>Per agen</h3><BarRows label="Token per agen" total={totals.tokens} rows={data.agents.map((agent) => usageRow(`${agent.brandId}/${agent.agentType}`, `${AGENT_NAMES[agent.agentType] ?? agent.agentType} · ${agent.brandName}`, agent))}/></section>
      <section><h3>Per jenis pekerjaan</h3><BarRows label="Token per jenis pekerjaan" total={totals.tokens} rows={data.kinds.map((kind) => usageRow(kind.kind, kind.kind, kind))}/></section>
      <section><h3>Per model</h3><BarRows label="Token per model" total={totals.tokens} rows={data.models.map((model) => usageRow(`${model.source}/${model.model}`, `${SOURCE_NAMES[model.source] ?? model.source} · ${model.model}`, model))}/></section>
    </div>
    <LangfuseSection langfuse={data.langfuse}/>
  </>
}

function LangfuseSection({ langfuse }: { langfuse: LangfuseUsage }) {
  return <section className="usage-langfuse">
    <h3>Langfuse</h3>
    {langfuse.status === 'off' && <p className="muted">Belum terhubung. Isi LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY, dan LANGFUSE_SECRET_KEY di infra/env/observability.env.</p>}
    {langfuse.status === 'error' && <p className="muted">Langfuse belum bisa dibaca — {langfuse.message}</p>}
    {langfuse.status === 'ok' && <>
      <dl className="metric-grid">
        <div><dt>Generasi</dt><dd>{formatNumber(langfuse.generations)}</dd></div>
        <div><dt>Input / output</dt><dd>{formatCompact(langfuse.inputTokens)} / {formatCompact(langfuse.outputTokens)}</dd></div>
        <div><dt>Estimasi biaya</dt><dd>{formatCost(langfuse.costUsd)}</dd></div>
      </dl>
      <BarRows label="Langfuse per model" total={langfuse.inputTokens + langfuse.outputTokens} rows={langfuse.models.map((model) => usageRow(model.model, model.model, { runs: model.generations, tokens: model.inputTokens + model.outputTokens, inputTokens: model.inputTokens, outputTokens: model.outputTokens, costUsd: model.costUsd }))}/>
      <p className="card-note">Lingkungan: {langfuse.environments.join(', ') || '—'}. Estimasi biaya dari tabel harga Langfuse, bukan tagihan ChatGPT Plus.</p>
    </>}
  </section>
}
