import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import Anthropic from '@anthropic-ai/sdk'
import { agentContextFiles, contextPrompt, findContextDir } from './otca-context.js'
import type { OfficeSnapshot, OfficeStation, TaskBoardSnapshot, Task, RuntimeSnapshot, UsageSnapshot, DashboardSnapshot, CalendarSnapshot, ScheduledJob } from './mission-control.js'

export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] as const
const DEFAULT_MODEL = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const SONNET = 'claude-sonnet-5-5'
// Env names accepted for the API key, in priority order.
const API_KEY_ENV_NAMES = ['ANTHROPIC_API_KEY', 'API_KEY_ANTHROPIC_CLAUDE']

/** Maps older, invalid ids (such as `claude-5-5-sonnet-20261022`) saved by earlier versions to a real model id. */
export function normalizeModel(model: string | undefined): string {
  const value = (model || '').trim()
  if ((CLAUDE_MODELS as readonly string[]).includes(value)) return value
  if (/haiku/i.test(value)) return 'claude-haiku-5-5'
  if (/opus/i.test(value)) return 'claude-opus-5-5'
  return DEFAULT_MODEL
}

export interface AgentDefinition {
  id: string
  name: string
  role: string
  department: string
  model: string
  seat: number
  systemPrompt: string
  description: string
}

export const CEO_ID = 'ceo'

/** The orchestrator is always present and always built from this code, so prompt changes apply to saved offices. */
const CEO_AGENT: AgentDefinition = {
  id: CEO_ID,
  name: 'CEO (Claude Orchestrator)',
  role: 'Chief Executive Officer',
  department: 'Executive',
  model: SONNET,
  seat: 1,
  description: 'Menerima tugas dari user, memecahnya, dan mendelegasikan ke agen pemilik pekerjaan sesuai RACI OTCA.',
  systemPrompt: `Anda adalah CEO dan Orchestrator AI Office Marketing & Creative OTCA.
Peran utama Anda:
1. Menerima instruksi dan proyek dari Pengguna (Owner).
2. Memecah proyek menjadi subtugas yang jelas, masing-masing dengan output yang bisa dicek.
3. Mendelegasikan setiap subtugas ke SATU agen pemilik pekerjaan (lihat aturan routing). Agen lain cukup disebut sebagai pemberi input di deskripsi tugas.
4. Rapat ('call_team_meeting') hanya bila keputusan butuh lebih dari satu agen; tutup dengan ringkasan keputusan.
5. Jangan pernah mempublikasikan konten, menjalankan iklan, mengubah budget, atau mengirim pesan ke pihak luar tanpa persetujuan manusia (Mbak Nia / reviewer / pemegang budget).

Aturan routing (satu pekerjaan, satu pemilik):
- event-specialist: semua workflow event: tema, brief image ads event, TOR, SKB, koordinasi narasumber, landing page event, PPT event.
- content-creator: riset SPS Parents Talk & feedback sales, angle, copywriting, carousel, image single, caption, creative assets, script video.
- video-editor: perencanaan teknis dan editing video: reels, testimoni, video internal, video ads, cover/thumbnail.
- social-media-manager: content library, kalender, scheduling, publishing, balas & moderasi komentar, lead routing organik.
- digital-marketing: strategi pemasaran, Meta/Google Ads, ads copy, landing page produk/umum, CRO, leads, analytics berbayar.

Bersikap profesional, tegas, solutif, dan ramah dalam bahasa Indonesia.`,
}

// Rules every OTCA agent shares; kept short because it rides along on every call.
const OTCA_RULES = `
Aturan kerja OTCA:
- Kerjakan hanya pekerjaan yang Anda miliki. Pekerjaan agen lain: tulis kebutuhan Anda sebagai brief singkat untuk agen itu, jangan dikerjakan sendiri.
- Serahkan hasil dalam format brief/handoff yang ringkas (lihat docs/otca-agents.md), bukan percakapan panjang.
- Ikuti brand guidelines, style, rules, dan context OTCA. Jangan mengarang data, harga, jadwal, atau nama narasumber.
- Semua yang tampil ke publik, memakai uang, atau menghubungi pihak luar wajib diajukan dulu untuk approval manusia.
- Jawab dalam bahasa Indonesia, ringkas dan terstruktur.`

/**
 * The five OTCA Marketing & Creative agents (docs/otca-agents.md). Like the CEO they always come from
 * this code, so prompt and model changes reach saved offices.
 */
const OTCA_AGENTS: AgentDefinition[] = [
  {
    id: 'event-specialist',
    name: 'AI Event Specialist',
    role: 'Event Planning & Production',
    department: 'Marketing & Creative',
    model: SONNET,
    seat: 2,
    description: 'Pemilik workflow event: tema, brief image ads, TOR/SKB, narasumber, landing page event, dan PPT.',
    systemPrompt: `Anda adalah AI Event Specialist OTCA, pemilik workflow event dari kebutuhan sampai event siap berjalan.
Fungsi Anda:
1. Event Research & Theme: olah insight SPS Parents Talk dan diskusi narasumber menjadi profiling masalah audiens, tema besar, alternatif angle, objective, dan key discussion points.
2. Creative & Image Ads: tiga konsep image ads dengan angle yang BENAR-BENAR berbeda (bukan sekadar ganti headline), lengkap headline, subheadline, ads copy, dan info event (tanggal, harga, narasumber, topik, benefit, CTA). Produksi desain diserahkan ke content-creator lewat brief.
3. TOR, SKB & Speaker Coordination: isi template resmi OTCA (jangan mengasumsikan kepanjangan SKB atau mengubah strukturnya), susun 10 pertanyaan panduan narasumber, kumpulkan jawaban, dan follow-up.
4. Event Landing Page: pakai template LP OTCA dengan pesan yang konsisten dengan tiga image ads; integrasi Scalev & payment dikoordinasikan dengan IT; lakukan QA alur registrasi.
5. Event Advertising: buat campaign brief untuk digital-marketing. Setup, aktivasi, dan optimasi iklan milik digital-marketing.
6. Event PPT: ubah jawaban narasumber menjadi alur presentasi tanpa mengubah maksud narasumber.
Tema, creative, dokumen, landing page, dan payment flow wajib approval manusia sebelum dipakai.${OTCA_RULES}`
  },
  {
    id: 'content-creator',
    name: 'AI Content Creator',
    role: 'Content Research & Creative Production',
    department: 'Marketing & Creative',
    model: SONNET,
    seat: 3,
    description: 'Riset audiens, angle, copywriting, carousel, image single, caption, dan creative assets untuk Ads.',
    systemPrompt: `Anda adalah AI Content Creator OTCA. Anda menentukan BAGAIMANA pesan dikemas menjadi konten.
Fungsi Anda:
1. Content Research & Audience Insight: olah SPS Parents Talk, feedback sales, dan chat export menjadi pertanyaan dan masalah yang paling sering muncul.
2. Content Strategy: tentukan tema, kategori, angle, dan pesan utama.
3. Copywriting: headline, subheadline, isi, caption, dan CTA.
4. Carousel & Image Single: struktur dan isi setiap slide; olah Parents Talk, sertifikat, achievement, dan promo menjadi materi visual; desain lewat Canva atau AI image generation (Anda menulis brief/prompt visualnya).
5. Creative Ads: variasi materi kreatif untuk iklan sesuai brief dari digital-marketing atau event-specialist.
6. Script video: ide, konsep, script, dan pesan. Eksekusi teknis video milik video-editor.
7. Testimoni eksternal: pilih 3–4 kandidat dari CRM dan buat flyer undangan; komunikasi WhatsApp dijalankan social-media-manager.
8. Quality Control sesuai brand guidelines, style, rules, context, dan taste OTCA.${OTCA_RULES}`
  },
  {
    id: 'video-editor',
    name: 'AI Video Editor',
    role: 'Video Production & Editing',
    department: 'Marketing & Creative',
    model: SONNET,
    seat: 4,
    description: 'Planning dan editing video: reels, edukasi, video internal, testimoni, video ads, dan cover.',
    systemPrompt: `Anda adalah AI Video Editor OTCA. Anda bertanggung jawab atas eksekusi teknis dan kualitas video; ide dan pesan datang dari content-creator.
Fungsi Anda:
1. Video Research: identifikasi materi dari laporan belajar, talent, dan testimoni.
2. Video Planning: konsep teknis, storyboard, dan shot list dari script yang diterima.
3. Editing plan untuk video internal (Mbak Nia, Mbak Nina, talent), video edukasi, dan testimoni siswa/orang tua: cutting, transisi, subtitle, audio, background, motion graphics.
4. Video cover/thumbnail dan versi video untuk Ads.
5. Quality Control: visual, audio, subtitle, dan durasi.
Render dilakukan oleh pipeline (Remotion/FFmpeg di workspace video-system); Anda menghasilkan edit plan yang bisa langsung dieksekusi, bukan deskripsi umum.
Video internal maupun eksternal wajib approval sebelum dipublikasikan atau dipakai untuk Ads.${OTCA_RULES}`
  },
  {
    id: 'social-media-manager',
    name: 'AI Social Media Manager',
    role: 'Social Media Operations & Community',
    department: 'Marketing & Creative',
    model: HAIKU,
    seat: 5,
    description: 'Content library, kalender, scheduling, publishing, balas & moderasi komentar, lead routing.',
    systemPrompt: `Anda adalah AI Social Media Manager OTCA. Anda mengelola distribusi organik dan interaksi media sosial.
Fungsi Anda:
1. Content Library & Classification: organisasi file dari Google Drive per brand, platform, format, dan kategori.
2. Content Calendar & Scheduling: kalender publikasi dan jadwal Meta Business Suite.
3. Publishing & Platform Adaptation: Feed, Reels, Stories, dan Facebook.
4. Community Management: klasifikasi komentar, balas berdasarkan knowledge base, sembunyikan spam/pelanggaran.
5. Lead Routing: arahkan audiens ke landing page, WhatsApp, atau sales.
6. Komunikasi & izin kandidat testimoni lewat WhatsApp, catat respons dan persetujuan.
7. Reporting: publikasi, komentar, interaksi, dan status operasional.
Siapkan semuanya sebagai draft. Publikasi, balasan di luar FAQ knowledge base, moderasi, dan pesan WhatsApp ke pihak luar menunggu approval sesuai SOP.${OTCA_RULES}`
  },
  {
    id: 'digital-marketing',
    name: 'AI Digital Marketing Specialist',
    role: 'Campaign & Business Growth',
    department: 'Marketing & Creative',
    model: SONNET,
    seat: 6,
    description: 'Strategi pemasaran, Meta/Google Ads, ads copy, landing page, CRO, leads, dan analytics berbayar.',
    systemPrompt: `Anda adalah AI Digital Marketing Specialist OTCA. Anda menentukan bagaimana konten dipakai untuk mencapai tujuan pemasaran dan konversi.
Fungsi Anda:
1. Market Research & Strategy: pasar, kompetitor, target audiens, positioning, campaign, dan KPI.
2. Campaign Planning berdasarkan event dan produk; terima campaign brief dari event-specialist untuk event.
3. Meta Ads & Google Ads: objective, audience, placement, struktur campaign, setup, dan optimasi.
4. Ads Copywriting: primary text, headline, description, CTA.
5. Creative Direction: pilih konten problem solving atau proof/achievement yang layak jadi Ads; minta produksi ke content-creator atau video-editor lewat brief.
6. Landing Page produk/umum dan CRO untuk semua landing page (termasuk LP event milik event-specialist).
7. Lead Generation, Conversion Optimization, dan Performance Analytics (CTR, CPC, CPM, CPL, conversion rate, ROAS bila datanya ada).
Aktivasi iklan dan perubahan budget hanya setelah otorisasi pemegang budget.${OTCA_RULES}`
  }
]

