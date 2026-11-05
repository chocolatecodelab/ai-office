import { planSocialPost } from './social-schedule.js'
import { cachedDocumentContext } from './document-context-cache.js'
import { dependencyContext } from './dependency-context.js'
import { cancelWorkflow } from './orchestration.js'
import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import { processPdf } from './document-processing.js'
import { ChatWorkspace } from './chat-workspace.js'
import { compactChat } from './chat-memory.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, migrate, type Db } from '../db/index.js'
import { Connections } from '../integrations/connections.js'
import { routedDrive } from '../integrations/drive.js'
import { mockDrive } from '../integrations/index.js'
import { officeSettings } from '../settings.js'
import { readBrands, syncBrands } from './brands.js'
import { OfficeBus } from './bus.js'
import { localFileStore } from './file-store.js'
import { EventWorkflow, parseQuestions } from './event-workflow.js'
import type { HermesClient, RunRequest, RunResult } from './hermes-client.js'
import { MAX_ATTEMPTS, runTask, type RunnerDeps } from './runner.js'
import { OfficeStore } from './store.js'

// Runs against a throwaway database: OFFICE_TEST_DATABASE_URL, or office_test on the local Compose
// Postgres. Skipped when neither is reachable (for example in CI without Postgres).

const contextDir = fileURLToPath(new URL('../../context', import.meta.url))
const local = officeSettings().databaseUrl?.replace(/\/office$/, '/office_test')
const testUrl = process.env.OFFICE_TEST_DATABASE_URL || local

async function reachable(url: string | undefined): Promise<boolean> {
  if (!url) return false
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 })
  try { await client.connect(); await client.end(); return true } catch { return false }
}

const available = await reachable(testUrl)

/** A Hermes stand-in: each run returns the next scripted reply and records what it was asked. */
function scriptedHermes(replies: Array<Partial<RunResult>>): HermesClient & { requests: RunRequest[] } {
  const requests: RunRequest[] = []
  return {
    requests,
    async run(_endpoint, request) {
      requests.push(request)
      const reply = replies.shift() ?? { status: 'completed', output: 'ok' }
      return { runId: `run-${requests.length}`, status: 'completed', output: '', model: 'hermes-agent', inputTokens: 10, outputTokens: 5, ...reply }
    },
  }
}

