import { Component, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, officeRequest, useOfficeLive, type OfficeApproval, type OfficeBrand, type OfficeTask } from '../office-api.ts'
import { initialFloor, liveBuilding, officeTotals, STATUS_ICONS } from '../office3d/live.ts'
import { RefreshContext } from '../polling.ts'
import type { Page } from '../routes.ts'

const LiveScene = lazy(() => import('./OfficeLive3D.tsx'))
export interface OfficeData { brands: OfficeBrand[]; tasks: OfficeTask[]; approvals: number }
function BrandFeed({ brand, refresh }: { brand: string; refresh: () => void }) {
  useOfficeLive(brand, refresh)
  return null
}
class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
// One atomic snapshot keeps counters and avatars consistent; refreshes are coalesced rather than raced.
export function BlueprintOffice({ onNavigate }: { onNavigate: (page: Page) => void; dashboard?: unknown; dashboardPending?: boolean }) {
  const refreshTick = useContext(RefreshContext)
  const [data, setData] = useState<OfficeData>()
  const [error, setError] = useState<string>()
  const [floor, setFloor] = useState<number>()
  const [mode, setMode] = useState<'2D' | '3D'>('3D')
  const mounted = useRef(false)
  const running = useRef(false)
  const pending = useRef(false)
  const refresh = useCallback(async () => {
    if (running.current) { pending.current = true; return }
    running.current = true
    do {
      pending.current = false
      try {
        const brands = await officeRequest<OfficeBrand[]>('GET', '/brands')
        const details = await Promise.all(brands.map(async (brand) => {
          const [tasks, approvals] = await Promise.all([
            officeRequest<OfficeTask[]>('GET', `/brands/${brand.id}/tasks`),
            officeRequest<OfficeApproval[]>('GET', `/brands/${brand.id}/approvals?open=1`),
          ])
          return { tasks, approvals }
        }))
        if (mounted.current) {
          setData({ brands, tasks: details.flatMap((item) => item.tasks), approvals: details.reduce((sum, item) => sum + item.approvals.length, 0) })
          setFloor((previous) => previous ?? initialFloor(brands, liveBuilding(brands)))
          setError(undefined)
        }
      } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure)) }
    } while (mounted.current && pending.current)
    running.current = false
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [refresh, refreshTick])
  if (!data) return <section className="notice" aria-busy={!error}>{error ? `Office API belum siap: ${error}` : 'Memuat kantor…'}</section>
  const totals = officeTotals(data.tasks, data.approvals)
  const cards = <div className="approval-list">{data.brands.map((brand) => <section className="card" key={brand.id}>
    <h2>{brand.name}</h2>{brand.agents.filter((agent) => agent.active).map((agent) => <p key={agent.agentType}>
      <strong>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</strong> · {error ? 'Status terakhir: ' : ''}{STATUS_ICONS[agent.status]} {AGENT_STATUS_LABELS[agent.status]}
      {agent.currentTask && <> · {agent.currentTask}</>}
    </p>)}
  </section>)}</div>
  return <>
    {data.brands.map((brand) => <BrandFeed key={brand.id} brand={brand.id} refresh={() => { void refresh() }}/>) }
    <div className="lab-3d-bar" aria-label="Ringkasan kantor">
      <strong>Kantor AI · 4 brand</strong><span>Antre: {totals.queued}</span><span>Approval terbuka: {totals.approvals}</span><span>Menunggu kuota: {totals.quota}</span>
      <button onClick={() => setMode(mode === '3D' ? '2D' : '3D')}>Tampilan {mode === '3D' ? '2D' : '3D'}</button>
      <button onClick={() => onNavigate('Approval')}>Buka Approval</button><button onClick={() => { void refresh() }}>Segarkan</button>
    </div>
    {error && <section className="notice" role="alert">Koneksi terputus; data terakhir ditampilkan. {error}</section>}
    {mode === '2D' ? cards : <SceneBoundary fallback={<><p role="alert">Tampilan 3D tidak tersedia. Menampilkan daftar agen.</p>{cards}</>}>
      <Suspense fallback={<p>Memuat tampilan 3D…</p>}><LiveScene data={data} floor={floor ?? 0} setFloor={setFloor} fallback={cards}/></Suspense>
    </SceneBoundary>}
  </>
}
