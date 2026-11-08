import { useState } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, type AgentStatus, type OfficeBrand } from '../office-api.ts'

const PRIORITY:Partial<Record<AgentStatus,number>>={error:0,waiting_approval:1,waiting_quota:2}
export function OfficeAttention({brands,onSelect}:{brands:OfficeBrand[];onSelect:(id:string,brand:string)=>void}) {
  const [filter,setFilter]=useState('all')
  const [expanded,setExpanded]=useState(false)
  const items=brands.flatMap(brand=>brand.agents.filter(agent=>agent.active && PRIORITY[agent.status]!==undefined).map(agent=>({brand,agent})))
    .sort((a,b)=>(PRIORITY[a.agent.status] ?? 3)-(PRIORITY[b.agent.status] ?? 3) || a.brand.name.localeCompare(b.brand.name) || a.agent.agentType.localeCompare(b.agent.agentType))
  const filtered=items.filter(item=>filter==='all'||item.agent.status===filter)
  const shown=expanded?filtered:filtered.slice(0,4)
  return <section className="office-attention" aria-label="Antrean perlu perhatian">
    <h2>Perlu perhatian <span className="attention-count">{items.length}</span></h2><p>Semua brand · kendala, persetujuan, lalu kuota.</p>
    {items.length>0 && <label className="attention-filter">Tampilkan<select value={filter} onChange={e=>{setFilter(e.target.value);setExpanded(false)}}><option value="all">Semua kebutuhan</option><option value="error">Kendala</option><option value="waiting_approval">Menunggu persetujuan</option><option value="waiting_quota">Menunggu kuota</option></select></label>}
    {shown.map(({brand,agent})=><button key={`${brand.id}/${agent.agentType}`} onClick={()=>onSelect(`${brand.id}/${agent.agentType}`,brand.id)}><span data-status={agent.status}>{AGENT_STATUS_LABELS[agent.status]}</span><strong>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</strong><small>{brand.name}</small>{agent.currentTask && <small>{agent.currentTask}</small>}</button>)}
    {items.length===0 ? <p>Tidak ada agent yang menunggu tindak lanjut.</p> : filtered.length===0 ? <p role="status">Tidak ada agent dalam kategori ini.</p> : <p role="status">Menampilkan {shown.length} dari {filtered.length} agent{filter==='all'?' di semua brand':''}.</p>}
    {filtered.length>4 && <button className="attention-show-all" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'Ringkas daftar':`Lihat semua ${filtered.length} agent`}</button>}
  </section>
}