// The office runs Official OTCA's crew; the CEO doubles as its Manager (context/agents/manager.md).
const CONTEXT_BRAND = 'otca'

/** Builds the CEO and OTCA agent prompts from context/; without the package the prompts above stay as they are. */
function applyOtcaContext(): void {
  const dir = findContextDir()
  if (!dir) {
    console.warn('context/ tidak ditemukan; agen OTCA memakai prompt bawaan. Set RUANG_CONTEXT_DIR bila folder ada di tempat lain.')
    return
  }
  const managerFiles = agentContextFiles(dir, 'manager', CONTEXT_BRAND)
  if (managerFiles) {
    CEO_AGENT.systemPrompt += `\n\nDi brand Official OTCA Anda juga menjalankan peran Manager (/context/agents/manager.md); routing mengikuti /context/_shared/raci.md.\n\n${contextPrompt(managerFiles)}`
  }
  for (const agent of OTCA_AGENTS) {
    const files = agentContextFiles(dir, agent.id, CONTEXT_BRAND)
    if (!files) continue
    agent.systemPrompt = `Anda adalah ${agent.name} untuk brand Official OTCA (${agent.role}). Tujuan, tanggung jawab, tool yang boleh dan tidak boleh, approval, dan KPI Anda ditetapkan di /context/agents/${agent.id}.md.${OTCA_RULES}\n\n${contextPrompt(files)}`
  }
}
applyOtcaContext()

// Agents of the earlier built-in crew and the OTCA agent that took over their work.
const LEGACY_AGENT_IDS: Record<string, string> = { creator: 'video-editor', marketing: 'digital-marketing', researcher: 'content-creator' }
// Notes the earlier crew started with, so moving their memory keeps only what the user wrote.
const LEGACY_DEFAULT_NOTES = new Set([
  'Workspace aktif: d:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR',
  'Pipeline: video-system (tokens, scripts, remotion compositions)',
  'Gunakan B-roll 60fps untuk transisi slow motion',
  'Workspace aktif: d:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE',
  'Orkestrasi tim: Marketing, Researcher, Creator',
  'Optimalkan pesan penawaran utama (USP)',
  'KPI: CTR (Click-Through Rate) dan Conversion Rate',
  'Fokus riset: Perkembangan AI, model bahasa, dan otomasi alur kerja'
])

// The crew always comes from code; nothing about the agents themselves is stored.
export const CLAUDE_AGENTS: AgentDefinition[] = [CEO_AGENT, ...OTCA_AGENTS]

/** Arguments the CEO passes to the team tools (delegate_task, call_team_meeting, ...). */
interface DelegateArgs {
  target_agent?: string
  task_title?: string
  task_description?: string
  priority?: number
  agenda?: string
  summary?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: Array<{ name: string; args: Record<string, unknown>; result?: unknown }>
}

export interface ClaudeConfig {
  apiKey: string
  defaultModel: string
}

export interface AgentMemoryData {
  workspacePath: string
  claudeRules: string
  notes: string[]
  contextFiles: Array<{ name: string; path: string; size: number; content: string }>
}

export interface StoredTask {
  id: string
  title: string
  description: string
  status: 'todo' | 'running' | 'review' | 'done'
  assignee: string
  priority: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  /** The agent's reply from the last run. */
  result?: string
  lastError?: string
}

export interface ClaudeScheduledJob {
  id: string
  name: string
  agent: string
  schedule: string
  description: string
  prompt?: string
  status: 'active' | 'paused'
  nextRun?: string
  lastRun?: string
  lastRunOk?: boolean
  repeat?: string
  createdAt: string
  updatedAt: string
}

export function computeNextCronRun(schedule: string, fromDate = new Date()): string {
  const sched = schedule.trim().toLowerCase()
  const d = new Date(fromDate)

  const intervalMatch = sched.match(/^every\s+(\d+)\s*([mhd])/i)
  if (intervalMatch) {
    const val = parseInt(intervalMatch[1], 10)
    const unit = intervalMatch[2]
    if (unit === 'm') d.setMinutes(d.getMinutes() + val)
    else if (unit === 'h') d.setHours(d.getHours() + val)
    else if (unit === 'd') d.setDate(d.getDate() + val)
    return d.toISOString()
  }

  const parts = sched.split(/\s+/)
  if (parts.length === 5) {
    const targetMin = parts[0] === '*' ? 0 : parseInt(parts[0], 10)
    const targetHour = parts[1] === '*' ? 9 : parseInt(parts[1], 10)
    const targetWeekdayStr = parts[4]

    for (let i = 0; i < 14; i++) {
      const candidate = new Date(fromDate)
      candidate.setDate(candidate.getDate() + i)
      candidate.setHours(targetHour, targetMin, 0, 0)

      if (candidate.getTime() <= fromDate.getTime()) continue

      const dayOfWeek = candidate.getDay()
      let matchWeekday = true
      if (targetWeekdayStr !== '*') {
        if (targetWeekdayStr.includes('-')) {
          const [start, end] = targetWeekdayStr.split('-').map(Number)
          matchWeekday = dayOfWeek >= start && dayOfWeek <= end
        } else if (targetWeekdayStr.includes(',')) {
          const days = targetWeekdayStr.split(',').map(Number)
          matchWeekday = days.includes(dayOfWeek)
        } else {
          matchWeekday = dayOfWeek === Number(targetWeekdayStr)
        }
      }
      if (matchWeekday) {
        return candidate.toISOString()
      }
    }
  }

  const tomorrow = new Date(fromDate)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  return tomorrow.toISOString()
}

class ClaudeOfficeService {
  private config: ClaudeConfig = {
    apiKey: API_KEY_ENV_NAMES.map((name) => process.env[name]?.trim()).find(Boolean) || '',
    defaultModel: DEFAULT_MODEL
  }
  private anthropicClient: Anthropic | null = null
  private chatHistories: Map<string, ChatMessage[]> = new Map()
  private agentMemories: Map<string, AgentMemoryData> = new Map()
  private agentStates: Map<string, {
    state: 'Idle' | 'Working' | 'Reviewing' | 'Collaborating'
    activity: string
    currentTask: string
    room: 'Workspace' | 'Lounge'
    roomPosition: string
    lastActive: string
  }> = new Map()
  private tasks: StoredTask[] = []
  private scheduledJobs: ClaudeScheduledJob[] = []
  private isMeetingActive = false
  private meetingAgenda = ''
  private totalUsage = {
    inputTokens: 0,
    outputTokens: 0,
    calls: 0
  }
  private storageDir: string
  private storageFile: string

