import { useState } from 'react'
import { FileCard, FolderCard, PreviewDialog } from '../components/FileGallery.tsx'
import { KIND_LABELS, KINDS, NO_FILTERS, PERIOD_LABELS, SORT_LABELS, fileKind, filterAssets, type Filters, type Period, type SortKey } from '../folder-filters.ts'
import { formatDateTime } from '../format.ts'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, type AssetItem, type OfficeAssets } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'

type View = 'grid' | 'list'

function savedView(): View {
  try { return localStorage.getItem('folders-view') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

const agentName = (agent: string) => AGENT_NAMES[agent] ?? agent

/** Results agents saved, browsed like a drive: brand folders, then agent folders, then the files as page cards. */
export function Folders() {
  const data = usePolling<OfficeAssets>('/api/office/assets', 30_000)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<AssetItem>()
  const [view, setView] = useState<View>(savedView)
  const [page,setPage]=useState(1)
  const [pageSize,setPageSize]=useState(24)
  if (data.status === 'pending') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><LoadingState message="Memuat hasil kerja..."/></>
  if (data.status === 'failed') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><EmptyState title="Tidak tersedia">Hasil kerja belum dapat dimuat. {data.message}</EmptyState></>

  const { assets } = data.data
  const now = Date.now()
  const set = (patch: Partial<Filters>) => {setPage(1);setFilters((current) => ({ ...current, ...patch }))}
  const chooseView = (next: View) => { setView(next); try { localStorage.setItem('folders-view', next) } catch { /* the choice just is not remembered */ } }

  const brands = [...new Map(assets.map((asset) => [asset.brandId, asset.brandName])).entries()].sort(([a], [b]) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b))
  const latest = new Map<string, number>()
  for (const asset of assets) latest.set(asset.taskId, Math.max(latest.get(asset.taskId) ?? 0, asset.version))

  // The folder path is the brand and agent filters; search, kind and period turn the page into a flat list of matches.
  const searching = filters.query.trim() !== '' || filters.kind !== 'all' || filters.period !== 'all'
  const inBrand = assets.filter((asset) => filters.brand === 'all' || asset.brandId === filters.brand)
  const folders: { key: string; title: string; count: number; note?: string; open: () => void }[] = []
  if (!searching && filters.brand === 'all') {
    for (const [id, name] of brands) {
      const own = assets.filter((asset) => asset.brandId === id)
      folders.push({ key: id, title: name, count: own.length, note: `terakhir ${formatDateTime(own.map((asset) => asset.createdAt).sort().at(-1))}`, open: () => set({ brand: id, agent: 'all' }) })
    }
  } else if (!searching && filters.agent === 'all') {
    const byAgent = new Map<string, number>()
    for (const asset of inBrand) byAgent.set(asset.agentType, (byAgent.get(asset.agentType) ?? 0) + 1)
    for (const [agent, count] of [...byAgent].sort(([a], [b]) => agentName(a).localeCompare(agentName(b)))) folders.push({ key: agent, title: agentName(agent), count, open: () => set({ agent }) })
  }
  const withoutKind = filterAssets(assets, filters, now, 'kind')
  const matches = filterAssets(assets, filters, now)
  const pages=Math.max(1,Math.ceil(matches.length/pageSize))
  const currentPage=Math.min(page,pages)
  const start=(currentPage-1)*pageSize
  const files = matches.slice(start,start+pageSize)
  const brandName = brands.find(([id]) => id === filters.brand)?.[1]
  const reset = () => {setPage(1);setFilters({ ...NO_FILTERS, sort: filters.sort })}

  return <>
    <PageTitle eyebrow="FOLDERS" title="Folders">Temukan hasil kerja agent, lihat pratinjau, dan unduh berkas per brand.</PageTitle>
    {assets.length === 0 ? <EmptyState title="Belum ada hasil">Hasil muncul setelah agent menyelesaikan tugas.</EmptyState> : <div className="fb">
      <div className="fb-bar">
        <nav className="fb-crumbs" aria-label="Lokasi folder">
          <ol>
            <li>{filters.brand === 'all' ? <b aria-current="page">Folders</b> : <button type="button" onClick={() => set({ brand: 'all', agent: 'all' })}>Folders</button>}</li>
            {filters.brand !== 'all' && <li>{filters.agent === 'all' ? <b aria-current="page">{brandName}</b> : <button type="button" onClick={() => set({ agent: 'all' })}>{brandName}</button>}</li>}
            {filters.brand !== 'all' && filters.agent !== 'all' && <li><b aria-current="page">{agentName(filters.agent)}</b></li>}
          </ol>
        </nav>
        <SearchInput value={filters.query} onChange={(query) => set({ query })} label="Cari di semua folder"/>
      </div>
      <div className="fb-filters">
        <div className="fb-kinds" role="group" aria-label="Jenis berkas">
          <button type="button" className="fb-chip" aria-pressed={filters.kind === 'all'} onClick={() => set({ kind: 'all' })}>Semua <b>{withoutKind.length}</b></button>
          {KINDS.map((kind) => { const count = withoutKind.filter((asset) => fileKind(asset) === kind).length; return count > 0 || filters.kind === kind ? <button type="button" className="fb-chip" key={kind} aria-pressed={filters.kind === kind} onClick={() => set({ kind })}>{KIND_LABELS[kind]} <b>{count}</b></button> : null })}
        </div>
        <div className="fb-controls">
          <label>Periode <select value={filters.period} onChange={(event) => set({ period: event.target.value as Period })}>{(Object.keys(PERIOD_LABELS) as Period[]).map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}</select></label>
          <label>Urutkan <select value={filters.sort} onChange={(event) => set({ sort: event.target.value as SortKey })}>{(Object.keys(SORT_LABELS) as SortKey[]).map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}</select></label>
          {(searching || filters.brand !== 'all') && <button type="button" className="refresh-button" onClick={reset}>Reset</button>}
          <div className="fb-views" role="group" aria-label="Tampilan">
            <button type="button" aria-pressed={view === 'grid'} onClick={() => chooseView('grid')}>Kartu</button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => chooseView('list')}>Daftar</button>
          </div>
        </div>
      </div>

      {folders.length > 0 && <section aria-label="Folder">
        <h2 className="fb-heading">Folder</h2>
        <div className="fb-folders">{folders.map((folder) => <FolderCard key={folder.key} title={folder.title} count={folder.count} note={folder.note} onOpen={folder.open}/>)}</div>
      </section>}

      <section aria-label="Berkas">
        <h2 className="fb-heading">{searching ? 'Hasil pencarian' : 'Semua berkas'} <small role="status">{matches.length?`${start+1}–${start+files.length} dari ${matches.length} berkas`:'0 berkas'}</small></h2>
        {files.length === 0
          ? <p className="fb-empty">{searching ? 'Tidak ada berkas yang cocok.' : 'Folder ini belum berisi berkas.'}{searching && <> <button type="button" className="refresh-button" onClick={reset}>Reset filter</button></>}</p>
          : <div className={`fb-grid${view === 'list' ? ' list' : ''}`}>{files.map((asset) => <FileCard key={asset.id} asset={asset} showBrand={filters.brand === 'all'} latest={latest.get(asset.taskId) === asset.version} selected={selected?.id === asset.id} onOpen={() => setSelected(asset)}/>)}</div>}
        {matches.length>0&&<nav className="fb-pagination" aria-label="Halaman berkas"><label>Berkas per halaman<select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1)}}>{[12,24,48].map(n=><option key={n} value={n}>{n}</option>)}</select></label><div><button type="button" className="refresh-button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Sebelumnya</button><span aria-live="polite">Halaman {currentPage} dari {pages}</span><button type="button" className="refresh-button" disabled={currentPage===pages} onClick={()=>setPage(currentPage+1)}>Berikutnya</button></div></nav>}
      </section>
    </div>}
    {selected && <PreviewDialog key={selected.id} asset={selected} onClose={() => setSelected(undefined)} onChanged={data.refresh}/>}
  </>
}
