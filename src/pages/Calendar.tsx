import { useState, type FormEvent } from 'react'
import { dayKey, monthEntries, type CalendarEntry } from '../cron-calendar.ts'
import { useCrew } from '../agent-directory.ts'
import { agentLabel, formatDateTime } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { CalendarSnapshot, ScheduledJob } from '../types.ts'
import { Dialog, EmptyState, LoadingState, PageTitle, SourceStatus, Unavailable } from '../ui.tsx'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_LABEL: Record<CalendarEntry['kind'], string> = { run: 'Scheduled run', interval: 'Repeats through the day', overdue: 'Overdue', 'last-ok': 'Last run · ok', 'last-failed': 'Last run · failed' }

function todayKey(): string {
  const now = new Date()
  return dayKey(now.getFullYear(), now.getMonth(), now.getDate())
}

/** A month grid of cron runs: upcoming runs from today, plus overdue and last-run markers. */
export function MonthView({ jobs: allJobs }: { jobs: ScheduledJob[] }) {
  const today = todayKey()
  const agents = [...new Set(allJobs.map((job) => job.agent).filter((agent): agent is string => Boolean(agent)))]
  const [agent, setAgent] = useState('')
  const jobs = agent ? allJobs.filter((job) => job.agent === agent) : allJobs
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() } })
  const [selected, setSelected] = useState(today)
  const entries = monthEntries(jobs, cursor.year, cursor.month, today)
  const first = new Date(cursor.year, cursor.month, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)]
  const move = (delta: number) => setCursor(({ year, month }) => { const next = new Date(year, month + delta, 1); return { year: next.getFullYear(), month: next.getMonth() } })
  const selectedEntries = entries.get(selected) ?? []
  return <section className="month-view" aria-label="Cron calendar">
    <header className="month-head">
      <button type="button" className="icon-button" onClick={() => move(-1)} aria-label="Previous month">‹</button>
      <h2>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <button type="button" className="icon-button" onClick={() => move(1)} aria-label="Next month">›</button>
      <button type="button" className="refresh-button" onClick={() => { const now = new Date(); setCursor({ year: now.getFullYear(), month: now.getMonth() }); setSelected(today) }}>Today</button>
      {agents.length > 1 && <label className="month-filter"><span>Agent</span><select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents ({allJobs.length})</option>{agents.map((item) => <option key={item} value={item}>{agentLabel(item)} ({allJobs.filter((job) => job.agent === item).length})</option>)}</select></label>}
      <span className="month-legend"><i className="kind-run"/>run <i className="kind-interval"/>repeating <i className="kind-last-ok"/>last ok <i className="kind-last-failed"/>failed / overdue</span>
    </header>
    <div className="month-grid" role="grid">
      {WEEKDAYS.map((day) => <div key={day} className="month-weekday" role="columnheader">{day}</div>)}
      {cells.map((day, index) => {
        if (day === null) return <div key={`lead-${index}`} className="month-cell empty" aria-hidden="true"/>
        const key = dayKey(cursor.year, cursor.month, day)
        const list = entries.get(key) ?? []
        return <button type="button" role="gridcell" key={key} className={`month-cell${key === today ? ' today' : ''}${key === selected ? ' selected' : ''}${key < today ? ' past' : ''}`} onClick={() => setSelected(key)} aria-label={`${key}: ${list.length} item${list.length === 1 ? '' : 's'}`} aria-selected={key === selected}>
          <span className="month-day">{day}</span>
          {list.slice(0, 3).map((entry, entryIndex) => <span key={entryIndex} className={`month-entry kind-${entry.kind}`} title={`${entry.job}${entry.agent ? ` (${agentLabel(entry.agent)})` : ''} · ${KIND_LABEL[entry.kind]} ${entry.label}`}><b>{entry.label}</b> {entry.job}</span>)}
          {list.length > 3 && <span className="month-more">+{list.length - 3} more</span>}
          {list.length > 0 && <span className="month-dots" aria-hidden="true">{list.slice(0, 4).map((entry, entryIndex) => <i key={entryIndex} className={`kind-${entry.kind}`}/>)}</span>}
        </button>
      })}
    </div>
    <div className="month-day-detail">
      <p className="eyebrow">{new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      {selectedEntries.length === 0 ? <p className="muted">Nothing scheduled on this day.</p> : <ul>{selectedEntries.map((entry, index) => <li key={index}><span className={`badge kind-${entry.kind}`}>{KIND_LABEL[entry.kind]}</span> <strong>{entry.job}</strong> <span className="muted">{entry.label}</span>{entry.agent && <span className="chip">{agentLabel(entry.agent)}</span>}</li>)}</ul>}
      <small className="muted">Waktu menggunakan zona waktu lokal browser/server Anda. Tugas yang dijeda hanya menampilkan riwayat eksekusi terakhir.</small>
    </div>
  </section>
}

