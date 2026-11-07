import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, officeRequest, useOfficeLive, type OfficeBrand, type OfficeTask } from '../office-api.ts'
import { OfficeAttention } from '../components/OfficeAttention.tsx'
import { TaskComposer } from '../components/TaskComposer.tsx'
import { TaskDetailDialog } from '../components/TaskDetailDialog.tsx'
import { PixelCharacter } from './OfficeDetails.tsx'
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
  const [query,setQuery]=useState('')
  const [workspaceTab,setWorkspaceTab]=useState<'team'|'scene'>('team')
  const [creating,setCreating]=useState(false)
  const [created,setCreated]=useState<OfficeTask>()
  const [expanded,setExpanded]=useState(false)
  const [wide,setWide]=useState(()=>typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 1280px)').matches))
  useEffect(()=>{const media=window.matchMedia?.('(min-width: 1280px)');if(!media)return;const update=()=>setWide(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update)},[])
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
  const [selected, setSelected] = useState<string|undefined>(()=>typeof window!=='undefined' && window.location.hash.replace(/^#\/?/,'').split('/')[0]==='event' ? 'otca/event-specialist' : undefined)
  useEffect(()=>{
    const enter=()=>{if(window.location.hash.replace(/^#\/?/,'').split('/')[0]==='event'){setSelected('otca/event-specialist');setFloor(1);setWorkspaceTab('team')}}
    enter();window.addEventListener('hashchange',enter)
    return()=>window.removeEventListener('hashchange',enter)
  },[])
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
  return <div className={`blueprint-office workspace-${workspaceTab}${picked && wide ? ' agent-workspace-open' : ''}${expanded ? ' office-expanded' : ''}`} onKeyDown={event=>{if(event.key==='Escape'){setLiftOpen(false);setExpanded(false)}}}>
    {brands.map((brand) => <LiveBrand key={brand.id} id={brand.id} reload={() => void reload()}/>)}
    <div className="office-heading"><div><h1>Kantor virtual</h1><p>Ruang kerja tim AI OTCA. Pantau pekerjaan, tinjau hasil, dan berikan arahan.</p></div><div className="office-heading-actions"><button className="primary-button" onClick={()=>setCreating(true)}>Beri tugas</button><button className="office-expand" aria-pressed={expanded} onClick={()=>setExpanded(!expanded)}>{expanded ? 'Kembali ke tampilan biasa' : 'Perbesar kantor'}</button></div></div>
    <section className="office-summary" aria-label="Ringkasan semua kantor">
      <div className="office-stat"><span className="office-stat-label"><StatIcon kind="agents"/>Agent aktif</span><strong>{crew.length}<small>terdaftar</small></strong></div>
      <div className="office-stat"><span className="office-stat-label"><StatIcon kind="queue"/>Antre</span><strong>{brands.every(b=>b.summary) ? totals.queued : '—'}<small>tugas</small></strong></div>
      <a className="office-stat office-stat-link" href="#/approval"><span className="office-stat-label"><StatIcon kind="review"/>Approval terbuka</span><strong>{brands.every(b=>b.summary) ? totals.approvals : '—'}<small>perlu ditinjau</small></strong></a>
      <div className="office-stat"><span className="office-stat-label"><StatIcon kind="quota"/>Menunggu kuota</span><strong>{brands.every(b=>b.summary) ? totals.waitingQuota : '—'}<small>agent</small></strong></div>
    </section>
    <div className="office-mobile-switch" role="group" aria-label="Area kerja"><button aria-pressed={workspaceTab==='team'} onClick={()=>setWorkspaceTab('team')}>Tim</button><button aria-pressed={workspaceTab==='scene'} onClick={()=>setWorkspaceTab('scene')}>Kantor 3D</button></div>
    <div className="office-workspace"><section className="office-view" aria-label="Tampilan kantor"><div className="office-view-heading"><div><h2>{current.brand?.name ?? 'Ruang bersama'}</h2><span>{current.index===0 ? 'Fasilitas dan area luar' : 'Lantai '+current.index+' · '+visible.length+' agent'}</span></div></div>
    <header className="blueprint-office-bar">
      <button onClick={() => setMode(mode === '3d' ? '2d' : '3d')}>Tampilan {mode === '3d' ? '2D' : '3D'}</button>
      <button disabled={mode==='2d'} aria-pressed={overview} onClick={() => setOverview(!overview)}>{overview ? 'Masuk lantai' : 'Lihat gedung'}</button>
      <button disabled={mode==='2d'} onClick={() => setCameraReset((value) => value+1)}>Reset kamera</button>
      <details className="office-view-settings"><summary>Pengaturan tampilan</summary><div>
      <button disabled={mode==='2d'} onClick={() => setNight(!night)}>{night ? 'Mode siang' : 'Mode malam'}</button>
<label className="office-quality">Grafis <select disabled={mode==='2d'} aria-label="Kualitas grafis" value={quality} onChange={e=>setQuality(e.target.value as OfficeQuality)}><option value="auto">Otomatis</option><option value="low">Hemat</option><option value="high">Detail</option></select></label>
      <button disabled={mode==='2d'} aria-pressed={guide} onClick={() => {setGuide(!guide);setCameraReset(n=>n+1)}}>{guide ? 'Kembali ke kantor' : 'Panduan status'}</button>
      <button onClick={() => setLiftOpen(!liftOpen)} aria-expanded={liftOpen}>Lift ↕</button>
      <button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Jeda aktivitas' : 'Lanjutkan aktivitas'}</button>
      </div></details><button onClick={() => void reload()}>Segarkan</button>
    </header>
    {error && <p role="alert">Koneksi terganggu; menampilkan data terakhir. {error}</p>}
    <nav className="chip-row" aria-label="Lantai kantor">{layout.floors.map((item) => {
      const brand = brands.find((brand) => brand.id === item.brand?.id)
      const approvals = brand?.agents.filter((agent) => agent.active && agent.status === 'waiting_approval').length ?? 0
      return <button className={`chip chip-button${current.index === item.index ? ' active' : ''}`} key={item.index} aria-pressed={current.index === item.index} onClick={() => { setFloor(item.index); setGuide(false); setOverview(false) }}>{item.index === 0 ? 'G · Bersama' : `${item.index} · ${item.brand?.name}`}{approvals > 0 && ` · ${approvals} menunggu approval`}</button>
    })}</nav>
    {liftOpen && <aside className="office-lift-panel" aria-label="Panel lift"><header><strong>Lift · Lantai {current.index || 'G'}</strong><button onClick={() => setLiftOpen(false)}>Tutup lift</button></header><p>Pilih lantai tujuan</p>{layout.floors.map(f => <button key={f.index} onClick={() => {setFloor(f.index);setGuide(false);setOverview(false);setLiftOpen(false)}}>{f.index || 'G'} · {f.brand?.name ?? 'Ruang bersama & jajanan'}</button>)}</aside>}
    {mode === '3d' && !motion && <p role="status" className="office-motion-notice">Aktivitas agent sedang dijeda. <button onClick={()=>setMotion(true)}>Lanjutkan aktivitas</button></p>}
    {mode === '3d' && (wide || workspaceTab==='scene' || expanded) && <SceneBoundary onFailed={() => setMode('2d')}><Suspense fallback={<p>Memuat kantor 3D…</p>}><Scene quality={quality} guide={guide} motion={motion} onLift={() => setLiftOpen(true)} brands={brands} floor={current.index} night={night} cameraReset={cameraReset} activities={effectiveControls} onRoomInteract={toggleRoom} overview={overview} onFloorSelect={(next) => { setFloor(next); setGuide(false); setOverview(false) }} onSelect={setSelected}/></Suspense></SceneBoundary>}
    {guide && <p role="status">Panduan tujuh status · contoh animasi. Klik Kembali ke kantor untuk melihat aktivitas agent aktual.</p>}
    {current.index === 0 && <details className="office-dock" open={mode === '2d'}><summary>Aktivitas ruang · 6 ruang <span>Atur suasana</span></summary><section className="room-controls" aria-label="Aktivitas ruang bersama">
      <header><div><h2>Aktivitas ruang bersama</h2><p>Klik aset untuk mulai atau jeda. Pilih suasana di setiap ruang.</p></div><button aria-pressed={motion} onClick={() => setMotion(!motion)}>{motion ? 'Jeda animasi ruang' : 'Aktifkan animasi'}</button></header>
      <div className="room-control-grid">{ROOM_ACTIVITIES.map((room) => <article className="card" key={room.id}>
        <h3>{room.name}</h3><p>{room.modes[roomControls[room.id].mode]}</p>
        <button aria-label={room.name + (roomControls[room.id].enabled ? ': jeda' : ': mulai')} aria-pressed={roomControls[room.id].enabled} onClick={() => toggleRoom(room.id)}>{roomControls[room.id].enabled ? 'Jeda' : 'Mulai'}</button>
        <button onClick={() => setRoomControls((previous) => ({ ...previous,[room.id]: { ...previous[room.id],mode: (previous[room.id].mode+1)%room.modes.length } }))}>{room.action}</button>
      </article>)}</div>
    </section></details>}
    <details className="office-dock"><summary>Cara menggunakan kantor</summary><div className="office-help"><p>Klik karakter atau buka daftar Tim untuk chat, tugas, hasil kerja, dan approval. Nama brand terlihat di bagian atas panel agent.</p><p>Di tampilan 3D: seret untuk memutar, gunakan roda mouse atau cubit untuk zoom, dan geser dengan dua jari untuk pan. Dengan keyboard, fokuskan area kantor lalu gunakan tombol panah untuk pan dan Page Up/Down untuk lantai.</p><p>Pilih Grafis Hemat bila tampilan terasa berat, atau gunakan Tampilan 2D untuk mengakses roster dan panel tugas. Escape menutup panel agent atau panel lift.</p></div></details>
    </section><aside className="office-context" aria-label="Tim dan perhatian">{picked && wide ? <OfficeAgentPanel embedded key={picked.id} brand={picked.brand} agent={picked.agent} onClose={()=>setSelected(undefined)}/> : <>
      <div className="context-heading"><div><h2>Tim kantor</h2><p>{current.brand?.name ?? 'Semua brand'} · {visible.length} agent</p></div><a href="#/agents">Lihat semua</a></div>
      <label className="office-team-floor">Tim yang ditampilkan<select value={current.index} onChange={e=>setFloor(Number(e.target.value))}>{layout.floors.map(f=><option value={f.index} key={f.index}>{f.brand?.name ?? 'Semua brand'}</option>)}</select></label>
      <label className="office-agent-search"><span>Cari agent</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama peran atau brand"/></label>
      <section className="blueprint-crew" aria-label="Agent di lantai ini">{visible.filter(({brand,agent})=>(brand.name+' '+(AGENT_NAMES[agent.agentType] ?? agent.agentType)).toLowerCase().includes(query.toLowerCase())).map(({brand,agent,id})=><button key={id} onClick={()=>setSelected(id)} className="office-agent-row"><span className="crew-avatar"><PixelCharacter agent={id}/></span><span className="crew-information"><strong>{AGENT_NAMES[agent.agentType] ?? agent.agentType}</strong><span>{brand.name}</span><small data-status={agent.status}>{AGENT_STATUS_LABELS[agent.status]}</small>{agent.currentTask && <small className="crew-task" title={agent.currentTask}>{agent.currentTask}</small>}</span></button>)}{visible.filter(({brand,agent})=>(brand.name+' '+(AGENT_NAMES[agent.agentType] ?? agent.agentType)).toLowerCase().includes(query.toLowerCase())).length===0 && <p className="office-no-results">Tidak ada agent yang sesuai. Coba kata lain.</p>}</section>
      <OfficeAttention brands={brands} onSelect={(id,brandId)=>{setSelected(id);setFloor(layout.floors.find(f=>f.brand?.id===brandId)?.index ?? current.index);setWorkspaceTab('team')}}/>
    </>}</aside></div>
    {picked && (!wide || expanded) && <OfficeAgentPanel key={picked.id} brand={picked.brand} agent={picked.agent} onClose={()=>setSelected(undefined)}/>}
    {creating && <TaskComposer brands={brands} initialBrand={current.brand?.id} onClose={()=>setCreating(false)} onCreated={task=>{setCreating(false);setCreated(task);void reload()}}/>}
    {created && <TaskDetailDialog key={created.id} task={created} brandName={brands.find(b=>b.id===created.brandId)?.name ?? created.brandId} onClose={()=>setCreated(undefined)} onChanged={()=>void reload()}/>}

  </div>
}

function StatIcon({kind}:{kind:'agents'|'queue'|'review'|'quota'}){
  const paths={agents:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8m6 10v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',queue:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',review:'M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4M9 12l3 3L22 4',quota:'M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'}
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]}/></svg>
}
