import { useEffect, useRef, useState } from 'react'
import { AGENT_NAMES, type OfficeBrand, type OfficeTask } from '../office-api.ts'
import { Dialog } from '../ui.tsx'
import { OfficeTaskForm } from './OfficeTaskForm.tsx'

export function TaskComposer({ brands, initialBrand, onClose, onCreated }: { brands: OfficeBrand[]; initialBrand?: string; onClose: () => void; onCreated: (task: OfficeTask) => void }) {
  const eligible = brands.filter(b => !b.paused && b.agents.some(a => a.active && !a.paused))
  const [brandId,setBrandId] = useState(() => eligible.find(b=>b.id===initialBrand)?.id ?? eligible[0]?.id ?? '')
  const brand = eligible.find(b=>b.id===brandId)
  const agents = brand?.agents.filter(a=>a.active && !a.paused) ?? []
  const [agentType,setAgentType] = useState('')
  const agent = agents.find(a=>a.agentType===agentType) ?? agents.find(a=>a.agentType==='manager') ?? agents[0]
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const lock = useRef(false)
  const previous = useRef(document.activeElement as HTMLElement|null)
  useEffect(()=>()=>previous.current?.focus(),[])
  const submit = async (work:()=>Promise<unknown>) => {
    if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {await work()} catch(e) {setError(e instanceof Error ? e.message : 'Tugas belum terkirim. Coba lagi.')} finally {lock.current=false;setBusy(false)}
  }
  return <Dialog labelledBy="task-composer-title" closeLabel="Tutup formulir tugas" onClose={onClose} className="task-composer">
    <header><h2 id="task-composer-title">Beri tugas</h2><p>Pilih tim penerima, lalu jelaskan hasil yang Anda butuhkan.</p></header>
    {eligible.length===0 ? <p role="status">Belum ada agent yang siap menerima tugas. Lanjutkan agent atau brand dari halaman Agent.</p> : <>
      <div className="task-recipient"><label>Brand<select disabled={busy} value={brandId} onChange={e=>{setBrandId(e.target.value);setAgentType('')}}>{eligible.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
      <label>Agent penerima<select disabled={busy} value={agent?.agentType ?? ''} onChange={e=>setAgentType(e.target.value)}>{agents.map(a=><option value={a.agentType} key={a.agentType}>{AGENT_NAMES[a.agentType] ?? a.agentType}</option>)}</select></label></div>
      {error && <p role="alert">{error}</p>}
      {brand && agent && <OfficeTaskForm key={`${brand.id}/${agent.agentType}`} expanded brand={brand.id} agent={agent.agentType} disabled={busy} submit={submit} onCreated={onCreated}/>}
      {busy && <p role="status">Mengirim tugas…</p>}
    </>}
  </Dialog>
}
