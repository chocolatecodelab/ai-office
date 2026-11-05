import { useState } from 'react'
import { AGENT_NAMES, type OfficeUsage, type UsageFigures } from '../office-api.ts'
import { formatCompact, formatNumber } from '../format.ts'
import { formatCost, formatRupiah } from '../usage.ts'

export type UsageDimension='brands'|'agents'|'kinds'|'models'
export type UsageMetric='tokens'|'runs'|'costUsd'
const DIMENSIONS:Record<UsageDimension,string>={brands:'Brand',agents:'Agent',kinds:'Jenis pekerjaan',models:'Model'}
const METRICS:Record<UsageMetric,string>={tokens:'Token',runs:'Eksekusi',costUsd:'Biaya LiteLLM (USD)'}
const KIND_LABELS:Record<string,string>={'konten.chat':'Percakapan','konten.brief':'Brief konten','konten.caption':'Caption','konten.carousel':'Carousel','konten.script':'Naskah video','event.tema':'Tema event','event.brief':'Brief event','video.storyboard':'Storyboard','video.edit-plan':'Rencana editing','publikasi.kalender':'Kalender publikasi','publikasi.caption':'Caption publikasi','iklan.brief':'Brief iklan','iklan.copy':'Teks iklan'}
type ChartRow=UsageFigures & {id:string;label:string;context?:string}

export function UsageBreakdown({data,dimension,metric,onDimension,onMetric,period}:{data:OfficeUsage;dimension:UsageDimension;metric:UsageMetric;onDimension:(value:UsageDimension)=>void;onMetric:(value:UsageMetric)=>void;period:string}) {
  const [expanded,setExpanded]=useState<string>()
  const rows:ChartRow[]=dimension==='brands'?data.brands.map(b=>({...b,id:b.brandId,label:b.label})):dimension==='agents'?data.agents.map(a=>({...a,id:`${a.brandId}/${a.agentType}`,label:AGENT_NAMES[a.agentType] ?? a.agentType,context:a.brandName})):dimension==='kinds'?data.kinds.map(k=>({...k,id:k.kind,label:KIND_LABELS[k.kind] ?? k.kind})):data.models.map(m=>({...m,id:`${m.source}/${m.model}`,label:m.model,context:m.source==='codex'?'Codex · ChatGPT Plus':m.source==='litellm'?'LiteLLM':m.source}))
  const sorted=[...rows].sort((a,b)=>b[metric]-a[metric] || a.label.localeCompare(b.label))
  const maximum=Math.max(0,...rows.map(r=>r[metric]))
  const total=rows.reduce((sum,r)=>sum+r[metric],0)
  const valueLabel=(value:number)=>metric==='costUsd'?formatCost(value):formatCompact(value)
  return <section className="analytics-panel usage-breakdown" aria-label="Distribusi pemakaian"><div className="analytics-panel-heading"><div><h2>Distribusi pemakaian</h2><p>Urutan terbesar ke terkecil. Pilih baris untuk melihat rinciannya.</p></div><label>Ukuran grafik<select value={metric} onChange={e=>onMetric(e.target.value as UsageMetric)}>{Object.entries(METRICS).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label></div>
    <div className="breakdown-dimensions" role="group" aria-label="Kelompok pemakaian">{Object.entries(DIMENSIONS).map(([key,label])=><button key={key} aria-pressed={dimension===key} onClick={()=>{setExpanded(undefined);onDimension(key as UsageDimension)}}>{label}</button>)}</div>
    {sorted.length===0 ? <p className="analytics-empty">Belum ada rincian {DIMENSIONS[dimension].toLowerCase()} untuk periode ini.</p> : <figure className="ranking-chart"><div className="chart-legend"><span>{METRICS[metric]} per {DIMENSIONS[dimension].toLowerCase()}</span>{metric==='tokens' && <span><i className="legend-input"/>Input <i className="legend-output"/>Output</span>}</div>{maximum>0 && <div className="chart-axis" aria-hidden="true"><span>{valueLabel(0)}</span><span>{valueLabel(maximum/2)}</span><span>{valueLabel(maximum)}</span></div>}
      {maximum===0 && <p className="analytics-empty">{metric==='costUsd'?'Belum ada biaya LiteLLM yang tercatat pada kelompok ini.':'Semua nilai pada kelompok ini masih nol.'}</p>}
      <ol className="ranking-list">{sorted.map(row=><li key={row.id}><button className="ranking-row" aria-expanded={expanded===row.id} onClick={()=>setExpanded(expanded===row.id?undefined:row.id)}><span className="ranking-label"><strong>{row.label}</strong>{row.context && <small>{row.context}</small>}</span><span className="ranking-track" aria-hidden="true">{metric==='tokens'?<><span className="ranking-input" style={{width:`${maximum>0?row.inputTokens/maximum*100:0}%`}}/><span className="ranking-output" style={{width:`${maximum>0?row.outputTokens/maximum*100:0}%`}}/></>:<span style={{width:`${maximum>0?row[metric]/maximum*100:0}%`}}/>}</span><span className="ranking-value"><strong>{valueLabel(row[metric])}</strong><small>{total>0?`${(row[metric]/total*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`:'0%'}</small></span></button>
        {expanded===row.id && <dl className="ranking-details"><div><dt>Input</dt><dd>{formatNumber(row.inputTokens)} token</dd></div><div><dt>Output</dt><dd>{formatNumber(row.outputTokens)} token</dd></div><div><dt>Eksekusi</dt><dd>{formatNumber(row.runs)}</dd></div><div><dt>Biaya LiteLLM</dt><dd>{formatCost(row.costUsd)} · ≈ {formatRupiah(row.costUsd)}</dd></div></dl>}
      </li>)}</ol><figcaption>Sumbu horizontal: {METRICS[metric].toLowerCase()}. Sumber: catatan eksekusi kantor · {period}. Persentase dihitung dari total kelompok; grafik menggunakan skala yang sama untuk semua baris.</figcaption>
    </figure>}
  </section>
}
