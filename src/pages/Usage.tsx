import { useState } from 'react'
import { formatCompact, formatNumber } from '../format.ts'
import { AGENT_NAMES, type LangfuseUsage, type OfficeUsage } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { PageTitle } from '../ui.tsx'
import { USAGE_PERIODS, formatCost, formatRupiah, USD_TO_IDR, type Period } from '../usage.ts'
import { UsageBreakdown, type UsageDimension, type UsageMetric } from '../components/UsageBreakdown.tsx'

export function Usage() {
  const [days,setDays]=useState<Period>(7)
  const [dimension,setDimension]=useState<UsageDimension>('brands')
  const [metric,setMetric]=useState<UsageMetric>('tokens')
  return <div className="management-page usage-page usage-analytics">
    <div className="analytics-heading"><PageTitle eyebrow="PEMAKAIAN" title="Pemakaian">Lihat ke mana token digunakan dan pahami estimasi biaya kerja tim.</PageTitle><div className="period-toggle" role="group" aria-label="Periode">{USAGE_PERIODS.map(period=><button type="button" key={period} aria-pressed={days===period} className={days===period?'active':''} onClick={()=>setDays(period)}>{period===1?'24 jam':`${period} hari`}</button>)}</div></div>
    {/* Mount a fresh reader so a late request cannot relabel the previous period's data. */}
    <UsageReport key={days} days={days} dimension={dimension} metric={metric} onDimension={setDimension} onMetric={setMetric}/>
    <p className="analytics-rate">Kurs tampilan: US$1 = Rp{USD_TO_IDR.toLocaleString('id-ID')} · kurs tetap dari Anda, bukan kurs otomatis. Estimasi rupiah dibulatkan ke rupiah penuh.</p>
  </div>
}

function UsageReport({days,dimension,metric,onDimension,onMetric}:{days:Period;dimension:UsageDimension;metric:UsageMetric;onDimension:(value:UsageDimension)=>void;onMetric:(value:UsageMetric)=>void}) {
  const usage=usePolling<OfficeUsage>(`/api/office/usage?days=${days}`,60000)
  if(usage.status==='pending')return <section className="analytics-state" role="status" aria-busy="true"><h2>Memuat pemakaian {days===1?'24 jam':`${days} hari`}…</h2><p>Menyiapkan catatan kantor dan pembacaan Langfuse.</p></section>
  if(usage.status==='failed')return <section className="analytics-state" role="alert"><h2>Pemakaian belum dapat dimuat</h2><p>{usage.message}</p><button className="refresh-button" onClick={usage.refresh}>Coba lagi</button></section>
  const data=usage.data,{totals}=data
  const topBrand=[...(data.brands ?? [])].sort((a,b)=>b.tokens-a.tokens)[0]
  const topAgent=[...(data.agents ?? [])].sort((a,b)=>b.tokens-a.tokens)[0]
  const period=days===1?'24 jam terakhir':`${days} hari terakhir`
  return <>
    <div className="analytics-source"><span>Catatan kantor · {period}</span><span role="status">{usage.stale?'Menampilkan data terakhir · pembaruan gagal':usage.refreshing?'Memperbarui data…':'Diperbarui otomatis setiap menit'}</span><button className="refresh-button" onClick={usage.refresh} disabled={usage.refreshing}>Segarkan pemakaian</button></div>
    {totals.runs===0 ? <section className="analytics-state"><h2>Belum ada pemakaian kantor dalam periode ini.</h2><p>Pilih periode lain atau kembali setelah tim menyelesaikan pekerjaan.</p></section> : <>
      <dl className="analytics-summary">
        <div className="summary-primary"><dt>Total token</dt><dd title={formatNumber(totals.tokens)}>{formatCompact(totals.tokens)}</dd><span>{period}</span></div>
        <div><dt>Eksekusi</dt><dd>{formatNumber(totals.runs)}</dd><span>Proses yang tercatat di kantor</span></div>
        <div><dt>Rata-rata per eksekusi</dt><dd title={formatNumber(Math.round(totals.tokens/totals.runs))}>{formatCompact(totals.tokens/totals.runs)}</dd><span>token per proses</span></div>
        <div><dt>Biaya LiteLLM</dt><dd>{formatCost(totals.costUsd)}</dd><span className="summary-idr">≈ {formatRupiah(totals.costUsd)}</span></div>
      </dl>
      <div className="analytics-overview"><section className="analytics-panel token-composition"><h2>Komposisi token</h2><p>Input mencakup token dari cache.</p><TokenComposition input={totals.inputTokens} output={totals.outputTokens}/></section>
      <section className="analytics-insights"><h2>Sorotan periode ini</h2>{totals.tokens===0 && <p>Belum ada konsumsi token yang tercatat untuk membandingkan tim.</p>}{topBrand && topBrand.tokens>0 && <p><span>Brand dengan penggunaan terbesar</span><strong>{topBrand.label}</strong><small>{formatNumber(topBrand.tokens)} token{totals.tokens>0?` · ${(topBrand.tokens/totals.tokens*100).toLocaleString('id-ID',{maximumFractionDigits:1})}% dari total kantor`:''}</small></p>}{topAgent && topAgent.tokens>0 && <p><span>Agent dengan penggunaan terbesar</span><strong>{AGENT_NAMES[topAgent.agentType] ?? topAgent.agentType} <small>· {topAgent.brandName}</small></strong><small>{formatNumber(topAgent.tokens)} token · {formatNumber(topAgent.runs)} eksekusi</small></p>}</section></div>
      <UsageBreakdown data={data} dimension={dimension} metric={metric} onDimension={onDimension} onMetric={onMetric} period={period}/>
      <p className="analytics-footnote">Sumber: catatan eksekusi kantor. Codex memakai langganan ChatGPT Plus; biaya LiteLLM di atas hanya mencatat pemakaian layanan berbayar melalui LiteLLM.</p>
    </>}
    <LangfuseSection langfuse={data.langfuse} period={period}/>
  </>
}