describe.skipIf(!available)('office store, runner and event workflow (Postgres)', () => {
  let db: Db
  let store: OfficeStore
  let events: EventWorkflow
  let filesDir = ''
  const deps =(hermes: HermesClient): RunnerDeps => ({
    store, hermes, contextDir, endpoint: () => ({ url: 'http://hermes', key: 'k' }), brandName: async () => 'Official OTCA',
  })

  beforeAll(async () => {
    db = createDb(testUrl!)
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await migrate(db)
    await syncBrands(db, readBrands(contextDir))
    const bus = new OfficeBus()
    filesDir = await mkdtemp(join(tmpdir(), 'office-files-'))
    store = new OfficeStore(db, bus, localFileStore(filesDir))
    events = new EventWorkflow(store, bus, mockDrive())
  })
  afterAll(async () => { await db?.end(); if (filesDir) await rm(filesDir, { recursive: true, force: true }) })

  it('loads the four brands and their crews from context/', async () => {
    expect((await store.brands()).map((brand) => brand.id)).toEqual(['ciaomanda', 'infojerman', 'jepangkoey', 'otca'])
    expect((await store.agents('otca')).map((agent) => agent.agentType)).toContain('event-specialist')
    expect((await store.agents('infojerman')).map((agent) => agent.agentType)).not.toContain('event-specialist')
    await expect(store.createTask('infojerman', { agentType: 'event-specialist', kind: 'event.tema', title: 'x', createdBy: 'uji' })).rejects.toThrow(/tidak aktif/)
  })

  it('takes a stage through approval, rejection with notes, revision and approval', async () => {
    const event = await events.create('otca', { title: 'Parents Talk Kuliah di Jerman', details: { tanggal: '14 Desember 2026' }, createdBy: 'uji' })
    const task = await events.startStage('otca', event.id, 'tema', 'uji')
    expect(task).toMatchObject({ status: 'queued', agentType: 'event-specialist', kind: 'event.tema', complex: true })
    expect(task.brief).toContain('14 Desember 2026')
    await expect(events.startStage('otca', event.id, 'konsep_ads', 'uji')).rejects.toThrow(/menunggu persetujuan/)

    const hermes = scriptedHermes([{ output: '# Tema v1' }, { output: '# Tema v2' }])
    expect(await runTask(deps(hermes), 'otca', task.id)).toEqual({ next: 'none' })
    expect(hermes.requests[0].instructions).toContain('/context/agents/event-specialist.md')
    expect(hermes.requests[0]).toMatchObject({ reasoningEffort: 'high', sessionId: `task-${task.id}` })
    expect(hermes.requests[0].provider).toBeUndefined() // Codex, the container default
    const [approval] = await store.approvals('otca', { open: true })
    expect(await store.summary('otca')).toEqual({ queued: 0, approvals: 1, waitingQuota: 0 })
    expect(await store.summary('infojerman')).toEqual({ queued: 0, approvals: 0, waitingQuota: 0 })
    expect(approval).toMatchObject({ taskId: task.id, approvalType: 'event' })
    expect((await store.agents('otca')).find((agent) => agent.agentType === 'event-specialist')?.status).toBe('waiting_approval')

    await expect(store.decide('otca', approval.id, { decision: 'rejected', actor: 'uji' })).rejects.toThrow(/catatan/)
    await store.decide('otca', approval.id, { decision: 'rejected', note: 'Tambahkan tema beasiswa', actor: 'uji' })
    expect((await store.task('otca', task.id))?.attempts).toBe(0)
    await runTask(deps(hermes), 'otca', task.id)
    expect(hermes.requests[1].input).toContain('Tambahkan tema beasiswa')
    expect(hermes.requests[1].input).toContain('# Tema v1')
    expect((await store.assets('otca', task.id)).map((asset) => asset.version)).toEqual([2, 1])

    const [second] = await store.approvals('otca', { open: true })
    const decided = await store.decide('otca', second.id, { decision: 'approved', actor: 'uji' })
    expect(decided.task.status).toBe('approved')
    const detail = await events.detail('otca', event.id)
    expect(detail?.stages.find((stage) => stage.id === 'konsep_ads')?.ready).toBe(true)
    expect(detail?.stages.find((stage) => stage.id === 'ppt')).toMatchObject({ ready: false, missing: ['pertanyaan'] })
  })

  it('turns the approved questions into the speaker answer tracker', async () => {
    const event = await events.create('otca', { title: 'Seminar Beasiswa', createdBy: 'uji' })
    const tema = await events.startStage('otca', event.id, 'tema', 'uji')
    await runTask(deps(scriptedHermes([{ output: 'tema' }])), 'otca', tema.id)
    await store.decide('otca', (await store.approvals('otca', { open: true, taskId: tema.id }))[0].id, { decision: 'approved', actor: 'uji' })
    const questions = await events.startStage('otca', event.id, 'pertanyaan', 'uji')
    const list = Array.from({ length: 10 }, (_, index) => `${index + 1}. Pertanyaan nomor ${index + 1}?`).join('\n')
    await runTask(deps(scriptedHermes([{ output: `Profil narasumber...\n\n${list}` }])), 'otca', questions.id)
    const result = await store.decide('otca', (await store.approvals('otca', { open: true, taskId: questions.id }))[0].id, { decision: 'approved', actor: 'uji' })
    await events.onApproved(result.task)
    const tracker = await events.questions('otca', event.id)
    expect(tracker).toHaveLength(10)
    await expect(events.startStage('otca', event.id, 'ppt', 'uji')).rejects.toThrow(/jawaban narasumber/)
    await events.answer('otca', event.id, tracker[0].id, { answer: 'Mulai dari bahasa', speaker: 'Frau Priska' })
    expect((await events.questions('otca', event.id))[0]).toMatchObject({ status: 'dijawab', speaker: 'Frau Priska' })
    const ppt = await events.startStage('otca', event.id, 'ppt', 'uji')
    expect(ppt.brief).toContain('Mulai dari bahasa')
  })

  it('screens audience research before Hermes and records identifier counts without originals',async()=>{
    const task=await store.createTask('ciaomanda',{agentType:'content-creator',kind:'konten.riset',title:'Riset audiens',brief:'Nama: Sari\nEmail sari@example.com\nHP 081234567890\nPertanyaan: bagaimana belajar bahasa?',createdBy:'uji'})
    const hermes=scriptedHermes([{output:'Tema: belajar bahasa\nCTA: Tinjau ide'}])
    await runTask(deps(hermes),'ciaomanda',task.id)
    expect(hermes.requests).toHaveLength(1)
    const sent=JSON.stringify(hermes.requests[0])
    for(const secret of ['Sari','sari@example.com','081234567890'])expect(sent).not.toContain(secret)
    expect(sent).toContain('bagaimana belajar bahasa')
    expect((await store.task('ciaomanda',task.id))?.status).toBe('waiting_approval')
    const trace=(await store.taskEvents('ciaomanda',task.id)).filter(e=>e.type==='research_privacy')
    expect(trace).toHaveLength(1)
    expect(trace[0].payload).toMatchObject({scope:'text-only',counts:{email:1,telepon:1}})
    expect(JSON.stringify(trace)).not.toContain('Sari')
    expect(await store.task('otca',task.id)).toBeUndefined()
  })

  it('requires publication approval for a versioned same-brand social plan and never posts externally',async()=>{
    const task=await store.createTask('otca',{agentType:'social-media-manager',kind:'publikasi.caption',title:'QA jadwal',brief:'Caption uji',createdBy:'uji'})
    const plan={platform:'instagram',scheduledAt:new Date(Date.now()+86400000).toISOString()}
    await expect(planSocialPost(store,'otca',task.id,plan,'uji')).rejects.toThrow()
    await runTask(deps(scriptedHermes([{output:'Caption QA'}])),'otca',task.id)
    await expect(planSocialPost(store,'otca',task.id,plan,'uji')).rejects.toThrow()
    const review=(await store.approvals('otca',{taskId:task.id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'approved',actor:'uji'})
    await expect(planSocialPost(store,'infojerman',task.id,plan,'uji')).rejects.toThrow()
    const results=await Promise.all([planSocialPost(store,'otca',task.id,plan,'uji'),planSocialPost(store,'otca',task.id,plan,'uji')])
    expect(results[0].id).toBe(results[1].id)
    expect(results[0]).toMatchObject({delivery:'local-plan-only',status:'planned',approval_id:review.id})
    await expect(planSocialPost(store,'otca',task.id,{...plan,scheduledAt:new Date(Date.now()+172800000).toISOString()},'uji')).rejects.toThrow()
    expect((await store.taskEvents('otca',task.id)).filter(e=>e.type==='social_schedule')).toHaveLength(1)
  })

  it('migrates source and consent registries with same-brand and evidence constraints',async()=>{
    const source=(await db.query("INSERT INTO sources(brand_id,title,created_by) VALUES('otca','Sumber QA','uji') RETURNING id")).rows[0]
    await expect(db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,status,recorded_by) VALUES('otca',$1,'anon-qa','caption','granted','uji')",[source.id])).rejects.toThrow()
    await expect(db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,recorded_by) VALUES('infojerman',$1,'anon-qa','caption','uji')",[source.id])).rejects.toThrow()
    const consent=await db.query("INSERT INTO consents(brand_id,source_id,subject_reference,usage_scope,status,evidence_reference,recorded_by) VALUES('otca',$1,'anon-qa','caption','granted','qa-proof','uji') RETURNING status",[source.id])
    expect(consent.rows[0].status).toBe('granted')
  })

  it('runs a local SMM classification tool from JSON and traces it without external social actions',async()=>{
    const chat=new ChatWorkspace(store)
    const file=await chat.upload('otca','social-media-manager','qa-comments.json',Buffer.from(JSON.stringify({comments:[{id:'qa-1',text:'Berapa biaya?'},{id:'qa-2',text:'Saya kecewa'}]})))
    const task=await chat.createChat('otca','social-media-manager','Klasifikasikan komentar simulasi',{attachmentIds:[file.id],skills:['comment-classification']})
    const hermes=scriptedHermes([{output:'Dua komentar memerlukan review; tidak ada balasan dikirim.'}])
    await runTask({...deps(hermes),chat},'otca',task.id)
    expect(hermes.requests[0].input).toContain('comment-classification')
    expect(hermes.requests[0].input).toContain('complaint')
    expect(hermes.requests[0].input).toContain('externalActions')
    const evidence=(await chat.evidence('otca','social-media-manager')).find(e=>e.taskId===task.id)!
    expect(evidence.trace.tools).toContainEqual({name:'comment-classification',status:'completed'})
    expect((await store.task('otca',task.id))?.status).toBe('done')
    expect((await chat.evidence('ciaomanda','social-media-manager')).some(e=>e.taskId===task.id)).toBe(false)
  })

  it('stores versioned Content Creator QC before approval and keeps reports brand scoped',async()=>{
    const task=await store.createTask('otca',{agentType:'content-creator',kind:'konten.caption',title:'Uji caption',brief:'Konsep anonim',createdBy:'uji'})
    await runTask(deps(scriptedHermes([{output:'[KONFIRMASI: tanggal]\nCTA: Daftar'}])),'otca',task.id)
    expect((await store.latestContentQc('otca',task.id))?.checks.some(c=>c.status==='warning')).toBe(true)
    expect(await store.latestContentQc('infojerman',task.id)).toBeUndefined()
    const review=(await store.approvals('otca',{taskId:task.id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'rejected',note:'Hapus penanda tanggal',actor:'uji'})
    await runTask(deps(scriptedHermes([{output:'Caption yang direvisi\nCTA: Daftar'}])),'otca',task.id)
    expect((await store.latestContentQc('otca',task.id))?.checks.some(c=>c.status==='warning')).toBe(false)
    expect((await store.taskEvents('otca',task.id)).filter(e=>e.type==='content_qc').map(e=>e.payload.version)).toEqual([1,2])
  })

  it('waits for the Codex quota instead of spending the Claude pool, and retries other failures', async () => {
    const event = await events.create('otca', { title: 'Uji kuota', createdBy: 'uji' })
    const task = await events.startStage('otca', event.id, 'tema', 'uji')
    const outcome = await runTask(deps(scriptedHermes([{ status: 'failed', output: 'You have hit your usage limit. Try again in 3 hours.' }])), 'otca', task.id)
    expect(outcome).toMatchObject({ next: 'retry' })
    const waiting = await store.task('otca', task.id)
    expect(waiting).toMatchObject({ status: 'waiting_quota', attempts: 0 })
    expect(waiting?.retryAt).toBeTruthy()

    const failing = scriptedHermes(Array.from({ length: MAX_ATTEMPTS }, () => ({ status: 'failed' as const, output: 'Provider error 500' })))
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) await runTask(deps(failing), 'otca', task.id)
    expect(await store.task('otca', task.id)).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS })
  })

  it('never shows or changes one brand\'s work from another brand', async () => {
    const [task] = await store.tasks('otca')
    expect(await store.task('infojerman', task.id)).toBeUndefined()
    await expect(store.transition('infojerman', task.id, 'cancelled', { actor: 'uji' })).rejects.toThrow(/tidak ditemukan/)
    const [approval] = await store.approvals('otca')
    await expect(store.decide('infojerman', approval.id, { decision: 'approved', actor: 'uji' })).rejects.toThrow(/tidak ditemukan/)
    expect(await store.tasks('infojerman')).toEqual([])
  })

  it('parks and restores work with the kill switch, per agent and per brand (FR-26)', async () => {
    const make = (brand: string, agentType: string, title: string) => store.createTask(brand, { agentType, kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    const creator = await make('otca', 'content-creator', 'ks-1')
    const specialist = await make('otca', 'event-specialist', 'ks-2')
    const sister = await make('infojerman', 'content-creator', 'ks-3')

    expect((await store.setPaused('otca', 'content-creator', true, 'uji')).map((task) => task.id)).toContain(creator.id)
    expect((await store.task('otca', creator.id))?.status).toBe('paused')
    expect((await store.task('otca', specialist.id))?.status).toBe('queued')
    expect(await store.isPaused('otca', 'content-creator')).toBe(true)
    expect(await store.isPaused('otca', 'event-specialist')).toBe(false)
    const idle = scriptedHermes([])
    await runTask(deps(idle), 'otca', creator.id)
    expect(idle.requests).toHaveLength(0)

    await store.setPaused('infojerman', undefined, true, 'uji')
    expect((await store.task('infojerman', sister.id))?.status).toBe('paused')
    expect(await store.isPaused('infojerman', 'manager')).toBe(true)
    expect(await store.isPaused('otca', 'manager')).toBe(false)

    await store.setPaused('infojerman', undefined, false, 'uji')
    await store.setPaused('otca', 'content-creator', false, 'uji')
    expect((await store.task('infojerman', sister.id))).toMatchObject({ status: 'queued', attempts: 0 })
    expect((await store.task('otca', creator.id))?.status).toBe('queued')
    await expect(store.setPaused('otca', 'tidak-ada', true, 'uji')).rejects.toThrow(/tidak ada/)
  })

  it('records the duration of each run and reports a task\'s usage to its own brand only (FR-14, FR-20)', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'us-1', brief: 'x', createdBy: 'uji' })
    await runTask(deps(scriptedHermes([{ output: 'jawaban' }])), 'otca', task.id)
    const usage = (await store.taskUsage('otca', [task.id])).get(task.id)
    expect(usage).toMatchObject({ runs: 1, inputTokens: 10, outputTokens: 5, source: 'codex' })
    expect(typeof usage?.durationMs).toBe('number')
    expect((await store.taskUsage('infojerman', [task.id])).size).toBe(0)
    expect((await store.taskUsage('otca', [])).size).toBe(0)
  })

  it('lists a brand\'s saved results and opens one only for its own brand', async () => {
    const [asset] = await store.assetList('otca', 5)
    expect(asset).toMatchObject({ title: expect.any(String), version: expect.any(Number) })
    expect(asset.size).toBeGreaterThan(0)
    expect((await store.asset('otca', asset.id))?.content.length).toBeGreaterThan(0)
    expect(await store.asset('infojerman', asset.id)).toBeUndefined()
    expect(await store.assetList('infojerman')).toEqual([])
  })

  it('saves the files a chat reply carries as assets of their own, and drops unsafe ones', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'af-1', brief: 'x', createdBy: 'uji' })
    const reply = 'Ini berkasnya.\n~~~file:rencana.md\n# Rencana\n~~~\n~~~file:../../jahat.exe\nx\n~~~'
    await runTask(deps(scriptedHermes([{ output: reply }])), 'otca', task.id)
    expect((await store.assets('otca', task.id)).map((asset) => asset.kind).sort()).toEqual(['artifact', 'konten.chat'])
    const listed = (await store.assetList('otca', 50)).filter((item) => item.taskId === task.id)
    expect(listed.find((item) => item.kind === 'artifact')).toMatchObject({ name: 'rencana.md' })
    expect(listed.some((item) => item.name === 'jahat.exe')).toBe(false)
    expect(listed.find((item) => item.kind === 'konten.chat')?.name).toBeNull()
  })

  it('renders a *.pdf file of a chat reply into the file store, and serves it to its own brand only', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'pdf-1', brief: 'x', createdBy: 'uji' })
    const reply = 'Ringkasan siap.\n~~~file:ringkasan.pdf\n# Ringkasan\n\n- poin satu\n- poin dua\n~~~\n~~~file:catatan.md\n# Catatan\n~~~'
    await runTask(deps(scriptedHermes([{ output: reply }])), 'otca', task.id)

    const listed = (await store.assetList('otca', 50)).filter((item) => item.taskId === task.id)
    const pdf = listed.find((item) => item.name === 'ringkasan.pdf')
    expect(pdf).toMatchObject({ mime: 'application/pdf', downloadable: true, kind: 'artifact' })
    expect(listed.find((item) => item.name === 'catatan.md')).toMatchObject({ mime: null, downloadable: false })

    const file = await store.assetFile('otca', pdf!.id)
    expect(file?.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(file?.name).toBe('ringkasan.pdf')
    expect(pdf!.size).toBe(file?.data.length)
    expect((await store.asset('otca', pdf!.id))?.content).toContain('# Ringkasan') // the Markdown source is kept
    expect(await store.assetFile('infojerman', pdf!.id)).toBeUndefined()
    expect(await store.assetFile('otca', listed.find((item) => item.name === 'catatan.md')!.id)).toBeUndefined()
    expect([...(await store.artifactFiles('otca', [task.id])).get(task.id) ?? []].map((item) => item.name)).toEqual(['ringkasan.pdf'])
    expect((await store.artifactFiles('infojerman', [task.id])).size).toBe(0)
  })

  it('prints a stored PDF again from its Markdown, for its own brand only', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'rr-1', brief: 'x', createdBy: 'uji' })
    await runTask(deps(scriptedHermes([{ output: '~~~file:ulang.pdf\n# Cetak Ulang\n\nIsi dokumen.\n~~~' }])), 'otca', task.id)
    const pdf = (await store.assetList('otca', 100)).find((item) => item.taskId === task.id && item.name === 'ulang.pdf')!
    const before = await store.assetFile('otca', pdf.id)

    const { size } = await store.rerenderPdf('otca', pdf.id, 'uji')
    const after = await store.assetFile('otca', pdf.id)
    expect(after?.data.subarray(0, 5).toString()).toBe('%PDF-')
    expect(after?.data.length).toBe(size)
    expect((await store.assetList('otca', 100)).find((item) => item.id === pdf.id)?.size).toBe(size)
    expect(before?.data.length).toBeGreaterThan(0)

    await expect(store.rerenderPdf('infojerman', pdf.id, 'uji')).rejects.toThrow(/tidak ditemukan/)
    const note = (await store.assetList('otca', 100)).find((item) => item.taskId === task.id && item.kind === 'konten.chat')!
    await expect(store.rerenderPdf('otca', note.id, 'uji')).rejects.toThrow(/tidak ditemukan/)
  }, 60_000)

  it('runs an agent on the model set for it, and goes back to the default after a reset', async () => {
    const make = (title: string) => store.createTask('otca', { agentType: 'digital-marketing', kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    await store.setRoute('digital-marketing', 'simple', { source: 'codex', model: 'gpt-uji', reasoningEffort: 'high' }, 'uji')
    expect((await store.routeOverrides()).get('digital-marketing')?.simple).toEqual({ source: 'codex', model: 'gpt-uji', reasoningEffort: 'high' })

    const changed = scriptedHermes([{ output: 'a' }])
    await runTask(deps(changed), 'otca', (await make('rt-1')).id)
    expect(changed.requests[0]).toMatchObject({ model: 'gpt-uji', reasoningEffort: 'high' })
    expect(changed.requests[0].provider).toBeUndefined()

    await store.setRoute('digital-marketing', 'simple', { source: 'codex', reasoningEffort: 'low' }, 'uji') // an update, not a second row
    expect(await store.clearRoute('digital-marketing', 'simple', 'uji')).toBe(true)
    expect(await store.clearRoute('digital-marketing', 'simple', 'uji')).toBe(false)
    const reset = scriptedHermes([{ output: 'b' }])
    await runTask(deps(reset), 'otca', (await make('rt-2')).id)
    expect(reset.requests[0].model).toBeUndefined()
    expect(reset.requests[0].reasoningEffort).toBe('low')
    expect((await store.routeOverrides()).has('digital-marketing')).toBe(false)
  })

  it('keeps rules and memory per brand, audits every change, and tells the agent only the active ones', async () => {
    const rule = await store.addNote('otca', { kind: 'rule', title: 'Sapaan', body: 'Selalu mulai dengan salam.', agentType: null, active: true }, 'uji')
    const own = await store.addNote('otca', { kind: 'memory', title: 'Pilihan klien', body: 'Klien suka tanggal akhir pekan.', agentType: 'digital-marketing', active: true }, 'uji')
    await store.addNote('infojerman', { kind: 'rule', title: 'Rahasia brand lain', body: 'jangan bocor', agentType: null, active: true }, 'uji')

    expect((await store.agentNotes('otca')).map((note) => note.title).sort()).toEqual(['Pilihan klien', 'Sapaan'])
    expect((await store.notesFor('otca', 'digital-marketing')).map((note) => note.id).sort()).toEqual([rule.id, own.id].sort())
    expect((await store.notesFor('otca', 'manager')).map((note) => note.id)).toEqual([rule.id])

    const changed = await store.updateNote('otca', own.id, (current) => ({ ...current, body: 'Klien suka tanggal tengah bulan.' }), 'uji')
    expect(changed?.body).toContain('tengah bulan')
    expect(await store.updateNote('infojerman', own.id, (current) => current, 'uji')).toBeUndefined() // another brand's id
    expect(await store.deleteNote('infojerman', own.id, 'uji')).toBe(false)

    const hermes = scriptedHermes([{ output: 'a' }, { output: 'b' }])
    const make = (title: string) => store.createTask('otca', { agentType: 'digital-marketing', kind: 'konten.chat', title, brief: 'x', createdBy: 'uji' })
    await runTask(deps(hermes), 'otca', (await make('nt-1')).id)
    expect(hermes.requests[0].input).toContain('Selalu mulai dengan salam.')
    expect(hermes.requests[0].input).toContain('tengah bulan')
    expect(hermes.requests[0].input).not.toContain('jangan bocor')

    await store.updateNote('otca', rule.id, (current) => ({ ...current, active: false }), 'uji')
    await runTask(deps(hermes), 'otca', (await make('nt-2')).id)
    expect(hermes.requests[1].input).not.toContain('Selalu mulai dengan salam.')

    expect(await store.deleteNote('otca', own.id, 'uji')).toBe(true)
    expect(await store.deleteNote('otca', own.id, 'uji')).toBe(false)
    const actions = (await store.activity('otca', 100)).filter((entry) => entry.kind === 'audit').map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['note.create', 'note.update', 'note.delete']))
  })

  it('keeps the integration mode each brand asked for, per service, and audits the change', async () => {
    await store.setIntegrationMode('otca', 'trello', 'sandbox', 'uji')
    await store.setIntegrationMode('otca', 'trello', 'live', 'uji') // an update, not a second row
    await store.setIntegrationMode('infojerman', 'trello', 'mock', 'uji')
    const modes = await store.integrationModes()
    expect(modes.get('otca')?.get('trello')).toBe('live')
    expect(modes.get('infojerman')?.get('trello')).toBe('mock')
    expect(modes.get('ciaomanda')?.has('trello') ?? false).toBe(false)
    expect((await store.activity('otca', 100)).some((entry) => entry.action === 'integration.mode')).toBe(true)
  })

  it('connects an account in one click: PKCE and a single-use state, tokens sealed, refresh, revoked access, Drive, disconnect', async () => {
    const calls: string[] = []
    let refreshFails = false
    const google: typeof fetch = async (input, init) => {
      const url = String(input)
      const form = init?.body instanceof URLSearchParams ? init.body : undefined
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}${form?.get('grant_type') ? ` ${form.get('grant_type')}` : ''}`)
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        if (form?.get('grant_type') === 'refresh_token') return refreshFails ? Response.json({ error: 'invalid_grant' }, { status: 400 }) : Response.json({ access_token: 'at-2', expires_in: 3600 })
        return form?.get('code_verifier') && form.get('code') === 'kode-ok' ? Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid email drive.readonly' }) : Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
      if (url.includes('/userinfo')) return Response.json({ email: 'tim@otca.id' })
      if (url.includes('/export')) return new Response('Isi template TOR')
      if (url.includes('/drive/v3/files')) return Response.json({ files: [{ id: 'f1', name: 'TOR & SKB', mimeType: 'application/vnd.google-apps.document' }] })
      return new Response('{}')
    }
    const key = Buffer.alloc(32, 7).toString('base64')
    const env = { GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'sec', INTEGRATIONS_ENCRYPTION_KEY: key }
    const redirect = 'http://127.0.0.1:3001/api/office/oauth/google/callback'

    await expect(new Connections({ store, env: {}, fetcher: google }).begin('otca', 'drive', redirect, 'uji')).rejects.toMatchObject({ code: 'config' })
    const connections = new Connections({ store, env, fetcher: google })
    await expect(connections.begin('otca', 'trello', redirect, 'uji')).rejects.toThrow(/satu klik/)

    const url = new URL(await connections.begin('otca', 'drive', redirect, 'uji'))
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('scope')).toContain('drive.readonly')
    expect(url.searchParams.get('scope')).not.toContain('auth/drive ') // read only
    const state = url.searchParams.get('state')!

    await expect(connections.complete({ code: 'kode-ok', state: 'bukan-state' })).rejects.toMatchObject({ code: 'state' })
    expect(await connections.complete({ code: 'kode-ok', state })).toEqual({ brandId: 'otca', service: 'drive' })
    await expect(connections.complete({ code: 'kode-ok', state })).rejects.toMatchObject({ code: 'state' }) // used once

    const listed = await store.connections()
    expect(listed).toEqual([expect.objectContaining({ brandId: 'otca', service: 'drive', account: 'tim@otca.id', status: 'active' })])
    const sealed = await store.connectionSecret('otca', 'drive')
    expect(sealed?.accessToken).not.toContain('at-1')
    expect(sealed?.refreshToken).not.toContain('rt-1')
    expect(JSON.stringify(listed)).not.toContain('at-1')

    const denied = new URL(await connections.begin('otca', 'drive', redirect, 'uji')).searchParams.get('state')!
    await expect(connections.complete({ error: 'access_denied', state: denied })).rejects.toMatchObject({ code: 'denied' })

    expect(await connections.accessToken('otca', 'drive')).toBe('at-1')
    expect(calls.filter((call) => call.endsWith('refresh_token'))).toHaveLength(0)
    await db.query("UPDATE integration_connections SET expires_at = now() - interval '1 minute' WHERE brand_id = 'otca'")
    expect(await connections.accessToken('otca', 'drive')).toBe('at-2')
    expect(await connections.check('otca', 'drive')).toEqual({ account: 'tim@otca.id', visibleFiles: 1 })

    const drive = routedDrive(store, connections, google)
    expect(await drive.template('otca', 'TOR & SKB')).toBeUndefined() // mode is still mock
    await store.setIntegrationMode('otca', 'drive', 'live', 'uji')
    await drive.refresh()
    expect(drive.mode).toBe('live')
    expect(await drive.template('otca', 'TOR & SKB')).toMatchObject({ content: 'Isi template TOR', source: 'Google Drive · TOR & SKB' })
    await store.setIntegrationMode('infojerman', 'drive', 'live', 'uji')
    expect(await drive.template('infojerman', 'TOR & SKB')).toBeUndefined() // another brand has no connection

    refreshFails = true
    await db.query("UPDATE integration_connections SET expires_at = now() - interval '1 minute' WHERE brand_id = 'otca'")
    await expect(connections.accessToken('otca', 'drive')).rejects.toThrow(/hubungkan ulang/)
    expect((await store.connections())[0].status).toBe('needs_reauth')
    await drive.refresh()
    expect(drive.mode).toBe('mock')

    expect(await connections.disconnect('infojerman', 'drive', 'uji')).toBe(false)
    expect(await connections.disconnect('otca', 'drive', 'uji')).toBe(true)
    expect(calls).toContain('POST https://oauth2.googleapis.com/revoke')
    expect(await store.connections()).toEqual([])
    const actions = (await store.activity('otca', 100)).filter((entry) => entry.kind === 'audit').map((entry) => entry.action)
    expect(actions).toEqual(expect.arrayContaining(['integration.connect', 'integration.disconnect']))
  })


  it('persists one crew, waits for specialist approval, and synthesizes through Manager approval', async()=>{
    const parent=await store.createTask('otca',{agentType:'manager',kind:'konten.orchestrasi',title:'Rencana konten tim',brief:'Buat caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Content Creator menulis caption',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption tim',brief:'Tulis caption draft tanpa klaim angka'}]})
    const hermes=scriptedHermes([{output:plan},{output:'# Caption spesialis'},{output:'# Ringkasan Manager'}])
    const runner=deps(hermes)
    const [first]=await Promise.all([runTask(runner,'otca',parent.id),runTask(runner,'otca',parent.id)])
    expect(first.next).toBe('retry')
    const children=(await store.tasks('otca')).filter(t=>t.parentId===parent.id)
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({agentType:'content-creator',status:'queued',createdBy:'agent:manager'})
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(1)
    expect((await store.tasks('otca')).filter(t=>t.parentId===parent.id)).toHaveLength(1)
    await runTask(runner,'otca',children[0].id)
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(2)
    const review=(await store.approvals('otca',{taskId:children[0].id,open:true}))[0]
    await store.decide('otca',review.id,{decision:'approved',actor:'uji'})
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(3)
    expect(hermes.requests[2].input).toContain('# Caption spesialis')
    expect((await store.task('otca',parent.id))?.status).toBe('waiting_approval')
    expect(await store.approvals('otca',{taskId:parent.id,open:true})).toHaveLength(1)
    await runTask(runner,'otca',parent.id)
    expect(hermes.requests).toHaveLength(3)
  })


  it('runs a same-brand DAG only after predecessor approvals and hands over the approved version exactly once',async()=>{
    const brand='infojerman'
    const parent=await store.createTask(brand,{agentType:'manager',kind:'konten.orchestrasi',title:'Workflow berurutan',brief:'Naskah, storyboard, kalender',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Content → Video → SMM',tasks:[
      {agentType:'social-media-manager',kind:'publikasi.kalender',title:'Kalender tahap3',brief:'Jadwalkan draft',dependsOn:['content-creator','video-editor']},
      {agentType:'video-editor',kind:'video.storyboard',title:'Storyboard tahap2',brief:'Gunakan naskah',dependsOn:['content-creator']},
      {agentType:'content-creator',kind:'konten.script',title:'Naskah tahap1',brief:'Susun naskah'},
    ]})
    const hermes=scriptedHermes([{output:plan},{output:'VERSI-DITOLAK'},{output:'NASKAH-SETUJU-V2'},{output:'STORYBOARD-SETUJU'},{output:'KALENDER-SETUJU'},{output:'RANGKUMAN-MANAGER'}])
    const runner=deps(hermes)
    const first=await runTask(runner,brand,parent.id)
    const nodes=(await store.tasks(brand)).filter(t=>t.parentId===parent.id)
    const content=nodes.find(t=>t.agentType==='content-creator')!,video=nodes.find(t=>t.agentType==='video-editor')!,smm=nodes.find(t=>t.agentType==='social-media-manager')!
    expect(first.next==='retry'?first.children?.map(t=>t.id):[]).toEqual([content.id])
    await runTask(runner,brand,video.id);expect(hermes.requests).toHaveLength(1)
    await runTask(runner,brand,content.id)
    await store.decide(brand,(await store.approvals(brand,{taskId:content.id,open:true}))[0].id,{decision:'rejected',note:'Perbaiki naskah',actor:'uji'})
    await runTask(runner,brand,video.id);expect(hermes.requests).toHaveLength(2)
    await runTask(runner,brand,content.id)
    await store.decide(brand,(await store.approvals(brand,{taskId:content.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    const second=await runTask(runner,brand,parent.id)
    expect(second.next==='retry'?second.children?.map(t=>t.id):[]).toEqual([video.id])
    await Promise.all([runTask(runner,brand,video.id),runTask(runner,brand,video.id)])
    expect(hermes.requests).toHaveLength(4)
    expect(hermes.requests[3].input).toContain('NASKAH-SETUJU-V2')
    expect(hermes.requests[3].input).not.toContain('VERSI-DITOLAK')
    const used=(await store.taskEvents(brand,video.id)).find(e=>e.type==='dependency_context')!
    expect(used.payload.sources).toEqual([expect.objectContaining({taskId:content.id,version:2,summarized:false})])
    await runTask(runner,brand,smm.id);expect(hermes.requests).toHaveLength(4)
    await store.decide(brand,(await store.approvals(brand,{taskId:video.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await runTask(runner,brand,smm.id)
    expect(hermes.requests[4].input).toContain('NASKAH-SETUJU-V2');expect(hermes.requests[4].input).toContain('STORYBOARD-SETUJU')
    await store.decide(brand,(await store.approvals(brand,{taskId:smm.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await runTask(runner,brand,parent.id)
    expect((await store.task(brand,parent.id))?.status).toBe('waiting_approval')
    expect(hermes.requests).toHaveLength(6)
    expect(await store.task('otca',video.id)).toBeUndefined()
    await expect(dependencyContext(store,video,[{...(await store.task(brand,content.id))!,brandId:'otca'}],{run:async()=>{throw new Error('never')}})).rejects.toThrow('workflow brand')
  })

  it('recovers failed predecessors and atomically cancels pending stages and their open approvals',async()=>{
    const brand='ciaomanda'
    const parent=await store.createTask(brand,{agentType:'manager',kind:'konten.orchestrasi',title:'QA recovery DAG',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Workflow recovery',tasks:[{agentType:'content-creator',kind:'konten.script',title:'Naskah recovery',brief:'Naskah'},{agentType:'video-editor',kind:'video.storyboard',title:'Storyboard recovery',brief:'Storyboard',dependsOn:['content-creator']},{agentType:'social-media-manager',kind:'publikasi.kalender',title:'Kalender recovery',brief:'Kalender',dependsOn:['video-editor']}]})
    const hermes=scriptedHermes([{output:plan},{output:'Naskah pulih'},{output:'Storyboard draft'}]),runner=deps(hermes)
    await runTask(runner,brand,parent.id)
    const nodes=(await store.tasks(brand)).filter(t=>t.parentId===parent.id),source=nodes.find(t=>t.agentType==='content-creator')!,video=nodes.find(t=>t.agentType==='video-editor')!,smm=nodes.find(t=>t.agentType==='social-media-manager')!
    await store.transition(brand,source.id,'running',{actor:'uji'});await store.transition(brand,source.id,'failed',{actor:'uji'})
    await runTask(runner,brand,parent.id);expect((await store.task(brand,parent.id))?.status).toBe('failed')
    await store.transition(brand,source.id,'queued',{actor:'uji'})
    await runTask(runner,brand,source.id)
    expect((await store.task(brand,source.id))?.status).toBe('waiting_approval')
    await store.decide(brand,(await store.approvals(brand,{taskId:source.id,open:true}))[0].id,{decision:'approved',actor:'uji'})
    await store.transition(brand,parent.id,'queued',{actor:'uji'})
    await runTask(runner,brand,parent.id);await runTask(runner,brand,video.id)
    expect(await store.approvals(brand,{taskId:video.id,open:true})).toHaveLength(1)
    await expect(cancelWorkflow(store,'otca',parent.id,'uji','cancel')).rejects.toThrow('tidak ditemukan')
    await cancelWorkflow(store,brand,parent.id,'uji','QA selesai')
    expect((await store.task(brand,source.id))?.status).toBe('approved')
    expect((await store.task(brand,video.id))?.status).toBe('cancelled')
    expect((await store.task(brand,smm.id))?.status).toBe('cancelled')
    expect(await store.approvals(brand,{taskId:video.id,open:true})).toHaveLength(0)
    await runTask(runner,brand,smm.id);expect(hermes.requests).toHaveLength(3)
  })

  it('caches complete-source dependency summaries and never reads a foreign parent as an input',async()=>{
    const parent=await store.createTask('jepangkoey',{agentType:'manager',kind:'konten.orchestrasi',title:'QA konteks panjang',createdBy:'uji'})
    const source=await store.createTask('jepangkoey',{agentType:'content-creator',kind:'konten.script',title:'Naskah panjang',parentId:parent.id,createdBy:'uji'})
    const child=await store.createTask('jepangkoey',{agentType:'video-editor',kind:'video.storyboard',title:'Storyboard panjang',parentId:parent.id,createdBy:'uji'})
    await store.transition('jepangkoey',source.id,'running',{actor:'uji'})
    const result=await store.submitForApproval('jepangkoey',source.id,{content:'Sumber lengkap '.repeat(2500)+'SENTINEL-AKHIR',runId:'qa-long',source:'codex',model:'test',inputTokens:1,outputTokens:1})
    await store.decide('jepangkoey',result.approval.id,{decision:'approved',actor:'uji'})
    const approved=(await store.task('jepangkoey',source.id))!
    const hermes=scriptedHermes(Array(10).fill({output:'Ringkasan bagian sumber'}))
    const runtime={run:(request:RunRequest,key:string)=>hermes.run({url:'http://mock',key:'test'},request,key)}
    const first=await dependencyContext(store,child,[approved],runtime),calls=hermes.requests.length
    expect(calls).toBeGreaterThan(0);expect(hermes.requests.map(r=>r.input).join('\n')).toContain('SENTINEL-AKHIR')
    expect(first.sources[0]).toMatchObject({summarized:true,cacheHit:false})
    expect((await dependencyContext(store,child,[approved],runtime)).sources[0].cacheHit).toBe(true)
    expect(hermes.requests).toHaveLength(calls)
    await expect(dependencyContext(store,{...child,parentId:'another'},[approved],runtime)).rejects.toThrow('workflow brand')
    await store.transition('jepangkoey',child.id,'cancelled',{actor:'uji'})
    await store.transition('jepangkoey',parent.id,'cancelled',{actor:'uji'})
  })

  it('blocks aggregation after specialist failure and cancels queued children of a cancelled Manager',async()=>{
    const make=()=>store.createTask('infojerman',{agentType:'manager',kind:'konten.orchestrasi',title:'Delegasi uji',brief:'Caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Caption',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption',brief:'Draft caption'}]})
    const hermes=scriptedHermes([{output:plan},{output:plan}])
    const runner=deps(hermes),parent=await make()
    await runTask(runner,'infojerman',parent.id)
    const child=(await store.tasks('infojerman')).find(t=>t.parentId===parent.id)!
    await store.transition('infojerman',child.id,'running',{actor:'uji'})
    await store.transition('infojerman',child.id,'failed',{actor:'uji'})
    await runTask(runner,'infojerman',parent.id)
    expect((await store.task('infojerman',parent.id))?.status).toBe('failed')
    expect(hermes.requests).toHaveLength(1)
    const cancelled=await make()
    await runTask(runner,'infojerman',cancelled.id)
    const cancelledChild=(await store.tasks('infojerman')).find(t=>t.parentId===cancelled.id)!
    await store.transition('infojerman',cancelled.id,'cancelled',{actor:'uji'})
    await runTask(runner,'infojerman',cancelledChild.id)
    expect((await store.task('infojerman',cancelledChild.id))?.status).toBe('cancelled')
    expect(hermes.requests).toHaveLength(2)
  })


  it('previews scoped notes without writes and matches the notes actually supplied to Hermes',async()=>{
    const chat=new ChatWorkspace(store)
    const rule=await store.addNote('infojerman',{kind:'rule',title:'QA preview aturan',body:'Wajib tinjau',agentType:'video-editor',active:true},'uji')
    const memory=await store.addNote('infojerman',{kind:'memory',title:'QA preview beasiswa',body:'Target mahasiswa',agentType:'video-editor',active:true},'uji')
    const hidden=await store.addNote('otca',{kind:'memory',title:'QA preview beasiswa rahasia',body:'Brand lain',agentType:'video-editor',active:true},'uji')
    try{
      const before=await db.query('SELECT count(*)::int AS n FROM agent_chat_memory')
      const preview=await chat.previewNotes('infojerman','video-editor','Beasiswa',true)
      expect(preview.notes.map(n=>n.id)).toEqual(expect.arrayContaining([rule.id,memory.id]))
      expect(preview.notes.find(n=>n.id===memory.id)?.reason).toContain('beasiswa')
      expect((await db.query('SELECT count(*)::int AS n FROM agent_chat_memory')).rows).toEqual(before.rows)
      const withoutMemory=await chat.previewNotes('infojerman','video-editor','Beasiswa',false)
      expect(withoutMemory.notes.some(n=>n.id===rule.id)).toBe(true)
      expect(withoutMemory.notes.every(n=>n.kind==='rule')).toBe(true)
      expect(JSON.stringify(preview)).not.toContain(hidden.id)
      const task=await chat.createChat('infojerman','video-editor','Beasiswa',{})
      const hermes=scriptedHermes([{output:'QA preview selesai'}])
      await runTask({...deps(hermes),chat},'infojerman',task.id)
      const trace=(await chat.evidence('infojerman','video-editor')).find(e=>e.taskId===task.id)!.trace
      expect(trace.notes.map((n:{id:string})=>n.id)).toEqual(preview.notes.map(n=>n.id))
      expect(hermes.requests[0].input).toContain('Target mahasiswa')
      expect(hermes.requests[0].input).not.toContain('Brand lain')
    }finally{await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[rule.id,memory.id,hidden.id]])}
  })

  it('persists per-message exclusions, protects rules and scope, and leaves stored memory unchanged',async()=>{
    const chat=new ChatWorkspace(store),brand='jepangkoey',agent='video-editor'
    const rule=await store.addNote(brand,{kind:'rule',title:'QA memory choice aturan',body:'QA-REVIEW-WAJIB',agentType:agent,active:true},'uji')
    const own=await store.addNote(brand,{kind:'memory',title:'Beasiswa pilihan',body:'QA-PRIVATE-NOTE',agentType:agent,active:true},'uji')
    const shared=await store.addNote(brand,{kind:'memory',title:'Beasiswa bersama',body:'QA-SHARED-NOTE',agentType:null,active:true},'uji')
    const other=await store.addNote(brand,{kind:'memory',title:'Beasiswa agent lain',body:'QA-OTHER-AGENT',agentType:'manager',active:true},'uji')
    const foreign=await store.addNote('otca',{kind:'memory',title:'Beasiswa brand lain',body:'QA-OTHER-BRAND',agentType:agent,active:true},'uji')
    try{
      const memory=await chat.memory(brand,agent)
      await chat.updateMemory(brand,agent,{revision:memory.revision,summary:'QA-SUMMARY-SECRET'})
      const before=(await store.tasks(brand)).length
      for(const id of [rule.id,other.id,foreign.id]){
        await expect(chat.createChat(brand,agent,'Beasiswa',{excludedMemoryIds:[id]})).rejects.toThrow('tidak tersedia')
        await expect(chat.previewNotes(brand,agent,'Beasiswa',true,{excludedMemoryIds:[id],useSummary:true})).rejects.toThrow('tidak tersedia')
      }
      expect((await store.tasks(brand)).length).toBe(before)
      const choices={excludedMemoryIds:[own.id],useSummary:false}
      const preview=await chat.previewNotes(brand,agent,'Beasiswa',true,choices)
      expect(preview.notes.map(n=>n.id)).toEqual(expect.arrayContaining([rule.id,shared.id]))
      expect(preview.notes.some(n=>n.id===own.id)).toBe(false)
      expect(preview.excludedNotes.map(n=>n.id)).toEqual([own.id])
      expect(preview.summary).toBeNull();expect(preview.summaryAvailable).toBe(true)
      const task=await chat.createChat(brand,agent,'Beasiswa',choices)
      expect(await chat.input(task)).toMatchObject(choices)
      const hermes=scriptedHermes([{output:'QA pemilihan selesai'}])
      await runTask({...deps(hermes),chat},brand,task.id)
      expect(hermes.requests[0].input).toContain('QA-REVIEW-WAJIB')
      expect(hermes.requests[0].input).toContain('QA-SHARED-NOTE')
      expect(hermes.requests[0].input).not.toContain('QA-PRIVATE-NOTE')
      expect(hermes.requests[0].input).not.toContain('QA-SUMMARY-SECRET')
      const trace=(await chat.evidence(brand,agent)).find(e=>e.taskId===task.id)!.trace
      expect(trace).toMatchObject({excludedNotes:[{id:own.id,title:own.title}],useSummary:false,summaryUsed:false})
      const next=await chat.createChat(brand,agent,'Beasiswa',{})
      expect((await chat.prepare(next)).notesText).toContain('QA-PRIVATE-NOTE')
      expect((await chat.prepare(next)).extra).toContain('QA-SUMMARY-SECRET')
      expect((await store.notesFor(brand,agent)).some(n=>n.id===own.id && n.active)).toBe(true)
      await db.query("UPDATE tasks SET status='cancelled' WHERE id=$1",[next.id])
    }finally{
      await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[rule.id,own.id,shared.id,other.id,foreign.id]])
      const current=await chat.memory(brand,agent);await chat.updateMemory(brand,agent,{revision:current.revision,clear:true})
    }
  })

  it('isolates chat attachments, selected skills and relevant memory with a durable evidence trail',async()=>{
    const chat=new ChatWorkspace(store)
    const file=await chat.upload('jepangkoey','content-creator','brief.md',Buffer.from('Target: mahasiswa beasiswa Jepang'))
    await expect(chat.createChat('otca','content-creator','Baca file',{attachmentIds:[file.id]})).rejects.toThrow('bukan milik')
    await store.addNote('jepangkoey',{kind:'memory',title:'Beasiswa Jepang',body:'Gaya bahasa ringkas',agentType:'content-creator',active:true},'uji')
    await store.addNote('jepangkoey',{kind:'memory',title:'Kopi',body:'Espresso tanpa gula',agentType:'content-creator',active:true},'uji')
    const task=await chat.createChat('jepangkoey','content-creator','Buat konten beasiswa Jepang',{attachmentIds:[file.id],skills:['content-outline']})
    const hermes=scriptedHermes([{output:'Draft beasiswa berdasarkan brief'}])
    await runTask({...deps(hermes),chat},'jepangkoey',task.id)
    expect(hermes.requests[0].input).toContain('Target: mahasiswa beasiswa Jepang')
    expect(hermes.requests[0].instructions).toContain('SKILL APLIKASI')
    expect(hermes.requests[0].input).toContain('Gaya bahasa ringkas')
    expect(hermes.requests[0].input).not.toContain('Espresso tanpa gula')
    const evidence=(await chat.evidence('jepangkoey','content-creator')).find(e=>e.taskId===task.id)!
    expect(evidence.trace.attachments[0]).toMatchObject({id:file.id,name:'brief.md'})
    expect(await chat.attachment('otca','content-creator',file.id)).toBeUndefined()
    expect(await chat.attachment('jepangkoey','manager',file.id)).toBeUndefined()
    await chat.removeAttachment('jepangkoey','content-creator',file.id)
    expect(await chat.attachment('jepangkoey','content-creator',file.id)).toBeUndefined()
    await expect(chat.prepare(task)).rejects.toThrow('dihapus')
  })
  it('summarizes old chats, preserves user edits and prevents forgotten summaries from being regenerated',async()=>{
    const chat=new ChatWorkspace(store)
    const rows=await db.query(`INSERT INTO tasks (brand_id,agent_type,kind,title,brief,result,status,created_by,created_at) SELECT 'jepangkoey','manager','konten.chat','Memory test','Preferensi konten',repeat('Jawaban draft ',200),'done','uji','2026-01-01'::timestamptz + n*interval '1 minute' FROM generate_series(1,16) n RETURNING id`)
    const latest=await store.task('jepangkoey',rows.rows[15].id)
    const hermes=scriptedHermes([{output:'Pengguna memilih konten pendidikan; jadwal belum dikonfirmasi.'}])
    await compactChat(chat,latest!,hermes,{url:'http://hermes',key:'test'},{source:'codex',reasoningEffort:'low'})
    const memory=await chat.memory('jepangkoey','manager')
    expect(memory.summary).toContain('konten pendidikan')
    await chat.updateMemory('jepangkoey','manager',{revision:memory.revision,summary:'Ringkasan pilihan pengguna'})
    await expect(chat.updateMemory('jepangkoey','manager',{revision:memory.revision,summary:'Versi lama'})).rejects.toThrow('telah berubah')
    const updated=await chat.memory('jepangkoey','manager')
    await chat.updateMemory('jepangkoey','manager',{revision:updated.revision,clear:true})
    await compactChat(chat,latest!,hermes,{url:'http://hermes',key:'test'},{source:'codex',reasoningEffort:'low'})
    expect((await chat.memory('jepangkoey','manager')).summary).toBe('')
    expect(hermes.requests).toHaveLength(1)
  })


  it('hands Manager attachments to its own specialists without granting another brand access',async()=>{
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','brief.md',Buffer.from('Kode handoff CIAO-831'))
    const sharedMemory=await store.addNote('ciaomanda',{kind:'memory',title:'Pilihan bersama',body:'QA-SHARED-EXCLUDE',agentType:null,active:true},'uji')
    const managerMemory=await store.addNote('ciaomanda',{kind:'memory',title:'Pilihan Manager',body:'QA-MANAGER-PRIVATE',agentType:'manager',active:true},'uji')
    const parent=await chat.createChat('ciaomanda','manager','Tulis caption dari brief',{attachmentIds:[file.id],skills:['document-search'],excludedMemoryIds:[sharedMemory.id,managerMemory.id],useSummary:false},{agentType:'manager',kind:'konten.orchestrasi',title:'Caption lampiran',brief:'Tulis caption',createdBy:'uji'})
    const plan=JSON.stringify({summary:'Caption dari lampiran',tasks:[{agentType:'content-creator',kind:'konten.caption',title:'Caption',brief:'Gunakan lampiran Manager'}]})
    const hermes=scriptedHermes([{output:plan},{output:'Caption CIAO-831'}])
    await runTask({...deps(hermes),chat},'ciaomanda',parent.id)
    const child=(await store.tasks('ciaomanda')).find(t=>t.parentId===parent.id)!
    expect((await chat.input(child)).attachmentIds).toEqual([file.id])
    expect(await chat.input(child)).toMatchObject({excludedMemoryIds:[sharedMemory.id],useSummary:false})
    expect(await chat.attachment('ciaomanda','content-creator',file.id)).toBeUndefined()
    await runTask({...deps(hermes),chat},'ciaomanda',child.id)
    expect(hermes.requests[1].input).toContain('CIAO-831')
    expect((await chat.prepare(child)).trace.tools).toContainEqual({name:'document-search',status:'completed'})
    expect(await chat.taskAttachment({...child,brandId:'otca'},file.id)).toBeUndefined()
    await db.query('UPDATE agent_notes SET active=false WHERE id=ANY($1::uuid[])',[[sharedMemory.id,managerMemory.id]])
  })


  it('processes all PDF pages beyond the old limit and preserves explicit ranges and cached progress',async()=>{
    const doc=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[]
    const bytes=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    for(let page=1;page<=8;page++){doc.addPage();doc.text('Halaman '+page+' isi dokumen lengkap. '+(page===8?'SENTINEL-HALAMAN-TERAKHIR':''))}doc.end()
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','eight-pages.pdf',await bytes)
    const task=await chat.createChat('ciaomanda','manager','Baca seluruh dokumen',{attachmentIds:[file.id]})
    const full=await chat.taskAttachment(task,file.id)
    const result=await processPdf(store,task,full!,undefined)
    expect(result.coverage).toMatchObject({total:8,selected:8,completed:8,range:'all'})
    expect(result.text).toContain('SENTINEL-HALAMAN-TERAKHIR')
    const selected=await processPdf(store,task,full!,'7-8')
    expect(selected.coverage.selected).toBe(2)
    expect(selected.text).not.toContain('halaman 1]')
    const saved=(await chat.attachments('ciaomanda','manager')).find(f=>f.id===file.id) as unknown as {processing:{status:string;completed:number}}
    expect(saved.processing).toMatchObject({status:'ready',completed:2})
    await chat.removeAttachment('ciaomanda','manager',file.id)
    expect((await db.query('SELECT page FROM chat_attachment_pages WHERE attachment_id=$1',[file.id])).rows).toHaveLength(0)
  },60000)


  it('resumes scanned PDFs after a page failure without re-reading successful pages',async()=>{
    const image=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer()
    const doc=new PDFDocument({autoFirstPage:false}),chunks:Buffer[]=[]
    const bytes=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
    for(let page=1;page<=7;page++){doc.addPage();doc.image(image,40,40)}doc.end()
    const chat=new ChatWorkspace(store),file=await chat.upload('ciaomanda','manager','seven-scans.pdf',await bytes)
    const task=await chat.createChat('ciaomanda','manager','Baca scan',{attachmentIds:[file.id]})
    const full=(await chat.taskAttachment(task,file.id))!
    let calls=0,fail=true
    const runtime={run:async(request:{input:string})=>{calls++;const page=Number(request.input.match(/halaman (\d+)/)?.[1]);return {runId:'ocr-'+page,status:fail&&page===4?'failed' as const:'completed' as const,output:fail&&page===4?'':'Teks hasil halaman '+page,model:'test',inputTokens:1,outputTokens:1}}}
    await expect(processPdf(store,task,full,undefined,runtime)).rejects.toThrow('1 halaman gagal')
    expect(calls).toBe(7)
    fail=false
    const result=await processPdf(store,task,full,undefined,runtime)
    expect(calls).toBe(8)
    expect(result.coverage).toMatchObject({total:7,completed:7,ocr:7})
    expect(result.text).toContain('Teks hasil halaman 7')
  },60000)


  it('reuses document summaries by content version and budget, and stores cache metrics honestly',async()=>{
    const chat=new ChatWorkspace(store),text='Dokumen panjang '.repeat(2000)
    const file=await chat.upload('otca','manager','cache-document.md',Buffer.from(text))
    const task=await chat.createChat('otca','manager','Halo',{attachmentIds:[]})
    let calls=0
    const runtime={run:async()=>{calls++;return {runId:'sum',status:'completed' as const,output:'Ringkasan dokumen',model:'m',inputTokens:1,outputTokens:1}}}
    const source={id:file.id,name:file.name,extracted:text}
    expect((await cachedDocumentContext(store,task,source,2000,runtime)).cacheHit).toBe(false)
    const first=calls
    expect((await cachedDocumentContext(store,task,source,2000,runtime)).cacheHit).toBe(true)
    expect(calls).toBe(first)
    expect((await cachedDocumentContext(store,task,{...source,extracted:text+' Versi baru'},2000,runtime)).cacheHit).toBe(false)
    const hermes=scriptedHermes([{output:'Halo, ada yang bisa dibantu?',cacheReadTokens:8,cacheWriteTokens:0}])
    await runTask({...deps(hermes),chat},'otca',task.id)
    const metric=(await db.query('SELECT metrics FROM chat_context_metrics WHERE task_id=$1',[task.id])).rows[0].metrics
    expect(metric).toMatchObject({cacheReadTokens:8,cacheWriteTokens:0,cacheStatus:'reported'})
    expect(metric.officialSelectedChars).toBeLessThan(metric.officialSourceChars)
    expect((await db.query('SELECT cache_read_tokens FROM cost_events WHERE task_id=$1',[task.id])).rows[0].cache_read_tokens).toBe(8)
    await chat.removeAttachment('otca','manager',file.id)
    expect((await db.query('SELECT * FROM document_context_cache WHERE attachment_id=$1',[file.id])).rows).toHaveLength(0)
  })

  it('parks a run that returns after the kill switch was pulled, without filing its result', async () => {
    const task = await store.createTask('otca', { agentType: 'manager', kind: 'konten.chat', title: 'ks-4', brief: 'x', createdBy: 'uji' })
    const hermes: HermesClient = {
      async run() {
        await store.setPaused('otca', 'manager', true, 'uji')
        return { runId: 'r', status: 'completed', output: 'jawaban', model: 'm', inputTokens: 1, outputTokens: 1 }
      },
    }
    await runTask(deps(hermes), 'otca', task.id)
    expect((await store.task('otca', task.id))?.status).toBe('paused')
    expect(await store.assets('otca', task.id)).toEqual([])
    await store.setPaused('otca', 'manager', false, 'uji')
    expect((await store.task('otca', task.id))?.status).toBe('queued')
  })
})

describe('model routing and question parsing', () => {
  it('reads the numbered questions, ignoring other lines', () => {
    expect(parseQuestions('Pengantar\n1. Satu?\n2) **Dua?**\n- catatan\n11. bukan')).toEqual(['Satu?', 'Dua?'])
  })
})
