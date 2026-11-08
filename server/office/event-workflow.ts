import { transaction } from '../db/index.js'
import type { DriveAdapter } from '../integrations/index.js'
import type { OfficeBus } from './bus.js'
import { audit, type OfficeStore, type Task } from './store.js'

// The event workflow owned by the Event Specialist (FR-50, docs/PLAN.md 5.6). An event is one row
// in `events`; each stage is a task whose approved result feeds the later stages. Staff start each
// stage themselves, because several need input only people have (template, speaker answers).

export interface EventStage {
  id: string
  label: string
  agentType: string
  kind: string
  complex: boolean
  /** Stages whose approved results this one builds on. */
  requires: string[]
  /** The level that delivers it; later stages are listed but cannot start yet. */
  level: 'L1' | 'L2' | 'L3'
  instructions: string
}

export const EVENT_STAGES: EventStage[] = [
  {
    id: 'tema', label: 'Tema & angle', agentType: 'event-specialist', kind: 'event.tema', complex: true, requires: [], level: 'L1',
    instructions: `Kerjakan fungsi 01 Event Research & Theme.
1. Profil masalah audiens: 5–7 masalah/pertanyaan utama orang tua dan pelajar yang relevan dengan brief (dari insight SPS Parents Talk bila ada di brief; jangan mengarang data).
2. Tiga alternatif tema besar, masing-masing dengan objective, target peserta, dan key discussion points.
3. Untuk setiap tema, alternatif angle yang benar-benar berbeda.
4. Rekomendasi satu tema beserta alasannya.`,
  },
  {
    id: 'konsep_ads', label: 'Konsep 3 image ads', agentType: 'event-specialist', kind: 'event.konsep_ads', complex: true, requires: ['tema'], level: 'L1',
    instructions: `Kerjakan fungsi 02 Creative & Image Ads untuk tema yang sudah disetujui.
Buat tiga konsep image ads dengan angle yang BENAR-BENAR berbeda (bukan sekadar ganti headline). Untuk setiap konsep: angle, headline, subheadline, ads copy (primary text), info event (tanggal, harga, narasumber, topik, benefit, CTA), dan arahan visual sesuai /brand/visual.json.
Tutup dengan brief produksi untuk content-creator (format content_brief).`,
  },
  {
    id: 'produksi_ads', label: 'Produksi 3 image ads', agentType: 'content-creator', kind: 'konten.image_ads_event', complex: false, requires: ['konsep_ads'], level: 'L2',
    instructions: 'Produksi tiga image ads dari konsep yang disetujui.',
  },
  {
    id: 'tor_skb', label: 'TOR & SKB', agentType: 'event-specialist', kind: 'event.tor_skb', complex: false, requires: ['tema'], level: 'L1',
    instructions: `Kerjakan fungsi 03: isi TOR dan SKB untuk event ini.
Jika template resmi disertakan di bawah, isi PERSIS mengikuti struktur dan urutan bagiannya, tanpa menambah atau menghapus bagian. Jangan mengasumsikan kepanjangan SKB.
Jika template resmi belum tersedia, susun draf isi per bagian yang lazim dan beri tanda [KONFIRMASI: template resmi] di judul dokumen.`,
  },
  {
    id: 'pertanyaan', label: '10 pertanyaan narasumber', agentType: 'event-specialist', kind: 'event.pertanyaan', complex: false, requires: ['tema'], level: 'L1',
    instructions: `Kerjakan fungsi 03 bagian narasumber: profil singkat kebutuhan narasumber dan 10 pertanyaan panduan.
Tulis ke-10 pertanyaan sebagai daftar bernomor 1–10, satu pertanyaan per baris, tanpa sub-butir, karena daftar ini dipakai untuk melacak jawaban narasumber.`,
  },
  {
    id: 'landing_page', label: 'Landing page + QA Scalev', agentType: 'event-specialist', kind: 'event.landing_page', complex: false, requires: ['konsep_ads'], level: 'L3',
    instructions: 'Susun landing page event dari template OTCA dan QA integrasi Scalev.',
  },
  {
    id: 'campaign_brief', label: 'Campaign brief', agentType: 'event-specialist', kind: 'event.campaign_brief', complex: false, requires: ['konsep_ads'], level: 'L1',
    instructions: `Kerjakan fungsi 05 Advertising: susun campaign brief untuk digital-marketing (format campaign_brief: objective, kpi, audiens, budget_usulan, aset, destination, jadwal) dari tiga konsep image ads yang disetujui.
Budget hanya usulan; aktivasi dan budget diputuskan pemegang otorisasi budget.`,
  },
  {
    id: 'ppt', label: 'PPT narasumber', agentType: 'event-specialist', kind: 'event.ppt', complex: true, requires: ['pertanyaan'], level: 'L1',
    instructions: `Kerjakan fungsi 06 PPT: ubah jawaban narasumber menjadi alur presentasi, slide demi slide (judul slide, poin isi, catatan pembicara), sesuai brand OTCA.
Jangan mengubah maksud narasumber; kutip jawabannya bila perlu. Pertanyaan yang belum dijawab ditandai [KONFIRMASI].`,
  },
]

