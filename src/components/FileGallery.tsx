import { useEffect, useState } from 'react'
import { downloadText, sizeLabel } from '../download.ts'
import { KIND_LABELS, assetLabel, fileKind, fileName, thumbText, type FileKind } from '../folder-filters.ts'
import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, officeRequest, type AssetItem, type AssetPreview } from '../office-api.ts'
import { Dialog } from '../ui.tsx'

const agentName = (asset: AssetItem) => AGENT_NAMES[asset.agentType] ?? asset.agentType

/** A small coloured file-type mark; the kind is also written out, so colour is never the only cue. */
export function KindIcon({ kind }: { kind: FileKind }) {
  return <span className={`fb-icon fb-icon-${kind}`} role="img" aria-label={KIND_LABELS[kind]}>{kind === 'reply' ? 'AI' : kind === 'subtitle' ? 'SRT' : kind === 'doc' ? 'DOC' : kind === 'web' ? 'WEB' : kind.toUpperCase()}</span>
}

export function FolderCard({ title, count, note, onOpen }: { title: string; count: number; note?: string; onOpen: () => void }) {
  return <button type="button" className="fb-folder" onClick={onOpen} aria-label={`Folder ${title}, ${count} berkas`}>
    <svg className="fb-folder-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h4l2 2.2H18.5A2.5 2.5 0 0 1 21 8.7v8.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/></svg>
    <span className="fb-folder-text"><b>{title}</b><small>{count} berkas{note ? ` · ${note}` : ''}</small></span>
  </button>
}

export function FileCard({ asset, showBrand, latest, selected, onOpen }: { asset: AssetItem; showBrand: boolean; latest: boolean; selected: boolean; onOpen: () => void }) {
  const kind = fileKind(asset)
  const thumb = thumbText(asset)
  const [imageFailed,setImageFailed]=useState(false)
  return <button type="button" className="fb-card" aria-pressed={selected} onClick={onOpen}>
    <span className={`fb-thumb fb-thumb-${kind}`} aria-hidden="true">
      {kind==='image'&&asset.downloadable ? imageFailed?<span className="fb-thumb-empty">Pratinjau tidak tersedia</span>:<img className="fb-thumbnail-image" src={`/api/office/brands/${encodeURIComponent(asset.brandId)}/assets/${encodeURIComponent(asset.id)}/file?inline=1`} alt="" loading="lazy" decoding="async" onError={()=>setImageFailed(true)}/> : thumb ? <span className="fb-thumb-text">{thumb}</span> : <span className="fb-thumb-empty">{KIND_LABELS[kind]}</span>}
    </span>
    <span className="fb-card-info">
      <KindIcon kind={kind}/>
      <span className="fb-card-text">
        <b>{assetLabel(asset)}</b>
        <small>{showBrand ? `${asset.brandName} · ` : ''}{agentName(asset)} · {formatDateTime(asset.createdAt)}</small>
      </span>
      {asset.kind !== 'artifact' && <span className={`fb-version${latest ? ' latest' : ''}`} title={latest ? 'Versi terbaru' : 'Versi lama'}>v{asset.version}</span>}
    </span>
  </button>
}

interface Loaded { content?: string; preview?: AssetPreview; error?: string }

/** A file opened large: the page as it would print, with the actions that belong to it. */
export function PreviewDialog({ asset, onClose, onChanged }: { asset: AssetItem; onClose: () => void; onChanged: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({})
  const [copied, setCopied] = useState(false)
  const [imageFailed,setImageFailed]=useState(false)
  const [size, setSize] = useState(asset.size)
  const [rerender, setRerender] = useState<{ busy: boolean; note?: string; failed?: boolean }>({ busy: false })
  useEffect(() => {
    if(asset.mime==='image/png')return
    let current = true
    const base = `/brands/${asset.brandId}/assets/${asset.id}`
    Promise.all([officeRequest<{ content: string }>('GET', base), officeRequest<AssetPreview>('GET', `${base}/preview`)])
      .then(([full, preview]) => { if (current) setLoaded({ content: full.content, preview }) })
      .catch((failure) => { if (current) setLoaded({ error: failure instanceof Error ? failure.message : String(failure) }) })
    return () => { current = false }
  }, [asset.brandId, asset.id, asset.mime])

  const content = loaded.content
  const printAgain = async () => {
    setRerender({ busy: true })
    try {
      const result = await officeRequest<{ size: number }>('POST', `/brands/${asset.brandId}/assets/${asset.id}/rerender`)
      setSize(result.size)
      setRerender({ busy: false, note: `PDF dicetak ulang (${sizeLabel(result.size)}).` })
      onChanged()
    } catch (failure) {
      setRerender({ busy: false, failed: true, note: failure instanceof Error ? failure.message : String(failure) })
    }
  }
  const copy = async () => {
    if (content === undefined) return
    try { await navigator.clipboard.writeText(content); setCopied(true) } catch { setCopied(false) }
  }
  const { preview } = loaded
  return <Dialog labelledBy="fb-dialog-title" onClose={onClose} closeLabel="Tutup pratinjau" className="fb-dialog">
    <header className="fb-dialog-head">
      <KindIcon kind={fileKind(asset)}/>
      <div>
        <h2 id="fb-dialog-title">{assetLabel(asset)}</h2>
        <p>{asset.brandName} · {agentName(asset)} · {KIND_LABELS[fileKind(asset)]}{asset.kind === 'artifact' ? '' : ` v${asset.version}`} · {sizeLabel(size)} · {formatDateTime(asset.createdAt)}</p>
      </div>
    </header>
    <div className="fb-actions">
      {asset.downloadable
        ? <a className="refresh-button" href={`/api/office/brands/${asset.brandId}/assets/${asset.id}/file`} download={fileName(asset)}>Unduh berkas</a>
        : <button type="button" className="refresh-button" disabled={content === undefined} onClick={() => content !== undefined && downloadText(fileName(asset), content, 'text/markdown;charset=utf-8')}>Unduh</button>}
      {asset.mime!=='image/png'&&<button type="button" className="refresh-button" disabled={content === undefined} onClick={() => void copy()}>{copied ? 'Tersalin' : 'Salin isi'}</button>}
      {asset.downloadable && asset.mime==='application/pdf' && <button type="button" className="refresh-button" disabled={rerender.busy} title="Mencetak ulang dari Markdown tersimpan dengan templat terbaru" onClick={() => void printAgain()}>{rerender.busy ? 'Mencetak…' : 'Buat ulang PDF'}</button>}
    </div>
    {rerender.note && <p className={rerender.failed ? 'form-error' : 'small-note'} role={rerender.failed ? 'alert' : 'status'}>{rerender.note}</p>}
    <div className="fb-stage">
      {asset.mime==='image/png' ? imageFailed?<p role="alert">Gambar tidak dapat dimuat. Anda tetap dapat mencoba mengunduh berkas.</p>:<img className="agent-produced-image" src={`/api/office/brands/${asset.brandId}/assets/${asset.id}/file?inline=1`} alt={assetLabel(asset)} onError={()=>setImageFailed(true)}/> : loaded.error ? <p className="form-error" role="alert">{loaded.error}</p>
        : !preview ? <p className="muted">Memuat isi…</p>
        : preview.type === 'text' ? <pre className="fb-content">{preview.text}</pre>
        : <iframe className="fb-page" title={`Pratinjau ${assetLabel(asset)}`} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html}/>}
    </div>
  </Dialog>
}
