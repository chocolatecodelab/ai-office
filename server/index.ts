import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import { FolderError, listFolder, publicAgent, readFolderFile, type AgentFolder } from './folders.js'
import { installAccess } from './access.js'
import { redactDashboard, redactOffice, redactTasks, redactUsage } from './privacy.js'
import { installProfileLock, isHidden, type Privacy } from './profile-lock.js'
import { API_VERSION } from './api-version.js'
import { claudeService, CLAUDE_AGENTS } from './claude-service.js'
import { attachOfficeSocket, officeRouter, startOffice } from './office/index.js'
import { publicationMediaRouter } from './office/publication-media.js'

const HOST = '127.0.0.1'
const PORT = Number(process.env.RUANG_PORT ?? process.env.MISSION_CONTROL_PORT) || 3001
const distDirectory = [new URL('../dist', import.meta.url), new URL('../../dist', import.meta.url)].map((url) => fileURLToPath(url)).find((path) => existsSync(join(path, 'index.html'))) ?? fileURLToPath(new URL('../dist', import.meta.url))

const app = express()
app.disable('x-powered-by')
app.use(express.json())
app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store')
  next()
})

const startedAt = new Date().toISOString()
app.get('/api/health', (_request, response) => { response.json({ ok: true, apiVersion: API_VERSION, startedAt }) })

// Optional access code (off by default): locks every other /api route until it is entered.
installAccess(app)
// Optional profile lock (off by default): a PIN withholds the private data of chosen agents.
const privacyOf = installProfileLock(app)

// The routes of the retired Claude runtime read folders and write agent memory and tasks without a login,
// and the blueprint removes them (docs/PLAN.md, "Dihapus"). They answer 410 unless RUANG_LEGACY_API=1.
// The read-only snapshots the pages still poll (/api/dashboard, /api/runtime, ...) are not affected.
const LEGACY_PREFIXES = ['/api/claude', '/api/chat', '/api/team', '/api/calendar', '/api/tasks', '/api/memory', '/api/agents', '/api/folders']
const LEGACY_SNAPSHOTS = new Set(['/api/calendar', '/api/tasks'])
app.use((request, response, next) => {
  const legacy = LEGACY_PREFIXES.some((prefix) => request.path === prefix || request.path.startsWith(`${prefix}/`))
  if (!legacy || process.env.RUANG_LEGACY_API === '1' || (request.method === 'GET' && LEGACY_SNAPSHOTS.has(request.path))) { next(); return }
  response.status(410).json({ error: 'Rute runtime Claude lama dimatikan. Pakai /api/office, atau setel RUANG_LEGACY_API=1 sementara.' })
})

// Claude AI Configuration & Chat Routes
app.get('/api/claude/config', (_request, response) => {
  response.json(claudeService.getConfig())
})

app.post('/api/claude/config', (request, response) => {
  // Anthropic keys live in infra/env/litellm.env and LiteLLM only (blueprint 6.1), never in this store.
  if (request.body?.apiKey) {
    response.status(400).json({ success: false, error: 'Kunci API tidak disimpan di Ruang. Isi di infra/env/litellm.env dan jalankan ulang LiteLLM.' })
    return
  }
  const result = claudeService.setConfig(request.body || {})
  response.json(result)
})

app.get('/api/claude/agents', (_request, response) => {
  response.json(claudeService.getAgents())
})

app.get('/api/chat/:agentId/history', (request, response) => {
  response.json({
    agentId: request.params.agentId,
    messages: claudeService.getHistory(String(request.params.agentId))
  })
})

app.delete('/api/chat/:agentId/history', (request, response) => {
  claudeService.clearHistory(String(request.params.agentId))
  response.json({ ok: true })
})

app.post('/api/chat/:agentId/import', (request, response) => {
  const messages = Array.isArray(request.body?.messages) ? request.body.messages : []
  const result = claudeService.importHistory(String(request.params.agentId), messages)
  response.json(result)
})

