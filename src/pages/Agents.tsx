import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, AGENT_STATUS_LABELS, type OfficeAgent, type OfficeBrand } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'
import { PixelCharacter } from './OfficeDetails.tsx'

// Every agent runs on its brand's Hermes gateway with Codex (ChatGPT Plus). Urgent tasks can fall
// back to Claude through LiteLLM, see routeFor in server/office/runner.ts.
const DEFAULT_MODEL = 'Codex · gpt-6-sol (ChatGPT Plus)'

/** The agents of every brand, grouped by brand, read from the office API. */
export function Agents() {
  const brands = usePolling<OfficeBrand[]>('/api/office/brands', 15_000)
  if (brands.status === 'pending') return <><PageTitle eyebrow="CREW" title="Agents"/><LoadingState message="Memuat agen..."/></>
  if (brands.status === 'failed') return <><PageTitle eyebrow="CREW" title="Agents"/><EmptyState title="Tidak tersedia">Daftar agen belum dapat dimuat dari server.</EmptyState></>
  const brandsByFloor = [...brands.data].sort((a, b) => FLOOR_ORDER.indexOf(a.id) - FLOOR_ORDER.indexOf(b.id))
  const total = brands.data.reduce((sum, brand) => sum + brand.agents.length, 0)
  return <>
    <PageTitle eyebrow="CREW" title="Agents">{total} agen di {brands.data.length} brand. Setiap agen bekerja lewat Hermes milik brandnya.</PageTitle>
    {brandsByFloor.map((brand) => <section className="agent-brand" key={brand.id}>
      <h2 style={{ color: brand.color }}>{brand.name}{brand.paused ? ' · dijeda' : ''}</h2>
      <section className="agent-grid">{brand.agents.map((agent) => <AgentCard agent={agent} key={agent.agentType}/>)}</section>
    </section>)}
  </>
}

function AgentCard({ agent }: { agent: OfficeAgent }) {
  return <article className="agent-card">
    <span className="folder-glyph" aria-hidden="true"><PixelCharacter agent={agent.agentType}/></span>
    <div className="agent-card-body">
      <h3>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</h3>
      <dl>
        <div><dt>Model</dt><dd>{DEFAULT_MODEL}</dd></div>
        <div><dt>Status</dt><dd>{agent.active ? AGENT_STATUS_LABELS[agent.status] : 'Nonaktif'}</dd></div>
        <div><dt>Tugas</dt><dd>{agent.currentTask ?? '—'}</dd></div>
      </dl>
    </div>
  </article>
}