export const stageById = (id: string) => EVENT_STAGES.find((stage) => stage.id === id)

export interface EventDetails { tanggal?: string; harga?: string; narasumber?: string; target?: string; objective?: string; benefit?: string; lokasi?: string }

export interface EventRecord { id: string; brandId: string; title: string; brief: string; details: EventDetails; createdBy: string; createdAt: string; updatedAt: string }

export interface SpeakerQuestion { id: string; position: number; speaker: string; question: string; answer: string | null; status: 'belum_dikirim' | 'terkirim' | 'dijawab' }

export interface StageView { id: string; label: string; level: string; available: boolean; ready: boolean; missing: string[]; task: Task | null }

const DETAIL_LABELS: Record<keyof EventDetails, string> = {
  tanggal: 'Tanggal', harga: 'Harga', narasumber: 'Narasumber', target: 'Target peserta', objective: 'Objective', benefit: 'Benefit', lokasi: 'Lokasi / platform',
}

/** The latest task per stage (a stage can be started again after cancelling). */
function latestByStage(tasks: Task[]): Map<string, Task> {
  const latest = new Map<string, Task>()
  for (const task of [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const stage = EVENT_STAGES.find((item) => item.kind === task.kind)
    if (stage && task.status !== 'cancelled') latest.set(stage.id, task)
  }
  return latest
}

const approvedStatuses = new Set(['approved', 'done'])

export function stageViews(tasks: Task[]): StageView[] {
  const latest = latestByStage(tasks)
  return EVENT_STAGES.map((stage) => {
    const missing = stage.requires.filter((id) => !approvedStatuses.has(latest.get(id)?.status ?? ''))
    return { id: stage.id, label: stage.label, level: stage.level, available: stage.level === 'L1', ready: missing.length === 0, missing, task: latest.get(stage.id) ?? null }
  })
}

/** Parses the numbered list (1–10) the questions stage is asked to write. */
export function parseQuestions(text: string): string[] {
  return text.split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:\*\*)?(\d{1,2})[.)]\s*(?:\*\*)?\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 10)
    .map((match) => match[2].replace(/\*\*/g, '').trim())
    .filter(Boolean)
    .slice(0, 10)
}

