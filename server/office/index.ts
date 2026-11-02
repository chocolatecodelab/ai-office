import type { Server } from 'node:http'
import express, { type Request, type Response, type Router } from 'express'
import { WebSocketServer } from 'ws'
import { createDb, migrate, type Db } from '../db/index.js'
import { integrationStatuses, mockDrive, type Integrations } from '../integrations/index.js'
import { agentContextFiles, findContextDir } from '../otca-context.js'
import { officeSettings, type OfficeSettings } from '../settings.js'
import { APPROVERS } from './approval-routes.js'
import { readBrands, syncBrands } from './brands.js'
import { OfficeBus, type OfficeChange } from './bus.js'
import { EVENT_STAGES, EventWorkflow } from './event-workflow.js'
import { createHermesClient, type HermesClient } from './hermes-client.js'
import { TaskQueue, redisConnection } from './queue.js'
import { TASK_STATUSES, type TaskStatus } from './status.js'
import { OfficeStore } from './store.js'

// The blueprint office API (/api/office): brands, tasks, approvals and the event workflow, backed by
// Postgres, the BullMQ queue and each brand's Hermes. It starts beside the older Ruang routes; when
// Postgres or Redis is not running the routes answer 503 with the reason instead of failing.

// No login until L4 (Google SSO + RBAC); every action is recorded under this actor meanwhile.
const LOCAL_ACTOR = 'pengguna-lokal'

export interface OfficeServices {
  db: Db
  store: OfficeStore
  events: EventWorkflow
  queue: TaskQueue
  bus: OfficeBus
  integrations: Integrations
}

export interface OfficeOptions { settings?: OfficeSettings; contextDir?: string; hermes?: HermesClient; startWorker?: boolean }