/** The cron month view with its own data, for the Office overlay. */
export function CalendarOverlayView() {
  const snapshot = usePolling<CalendarSnapshot>('/api/calendar', 30_000)
  const jobs = snapshot.status === 'ready' ? snapshot.data.jobs : undefined
  if (snapshot.status === 'pending') return <LoadingState message="Memuat jadwal tugas Claude..."/>
  return <>
    <Unavailable source={jobs} request={snapshot}/>
    {jobs?.availability === 'available' && <MonthView jobs={jobs.data}/>}
  </>
}

const PRESET_SCHEDULES = [
  { label: 'Setiap Hari (08:00 WIB)', cron: '0 8 * * *', repeat: 'Setiap Hari 08:00' },
  { label: 'Hari Kerja Senin - Jumat (09:00 WIB)', cron: '0 9 * * 1-5', repeat: 'Senin - Jumat 09:00' },
  { label: 'Setiap Senin (10:00 WIB)', cron: '0 10 * * 1', repeat: 'Setiap Senin 10:00' },
  { label: 'Setiap Selasa & Kamis (14:00 WIB)', cron: '0 14 * * 2,4', repeat: 'Selasa & Kamis 14:00' },
  { label: 'Ulangi Setiap 2 Jam', cron: 'every 2h', repeat: 'Setiap 2 jam' },
  { label: 'Kustom Cron Expression', cron: 'custom', repeat: 'Custom' },
]

