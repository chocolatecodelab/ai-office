import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, officeRequest, useOfficeLive, type OfficeBrand } from '../office-api.ts'
import { initialFloor, liveBuilding } from '../office3d/live.ts'

import type { OfficeQuality } from '../office3d/quality.ts'
import { OfficeAgentPanel } from '../components/OfficeAgentPanel.tsx'
import { ROOM_ACTIVITIES, defaultRoomControls, type ActivityRoom } from '../office3d/activities.ts'

const Scene = lazy(() => import('./Office3D.tsx'))

function LiveBrand({ id, reload }: { id: string; reload: () => void }) {
  useOfficeLive(id, reload)
  return null
}

class SceneBoundary extends Component<{ children: ReactNode; onFailed: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailed() }
  render() { return this.state.failed ? null : this.props.children }
}

function supportsWebGL() {
  try { const canvas = document.createElement('canvas'); return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl')) } catch { return false }
}

export function Office() {
  const [brands, setBrands] = useState<OfficeBrand[]>()
  const [error, setError] = useState<string>()
  const [floor, setFloor] = useState<number>()
  const [mode, setMode] = useState<'2d' | '3d'>(() => supportsWebGL() ? '3d' : '2d')
  const [quality,setQuality]=useState<OfficeQuality>('auto')
  const [guide,setGuide] = useState(false)
  const [cameraReset, setCameraReset] = useState(0)
  const [night, setNight] = useState(false)
  const [liftOpen, setLiftOpen] = useState(false)
  const [overview, setOverview] = useState(false)
  const [roomControls, setRoomControls] = useState(defaultRoomControls)
  const [motion, setMotion] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const effectiveControls = useMemo(() => Object.fromEntries(ROOM_ACTIVITIES.map((room) => [room.id,{ ...roomControls[room.id], enabled: motion && roomControls[room.id].enabled }])) as typeof roomControls, [roomControls,motion])
  const toggleRoom = (room: ActivityRoom) => setRoomControls((previous) => ({ ...previous,[room]: { ...previous[room], enabled: !previous[room].enabled } }))
  const [selected, setSelected] = useState<string>()
  const mounted = useRef(false)
  const running = useRef(false)
  const dirty = useRef(false)
  // Serialize invalidations: an event arriving during a fetch always causes another fetch.
  const reload = useCallback(async () => {
    dirty.current = true
    if (running.current) return
    running.current = true
    try {
      do {
        dirty.current = false
        try {
          const next = await officeRequest<OfficeBrand[]>('GET', '/brands')
          if (!mounted.current) return
          setBrands(next)
          setFloor((previous) => previous !== undefined && liveBuilding(next).floors[previous] ? previous : initialFloor(next, liveBuilding(next)))
          setError(undefined)
        } catch (failure) {
          if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure))
        }
      } while (dirty.current && mounted.current)
    } finally { running.current = false }
  }, [])
  useEffect(() => {
    mounted.current = true
    void reload()
    const timer = setInterval(() => { if (!document.hidden) void reload() }, 10000)
    return () => { mounted.current = false; clearInterval(timer) }
  }, [reload])

  if (!brands) return <section className="empty-state" aria-busy={!error}><h2>{error ? 'Kantor belum tersedia' : 'Memuat kantor…'}</h2>{error && <p role="alert">{error}</p>}<button onClick={() => void reload()}>Coba lagi</button></section>
  const layout = liveBuilding(brands)
  const current = layout.floors[floor ?? 0] ?? layout.floors[0]
  const totals = brands.reduce((sum, brand) => ({ queued: sum.queued + (brand.summary?.queued ?? 0), approvals: sum.approvals + (brand.summary?.approvals ?? 0), waitingQuota: sum.waitingQuota + (brand.summary?.waitingQuota ?? 0) }), { queued: 0, approvals: 0, waitingQuota: 0 })
  const crew = brands.flatMap((brand) => brand.agents.filter((agent) => agent.active).map((agent) => ({ brand, agent, id: `${brand.id}/${agent.agentType}` })))
  const visible = current.brand ? crew.filter(({ brand }) => brand.id === current.brand?.id) : crew
  const picked = crew.find((item) => item.id === selected)
  return <div className="blueprint-office" onKeyDown={event=>{if(event.key==='Escape')setLiftOpen(false)}}>
    {brands.map((brand) => <LiveBrand key={brand.id} id={brand.id} reload={() => void reload()}/>)}
    <header className="blueprint-office-bar">
      <strong>AI Office OTCA · {crew.length} agent</strong>
      <span aria-live="polite">Antre: {totals.queued} · Approval terbuka: {totals.approvals} · Menunggu kuota: {totals.waitingQuota}</span>
      <button onClick={() => setMode(mode === '3d' ? '2d' : '3d')}>Tampilan {mode === '3d' ? '2D' : '3D'}</button>
      <button disabled={mode==='2d'} aria-pressed={overview} onClick={() => setOverview(!overview)}>{overview ? 'Masuk lantai' : 'Lihat gedung'}</button>
      <button disabled={mode==='2d'} onClick={() => setCameraReset((value) => value+1)}>Reset kamera</button>
      <button disabled={mode==='2d'} onClick={() => setNight(!night)}>{night ? 'Mode siang' : 'Mode malam'}</button>
