import { PaginatedItems } from '../components/PaginatedItems.tsx'
import { useState } from 'react'
import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, TASK_STATUS_LABELS, officeRequest, type OfficeBrand, type OfficeTask, type TaskStatus } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'
import { TaskComposer } from '../components/TaskComposer.tsx'
import { TaskDetailDialog } from '../components/TaskDetailDialog.tsx'

type BoardTask = OfficeTask & { brandName: string }

// Columns follow the task statuses of blueprint FR-11. Paused, failed and cancelled share one column.
const COLUMNS: Array<{ title: string; statuses: TaskStatus[] }> = [
  { title: 'Antre', statuses: ['queued'] },
  { title: 'Dikerjakan', statuses: ['running'] },
  { title: 'Menunggu kuota', statuses: ['waiting_quota'] },
  { title: 'Menunggu approval', statuses: ['waiting_approval'] },
  { title: 'Revisi', statuses: ['revision'] },
  { title: 'Selesai', statuses: ['approved', 'done'] },
  { title: 'Berhenti', statuses: ['paused', 'failed', 'cancelled'] },
]

// The same rule as the agent panel: a task can be cancelled before it runs or after it stopped.
const CANCELLABLE: TaskStatus[] = ['queued', 'waiting_quota', 'paused', 'failed']

export function TaskBoard() {
  const tasks = usePolling<BoardTask[]>('/api/office/tasks', 10_000)
  const brands = usePolling<OfficeBrand[]>('/api/office/brands', 60_000)
  const [brandId, setBrandId] = useState('all')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [selected,setSelected] = useState<OfficeTask>()
  const [creating,setCreating] = useState(false)
  const [status,setStatus] = useState('all')
  const [notice,setNotice] = useState('')

  if (tasks.status === 'pending') return <><PageTitle eyebrow="TASK BOARD" title="Task Board"/><LoadingState message="Memuat tugas..."/></>
  if (tasks.status === 'failed') return <><PageTitle eyebrow="TASK BOARD" title="Task Board"/><EmptyState title="Tidak tersedia">Papan tugas belum dapat dimuat. {tasks.message}</EmptyState></>

  const visible = tasks.data.filter((task) => brandId === 'all' || task.brandId === brandId)
  const act = async (task: BoardTask, action: 'cancel' | 'retry') => {
    setBusy(task.id)
    setError(undefined)
    try {
      await officeRequest('POST', `/brands/${task.brandId}/tasks/${task.id}/${action}`, action === 'cancel' ? { reason: 'Dibatalkan dari Task Board' } : undefined)
      tasks.refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(undefined)
    }
  }

  return <>
    <div className="work-page-heading"><PageTitle eyebrow="TUGAS" title="Papan tugas">Pantau pekerjaan tim, buka hasil, dan berikan tugas baru.</PageTitle><button className="primary-button" disabled={brands.status!=='ready'} onClick={()=>setCreating(true)}>Beri tugas</button></div>
    {notice && <p className="task-created-notice" role="status">{notice}</p>}
    <div className="toolbar" role="group" aria-label="Brand">
      <button type="button" className={`chip chip-button ${brandId === 'all' ? 'active' : ''}`} aria-pressed={brandId === 'all'} onClick={() => setBrandId('all')}>Semua</button>
      {brands.status === 'ready' && brands.data.map((brand) => <button type="button" key={brand.id} className={`chip chip-button ${brandId === brand.id ? 'active' : ''}`} aria-pressed={brandId === brand.id} onClick={() => setBrandId(brand.id)}>{brand.name}</button>)}
      <span className="toolbar-count">{visible.length} tugas</span>
    </div>
    <label className="board-status-filter">Status tugas<select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">Semua status</option>{COLUMNS.map(c=><option value={c.title} key={c.title}>{c.title} ({visible.filter(t=>c.statuses.includes(t.status)).length})</option>)}</select></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className={`board work-board${status!=='all' ? ' filtered' : ''}`}>{COLUMNS.filter(c=>status==='all' || c.title===status).map((column) => {
      const items = visible.filter((task) => column.statuses.includes(task.status))
      return <section className="column" key={column.title} aria-label={column.title}>
        <div className="column-head"><p className="eyebrow">{column.title}</p><span className="column-count">{items.length}</span></div>
        {items.length === 0 && <p className="column-empty">Kosong</p>}
        <PaginatedItems items={items} scope={brandId} label="tugas">{rows=><>{rows.map((task) => <article className="task task-card" key={task.id}>
          <button className="task-open" title={task.title} onClick={()=>setSelected(task)}>{task.title}</button>
          <p className="task-meta">{task.brandName}<br/>{AGENT_NAMES[task.agentType] ?? task.agentType}</p>
          <p className="task-meta">{TASK_STATUS_LABELS[task.status]} · percobaan {task.attempts}{task.retryAt ? ` · coba lagi ${formatDateTime(task.retryAt)}` : ''}</p>
          {task.error && <p className="task-text text-bad">{task.error}</p>}
          <p className="task-meta">Diperbarui {formatDateTime(task.updatedAt)}</p>
          <div className="toolbar">
            <button type="button" className="refresh-button" onClick={()=>setSelected(task)}>Lihat detail &amp; hasil</button>
            {CANCELLABLE.includes(task.status) && <button type="button" className="refresh-button" disabled={busy === task.id} onClick={() => void act(task, 'cancel')}>Batalkan</button>}
            {task.status === 'failed' && <button type="button" className="refresh-button" disabled={busy === task.id} onClick={() => void act(task, 'retry')}>Coba ulang</button>}
          </div>
        </article>)}</>}</PaginatedItems>
      </section>
    })}</div>
    {creating && brands.status==='ready' && <TaskComposer brands={brands.data} initialBrand={brandId} onClose={()=>setCreating(false)} onCreated={task=>{setCreating(false);tasks.refresh();setSelected(task);setNotice('Tugas berhasil dikirim ke antrean.')}}/>}
    {selected && <TaskDetailDialog key={selected.id} task={selected} brandName={brands.status==='ready' ? brands.data.find(b=>b.id===selected.brandId)?.name ?? selected.brandId : selected.brandId} onClose={()=>setSelected(undefined)} onChanged={tasks.refresh}/>}
  </>
}
