import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, type HealthCheck, type OfficeTask } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'
import { useState } from 'react'
import { TaskDetailDialog } from '../components/TaskDetailDialog.tsx'

type BoardTask = OfficeTask & { brandName: string }

/** Is each service answering, and which tasks failed lately. Read live from the office API. */
export function Logs() {
  const health = usePolling<HealthCheck[]>('/api/office/health', 10_000)
  const tasks = usePolling<BoardTask[]>('/api/office/tasks', 15_000)
  const [selected,setSelected] = useState<BoardTask>()

  if (health.status === 'pending') return <><PageTitle eyebrow="LOGS" title="Logs"/><LoadingState message="Memeriksa layanan..."/></>
  if (health.status === 'failed') return <><PageTitle eyebrow="LOGS" title="Logs"/><EmptyState title="Tidak tersedia">Kesehatan layanan belum dapat dibaca. {health.message}</EmptyState></>

  const down = health.data.filter((check) => !check.ok).length
  const failed = tasks.status === 'ready' ? tasks.data.filter((task) => task.status === 'failed') : []
  return <div className="management-page logs-page">
    <PageTitle eyebrow="SISTEM" title="Log sistem">Periksa koneksi layanan dan tindak lanjuti tugas yang membutuhkan perhatian.</PageTitle>
    <section className="card settings-card" aria-labelledby="logs-services">
      <div className="settings-head"><div><h2 id="logs-services">Status layanan</h2><p>{health.data.length-down} dari {health.data.length} layanan merespons · diperiksa otomatis setiap 10 detik.</p></div><span className={`badge ${down === 0 ? 'good' : 'danger'}`}>{down === 0 ? 'Sehat' : `${down} bermasalah`}</span></div>
      <ul className="service-list">{health.data.map(check=><li key={check.name}><div><strong>{check.name}</strong><span>{check.detail}</span></div><span className={`service-state ${check.ok ? 'is-up' : 'is-down'}`}>{check.ok ? 'Terhubung' : 'Tidak merespons'}</span><span className="service-latency" aria-label={`Waktu respons ${check.name}`}>{check.ok ? `${check.ms} ms` : '—'}</span></li>)}</ul>
    </section>
    <section className="card settings-card" aria-labelledby="logs-failed">
      <div className="settings-head"><div><p className="eyebrow">TUGAS</p><h2 id="logs-failed">Tugas gagal</h2></div></div>
      {tasks.status === 'pending' ? <p className="muted">Memuat tugas…</p> : tasks.status==='failed' ? <p role="alert">Daftar tugas belum dapat dimuat. <button className="refresh-button" onClick={tasks.refresh}>Coba lagi</button></p> : failed.length === 0 ? <div className="system-empty"><strong>Tidak ada tugas gagal</strong><p>Tugas yang mengalami kendala akan muncul di sini untuk ditinjau.</p></div> : <ul className="failed-task-list">{failed.map((task) => <li key={task.id}>
        <button className="task-open" onClick={()=>setSelected(task)}>{task.title}</button><p>{task.brandName} · {AGENT_NAMES[task.agentType] ?? task.agentType} · {formatDateTime(task.updatedAt)} · percobaan {task.attempts}</p>
        {task.error && <div className="text-bad">{task.error}</div>}
      </li>)}</ul>}
    </section>
    {selected && <TaskDetailDialog key={selected.id} task={selected} brandName={selected.brandName} onClose={()=>setSelected(undefined)} onChanged={tasks.refresh}/>}
  </div>
}