function TokenComposition({input,output}:{input:number;output:number}) {
  const total=input+output
  if(total===0)return <p className="analytics-empty">Belum ada token input atau output yang tercatat.</p>
  const share=(value:number)=>total>0?(value/total*100):0
  return <figure className="composition-figure"><div className="composition-track" aria-hidden="true"><span style={{width:`${share(input)}%`}}/><span style={{width:`${share(output)}%`}}/></div><figcaption><div><span><i className="legend-input"/>Input</span><strong>{formatNumber(input)}</strong><small>{share(input).toLocaleString('id-ID',{maximumFractionDigits:1})}%</small></div><div><span><i className="legend-output"/>Output</span><strong>{formatNumber(output)}</strong><small>{share(output).toLocaleString('id-ID',{maximumFractionDigits:1})}%</small></div></figcaption></figure>
}

function LangfuseSection({langfuse,period}:{langfuse:LangfuseUsage;period:string}) {
  const [metric,setMetric]=useState<'tokens'|'cost'>('cost')
  const models=[...(langfuse.models ?? [])].sort((a,b)=>metric==='cost'?b.costUsd-a.costUsd:(b.inputTokens+b.outputTokens)-(a.inputTokens+a.outputTokens))
  const maximum=Math.max(0,...models.map(m=>metric==='cost'?m.costUsd:m.inputTokens+m.outputTokens))
  const valueLabel=(value:number)=>metric==='cost'?formatCost(value):formatCompact(value)
  return <section className="analytics-panel langfuse-analytics" aria-label="Pembacaan Langfuse"><div className="analytics-panel-heading"><div><h2>Pembacaan Langfuse</h2><p>Estimasi observabilitas · {period}</p></div><span className="neutral-tag">{langfuse.status==='ok'?'Terhubung':langfuse.status==='off'?'Belum terhubung':'Belum tersedia'}</span></div>
    {langfuse.status==='off' && <p>Hubungkan Langfuse melalui konfigurasi layanan untuk menampilkan estimasi model.</p>}
    {langfuse.status==='error' && <p role="status">Langfuse belum bisa dibaca. Catatan kantor di atas tetap dapat digunakan.{langfuse.message && <span className="analytics-error-detail"> {langfuse.message}</span>}</p>}
    {langfuse.status==='ok' && <><dl className="langfuse-summary"><div><dt>Estimasi biaya model</dt><dd>{formatCost(langfuse.costUsd)}</dd><span>≈ {formatRupiah(langfuse.costUsd)}</span></div><div><dt>Total token terpantau</dt><dd>{formatCompact(langfuse.inputTokens+langfuse.outputTokens)}</dd><span>{formatCompact(langfuse.inputTokens)} input / {formatCompact(langfuse.outputTokens)} output</span></div><div><dt>Generasi</dt><dd>{formatNumber(langfuse.generations)}</dd><span>Panggilan yang tercatat di Langfuse</span></div></dl>
      {models.length>0 && <figure className="langfuse-model-chart"><div className="analytics-panel-heading"><h3>Penggunaan per model</h3><label>Ukuran Langfuse<select value={metric} onChange={e=>setMetric(e.target.value as 'tokens'|'cost')}><option value="cost">Estimasi biaya (USD)</option><option value="tokens">Token</option></select></label></div>{maximum>0 && <div className="chart-axis" aria-hidden="true"><span>{valueLabel(0)}</span><span>{valueLabel(maximum/2)}</span><span>{valueLabel(maximum)}</span></div>}{models.map(model=>{const value=metric==='cost'?model.costUsd:model.inputTokens+model.outputTokens;return <div className="model-chart-row" key={model.model}><div><strong>{model.model}</strong><span>{valueLabel(value)}{metric==='cost'?` · ≈ ${formatRupiah(value)}`:''}</span></div><div className="ranking-track" aria-hidden="true"><span style={{width:`${maximum>0?value/maximum*100:0}%`}}/></div></div>})}<figcaption>Sumbu horizontal: {metric==='cost'?'estimasi biaya dalam USD':'jumlah token'}. Sumber: Langfuse · {period}. Nilai ditampilkan pada setiap model; angka biaya dibulatkan untuk tampilan.</figcaption></figure>}
      <p className="analytics-footnote">Estimasi dari tabel harga Langfuse, bukan tagihan ChatGPT Plus. Cakupan pelacakan dapat berbeda dari catatan kantor; kedua sumber tidak dijumlahkan.</p><details className="analytics-environments"><summary>Lingkungan yang dipantau</summary><p>{langfuse.environments.join(', ') || 'Belum ada lingkungan tercatat.'}</p></details>
    </>}
  </section>
}
