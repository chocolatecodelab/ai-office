// The AI Office MCP tools, shared by the local stdio server (mcp.ts, which talks to the office
// over HTTP) and the remote /mcp endpoint (mcp-http.ts, which runs inside the office server).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export const TASK_STATUSES = ['todo', 'running', 'review', 'done'] as const

export interface Station { id: string; name: string; role: string; state: string; currentTask?: string; activity?: string; room?: string }
export interface BoardTask { id: string; title: string; status: string; assignee?: string; priority?: number }
export interface NewTask { title: string; description: string; assignee: string; priority: number }
export interface OfficeAgent { id: string; name: string; role: string; department: string; description: string; project?: { name: string; url?: string; syncedAt: string } }
export interface ProjectAgentInput { projectName: string; agentName?: string; role: string; description: string; instructions: string; knowledge?: string; projectUrl?: string }

/** Where the tools read and change the office. */
export interface OfficeBackend {
  office(): Promise<{ stations: Station[]; summary: unknown }>
  agents(): Promise<OfficeAgent[]>
  registerProjectAgent(input: ProjectAgentInput): Promise<unknown>
  removeAgent(agentId: string): Promise<unknown>
  chat(agent: string, message: string): Promise<{ response: string; toolResults?: unknown[] }>
  tasks(): Promise<BoardTask[]>
  task(id: string): Promise<unknown>
  createTask(task: NewTask): Promise<unknown>
  updateTaskStatus(id: string, status: string): Promise<unknown>
  runTask(id: string): Promise<unknown>
  meeting(active: boolean, agenda?: string): Promise<unknown>
  addNote(agent: string, note: string): Promise<unknown>
  jobs(): Promise<unknown>
}

// Agents change as Projects are registered, so ids are checked against the live crew instead of a fixed enum.
const agentId = z.string().min(1).describe('Id agen dari list_agents, misalnya "ceo" (orchestrator) atau id agen sebuah Project')

async function ensureAgent(backend: OfficeBackend, id: string): Promise<void> {
  const agents = await backend.agents()
  if (!agents.some((agent) => agent.id === id)) throw new Error(`Agen "${id}" tidak ada. Agen yang tersedia: ${agents.map((agent) => agent.id).join(', ')}.`)
}

const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })

function tool<T>(handler: (args: T) => Promise<unknown>) {
  return async (args: T) => {
    try {
      return ok(await handler(args))
    } catch (error) {
      return { ...ok(error instanceof Error ? error.message : String(error)), isError: true }
    }
  }
}

