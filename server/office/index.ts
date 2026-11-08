import { LOCAL_FAQ, mockComments, previewComments } from './social-community.js'
import { backfillProductionVersions } from './production-projects.js'
import { planSocialPost, recordSocialPublication } from './social-schedule.js'
import { ApprovedLibrary } from './approved-library.js'
import { MetaPublisher } from './meta-publisher.js'
import { metaConfiguration } from '../integrations/meta-publishing.js'
import { VideoAttachments } from './video-attachments.js'
import { evaluateQuality, validateEvaluationIds } from './quality-evaluation.js'
import type { Server } from 'node:http'
import express, { type Request, type Response, type Router } from 'express'
import { WebSocketServer } from 'ws'
import { createDb, migrate, type Db } from '../db/index.js'
import { SERVICES, connectionState, credentialValue, effectiveMode, isMode } from '../integrations/catalog.js'
import { encryptionKey } from '../integrations/crypto.js'
import { Connections, OAuthFailure } from '../integrations/connections.js'
import { routedDrive } from '../integrations/drive.js'
import { integrationStatuses, type Integrations } from '../integrations/index.js'
import { agentContextFiles, findContextDir } from '../otca-context.js'
import { officeSettings, type OfficeSettings } from '../settings.js'
import { APPROVERS } from './approval-routes.js'
import { readBrands, syncBrands } from './brands.js'
import { OfficeBus, type OfficeChange } from './bus.js'
import { EVENT_STAGES, EventWorkflow } from './event-workflow.js'
import { parseEventDate } from './event-date.js'
import { validateNote } from './agent-notes.js'
import { updateContext } from './context-editor.js'
import { cancelWorkflow,orchestrationState } from './orchestration.js'
import { buildPreview } from './asset-preview.js'
import { extractArtifacts } from './artifacts.js'
import { localFileStore } from './file-store.js'
import { systemHealth } from './health.js'
import { langfuseUsage } from './langfuse-usage.js'
import { CLAUDE_ALIASES, CODEX_MODELS, WEIGHTS, routesFor, validateRoute, type EngineProfile, type RouteOverrides, type Weight } from './model-routes.js'
import { poolStatuses } from './pools.js'
import { createHermesClient, type HermesClient } from './hermes-client.js'
import { TaskQueue, redisConnection } from './queue.js'
import { TASK_STATUSES, type TaskStatus } from './status.js'
import { OfficeStore } from './store.js'
import { ChatWorkspace } from './chat-workspace.js'
import { installChatRoutes } from './chat-routes.js'
import { ProductionEngines } from './production-engines.js'
import { installProductionRoutes } from './production-routes.js'
import { approvalReview, reviewSummary } from './approval-review.js'

// The blueprint office API (/api/office): brands, tasks, approvals and the event workflow, backed by
// Postgres, the BullMQ queue and each brand's Hermes. It starts beside the older Ruang routes; when
// Postgres or Redis is not running the routes answer 503 with the reason instead of failing.

// No login until L4 (Google SSO + RBAC); every action is recorded under this actor meanwhile.
const LOCAL_ACTOR = 'pengguna-lokal'

// Roles of blueprint FR-23. They are shown in Settings only; nothing enforces them before L4.
const OFFICE_ROLES = [
  { id: 'super-admin', label: 'Super Admin', note: 'Tidak dapat mengaktifkan iklan.' },
  { id: 'brand-manager', label: 'Brand Manager' },
  { id: 'approver-konten', label: 'Approver konten' },
  { id: 'approver-iklan', label: 'Approver iklan' },
  { id: 'approver-event', label: 'Approver event' },
  { id: 'budget-approver', label: 'Budget Approver', note: 'Satu-satunya peran yang dapat mengaktifkan iklan (FR-24).' },
  { id: 'operator', label: 'Operator' },
  { id: 'viewer', label: 'Viewer' },
]

export interface OfficeServices {
  production?: ProductionEngines
  chat?: ChatWorkspace
  contextDir?: string
  db: Db
  store: OfficeStore
  events: EventWorkflow
  queue: TaskQueue
  bus: OfficeBus
  integrations: Integrations
  connections: Connections
  library: ApprovedLibrary
  publisher: MetaPublisher
  videoAttachments: VideoAttachments
  drive: ReturnType<typeof routedDrive>
  settings?: OfficeSettings
  hermes?: HermesClient
}

export interface OfficeOptions { settings?: OfficeSettings; contextDir?: string; hermes?: HermesClient; startWorker?: boolean; fetcher?: typeof fetch }

