import { useEffect, useState } from 'react'
import { AgentNotes } from '../components/AgentNotes.tsx'
import { ReadOnlyMarkdown } from '../components/ReadOnlyMarkdown.tsx'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, officeRequest, type OfficeBrand } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'

interface ContextFile { path: string; content: string }
const FILE_LABELS:Record<string,string> = {'aturan-umum.md':'Aturan umum','approval-matrix.md':'Alur persetujuan','raci.md':'Pembagian tanggung jawab','batas-tanggung-jawab.md':'Batas tanggung jawab','brand.md':'Panduan brand','visual.json':'Identitas visual','checklist-publikasi.md':'Checklist publikasi'}
function fileLabel(path:string) {const name=path.split('/').pop() ?? path;return FILE_LABELS[name] ?? (AGENT_NAMES[name.replace('.md','')] ? `Peran ${AGENT_NAMES[name.replace('.md','')]}` : name)}

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

  const shown = files?.find((file) => file.path === open) ?? files?.[0]
  return <div className="management-page memory-page">
    <PageTitle eyebrow="PENGETAHUAN" title="Memori">Kelola catatan tim dan baca panduan yang digunakan agent dalam bekerja.</PageTitle>
    <div className="management-toolbar memory-scope">
      <label>Brand<select value={brand.id} onChange={e=>{setBrandId(e.target.value);setAgentType(undefined)}}>{ordered.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label>
      <label>Agent<select value={agent.agentType} onChange={e=>setAgentType(e.target.value)}>{brand.agents.filter(a=>a.active).map(a=><option value={a.agentType} key={a.agentType}>{AGENT_NAMES[a.agentType] ?? a.agentType}</option>)}</select></label>
      <span>Catatan dan panduan sesuai tim yang dipilih.</span>
    </div>
    <AgentNotes key={`${brand.id}/${agent.agentType}`} brandId={brand.id} agentType={agent.agentType} agentName={AGENT_NAMES[agent.agentType] ?? agent.agentType}/>
    <section className="official-library" aria-label="Konteks resmi"><div className="section-heading"><div><h2>Panduan resmi</h2><p>Dokumen acuan brand dan peran. Bagian ini hanya dapat dibaca.</p></div><span className="neutral-tag">Hanya baca</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!files && !error && <p className="muted">Membaca konteks…</p>}
    {files && files.length===0 && <p>Belum ada panduan resmi untuk agent ini.</p>}
    {files && files.length>0 && <div className="context-library"><div className="context-file-list" role="group" aria-label="Pilih panduan">{files.map(file=><button key={file.path} aria-pressed={shown?.path===file.path} aria-controls="context-reader" onClick={()=>setOpen(file.path)}><strong>{fileLabel(file.path)}</strong><span>{file.content.length.toLocaleString('id-ID')} karakter</span></button>)}</div>
    {shown && <section id="context-reader" className="context-reader" aria-label={fileLabel(shown.path)}><h3>{fileLabel(shown.path)}</h3><p className="context-path">{shown.path}</p>{shown.path.endsWith('.md') ? <ReadOnlyMarkdown text={shown.content}/> : <pre>{shown.content}</pre>}</section>}</div>}
    </section>
  </div>
}
