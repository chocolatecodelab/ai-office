import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { useCrew } from '../agent-directory.ts'
import { formatDateTime, orderedStatuses, statusTone } from '../format.ts'
import { usePolling } from '../polling.ts'
import { loadSnapshot, type RequestState } from '../request-state.ts'
import type { Task, TaskBoardSnapshot, TaskDetailSnapshot } from '../types.ts'
import { Dialog, EmptyState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'
import { ProfileUnlock, RelockBar } from '../ProfileLock.tsx'
import { agentPrivacy, useProfileLock } from '../profile-lock.ts'

const UNASSIGNED = '(unassigned)'

class SafeErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: undefined }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('TaskBoard SafeErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: 16, background: '#261214', border: '1px solid #732227', borderRadius: 8, color: '#f5c6cb', margin: '14px 0' }}>
          <h4 style={{ margin: '0 0 6px' }}>Terjadi kendala saat merender detail tugas</h4>
          <p style={{ margin: '0 0 10px', fontSize: 13 }}>{this.state.error?.message ?? 'Komponen gagal dimuat.'}</p>
          <button
            type="button"
            className="chip chip-button"
            style={{ background: 'var(--accent)', color: '#111', cursor: 'pointer' }}
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Muat Ulang Tampilan
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function Field({ label, value }: { label: string; value?: string | number }) {
  return value === undefined || value === '' ? null : <div><dt>{label}</dt><dd>{value}</dd></div>
}

export function TaskDetailDialog({
  task,
  onClose,
  onOpenTask,
  onTaskUpdated,
}: {
  task: Task
  onClose: () => void
  onOpenTask?: (id: string) => void
  onTaskUpdated?: () => void
}) {
  const [state, setState] = useState<RequestState<TaskDetailSnapshot>>({ status: 'pending' })
  const [isUpdating, setIsUpdating] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; bad?: boolean } | null>(null)
  const lock = useProfileLock()
  // A locked agent's task stays private until its PIN is entered; the server refuses it too.
  const privacy = agentPrivacy(lock, task.assignee)
  const locked = privacy === 'locked' || (task.private === true && !lock)

  const reloadTaskDetail = () => {
    if (!task.id || locked) return
    setState({ status: 'pending' })
    void loadSnapshot<TaskDetailSnapshot>(`/api/tasks/${encodeURIComponent(task.id)}${task.board ? `?board=${encodeURIComponent(task.board)}` : ''}`).then((next) => {
      setState(next)
    })
  }

  useEffect(() => {
    let active = true
    if (!task.id || locked) return
    setState({ status: 'pending' })
    void loadSnapshot<TaskDetailSnapshot>(`/api/tasks/${encodeURIComponent(task.id)}${task.board ? `?board=${encodeURIComponent(task.board)}` : ''}`).then((next) => {
      if (active) setState(next)
    })
    return () => { active = false }
  }, [task.id, task.board, locked])

  const detail = state.status === 'ready' && state.data.task.availability === 'available' ? state.data.task.data : null
  const failed = !task.id || state.status === 'failed' || (state.status === 'ready' && !detail)
  const status = detail?.status ?? task.status

  // Defensive array checks
  const skills = Array.isArray(detail?.skills) ? detail.skills : []
  const parents = Array.isArray(detail?.parents) ? detail.parents : []
  const children = Array.isArray(detail?.children) ? detail.children : []
  const runs = Array.isArray(detail?.runs) ? detail.runs : []
  const comments = Array.isArray(detail?.comments) ? detail.comments : []
  const events = Array.isArray(detail?.events) ? detail.events : []

  const links = (label: string, ids: string[]) => {
    if (!Array.isArray(ids) || ids.length === 0) return null
    return (
      <div>
        <dt>{label}</dt>
        <dd className="task-links">
          {ids.map((id) => (
            <button type="button" key={id} className="chip chip-button" onClick={() => onOpenTask?.(id)}>
              {id}
            </button>
          ))}
        </dd>
      </div>
    )
  }

  const handleStatusChange = async (newStatus: string) => {
    if (!task.id || isUpdating) return
    setIsUpdating(true)
    setFeedback(null)
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (data.success) {
        setFeedback({ text: `✓ Status tugas berhasil dipindahkan ke: ${newStatus.toUpperCase()}` })
        reloadTaskDetail()
        onTaskUpdated?.()
      } else {
        setFeedback({ text: data.message || 'Gagal mengubah status tugas.', bad: true })
      }
    } catch {
      setFeedback({ text: 'Gagal menghubungi server.', bad: true })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleRunNow = async () => {
    if (!task.id || isUpdating) return
    setIsUpdating(true)
    setFeedback({ text: `⚡ Agen ${detail?.assignee || task.assignee || 'Claude'} mulai mengeksekusi tugas...` })
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/run`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setFeedback({ text: `✓ Berhasil dijalankan: ${data.message}` })
        reloadTaskDetail()
        onTaskUpdated?.()
      } else {
        setFeedback({ text: data.message || 'Gagal menjalankan tugas.', bad: true })
      }
    } catch {
      setFeedback({ text: 'Gagal memicu eksekusi agen.', bad: true })
    } finally {
      setIsUpdating(false)
    }
  }

  const handleDelete = async () => {
    if (!task.id || isUpdating) return
    if (!confirm(`Hapus tugas "${detail?.title || task.title}" dari Task Board?`)) return
    setIsUpdating(true)
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        onTaskUpdated?.()
        onClose()
      } else {
        setFeedback({ text: data.message || 'Gagal menghapus tugas.', bad: true })
        setIsUpdating(false)
      }
    } catch {
      setFeedback({ text: 'Gagal menghapus tugas.', bad: true })
      setIsUpdating(false)
    }
  }

  return (
    <Dialog labelledBy="task-detail-title" onClose={onClose} closeLabel={`Close details for ${task.title}`} className="task-detail">
      <SafeErrorBoundary>
        <p className="eyebrow">KANBAN TASK{task.board ? ` · ${task.board.toUpperCase()} BOARD` : ''}{task.id ? ` · ${task.id}` : ''}</p>
        <h2 id="task-detail-title">{detail?.title ?? task.title}</h2>
        <div className="task-meta">
          <span className={`badge ${statusTone(status)}`}>{status}</span>
          <span className={`chip ${task.assignee ? '' : 'chip-muted'}`}>{detail?.assignee ?? task.assignee ?? 'unassigned'}</span>
          {(detail?.priority ?? task.priority) !== undefined ? <span className="chip chip-priority">P{detail?.priority ?? task.priority}</span> : null}
        </div>

        {/* Action Panel for Changing Status, Running, or Deleting */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 14, marginBottom: 14, padding: '10px 12px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>STATUS:</span>
          {(['todo', 'running', 'review', 'done'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`chip chip-button tone-border-${statusTone(s)}`}
              style={{
                fontSize: 11,
                fontWeight: status.toLowerCase() === s ? 700 : 400,
                background: status.toLowerCase() === s ? 'var(--accent)' : 'transparent',
                color: status.toLowerCase() === s ? '#111' : 'var(--text)',
                cursor: 'pointer',
              }}
              onClick={() => handleStatusChange(s)}
              disabled={isUpdating}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="chip chip-button"
              style={{ fontSize: 11, background: 'var(--surface)', border: '1px solid var(--border)', cursor: 'pointer' }}
              onClick={handleRunNow}
              disabled={isUpdating}
              title="Jalankan tugas ini dengan Claude Agent"
            >
              ⚡ Run with Agent
            </button>
            <button
              type="button"
              className="chip chip-button"
              style={{ fontSize: 11, background: 'transparent', border: '1px solid #732227', color: '#ff7b72', cursor: 'pointer' }}
              onClick={handleDelete}
              disabled={isUpdating}
              title="Hapus tugas dari papan"
            >
              🗑 Hapus
            </button>
          </div>
        </div>

        {feedback && (
          <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 6, fontSize: 12, background: feedback.bad ? '#2d1517' : '#14291e', color: feedback.bad ? '#ff7b72' : '#7ee787', border: `1px solid ${feedback.bad ? '#732227' : '#238636'}` }}>
            {feedback.text}
          </div>
        )}

        {locked && task.assignee ? <ProfileUnlock agent={task.assignee} minutes={lock?.unlockMinutes} compact/> : <>
          {privacy === 'unlocked' && task.assignee && <RelockBar agent={task.assignee} minutes={lock?.unlockMinutes ?? 15}/>}
          {state.status === 'pending' && task.id && <p className="muted">Loading task details…</p>}
          {failed && <p className="file-notice">{task.id ? 'Detail lengkap tugas dimuat langsung dari task database lokal Claude AI Office.' : 'This task has no id, so only the board summary is available.'}</p>}
          {detail && <>
            <dl className="office-detail-grid task-grid">
              <Field label="Created" value={detail.createdAt ? `${formatDateTime(detail.createdAt)}${detail.createdBy ? ` by ${detail.createdBy}` : ''}` : undefined}/>
              <Field label="Started" value={detail.startedAt && formatDateTime(detail.startedAt)}/>
              <Field label="Completed" value={detail.completedAt && formatDateTime(detail.completedAt)}/>
              <Field label="Workspace" value={detail.workspace}/>
              <Field label="Branch" value={detail.branch}/>
              <Field label="Model" value={detail.model}/>
              <Field label="Tenant" value={detail.tenant}/>
              {skills.length > 0 ? <Field label="Skills" value={skills.join(', ')}/> : null}
              {links('Depends on', parents)}
              {links('Blocks', children)}
            </dl>
            {detail.lastError && <section className="task-section"><p className="eyebrow">LAST FAILURE</p><pre className="task-text text-bad">{detail.lastError}</pre></section>}
            <section className="task-section"><p className="eyebrow">DESCRIPTION</p>{detail.body ? <pre className="task-text">{detail.body}</pre> : <p className="muted">No description.</p>}</section>
            {detail.result && <section className="task-section"><p className="eyebrow">RESULT / LATEST SUMMARY</p><pre className="task-text">{detail.result}</pre></section>}
            {runs.length > 0 && <section className="task-section"><p className="eyebrow">RUNS ({runs.length})</p><table className="log-table"><thead><tr><th>Run</th><th>Profile</th><th>Status</th><th>Started</th><th>Ended</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td>#{run.id}</td><td>{run.profile ?? '—'}</td><td><span className={`badge ${statusTone(run.outcome ?? run.status ?? '')}`}>{run.outcome ?? run.status ?? '—'}</span>{run.error && <div className="text-bad small-note">{run.error}</div>}{run.summary && <div className="small-note">{run.summary}</div>}</td><td>{formatDateTime(run.startedAt)}</td><td>{formatDateTime(run.endedAt)}</td></tr>)}</tbody></table></section>}
            {comments.length > 0 && <section className="task-section"><p className="eyebrow">COMMENTS ({comments.length})</p><ul className="task-timeline">{comments.map((comment, index) => <li key={index}><b>{comment.author}</b><small>{formatDateTime(comment.createdAt)}</small><p>{comment.body}</p></li>)}</ul></section>}
            {events.length > 0 && <section className="task-section"><p className="eyebrow">ACTIVITY ({events.length})</p><ul className="task-timeline">{[...events].reverse().map((event, index) => <li key={index}><b>{event.kind}</b><small>{formatDateTime(event.createdAt)}{event.runId ? ` · run #${event.runId}` : ''}</small>{event.detail && <code>{event.detail}</code>}</li>)}</ul></section>}
          </>}
        </>}
      </SafeErrorBoundary>
    </Dialog>
  )
}