export async function startOffice(options: OfficeOptions = {}): Promise<OfficeServices> {
  const settings = options.settings ?? officeSettings()
  if (!settings.databaseUrl) throw new Error('Postgres belum dikonfigurasi (jalankan node scripts/setup-env.mjs dan docker compose).')
  const contextDir = options.contextDir ?? findContextDir()
  if (!contextDir) throw new Error('Folder context/ tidak ditemukan.')
  const db = createDb(settings.databaseUrl)
  await migrate(db)
  await syncBrands(db, readBrands(contextDir))
  const bus = new OfficeBus()
  const store = new OfficeStore(db, bus, localFileStore(settings.filesDir))
  await backfillProductionVersions(store)
  const chat=new ChatWorkspace(store)
  const production=new ProductionEngines(settings.production??{workDir:settings.filesDir+'/production'})
  const connections = new Connections({ store, envDir: settings.envDir, fetcher: options.fetcher })
  const drive = routedDrive(store, connections, options.fetcher)
  const library = new ApprovedLibrary(store, connections, options.fetcher)
  const publisher = new MetaPublisher(store, settings.envDir, options.fetcher)
  const videoAttachments = new VideoAttachments(store, settings.filesDir+'/video-inputs')
  await drive.refresh()
  const integrations: Integrations = { drive }
  const brandNames = new Map((await store.brands()).map((brand) => [brand.id, brand.name]))
  const hermes = options.hermes ?? createHermesClient()
  const queue = new TaskQueue(redisConnection(settings.redisUrl), {
    store,
    chat,
    production,
    videoAttachments,
    hermes,
    endpoint: (brandId) => settings.hermes(brandId),
    contextDir,
    brandName: async (brandId) => brandNames.get(brandId) ?? brandId,
    profile: settings.engineProfile,
  }, library, publisher)
  if (options.startWorker !== false) {
    queue.start()
    const recovered = await queue.recover(store)
    if (recovered) console.log(`Office: ${recovered} tugas dijadwalkan ulang setelah start.`)
  }
  return { db, store, events: new EventWorkflow(store, bus, integrations.drive), queue, bus, integrations, connections, drive, library, publisher, videoAttachments,settings, hermes, contextDir, chat, production }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** The /api/office routes. `services` resolves once the office has started (or rejects with why not). */
export function officeRouter(services: Promise<OfficeServices>): Router {
  const router = express.Router()
  installChatRoutes(router,services)
  installProductionRoutes(router,services)
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

  router.get('/brands/:brand/approved-library',handle(async(office,request)=>{
    const brand=await brandOf(office,request)
    return {
      folderId:(await office.db.query('SELECT folder_id FROM brand_drive_libraries WHERE brand_id=$1',[brand])).rows[0]?.folder_id??null,
      packages:(await office.db.query('SELECT id,source_task_id,smm_task_id,drive_status,drive_error,drive_folder_id,drive_location,approved_at FROM approved_packages WHERE brand_id=$1 ORDER BY approved_at DESC',[brand])).rows,
    }
  }))
  router.put('/brands/:brand/approved-library',handle(async(office,request)=>office.library.configure(await brandOf(office,request),text(body(request).folderId)??'')))
  router.post('/brands/:brand/tasks/:id/sync-library',handle(async(office,request)=>{
    await office.library.sync(await brandOf(office,request),String(request.params.id))
    return {synced:true}
  }))
  router.post('/brands/:brand/tasks/:id/prepare-publication',handle(async(office,request)=>{
    const brand=await brandOf(office,request),taskId=String(request.params.id)
    const task=await office.store.prepareApprovedPublication(brand,taskId,LOCAL_ACTOR)
    await office.queue.enqueue(task)
    await office.queue.syncLibrary(brand,taskId)
    return task
  }))

  router.get('/status', handle(async (office) => ({
    integrations: integrationStatuses(office.integrations),
    approvers: APPROVERS,
    stages: EVENT_STAGES.map(({ id, label, level, agentType, requires }) => ({ id, label, level, agentType, requires })),
  })))

  // Usage of the whole office: token runs from Postgres, and Langfuse's view of the same model calls.
  router.get('/usage', handle(async (office, request) => {
    const requested = Number(request.query.days)
    const days = [1, 7, 30].includes(requested) ? requested : 7
    const [local, langfuse] = await Promise.all([office.store.usage(days), langfuseUsage(office.settings?.langfuse, days)])
    return { days, ...local, langfuse }
  }))

  // Recent tasks of every brand for the Task Board. Each read is scoped to one brand (FR-31).
  router.get('/tasks', handle(async (office) => {
    const brands = await office.store.brands()
    const lists = await Promise.all(brands.map(async (brand) => (await office.store.tasks(brand.id, { limit: 60 })).map((task) => ({ ...task, brandName: brand.name }))))
    return lists.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }))

  // The latest audit entries and status changes of every brand, for the Activity page. Each read is scoped to one brand (FR-31).
  router.get('/activity', handle(async (office) => {
    const brands = await office.store.brands()
    const lists = await Promise.all(brands.map(async (brand) => (await office.store.activity(brand.id, 40)).map((entry) => ({ ...entry, brandName: brand.name }))))
    return lists.flat().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150)
  }))

  // Is each service answering? For the Logs page.
  router.get('/health', handle(async (office) => {
    const brands = await office.store.brands()
    return systemHealth({
      db: office.db, redisUrl: office.settings?.redisUrl ?? 'redis://127.0.0.1:16379', litellmUrl: office.settings?.litellmUrl ?? 'http://127.0.0.1:14000',
      gateways: brands.map((brand) => ({ brandName: brand.name, url: office.settings?.hermes(brand.id)?.url })),
    })
  }))

  // Saved results of every brand for the Folders page (each read is scoped to one brand), and one result's content.
  router.get('/assets', handle(async (office) => {
    const brands = await office.store.brands()
    const lists = await Promise.all(brands.map(async (brand) => (await office.store.assetList(brand.id, 200)).map((item) => ({ ...item, brandId: brand.id, brandName: brand.name }))))
    return { assets: lists.flat(), drive: integrationStatuses(office.integrations).find((item) => item.service === 'drive') }
  }))
  // The bytes of a stored file, always as an attachment of its own type and never sniffed or run in the page.
  router.get('/brands/:brand/assets/:id/file', async (request: Request, response: Response) => {
    if (unavailable) { response.status(503).json({ error: `Office belum siap: ${unavailable}` }); return }
    try {
      const office = await services
      const file = await office.store.assetFile(await brandOf(office, request), String(request.params.id))
      if (!file) { response.status(404).json({ error: 'Berkas tidak ditemukan.' }); return }
      response.set({
        'Content-Type': file.mime,
        'Content-Disposition': `${request.query.inline==='1'&&['image/png','video/mp4','video/webm','video/quicktime','video/ogg','video/x-m4v','text/vtt'].includes(file.mime)?'inline':'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      })
      if(file.mime.startsWith('video/')){
        response.set('Accept-Ranges','bytes')
        if(request.headers.range){
          const ranges=request.range(file.data.length,{combine:true})
          if(ranges===-1){response.status(416).set('Content-Range',`bytes */${file.data.length}`).end();return}
          if(Array.isArray(ranges)&&ranges.type==='bytes'&&ranges.length===1){
            const {start,end}=ranges[0]
            response.status(206).set({'Content-Range':`bytes ${start}-${end}/${file.data.length}`,'Content-Length':String(end-start+1)}).send(file.data.subarray(start,end+1));return
          }
        }
      }
      response.send(file.data)
    } catch (error) {
      response.status(400).json({ error: message(error) })
    }
  })
  // A saved result laid out for the Folders preview (asset-preview.ts); the page is shown in a sandboxed frame.
  router.get('/brands/:brand/assets/:id/preview', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const asset = await office.store.asset(brandId, String(request.params.id))
    if (!asset) throw new Error('Hasil tidak ditemukan.')
    const brand = (await office.store.brands()).find((item) => item.id === brandId)!
    return buildPreview({ name: asset.name, kind: asset.kind, title: asset.title, content: asset.content }, brand)
  }))
  router.post('/brands/:brand/assets/:id/rerender', handle(async (office, request) =>
    office.store.rerenderPdf(await brandOf(office, request), String(request.params.id), LOCAL_ACTOR)))
  router.get('/brands/:brand/assets/:id', handle(async (office, request) => {
    const asset = await office.store.asset(await brandOf(office, request), String(request.params.id))
    if (!asset) throw new Error('Hasil tidak ditemukan.')
    return asset
  }))

  // The model each agent uses for simple, complex and urgent work under the active engine profile.
  // Staff can change a role's model per weight (Codex model and reasoning in dev, Claude pools too in prod); the
  // profile table is the default and a reset puts it back. Every change is audited.
  const agentTypes = async (office: OfficeServices) => {
    const brands = await office.store.brands()
    return [...new Set((await Promise.all(brands.map((brand) => office.store.agents(brand.id)))).flat().map((agent) => agent.agentType))]
  }
  const modelEntry = (agentType: string, profile: EngineProfile, overrides: Map<string, RouteOverrides>) => {
    const own = overrides.get(agentType) ?? {}
    const effective = routesFor(agentType, profile, own)
    return { agentType, ...effective, defaults: routesFor(agentType, profile), overridden: WEIGHTS.filter((weight) => own[weight] && effective[weight] === own[weight]) }
  }
  const modelWeight = (request: Request): Weight => {
    const weight = String(request.params.weight)
    if (!(WEIGHTS as readonly string[]).includes(weight)) throw new Error('Bobot harus simple, complex, atau urgent.')
    return weight as Weight
  }
  router.get('/models', handle(async (office) => {
    const profile = office.settings?.engineProfile ?? 'dev'
    const overrides = await office.store.routeOverrides()
    return { profile, codexModels: CODEX_MODELS, claudeAliases: profile === 'prod' ? CLAUDE_ALIASES : [], agents: (await agentTypes(office)).map((agentType) => modelEntry(agentType, profile, overrides)) }
  }))
  router.put('/models/:agent/:weight', handle(async (office, request) => {
    const profile = office.settings?.engineProfile ?? 'dev'
    const agentType = String(request.params.agent)
    if (!(await agentTypes(office)).includes(agentType)) throw new Error(`Agent ${agentType} tidak dikenal.`)
    await office.store.setRoute(agentType, modelWeight(request), validateRoute(body(request), profile), LOCAL_ACTOR)
    return modelEntry(agentType, profile, await office.store.routeOverrides())
  }))
  router.delete('/models/:agent/:weight', handle(async (office, request) => {
    const profile = office.settings?.engineProfile ?? 'dev'
    const agentType = String(request.params.agent)
    await office.store.clearRoute(agentType, modelWeight(request), LOCAL_ACTOR)
    return modelEntry(agentType, profile, await office.store.routeOverrides())
  }))
  // A tiny run on the first brand's Hermes with the model asked for, to see whether it works before it is saved.
  router.post('/models/test', handle(async (office, request) => {
    const route = validateRoute(body(request), office.settings?.engineProfile ?? 'dev')
    const brand = (await office.store.brands()).find((item) => office.settings?.hermes(item.id))
    const endpoint = brand ? office.settings?.hermes(brand.id) : undefined
    if (!office.hermes || !endpoint) throw new Error('Belum ada Hermes yang terhubung untuk menguji model.')
    const started = Date.now()
    try {
      const result = await office.hermes.run(endpoint, { input: 'Balas satu kata: OK', instructions: 'Jawab sangat singkat.', sessionId: `model-test-${started}`, model: route.model, provider: route.provider, reasoningEffort: 'low' }, `model-test-${started}`)
      return { ok: result.status === 'completed' && Boolean(result.output.trim()), status: result.status, reply: result.output.trim().slice(0, 80), inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: Date.now() - started }
    } catch (error) {
      return { ok: false, status: 'failed', reply: message(error).slice(0, 200), inputTokens: 0, outputTokens: 0, durationMs: Date.now() - started }
    }
  }))

  // Events of every brand with their date read from the free text, for the Calendar. Dates that cannot be read are sent without one.
  router.get('/calendar', handle(async (office) => {
    const brands = await office.store.brands()
    const lists = await Promise.all(brands.map(async (brand) => (await office.events.list(brand.id)).map((event) => ({
      id: event.id, brandId: brand.id, brandName: brand.name, title: event.title, tanggal: event.details.tanggal ?? null, ...parseEventDate(event.details.tanggal),
    }))))
    return { entries: lists.flat(), googleCalendar: integrationStatuses(office.integrations).find((item) => item.service === 'google-calendar') }
  }))

  // Read-only view of the office's setup for the Settings page. Keys and tokens never leave the server.
  router.get('/settings', handle(async (office) => {
    const [usage, brands] = await Promise.all([office.store.usage(30), office.store.brands()])
    return {
      access: { actor: LOCAL_ACTOR, sso: false, note: 'Login Google SSO dan RBAC aktif di L4. Sampai itu semua aksi tercatat sebagai pengguna-lokal.' },
      roles: OFFICE_ROLES,
      integrations: integrationStatuses(office.integrations),
      pools: poolStatuses(usage.models),
      gateways: brands.map((brand) => ({ brandId: brand.id, name: brand.name, configured: Boolean(office.settings?.hermes(brand.id)) })),
      langfuse: { configured: Boolean(office.settings?.langfuse) },
    }
  }))

  // Connection status of every outside service and what each brand asked for. Only whether credentials exist and which
  // account is connected is reported, never a secret; keys are filled in infra/env/ and re-read on every call.
  const publicBase = (request: Request) => {
    const configured = process.env.RUANG_PUBLIC_URL?.trim().replace(/\/+$/, '')
    if (configured) return configured
    const host = request.get('host') ?? ''
    if (/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return `${request.protocol}://${host}`
    throw new Error('Setel RUANG_PUBLIC_URL di infra/env/integrations.env: alamat publik Ruang untuk callback OAuth.')
  }
  const CALLBACK = '/api/office/oauth/google/callback'
  const serviceOf = (name: unknown) => {
    const def = SERVICES.find((item) => item.service === name)
    if (!def) throw new Error('Layanan tidak dikenal.')
    return def
  }
  router.get('/integrations', handle(async (office, request) => {
    const [brands, modes, connected] = await Promise.all([office.store.brands(), office.store.integrationModes(), office.store.connections()])
    let redirectUri: string | undefined
    try { redirectUri = `${publicBase(request)}${CALLBACK}` } catch { /* the page shows the hint instead */ }
    let encryptionReady = true
    try { encryptionKey(credentialValue(SERVICES[0], 'INTEGRATIONS_ENCRYPTION_KEY', process.env, office.settings?.envDir)) } catch { encryptionReady = false }
    return {
      brands: brands.map((brand) => ({ id: brand.id, name: brand.name })),
      redirectUri, encryptionReady,
      services: SERVICES.map((def) => {
        const { connected: appReady, missing } = connectionState(def, process.env, office.settings?.envDir)
        return {
          service: def.service, label: def.label, purpose: def.purpose, level: def.level, auth: def.auth, vars: def.vars, file: def.file, howTo: def.howTo,
          adapterReady: def.adapterReady, connected: appReady, missing, oneClick: Boolean(def.oauth), perBrand:def.service==='meta-graph',modeOptions: def.modes ?? ['mock', 'sandbox', 'live'],
          modes: Object.fromEntries(brands.map((brand) => {
            const requested = modes.get(brand.id)?.get(def.service) ?? 'mock'
            const account = connected.find((item) => item.brandId === brand.id && item.service === def.service)
            const meta=def.service==='meta-graph'?metaConfiguration(brand.id,'facebook',office.settings?.envDir):undefined
            const ready = meta ? meta.ready : def.oauth ? account?.status === 'active' : appReady
            return [brand.id, { requested, ready,effective: effectiveMode(requested, ready, def.adapterReady),missing:meta?[...meta.missing,...meta.problems]:undefined,account: account ? { email: account.account, status: account.status, connectedAt: account.connectedAt } : undefined }]
          })),
        }
      }),
    }
  }))
  router.put('/brands/:brand/integrations/:service', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    const def = serviceOf(request.params.service)
    const mode = body(request).mode
    if (!isMode(mode) || !(def.modes ?? ['mock', 'sandbox', 'live']).includes(mode)) throw new Error(`Mode ${String(mode)} tidak tersedia untuk ${def.label}.`)
    if (mode !== 'mock') {
      if(def.service==='meta-graph'){
        const configured=metaConfiguration(brand,'facebook',office.settings?.envDir)
        if(!configured.ready)throw new Error(`Konfigurasi Meta brand belum lengkap: ${[...configured.missing,...configured.problems].join(', ')}`)
      }
      else {
      const account = (await office.store.connections()).find((item) => item.brandId === brand && item.service === def.service)
      if (def.oauth ? account?.status !== 'active' : !connectionState(def, process.env, office.settings?.envDir).connected) throw new Error(`${def.label} belum terhubung untuk brand ini; hubungkan dulu, sampai itu hanya mode mock.`)
      }
    }
    await office.store.setIntegrationMode(brand, def.service, mode, LOCAL_ACTOR)
    await office.drive.refresh()
    return { brand, service: def.service, requested: mode }
  }))
  // One-click connection: Connect returns the provider's consent page; the callback below finishes it.
  router.post('/brands/:brand/integrations/:service/connect', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    const def = serviceOf(request.params.service)
    return { url: await office.connections.begin(brand, def.service, `${publicBase(request)}${CALLBACK}`, LOCAL_ACTOR) }
  }))
  router.delete('/brands/:brand/integrations/:service/connect', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    const def = serviceOf(request.params.service)
    const removed = await office.connections.disconnect(brand, def.service, LOCAL_ACTOR)
    if (removed) await office.store.setIntegrationMode(brand, def.service, 'mock', LOCAL_ACTOR)
    await office.drive.refresh()
    return { disconnected: removed }
  }))
  router.post('/brands/:brand/integrations/:service/test', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    return office.connections.check(brand, serviceOf(request.params.service).service)
  }))
  router.get('/oauth/google/callback', async (request: Request, response: Response) => {
    const to = (outcome: string) => response.redirect(`/?oauth=${outcome}#/settings`)
    if (unavailable) { to('error-config'); return }
    try {
      const office = await services
      const query = request.query
      const done = await office.connections.complete({ code: typeof query.code === 'string' ? query.code : undefined, state: typeof query.state === 'string' ? query.state : undefined, error: typeof query.error === 'string' ? query.error : undefined })
      await office.drive.refresh()
      to(`${done.service}-ok`)
    } catch (error) {
      to(error instanceof OAuthFailure ? `error-${error.code}` : 'error-exchange')
    }
  })

  router.get('/brands', handle(async (office) => Promise.all((await office.store.brands()).map(async (brand) => {
    const [agents, summary] = await Promise.all([office.store.agents(brand.id), office.store.summary(brand.id)])
    return { ...brand, agents, summary }
  }))))

  // Read-only evaluation of an explicitly selected cohort; no model calls or approvals.
  router.post('/brands/:brand/quality/preview', handle(async (office, request) => {
    const brandId=await brandOf(office, request)
    const ids=validateEvaluationIds(request.body?.taskIds)
    const tasks=await Promise.all(ids.map(id=>office.store.task(brandId,id)))
    if(tasks.some(task=>!task)) throw new Error('Satu atau lebih tugas tidak tersedia di brand ini.')
    const approvals=await office.store.approvals(brandId)
    return evaluateQuality(brandId,tasks.filter((task): task is NonNullable<typeof task> => !!task),approvals)
  }))

  router.get('/brands/:brand/social/mock/comments',handle(async(office,request)=>mockComments(await brandOf(office,request))))
  router.get('/brands/:brand/social/mock/faq',handle(async(office,request)=>({brandId:await brandOf(office,request),mode:'mock',approval:'not-approved',autoReply:false,items:LOCAL_FAQ})))
  router.post('/brands/:brand/social/mock/classify',handle(async(office,request)=>({brandId:await brandOf(office,request),mode:'mock',items:previewComments(request.body)})))

  router.post('/brands/:brand/tasks/:id/social-schedule',handle(async(office,request)=>planSocialPost(office.store,await brandOf(office,request),String(request.params.id),request.body,LOCAL_ACTOR)))
  router.get('/brands/:brand/social-schedule',handle(async(office,request)=>({delivery:'manual-or-meta',items:(await office.store.db.query('SELECT s.*,p.post_url,p.published_at,d.state AS delivery_state,d.error AS delivery_error,d.provider_id FROM social_schedule s LEFT JOIN social_publications p ON p.schedule_id=s.id AND p.brand_id=s.brand_id LEFT JOIN social_deliveries d ON d.schedule_id=s.id AND d.brand_id=s.brand_id WHERE s.brand_id=$1 ORDER BY s.scheduled_at',[await brandOf(office,request)])).rows})))
  router.get('/brands/:brand/meta-publishing',handle(async(office,request)=>office.publisher.readiness(await brandOf(office,request),text(request.query.platform)??'instagram')))
  router.post('/brands/:brand/meta-publishing/test',handle(async(office,request)=>office.publisher.check(await brandOf(office,request),text(body(request).platform)??'instagram')))
  router.post('/brands/:brand/social-schedule/:id/dispatch',handle(async(office,request)=>{
    const brand=await brandOf(office,request)
    const result=await office.publisher.arm(brand,String(request.params.id),body(request).caption,LOCAL_ACTOR)
    await office.queue.publishSchedule(brand,result.scheduleId,result.scheduledAt)
    return result
  }))
  router.delete('/brands/:brand/social-schedule/:id/dispatch',handle(async(office,request)=>office.publisher.cancel(await brandOf(office,request),String(request.params.id),LOCAL_ACTOR)))
  router.post('/brands/:brand/social-schedule/:id/publication',handle(async(office,request)=>{
    const brand=await brandOf(office,request)
    const result=await recordSocialPublication(office.store,brand,String(request.params.id),request.body,LOCAL_ACTOR)
    await office.queue.syncLibrary(brand,result.sourceTaskId)
    return result
  }))

  router.get('/brands/:brand/tasks', handle(async (office, request) => {
    const status = text(request.query.status)
    if (status && !TASK_STATUSES.includes(status as TaskStatus)) throw new Error(`Status ${status} tidak dikenal.`)
    const brandId = await brandOf(office, request)
    const tasks = await office.store.tasks(brandId, { status: status as TaskStatus | undefined })
    const stored = await office.store.artifactFiles(brandId, tasks.filter((task) => task.kind === 'konten.chat' && task.result).map((task) => task.id))
    // A chat reply is sent as its text plus the files it carried, so the chat can show them as file cards.
    // A file kept in the file store (a PDF) also carries the id to download it by.
    return tasks.map((task) => {
      if (task.kind !== 'konten.chat' || !task.result) return task
      const { text, artifacts } = extractArtifacts(task.result)
      const files = stored.get(task.id) ?? []
      return { ...task, text, artifacts: [...artifacts.map((artifact) => { const file = files.find((item) => item.name === artifact.name); return file ? { ...artifact, assetId: file.id, mime: file.mime,size:file.size } : artifact }),...files.filter(file=>!artifacts.some(a=>a.name===file.name)).map(file=>({name:file.name,content:file.content??'',assetId:file.id,mime:file.mime,size:file.size}))] }
    })
  }))

  const agentOf = async (office: OfficeServices, request: Request) => {
    const brand = await brandOf(office, request)
    const agent = String(request.params.agent)
    if (!(await office.store.agents(brand)).some(item => item.agentType === agent && item.active)) throw new Error('Agent tidak aktif di brand ini.')
    return { brand, agent }
  }
  router.get('/brands/:brand/agents/:agent/context', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    const dir = office.contextDir ?? findContextDir()
    if (!dir) throw new Error('Konteks resmi belum tersedia.')
    return agentContextFiles(dir, agent, brand) ?? []
  }))
  router.put('/brands/:brand/agents/:agent/context', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    const dir = office.contextDir ?? findContextDir()
    if (!dir) throw new Error('Konteks resmi belum tersedia.')
    return updateContext(dir, brand, agent, body(request), LOCAL_ACTOR)
  }))
  // Rules and memory people add on top of the read-only context/ package; every change is audited.
  const noteAgent = async (office: OfficeServices, brand: string, input: Record<string, unknown>) => {
    const agent = input.agentType
    if (typeof agent === 'string' && agent !== 'all' && agent !== '' && !(await office.store.agents(brand)).some((item) => item.agentType === agent && item.active)) throw new Error('Agent tidak aktif di brand ini.')
  }
  router.get('/brands/:brand/notes', handle(async (office, request) => office.store.agentNotes(await brandOf(office, request))))
  router.post('/brands/:brand/notes', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    await noteAgent(office, brand, body(request))
    return office.store.addNote(brand, validateNote(body(request)), LOCAL_ACTOR)
  }))
  router.put('/brands/:brand/notes/:id', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    await noteAgent(office, brand, body(request))
    const note = await office.store.updateNote(brand, String(request.params.id), (current) => validateNote(body(request), current), LOCAL_ACTOR)
    if (!note) throw new Error('Catatan tidak ditemukan.')
    return note
  }))
  router.delete('/brands/:brand/notes/:id', handle(async (office, request) => {
    const brand = await brandOf(office, request)
    if (!(await office.store.deleteNote(brand, String(request.params.id), LOCAL_ACTOR))) throw new Error('Catatan tidak ditemukan.')
    return { deleted: true }
  }))
  router.post('/brands/:brand/agents/:agent/chat', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    const message = text(body(request).message)?.trim()
    if (!message || message.length > 12000) throw new Error('Pesan harus berisi 1–12000 karakter.')
    // Chat stays on the durable queue: quota, task status, audit and approval keep working.
    const task = await (office.chat??new ChatWorkspace(office.store)).createChat(brand,agent,message,body(request))
    await office.queue.enqueue(task)
    return task
  }))

  router.get('/brands/:brand/tasks/:id', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const task = await office.store.task(brandId, String(request.params.id))
    if (!task) throw new Error('Tugas tidak ditemukan.')
    const [assets, approvals, history] = await Promise.all([office.store.assets(brandId, task.id), office.store.approvals(brandId, { taskId: task.id }), office.store.taskEvents(brandId, task.id)])
    const orchestration=task.kind==='konten.orchestrasi' ? await orchestrationState(office.store,task) : undefined
    const files=orchestration?await office.store.artifactFiles(brandId,orchestration.children.map(child=>child.id)):undefined
    return { task, assets, approvals, history, orchestration:orchestration?{...orchestration,children:orchestration.children.map(child=>({...child,files:files?.get(child.id)??[]}))}:undefined }
  }))

  router.post('/brands/:brand/tasks', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const input = body(request)
    if(input.kind==='konten.orchestrasi' && input.agentType!=='manager')throw new Error('Delegasi tim hanya dapat dimulai melalui Manager.')
    const taskInput = {
      agentType: text(input.agentType) ?? '', kind: text(input.kind) ?? '', title: text(input.title)?.trim() || '',
      brief: text(input.brief), priority: typeof input.priority === 'number' ? input.priority : undefined,
      urgent: input.urgent === true, complex: input.complex === true, createdBy: LOCAL_ACTOR,
    }
    const task = input.kind==='konten.orchestrasi' ? await (office.chat??new ChatWorkspace(office.store)).createChat(brandId,'manager',taskInput.brief??'',input,taskInput) : await office.store.createTask(brandId,taskInput)
    await office.queue.enqueue(task)
    return task
  }))

  router.post('/brands/:brand/tasks/:id/cancel', handle(async (office, request) =>
    cancelWorkflow(office.store,await brandOf(office, request),String(request.params.id),LOCAL_ACTOR,text(body(request).reason)??'dibatalkan staf')))

  router.post('/brands/:brand/tasks/:id/retry', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const task = await office.store.transition(brandId, String(request.params.id), 'queued', { actor: LOCAL_ACTOR, reason: 'dijalankan ulang staf', patch: { attempts: 0 } })
    await office.queue.enqueue(task)
    return task
  }))

  // Kill switch (FR-26): one call pauses or resumes a whole brand or one agent. Resuming queues the parked tasks again.
  const killSwitch = async (office: OfficeServices, brand: string, agent: string | undefined, request: Request) => {
    const paused = body(request).paused
    if (typeof paused !== 'boolean') throw new Error('Isi "paused" dengan true atau false.')
    const moved = await office.store.setPaused(brand, agent, paused, LOCAL_ACTOR)
    if (!paused) for (const task of moved) await office.queue.enqueue(task)
    return { paused, moved: moved.length }
  }
  router.post('/brands/:brand/pause', handle(async (office, request) => killSwitch(office, await brandOf(office, request), undefined, request)))
  router.post('/brands/:brand/agents/:agent/pause', handle(async (office, request) => {
    const { brand, agent } = await agentOf(office, request)
    return killSwitch(office, brand, agent, request)
  }))

  router.get('/brands/:brand/approvals', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const approvals = await office.store.approvals(brandId, { open: request.query.open === '1' })
    const usage = await office.store.taskUsage(brandId, [...new Set(approvals.map((approval) => approval.taskId))])
    return Promise.all(approvals.map(async (approval) => ({ ...approval, approver: APPROVERS[approval.approvalType], usage: usage.get(approval.taskId) ?? null, review:await reviewSummary(office.store,brandId,approval.taskId), qc: approval.decision===null ? await office.store.latestContentQc(brandId,approval.taskId) : undefined, task: await office.store.task(brandId, approval.taskId) })))
  }))

  router.get('/brands/:brand/approvals/:id/review',handle(async(office,request)=>approvalReview(office.store,await brandOf(office,request),String(request.params.id))))

  router.post('/brands/:brand/approvals/:id', handle(async (office, request) => {
    const brandId = await brandOf(office, request)
    const input = body(request)
    const decision = input.decision === 'approved' || input.decision === 'rejected' ? input.decision : undefined
    if (!decision) throw new Error('decision harus "approved" atau "rejected".')
    const result = await office.store.decide(brandId, String(request.params.id), { decision, note: text(input.note), actor: LOCAL_ACTOR })
    if (decision === 'approved') {
      await office.events.onApproved(result.task)
      if(result.handoffTask){
        await office.queue.enqueue(result.handoffTask)
        await office.queue.syncLibrary(brandId,result.task.id)
      }
      else {
        const pack=(await office.db.query('SELECT source_task_id FROM approved_packages WHERE brand_id=$1 AND smm_task_id=$2',[brandId,result.task.id])).rows[0]
        if(pack)await office.queue.syncLibrary(brandId,pack.source_task_id)
      }
    }
    else await office.queue.enqueue(result.revisionTask??result.task)
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
