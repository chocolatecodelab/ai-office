import { useState } from 'react'
import { formatDateTime } from '../format.ts'
import { FLOOR_ORDER } from '../office3d/building.ts'
import { AGENT_NAMES, officeRequest, type AssetItem, type OfficeAssets } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'

interface Preview { id: string; content?: string; error?: string }

const sizeLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`

function fileName(asset: AssetItem): string {
  const slug = asset.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'hasil'
  return `${slug}-v${asset.version}.md`
}

function download(asset: AssetItem, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName(asset)
  link.click()
  URL.revokeObjectURL(url)
}

/** A file browser for the results agents saved: brands on the left, files in the middle, a preview on the right. */
export function Folders() {
  const data = usePolling<OfficeAssets>('/api/office/assets', 30_000)
  const [brandId, setBrandId] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AssetItem>()
  const [preview, setPreview] = useState<Preview>()
  const [copied, setCopied] = useState(false)
  if (data.status === 'pending') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><LoadingState message="Memuat hasil kerja..."/></>
  if (data.status === 'failed') return <><PageTitle eyebrow="FOLDERS" title="Folders"/><EmptyState title="Tidak tersedia">Hasil kerja belum dapat dimuat. {data.message}</EmptyState></>

  const { assets, drive } = data.data
  const brands = [...new Map(assets.map((asset) => [asset.brandId, asset.brandName])).entries()].sort(([a], [b]) => FLOOR_ORDER.indexOf(a) - FLOOR_ORDER.indexOf(b))
  const latest = new Map<string, number>()
  for (const asset of assets) latest.set(asset.taskId, Math.max(latest.get(asset.taskId) ?? 0, asset.version))
  const needle = query.trim().toLowerCase()
  const files = assets.filter((asset) => (brandId === 'all' || asset.brandId === brandId)
    && (!needle || `${asset.title} ${asset.kind} ${AGENT_NAMES[asset.agentType] ?? asset.agentType} ${asset.brandName}`.toLowerCase().includes(needle)))

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
        <button type="button" aria-pressed={brandId === 'all'} onClick={() => setBrandId('all')}><span>Semua brand</span><b>{assets.length}</b></button>
        {brands.map(([id, name]) => <button type="button" key={id} aria-pressed={brandId === id} onClick={() => setBrandId(id)}><span>{name}</span><b>{assets.filter((asset) => asset.brandId === id).length}</b></button>)}
      </nav>
      <section className="fb-files" aria-label="Berkas">
        <div className="fb-toolbar"><SearchInput value={query} onChange={setQuery} label="Cari berkas"/><span className="fb-count">{files.length} berkas</span></div>
        {files.length === 0 ? <p className="fb-empty">Tidak ada berkas yang cocok.</p> : <div className="fb-scroll"><table className="fb-table">
          <caption className="fb-sr">Hasil kerja agent, terbaru di atas</caption>
          <thead><tr><th scope="col">Nama</th><th scope="col">Versi</th><th scope="col" className="fb-hide">Jenis</th><th scope="col" className="fb-hide">Ukuran</th><th scope="col">Diubah</th></tr></thead>
          <tbody>{files.map((asset) => <tr key={asset.id} className={selected?.id === asset.id ? 'selected' : undefined}>
            <th scope="row"><button type="button" className="fb-name" aria-pressed={selected?.id === asset.id} onClick={() => void open(asset)}>
              {asset.title}<small>{brandId === 'all' ? `${asset.brandName} · ` : ''}{AGENT_NAMES[asset.agentType] ?? asset.agentType}</small>
            </button></th>
            <td><span className={`fb-version${latest.get(asset.taskId) === asset.version ? ' latest' : ''}`} title={latest.get(asset.taskId) === asset.version ? 'Versi terbaru' : 'Versi lama'}>v{asset.version}</span></td>
            <td className="fb-hide">{asset.kind}</td>
            <td className="fb-hide">{sizeLabel(asset.size)}</td>
            <td>{formatDateTime(asset.createdAt)}</td>
          </tr>)}</tbody>
        </table></div>}
      </section>
      <aside className="fb-preview" aria-label="Pratinjau" aria-live="polite">
        {!selected ? <p className="fb-empty">Pilih berkas untuk melihat isinya.</p> : <>
          <h2>{selected.title}</h2>
          <dl className="fb-meta">
            <div><dt>Brand</dt><dd>{selected.brandName}</dd></div>
            <div><dt>Agent</dt><dd>{AGENT_NAMES[selected.agentType] ?? selected.agentType}</dd></div>
            <div><dt>Versi</dt><dd>v{selected.version} · {selected.kind}</dd></div>
            <div><dt>Ukuran</dt><dd>{sizeLabel(selected.size)}</dd></div>
          </dl>
          <div className="fb-actions">
            <button type="button" className="refresh-button" disabled={preview?.content === undefined} onClick={() => preview?.content !== undefined && download(selected, preview.content)}>Unduh .md</button>
            <button type="button" className="refresh-button" disabled={preview?.content === undefined} onClick={() => preview?.content !== undefined && void copy(preview.content)}>{copied ? 'Tersalin' : 'Salin'}</button>
          </div>
          {preview?.error ? <p className="form-error" role="alert">{preview.error}</p> : preview?.content === undefined ? <p className="muted">Memuat isi…</p> : <pre className="fb-content">{preview.content}</pre>}
        </>}
      </aside>
    </div>}
  </>
}