export async function startOffice(options: OfficeOptions = {}): Promise<OfficeServices> {
  const settings = options.settings ?? officeSettings()
  if (!settings.databaseUrl) throw new Error('Postgres belum dikonfigurasi (jalankan node scripts/setup-env.mjs dan docker compose).')
  const contextDir = options.contextDir ?? findContextDir()
  if (!contextDir) throw new Error('Folder context/ tidak ditemukan.')
  const db = createDb(settings.databaseUrl)
  await migrate(db)
  await syncBrands(db, readBrands(contextDir))
  const bus = new OfficeBus()
  const store = new OfficeStore(db, bus)
  const integrations: Integrations = { drive: mockDrive() }
  const brandNames = new Map((await store.brands()).map((brand) => [brand.id, brand.name]))
  const queue = new TaskQueue(redisConnection(settings.redisUrl), {
    store,
    hermes: options.hermes ?? createHermesClient(),
    endpoint: (brandId) => settings.hermes(brandId),
    contextDir,
    brandName: async (brandId) => brandNames.get(brandId) ?? brandId,
  })
  if (options.startWorker !== false) {
    queue.start()
    const recovered = await queue.recover(store)
    if (recovered) console.log(`Office: ${recovered} tugas dijadwalkan ulang setelah start.`)
  }
  return { db, store, events: new EventWorkflow(store, bus, integrations.drive), queue, bus, integrations }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** The /api/office routes. `services` resolves once the office has started (or rejects with why not). */
export function officeRouter(services: Promise<OfficeServices>): Router {
  const router = express.Router()
  let unavailable: string | undefined
  services.catch((error: unknown) => { unavailable = message(error) })

  const handle = (work: (office: OfficeServices, request: Request) => Promise<unknown>) => async (request: Request, response: Response) => {
    if (unavailable) { response.status(503).json({ error: `Office belum siap: ${unavailable}` }); return }
    try {
      response.json(await work(await services, request))
    } catch (error) {
      response.status(400).json({ error: message(error) })
    }
  }
  const brandOf = async (office: OfficeServices, request: Request) => {
    const brandId = String(request.params.brand)
    if (!(await office.store.brands()).some((brand) => brand.id === brandId)) throw new Error(`Brand ${brandId} tidak ada.`)
    return brandId
  }
  const body = (request: Request) => (request.body ?? {}) as Record<string, unknown>
  const text = (value: unknown) => typeof value === 'string' ? value : undefined

  router.get('/status', handle(async (office) => ({
    integrations: integrationStatuses(office.integrations),
    approvers: APPROVERS,
    stages: EVENT_STAGES.map(({ id, label, level, agentType, requires }) => ({ id, label, level, agentType, requires })),
  })))

  router.get('/brands', handle(async (office) => Promise.all((await office.store.brands()).map(async (brand) => {
    const [agents, summary] = await Promise.all([office.store.agents(brand.id), office.store.summary(brand.id)])
    return { ...brand, agents, summary }
  }))))

  router.get('/brands/:brand/tasks', handle(async (office, request) => {
    const status = text(request.query.status)
    if (status && !TASK_STATUSES.includes(status as TaskStatus)) throw new Error(`Status ${status} tidak dikenal.`)
    return office.store.tasks(await brandOf(office, request), { status: status as TaskStatus | undefined })
  }))

  const agentOf = async (office: OfficeServices, request: Request) => {
    const brand = await brandOf(office, request)
    const agent = String(request.params.agent)
    if (!(await office.store.agents(brand)).some(item => item.agentType === agent && item.active)) throw new Error('Agent tidak aktif di brand ini.')
    return { brand, agent }
  }
  router.get('/brands/:brand/agents/:agent/context', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    const dir = findContextDir()
    if (!dir) throw new Error('Konteks resmi belum tersedia.')
    return agentContextFiles(dir, agent, brand) ?? []
  }))
  router.post('/brands/:brand/agents/:agent/chat', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    const message = text(body(request).message)?.trim()
    if (!message || message.length > 12000) throw new Error('Pesan harus berisi 1–12000 karakter.')
    // Chat stays on the durable queue: quota, task status, audit and approval keep working.
    const task = await office.store.createTask(brand, { agentType: agent, kind: 'konten.chat', title: message.slice(0,100), brief: message, createdBy: LOCAL_ACTOR })
    await office.queue.enqueue(task)
    return task
  }))

  router.get('/brands/:brand/tasks/:id', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const task = await office.store.task(brandId, String(request.params.id))
    if (!task) throw new Error('Tugas tidak ditemukan.')
    const [assets, approvals, history] = await Promise.all([office.store.assets(brandId, task.id), office.store.approvals(brandId, { taskId: task.id }), office.store.taskEvents(brandId, task.id)])
    return { task, assets, approvals, history }
  }))

  router.post('/brands/:brand/tasks', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const input = body(request)
    const task = await office.store.createTask(brandId, {
      agentType: text(input.agentType) ?? '', kind: text(input.kind) ?? '', title: text(input.title)?.trim() || '',
      brief: text(input.brief), priority: typeof input.priority === 'number' ? input.priority : undefined,
      urgent: input.urgent === true, complex: input.complex === true, createdBy: LOCAL_ACTOR,
    })
    await office.queue.enqueue(task)
    return task
  }))

  router.post('/brands/:brand/tasks/:id/cancel', handle(async (office, request) =>
    office.store.transition(await brandOf(office, request), String(request.params.id), 'cancelled', { actor: LOCAL_ACTOR, reason: text(body(request).reason) ?? 'dibatalkan staf' })))

  router.post('/brands/:brand/tasks/:id/retry', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const task = await office.store.transition(brandId, String(request.params.id), 'queued', { actor: LOCAL_ACTOR, reason: 'dijalankan ulang staf', patch: { attempts: 0 } })
    await office.queue.enqueue(task)
    return task
  }))

  router.get('/brands/:brand/approvals', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const approvals = await office.store.approvals(brandId, { open: request.query.open === '1' })
    return Promise.all(approvals.map(async (approval) => ({ ...approval, approver: APPROVERS[approval.approvalType], qc: approval.decision===null ? await office.store.latestContentQc(brandId,approval.taskId) : undefined, task: await office.store.task(brandId, approval.taskId) })))
  }))

  router.post('/brands/:brand/approvals/:id', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const input = body(request)
    const decision = input.decision === 'approved' || input.decision === 'rejected' ? input.decision : undefined
    if (!decision) throw new Error('decision harus "approved" atau "rejected".')
    const result = await office.store.decide(brandId, String(request.params.id), { decision, note: text(input.note), actor: LOCAL_ACTOR })
    if (decision === 'approved') await office.events.onApproved(result.task)
    else await office.queue.enqueue(result.task)
    return result
  }))

  router.get('/brands/:brand/events', handle(async (office, request) => office.events.list(await brandOf(office, request))))

  router.post('/brands/:brand/events', handle(async (office, request) => {
    const input = body(request)
    return office.events.create(await brandOf(office, request), {
      title: text(input.title) ?? '', brief: text(input.brief), details: (input.details ?? {}) as Record<string, string>, createdBy: LOCAL_ACTOR,
    })
  }))

  router.get('/brands/:brand/events/:id', handle(async (office, request) => {
    const detail = await office.events.detail(await brandOf(office, request), String(request.params.id))
    if (!detail) throw new Error('Event tidak ditemukan.')
    return detail
  }))

  router.patch('/brands/:brand/events/:id', handle(async (office, request) =>
    office.events.updateDetails(await brandOf(office, request), String(request.params.id), (body(request).details ?? {}) as Record<string, string>, LOCAL_ACTOR)))

  router.post('/brands/:brand/events/:id/stages/:stage', handle(async (office, request) => {
    const task = await office.events.startStage(await brandOf(office, request), String(request.params.id), String(request.params.stage), LOCAL_ACTOR, { urgent: body(request).urgent === true })
    await office.queue.enqueue(task)
    return task
  }))

  router.patch('/brands/:brand/events/:id/questions/:question', handle(async (office, request) => {
    const input = body(request)
    const status = text(input.status)
    return office.events.answer(await brandOf(office, request), String(request.params.id), String(request.params.question), {
      answer: text(input.answer), speaker: text(input.speaker),
      status: status === 'belum_dikirim' || status === 'terkirim' || status === 'dijawab' ? status : undefined,
    })
  }))

  return router
}

/**
 * Live changes for the dashboard and the 3D office: a client connects to /api/office/ws?brand=<slug>
 * and receives only that brand's changes (FR-31, FR-63).
 */
export function attachOfficeSocket(server: Server, services: Promise<OfficeServices>): void {
  const sockets = new WebSocketServer({ server, path: '/api/office/ws' })
  sockets.on('connection', (socket, request) => {
    const brand = new URL(request.url ?? '', 'http://office').searchParams.get('brand')
    let unsubscribe: (() => void) | undefined
    services.then((office) => {
      unsubscribe = office.bus.subscribe((change: OfficeChange) => {
        if (change.brandId === brand && socket.readyState === socket.OPEN) socket.send(JSON.stringify(change))
      })
    }).catch(() => socket.close(1011, 'office belum siap'))
    socket.on('close', () => unsubscribe?.())
  })
}
