import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, type HealthCheck, type OfficeTask } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'

type BoardTask = OfficeTask & { brandName: string }

/** Is each service answering, and which tasks failed lately. Read live from the office API. */
export function Logs() {
  const health = usePolling<HealthCheck[]>('/api/office/health', 10_000)
  const tasks = usePolling<BoardTask[]>('/api/office/tasks', 15_000)

  if (health.status === 'pending') return <><PageTitle eyebrow="LOGS" title="Logs"/><LoadingState message="Memeriksa layanan..."/></>
  if (health.status === 'failed') return <><PageTitle eyebrow="LOGS" title="Logs"/><EmptyState title="Tidak tersedia">Kesehatan layanan belum dapat dibaca. {health.message}</EmptyState></>

  const down = health.data.filter((check) => !check.ok).length
  const failed = tasks.status === 'ready' ? tasks.data.filter((task) => task.status === 'failed') : []
  return <>
    <PageTitle eyebrow="LOGS" title="Logs">Kesehatan layanan dan tugas yang gagal terbaru. {down === 0 ? 'Semua layanan menjawab.' : `${down} layanan tidak menjawab.`}</PageTitle>
    <section className="card settings-card" aria-labelledby="logs-services">
      <div className="settings-head"><div><p className="eyebrow">LAYANAN</p><h2 id="logs-services">Status layanan</h2></div><span className={`badge ${down === 0 ? 'good' : 'danger'}`}>{down === 0 ? 'Sehat' : `${down} bermasalah`}</span></div>
      <ul className="role-list">{health.data.map((check) => <li key={check.name}><strong>{check.name}</strong> <span className={`badge ${check.ok ? 'good' : 'danger'}`}>{check.ok ? 'Hidup' : 'Mati'}</span> <span className="muted">· {check.detail}{check.ok ? ` · ${check.ms} ms` : ''}</span></li>)}</ul>
    </section>
    <section className="card settings-card" aria-labelledby="logs-failed">
      <div className="settings-head"><div><p className="eyebrow">TUGAS</p><h2 id="logs-failed">Tugas gagal</h2></div></div>
      {tasks.status !== 'ready' ? <p className="muted">Memuat tugas…</p> : failed.length === 0 ? <p className="muted">Tidak ada tugas yang gagal.</p> : <ul className="role-list">{failed.map((task) => <li key={task.id}>
        <strong>{task.title}</strong> <span className="muted">· {task.brandName} · {AGENT_NAMES[task.agentType] ?? task.agentType} · {formatDateTime(task.updatedAt)} · percobaan {task.attempts}</span>
        {task.error && <div className="text-bad">{task.error}</div>}
      </li>)}</ul>}
    </section>
  </>
}