export function Calendar() {
  const snapshot = usePolling<CalendarSnapshot>('/api/calendar', 15_000)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [runningJobId, setRunningJobId] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<{ text: string; isError?: boolean } | null>(null)

  // Form states
  const [name, setName] = useState('')
  const crew = useCrew()
  const [agent, setAgent] = useState('ceo')
  const [preset, setPreset] = useState(PRESET_SCHEDULES[1].cron)
  const [customCron, setCustomCron] = useState('0 9 * * 1-5')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const showToast = (text: string, isError = false) => {
    setToastMessage({ text, isError })
    setTimeout(() => setToastMessage(null), 5000)
  }

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)

    const finalCron = preset === 'custom' ? customCron.trim() : preset
    const presetItem = PRESET_SCHEDULES.find((p) => p.cron === preset)
    const repeatLabel = preset === 'custom' ? finalCron : presetItem?.repeat || finalCron

    try {
      const res = await fetch('/api/calendar/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          agent,
          schedule: finalCron,
          repeat: repeatLabel,
          description: description.trim(),
          prompt: prompt.trim() || description.trim()
        })
      })
      const data = await res.json()
      if (data.success) {
        showToast(`✓ Jadwal "${data.job?.name}" berhasil ditambahkan ke kalender Claude!`)
        setShowCreateModal(false)
        setName('')
        setDescription('')
        setPrompt('')
        snapshot.refresh()
      } else {
        showToast(data.message || 'Gagal menambahkan jadwal.', true)
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal menghubungi server.', true)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggleJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/calendar/jobs/${encodeURIComponent(jobId)}/toggle`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        showToast(`Status jadwal berhasil diubah ke: ${data.status}`)
        snapshot.refresh()
      }
    } catch {
      showToast('Gagal mengubah status jadwal.', true)
    }
  }

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    if (!confirm(`Hapus jadwal "${jobName}"?`)) return
    try {
      const res = await fetch(`/api/calendar/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        showToast(`Jadwal "${jobName}" berhasil dihapus.`)
        snapshot.refresh()
      }
    } catch {
      showToast('Gagal menghapus jadwal.', true)
    }
  }

  const handleRunNow = async (job: ScheduledJob) => {
    if (!job.id) return
    setRunningJobId(job.id)
    showToast(`⚡ Menjalankan jadwal "${job.name}" oleh agen ${agentLabel(job.agent || '')}...`)
    try {
      const res = await fetch(`/api/calendar/jobs/${encodeURIComponent(job.id)}/run`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        showToast(`✓ Berhasil dieksekusi: ${data.message}`)
        snapshot.refresh()
      } else {
        showToast(data.message || 'Gagal menjalankan tugas.', true)
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal mengeksekusi tugas.', true)
    } finally {
      setRunningJobId(null)
    }
  }

  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const jobs = data?.jobs
  const sorted = [...(jobs?.data ?? [])].sort((a, b) => (a.nextRun ?? '~').localeCompare(b.nextRun ?? '~'))

  return (
    <>
      <PageTitle eyebrow="CLAUDE SCHEDULER" title="Calendar">
        Jadwal tugas berkala (cron) untuk seluruh kru agen Claude (CEO, Marketing, Researcher, Creator). Anda dapat mengatur waktu eksekusi otomatis, memantau kalender, dan memicu eksekusi instan.
      </PageTitle>

      {toastMessage && (
        <section className={`notice ${toastMessage.isError ? 'bad' : 'info'}`} style={{ marginBottom: 16 }}>
          <strong>{toastMessage.isError ? 'Perhatian:' : 'Pemberitahuan:'}</strong> {toastMessage.text}
        </section>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <SourceStatus source={jobs} fetchedAt={data?.fetchedAt} request={snapshot} />
        <button
          type="button"
          className="refresh-button"
          style={{ background: '#243b2f', borderColor: '#48bb78', color: '#c6f6d5', padding: '7px 14px', fontSize: 12, fontWeight: 600 }}
          onClick={() => setShowCreateModal(true)}
        >
          + Buat Jadwal Baru
        </button>
      </div>

      <Unavailable source={jobs} request={snapshot} />

      {jobs?.availability === 'available' && sorted.length > 0 && <MonthView jobs={jobs.data} />}

      {jobs?.availability === 'available' && (
        sorted.length === 0 ? (
          <EmptyState title="Belum Ada Jadwal Tugas">
            Tidak ada jadwal tugas berkala untuk tim Claude. Klik tombol <strong>+ Buat Jadwal Baru</strong> di atas untuk membuat jadwal tugas otomatis bagi agen Anda.
          </EmptyState>
        ) : (
          <section className="data-list" style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 16, marginBottom: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: 'ui-monospace, monospace' }}>
              Daftar Tugas Terjadwal ({sorted.length})
            </h2>
            {sorted.map((job) => {
              const isRunning = runningJobId === job.id
              const isPaused = (job.status ?? '').toLowerCase() === 'paused'
              return (
                <article key={`${job.agent ?? ''}:${job.id ?? `${job.name}-${job.schedule}`}`} style={{ opacity: isPaused ? 0.75 : 1 }}>
                  <div>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {job.name}
                      {job.agent && <span className="chip job-agent">{agentLabel(job.agent)}</span>}
                      {isPaused ? (
                        <span className="badge muted">Paused</span>
                      ) : (
                        <span className="badge good">Active</span>
                      )}
                    </h2>
                    <p style={{ marginTop: 4 }}>
                      <code>{job.schedule}</code>
                      {job.repeat && <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>· {job.repeat}</span>}
                    </p>
                  </div>

                  <dl>
                    <div>
                      <dt>{job.overdue ? 'Terlambat sejak' : 'Next run'}</dt>
                      <dd className={job.overdue ? 'text-bad' : ''}>{formatDateTime(job.nextRun)}</dd>
                    </div>
                    {job.lastRun && (
                      <div>
                        <dt>Last run</dt>
                        <dd>
                          {formatDateTime(job.lastRun)}{' '}
                          <span className={`badge ${job.lastRunOk ? 'good' : 'bad'}`}>
                            {job.lastRunOk ? 'ok' : 'failed'}
                          </span>
                        </dd>
                      </div>
                    )}
                  </dl>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="chip chip-button"
                      style={{ background: '#20392c', borderColor: '#48bb78', color: '#bbf7d0', cursor: isRunning ? 'wait' : 'pointer' }}
                      disabled={isRunning}
                      onClick={() => handleRunNow(job)}
                      title="Eksekusi tugas ini sekarang juga dengan agen Claude"
                    >
                      {isRunning ? '⏳ Running...' : '▶ Run Now'}
                    </button>
                    <button
                      type="button"
                      className="chip chip-button"
                      onClick={() => job.id && handleToggleJob(job.id)}
                      title={isPaused ? 'Aktifkan kembali jadwal' : 'Jeda sementara jadwal ini'}
                    >
                      {isPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                    <button
                      type="button"
                      className="chip chip-button"
                      style={{ background: '#3b1c1c', borderColor: '#802f2f', color: '#ffb3b3' }}
                      onClick={() => job.id && handleDeleteJob(job.id, job.name)}
                      title="Hapus jadwal ini"
                    >
                      ✕ Hapus
                    </button>
                  </div>
                </article>
              )
            })}
          </section>
        )
      )}

      {showCreateModal && (
        <Dialog
          labelledBy="modal-title"
          closeLabel="Tutup dialog jadwal"
          onClose={() => setShowCreateModal(false)}
        >
          <div style={{ maxWidth: 520, margin: '0 auto' }}>
            <p className="eyebrow">CLAUDE CRON · JADWAL BARU</p>
            <h2 id="modal-title" style={{ marginTop: 2, marginBottom: 14 }}>
              Buat Jadwal Tugas Agen Claude
            </h2>
            <form onSubmit={handleCreateSubmit} style={{ display: 'grid', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Nama Jadwal / Tugas:
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Riset Tren AI & Industri Pagi"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                    Pilih Agen Claude:
                  </label>
                  <select
                    value={agent}
                    onChange={(e) => setAgent(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                  >
                    {crew.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                    Frekuensi Eksekusi:
                  </label>
                  <select
                    value={preset}
                    onChange={(e) => setPreset(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                  >
                    {PRESET_SCHEDULES.map((p) => (
                      <option key={p.cron} value={p.cron}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {preset === 'custom' && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                    Custom Cron Expression (5 fields):
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: */30 * * * *"
                    value={customCron}
                    onChange={(e) => setCustomCron(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontFamily: 'ui-monospace, monospace' }}
                  />
                  <small style={{ color: 'var(--text-dim)', fontSize: 11 }}>Format: menit (0-59) jam (0-23) hari (1-31) bulan (1-12) hari-dalam-minggu (0-6)</small>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Deskripsi Jadwal:
                </label>
                <input
                  type="text"
                  placeholder="Ringkasan tujuan tugas otomatis ini"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600, color: 'var(--text-muted)' }}>
                  Instruksi / Prompt untuk Agen Claude:
                </label>
                <textarea
                  rows={3}
                  placeholder="Perintah yang akan dieksekusi oleh agen Claude saat jadwal tiba..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
                <button
                  type="button"
                  className="refresh-button"
                  onClick={() => setShowCreateModal(false)}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || !name.trim()}
                  className="refresh-button"
                  style={{ background: '#254a37', borderColor: '#48bb78', color: '#dcfce7', fontWeight: 600 }}
                >
                  {submitting ? 'Menyimpan...' : 'Simpan Jadwal'}
                </button>
              </div>
            </form>
          </div>
        </Dialog>
      )}
    </>
  )
}
