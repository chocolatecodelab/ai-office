import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatDateTime } from '../format.ts'
import {
  officeRequest, TASK_STATUS_LABELS, useOfficeLive,
  type EventDetail, type EventDetails, type EventStage, type OfficeEvent, type OfficeStatus, type SpeakerQuestion,
} from '../office-api.ts'
import { EmptyState, PageTitle } from '../ui.tsx'

// The Event Specialist's workflow (FR-50): staff create an event, start each stage when the stages
// it builds on are approved, and fill in the speakers' answers that the PPT stage turns into slides.

const BRAND = 'otca' // the Event Specialist works for Official OTCA only; sister brands send briefs

const DETAIL_FIELDS: Array<[keyof EventDetails, string, string]> = [
  ['tanggal', 'Tanggal', 'Sabtu, 12 Desember 2026, 19.00 WIB'],
  ['lokasi', 'Lokasi / platform', 'Zoom'],
  ['harga', 'Harga', 'Gratis / Rp…'],
  ['narasumber', 'Narasumber', 'Nama dan peran'],
  ['target', 'Target peserta', 'Orang tua siswa SMA'],
  ['objective', 'Objective', 'Pendaftaran konsultasi'],
  ['benefit', 'Benefit', 'E-book, sesi tanya jawab'],
]

function StatusBadge({ stage }: { stage: EventStage }) {
  if (stage.task) return <span className={`badge office-status st-${stage.task.status}`}>{TASK_STATUS_LABELS[stage.task.status]}</span>
  if (!stage.available) return <span className="badge muted">Tersedia di {stage.level}</span>
  return <span className={`badge ${stage.ready ? 'good' : 'muted'}`}>{stage.ready ? 'Siap dimulai' : 'Menunggu tahap lain'}</span>
}

