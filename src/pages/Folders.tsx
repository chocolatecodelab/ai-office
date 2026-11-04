import { useState } from 'react'
import { downloadText, sizeLabel } from '../download.ts'
import { KIND_LABELS, KINDS, NO_FILTERS, PERIOD_LABELS, SORT_LABELS, fileKind, filterAssets, isFiltered, type Filters, type Period, type SortKey } from '../folder-filters.ts'
import { formatDateTime } from '../format.ts'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, officeRequest, type AssetItem, type OfficeAssets } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'

interface Preview { id: string; content?: string; error?: string }

/** An agent's file keeps its own name; a reply is saved as <title>-v<version>.md. */
function fileName(asset: AssetItem): string {
  if (asset.name) return asset.name
  const slug = asset.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'hasil'
  return `${slug}-v${asset.version}.md`
}

const label = (asset: AssetItem) => asset.name ?? asset.title
const versionLabel = (asset: AssetItem) => asset.kind === 'artifact' ? 'berkas' : `v${asset.version}`

/** A file browser for the results agents saved: brands on the left, filters and files in the middle, a preview on the right. */
export function Folders() {
  const data = usePolling<OfficeAssets>('/api/office/assets', 30_000)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<AssetItem>()
  const [preview, setPreview] = useState<Preview>()
  const [copied, setCopied] = useState(false)
  if (data.status === 'pending') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><LoadingState message="Memuat hasil kerja..."/></>
  if (data.status === 'failed') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><EmptyState title="Tidak tersedia">Hasil kerja belum dapat dimuat. {data.message}</EmptyState></>

  const { assets, drive } = data.data
  const now = Date.now()
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))
  const brands = [...new Map(assets.map((asset) => [asset.brandId, asset.brandName])).entries()].sort(([a], [b]) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b))
  const agents = [...new Set(assets.map((asset) => asset.agentType))].sort((a, b) => (AGENT_NAMES[a] ?? a).localeCompare(AGENT_NAMES[b] ?? b))
  const latest = new Map<string, number>()
  for (const asset of assets) latest.set(asset.taskId, Math.max(latest.get(asset.taskId) ?? 0, asset.version))
  // Each count ignores its own filter, so it says how many files that choice would show.
  const withoutBrand = filterAssets(assets, filters, now, 'brand')
  const withoutKind = filterAssets(assets, filters, now, 'kind')
  const files = filterAssets(assets, filters, now)

  const open = async (asset: AssetItem) => {
    setSelected(asset)
    setCopied(false)
    setPreview({ id: asset.id })
    try {
      const full = await officeRequest<{ content: string }>('GET', `/brands/${asset.brandId}/assets/${asset.id}`)
      setPreview((current) => current?.id === asset.id ? { id: asset.id, content: full.content } : current)
    } catch (failure) {
      setPreview((current) => current?.id === asset.id ? { id: asset.id, error: failure instanceof Error ? failure.message : String(failure) } : current)
    }
  }
  const copy = async (content: string) => {
    try { await navigator.clipboard.writeText(content); setCopied(true) } catch { setCopied(false) }
  }

  return <>
    <PageTitle eyebrow="FOLDERS" title="Folders">Hasil kerja agent per brand, tersimpan sebagai versi berurutan. Mockup: Google Drive belum disambungkan{drive ? ` (mode ${drive.mode})` : ''}.</PageTitle>
    {assets.length === 0 ? <EmptyState title="Belum ada hasil">Hasil muncul setelah agent menyelesaikan tugas.</EmptyState> : <div className="fb">
      <nav className="fb-brands" aria-label="Brand">
        <button type="button" aria-pressed={filters.brand === 'all'} onClick={() => set({ brand: 'all' })}><span>Semua brand</span><b>{withoutBrand.length}</b></button>
        {brands.map(([id, name]) => <button type="button" key={id} aria-pressed={filters.brand === id} onClick={() => set({ brand: id })}><span>{name}</span><b>{withoutBrand.filter((asset) => asset.brandId === id).length}</b></button>)}
      </nav>
      <section className="fb-files" aria-label="Berkas">
        <div className="fb-filters">
          <div className="fb-kinds" role="group" aria-label="Jenis berkas">
            <button type="button" className="fb-chip" aria-pressed={filters.kind === 'all'} onClick={() => set({ kind: 'all' })}>Semua <b>{withoutKind.length}</b></button>
            {KINDS.map((kind) => { const count = withoutKind.filter((asset) => fileKind(asset) === kind).length; return count > 0 || filters.kind === kind ? <button type="button" className="fb-chip" key={kind} aria-pressed={filters.kind === kind} onClick={() => set({ kind })}>{KIND_LABELS[kind]} <b>{count}</b></button> : null })}
          </div>
          <div className="fb-controls">
            <SearchInput value={filters.query} onChange={(query) => set({ query })} label="Cari berkas"/>
            <label>Agent <select value={filters.agent} onChange={(event) => set({ agent: event.target.value })}><option value="all">Semua agent</option>{agents.map((agent) => <option key={agent} value={agent}>{AGENT_NAMES[agent] ?? agent}</option>)}</select></label>
            <label>Periode <select value={filters.period} onChange={(event) => set({ period: event.target.value as Period })}>{(Object.keys(PERIOD_LABELS) as Period[]).map((period) => <option key={period} value={period}>{PERIOD_LABELS[period]}</option>)}</select></label>
            <label>Urutkan <select value={filters.sort} onChange={(event) => set({ sort: event.target.value as SortKey })}>{(Object.keys(SORT_LABELS) as SortKey[]).map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}</select></label>
            {isFiltered(filters) && <button type="button" className="refresh-button" onClick={() => set({ ...NO_FILTERS, sort: filters.sort })}>Reset filter</button>}
            <span className="fb-count" role="status">{files.length} dari {assets.length} berkas</span>
          </div>
        </div>
        {files.length === 0 ? <p className="fb-empty">Tidak ada berkas yang cocok dengan filter.{isFiltered(filters) && <> <button type="button" className="refresh-button" onClick={() => set({ ...NO_FILTERS, sort: filters.sort })}>Reset filter</button></>}</p> : <div className="fb-scroll"><table className="fb-table">
          <caption className="fb-sr">Hasil kerja agent, diurutkan {SORT_LABELS[filters.sort].toLowerCase()}</caption>
          <thead><tr><th scope="col">Nama</th><th scope="col">Versi</th><th scope="col" className="fb-hide">Jenis</th><th scope="col" className="fb-hide">Ukuran</th><th scope="col">Diubah</th></tr></thead>
          <tbody>{files.map((asset) => <tr key={asset.id} className={selected?.id === asset.id ? 'selected' : undefined}>
            <th scope="row"><button type="button" className="fb-name" aria-pressed={selected?.id === asset.id} onClick={() => void open(asset)}>
              {label(asset)}<small>{filters.brand === 'all' ? `${asset.brandName} · ` : ''}{asset.name ? `${asset.title} · ` : ''}{AGENT_NAMES[asset.agentType] ?? asset.agentType}</small>
            </button></th>
            <td><span className={`fb-version${latest.get(asset.taskId) === asset.version ? ' latest' : ''}`} title={latest.get(asset.taskId) === asset.version ? 'Versi terbaru' : 'Versi lama'}>{versionLabel(asset)}</span></td>
            <td className="fb-hide">{KIND_LABELS[fileKind(asset)]}</td>
            <td className="fb-hide">{sizeLabel(asset.size)}</td>
            <td>{formatDateTime(asset.createdAt)}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <aside className="fb-preview" aria-label="Pratinjau" aria-live="polite">
        {!selected ? <p className="fb-empty">Pilih berkas untuk melihat isinya.</p> : <>
          <h2>{label(selected)}</h2>
          <dl className="fb-meta">
            <div><dt>Brand</dt><dd>{selected.brandName}</dd></div>
            <div><dt>Agent</dt><dd>{AGENT_NAMES[selected.agentType] ?? selected.agentType}</dd></div>
            <div><dt>Jenis</dt><dd>{KIND_LABELS[fileKind(selected)]} · {versionLabel(selected)}</dd></div>
            <div><dt>Ukuran</dt><dd>{sizeLabel(selected.size)}</dd></div>
          </dl>
          <div className="fb-actions">
            {selected.downloadable
              ? <a className="refresh-button" href={`/api/office/brands/${selected.brandId}/assets/${selected.id}/file`} download={fileName(selected)}>Unduh PDF</a>
              : <button type="button" className="refresh-button" disabled={preview?.content === undefined} onClick={() => preview?.content !== undefined && downloadText(fileName(selected), preview.content, 'text/markdown;charset=utf-8')}>Unduh {selected.name ? '' : '.md'}</button>}
            <button type="button" className="refresh-button" disabled={preview?.content === undefined} onClick={() => preview?.content !== undefined && void copy(preview.content)}>{copied ? 'Tersalin' : 'Salin'}</button>
          </div>
          {preview?.error ? <p className="form-error" role="alert">{preview.error}</p> : preview?.content === undefined ? <p className="muted">Memuat isi…</p> : <pre className="fb-content">{preview.content}</pre>}
        </>}
      </aside>
    </div>}
  </>
}