app.post('/api/chat/:agentId/sync-project', (request, response) => {
  const result = claudeService.syncProject(String(request.params.agentId))
  response.json(result)
})

app.post('/api/team/meeting', (request, response) => {
  const { active, agenda } = request.body || {}
  claudeService.setMeeting(Boolean(active), String(agenda || ''))
  response.json({ ok: true, active: Boolean(active) })
})

// Real-time Chat with SSE Streaming
app.post('/api/chat', async (request, response) => {
  const { agentId, message } = request.body || {}
  if (!agentId || !message) {
    response.status(400).json({ error: 'agentId dan message harus disertakan.' })
    return
  }

  response.setHeader('Content-Type', 'text/event-stream')
  response.setHeader('Cache-Control', 'no-cache, no-transform')
  response.setHeader('Connection', 'keep-alive')
  if (typeof response.flushHeaders === 'function') response.flushHeaders()

  try {
    const result = await claudeService.sendMessage(String(agentId), String(message), (chunk) => {
      response.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`)
    })
    response.write(`data: ${JSON.stringify({ type: 'done', response: result.response, toolResults: result.toolResults })}\n\n`)
    response.end()
  } catch (error) {
    response.write(`data: ${JSON.stringify({ type: 'error', error: (error instanceof Error && error.message) || 'Gagal memproses pesan ke Claude.' })}\n\n`)
    response.end()
  }
})

// Claude Scheduled Tasks & Cron Routes
app.get('/api/calendar/jobs', (_request, response) => {
  response.json(claudeService.getScheduledJobs())
})

app.post('/api/calendar/jobs', (request, response) => {
  const result = claudeService.addScheduledJob(request.body || {})
  response.json(result)
})

app.post('/api/calendar/jobs/:id/toggle', (request, response) => {
  const result = claudeService.toggleScheduledJob(String(request.params.id))
  response.json(result)
})

app.delete('/api/calendar/jobs/:id', (request, response) => {
  const result = claudeService.deleteScheduledJob(String(request.params.id))
  response.json(result)
})

app.post('/api/calendar/jobs/:id/run', async (request, response) => {
  const result = await claudeService.runScheduledJobNow(String(request.params.id))
  response.json(result)
})

// Snapshot routes powered by Claude Service
const routes: Record<string, (_now: number, privacy: Privacy) => Promise<unknown> | unknown> = {
  '/api/runtime': () => claudeService.getRuntimeSnapshot(),
  '/api/dashboard': async (_now, privacy) => redactDashboard(claudeService.getDashboardSnapshot(), privacy),
  '/api/tasks': async (_now, privacy) => redactTasks(claudeService.getTaskBoardSnapshot(), privacy),
  '/api/calendar': async () => claudeService.getCalendarSnapshot(),
  '/api/activity': async () => ({ sessions: { availability: 'available', data: [] }, fetchedAt: new Date().toISOString() }),
  '/api/knowledge': () => ({ skills: { availability: 'available', data: [] }, fetchedAt: new Date().toISOString() }),
  '/api/office': async (_now, privacy) => redactOffice(claudeService.getOfficeSnapshot(), privacy),
  '/api/channels': () => ({ channels: { availability: 'available', data: [{ name: 'Claude Anthropic API', status: 'Connected' }] }, activeSessions: 1, fetchedAt: new Date().toISOString() }),
  '/api/logs': async () => ({ files: [{ name: 'claude', label: 'Claude Office Log', source: { availability: 'available', data: [{ text: 'Claude AI Office initialized.', level: 'INFO' }] } }], fetchedAt: new Date().toISOString() }),
  '/api/command-log': () => ({ entries: [{ command: 'claude-service', ok: true, durationMs: 2, at: new Date().toISOString() }], health: { total: 1, failed: 0, averageMs: 2 }, fetchedAt: new Date().toISOString() }),
}

for (const [path, handler] of Object.entries(routes)) {
  app.get(path, async (request, response) => {
    const now = Date.now()
    response.json(await handler(now, await privacyOf(request)))
  })
}

const locked = (response: Response, agent: string) => response.status(423).json({ error: `🔒 ${agent} is locked. Enter the PIN to see it.`, locked: 'profile', agent })

app.get('/api/usage', async (request, response) => {
  response.json(redactUsage(claudeService.getUsageSnapshot(), await privacyOf(request)))
})

app.get('/api/tasks/:id', async (request, response) => {
  const detail = claudeService.getTaskDetail(String(request.params.id))
  if (!detail) { response.status(404).json({ error: 'Unknown task.' }); return }
  const assignee = detail.task.data?.assignee
  const privacy = await privacyOf(request)
  if (isHidden(privacy, assignee)) { locked(response, assignee!); return }
  response.json(detail)
})

app.post('/api/tasks', (request, response) => {
  const result = claudeService.addTask(request.body || {})
  response.json(result)
})

app.post('/api/tasks/:id/status', (request, response) => {
  const { status } = request.body || {}
  const result = claudeService.updateTaskStatus(String(request.params.id), String(status || 'todo'))
  response.json(result)
})

app.delete('/api/tasks/:id', (request, response) => {
  const result = claudeService.deleteTask(String(request.params.id))
  response.json(result)
})

app.post('/api/tasks/:id/run', async (request, response) => {
  const result = await claudeService.runTaskNow(String(request.params.id))
  response.json(result)
})

// Folders & Memory for Claude Profiles
async function agentFolders(): Promise<AgentFolder[]> {
  return CLAUDE_AGENTS.map((agent) => {
    const ws = claudeService.getAgentWorkspace(agent.id)
    return {
      profile: agent.id,
      label: agent.name,
      available: true,
      path: ws,
      directory: ws
    }
  })
}

async function openFolder(profile: string) {
  const folders = await agentFolders()
  const folder = folders.find((item) => item.profile === profile)
  if (!folder) throw new FolderError('Unknown agent.', 404)
  return { folder, excluded: [] }
}

function folderRoute(handler: (request: Request) => Promise<unknown>) {
  return async (request: Request, response: Response) => {
    try {
      response.json(await handler(request))
    } catch (error) {
      if (error instanceof FolderError) { response.status(error.status).json({ error: error.message }); return }
      throw error
    }
  }
}

app.get('/api/memory', folderRoute(async () => {
  return {
    agents: CLAUDE_AGENTS.map((agent) => {
      const mem = claudeService.getAgentMemory(agent.id)
      const allNotes = mem.notes || []
      const notesContent = allNotes.join('\n\n')
      return {
        profile: agent.id,
        label: agent.name,
        path: mem.workspacePath,
        kind: 'claude' as const,
        available: true,
        workspacePath: mem.workspacePath,
        soul: {
          name: 'IDENTITY.md',
          path: `${mem.workspacePath}/IDENTITY.md`,
          exists: true,
          size: agent.systemPrompt.length,
          content: agent.systemPrompt,
          chars: agent.systemPrompt.length
        },
        memory: {
          name: 'MEMORY.md',
          path: `${mem.workspacePath}/MEMORY.md`,
          exists: true,
          size: notesContent.length,
          content: notesContent,
          entries: allNotes,
          limit: 10000,
          used: notesContent.length,
          percent: Math.min(100, Math.round((notesContent.length / 10000) * 100))
        },
        claudeRules: {
          name: 'CLAUDE.md',
          path: `${mem.workspacePath}/CLAUDE.md`,
          exists: true,
          size: (mem.claudeRules || '').length,
          content: mem.claudeRules || '',
          chars: (mem.claudeRules || '').length
        },
        notes: allNotes,
        contextFiles: (mem.contextFiles || []).map((cf) => ({
          name: cf.name,
          path: cf.path,
          exists: true,
          size: cf.size,
          chars: cf.content?.length || 0,
          content: cf.content
        }))
      }
    }),
    fetchedAt: new Date().toISOString()
  }
}))

// Workspace & Memory Mutation Endpoints
app.get('/api/agents/:agentId/workspace', (request, response) => {
  const agentId = String(request.params.agentId)
  const workspacePath = claudeService.getAgentWorkspace(agentId)
  const files = claudeService.scanWorkspaceFiles(agentId)
  response.json({ workspacePath, files })
})

app.post('/api/agents/:agentId/workspace', (request, response) => {
  const agentId = String(request.params.agentId)
  const { path } = request.body || {}
  const result = claudeService.setAgentWorkspace(agentId, String(path || ''))
  response.json(result)
})

app.post('/api/agents/:agentId/memory/rules', (request, response) => {
  const agentId = String(request.params.agentId)
  const { rules } = request.body || {}
  const result = claudeService.updateAgentRules(agentId, String(rules || ''))
  response.json(result)
})

app.post('/api/agents/:agentId/memory/notes', (request, response) => {
  const agentId = String(request.params.agentId)
  const { note } = request.body || {}
  const result = claudeService.addAgentNote(agentId, String(note || ''))
  response.json(result)
})

app.delete('/api/agents/:agentId/memory/notes/:index', (request, response) => {
  const agentId = String(request.params.agentId)
  const index = parseInt(request.params.index, 10)
  const result = claudeService.removeAgentNote(agentId, index)
  response.json(result)
})

app.post('/api/agents/:agentId/memory/context-files', (request, response) => {
  const agentId = String(request.params.agentId)
  const { filePath, content } = request.body || {}
  const result = claudeService.addContextFile(agentId, String(filePath || ''), content)
  response.json(result)
})

app.delete('/api/agents/:agentId/memory/context-files', (request, response) => {
  const agentId = String(request.params.agentId)
  const { filePath } = request.body || {}
  const result = claudeService.removeContextFile(agentId, String(filePath || ''))
  response.json(result)
})

app.get('/api/folders', folderRoute(async () => ({ agents: (await agentFolders()).map(publicAgent), fetchedAt: new Date().toISOString() })))

async function guardFolder(request: Request) {
  const profile = String(request.params.profile)
  if (isHidden(await privacyOf(request), profile)) throw new FolderError(`🔒 ${profile} is locked. Enter the PIN to see it.`, 423)
  return openFolder(profile)
}

app.get('/api/folders/:profile/list', folderRoute(async (request) => {
  const { folder, excluded } = await guardFolder(request)
  return listFolder(folder, request.query.path, excluded)
}))

app.get('/api/folders/:profile/file', folderRoute(async (request) => {
  const { folder, excluded } = await guardFolder(request)
  return readFolderFile(folder, request.query.path, excluded)
}))

// Blueprint office API (docs/PLAN.md L1): Postgres + queue + Hermes. Starts in the background; its
// routes answer 503 with the reason while Postgres or Redis is not running.
const office = startOffice()
office.catch((error: unknown) => console.error('Office API tidak aktif:', error instanceof Error ? error.message : error))
app.use('/api/office', officeRouter(office))
app.use('/publication-media',publicationMediaRouter(office))

app.use('/api', (_request, response) => { response.status(404).json({ error: 'Not found' }) })

if (existsSync(distDirectory)) {
  app.use(express.static(distDirectory))
  app.get(/^(?!\/api\/).*/, (_request, response) => { response.sendFile('index.html', { root: distDirectory }) })
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  void _next
  console.error('Ruang request failed:', error instanceof Error ? error.message : error)
  response.status(500).json({ error: 'Internal error' })
})

const server = app.listen(PORT, HOST, () => console.log(`Claude AI Office listening on http://${HOST}:${PORT}${existsSync(distDirectory) ? ' (serving built UI)' : ' (API only; run the Vite dev server for the UI)'}`))

attachOfficeSocket(server, office)