export function CreateTaskDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const crew = useCrew()
  const [assignee, setAssignee] = useState('ceo')
  const [priority, setPriority] = useState(1)
  const [status, setStatus] = useState('todo')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('Judul tugas wajib diisi')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          assignee: assignee === 'unassigned' ? undefined : assignee,
          priority: Number(priority),
          status,
        }),
      })
      const data = await res.json()
      if (data.success) {
        onCreated()
        onClose()
      } else {
        setError(data.message || 'Gagal menambahkan tugas.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Gagal menghubungi server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog labelledBy="create-task-title" onClose={onClose} closeLabel="Batal buat tugas" className="task-detail">
      <p className="eyebrow">TAMBAH TUGAS BARU</p>
      <h2 id="create-task-title">Buat Tugas Baru ke Task Board</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
        Tugaskan pekerjaan terkoordinasi kepada agen Claude AI Office (CEO, Creator, Researcher, atau Marketing).
      </p>
      {error && (
        <div style={{ padding: '8px 12px', background: '#2d1517', border: '1px solid #732227', color: '#ff7b72', borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
            Judul Tugas *
          </label>
          <input
            type="text"
            className="search-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            placeholder="Contoh: Render video trailer teaser dengan Remotion"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
            Deskripsi / Instruksi Detail
          </label>
          <textarea
            className="search-input"
            rows={4}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
            placeholder="Tuliskan instruksi langkah pengerjaan, file target, atau konteks pekerjaan agen..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              Assignee (Agen)
            </label>
            <select
              className="search-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              {crew.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.role})</option>)}
              <option value="unassigned">(Unassigned)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              Prioritas
            </label>
            <select
              className="search-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            >
              <option value={0}>P0 - Urgent (Kritis)</option>
              <option value={1}>P1 - High (Tinggi)</option>
              <option value={2}>P2 - Medium (Normal)</option>
              <option value={3}>P3 - Low (Rendah)</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>
              Kolom Awal
            </label>
            <select
              className="search-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="todo">Todo</option>
              <option value="running">Running</option>
              <option value="review">Review</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            className="chip chip-button"
            style={{ padding: '8px 16px', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer' }}
            onClick={onClose}
          >
            Batal
          </button>
          <button
            type="submit"
            className="chip chip-button"
            style={{ padding: '8px 18px', background: 'var(--accent)', color: '#111', fontWeight: 600, cursor: 'pointer' }}
            disabled={submitting}
          >
            {submitting ? 'Menyimpan...' : 'Simpan Tugas'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export function TaskBoard() {
  const snapshot = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('all')
  const [board, setBoard] = useState('all')
  const [openTask, setOpenTask] = useState<Task | undefined>()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)

  /** Scrolls the board sideways by about one column, or to a column. */
  const scrollBoard = (direction: number) => boardRef.current?.scrollBy({ left: direction * 250, behavior: 'smooth' })
  const showColumn = (status: string) => boardRef.current?.querySelector<HTMLElement>(`[data-status="${CSS.escape(status)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  const closeTask = () => { setOpenTask(undefined); trigger.current?.focus() }

  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const tasks = data?.tasks
  const all = tasks?.data ?? []
  const assignees = [...new Set(all.map((task) => task.assignee ?? UNASSIGNED))].sort()
  const boards = data?.boards ?? []
  const multiBoard = boards.length > 1
  const needle = query.trim().toLowerCase()
  const visible = all.filter((task) => (assignee === 'all' || (task.assignee ?? UNASSIGNED) === assignee) && (board === 'all' || task.board === board) && (!needle || `${task.title} ${task.id ?? ''} ${task.assignee ?? ''}`.toLowerCase().includes(needle)))
  const columns = orderedStatuses(all.map((task) => task.status), true)

  return (
    <>
      <PageTitle eyebrow="KANBAN TASK BOARD" title="Task Board">
        Papan Kanban tugas tim Claude AI Office: kelola status Todo, Running, Review, dan Done yang terkoordinasi secara real-time bersama tim spesialis.
      </PageTitle>

      <SourceStatus source={tasks} fetchedAt={data?.fetchedAt} request={snapshot}/>
      <Unavailable source={tasks} request={snapshot}/>

      {data?.failedBoards && (
        <p className="file-notice">Could not read the {data.failedBoards.join(', ')} board{data.failedBoards.length === 1 ? '' : 's'}; showing the others.</p>
      )}

      {tasks?.availability === 'available' && (
        all.length === 0 ? (
          <EmptyState title="Belum Ada Tugas">
            <p>Belum ada tugas di Task Board. Anda dapat membuat tugas baru untuk agen AI Anda sekarang.</p>
            <button
              type="button"
              className="chip chip-button"
              style={{ marginTop: 14, background: 'var(--accent)', color: '#111', fontWeight: 600, padding: '8px 18px', cursor: 'pointer' }}
              onClick={() => setShowCreateModal(true)}
            >
              + Buat Tugas Baru
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <SearchInput value={query} onChange={setQuery} label="Search tasks"/>
              <label className="select-label">Assignee <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">All ({all.length})</option>{assignees.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
              {multiBoard && (
                <label className="select-label">Board <select value={board} onChange={(event) => setBoard(event.target.value)}><option value="all">All boards</option>{boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.current ? ' (current)' : ''}</option>)}</select></label>
              )}
              <button
                type="button"
                className="chip chip-button"
                style={{ background: 'var(--accent)', color: '#111', fontWeight: 600, padding: '6px 14px', cursor: 'pointer', marginLeft: 'auto' }}
                onClick={() => setShowCreateModal(true)}
              >
                + Buat Tugas Baru
              </button>
              <span className="toolbar-count">{visible.length} shown</span>
            </div>

            <nav className="board-nav" aria-label="Kanban columns">
              <button type="button" className="refresh-button" onClick={() => scrollBoard(-1)} aria-label="Scroll the board left">‹</button>
              <div className="board-nav-chips">
                {columns.map((status) => (
                  <button type="button" key={status} className={`chip chip-button tone-border-${statusTone(status)}`} onClick={() => showColumn(status)}>
                    {status} <b>{visible.filter((task) => task.status === status).length}</b>
                  </button>
                ))}
              </div>
              <button type="button" className="refresh-button" onClick={() => scrollBoard(1)} aria-label="Scroll the board right">›</button>
            </nav>

            <section className="board" aria-label="Kanban board" ref={boardRef}>
              {columns.map((status) => {
                const items = visible.filter((task) => task.status === status).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
                return (
                  <article key={status} data-status={status} className={`column tone-border-${statusTone(status)}`} aria-label={`${status} column`}>
                    <header className="column-head">
                      <p className="eyebrow">{status}</p>
                      <span className="column-count">{items.length}</span>
                    </header>
                    {items.length === 0 ? (
                      <p className="column-empty">—</p>
                    ) : (
                      items.map((task) => (
                        <button
                          type="button"
                          className="task task-card"
                          key={`${task.board ?? ''}-${task.status}-${task.id ?? task.title}`}
                          onClick={(event) => {
                            trigger.current = event.currentTarget
                            setOpenTask(task)
                          }}
                          aria-label={`${task.title}. ${task.status}. Open task details.`}
                        >
                          <strong>{task.title}</strong>
                          <div className="task-meta">
                            {task.id && <small>{task.id}</small>}
                            {multiBoard && task.board && <span className="chip chip-muted">{task.board}</span>}
                            <span className={`chip ${task.assignee ? '' : 'chip-muted'}`}>{task.assignee ?? 'unassigned'}</span>
                            {task.priority !== undefined ? <span className="chip chip-priority">P{task.priority}</span> : null}
                          </div>
                        </button>
                      ))
                    )}
                  </article>
                )
              })}
            </section>
          </>
        )
      )}

      {openTask && (
        <TaskDetailDialog
          key={`${openTask.board ?? ''}-${openTask.id ?? openTask.title}`}
          task={openTask}
          onClose={closeTask}
          onTaskUpdated={() => snapshot.refresh()}
          onOpenTask={(id) => setOpenTask(all.find((task) => task.id === id && task.board === openTask.board) ?? { id, title: id, status: 'unknown', ...(openTask.board ? { board: openTask.board } : {}) })}
        />
      )}

      {showCreateModal && (
        <CreateTaskDialog
          onClose={() => setShowCreateModal(false)}
          onCreated={() => snapshot.refresh()}
        />
      )}
    </>
  )
}
