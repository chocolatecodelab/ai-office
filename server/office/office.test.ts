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
    expect(hermes.requests[0].instructions).toContain('Selalu mulai dengan salam.')
    expect(hermes.requests[0].instructions).toContain('tengah bulan')
    expect(hermes.requests[0].instructions).not.toContain('jangan bocor')

    await store.updateNote('otca', rule.id, (current) => ({ ...current, active: false }), 'uji')
    await runTask(deps(hermes), 'otca', (await make('nt-2')).id)
    expect(hermes.requests[1].instructions).not.toContain('Selalu mulai dengan salam.')

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