function StageRow({ stage, stages, onStart }: { stage: EventStage; stages: EventStage[]; onStart: (stage: EventStage) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const task = stage.task
  const canStart = stage.available && stage.ready && (!task || task.status === 'failed' || task.status === 'cancelled')
  const missing = stage.missing.map((id) => stages.find((item) => item.id === id)?.label ?? id).join(', ')
  return <li className="stage-row">
    <div className="stage-head">
      <div>
        <strong>{stage.label}</strong>
        {!stage.ready && stage.available && <small> · perlu disetujui: {missing}</small>}
        {task?.status === 'waiting_quota' && task.retryAt && <small> · dicoba lagi {formatDateTime(task.retryAt)}</small>}
      </div>
      <div className="office-actions">
        <StatusBadge stage={stage}/>
        {canStart && <button type="button" className="primary-button" disabled={busy} onClick={async () => { setBusy(true); await onStart(stage); setBusy(false) }}>{task ? 'Jalankan ulang' : 'Mulai'}</button>}
        {task?.result && <button type="button" className="chip chip-button" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Tutup hasil' : 'Lihat hasil'}</button>}
      </div>
    </div>
    {task?.error && task.status !== 'waiting_approval' && <p className="text-bad stage-error">{task.error.slice(0, 300)}</p>}
    {open && task?.result && <div className="office-result">{task.result}</div>}
  </li>
}

function QuestionRow({ question, onSave }: { question: SpeakerQuestion; onSave: (question: SpeakerQuestion, answer: string, speaker: string) => Promise<void> }) {
  const [answer, setAnswer] = useState(question.answer ?? '')
  const [speaker, setSpeaker] = useState(question.speaker)
  const changed = answer !== (question.answer ?? '') || speaker !== question.speaker
  return <li className="question-row">
    <p><b>{question.position}.</b> {question.question} <span className={`badge ${question.status === 'dijawab' ? 'good' : 'muted'}`}>{question.status.replace('_', ' ')}</span></p>
    <div className="question-inputs">
      <input className="search-input" value={speaker} onChange={(event) => setSpeaker(event.target.value)} placeholder="Narasumber" aria-label={`Narasumber pertanyaan ${question.position}`}/>
      <textarea rows={2} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Jawaban narasumber" aria-label={`Jawaban pertanyaan ${question.position}`}/>
      <button type="button" className="chip chip-button" disabled={!changed} onClick={() => void onSave(question, answer, speaker)}>Simpan</button>
    </div>
  </li>
}

function NewEventForm({ onCreated }: { onCreated: (event: OfficeEvent) => void }) {
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [details, setDetails] = useState<EventDetails>({})
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      onCreated(await officeRequest<OfficeEvent>('POST', `/brands/${BRAND}/events`, { title, brief, details }))
      setTitle(''); setBrief(''); setDetails({}); setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }
  return <form className="card office-form" onSubmit={(event) => void submit(event)}>
    <h2>Event baru</h2>
    <label className="office-field"><span>Nama event</span><input className="search-input" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Parents Talk: Persiapan Kuliah di Jerman"/></label>
    <label className="office-field"><span>Brief (kebutuhan, insight Parents Talk, catatan)</span><textarea rows={4} value={brief} onChange={(event) => setBrief(event.target.value)}/></label>
    <p className="muted">Isi hanya data yang sudah pasti. Yang kosong akan ditandai [KONFIRMASI] oleh agen.</p>
    <div className="office-detail-fields">
      {DETAIL_FIELDS.map(([key, label, placeholder]) => <label key={key} className="office-field"><span>{label}</span>
        <input className="search-input" value={details[key] ?? ''} placeholder={placeholder} onChange={(event) => setDetails({ ...details, [key]: event.target.value })}/></label>)}
    </div>
    {error && <p className="text-bad" role="alert">{error}</p>}
    <button type="submit" className="primary-button">Buat event</button>
  </form>
}

export function Events() {
  const [events, setEvents] = useState<OfficeEvent[]>()
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<EventDetail>()
  const [status, setStatus] = useState<OfficeStatus>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const [list, office] = await Promise.all([officeRequest<OfficeEvent[]>('GET', `/brands/${BRAND}/events`), officeRequest<OfficeStatus>('GET', '/status')])
      setEvents(list)
      setStatus(office)
      const current = selected ?? list[0]?.id
      if (current !== selected) setSelected(current)
      setDetail(current ? await officeRequest<EventDetail>('GET', `/brands/${BRAND}/events/${current}`) : undefined)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [selected])

  useEffect(() => { void load() }, [load])
  useOfficeLive(BRAND, () => { void load() })

  const act = async (work: () => Promise<unknown>) => {
    try { await work(); await load() } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const mock = status?.integrations.filter((item) => item.mode === 'mock') ?? []

  return <>
    <PageTitle eyebrow="EVENT SPECIALIST · OFFICIAL OTCA" title="Workflow Event">Tema → konsep 3 image ads → TOR & SKB → pertanyaan narasumber → PPT. Setiap tahap masuk Approval sebelum tahap berikutnya bisa memakai hasilnya.</PageTitle>
    {error && <section className="notice" role="alert"><strong>Ada kendala.</strong> {error}</section>}
    {mock.length > 0 && <section className="notice"><strong>Mode mock:</strong> {mock.map((item) => item.label).join(', ')}. {mock.find((item) => item.service === 'drive')?.note}</section>}
    <div className="office-grid">
      <aside className="office-sidebar">
        <NewEventForm onCreated={(event) => { setSelected(event.id); void load() }}/>
        <div className="card">
          <h2>Daftar event</h2>
          {events?.length === 0 && <p className="muted">Belum ada event.</p>}
          <ul className="event-list">{events?.map((event) => <li key={event.id}>
            <button type="button" className={`chip chip-button${event.id === selected ? ' active' : ''}`} onClick={() => setSelected(event.id)}>{event.title}</button>
          </li>)}</ul>
        </div>
      </aside>
      <section>
        {!detail && <EmptyState title="Pilih atau buat event">Workflow tiap event tampil di sini.</EmptyState>}
        {detail && <>
          <article className="card">
            <p className="eyebrow">DIBUAT {formatDateTime(detail.event.createdAt)}</p>
            <h2>{detail.event.title}</h2>
            {detail.event.brief && <p className="muted">{detail.event.brief}</p>}
            <dl className="event-details">{DETAIL_FIELDS.filter(([key]) => detail.event.details[key]).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{detail.event.details[key]}</dd></div>)}</dl>
          </article>
          <article className="card">
            <h2>Tahap</h2>
            <ol className="stage-list">{detail.stages.map((stage) => <StageRow key={stage.id} stage={stage} stages={detail.stages}
              onStart={(item) => act(() => officeRequest('POST', `/brands/${BRAND}/events/${detail.event.id}/stages/${item.id}`, {}))}/>)}</ol>
          </article>
          <article className="card">
            <h2>Jawaban narasumber</h2>
            {detail.questions.length === 0 ? <p className="muted">Daftar 10 pertanyaan muncul di sini setelah tahap "10 pertanyaan narasumber" disetujui.</p>
              : <ol className="question-list">{detail.questions.map((question) => <QuestionRow key={question.id} question={question}
                onSave={(item, answer, speaker) => act(() => officeRequest('PATCH', `/brands/${BRAND}/events/${detail.event.id}/questions/${item.id}`, { answer, speaker }))}/>)}</ol>}
          </article>
        </>}
      </section>
    </div>
  </>
}