<label className="office-quality">Grafis <select disabled={mode==='2d'} aria-label="Kualitas grafis" value={quality} onChange={e=>setQuality(e.target.value as OfficeQuality)}><option value="auto">Otomatis</option><option value="low">Hemat</option><option value="high">Detail</option></select></label>
      <button disabled={mode==='2d'} aria-pressed={guide} onClick={() => {setGuide(!guide);setCameraReset(n=>n+1)}}>{guide ? 'Kembali ke kantor' : 'Panduan status'}</button>
      <button onClick={() => setLiftOpen(!liftOpen)} aria-expanded={liftOpen}>Lift ↕</button>
      <button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Jeda aktivitas' : 'Lanjutkan aktivitas'}</button>
      <button onClick={() => void reload()}>Segarkan</button>
    </header>
    {error && <p role="alert">Koneksi terganggu; menampilkan data terakhir. {error}</p>}
    <nav className="chip-row" aria-label="Lantai kantor">{layout.floors.map((item) => {
      const brand = brands.find((brand) => brand.id === item.brand?.id)
      const approvals = brand?.agents.filter((agent) => agent.active && agent.status === 'waiting_approval').length ?? 0
      return <button className={`chip chip-button${current.index === item.index ? ' active' : ''}`} key={item.index} aria-pressed={current.index === item.index} onClick={() => { setFloor(item.index); setGuide(false); setOverview(false) }}>{item.index === 0 ? 'G · Bersama' : `${item.index} · ${item.brand?.name}`}{approvals > 0 && ` · ${approvals} menunggu approval`}</button>
    })}</nav>
    {liftOpen && <aside className="office-lift-panel" aria-label="Panel lift"><header><strong>Lift · Lantai {current.index || 'G'}</strong><button onClick={() => setLiftOpen(false)}>Tutup lift</button></header><p>Pilih lantai tujuan</p>{layout.floors.map(f => <button key={f.index} onClick={() => {setFloor(f.index);setGuide(false);setOverview(false);setLiftOpen(false)}}>{f.index || 'G'} · {f.brand?.name ?? 'Ruang bersama & jajanan'}</button>)}</aside>}
    {mode === '3d' && <SceneBoundary onFailed={() => setMode('2d')}><Suspense fallback={<p>Memuat kantor 3D…</p>}><Scene quality={quality} guide={guide} motion={motion} onLift={() => setLiftOpen(true)} brands={brands} floor={current.index} night={night} cameraReset={cameraReset} activities={effectiveControls} onRoomInteract={toggleRoom} overview={overview} onFloorSelect={(next) => { setFloor(next); setGuide(false); setOverview(false) }} onSelect={setSelected}/></Suspense></SceneBoundary>}
    {guide && <p role="status">Panduan tujuh status · contoh animasi. Klik Kembali ke kantor untuk melihat aktivitas agent aktual.</p>}
    {current.index === 0 && <details className="office-dock" open={mode === '2d'}><summary>Aktivitas ruang · 6 ruang <span>Atur suasana</span></summary><section className="room-controls" aria-label="Aktivitas ruang bersama">
      <header><div><h2>Aktivitas ruang bersama</h2><p>Klik aset untuk mulai atau jeda. Pilih suasana di setiap ruang.</p></div><button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Jeda animasi ruang' : 'Aktifkan animasi'}</button></header>
      <div className="room-control-grid">{ROOM_ACTIVITIES.map((room) => <article className="card" key={room.id}>
        <h3>{room.name}</h3><p>{room.modes[roomControls[room.id].mode]}</p>
        <button aria-label={room.name + (roomControls[room.id].enabled ? ': jeda' : ': mulai')} aria-pressed={roomControls[room.id].enabled} onClick={() => toggleRoom(room.id)}>{roomControls[room.id].enabled ? 'Jeda' : 'Mulai'}</button>
        <button onClick={() => setRoomControls((previous) => ({ ...previous,[room.id]: { ...previous[room.id],mode: (previous[room.id].mode+1)%room.modes.length } }))}>{room.action}</button>
      </article>)}</div>
    </section></details>}
    <details className="office-dock" open={mode === '2d'}><summary>Tim · {visible.length} agent <span>Klik karakter untuk chat</span></summary><section className="blueprint-crew" aria-label="Agent di lantai ini">{visible.map(({ brand, agent, id }) => <button key={id} className="card" onClick={() => setSelected(id)}><strong>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</strong><span>{brand.name} · {AGENT_STATUS_LABELS[agent.status]}</span><small>{agent.currentTask ?? ''}</small></button>)}{visible.length === 0 && <p>Tidak ada agent di lantai ini.</p>}</section></details>
    <details className="office-dock"><summary>Cara menggunakan kantor</summary><div className="office-help"><p>Klik karakter atau buka daftar Tim untuk chat, tugas, hasil kerja, dan approval. Nama brand terlihat di bagian atas panel agent.</p><p>Di tampilan 3D: seret untuk memutar, gunakan roda mouse atau cubit untuk zoom, dan geser dengan dua jari untuk pan. Dengan keyboard, fokuskan area kantor lalu gunakan tombol panah untuk pan dan Page Up/Down untuk lantai.</p><p>Pilih Grafis Hemat bila tampilan terasa berat, atau gunakan Tampilan 2D untuk mengakses roster dan panel tugas. Escape menutup panel agent atau panel lift.</p></div></details>
    {picked && <OfficeAgentPanel key={picked.id} brand={picked.brand} agent={picked.agent} onClose={() => setSelected(undefined)}/>}
  </div>
}
