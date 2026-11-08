// The AI Office MCP tools, served over stdio by mcp.ts, which talks to the office over HTTP.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export const TASK_STATUSES = ['todo', 'running', 'review', 'done'] as const

export interface Station { id: string; name: string; role: string; state: string; currentTask?: string; activity?: string; room?: string }
export interface BoardTask { id: string; title: string; status: string; assignee?: string; priority?: number }
export interface NewTask { title: string; description: string; assignee: string; priority: number }
export interface OfficeAgent { id: string; name: string; role: string; department: string; description: string }

/** Where the tools read and change the office. */
export interface OfficeBackend {
  office(): Promise<{ stations: Station[]; summary: unknown }>
  agents(): Promise<OfficeAgent[]>
  tasks(): Promise<BoardTask[]>
  task(id: string): Promise<unknown>
  createTask(task: NewTask): Promise<unknown>
  updateTaskStatus(id: string, status: string): Promise<unknown>
  runTask(id: string): Promise<unknown>
  meeting(active: boolean, agenda?: string): Promise<unknown>
  addNote(agent: string, note: string): Promise<unknown>
  jobs(): Promise<unknown>
}

const agentId = z.string().min(1).describe('Id agen dari list_agents, misalnya "ceo" (orchestrator) atau "event-specialist"')

/** Runs a task without holding the MCP request open; the outcome is stored on the task. */
function startInBackground(backend: OfficeBackend, taskId: string): void {
  backend.runTask(taskId).catch((error: unknown) => console.error(`Task ${taskId} failed:`, error))
}

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
  }, tool(async () => (await backend.agents()).map(({ id, name, role, department, description }) => ({ id, name, role, department, description }))))

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
    description: 'Tambahkan tugas baru ke papan Kanban dan tugaskan ke satu agen. Dengan start_now, agen langsung mengerjakannya (terlihat bekerja di kantor); hasilnya nanti bisa dibaca dengan get_task.',
    inputSchema: {
      title: z.string().min(1),
      description: z.string().default(''),
      assignee: agentId,
      priority: z.number().int().min(1).max(3).default(2).describe('1 rendah, 2 normal, 3 mendesak'),
      start_now: z.boolean().default(false).describe('true agar agen langsung mulai mengerjakan tugas ini'),
    },
  }, tool(async ({ start_now, ...task }: NewTask & { start_now: boolean }) => {
    await ensureAgent(backend, task.assignee)
    const created = await backend.createTask(task) as { task?: { id: string } }
    if (!start_now || !created.task) return created
    startInBackground(backend, created.task.id)
    return { ...created, started: true, note: `Agen ${task.assignee} mulai mengerjakan. Cek hasilnya dengan get_task id ${created.task.id}.` }
  }))

  server.registerTool('update_task_status', {
    title: 'Ubah status tugas',
    description: 'Pindahkan tugas ke kolom lain di Kanban (todo, running, review, done).',
    inputSchema: { id: z.string(), status: z.enum(TASK_STATUSES) },
  }, tool(async ({ id, status }: { id: string; status: string }) => backend.updateTaskStatus(id, status)))

  server.registerTool('run_task', {
    title: 'Kerjakan tugas',
    description: 'Minta agen yang ditugaskan untuk mengerjakan tugas sekarang. Tugas pindah ke review setelah selesai, dan hasilnya tersimpan di tugas. Pakai wait=false untuk tugas panjang (koneksi remote memutus request setelah ±100 detik), lalu baca hasilnya dengan get_task.',
    inputSchema: { id: z.string(), wait: z.boolean().default(true).describe('false agar langsung kembali tanpa menunggu hasil') },
  }, tool(async ({ id, wait }: { id: string; wait: boolean }) => {
    if (wait) return backend.runTask(id)
    startInBackground(backend, id)
    return { started: true, note: `Agen mulai mengerjakan tugas ${id}. Cek hasilnya dengan get_task.` }
  }))

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
    description: 'Simpan catatan ke memori jangka panjang agen. Catatan ini ikut dibaca di setiap chat berikutnya.',
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