  constructor() {
    this.storageDir = join(homedir(), '.config', 'ruang')
    this.storageFile = join(this.storageDir, 'claude-office-data.json')
    this.loadEnv()
    this.loadStorage()
    this.initAgents()
    this.initClient()
  }

  private loadEnv() {
    try {
      const envPath = join(process.cwd(), '.env')
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf8')
        const values = new Map<string, string>()
        for (const line of content.split('\n')) {
          const match = line.trim().match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
          if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, '').trim())
        }
        const key = API_KEY_ENV_NAMES.map((name) => values.get(name)).find(Boolean)
        if (key && !this.config.apiKey) this.config.apiKey = key
      }
    } catch {
      // ignore
    }
  }

  private loadStorage() {
    try {
      if (existsSync(this.storageFile)) {
        const data = JSON.parse(readFileSync(this.storageFile, 'utf8'))
        if (data.config?.apiKey) this.config.apiKey = data.config.apiKey
        if (data.config?.defaultModel) this.config.defaultModel = normalizeModel(data.config.defaultModel)
        if (Array.isArray(data.tasks)) this.tasks = data.tasks
        if (Array.isArray(data.scheduledJobs)) this.scheduledJobs = data.scheduledJobs
        if (data.chatHistories && typeof data.chatHistories === 'object') {
          for (const [k, v] of Object.entries(data.chatHistories)) {
            this.chatHistories.set(k, v as ChatMessage[])
          }
        }
        if (data.agentMemories && typeof data.agentMemories === 'object') {
          for (const [k, v] of Object.entries(data.agentMemories)) {
            this.agentMemories.set(k, v as AgentMemoryData)
          }
        }
        if (data.totalUsage) this.totalUsage = data.totalUsage
        const legacy = this.migrateLegacyCrew()
        const crew = new Set(CLAUDE_AGENTS.map((agent) => agent.id))
        // Dropping retired agents deletes their chats and memory, so the file as it was is kept first.
        if ([...this.chatHistories.keys(), ...this.agentMemories.keys()].some((id) => !crew.has(id))) {
          copyFileSync(this.storageFile, `${this.storageFile}.sebelum-hapus-project.bak`)
        }
        if (this.dropRetiredAgents() || legacy) this.saveStorage()
      }
    } catch {
      // fresh setup
    }
  }

  /**
   * Agents registered from claude.ai Projects are gone: their tasks and schedules move to the CEO,
   * and their chats and memory are dropped. Returns whether anything changed.
   */
  private dropRetiredAgents(): boolean {
    const crew = new Set(CLAUDE_AGENTS.map((agent) => agent.id))
    let changed = false
    for (const task of this.tasks) {
      if (!crew.has(task.assignee)) { task.assignee = CEO_ID; changed = true }
    }
    for (const job of this.scheduledJobs) {
      if (!crew.has(job.agent)) { job.agent = CEO_ID; changed = true }
    }
    for (const store of [this.chatHistories, this.agentMemories]) {
      for (const id of [...store.keys()]) {
        if (!crew.has(id)) { store.delete(id); changed = true }
      }
    }
    return changed
  }

  /**
   * Hands the work of the earlier crew (marketing, researcher, creator) to the OTCA agent that owns it
   * now: tasks, schedules and chats move over, and notes or context files the user added are kept.
   * Returns whether anything changed.
   */
  private migrateLegacyCrew(): boolean {
    let changed = false
    for (const item of this.tasks) {
      const target = LEGACY_AGENT_IDS[item.assignee]
      if (target) { item.assignee = target; changed = true }
    }
    for (const job of this.scheduledJobs) {
      const target = LEGACY_AGENT_IDS[job.agent]
      if (target) { job.agent = target; changed = true }
    }
    for (const [legacy, target] of Object.entries(LEGACY_AGENT_IDS)) {
      const history = this.chatHistories.get(legacy)
      if (history) {
        this.chatHistories.set(target, [...(this.chatHistories.get(target) ?? []), ...history])
        this.chatHistories.delete(legacy)
        changed = true
      }
      const memory = this.agentMemories.get(legacy)
      if (memory) {
        const kept = this.getAgentMemory(target)
        kept.notes.push(...memory.notes.filter((note) => !LEGACY_DEFAULT_NOTES.has(note) && !kept.notes.includes(note)))
        kept.contextFiles.push(...memory.contextFiles.filter((file) => !kept.contextFiles.some((own) => own.path === file.path)))
        this.agentMemories.delete(legacy)
        changed = true
      }
    }
    // The CEO's stored rules still delegating to the old crew are replaced by the current ones.
    const ceo = this.agentMemories.get(CEO_ID)
    if (ceo?.claudeRules.includes('Delegasikan tugas visual dan editing ke Creator')) {
      const fresh = this.getDefaultMemoryForAgent(CEO_ID)
      ceo.claudeRules = fresh.claudeRules
      ceo.notes = [...fresh.notes, ...ceo.notes.filter((note) => !LEGACY_DEFAULT_NOTES.has(note))]
      changed = true
    }
    return changed
  }

  private saveStorage() {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true })
      }
      const data = {
        config: this.config,
        tasks: this.tasks,
        scheduledJobs: this.scheduledJobs,
        chatHistories: Object.fromEntries(this.chatHistories.entries()),
        agentMemories: Object.fromEntries(this.agentMemories.entries()),
        totalUsage: this.totalUsage
      }
      writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf8')
    } catch (err) {
      console.error('Failed to save claude-office-data:', err)
    }
  }

  private initAgentState(agentId: string) {
    if (!this.chatHistories.has(agentId)) {
      this.chatHistories.set(agentId, [])
    }
    // Ensure memory defaults are initialized
    this.getAgentMemory(agentId)
    this.agentStates.set(agentId, {
      state: 'Idle',
      activity: '',
      currentTask: '',
      room: 'Lounge',
      roomPosition: 'lounge-seat',
      lastActive: new Date().toISOString()
    })
  }

  private initAgents() {
    for (const agent of CLAUDE_AGENTS) this.initAgentState(agent.id)

    if (this.tasks.length === 0) {
      this.tasks = [
        {
          id: 'task-1',
          title: 'Peluncuran AI Office Claude',
          description: 'Koordinasi pembagian tugas tim untuk operasional AI Office',
          status: 'todo',
          assignee: 'ceo',
          priority: 3,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task-2',
          title: 'Insight Pertanyaan Parents Talk',
          description: 'Rangkum pertanyaan dan masalah yang paling sering muncul di SPS Parents Talk terbaru menjadi daftar angle konten.',
          status: 'todo',
          assignee: 'content-creator',
          priority: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task-3',
          title: 'Storyboard Reels Testimoni',
          description: 'Susun storyboard, shot list, dan edit plan Reels testimoni 30–60 detik dari script yang disetujui.',
          status: 'todo',
          assignee: 'video-editor',
          priority: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task-4',
          title: 'Kalender Konten Minggu Ini',
          description: 'Susun kalender publikasi Feed, Reels, dan Stories minggu ini dari konten yang sudah approved.',
          status: 'todo',
          assignee: 'social-media-manager',
          priority: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
      this.saveStorage()
    }

    if (this.scheduledJobs.length === 0) {
      this.scheduledJobs = [
        {
          id: 'cron-ceo-standup',
          name: 'Daily Morning Standup & Task Delegation',
          agent: 'ceo',
          schedule: '0 9 * * 1-5',
          description: 'Review progres tugas tim, koordinasi beban kerja Kanban, dan sinkronisasi prioritas harian.',
          prompt: 'Lakukan evaluasi standup pagi, cek status task board Kanban, dan berikan arahan prioritas kerja untuk tim hari ini.',
          status: 'active',
          nextRun: computeNextCronRun('0 9 * * 1-5'),
          repeat: 'Hari Kerja (Senin - Jumat) 09:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cron-smm-comments',
          name: 'Daily Comment Triage',
          agent: 'social-media-manager',
          schedule: '0 8 * * *',
          description: 'Klasifikasi komentar baru, draft balasan FAQ, tandai spam, dan catat lead untuk diteruskan.',
          prompt: 'Klasifikasikan komentar baru, siapkan draft balasan berdasarkan knowledge base, tandai spam, dan daftar lead yang perlu diteruskan. Semua masih draft untuk approval.',
          status: 'active',
          nextRun: computeNextCronRun('0 8 * * *'),
          repeat: 'Setiap Hari 08:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cron-dm-weekly',
          name: 'Weekly Campaign Performance Review',
          agent: 'digital-marketing',
          schedule: '0 10 * * 1',
          description: 'Evaluasi performa campaign mingguan (CTR, CPC, CPL, conversion) dan rekomendasi optimasi.',
          prompt: 'Evaluasi performa campaign minggu lalu berdasarkan data yang tersedia dan siapkan rekomendasi optimasi untuk approval.',
          status: 'active',
          nextRun: computeNextCronRun('0 10 * * 1'),
          repeat: 'Setiap Senin 10:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cron-cc-ideas',
          name: 'Content Ideas dari Parents Talk',
          agent: 'content-creator',
          schedule: '0 14 * * 2,4',
          description: 'Tiga ide konten (carousel/image/script) dari insight Parents Talk dan feedback sales terbaru.',
          prompt: 'Susun 3 ide konten dari insight Parents Talk dan feedback sales terbaru, masing-masing dengan angle, pesan utama, format, dan CTA.',
          status: 'active',
          nextRun: computeNextCronRun('0 14 * * 2,4'),
          repeat: 'Selasa & Kamis 14:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ]
      this.saveStorage()
    }
  }

  private initClient() {
    if (this.config.apiKey) {
      try {
        this.anthropicClient = new Anthropic({ apiKey: this.config.apiKey })
      } catch (err) {
        console.error('Failed to initialize Anthropic client:', err)
        this.anthropicClient = null
      }
    } else {
      this.anthropicClient = null
    }
  }

  public getConfig(): {
    hasKey: boolean
    defaultModel: string
    keyMasked: string
    claudeProConnected: boolean
    claudeProAccount?: string
  } {
    const key = this.config.apiKey || ''
    const keyMasked = key ? `${key.slice(0, 7)}...${key.slice(-4)}` : ''
    let claudeProConnected = false
    let claudeProAccount = ''
    try {
      const credPath = join(homedir(), '.claude', '.credentials.json')
      if (existsSync(credPath)) {
        const cred = JSON.parse(readFileSync(credPath, 'utf8'))
        if (cred.claudeAiOauth?.accessToken || cred.sessionKey || cred.oauthToken) {
          claudeProConnected = true
          claudeProAccount = cred.claudeAiOauth?.accountEmail || cred.email || 'Akun Claude Pro Aktif'
        }
      }
    } catch {
      // ignore
    }
    return {
      hasKey: Boolean(key),
      defaultModel: this.config.defaultModel,
      keyMasked,
      claudeProConnected,
      claudeProAccount
    }
  }

  public setConfig(newConfig: Partial<ClaudeConfig>): { success: boolean; message: string } {
    if (newConfig.apiKey !== undefined) {
      this.config.apiKey = newConfig.apiKey.trim()
    }
    if (newConfig.defaultModel) {
      this.config.defaultModel = normalizeModel(newConfig.defaultModel)
    }
    this.initClient()
    this.saveStorage()
    return { success: true, message: 'Konfigurasi Claude berhasil disimpan.' }
  }

  public getAgents(): AgentDefinition[] {
    return CLAUDE_AGENTS
  }

  public getHistory(agentId: string): ChatMessage[] {
    return this.chatHistories.get(agentId) || []
  }

  public clearHistory(agentId: string) {
    this.chatHistories.set(agentId, [])
    this.saveStorage()
  }

  public importHistory(
    agentId: string,
    importedMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }>
  ): { count: number; message: string } {
    const history = this.chatHistories.get(agentId) || []
    const newItems: ChatMessage[] = importedMessages.map((m, idx) => ({
      id: `imported-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
      timestamp: m.timestamp || new Date().toISOString()
    }))
    history.push(...newItems)
    this.chatHistories.set(agentId, history)

    // Update agent state with context from the latest imported message
    const last = newItems[newItems.length - 1]
    const state = this.agentStates.get(agentId)
    if (state && last) {
      state.lastActive = new Date().toISOString()
      state.currentTask = last.content.length > 50 ? `${last.content.slice(0, 47)}...` : last.content
    }

    this.saveStorage()
    return { count: newItems.length, message: `${newItems.length} pesan riwayat Claude berhasil diimpor.` }
  }

  public getDefaultMemoryForAgent(agentId: string): AgentMemoryData {
    const office = 'd:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE'
    const memory = (workspacePath: string, claudeRules: string, notes: string[]): AgentMemoryData =>
      ({ workspacePath, claudeRules, notes, contextFiles: [] })
    switch (agentId) {
      case CEO_ID:
        return memory(office, `# CEO Orchestration Guidelines
- Pecah permintaan menjadi subtugas dengan satu pemilik masing-masing (RACI di docs/otca-agents.md)
- Kirim brief ringkas ke agen, bukan seluruh percakapan
- Kumpulkan hasil untuk approval Mbak Nia / reviewer sebelum dipakai publik`, [
          `Workspace aktif: ${office}`,
          'Tim: Event Specialist, Content Creator, Video Editor, Social Media Manager, Digital Marketing'
        ])
      case 'event-specialist':
        return memory(office, `# Event Specialist Guidelines
- Alur: Requirement → Tema (approval) → paralel Creative / TOR+SKB / LP → approval → paralel Ads / PPT → Event Ready
- Tiga image ads = tiga angle berbeda, bukan tiga headline untuk masalah yang sama
- TOR, SKB, LP, dan campaign Meta Ads selalu memakai template resmi OTCA`, [
          'SKB: ikuti template resmi OTCA, jangan menebak kepanjangannya'
        ])
      case 'content-creator':
        return memory(office, `# Content Creator Guidelines
- Sumber: SPS Parents Talk, feedback sales & chat export, product knowledge, brand guidelines, event & promo
- Setiap konten: problem → angle → pesan utama → format → CTA
- Copywriting: AIDA atau PAS; bahasa yang dekat dengan parents dan students`, [
          'Pakai pustaka insight bersama; jangan mengolah ulang chat export mentah bila insight sudah ada'
        ])
      case 'video-editor':
        return memory('d:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR', `# Video Editor Guidelines
- Pipeline: Remotion & FFmpeg di video-system; keluarkan edit plan yang bisa langsung dieksekusi
- Format: 9:16 untuk Reels/Stories, 1:1 atau 4:5 untuk Feed, 16:9 bila diminta
- Hook 3 detik pertama, subtitle wajib, audio ducking saat voiceover
- QC: visual, audio, subtitle, dan durasi sebelum diajukan approval`, [
          'Workspace aktif: d:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR\\video-system'
        ])
      case 'social-media-manager':
        return memory(office, `# Social Media Manager Guidelines
- Platform: Instagram (Feed, Reels, Stories) dan Facebook lewat Meta Business Suite
- Balasan otomatis hanya untuk FAQ yang ada di knowledge base; sisanya draft untuk review
- Lead: arahkan ke landing page, WhatsApp, atau sales dan catat di laporan`, [])
      case 'digital-marketing':
        return memory(office, `# Digital Marketing Guidelines
- Setiap campaign: objective → audience → creative → destination → tracking → KPI
- KPI: CTR, CPC, CPM, CPL, conversion rate, ROAS (bila data tersedia)
- Aktivasi iklan dan perubahan budget hanya setelah otorisasi pemegang budget`, [])
      default:
        return memory(office, '', [])
    }
  }

  public getAgentMemory(agentId: string): AgentMemoryData {
    let mem = this.agentMemories.get(agentId)
    if (!mem) {
      mem = this.getDefaultMemoryForAgent(agentId)
      this.agentMemories.set(agentId, mem)
    }
    return mem
  }

  public getAgentWorkspace(agentId: string): string {
    const mem = this.getAgentMemory(agentId)
    return mem.workspacePath || this.getDefaultMemoryForAgent(agentId).workspacePath
  }

  public setAgentWorkspace(agentId: string, newPath: string): { success: boolean; path: string; files: string[]; error?: string } {
    const cleanPath = newPath.trim()
    if (!cleanPath) {
      return { success: false, path: '', files: [], error: 'Path direktori tidak boleh kosong.' }
    }
    if (!existsSync(cleanPath)) {
      return { success: false, path: cleanPath, files: [], error: `Direktori "${cleanPath}" tidak ditemukan di komputer ini.` }
    }

    const mem = this.getAgentMemory(agentId)
    mem.workspacePath = cleanPath

    // Auto-scan key context files from directory if exists
    let files: string[] = []
    try {
      files = readdirSync(cleanPath)
      for (const fname of ['CLAUDE.md', 'PRD.md', 'DESIGN.md', 'README.md']) {
        const full = join(cleanPath, fname)
        if (existsSync(full) && !mem.contextFiles.some(cf => cf.name === fname)) {
          try {
            const content = readFileSync(full, 'utf8')
            mem.contextFiles.push({
              name: fname,
              path: full,
              size: content.length,
              content: content.slice(0, 10000)
            })
          } catch { /* berkas yang tidak terbaca dilewati */ }
        }
      }
    } catch { /* folder konteks opsional */ }

    const state = this.agentStates.get(agentId)
    if (state) {
      state.currentTask = `Terkoneksi ke ${cleanPath}`
      state.lastActive = new Date().toISOString()
    }

    this.saveStorage()
    return { success: true, path: cleanPath, files: files.slice(0, 20) }
  }

  public updateAgentRules(agentId: string, rules: string): { success: boolean; message: string } {
    const mem = this.getAgentMemory(agentId)
    mem.claudeRules = rules
    this.saveStorage()
    return { success: true, message: 'Rules (CLAUDE.md) berhasil diperbarui.' }
  }

  public addAgentNote(agentId: string, note: string): { success: boolean; notes: string[] } {
    const clean = note.trim()
    if (!clean) return { success: false, notes: this.getAgentMemory(agentId).notes }
    const mem = this.getAgentMemory(agentId)
    mem.notes.push(clean)
    this.saveStorage()
    return { success: true, notes: mem.notes }
  }

  public removeAgentNote(agentId: string, index: number): { success: boolean; notes: string[] } {
    const mem = this.getAgentMemory(agentId)
    if (index >= 0 && index < mem.notes.length) {
      mem.notes.splice(index, 1)
      this.saveStorage()
    }
    return { success: true, notes: mem.notes }
  }

  public addContextFile(agentId: string, filePath: string, content?: string): { success: boolean; contextFiles: AgentMemoryData['contextFiles'] } {
    const mem = this.getAgentMemory(agentId)
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath
    let fileContent = content || ''
    if (!fileContent && existsSync(filePath)) {
      try {
        fileContent = readFileSync(filePath, 'utf8')
      } catch (err) {
        fileContent = `(Error reading file: ${err instanceof Error ? err.message : String(err)})`
      }
    }

    const existingIdx = mem.contextFiles.findIndex(cf => cf.path === filePath || cf.name === fileName)
    const doc = {
      name: fileName,
      path: filePath,
      size: fileContent.length,
      content: fileContent.slice(0, 15000)
    }

    if (existingIdx >= 0) {
      mem.contextFiles[existingIdx] = doc
    } else {
      mem.contextFiles.push(doc)
    }

    this.saveStorage()
    return { success: true, contextFiles: mem.contextFiles }
  }

  public removeContextFile(agentId: string, filePath: string): { success: boolean; contextFiles: AgentMemoryData['contextFiles'] } {
    const mem = this.getAgentMemory(agentId)
    mem.contextFiles = mem.contextFiles.filter(cf => cf.path !== filePath && cf.name !== filePath)
    this.saveStorage()
    return { success: true, contextFiles: mem.contextFiles }
  }

  public scanWorkspaceFiles(agentId: string): Array<{ name: string; path: string; isDir: boolean; size?: number }> {
    const workspace = this.getAgentWorkspace(agentId)
    if (!workspace || !existsSync(workspace)) return []
    try {
      const entries = readdirSync(workspace)
      return entries.slice(0, 50).map(name => {
        const full = join(workspace, name)
        let isDir = false
        let size = 0
        try {
          const st = statSync(full)
          isDir = st.isDirectory()
          size = st.size
        } catch { /* ukuran tidak diketahui; tampilkan tanpa ukuran */ }
        return { name, path: full, isDir, size }
      })
    } catch {
      return []
    }
  }

  public syncProject(agentId: string): { success: boolean; summary: string; contextAdded: boolean } {
    const mem = this.getAgentMemory(agentId)
    const projectPath = mem.workspacePath

    const state = this.agentStates.get(agentId)
    if (state) {
      state.state = 'Working'
      state.room = 'Workspace'
      state.roomPosition = 'assigned-desk'
      state.currentTask = `Terkoneksi ke ${projectPath}`
      state.lastActive = new Date().toISOString()
    }

    this.saveStorage()
    return {
      success: true,
      summary: `Workspace terhubung: ${projectPath}`,
      contextAdded: true
    }
  }

  public setMeeting(active: boolean, agenda = '') {
    this.isMeetingActive = active
    this.meetingAgenda = agenda
    for (const agent of CLAUDE_AGENTS) {
      const cur = this.agentStates.get(agent.id)
      if (cur) {
        if (active) {
          cur.state = 'Collaborating'
          cur.room = 'Workspace'
          cur.roomPosition = 'meeting-area'
          cur.activity = agenda ? `Rapat: ${agenda}` : 'Rapat tim di ruang meeting'
        } else {
          cur.state = 'Idle'
          cur.room = 'Lounge'
          cur.roomPosition = 'lounge-seat'
          cur.activity = ''
        }
      }
    }
  }

  /** The model an agent works with. */
  public modelFor(agent: AgentDefinition): string {
    return normalizeModel(agent.model || this.config.defaultModel)
  }

  public async sendMessage(
    agentId: string,
    userText: string,
    onChunk?: (text: string) => void
  ): Promise<{ response: string; toolResults?: unknown[] }> {
    const agent = CLAUDE_AGENTS.find((a) => a.id === agentId)
    if (!agent) throw new Error(`Agent ${agentId} tidak ditemukan.`)

    if (!this.anthropicClient) {
      return this.sendSimulatedMessage(agentId, userText, onChunk)
    }

    const state = this.agentStates.get(agentId)
    if (state) {
      state.state = 'Working'
      state.room = 'Workspace'
      state.roomPosition = 'assigned-desk'
      state.currentTask = userText.length > 50 ? `${userText.slice(0, 47)}...` : userText
      state.activity = 'Mengetik balasan...'
      state.lastActive = new Date().toISOString()
    }

    const history = this.chatHistories.get(agentId) || []
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toISOString()
    }
    history.push(userMsg)

    // Build context with current tasks & other agents
    const otherAgentsList = CLAUDE_AGENTS.map((a) => `- ${a.name} (id: ${a.id}): ${a.role} - ${a.description}`).join('\n')
    // Open work only, newest first and capped: finished tasks and long descriptions cost tokens on every call.
    const activeTasksList = this.tasks
      .filter((t) => t.status !== 'done')
      .slice(0, 20)
      .map((t) => `[${t.status.toUpperCase()}] ${t.title} (PIC: ${t.assignee})${t.description ? ` - ${t.description.slice(0, 160)}` : ''}`)
      .join('\n')

    const mem = this.getAgentMemory(agentId)
    let memoryPrompt = ''
    if (mem.claudeRules) {
      memoryPrompt += `\n\nATURAN & PEDOMAN KERJA (${mem.workspacePath}):\n${mem.claudeRules}`
    }
    if (mem.notes && mem.notes.length > 0) {
      memoryPrompt += `\n\nCATATAN MEMORI JANGKA PANJANG:\n${mem.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}`
    }
    if (mem.contextFiles && mem.contextFiles.length > 0) {
      memoryPrompt += `\n\nDOKUMEN KONTEKS WORKSPACE AKTIF:\n`
      for (const cf of mem.contextFiles) {
        memoryPrompt += `=== [File: ${cf.name}] ===\n${cf.content.slice(0, 3000)}\n\n`
      }
    }

    // The stable part (role, team, memory) comes first and is cached; the task board changes often, so it
    // follows the cache breakpoint and never invalidates it.
    const stableSystemPrompt = `${agent.systemPrompt}

Informasi Ruang Kantor & Tim Claude:
${otherAgentsList}${memoryPrompt}

Format balasan gunakan Markdown yang rapi dengan heading, bullet points, dan penekanan teks bila perlu.`
    const boardPrompt = `Daftar Tugas Tim di Task Board (Kanban):
${activeTasksList || 'Belum ada tugas tercatat.'}`

    // Prepare tools for CEO or agents
    const tools: Anthropic.Tool[] = []
    // With no other agents there is nobody to delegate to or meet with.
    if (agentId === CEO_ID && CLAUDE_AGENTS.length > 1) {
      tools.push(
        {
          name: 'delegate_task',
          description: 'Mendelegasikan tugas baru kepada salah satu anggota tim (lihat daftar tim) dan menambahkannya ke Kanban board.',
          input_schema: {
            type: 'object',
            properties: {
              target_agent: {
                type: 'string',
                enum: CLAUDE_AGENTS.filter((a) => a.id !== CEO_ID).map((a) => a.id),
                description: 'ID agen tujuan penerima tugas'
              },
              task_title: {
                type: 'string',
                description: 'Judul tugas yang jelas dan spesifik'
              },
              task_description: {
                type: 'string',
                description: 'Penjelasan detail tugas, ekspektasi hasil, dan instruksi kerja'
              },
              priority: {
                type: 'number',
                enum: [1, 2, 3],
                description: 'Tingkat prioritas (1: low, 2: normal, 3: high/urgent)'
              }
            },
            required: ['target_agent', 'task_title', 'task_description']
          }
        },
        {
          name: 'call_team_meeting',
          description: 'Memanggil seluruh tim ke ruang rapat di kantor untuk berkolaborasi dan mendiskusikan topik.',
          input_schema: {
            type: 'object',
            properties: {
              agenda: {
                type: 'string',
                description: 'Topik atau agenda rapat yang akan dibahas bersama tim'
              }
            },
            required: ['agenda']
          }
        },
        {
          name: 'end_team_meeting',
          description: 'Mengakhiri rapat tim dan mengembalikan semua agen ke aktivitas santai atau meja kerja masing-masing.',
          input_schema: {
            type: 'object',
            properties: {
              summary: {
                type: 'string',
                description: 'Rangkuman singkat hasil rapat'
              }
            }
          }
        }
      )
    }

    // Build messages list for Anthropic API
    const apiMessages: Anthropic.MessageParam[] = history
      .slice(-12) // Keep last 12 messages for conversation context
      .map((m) => ({
        role: m.role,
        content: m.content
      }))

    try {
      let assistantReply = ''
      const toolCallsExecuted: Array<{ name: string; args: Record<string, unknown>; result?: unknown }> = []

      // Call Anthropic API with streaming
      const stream = await this.anthropicClient.messages.create({
        model: this.modelFor(agent),
        max_tokens: 3000,
        system: [
          { type: 'text', text: stableSystemPrompt, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: boardPrompt }
        ],
        messages: apiMessages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true
      })

      let currentToolUse: { id?: string; name?: string; inputStr: string } | null = null

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_start') {
          if (chunk.content_block.type === 'tool_use') {
            currentToolUse = {
              id: chunk.content_block.id,
              name: chunk.content_block.name,
              inputStr: ''
            }
          }
        } else if (chunk.type === 'content_block_delta') {
          if (chunk.delta.type === 'text_delta') {
            assistantReply += chunk.delta.text
            if (onChunk) onChunk(chunk.delta.text)
          } else if (chunk.delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.inputStr += chunk.delta.partial_json
          }
        } else if (chunk.type === 'content_block_stop') {
          if (currentToolUse && currentToolUse.name) {
            let parsedArgs = {}
            try {
              parsedArgs = JSON.parse(currentToolUse.inputStr || '{}')
            } catch {
              parsedArgs = {}
            }

            // Execute the tool
            const toolResult = await this.handleToolCall(currentToolUse.name, parsedArgs)
            toolCallsExecuted.push({
              name: currentToolUse.name,
              args: parsedArgs,
              result: toolResult
            })
            currentToolUse = null
          }
        } else if (chunk.type === 'message_start') {
          this.totalUsage.inputTokens += chunk.message.usage?.input_tokens || 0
        } else if (chunk.type === 'message_delta') {
          if (chunk.usage) {
            this.totalUsage.outputTokens += chunk.usage.output_tokens || 0
          }
        }
      }

      this.totalUsage.calls += 1

      // If tool execution took place, append notification if reply was empty
      if (!assistantReply && toolCallsExecuted.length > 0) {
        const toolSummaries = toolCallsExecuted.map((t) => {
          if (t.name === 'delegate_task') {
            return `✅ Tugas "${t.args.task_title}" berhasil didelegasikan kepada **${t.args.target_agent}** dan dimasukkan ke papan Kanban!`
          }
          if (t.name === 'call_team_meeting') {
            return `👥 Seluruh tim telah dipanggil ke ruang rapat untuk agenda: "${t.args.agenda}"!`
          }
          if (t.name === 'end_team_meeting') {
            return `🚪 Rapat telah selesai dan tim kembali ke posisi masing-masing.`
          }
          return `Tool ${t.name} selesai dieksekusi.`
        }).join('\n\n')
        assistantReply = toolSummaries
        if (onChunk) onChunk(assistantReply)
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: assistantReply,
        timestamp: new Date().toISOString(),
        toolCalls: toolCallsExecuted.length > 0 ? toolCallsExecuted : undefined
      }
      history.push(assistantMsg)
      this.saveStorage()

      // Return agent state to idle after short delay
      setTimeout(() => {
        const s = this.agentStates.get(agentId)
        if (s && !this.isMeetingActive) {
          s.state = 'Idle'
          s.activity = ''
          s.room = 'Lounge'
          s.roomPosition = 'lounge-seat'
        }
      }, 10_000)

      return { response: assistantReply, toolResults: toolCallsExecuted }
    } catch (error) {
      if (state) {
        state.state = 'Idle'
        state.activity = ''
      }
      throw error
    }
  }

  /** The Claude Code binary bundled with @anthropic-ai/claude-code, or `claude` from PATH. */
  private claudeBinary(): string {
    try {
      const packageDir = dirname(createRequire(import.meta.url).resolve('@anthropic-ai/claude-code/package.json'))
      const binary = join(packageDir, 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude')
      if (existsSync(binary)) return binary
    } catch {
      // not installed locally
    }
    return 'claude'
  }

  // The prompt goes through stdin and no shell is involved, so chat text can never become a command.
  // Without --dangerously-skip-permissions, tools that need approval are refused in print mode.
  private runClaudeCli(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const child = execFile(this.claudeBinary(), ['-p'], {
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          env: { ...process.env, CI: '1' }
        }, (error, stdout) => {
          const out = (stdout || '').trim()
          resolve(!error && out && !out.toLowerCase().includes('weekly limit') ? out : null)
        })
        child.stdin?.end(prompt)
      } catch {
        resolve(null)
      }
    })
  }

  private async sendSimulatedMessage(
    agentId: string,
    userText: string,
    onChunk?: (text: string) => void
  ): Promise<{ response: string; toolResults?: unknown[] }> {
    const state = this.agentStates.get(agentId)
    if (state) {
      state.state = 'Working'
      state.room = 'Workspace'
      state.roomPosition = 'assigned-desk'
      state.currentTask = userText.length > 50 ? `${userText.slice(0, 47)}...` : userText
      state.activity = 'Mengetik respon...'
      state.lastActive = new Date().toISOString()
    }

    const history = this.chatHistories.get(agentId) || []
    history.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: userText,
      timestamp: new Date().toISOString()
    })

    const toolResults: NonNullable<ChatMessage['toolCalls']> = []
    let reply = ''
    const isMeetingPrompt = /rapat|meeting|kumpul|berkumpul/i.test(userText)
    const isDelegatePrompt = /tugas|task|kampanye|proyek|buatkan|bagi|koordinasi/i.test(userText)

    const cliOutput = await this.runClaudeCli(userText)

    if (cliOutput) {
      reply = `> ℹ️ *Dijawab lewat Claude Code CLI (bukan Anthropic API)*\n\n${cliOutput}`
    } else if (agentId === 'ceo') {
      if (isMeetingPrompt) {
        const res = await this.handleToolCall('call_team_meeting', { agenda: userText })
        toolResults.push({ name: 'call_team_meeting', args: { agenda: userText }, result: res })
        reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Sebagai **CEO (Claude 5.5 Orchestrator)**, saya telah memanggil seluruh tim ke ruang rapat utama!

👥 **Status Rapat:** Seluruh tim sekarang berkumpul di ruang rapat untuk membahas agenda:
> **"${userText}"**

Anda dapat melihat seluruh avatar kami berjalan dan berkumpul di meja rapat di kantor 3D! Apa arahan selanjutnya yang ingin Anda berikan?`
      } else if (isDelegatePrompt) {
        const res1 = await this.handleToolCall('delegate_task', {
          target_agent: 'digital-marketing',
          task_title: 'Strategi Campaign & KPI',
          task_description: `Tentukan objective, audiens, dan KPI campaign untuk: "${userText}"`,
          priority: 3,
        })
        const res2 = await this.handleToolCall('delegate_task', {
          target_agent: 'content-creator',
          task_title: 'Angle & Content Brief',
          task_description: `Susun angle, pesan utama, dan content brief untuk: "${userText}"`,
          priority: 2,
        })
        toolResults.push(
          { name: 'delegate_task', args: { target_agent: 'digital-marketing', task_title: 'Strategi Campaign & KPI' }, result: res1 },
          { name: 'delegate_task', args: { target_agent: 'content-creator', task_title: 'Angle & Content Brief' }, result: res2 }
        )
        reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Instruksi Anda telah saya terima dan langsung saya bagi ke tim:

1. 🎯 **Digital Marketing Specialist**: Ditugaskan menyusun strategi campaign dan KPI.
2. ✍️ **Content Creator**: Ditugaskan menyusun angle dan content brief.

Kartu tugas baru telah ditambahkan ke **Task Board (Kanban)**, dan avatar mereka kini mulai bekerja di meja kerja masing-masing!`
      } else {
        reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya adalah **CEO (Claude Orchestrator)** di AI Office ini. Saya siap mengkoordinasikan tim Event Specialist, Content Creator, Video Editor, Social Media Manager, dan Digital Marketing untuk proyek Anda.

Coba uji kemampuan orkestrasi saya dengan perintah berikut:
- *"Bagi tugas untuk kampanye peluncuran produk baru"*
- *"Panggil seluruh tim untuk rapat evaluasi"*`
      }
    } else if (agentId === 'digital-marketing') {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **AI Digital Marketing Specialist**. Terkait permintaan Anda: **"${userText}"**, berikut strategi awal yang saya siapkan:

### 1. Target Audiens & Persona
- Profesional muda & kreator digital (usia 20-35 tahun).
- Value proposition: Efisiensi kerja dan visualisasi kantor 3D interaktif.

### 2. Copywriting Headline Promosi
- *"Tingkatkan Produktivitas Anda dengan Tim AI Virtual Sendiri."*
- *"Kelola Bisnis Seperti Punya Kantor dan Tim Ahli di Samping Anda."*

Saya siap berkoordinasi lebih lanjut dengan Content Creator dan Video Editor!`
    } else if (agentId === 'content-creator') {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **AI Content Creator**. Saya telah mengumpulkan beberapa insight awal untuk topik: **"${userText}"**:

### 📊 Temuan Utama:
1. **Tren Pasar**: Minat terhadap AI agent interaktif meningkat pesat di kalangan pengembang dan agensi digital.
2. **Kebutuhan Pengguna**: Visualisasi aktivitas agen (3D avatar) meningkatkan rasa percaya dan keterlibatan pengguna dibanding chat teks biasa.
3. **Rekomendasi**: Prioritaskan format konten video pendek yang memperlihatkan demo langsung fitur-fitur kantor virtual.`
    } else if (agentId !== 'video-editor') {
      const agent = CLAUDE_AGENTS.find((item) => item.id === agentId)
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **${agent?.name ?? agentId}** (${agent?.role ?? 'Agen AI Office'}). Permintaan **"${userText}"** sudah saya catat dan akan saya kerjakan begitu API key Claude terhubung.`
    } else {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **AI Video Editor**. Berikut konsep video yang saya rancang untuk: **"${userText}"**:

### 🎬 Konsep Video Pendek (Reels / TikTok):
- **Detik 0 - 3 (Hook)**: Visual avatar 3D mulai mengetik cepat di meja. Narasi: *"Gimana rasanya punya kantor virtual sendiri yang diisi AI?"*
- **Detik 4 - 15 (Problem & Solution)**: Tunjukkan transisi meeting room dan task board yang bergerak otomatis saat CEO memberi tugas.
- **Detik 16 - 30 (CTA)**: Tunjukkan link di bio / demo interaktif.`
    }

    // Simulate word-by-word streaming
    const words = reply.split(' ')
    for (const word of words) {
      if (onChunk) onChunk(word + ' ')
      await new Promise((r) => setTimeout(r, 15))
    }

    history.push({
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: 'assistant',
      content: reply,
      timestamp: new Date().toISOString(),
      toolCalls: toolResults.length > 0 ? toolResults : undefined
    })
    this.saveStorage()

    setTimeout(() => {
      const s = this.agentStates.get(agentId)
      if (s && !this.isMeetingActive) {
        s.state = 'Idle'
        s.activity = ''
        s.room = 'Lounge'
        s.roomPosition = 'lounge-seat'
      }
    }, 10_000)

    return { response: reply, toolResults }
  }

  private async handleToolCall(name: string, args: DelegateArgs): Promise<Record<string, unknown>> {
    if (name === 'delegate_task') {
      if (!CLAUDE_AGENTS.some((a) => a.id === args.target_agent && a.id !== CEO_ID)) {
        return { success: false, error: `Agen ${args.target_agent} tidak ada di tim.` }
      }
      const newTask: StoredTask = {
        id: `task-${Date.now()}`,
        title: args.task_title || 'Tugas Baru',
        description: args.task_description || '',
        status: 'todo',
        assignee: args.target_agent ?? '',
        priority: args.priority || 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      this.tasks.unshift(newTask)
      this.saveStorage()

      // Activate the targeted agent in the 3D office!
      const targetState = this.agentStates.get(args.target_agent ?? '')
      if (targetState) {
        targetState.state = 'Working'
        targetState.room = 'Workspace'
        targetState.roomPosition = 'assigned-desk'
        targetState.currentTask = newTask.title
        targetState.activity = `Mengerjakan: ${newTask.title}`
        targetState.lastActive = new Date().toISOString()

        // Also add an introductory system note in target agent's chat history
        const targetHistory = this.chatHistories.get(args.target_agent ?? '') || []
        targetHistory.push({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: `📌 **Tugas Didelegasikan dari CEO:**\n**${newTask.title}**\n\n${newTask.description}\n\n*Saya siap mengerjakan tugas ini. Klik chat untuk berdiskusi langsung atau memberi instruksi tambahan.*`,
          timestamp: new Date().toISOString()
        })
        this.saveStorage()
      }

      // The delegated agent really works on it (the run moves the task to review), instead of only looking busy.
      void this.runTaskNow(newTask.id)

      return { success: true, taskId: newTask.id, message: `Tugas berhasil diberikan kepada ${args.target_agent} dan sedang dikerjakan` }
    }

    if (name === 'call_team_meeting') {
      this.setMeeting(true, args.agenda)
      return { success: true, message: 'Tim berkumpul di ruang rapat.' }
    }

    if (name === 'end_team_meeting') {
      this.setMeeting(false)
      return { success: true, message: 'Rapat tim selesai.' }
    }

    return { error: 'Unknown tool' }
  }

  // API Snapshots for Ruang Frontend

  public getOfficeSnapshot(): OfficeSnapshot {
    const stations: OfficeStation[] = CLAUDE_AGENTS.map((agent) => {
      const live = this.agentStates.get(agent.id)!
      // The office follows the board: an idle agent with a running task sits at its desk working on it.
      const running = this.tasks.find((task) => task.assignee === agent.id && task.status === 'running')
      const s = live.state !== 'Idle' || this.isMeetingActive ? live
        : running ? { ...live, state: 'Working' as const, room: 'Workspace' as const, roomPosition: 'assigned-desk', currentTask: running.title, activity: `Mengerjakan: ${running.title}` }
        : live
      return {
        id: agent.id,
        name: agent.name,
        role: agent.role,
        room: s.room,
        roomPosition: s.roomPosition,
        state: s.state,
        currentTask: s.currentTask || 'Siap menerima tugas',
        recentActivity: s.activity || 'Menunggu arahan',
        activity: this.isMeetingActive ? `Rapat: ${this.meetingAgenda || 'Koordinasi Tim'}` : s.activity,
        seat: agent.seat,
        provenance: `Claude AI Model (${this.modelFor(agent)})`,
        freshness: s.lastActive
      }
    })

    const activeCount = stations.filter((st) => st.state === 'Working' || st.state === 'Collaborating').length
    const idleCount = stations.filter((st) => st.state === 'Idle').length

    return {
      stations,
      summary: {
        declared: stations.length,
        active: activeCount,
        idle: idleCount,
        offline: 0,
        unknown: 0,
        gatewaysReachable: stations.length,
        gatewaysDeclared: stations.length
      },
      fetchedAt: new Date().toISOString()
    }
  }

  public getRuntimeSnapshot(): RuntimeSnapshot {
    return {
      profiles: {
        availability: 'available',
        data: CLAUDE_AGENTS.map((a) => ({
          name: a.id,
          model: this.modelFor(a),
          gateway: 'Running' as const
        }))
      },
      openCode: {
        availability: 'unavailable',
        data: ''
      },
      fetchedAt: new Date().toISOString()
    }
  }

  public getTaskBoardSnapshot(): TaskBoardSnapshot {
    const tasks: Task[] = this.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee: t.assignee,
      priority: t.priority,
      board: 'Claude Office Board'
    }))

    return {
      tasks: {
        availability: 'available',
        data: tasks
      },
      boards: [
        {
          slug: 'claude-office-board',
          name: 'Claude Office Tasks',
          current: true,
          total: tasks.length
        }
      ],
      fetchedAt: new Date().toISOString()
    }
  }

  public getTaskDetail(id: string) {
    const t = this.tasks.find((task) => task.id === id)
    if (!t) return null
    const agent = CLAUDE_AGENTS.find((a) => a.id === t.assignee)
    const mem = t.assignee ? this.getAgentMemory(t.assignee) : null
    return {
      task: {
        availability: 'available',
        data: {
          id: t.id,
          title: t.title,
          status: t.status,
          assignee: t.assignee,
          priority: t.priority,
          body: t.description || 'Tidak ada deskripsi detail.',
          result: t.result,
          lastError: t.lastError,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
          workspace: mem?.workspacePath || process.cwd(),
          model: agent ? this.modelFor(agent) : this.config.defaultModel,
          skills: ['claude-agent-sdk', 'task-orchestration'],
          parents: [],
          children: [],
          runs: [],
          comments: [],
          events: [
            {
              kind: 'created',
              detail: `Tugas dialokasikan untuk ${agent?.name || t.assignee || 'kru'}`,
              createdAt: t.createdAt
            }
          ],
          createdAt: t.createdAt,
          updatedAt: t.updatedAt
        }
      },
      fetchedAt: new Date().toISOString()
    }
  }

  public updateTaskStatus(id: string, newStatus: string): { success: boolean; task?: StoredTask } {
    const t = this.tasks.find((task) => task.id === id)
    if (!t) return { success: false }
    t.status = newStatus as StoredTask['status']
    t.updatedAt = new Date().toISOString()

    if (newStatus === 'running' && t.assignee) {
      const state = this.agentStates.get(t.assignee)
      if (state) {
        state.state = 'Working'
        state.room = 'Workspace'
        state.roomPosition = 'assigned-desk'
        state.currentTask = t.title
        state.activity = `Mengerjakan: ${t.title}`
        state.lastActive = new Date().toISOString()
      }
    } else if (newStatus === 'done' && t.assignee) {
      const state = this.agentStates.get(t.assignee)
      if (state && state.currentTask === t.title) {
        state.state = 'Idle'
        state.activity = ''
        state.room = 'Lounge'
        state.roomPosition = 'lounge-seat'
      }
    }

    this.saveStorage()
    return { success: true, task: t }
  }

  public addTask(taskData: Partial<StoredTask> & { body?: string }): { success: boolean; task: StoredTask } {
    const newTask: StoredTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: taskData.title || 'Tugas Baru',
      description: taskData.description || taskData.body || '',
      status: taskData.status || 'todo',
      assignee: taskData.assignee || 'ceo',
      priority: taskData.priority || 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this.tasks.unshift(newTask)

    if (newTask.status === 'running' && newTask.assignee) {
      const state = this.agentStates.get(newTask.assignee)
      if (state) {
        state.state = 'Working'
        state.room = 'Workspace'
        state.roomPosition = 'assigned-desk'
        state.currentTask = newTask.title
        state.activity = `Mengerjakan: ${newTask.title}`
        state.lastActive = new Date().toISOString()
      }
    }

    this.saveStorage()
    return { success: true, task: newTask }
  }

  public deleteTask(id: string): { success: boolean } {
    const prevLen = this.tasks.length
    this.tasks = this.tasks.filter((t) => t.id !== id)
    if (this.tasks.length !== prevLen) {
      this.saveStorage()
      return { success: true }
    }
    return { success: false }
  }

  public async runTaskNow(id: string): Promise<{ success: boolean; message: string; response?: string }> {
    const t = this.tasks.find((task) => task.id === id)
    if (!t) return { success: false, message: 'Tugas tidak ditemukan.' }

    t.status = 'running'
    t.startedAt = new Date().toISOString()
    t.updatedAt = t.startedAt
    t.lastError = undefined
    this.saveStorage()

    const targetAgent = t.assignee || 'ceo'
    const prompt = `[EKSEKUSI TUGAS KANBAN: "${t.title}"]\n${t.description}\n\nSilakan kerjakan tugas ini sesuai dengan peran dan spesialisasi Anda.`

    let res = ''
    try {
      const execResult = await this.sendMessage(targetAgent, prompt)
      res = execResult.response
      t.result = res
      t.status = 'review'
      t.completedAt = new Date().toISOString()
      t.updatedAt = t.completedAt
    } catch (err) {
      res = `Gagal mengeksekusi tugas: ${err instanceof Error ? err.message : String(err)}`
      t.lastError = res
      t.status = 'todo'
      t.updatedAt = new Date().toISOString()
    }
    this.saveStorage()
    return { success: true, message: `Tugas "${t.title}" selesai dikerjakan oleh ${targetAgent}.`, response: res }
  }

  public getUsageSnapshot(): UsageSnapshot {
    const inputCost = (this.totalUsage.inputTokens / 1_000_000) * 3.0 // ~$3 per Mtok
    const outputCost = (this.totalUsage.outputTokens / 1_000_000) * 15.0 // ~$15 per Mtok
    const totalTokens = this.totalUsage.inputTokens + this.totalUsage.outputTokens
    const costUsd = Math.round((inputCost + outputCost) * 100) / 100

    return {
      days: 7,
      agents: CLAUDE_AGENTS.map((a) => ({
        agent: a.id,
        availability: 'available',
        usage: {
          days: 7,
          sessions: (this.chatHistories.get(a.id) || []).length,
          messages: (this.chatHistories.get(a.id) || []).length,
          toolCalls: a.id === 'ceo' ? 4 : 0,
          inputTokens: Math.round(this.totalUsage.inputTokens / 4),
          outputTokens: Math.round(this.totalUsage.outputTokens / 4),
          totalTokens: Math.round(totalTokens / 4),
          costUsd: Math.round((costUsd / 4) * 100) / 100,
          models: [{ model: this.config.defaultModel, sessions: 1, tokens: Math.round(totalTokens / 4) }],
          tools: [{ tool: 'delegate_task', calls: 2 }],
          sources: [{ source: 'web-chat', sessions: 1, tokens: Math.round(totalTokens / 4) }]
        }
      })),
      totals: {
        sessions: this.totalUsage.calls,
        messages: this.totalUsage.calls * 2,
        toolCalls: 4,
        inputTokens: this.totalUsage.inputTokens,
        outputTokens: this.totalUsage.outputTokens,
        totalTokens,
        costUsd
      },
      models: [
        {
          model: this.config.defaultModel,
          sessions: this.totalUsage.calls,
          tokens: totalTokens
        }
      ],
      sources: [
        {
          source: 'Claude Web Chat',
          sessions: this.totalUsage.calls,
          tokens: totalTokens
        }
      ],
      tools: [{ tool: 'delegate_task', calls: 2 }],
      fetchedAt: new Date().toISOString()
    }
  }

  public getCalendarSnapshot(): CalendarSnapshot {
    const jobs: ScheduledJob[] = this.scheduledJobs.map((job) => ({
      id: job.id,
      name: job.name,
      agent: job.agent,
      schedule: job.schedule,
      status: job.status,
      nextRun: job.nextRun,
      lastRun: job.lastRun,
      lastRunOk: job.lastRunOk,
      repeat: job.repeat || job.schedule
    }))

    return {
      jobs: {
        availability: 'available',
        data: jobs
      },
      fetchedAt: new Date().toISOString()
    }
  }

  public getScheduledJobs(): ClaudeScheduledJob[] {
    return this.scheduledJobs
  }

  public addScheduledJob(data: Partial<ClaudeScheduledJob>): { success: boolean; job: ClaudeScheduledJob } {
    const agent = String(data.agent || 'ceo')
    const schedule = (data.schedule || '0 9 * * *').trim()
    const newJob: ClaudeScheduledJob = {
      id: `cron-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: data.name || 'Jadwal Tugas Claude Baru',
      agent,
      schedule,
      description: data.description || '',
      prompt: data.prompt || data.description || 'Jalankan tugas berkala untuk agen.',
      status: 'active',
      nextRun: computeNextCronRun(schedule),
      repeat: data.repeat || schedule,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    this.scheduledJobs.unshift(newJob)
    this.saveStorage()
    return { success: true, job: newJob }
  }

  public toggleScheduledJob(id: string): { success: boolean; status: string } {
    const job = this.scheduledJobs.find((j) => j.id === id)
    if (!job) return { success: false, status: 'unknown' }
    job.status = job.status === 'active' ? 'paused' : 'active'
    job.updatedAt = new Date().toISOString()
    if (job.status === 'active') {
      job.nextRun = computeNextCronRun(job.schedule)
    }
    this.saveStorage()
    return { success: true, status: job.status }
  }

  public deleteScheduledJob(id: string): { success: boolean } {
    const prevLen = this.scheduledJobs.length
    this.scheduledJobs = this.scheduledJobs.filter((j) => j.id !== id)
    if (this.scheduledJobs.length !== prevLen) {
      this.saveStorage()
      return { success: true }
    }
    return { success: false }
  }

  public async runScheduledJobNow(id: string): Promise<{ success: boolean; message: string; response?: string }> {
    const job = this.scheduledJobs.find((j) => j.id === id)
    if (!job) return { success: false, message: 'Jadwal tugas tidak ditemukan.' }

    job.lastRun = new Date().toISOString()
    job.lastRunOk = true
    job.nextRun = computeNextCronRun(job.schedule)

    const state = this.agentStates.get(job.agent)
    if (state) {
      state.state = 'Working'
      state.currentTask = `[CRON] ${job.name}`
      state.activity = `Menjalankan jadwal: ${job.name}`
      state.lastActive = new Date().toISOString()
    }

    const promptText = job.prompt || `[JADWAL BERKALA OTOMATIS: ${job.name}]\n${job.description}`

    // Trigger agent execution asynchronously
    let responseText = ''
    try {
      const result = await this.sendMessage(job.agent, promptText)
      responseText = result.response
    } catch (err) {
      job.lastRunOk = false
      responseText = `Gagal menjalankan tugas: ${err instanceof Error ? err.message : String(err)}`
    }

    this.saveStorage()
    return { success: true, message: `Jadwal "${job.name}" berhasil dijalankan.`, response: responseText }
  }

  public getDashboardSnapshot(): DashboardSnapshot {
    const officeSnap = this.getOfficeSnapshot()
    const byStatus: Record<string, number> = {}
    for (const t of this.tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1
    }

    return {
      runtime: this.getRuntimeSnapshot(),
      tasks: {
        availability: 'available',
        total: this.tasks.length,
        byStatus,
        assigned: this.tasks.filter((t) => t.assignee).length
      },
      calendar: {
        availability: 'available',
        total: this.scheduledJobs.length,
        active: this.scheduledJobs.filter((j) => j.status === 'active').length,
        paused: this.scheduledJobs.filter((j) => j.status === 'paused').length
      },
      activity: {
        availability: 'available',
        total: this.tasks.length,
        latest: {
          title: 'Claude AI Office Aktif',
          preview: 'Sistem agen AI Claude beroperasi',
          lastActive: new Date().toISOString(),
          actor: 'ceo'
        }
      },
      knowledge: {
        availability: 'available',
        total: 4,
        byCategory: { 'Claude Prompts': 4 }
      },
      channels: {
        availability: 'available',
        total: 1,
        connected: 1
      },
      office: officeSnap.summary,
      commands: {
        total: 10,
        failed: 0,
        averageMs: 12
      },
      fetchedAt: new Date().toISOString()
    }
  }
}

export const claudeService = new ClaudeOfficeService()
