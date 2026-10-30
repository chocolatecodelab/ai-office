import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import Anthropic from '@anthropic-ai/sdk'
import type { OfficeSnapshot, OfficeStation, TaskBoardSnapshot, Task, RuntimeSnapshot, UsageSnapshot, DashboardSnapshot, CalendarSnapshot, ScheduledJob } from './mission-control.js'

export const CLAUDE_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'] as const
const DEFAULT_MODEL = 'claude-sonnet-5-5'
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
  /** The claude.ai Project this agent was created from, when it was registered through MCP. */
  project?: { name: string; url?: string; syncedAt: string }
}

export const CEO_ID = 'ceo'
const MAX_INSTRUCTIONS = 20_000
const MAX_KNOWLEDGE = 30_000
const PROJECT_KNOWLEDGE_FILE = 'PROJECT_KNOWLEDGE.md'

/** The orchestrator is always present and always built from this code, so prompt changes apply to saved offices. */
const CEO_AGENT: AgentDefinition = {
  id: CEO_ID,
  name: 'CEO (Claude Orchestrator)',
  role: 'Chief Executive Officer',
  department: 'Executive',
  model: DEFAULT_MODEL,
  seat: 1,
  description: 'Menerima tugas dari user, menganalisis strategi, dan mendelegasikan tugas ke agen yang paling sesuai.',
  systemPrompt: `Anda adalah CEO dan Orchestrator di AI Office virtual ini.
Peran utama Anda adalah:
1. Menerima instruksi, visi, dan proyek dari Pengguna (Owner).
2. Membedah proyek besar menjadi subtugas yang jelas dan terarah.
3. Mendelegasikan tugas kepada anggota tim yang keahliannya paling cocok. Daftar lengkap anggota tim beserta id dan perannya ada di bagian "Informasi Ruang Kantor & Tim". Banyak anggota tim mewakili satu Project Claude milik Pengguna; delegasikan pekerjaan sebuah Project ke agen Project itu.
4. Anda memiliki alat (tool) 'delegate_task' dan 'call_team_meeting'. Gunakan alat ini ketika pengguna meminta eksekusi tugas atau rapat tim!
5. Selalu bersikap profesional, visioner, tegas, solutif, dan ramah dalam bahasa Indonesia.`,
}

/** Lowercase, dash-separated id from a Project name, for example "Toko Kopi Online" → "toko-kopi-online". */
export function agentIdFromName(name: string): string {
  const slug = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug && slug !== CEO_ID ? slug : `project-${Date.now().toString(36)}`
}

