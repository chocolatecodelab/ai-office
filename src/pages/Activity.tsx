import { useState } from 'react'
import { usePolling } from '../polling.ts'
import type { ActivitySnapshot } from '../types.ts'
import { EmptyState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'

export function Activity() {
  const snapshot = usePolling<ActivitySnapshot>('/api/activity', 15_000)
  const [query, setQuery] = useState('')
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const sessions = data?.sessions
  const needle = query.trim().toLowerCase()
  const visible = (sessions?.data ?? []).filter((session) => !needle || `${session.title} ${session.preview} ${session.workspace ?? ''} ${session.source ?? ''}`.toLowerCase().includes(needle))
  return <><PageTitle eyebrow="CLAUDE SESSIONS" title="Activity">Riwayat aktivitas dan sesi terbaru tim agen Claude AI Office.</PageTitle>
    <SourceStatus source={sessions} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={sessions} request={snapshot}/>
    {sessions?.availability === 'available' && (sessions.data.length === 0 ? <EmptyState title="No recent sessions">Belum ada sesi percakapan aktif tercatat.</EmptyState> : <>
      <div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Search sessions"/><span className="toolbar-count">{visible.length} of {sessions.data.length}</span></div>
      <section className="data-list">{visible.map((session) => <article key={session.id ?? `${session.title}-${session.lastActive}`}><div><h2>{session.title}</h2>{session.preview && session.preview !== session.title && <p>{session.preview}</p>}</div><dl><div><dt>Last active</dt><dd>{session.lastActive}</dd></div>{session.workspace && <div><dt>Workspace</dt><dd>{session.workspace}</dd></div>}{session.source && <div><dt>Source</dt><dd>{session.source}</dd></div>}{session.id && <div><dt>Session ID</dt><dd>{session.id}</dd></div>}</dl></article>)}</section>
    </>)}
  </>
}
