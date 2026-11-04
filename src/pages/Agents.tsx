import { useState } from 'react'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { ModelEditor } from '../components/ModelEditor.tsx'
import { routeLabel } from '../model-labels.ts'
import { AGENT_NAMES, AGENT_STATUS_LABELS, officeRequest, type OfficeAgent, type OfficeBrand, type OfficeModels, type Weight } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'
import { PixelCharacter } from './OfficeDetails.tsx'

const WEIGHT_LABELS: Record<Weight, string> = { simple: 'Sederhana', complex: 'Kompleks', urgent: 'Mendesak' }

/** The agents of every brand, grouped by brand, with the model each one uses (server/office/model-routes.ts) and the kill switch (FR-26). */
export function Agents() {
  const brands = usePolling<OfficeBrand[]>('/api/office/brands', 15_000)
  const models = usePolling<OfficeModels>('/api/office/models', 60_000)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
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

  return <>
    <PageTitle eyebrow="CREW" title="Agents">{total} agen di {brands.data.length} brand. Setiap agen bekerja lewat Hermes milik brandnya.{table ? ` Profil mesin: ${table.profile === 'prod' ? 'production (Codex dan pool Claude)' : 'development (semua di Codex)'}.` : ''}</PageTitle>
    {error && <p className="form-error" role="alert">{error}</p>}
    {brandsByFloor.map((brand) => <section className="agent-brand" key={brand.id}>
      <h2 style={{ color: brand.color }}>{brand.name}{brand.paused ? ' · dijeda' : ''} <button type="button" className="refresh-button" disabled={busy} onClick={() => void killSwitch(brand, undefined, !brand.paused)}>{brand.paused ? 'Lanjutkan brand' : 'Jeda brand'}</button></h2>
      <section className="agent-grid">{brand.agents.map((agent) => <AgentCard agent={agent} brandPaused={brand.paused} busy={busy} models={table} onToggle={(paused) => void killSwitch(brand, agent.agentType, paused)} onModelChanged={models.refresh} key={agent.agentType}/>)}</section>
    </section>)}
  </>
}

function AgentCard({ agent, brandPaused, busy, models, onToggle, onModelChanged }: { agent: OfficeAgent; brandPaused: boolean; busy: boolean; models: OfficeModels | undefined; onToggle: (paused: boolean) => void; onModelChanged: () => void }) {
  const routes = models?.agents.find((item) => item.agentType === agent.agentType)
  const weights: Weight[] = models?.profile === 'prod' ? ['simple', 'complex', 'urgent'] : ['simple', 'complex']
  return <article className="agent-card">
    <span className="folder-glyph" aria-hidden="true"><PixelCharacter agent={agent.agentType}/></span>
    <div className="agent-card-body">
      <h3>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</h3>
      <dl>
        {!routes && <div><dt>Model</dt><dd>—</dd></div>}
        {routes && weights.map((weight) => <div key={weight}><dt>{WEIGHT_LABELS[weight]}</dt><dd>{routeLabel(routes[weight])}{routes.overridden.includes(weight) ? ' · diubah' : ''}</dd></div>)}
        <div><dt>Status</dt><dd>{agent.active ? AGENT_STATUS_LABELS[agent.status] : 'Nonaktif'}</dd></div>
        <div><dt>Tugas</dt><dd>{agent.currentTask ?? '—'}</dd></div>
      </dl>
      {routes && models && <ModelEditor entry={routes} models={models} onChanged={onModelChanged}/>}
      {agent.active && <button type="button" className="refresh-button" disabled={busy || brandPaused} title={brandPaused ? 'Brand sedang dijeda' : undefined} onClick={() => onToggle(!agent.paused)}>{agent.paused ? 'Lanjutkan' : 'Jeda'}</button>}
    </div>
  </article>
}