export function createOfficeMcpServer(backend: OfficeBackend): McpServer {
  const server = new McpServer({ name: 'ai-office', version: '0.1.0' })

  server.registerTool('office_status', {
    title: 'Status kantor',
    description: 'Lihat siapa saja agen di AI Office, apa yang sedang mereka kerjakan, dan di ruangan mana mereka berada.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => {
    const office = await backend.office()
    return {
      summary: office.summary,
      agents: office.stations.map(({ id, name, role, state, currentTask, activity, room }) => ({ id, name, role, state, room, currentTask, activity })),
    }
  }))

  server.registerTool('list_agents', {
    title: 'Daftar agen',
    description: 'Daftar agen AI Office beserta peran dan keahliannya.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => (await backend.agents()).map(({ id, name, role, department, description, project }) => ({ id, name, role, department, description, ...(project ? { project: project.name, syncedAt: project.syncedAt } : {}) }))))

  server.registerTool('register_project_agent', {
    title: 'Daftarkan Project sebagai agen',
    description: `Buat atau perbarui agen AI Office yang mewakili satu Project Claude. Gunakan saat Pengguna meminta "daftarkan/sinkronkan Project ini ke AI Office".
Isi dari Project yang sedang aktif: instructions = instruksi Project (custom instructions) apa adanya, knowledge = ringkasan padat isi file knowledge Project (fakta, data, aturan penting; boleh panjang). Mendaftarkan Project yang sama lagi akan memperbarui agennya, bukan membuat agen baru.`,
    inputSchema: {
      project_name: z.string().min(1).describe('Nama Project persis seperti di claude.ai'),
      agent_name: z.string().optional().describe('Nama tampilan agen di kantor, default sama dengan nama Project'),
      role: z.string().min(1).describe('Peran singkat agen, misalnya "Spesialis konten TikTok"'),
      description: z.string().min(1).describe('Satu-dua kalimat tentang keahlian agen, dipakai CEO untuk memilih agen saat mendelegasikan'),
      instructions: z.string().min(1).describe('Instruksi Project (custom instructions) apa adanya'),
      knowledge: z.string().optional().describe('Ringkasan isi knowledge Project'),
      project_url: z.string().optional().describe('URL Project di claude.ai, jika diketahui'),
    },
  }, tool(async (args: { project_name: string; agent_name?: string; role: string; description: string; instructions: string; knowledge?: string; project_url?: string }) => backend.registerProjectAgent({
    projectName: args.project_name,
    agentName: args.agent_name,
    role: args.role,
    description: args.description,
    instructions: args.instructions,
    knowledge: args.knowledge,
    projectUrl: args.project_url,
  })))

  server.registerTool('remove_agent', {
    title: 'Hapus agen',
    description: 'Hapus satu agen dari AI Office beserta riwayat chat dan memorinya. Tugas dan jadwalnya dipindahkan ke CEO. CEO tidak bisa dihapus. Hanya jalankan jika Pengguna memintanya secara eksplisit.',
    inputSchema: { agent: agentId },
    annotations: { destructiveHint: true },
  }, tool(async ({ agent }: { agent: string }) => backend.removeAgent(agent)))

  server.registerTool('chat_with_agent', {
    title: 'Chat dengan agen',
    description: 'Kirim pesan ke satu agen dan tunggu balasannya. Percakapan tersimpan di riwayat chat agen itu di AI Office. CEO bisa mendelegasikan tugas dan memanggil rapat sendiri.',
    inputSchema: { agent: agentId, message: z.string().min(1).describe('Pesan untuk agen') },
  }, tool(async ({ agent, message }: { agent: string; message: string }) => {
    await ensureAgent(backend, agent)
    const result = await backend.chat(agent, message)
    return result.toolResults?.length ? `${result.response}\n\n[Aksi yang dijalankan agen]\n${JSON.stringify(result.toolResults, null, 2)}` : result.response
  }))

  server.registerTool('list_tasks', {
    title: 'Daftar tugas Kanban',
    description: 'Daftar tugas di papan Kanban AI Office, bisa difilter per status atau per agen.',
    inputSchema: { status: z.enum(TASK_STATUSES).optional(), assignee: agentId.optional() },
    annotations: { readOnlyHint: true },
  }, tool(async ({ status, assignee }: { status?: string; assignee?: string }) =>
    (await backend.tasks()).filter((task) => (!status || task.status === status) && (!assignee || task.assignee === assignee))))

  server.registerTool('get_task', {
    title: 'Detail tugas',
    description: 'Detail lengkap satu tugas Kanban, termasuk deskripsi dan hasilnya.',
    inputSchema: { id: z.string().describe('Id tugas, misalnya task-1730000000000-ab12') },
    annotations: { readOnlyHint: true },
  }, tool(async ({ id }: { id: string }) => backend.task(id)))

  server.registerTool('create_task', {
    title: 'Buat tugas',
    description: 'Tambahkan tugas baru ke papan Kanban dan tugaskan ke satu agen.',
    inputSchema: {
      title: z.string().min(1),
      description: z.string().default(''),
      assignee: agentId,
      priority: z.number().int().min(1).max(3).default(2).describe('1 rendah, 2 normal, 3 mendesak'),
    },
  }, tool(async (args: NewTask) => {
    await ensureAgent(backend, args.assignee)
    return backend.createTask(args)
  }))

  server.registerTool('update_task_status', {
    title: 'Ubah status tugas',
    description: 'Pindahkan tugas ke kolom lain di Kanban (todo, running, review, done).',
    inputSchema: { id: z.string(), status: z.enum(TASK_STATUSES) },
  }, tool(async ({ id, status }: { id: string; status: string }) => backend.updateTaskStatus(id, status)))

  server.registerTool('run_task', {
    title: 'Kerjakan tugas',
    description: 'Minta agen yang ditugaskan untuk mengerjakan tugas sekarang. Tugas pindah ke review setelah selesai, dan hasilnya dikembalikan.',
    inputSchema: { id: z.string() },
  }, tool(async ({ id }: { id: string }) => backend.runTask(id)))

  server.registerTool('start_meeting', {
    title: 'Mulai rapat',
    description: 'Panggil semua agen ke ruang rapat di kantor 3D dengan agenda tertentu.',
    inputSchema: { agenda: z.string().min(1) },
  }, tool(async ({ agenda }: { agenda: string }) => backend.meeting(true, agenda)))

  server.registerTool('end_meeting', {
    title: 'Akhiri rapat',
    description: 'Akhiri rapat dan kembalikan agen ke aktivitas masing-masing.',
    inputSchema: {},
  }, tool(async () => backend.meeting(false)))

  server.registerTool('add_agent_note', {
    title: 'Tambah memori agen',
    description: 'Simpan catatan ke memori jangka panjang agen. Catatan ini ikut dibaca di setiap chat berikutnya, cocok untuk memindahkan instruksi atau keputusan dari Project claude.ai.',
    inputSchema: { agent: agentId, note: z.string().min(1) },
  }, tool(async ({ agent, note }: { agent: string; note: string }) => {
    await ensureAgent(backend, agent)
    return backend.addNote(agent, note)
  }))

  server.registerTool('list_scheduled_jobs', {
    title: 'Jadwal rutin',
    description: 'Daftar jadwal rutin (cron) agen beserta waktu jalan berikutnya.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => backend.jobs()))

  return server
}
