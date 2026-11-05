import { useState } from 'react'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { ModelEditor } from '../components/ModelEditor.tsx'
import { OfficeAgentPanel } from '../components/OfficeAgentPanel.tsx'
import { routeLabel } from '../model-labels.ts'
import { AGENT_NAMES, AGENT_STATUS_LABELS, officeRequest, type OfficeAgent, type OfficeBrand, type OfficeModels, type Weight } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'
import { PixelCharacter } from './OfficeDetails.tsx'

const WEIGHT_LABELS: Record<Weight, string> = { simple: 'Sederhana', complex: 'Kompleks', urgent: 'Mendesak' }

/** The agents of every brand, grouped by brand, with the model each one uses (server/office/model-routes.ts) and the kill switch (FR-26). */
export function Agents() {
  const brands = usePolling<OfficeBrand[]>('/api/office/brands', 15_000)
  const models = usePolling<OfficeModels>('/api/office/models', 60_000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [selected,setSelected] = useState<{brand:OfficeBrand;agent:OfficeAgent;tab:'Chat'|'Tugas'}>()
  const [query,setQuery] = useState('')
  const [brandFilter,setBrandFilter] = useState('all')
  if (brands.status === 'pending') return <><PageTitle eyebrow="CREW" title="Agents"/><LoadingState message="Memuat agen..."/></>
  if (brands.status === 'failed') return <><PageTitle eyebrow="CREW" title="Agents"/><EmptyState title="Tidak tersedia">Daftar agen belum dapat dimuat dari server.</EmptyState></>
  const table = models.status === 'ready' ? models.data : undefined
  const brandsByFloor = [...brands.data].sort((a, b) => FLOOR_ORDER.indexOf(a.id) - FLOOR_ORDER.indexOf(b.id))
  const total = brands.data.reduce((sum, brand) => sum + brand.agents.length, 0)

  // Pause or resume a brand (agent undefined) or one agent; the server parks or requeues its tasks.
  const killSwitch = async (brand: OfficeBrand, agent: string | undefined, paused: boolean) => {
    setBusy(true)
    setError(undefined)
    try {
      await officeRequest('POST', agent ? `/brands/${brand.id}/agents/${agent}/pause` : `/brands/${brand.id}/pause`, { paused })
      brands.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const filtered = brandsByFloor.filter(b=>brandFilter==='all' || b.id===brandFilter).map(b=>({...b,agents:b.agents.filter(a=>(AGENT_NAMES[a.agentType] ?? a.agentType).toLowerCase().includes(query.trim().toLowerCase()))})).filter(b=>b.agents.length)
  return <div className="management-page agents-page">
    <PageTitle eyebrow="TIM" title="Agent">{total} agent di {brands.data.length} brand. Pilih rekan kerja untuk berdiskusi atau memberi tugas.</PageTitle>
    <div className="management-toolbar"><label>Brand<select value={brandFilter} onChange={e=>setBrandFilter(e.target.value)}><option value="all">Semua brand</option>{brandsByFloor.map(b=><option value={b.id} key={b.id}>{b.name}</option>)}</select></label><SearchInput value={query} onChange={setQuery} label="Cari peran agent"/><span role="status">{filtered.reduce((n,b)=>n+b.agents.length,0)} agent</span></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!filtered.length && <EmptyState title="Agent tidak ditemukan">Coba nama peran lain atau pilih semua brand.</EmptyState>}
    {filtered.map((brand) => <section className="agent-brand" key={brand.id}>
      <div className="brand-section-heading"><div><h2><span className="brand-dot" style={{background:brand.color}}/>{brand.name}</h2><p>{brand.agents.length} agent{brand.paused ? ' · Brand dijeda' : ''}</p></div><button type="button" className="refresh-button" disabled={busy} onClick={() => void killSwitch(brand, undefined, !brand.paused)}>{brand.paused ? 'Lanjutkan brand' : 'Jeda brand'}</button></div>
      <section className="agent-grid">{brand.agents.map((agent) => <AgentCard agent={agent} onOpen={tab=>setSelected({brand,agent,tab})} brandPaused={brand.paused} busy={busy} models={table} onToggle={(paused) => void killSwitch(brand, agent.agentType, paused)} onModelChanged={models.refresh} key={agent.agentType}/>)}</section>
    </section>)}
    {selected && <OfficeAgentPanel key={`${selected.brand.id}/${selected.agent.agentType}/${selected.tab}`} brand={selected.brand} agent={selected.agent} initialTab={selected.tab} onClose={()=>setSelected(undefined)}/>}
  </div>
}

function AgentCard({ agent, brandPaused, busy, models, onToggle, onModelChanged, onOpen }: { onOpen: (tab:'Chat'|'Tugas')=>void; agent: OfficeAgent; brandPaused: boolean; busy: boolean; models: OfficeModels | undefined; onToggle: (paused: boolean) => void; onModelChanged: () => void }) {
  const routes = models?.agents.find((item) => item.agentType === agent.agentType)
  const weights: Weight[] = models?.profile === 'prod' ? ['simple', 'complex', 'urgent'] : ['simple', 'complex']
  const paused = brandPaused || agent.paused
  return <article className="agent-card">
    <div className="agent-card-heading"><span className="agent-portrait" aria-hidden="true"><PixelCharacter agent={`${agent.brandId}/${agent.agentType}`}/></span><div><h3>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</h3><span className="agent-state" data-status={paused ? 'paused' : agent.status}>{!agent.active ? 'Nonaktif' : paused ? 'Dijeda' : AGENT_STATUS_LABELS[agent.status]}</span></div></div>
    <div className="agent-card-body">
      <div className="agent-current-work"><span>Pekerjaan saat ini</span><p>{agent.currentTask ?? (paused ? 'Penerimaan tugas sedang dijeda.' : agent.active ? 'Belum ada tugas berjalan.' : 'Agent belum diaktifkan.')}</p></div>
      {agent.active && <div className="agent-work-actions"><button className="refresh-button" onClick={()=>onOpen('Chat')}>Chat</button><button className="primary-button" disabled={paused} onClick={()=>onOpen('Tugas')}>Beri tugas</button></div>}
      <details className="agent-configuration"><summary>Konfigurasi agent</summary><dl>
        {!routes && <div><dt>Model</dt><dd>—</dd></div>}
        {routes && weights.map((weight) => <div key={weight}><dt>{WEIGHT_LABELS[weight]}</dt><dd>{routeLabel(routes[weight])}{routes.overridden.includes(weight) ? ' · diubah' : ''}</dd></div>)}
      </dl>
      {routes && models && <ModelEditor entry={routes} models={models} onChanged={onModelChanged}/>}
      {agent.active && <button type="button" className="refresh-button" disabled={busy || brandPaused} title={brandPaused ? 'Brand sedang dijeda' : undefined} onClick={() => onToggle(!agent.paused)}>{agent.paused ? 'Lanjutkan agent' : 'Jeda agent'}</button>}
      </details>
    </div>
  </article>
}
