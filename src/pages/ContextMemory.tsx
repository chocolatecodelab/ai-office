import { useEffect, useState } from 'react'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, officeRequest, type OfficeBrand } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'

interface ContextFile { path: string; content: string }

/** The official context an agent works from (context/ in the repo), read only. Changes go through a PR. */
export function Memory() {
  const brands = usePolling<OfficeBrand[]>('/api/office/brands', 60_000)
  const [brandId, setBrandId] = useState<string>()
  const [agentType, setAgentType] = useState<string>()
  const [files, setFiles] = useState<ContextFile[]>()
  const [open, setOpen] = useState<string>()
  const [error, setError] = useState<string>()

  const ordered = brands.status === 'ready' ? [...brands.data].sort((a, b) => FLOOR_ORDER.indexOf(a.id) - FLOOR_ORDER.indexOf(b.id)) : []
  const brand = ordered.find((item) => item.id === brandId) ?? ordered[0]
  const agent = brand?.agents.find((item) => item.agentType === agentType && item.active) ?? brand?.agents.find((item) => item.active)
  const brandKey = brand?.id
  const agentKey = agent?.agentType

  useEffect(() => {
    if (!brandKey || !agentKey) return
    let current = true
    setFiles(undefined)
    setOpen(undefined)
    setError(undefined)
    officeRequest<ContextFile[]>('GET', `/brands/${brandKey}/agents/${agentKey}/context`)
      .then((data) => { if (current) setFiles(data) })
      .catch((failure: unknown) => { if (current) setError(failure instanceof Error ? failure.message : String(failure)) })
    return () => { current = false }
  }, [brandKey, agentKey])

  if (brands.status === 'pending') return <><PageTitle eyebrow="MEMORY" title="Memory"/><LoadingState message="Memuat brand dan agent..."/></>
  if (brands.status === 'failed' || !brand || !agent) return <><PageTitle eyebrow="MEMORY" title="Memory"/><EmptyState title="Tidak tersedia">Daftar agent belum dapat dimuat.</EmptyState></>

  const shown = files?.find((file) => file.path === open)
  return <>
    <PageTitle eyebrow="MEMORY" title="Memory">Konteks resmi yang dibawa setiap agent: definisi peran, aturan bersama, dan data brand. Hanya dibaca; perubahan lewat PR ke folder context/, lalu restart service.</PageTitle>
    <div className="toolbar" role="group" aria-label="Brand">
      {ordered.map((item) => <button type="button" key={item.id} className={`chip chip-button ${item.id === brand.id ? 'active' : ''}`} aria-pressed={item.id === brand.id} onClick={() => setBrandId(item.id)}>{item.name}</button>)}
    </div>
    <div className="toolbar" role="group" aria-label="Agent">
      {brand.agents.filter((item) => item.active).map((item) => <button type="button" key={item.agentType} className={`chip chip-button ${item.agentType === agent.agentType ? 'active' : ''}`} aria-pressed={item.agentType === agent.agentType} onClick={() => setAgentType(item.agentType)}>{AGENT_NAMES[item.agentType] ?? item.agentType}</button>)}
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!files && !error && <p className="muted">Membaca konteks…</p>}
    {files && <section className="data-list">{files.map((file) => <article key={file.path}>
      <div><h2>{file.path}</h2><p>{file.content.length.toLocaleString('id-ID')} karakter{file.content.includes('[RESMI') ? ' · memuat bagian [RESMI]' : ''}</p></div>
      <button type="button" className="refresh-button" aria-expanded={open === file.path} onClick={() => setOpen(open === file.path ? undefined : file.path)}>{open === file.path ? 'Tutup' : 'Lihat'}</button>
    </article>)}</section>}
    {shown && <section className="card" aria-live="polite"><p className="eyebrow">{shown.path}</p><pre className="office-result">{shown.content}</pre></section>}
  </>
}