/** The brief of a stage task: the event, the approved results it builds on, its instructions. */
export function stageBrief(stage: EventStage, event: EventRecord, approved: Map<string, Task>, extras: { template?: { name: string; content: string }; answers?: SpeakerQuestion[] }): string {
  const details = Object.entries(event.details)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([key, value]) => `- ${DETAIL_LABELS[key as keyof EventDetails] ?? key}: ${value}`)
  const parts = [
    `## Event: ${event.title}`,
    event.brief.trim() && `### Brief dari staf\n${event.brief.trim()}`,
    details.length ? `### Data event (hanya pakai data ini; selebihnya [KONFIRMASI])\n${details.join('\n')}` : '### Data event\nBelum ada tanggal, harga, atau narasumber yang dikonfirmasi; tandai [KONFIRMASI].',
    ...stage.requires.map((id) => `### Hasil tahap "${stageById(id)?.label}" yang sudah disetujui\n${approved.get(id)?.result ?? ''}`),
  ]
  if (stage.id === 'tor_skb') {
    parts.push(extras.template ? `### Template resmi: ${extras.template.name}\n${extras.template.content}` : '### Template resmi\nBelum tersedia (Google Drive belum tersambung).')
  }
  if (stage.id === 'ppt' && extras.answers) {
    parts.push(`### Jawaban narasumber\n${extras.answers.map((item) => `${item.position}. ${item.question}\n   Jawaban${item.speaker ? ` (${item.speaker})` : ''}: ${item.answer?.trim() || '[belum dijawab]'}`).join('\n')}`)
  }
  parts.push(`### Yang harus dikerjakan\n${stage.instructions}`)
  return parts.filter(Boolean).join('\n\n')
}

const toEvent = (row: Record<string, unknown>): EventRecord => ({
  id: row.id as string, brandId: row.brand_id as string, title: row.title as string, brief: row.brief as string,
  details: row.details as EventDetails, createdBy: row.created_by as string,
  createdAt: (row.created_at as Date).toISOString(), updatedAt: (row.updated_at as Date).toISOString(),
})

const toQuestion = (row: Record<string, unknown>): SpeakerQuestion => ({
  id: row.id as string, position: row.position as number, speaker: row.speaker as string,
  question: row.question as string, answer: row.answer as string | null, status: row.status as SpeakerQuestion['status'],
})

export class EventWorkflow {
  constructor(private readonly store: OfficeStore, private readonly bus: OfficeBus, private readonly drive: DriveAdapter) {}

