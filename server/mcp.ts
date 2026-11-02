// MCP server for Claude Code: lets a local Claude session read and drive the AI Office.
// It talks to the running office server over its HTTP API, so the 3D office and the Kanban
// board stay in one place. Start the office first (npm run dev
// or npm start), then point the MCP client at `npm run mcp` (stdio).
//
// Settings (environment):
//   RUANG_URL          office address, default http://127.0.0.1:<RUANG_PORT or 3001>
//   RUANG_ACCESS_CODE  the access code, only needed when Settings → Access code is on
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createOfficeMcpServer, type BoardTask, type OfficeBackend } from './mcp-tools.js'

const BASE_URL = (process.env.RUANG_URL || `http://127.0.0.1:${Number(process.env.RUANG_PORT) || 3001}`).replace(/\/+$/, '')
const ACCESS_CODE = process.env.RUANG_ACCESS_CODE || ''

class OfficeError extends Error {}

let sessionCookie = ''

async function unlock(): Promise<boolean> {
  if (!ACCESS_CODE) return false
  const response = await fetch(`${BASE_URL}/api/access/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ruang-request': '1' },
    body: JSON.stringify({ code: ACCESS_CODE }),
  })
  if (!response.ok) return false
  sessionCookie = response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ')
  return true
}

async function call(path: string, init: { method?: string; body?: unknown } = {}, retried = false): Promise<Response> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(sessionCookie ? { cookie: sessionCookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new OfficeError(`AI Office tidak bisa dihubungi di ${BASE_URL}. Jalankan dulu "npm run dev" atau "npm start" di folder project.`)
  }
  if (response.status === 401 && !retried) {
    if (await unlock()) return call(path, init, true)
    throw new OfficeError('AI Office terkunci dengan access code. Isi RUANG_ACCESS_CODE di konfigurasi MCP.')
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: string }
    throw new OfficeError(detail.error || `AI Office menjawab HTTP ${response.status} untuk ${path}.`)
  }
  return response
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return (await call(path, init)).json() as Promise<T>
}

const httpBackend: OfficeBackend = {
  office: () => api('/api/office'),
  agents: () => api('/api/claude/agents'),
  tasks: async () => (await api<{ tasks: { data?: BoardTask[] } }>('/api/tasks')).tasks.data ?? [],
  task: (id) => api(`/api/tasks/${encodeURIComponent(id)}`),
  createTask: (task) => api('/api/tasks', { method: 'POST', body: task }),
  updateTaskStatus: (id, status) => api(`/api/tasks/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } }),
  runTask: (id) => api(`/api/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  meeting: (active, agenda) => api('/api/team/meeting', { method: 'POST', body: { active, agenda } }),
  addNote: (agent, note) => api(`/api/agents/${agent}/memory/notes`, { method: 'POST', body: { note } }),
  jobs: () => api('/api/calendar/jobs'),
}

await createOfficeMcpServer(httpBackend).connect(new StdioServerTransport())
console.error(`AI Office MCP server siap (office: ${BASE_URL})`)
