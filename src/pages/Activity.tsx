import { useState } from 'react'
import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, TASK_STATUS_LABELS, type ActivityItem } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'

const ACTION_TEXT: Record<string, string> = {
  'task.create': 'Tugas dibuat',
  'approval.approved': 'Approval disetujui',
  'approval.rejected': 'Approval ditolak, diminta revisi',
  'note.create': 'Catatan agent ditambah',
  'note.update': 'Catatan agent diubah',
  'note.delete': 'Catatan agent dihapus',
  'kill-switch.pause': 'Kill switch: dijeda',
  'kill-switch.resume': 'Kill switch: dilanjutkan',
  'asset.rerender': 'PDF dibuat ulang',
  'model.set': 'Model agent diperbarui',
  'model.reset': 'Model agent dikembalikan ke bawaan',
}

function actorText(actor: string): string {
  return actor.startsWith('agent:') ? (AGENT_NAMES[actor.slice(6)] ?? `Agent ${actor.slice(6)}`) : actor === 'pengguna-lokal' ? 'Pengguna lokal' : actor
}

function describe(item: ActivityItem): string {
  if (item.kind === 'status') return `${item.from ? TASK_STATUS_LABELS[item.from] : '—'} → ${item.to ? TASK_STATUS_LABELS[item.to] : '—'}`
  return ACTION_TEXT[item.action] ?? item.action
}

/** Audit entries and task status changes of every brand, newest first (FR-64 audit log). */
export function Activity() {
  const activity = usePolling<ActivityItem[]>('/api/office/activity', 15_000)
  const [query, setQuery] = useState('')
  const [brandId, setBrandId] = useState('all')

  if (activity.status === 'pending') return <><PageTitle eyebrow="ACTIVITY" title="Activity"/><LoadingState message="Memuat aktivitas..."/></>
  if (activity.status === 'failed') return <><PageTitle eyebrow="ACTIVITY" title="Activity"/><EmptyState title="Tidak tersedia">Riwayat aktivitas belum dapat dimuat. {activity.message}</EmptyState></>

  const brands = [...new Map(activity.data.map((item) => [item.brandId, item.brandName])).entries()]
  const needle = query.trim().toLowerCase()
  const visible = activity.data.filter((item) => (brandId === 'all' || item.brandId === brandId)
    && (!needle || `${item.title ?? ''} ${describe(item)} ${actorText(item.actor)} ${item.reason ?? ''} ${item.brandName}`.toLowerCase().includes(needle)))

  return <div className="management-page activity-page">
    <PageTitle eyebrow="RIWAYAT" title="Aktivitas">Telusuri pekerjaan tim, perubahan catatan, dan keputusan persetujuan.</PageTitle>
    {activity.data.length === 0 ? <EmptyState title="Belum ada aktivitas">Aktivitas muncul setelah tugas dibuat atau approval diputuskan.</EmptyState> : <>
      <div className="toolbar management-toolbar" role="group" aria-label="Filter aktivitas">
        <button type="button" className={`chip chip-button ${brandId === 'all' ? 'active' : ''}`} aria-pressed={brandId === 'all'} onClick={() => setBrandId('all')}>Semua</button>
        {brands.map(([id, name]) => <button type="button" key={id} className={`chip chip-button ${brandId === id ? 'active' : ''}`} aria-pressed={brandId === id} onClick={() => setBrandId(id)}>{name}</button>)}
        <SearchInput value={query} onChange={setQuery} label="Cari aktivitas"/>
        <span className="toolbar-count">{visible.length} dari {activity.data.length}</span>
      </div>
      {visible.length===0 && <EmptyState title="Tidak ada aktivitas yang cocok">Ubah kata pencarian atau pilih brand lain.</EmptyState>}
      <ol className="activity-timeline" aria-label="Riwayat aktivitas">{visible.map((item, index) => <li key={`${item.at}-${item.action}-${item.title}-${index}`}>
        <div className="activity-marker" aria-hidden="true"/>
        <article><div className="activity-entry-heading"><span className="activity-brand">{item.brandName}</span><time dateTime={item.at}>{formatDateTime(item.at)}</time></div>
        <h2>{item.title?.trim() || (ACTION_TEXT[item.action] ? describe(item) : 'Aktivitas sistem')}</h2>
        {item.title?.trim() && <p className="activity-description">{describe(item)}</p>}
        {item.reason && <p className="activity-reason">{item.reason}</p>}
        <p className="activity-actor">Oleh {actorText(item.actor)}</p>
        {!ACTION_TEXT[item.action] && item.kind!=='status' && <details><summary>Detail aktivitas</summary><code>{item.action}</code></details>}
        </article>
      </li>)}</ol>
    </>}
  </div>
}