  async create(brandId: string, input: { title: string; brief?: string; details?: EventDetails; createdBy: string }): Promise<EventRecord> {
    if (!input.title.trim()) throw new Error('Nama event wajib diisi.')
    const { rows } = await this.store.db.query(
      'INSERT INTO events (brand_id, title, brief, details, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [brandId, input.title.trim(), input.brief ?? '', JSON.stringify(input.details ?? {}), input.createdBy])
    const event = toEvent(rows[0])
    this.bus.publish({ type: 'event', brandId, eventId: event.id, stage: 'tema' })
    return event
  }

  async list(brandId: string): Promise<EventRecord[]> {
    return (await this.store.db.query('SELECT * FROM events WHERE brand_id = $1 ORDER BY created_at DESC', [brandId])).rows.map(toEvent)
  }

  async get(brandId: string, eventId: string): Promise<EventRecord | undefined> {
    const { rows } = await this.store.db.query('SELECT * FROM events WHERE brand_id = $1 AND id = $2', [brandId, eventId])
    return rows[0] ? toEvent(rows[0]) : undefined
  }

  async updateDetails(brandId: string, eventId: string, details: EventDetails, actor: string): Promise<EventRecord> {
    const { rows } = await this.store.db.query(
      'UPDATE events SET details = details || $3::jsonb, updated_at = now() WHERE brand_id = $1 AND id = $2 RETURNING *',
      [brandId, eventId, JSON.stringify(details)])
    if (!rows[0]) throw new Error('Event tidak ditemukan.')
    await audit(this.store.db, { actor, action: 'event.details', objectType: 'event', objectId: eventId, brandId, after: details })
    this.bus.publish({ type: 'event', brandId, eventId, stage: 'detail' })
    return toEvent(rows[0])
  }

  async questions(brandId: string, eventId: string): Promise<SpeakerQuestion[]> {
    return (await this.store.db.query('SELECT * FROM speaker_questions WHERE brand_id = $1 AND event_id = $2 ORDER BY position', [brandId, eventId])).rows.map(toQuestion)
  }

  async detail(brandId: string, eventId: string): Promise<{ event: EventRecord; stages: StageView[]; questions: SpeakerQuestion[] } | undefined> {
    const event = await this.get(brandId, eventId)
    if (!event) return undefined
    const tasks = await this.store.tasks(brandId, { eventId })
    return { event, stages: stageViews(tasks), questions: await this.questions(brandId, eventId) }
  }

  /** Creates the task of one stage, once the stages it builds on are approved. */
  async startStage(brandId: string, eventId: string, stageId: string, actor: string, options: { urgent?: boolean } = {}): Promise<Task> {
    const stage = stageById(stageId)
    if (!stage) throw new Error(`Tahap ${stageId} tidak dikenal.`)
    if (stage.level !== 'L1') throw new Error(`Tahap "${stage.label}" baru tersedia di ${stage.level}.`)
    const event = await this.get(brandId, eventId)
    if (!event) throw new Error('Event tidak ditemukan.')
    const tasks = await this.store.tasks(brandId, { eventId })
    const view = stageViews(tasks).find((item) => item.id === stageId)!
    if (view.task && !['failed', 'cancelled'].includes(view.task.status)) throw new Error(`Tahap "${stage.label}" sudah berjalan (status ${view.task.status}).`)
    if (!view.ready) throw new Error(`Tahap "${stage.label}" menunggu persetujuan: ${view.missing.map((id) => stageById(id)?.label).join(', ')}.`)
    const answers = stage.id === 'ppt' ? await this.questions(brandId, eventId) : undefined
    if (stage.id === 'ppt' && !answers?.some((item) => item.answer?.trim())) throw new Error('Isi dulu jawaban narasumber sebelum membuat PPT.')
    const template = stage.id === 'tor_skb' ? await this.drive.template(brandId, 'TOR & SKB') : undefined
    const approved = latestByStage(tasks)
    return this.store.createTask(brandId, {
      agentType: stage.agentType, kind: stage.kind, title: `${stage.label}: ${event.title}`,
      brief: stageBrief(stage, event, approved, { template, answers }), complex: stage.complex,
      urgent: options.urgent ?? false, eventId, createdBy: actor,
    })
  }

  /** After the questions stage is approved, its list becomes the answer tracker (L6-04). */
  async onApproved(task: Task): Promise<void> {
    if (task.kind !== 'event.pertanyaan' || !task.eventId || !task.result) return
    const questions = parseQuestions(task.result)
    await transaction(this.store.db, async (tx) => {
      await tx.query('DELETE FROM speaker_questions WHERE brand_id = $1 AND event_id = $2 AND answer IS NULL', [task.brandId, task.eventId])
      for (const [index, question] of questions.entries()) {
        await tx.query('INSERT INTO speaker_questions (event_id, brand_id, position, question) VALUES ($1, $2, $3, $4)', [task.eventId, task.brandId, index + 1, question])
      }
    })
    this.bus.publish({ type: 'event', brandId: task.brandId, eventId: task.eventId, stage: 'pertanyaan' })
  }

  async answer(brandId: string, eventId: string, questionId: string, input: { answer?: string; speaker?: string; status?: SpeakerQuestion['status'] }): Promise<SpeakerQuestion> {
    const status = input.status ?? (input.answer?.trim() ? 'dijawab' : undefined)
    const { rows } = await this.store.db.query(
      `UPDATE speaker_questions SET answer = coalesce($4, answer), speaker = coalesce($5, speaker), status = coalesce($6, status), updated_at = now()
        WHERE brand_id = $1 AND event_id = $2 AND id = $3 RETURNING *`,
      [brandId, eventId, questionId, input.answer ?? null, input.speaker ?? null, status ?? null])
    if (!rows[0]) throw new Error('Pertanyaan tidak ditemukan.')
    this.bus.publish({ type: 'event', brandId, eventId, stage: 'pertanyaan' })
    return toQuestion(rows[0])
  }
}