// The live crew. It is mutated in place (loaded from storage, Projects added or removed), so every
// module that imported it sees the current list.
export const CLAUDE_AGENTS: AgentDefinition[] = [
  CEO_AGENT,
  {
    id: 'marketing',
    name: 'Marketing & Sales',
    role: 'Marketing & Sales Strategist',
    department: 'Commercial',
    model: DEFAULT_MODEL,
    seat: 2,
    description: 'Melakukan riset pasar, menyusun strategi kampanye pemasaran, copywriting iklan, dan strategi penjualan.',
    systemPrompt: `Anda adalah Marketing & Sales Strategist di AI Office.
Peran utama Anda adalah:
1. Merancang strategi pemasaran produk dan layanan.
2. Menentukan target audiens, user persona, positioning, dan Unique Selling Proposition (USP).
3. Menyusun copy iklan, headline menarik, strategi media sosial, dan kampanye peluncuran.
4. Merancang sales funnel, penawaran promosi, dan strategi konversi penjualan.
5. Bersikap persuasif, kreatif, analitis terhadap pasar, dan berorientasi pada pertumbuhan bisnis (growth mindset). Gunakan bahasa Indonesia yang menarik dan persuasif.`
  },
  {
    id: 'researcher',
    name: 'Researcher',
    role: 'Lead Researcher & Analyst',
    department: 'Intelligence & Research',
    model: DEFAULT_MODEL,
    seat: 3,
    description: 'Mencari informasi mendalam, data terpercaya, analisis kompetitor, dan menyusun laporan riset terstruktur.',
    systemPrompt: `Anda adalah Lead Researcher & Analyst di AI Office.
Peran utama Anda adalah:
1. Melakukan riset mendalam mengenai topik apa pun yang diminta oleh Pengguna atau CEO.
2. Menganalisis tren industri, data pasar, dan benchmark kompetitor.
3. Memvalidasi fakta, menyaring informasi akurat, dan menyusun laporan riset yang sistematis, komprehensif, dan mudah dipahami.
4. Memberikan insight berbasis data dan rekomendasi strategis untuk tim.
5. Bersikap objektif, kritis, teliti, dan berbasis fakta. Gunakan bahasa Indonesia yang jelas dan berstruktur rapi.`
  },
  {
    id: 'creator',
    name: 'Creator (Video Editor)',
    role: 'Creative Director & Video Editor',
    department: 'Production',
    model: DEFAULT_MODEL,
    seat: 4,
    description: 'Merancang konsep video, storyboard, naskah/script video visual, hook 3 detik, dan arahan editing footage.',
    systemPrompt: `Anda adalah Creative Director & Video Editor di AI Office.
Peran utama Anda adalah:
1. Merancang konsep video pendek (Reels, TikTok, Shorts) maupun video panjang (YouTube, Dokumenter, Promosi).
2. Menulis naskah video lengkap dengan arahan visual (Visual Cue), narasi (Voice Over), sound effect (SFX), dan musik latar.
3. Merancang hook 3-5 detik pertama yang menghentikan scroll penonton.
4. Memberikan panduan teknis editing dari footage mentah: pemilihan B-roll, pacing/potongan beat lagu, color grading style, teks animasi on-screen, dan transisi.
5. Bersikap sangat kreatif, mengerti algoritma media sosial, dan visual-driven. Gunakan bahasa Indonesia yang dinamis dan modern.`
  }
]

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: Array<{ name: string; args: any; result?: any }>
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
        // Offices saved before agents were stored keep the built-in crew.
        if (Array.isArray(data.agents)) {
          const saved = (data.agents as AgentDefinition[]).filter((agent) => agent?.id && agent.id !== CEO_ID)
          CLAUDE_AGENTS.splice(0, CLAUDE_AGENTS.length, CEO_AGENT, ...saved)
        }
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
      }
    } catch {
      // fresh setup
    }
  }

  private saveStorage() {
    try {
      if (!existsSync(this.storageDir)) {
        mkdirSync(this.storageDir, { recursive: true })
      }
      const data = {
        config: this.config,
        agents: CLAUDE_AGENTS.filter((agent) => agent.id !== CEO_ID),
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
          title: 'Riset Audiens & Tren Konten',
          description: 'Menganalisis minat target audiens terhadap teknologi AI',
          status: 'todo',
          assignee: 'researcher',
          priority: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task-3',
          title: 'Konsep Storyboard Video Teaser',
          description: 'Membuat draft video 30 detik pengenalan produk',
          status: 'todo',
          assignee: 'creator',
          priority: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'task-4',
          title: 'Strategi Kampanye Peluncuran',
          description: 'Merancang sales funnel dan copywriting promosi',
          status: 'todo',
          assignee: 'marketing',
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
          id: 'cron-researcher-trends',
          name: 'AI & Tech Industry Trends Briefing',
          agent: 'researcher',
          schedule: '0 8 * * *',
          description: 'Riset tren kecerdasan buatan terbaru, update model LLM, dan analisis data teknologi industri.',
          prompt: 'Kumpulkan ringkasan riset tren teknologi AI terbaru dan insight strategis untuk tim.',
          status: 'active',
          nextRun: computeNextCronRun('0 8 * * *'),
          repeat: 'Setiap Hari 08:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cron-marketing-funnel',
          name: 'Weekly Campaign & Funnel Performance Review',
          agent: 'marketing',
          schedule: '0 10 * * 1',
          description: 'Evaluasi performa kampanye mingguan, efektivitas copywriting, dan optimasi sales funnel.',
          prompt: 'Evaluasi strategi pemasaran mingguan dan siapkan rekomendasi penawaran serta headline promosi baru.',
          status: 'active',
          nextRun: computeNextCronRun('0 10 * * 1'),
          repeat: 'Setiap Senin 10:00 WIB',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'cron-creator-brainstorm',
          name: 'Viral Hook & Video Script Brainstorming',
          agent: 'creator',
          schedule: '0 14 * * 2,4',
          description: 'Penyusunan 3 konsep video pendek (Shorts/Reels/TikTok) dengan hook 3 detik dan visual pacing.',
          prompt: 'Rancang 3 konsep naskah video pendek dengan hook visual 3 detik dan arahan editing footage.',
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

  /**
   * Creates or updates the agent of one claude.ai Project. The Project's instructions become the
   * agent's rules and its knowledge a context file; registering the same Project again updates it.
   */
  public upsertProjectAgent(input: {
    projectName: string
    agentName?: string
    role: string
    description: string
    instructions: string
    knowledge?: string
    projectUrl?: string
  }): { success: boolean; created: boolean; agent: AgentDefinition } {
    const projectName = input.projectName.trim()
    const existing = CLAUDE_AGENTS.find((agent) => agent.id !== CEO_ID && agent.project?.name.toLowerCase() === projectName.toLowerCase())
    const id = existing?.id ?? agentIdFromName(projectName)
    if (!existing && CLAUDE_AGENTS.some((agent) => agent.id === id)) {
      throw new Error(`Id agen "${id}" sudah dipakai agen lain. Hapus agen itu dulu atau pakai nama Project yang berbeda.`)
    }
    const instructions = input.instructions.trim().slice(0, MAX_INSTRUCTIONS)
    const name = (input.agentName || projectName).trim()
    const agent: AgentDefinition = {
      id,
      name,
      role: input.role.trim(),
      department: 'Project',
      model: this.config.defaultModel,
      seat: existing?.seat ?? Math.max(0, ...CLAUDE_AGENTS.map((item) => item.seat)) + 1,
      description: input.description.trim(),
      systemPrompt: `Anda adalah ${name}, agen AI Office yang mewakili Project Claude "${projectName}" milik Pengguna.
Peran Anda: ${input.role.trim()}.
${input.description.trim()}

Ikuti instruksi Project (bagian "ATURAN & PEDOMAN KERJA") dan gunakan knowledge Project (bagian "DOKUMEN KONTEKS") sebagai sumber utama. Jawab dalam bahasa yang dipakai Pengguna.`,
      project: { name: projectName, url: input.projectUrl?.trim() || existing?.project?.url, syncedAt: new Date().toISOString() },
    }
    if (existing) CLAUDE_AGENTS[CLAUDE_AGENTS.indexOf(existing)] = agent
    else CLAUDE_AGENTS.push(agent)

    const memory = existing ? this.getAgentMemory(id) : { workspacePath: this.getAgentWorkspace(CEO_ID), claudeRules: '', notes: [], contextFiles: [] }
    memory.claudeRules = instructions
    // A re-sync without knowledge keeps what an earlier sync stored.
    const knowledge = (input.knowledge || '').trim().slice(0, MAX_KNOWLEDGE)
    if (knowledge) {
      memory.contextFiles = memory.contextFiles.filter((file) => file.name !== PROJECT_KNOWLEDGE_FILE)
      memory.contextFiles.unshift({ name: PROJECT_KNOWLEDGE_FILE, path: `claude.ai/project/${id}`, size: knowledge.length, content: knowledge })
    }
    this.agentMemories.set(id, memory)
    if (!existing) this.initAgentState(id)
    this.saveStorage()
    return { success: true, created: !existing, agent }
  }

  /** Removes an agent (never the CEO). Its tasks and scheduled jobs move to the CEO. */
  public removeAgent(agentId: string): { success: boolean; message: string } {
    if (agentId === CEO_ID) throw new Error('CEO tidak bisa dihapus.')
    const index = CLAUDE_AGENTS.findIndex((agent) => agent.id === agentId)
    if (index < 0) throw new Error(`Agen ${agentId} tidak ditemukan.`)
    const [removed] = CLAUDE_AGENTS.splice(index, 1)
    let moved = 0
    for (const item of [...this.tasks, ...this.scheduledJobs]) {
      if ('assignee' in item && item.assignee === agentId) { item.assignee = CEO_ID; moved += 1 }
      if ('agent' in item && item.agent === agentId) { item.agent = CEO_ID; moved += 1 }
    }
    this.chatHistories.delete(agentId)
    this.agentMemories.delete(agentId)
    this.agentStates.delete(agentId)
    this.saveStorage()
    return { success: true, message: `Agen ${removed.name} dihapus.${moved ? ` ${moved} tugas/jadwal dipindahkan ke CEO.` : ''}` }
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
    if (agentId === 'creator') {
      return {
        workspacePath: 'd:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR',
        claudeRules: `# Video Editor & Creative Guidelines
- Framework: Remotion (React Video) & Motion Pipeline
- Format: 9:16 (Shorts/TikTok/Reels) & 16:9 (YouTube)
- Pacing: Dynamic cut setiap 2-3 detik mengikuti beat audio
- Hook 3 Detik: Hook visual dan narasi kuat untuk menghentikan scrolling
- Visual Style: Teks dinamis on-screen, transisi punchy, dan color contrast bersih
- Audio: Audio ducking otomatis ketika voiceover aktif`,
        notes: [
          'Workspace aktif: d:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR',
          'Pipeline: video-system (tokens, scripts, remotion compositions)',
          'Gunakan B-roll 60fps untuk transisi slow motion'
        ],
        contextFiles: []
      }
    }
    if (agentId === 'ceo') {
      return {
        workspacePath: 'd:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE',
        claudeRules: `# CEO Orchestration Guidelines
- Analisis kebutuhan dan buat rencana eksekusi terstruktur
- Delegasikan tugas visual dan editing ke Creator
- Delegasikan riset pasar dan data industri ke Researcher
- Delegasikan strategi kampanye dan copywriting ke Marketing
- Koordinasikan rapat tim di ruang meeting bila diperlukan`,
        notes: [
          'Workspace aktif: d:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE',
          'Orkestrasi tim: Marketing, Researcher, Creator'
        ],
        contextFiles: []
      }
    }
    if (agentId === 'marketing') {
      return {
        workspacePath: 'd:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE',
        claudeRules: `# Marketing & Sales Strategy Guidelines
- Formula Copywriting: AIDA (Attention, Interest, Desire, Action) atau PAS (Problem, Agitate, Solve)
- Target Pasar: Kreator digital, developer, dan digital agency
- Fokus: Pertumbuhan organik, social proof, dan konversi sales funnel`,
        notes: [
          'Optimalkan pesan penawaran utama (USP)',
          'KPI: CTR (Click-Through Rate) dan Conversion Rate'
        ],
        contextFiles: []
      }
    }
    return {
      workspacePath: 'd:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE',
      claudeRules: `# Research & Analysis Guidelines
- Sajikan data akurat, valid, dan berorientasi fakta
- Buat ringkasan eksekutif dan rekomendasi konkret di awal laporan
- Analisis kompetitor dan tren teknologi terbaru secara komprehensif`,
      notes: [
        'Fokus riset: Perkembangan AI, model bahasa, dan otomasi alur kerja'
      ],
      contextFiles: []
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
    return mem.workspacePath || (agentId === 'creator' ? 'd:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR' : 'd:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE')
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
          } catch {}
        }
      }
    } catch {}

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

  public addContextFile(agentId: string, filePath: string, content?: string): { success: boolean; contextFiles: any[] } {
    const mem = this.getAgentMemory(agentId)
    const fileName = filePath.replace(/\\/g, '/').split('/').pop() || filePath
    let fileContent = content || ''
    if (!fileContent && existsSync(filePath)) {
      try {
        fileContent = readFileSync(filePath, 'utf8')
      } catch (err: any) {
        fileContent = `(Error reading file: ${err.message})`
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

  public removeContextFile(agentId: string, filePath: string): { success: boolean; contextFiles: any[] } {
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
        } catch {}
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

  public async sendMessage(
    agentId: string,
    userText: string,
    onChunk?: (text: string) => void
  ): Promise<{ response: string; toolResults?: any[] }> {
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
    const activeTasksList = this.tasks
      .map((t) => `[${t.status.toUpperCase()}] ${t.title} (PIC: ${t.assignee}) - ${t.description}`)
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

    const enhancedSystemPrompt = `${agent.systemPrompt}

Informasi Ruang Kantor & Tim Claude:
${otherAgentsList}

Daftar Tugas Tim di Task Board (Kanban):
${activeTasksList || 'Belum ada tugas tercatat.'}${memoryPrompt}

Format balasan gunakan Markdown yang rapi dengan heading, bullet points, dan penekanan teks bila perlu.`

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
      const toolCallsExecuted: Array<{ name: string; args: any; result?: any }> = []

      // Call Anthropic API with streaming
      const stream = await this.anthropicClient.messages.create({
        model: this.config.defaultModel,
        max_tokens: 3000,
        system: enhancedSystemPrompt,
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
    } catch (error: any) {
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
  ): Promise<{ response: string; toolResults?: any[] }> {
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

    const toolResults: any[] = []
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
          target_agent: 'marketing',
          task_title: 'Riset Pasar & Strategi Peluncuran',
          task_description: `Analisis target audiens dan susun strategi penjualan untuk: "${userText}"`,
          priority: 3
        })
        const res2 = await this.handleToolCall('delegate_task', {
          target_agent: 'creator',
          task_title: 'Storyboarding & Video Hook 3 Detik',
          task_description: `Rancang konsep naskah video pendek viral untuk: "${userText}"`,
          priority: 2
        })
        toolResults.push(
          { name: 'delegate_task', args: { target_agent: 'marketing', task_title: 'Riset Pasar & Strategi Peluncuran' }, result: res1 },
          { name: 'delegate_task', args: { target_agent: 'creator', task_title: 'Storyboarding & Video Hook 3 Detik' }, result: res2 }
        )
        reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Instruksi Anda telah saya terima dan langsung saya bagi ke tim:

1. 🎯 **Marketing & Sales**: Ditugaskan menyusun riset pasar dan strategi penawaran.
2. 🎬 **Creator (Video Editor)**: Ditugaskan merancang konsep video dan naskah hook 3 detik.

Kartu tugas baru telah ditambahkan ke **Task Board (Kanban)**, dan avatar mereka kini mulai bekerja di meja kerja masing-masing!`
      } else {
        reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya adalah **CEO (Claude Orchestrator)** di AI Office ini. Saya siap mengkoordinasikan tim Marketing, Researcher, dan Video Editor untuk proyek Anda.

Coba uji kemampuan orkestrasi saya dengan perintah berikut:
- *"Bagi tugas untuk kampanye peluncuran produk baru"*
- *"Panggil seluruh tim untuk rapat evaluasi"*`
      }
    } else if (agentId === 'marketing') {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **Marketing & Sales Lead**. Terkait permintaan Anda: **"${userText}"**, berikut strategi awal yang saya siapkan:

### 1. Target Audiens & Persona
- Profesional muda & kreator digital (usia 20-35 tahun).
- Value proposition: Efisiensi kerja dan visualisasi kantor 3D interaktif.

### 2. Copywriting Headline Promosi
- *"Tingkatkan Produktivitas Anda dengan Tim AI Virtual Sendiri."*
- *"Kelola Bisnis Seperti Punya Kantor dan Tim Ahli di Samping Anda."*

Saya siap berkoordinasi lebih lanjut dengan tim Researcher dan Creator!`
    } else if (agentId === 'researcher') {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **Lead Researcher & Analyst**. Saya telah mengumpulkan beberapa insight awal untuk topik: **"${userText}"**:

### 📊 Temuan Utama:
1. **Tren Pasar**: Minat terhadap AI agent interaktif meningkat pesat di kalangan pengembang dan agensi digital.
2. **Kebutuhan Pengguna**: Visualisasi aktivitas agen (3D avatar) meningkatkan rasa percaya dan keterlibatan pengguna dibanding chat teks biasa.
3. **Rekomendasi**: Prioritaskan format konten video pendek yang memperlihatkan demo langsung fitur-fitur kantor virtual.`
    } else {
      reply = `> ⚠️ *Mode simulasi: API key belum terhubung, balasan ini bukan dari Claude.*

Halo! Saya **Creative Director & Video Editor**. Berikut konsep video yang saya rancang untuk: **"${userText}"**:

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

  private async handleToolCall(name: string, args: any): Promise<any> {
    if (name === 'delegate_task') {
      if (!CLAUDE_AGENTS.some((a) => a.id === args.target_agent && a.id !== CEO_ID)) {
        return { success: false, error: `Agen ${args.target_agent} tidak ada di tim.` }
      }
      const newTask: StoredTask = {
        id: `task-${Date.now()}`,
        title: args.task_title || 'Tugas Baru',
        description: args.task_description || '',
        status: 'todo',
        assignee: args.target_agent,
        priority: args.priority || 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      this.tasks.unshift(newTask)
      this.saveStorage()

      // Activate the targeted agent in the 3D office!
      const targetState = this.agentStates.get(args.target_agent)
      if (targetState) {
        targetState.state = 'Working'
        targetState.room = 'Workspace'
        targetState.roomPosition = 'assigned-desk'
        targetState.currentTask = newTask.title
        targetState.activity = `Mengerjakan: ${newTask.title}`
        targetState.lastActive = new Date().toISOString()

        // Also add an introductory system note in target agent's chat history
        const targetHistory = this.chatHistories.get(args.target_agent) || []
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
      const s = live.state === 'Idle' && running && !this.isMeetingActive
        ? { ...live, state: 'Working' as const, room: 'Workspace' as const, roomPosition: 'assigned-desk', currentTask: running.title, activity: `Mengerjakan: ${running.title}` }
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
        provenance: `Claude AI Model (${this.config.defaultModel})`,
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
          model: this.config.defaultModel,
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
          model: agent?.model || this.config.defaultModel,
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
    t.status = newStatus as any
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
      status: (taskData.status as any) || 'todo',
      assignee: (taskData.assignee as any) || 'ceo',
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
    } catch (err: any) {
      res = `Gagal mengeksekusi tugas: ${err.message}`
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
    } catch (err: any) {
      job.lastRunOk = false
      responseText = `Gagal menjalankan tugas: ${err.message}`
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
