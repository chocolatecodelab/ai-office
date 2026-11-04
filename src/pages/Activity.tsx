import { useState } from 'react'
import { formatDateTime } from '../format.ts'
import { TASK_STATUS_LABELS, type ActivityItem } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle, SearchInput } from '../ui.tsx'

const ACTION_TEXT: Record<string, string> = {
  'task.create': 'Tugas dibuat',
  'approval.approved': 'Approval disetujui',
  'approval.rejected': 'Approval ditolak, diminta revisi',
}

function actorText(actor: string): string {
  return actor.startsWith('agent:') ? `Agent ${actor.slice(6)}` : actor
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

  return <>
    <PageTitle eyebrow="ACTIVITY" title="Activity">Riwayat tugas dan keputusan approval semua brand: siapa melakukan apa, dan kapan.</PageTitle>
    {activity.data.length === 0 ? <EmptyState title="Belum ada aktivitas">Aktivitas muncul setelah tugas dibuat atau approval diputuskan.</EmptyState> : <>
      <div className="toolbar">
        <button type="button" className={`chip chip-button ${brandId === 'all' ? 'active' : ''}`} aria-pressed={brandId === 'all'} onClick={() => setBrandId('all')}>Semua</button>
        {brands.map(([id, name]) => <button type="button" key={id} className={`chip chip-button ${brandId === id ? 'active' : ''}`} aria-pressed={brandId === id} onClick={() => setBrandId(id)}>{name}</button>)}
        <SearchInput value={query} onChange={setQuery} label="Cari aktivitas"/>
        <span className="toolbar-count">{visible.length} dari {activity.data.length}</span>
      </div>
      <section className="data-list">{visible.map((item, index) => <article key={`${item.at}-${item.action}-${item.title}-${index}`}>
        <div><h2>{item.title ?? '(tanpa judul)'}</h2><p>{describe(item)}{item.reason ? ` · ${item.reason}` : ''}</p></div>
        <dl>
          <div><dt>Waktu</dt><dd>{formatDateTime(item.at)}</dd></div>
          <div><dt>Brand</dt><dd>{item.brandName}</dd></div>
          <div><dt>Oleh</dt><dd>{actorText(item.actor)}</dd></div>
        </dl>
      </article>)}</section>
    </>}
  </>
}
