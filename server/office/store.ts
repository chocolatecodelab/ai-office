import { agentContextFiles, findContextDir } from '../otca-context.js'
import type { IntegrationMode } from '../integrations/index.js'
import { NOTE_LIMITS, type AgentNote, type NoteInput } from './agent-notes.js'
import { extractArtifacts } from './artifacts.js'
import type { FileStore } from './file-store.js'
import type { Route, RouteOverrides, Weight } from './model-routes.js'
import { brandStyle } from './pdf-html.js'
import { renderDocumentPdf } from './render-pdf.js'
import { screenContent, type ContentQc } from './content-qc.js'
import type pg from 'pg'
import { transaction, type Db, type Queryable } from '../db/index.js'
import { approvalTypeFor, type ApprovalType } from './approval-routes.js'
import type { OfficeBus } from './bus.js'
import { agentStatus, assertTransition, type AgentStatus, type TaskStatus } from './status.js'

// Every read and write of brand-owned rows goes through here and takes the brand id first, so a
// query can never forget the brand filter (FR-31). Changes are written to the audit log and
// announced on the bus.

export interface Task {
  id: string
  brandId: string
  agentType: string
  parentId: string | null
  eventId: string | null
  kind: string
  title: string
  brief: string
  priority: number
  urgent: boolean
  complex: boolean
  status: TaskStatus
  attempts: number
  runId: string | null
  result: string | null
  error: string | null
  retryAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface Approval {
  id: string
  taskId: string
  brandId: string
  approvalType: ApprovalType
  decision: 'approved' | 'rejected' | null
  note: string | null
  decidedBy: string | null
  decidedAt: string | null
  createdAt: string
}

export interface Asset { id: string; taskId: string; kind: string; version: number; content: string; createdAt: string }

export interface AgentView { brandId: string; agentType: string; active: boolean; paused: boolean; status: AgentStatus; currentTask: string | null }

export interface ActivityEntry {
  at: string; brandId: string; kind: 'audit' | 'status'; actor: string; action: string; title: string | null
  objectType?: string; from?: TaskStatus; to?: TaskStatus; reason?: string | null
}

export interface AssetListItem { id: string; taskId: string; kind: string; version: number; name: string | null; mime: string | null; downloadable: boolean; size: number; excerpt: string; title: string; agentType: string; createdAt: string }

export interface TaskUsage { runs: number; inputTokens: number; outputTokens: number; durationMs: number | null; source: 'codex' | 'litellm'; model: string }

export interface UsageRow { runs: number; inputTokens: number; outputTokens: number; costUsd: number; tokens: number }
export interface OfficeUsage {
  totals: UsageRow
  brands: Array<UsageRow & { brandId: string; label: string }>
  agents: Array<UsageRow & { brandId: string; agentType: string; brandName: string }>
  kinds: Array<UsageRow & { kind: string }>
  models: Array<UsageRow & { source: string; model: string }>
}

export interface NewTask {
  agentType: string
  kind: string
  title: string
  brief?: string
  priority?: number
  urgent?: boolean
  complex?: boolean
  parentId?: string
  eventId?: string
  createdBy: string
}

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : (value as string | null)

function toTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string, brandId: row.brand_id as string, agentType: row.agent_type as string,
    parentId: row.parent_id as string | null, eventId: row.event_id as string | null,
    kind: row.kind as string, title: row.title as string, brief: row.brief as string,
    priority: row.priority as number, urgent: row.urgent as boolean, complex: row.complex as boolean,
    status: row.status as TaskStatus, attempts: row.attempts as number, runId: row.run_id as string | null,
    result: row.result as string | null, error: row.error as string | null, retryAt: iso(row.retry_at),
    createdBy: row.created_by as string, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
    startedAt: iso(row.started_at), completedAt: iso(row.completed_at),
  }
}

function toApproval(row: Record<string, unknown>): Approval {
  return {
    id: row.id as string, taskId: row.task_id as string, brandId: row.brand_id as string,
    approvalType: row.approval_type as ApprovalType, decision: row.decision as Approval['decision'],
    note: row.note as string | null, decidedBy: row.decided_by as string | null,
    decidedAt: iso(row.decided_at), createdAt: iso(row.created_at)!,
  }
}

function toNote(row: Record<string, unknown>): AgentNote {
  return {
    id: row.id as string, brandId: row.brand_id as string, agentType: row.agent_type as string | null, kind: row.kind as AgentNote['kind'],
    title: row.title as string, body: row.body as string, active: row.active as boolean, createdBy: row.created_by as string, updatedBy: row.updated_by as string,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  }
}

export interface ConnectionInfo { brandId: string; service: string; account: string; status: 'active' | 'needs_reauth'; scopes: string; connectedAt: string }
export interface ConnectionSecret { account: string; accessToken: string; refreshToken: string | null; expiresAt?: Date; status: 'active' | 'needs_reauth' }

export async function audit(db: Queryable, entry: { actor: string; action: string; objectType: string; objectId: string; brandId?: string; before?: unknown; after?: unknown }): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (actor, action, object_type, object_id, brand_id, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [entry.actor, entry.action, entry.objectType, entry.objectId, entry.brandId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before), entry.after === undefined ? null : JSON.stringify(entry.after)])
}

export class OfficeStore {
  constructor(readonly db: Db, private readonly bus: OfficeBus, private readonly files?: FileStore) {}

  async brands(): Promise<Array<{ id: string; name: string; color: string; paused: boolean }>> {
    return (await this.db.query('SELECT id, name, color, paused FROM brands ORDER BY id')).rows
  }

  async summary(brandId: string): Promise<{ queued: number; approvals: number; waitingQuota: number }> {
    const { rows } = await this.db.query(`SELECT
      (SELECT count(*)::int FROM tasks WHERE brand_id = $1 AND status = 'queued') AS queued,
      (SELECT count(*)::int FROM approvals a JOIN tasks t ON t.id=a.task_id AND t.brand_id=a.brand_id WHERE a.brand_id = $1 AND a.decision IS NULL AND t.status='waiting_approval') AS approvals,
      (SELECT count(*)::int FROM tasks WHERE brand_id = $1 AND status = 'waiting_quota') AS "waitingQuota"`, [brandId])
    return rows[0]
  }

  /** Runs and tokens of the last `days` days, from cost_events, grouped per brand, agent, kind of work and model. */
  async usage(days: number): Promise<OfficeUsage> {
    const since = `c.created_at >= now() - ($1::int * interval '1 day')`
    const sums = 'count(*)::int AS runs, coalesce(sum(c.input_tokens), 0)::int AS "inputTokens", coalesce(sum(c.output_tokens), 0)::int AS "outputTokens", coalesce(sum(c.cost_usd), 0)::float AS "costUsd"'
    const [brands, agents, kinds, models] = await Promise.all([
      this.db.query(`SELECT c.brand_id AS "brandId", coalesce(b.name, c.brand_id) AS label, ${sums} FROM cost_events c LEFT JOIN brands b ON b.id = c.brand_id WHERE ${since} GROUP BY 1, 2`, [days]),
      this.db.query(`SELECT c.brand_id AS "brandId", coalesce(t.agent_type, '—') AS "agentType", coalesce(b.name, c.brand_id) AS "brandName", ${sums} FROM cost_events c LEFT JOIN tasks t ON t.id = c.task_id LEFT JOIN brands b ON b.id = c.brand_id WHERE ${since} GROUP BY 1, 2, 3`, [days]),
      this.db.query(`SELECT coalesce(t.kind, '—') AS kind, ${sums} FROM cost_events c LEFT JOIN tasks t ON t.id = c.task_id WHERE ${since} GROUP BY 1`, [days]),
      this.db.query(`SELECT c.source, c.model, ${sums} FROM cost_events c WHERE ${since} GROUP BY 1, 2`, [days]),
    ])
    const rows = (result: pg.QueryResult) => result.rows.map((row) => ({ ...row, tokens: row.inputTokens + row.outputTokens }))
    const totals = rows(brands).reduce((sum, row) => ({ runs: sum.runs + row.runs, tokens: sum.tokens + row.tokens, inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens, costUsd: sum.costUsd + row.costUsd }), { runs: 0, tokens: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })
    const byTokens = (a: { tokens: number }, b: { tokens: number }) => b.tokens - a.tokens
    return { totals, brands: rows(brands).sort(byTokens), agents: rows(agents).sort(byTokens), kinds: rows(kinds).sort(byTokens), models: rows(models).sort(byTokens) }
  }

  /** The brand's latest audit entries and task status changes, newest first. */
  async activity(brandId: string, limit = 60): Promise<ActivityEntry[]> {
    const [audit, status] = await Promise.all([
      this.db.query(
        `SELECT a.created_at, a.actor, a.action, a.object_type AS "objectType", a.object_id AS "objectId",
                coalesce((SELECT t.title FROM tasks t WHERE t.brand_id = a.brand_id AND t.id::text = a.object_id),
                         (SELECT t.title FROM approvals p JOIN tasks t ON t.id = p.task_id WHERE p.brand_id = a.brand_id AND p.id::text = a.object_id)) AS title
           FROM audit_log a WHERE a.brand_id = $1 ORDER BY a.id DESC LIMIT $2`, [brandId, limit]),
      this.db.query(
        `SELECT e.created_at, e.payload, t.title FROM task_events e JOIN tasks t ON t.id = e.task_id AND t.brand_id = e.brand_id
          WHERE e.brand_id = $1 AND e.type = 'status' ORDER BY e.id DESC LIMIT $2`, [brandId, limit]),
    ])
    const audited = audit.rows.map((row): ActivityEntry => ({ at: iso(row.created_at)!, brandId, kind: 'audit', actor: row.actor, action: row.action, title: row.title ?? (row.objectType === 'brand' || row.objectType === 'agent' ? row.objectId : null), objectType: row.objectType }))
    // A decision is written as an audit entry and a status change in one transaction; show it once.
    const decided = new Set(audited.map((entry) => `${entry.at}|${entry.title}`))
    const entries: ActivityEntry[] = [
      ...audited,
      ...status.rows.filter((row) => !decided.has(`${iso(row.created_at)}|${row.title}`)).map((row): ActivityEntry => ({ at: iso(row.created_at)!, brandId, kind: 'status', actor: row.payload.by ?? 'sistem', action: 'task.status', title: row.title, from: row.payload.from, to: row.payload.to, reason: row.payload.reason ?? null })),
    ]
    return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
  }

  async agents(brandId: string): Promise<AgentView[]> {
    const { rows } = await this.db.query(
      `SELECT a.brand_id, a.agent_type, a.active, a.paused OR b.paused AS paused,
              coalesce(array_agg(t.status) FILTER (WHERE t.status IS NOT NULL), '{}') AS statuses,
              (array_agg(t.title ORDER BY CASE t.status WHEN 'running' THEN 0 WHEN 'revision' THEN 1 WHEN 'waiting_quota' THEN 2 WHEN 'failed' THEN 3 ELSE 4 END, t.updated_at DESC) FILTER (WHERE t.status IN ('running', 'revision', 'waiting_quota', 'waiting_approval', 'failed')))[1] AS current_task,
              min(t.retry_at) FILTER (WHERE t.status = 'waiting_quota') AS retry_at
         FROM agents a JOIN brands b ON b.id = a.brand_id
         LEFT JOIN tasks t ON t.brand_id = a.brand_id AND t.agent_type = a.agent_type
              AND t.status IN ('running', 'waiting_quota', 'waiting_approval', 'revision', 'failed')
        WHERE a.brand_id = $1
        GROUP BY a.brand_id, a.agent_type, a.active, a.paused, b.paused
        ORDER BY a.agent_type`, [brandId])
    return rows.map((row) => ({
      brandId: row.brand_id, agentType: row.agent_type, active: row.active, paused: row.paused,
      status: agentStatus(row.statuses, row.paused), currentTask: row.current_task ?? null, retryAt: iso(row.retry_at),
    }))
  }

  /**
   * Kill switch (FR-26): pause or resume a whole brand (no agentType) or one agent. Pausing parks the
   * brand's or agent's queued, waiting_quota and revision tasks; a run already in flight is parked by the
   * runner when it returns. Resuming puts the parked tasks back to queued. Returns the tasks it moved.
   */
  async setPaused(brandId: string, agentType: string | undefined, paused: boolean, actor: string): Promise<Task[]> {
    return transaction(this.db, async (tx) => {
      const flag = agentType
        ? await tx.query('UPDATE agents SET paused = $3 WHERE brand_id = $1 AND agent_type = $2 RETURNING agent_type', [brandId, agentType, paused])
        : await tx.query('UPDATE brands SET paused = $2 WHERE id = $1 RETURNING id', [brandId, paused])
      if (flag.rowCount === 0) throw new Error(agentType ? `Agent ${agentType} tidak ada di brand ${brandId}.` : `Brand ${brandId} tidak ada.`)
      await audit(tx, { actor, action: paused ? 'kill-switch.pause' : 'kill-switch.resume', objectType: agentType ? 'agent' : 'brand', objectId: agentType ? `${brandId}/${agentType}` : brandId, brandId })
      const from = paused ? ['queued', 'waiting_quota', 'revision'] : ['paused']
      const { rows } = await tx.query('SELECT id FROM tasks WHERE brand_id = $1 AND ($2::text IS NULL OR agent_type = $2) AND status = ANY($3::text[]) ORDER BY created_at', [brandId, agentType ?? null, from])
      const moved: Task[] = []
      for (const row of rows) moved.push(await this.transition(brandId, row.id as string, paused ? 'paused' : 'queued', { actor, reason: paused ? 'kill switch aktif' : 'kill switch dilepas', ...(paused ? {} : { patch: { attempts: 0, retry_at: null } }) }, tx))
      return moved
    })
  }

  async isPaused(brandId: string, agentType: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT a.paused OR b.paused AS paused FROM agents a JOIN brands b ON b.id = a.brand_id WHERE a.brand_id = $1 AND a.agent_type = $2',
      [brandId, agentType])
    return rows[0]?.paused ?? true
  }

  get checkpointFileStore(){return this.files}

  async createTask(brandId: string, input: NewTask, client: Queryable = this.db): Promise<Task> {
    if(input.kind==='konten.carousel-produksi'&&(input.agentType!=='content-creator'||!input.parentId))throw new Error('Produksi carousel tim harus ditugaskan kepada Content Creator melalui Manager.')
    if(input.kind==='video.rencana-produksi'&&(input.agentType!=='video-editor'||!input.parentId))throw new Error('Rencana produksi video tim harus ditugaskan kepada Video Editor melalui Manager.')
    if(input.kind==='konten.orchestrasi' && (input.agentType!=='manager' || input.parentId))throw new Error('Orkestrasi hanya untuk Manager sebagai tugas induk.')
    approvalTypeFor(input.kind) // reject work types without an approval route up front
    const agent = await client.query('SELECT active FROM agents WHERE brand_id = $1 AND agent_type = $2', [brandId, input.agentType])
    if (!agent.rows[0]?.active) throw new Error(`Agen ${input.agentType} tidak aktif di brand ${brandId}.`)
    const { rows } = await client.query(
      `INSERT INTO tasks (brand_id, agent_type, parent_id, event_id, kind, title, brief, priority, urgent, complex, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [brandId, input.agentType, input.parentId ?? null, input.eventId ?? null, input.kind, input.title, input.brief ?? '',
        input.priority ?? 2, input.urgent ?? false, input.complex ?? false, input.createdBy])
    const task = toTask(rows[0])
    await this.logEvent(client, task, 'created', { by: input.createdBy })
    await audit(client, { actor: input.createdBy, action: 'task.create', objectType: 'task', objectId: task.id, brandId, after: { kind: task.kind, title: task.title, agentType: task.agentType } })
    this.bus.publish({ type: 'task', brandId, taskId: task.id, status: task.status })
    return task
  }

  async task(brandId: string, taskId: string, client: Queryable = this.db): Promise<Task | undefined> {
    const { rows } = await client.query('SELECT * FROM tasks WHERE brand_id = $1 AND id = $2', [brandId, taskId])
    return rows[0] ? toTask(rows[0]) : undefined
  }

  async tasks(brandId: string, filter: { status?: TaskStatus; eventId?: string; limit?: number } = {}): Promise<Task[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM tasks WHERE brand_id = $1 AND ($2::text IS NULL OR status = $2) AND ($3::uuid IS NULL OR event_id = $3)
        ORDER BY created_at DESC LIMIT $4`,
      [brandId, filter.status ?? null, filter.eventId ?? null, filter.limit ?? 200])
    return rows.map(toTask)
  }

  /** Tasks the queue must (re)schedule after a restart. */
  async pendingTasks(): Promise<Task[]> {
    const { rows } = await this.db.query(`SELECT * FROM tasks WHERE status IN ('queued', 'running', 'waiting_quota', 'revision') ORDER BY created_at`)
    return rows.map(toTask)
  }

  /**
   * Moves a task to another status inside a row lock, checking the transition, and records why.
   * `patch` sets other columns in the same update.
   */
  async transition(brandId: string, taskId: string, to: TaskStatus, detail: { actor: string; reason?: string; patch?: Partial<Record<'run_id' | 'result' | 'error' | 'retry_at' | 'attempts' | 'started_at' | 'completed_at', unknown>> }, client?: pg.PoolClient): Promise<Task> {
    const work = async (tx: Queryable) => {
      const { rows } = await tx.query('SELECT * FROM tasks WHERE brand_id = $1 AND id = $2 FOR UPDATE', [brandId, taskId])
      if (!rows[0]) throw new Error(`Tugas ${taskId} tidak ditemukan di brand ${brandId}.`)
      const before = toTask(rows[0])
      assertTransition(before.status, to)
      const patch = Object.entries(detail.patch ?? {})
      const sets = ['status = $3', 'updated_at = now()', ...patch.map(([column], index) => `${column} = $${index + 4}`)]
      const updated = await tx.query(`UPDATE tasks SET ${sets.join(', ')} WHERE brand_id = $1 AND id = $2 RETURNING *`,
        [brandId, taskId, to, ...patch.map(([, value]) => value)])
      const task = toTask(updated.rows[0])
      await this.logEvent(tx, task, 'status', { from: before.status, to, reason: detail.reason ?? null, by: detail.actor })
      return task
    }
    const task = client ? await work(client) : await transaction(this.db, work)
    this.bus.publish({ type: 'task', brandId, taskId, status: task.status })
    return task
  }

  async logEvent(client: Queryable, task: Pick<Task, 'id' | 'brandId'>, type: string, payload: Record<string, unknown>): Promise<void> {
    await client.query('INSERT INTO task_events (task_id, brand_id, type, payload) VALUES ($1, $2, $3, $4)', [task.id, task.brandId, type, JSON.stringify(payload)])
  }

  async taskEvents(brandId: string, taskId: string): Promise<Array<{ type: string; payload: Record<string, unknown>; createdAt: string }>> {
    const { rows } = await this.db.query('SELECT type, payload, created_at FROM task_events WHERE brand_id = $1 AND task_id = $2 ORDER BY id', [brandId, taskId])
    return rows.map((row) => ({ type: row.type, payload: row.payload, createdAt: iso(row.created_at)! }))
  }

  /**
   * Stores a finished run: the output becomes the next asset version, the task waits for the
   * approval its kind needs, and the run's token use is recorded.
   */
  async submitForApproval(brandId: string, taskId: string, output: { content: string; runId: string; source: 'codex' | 'litellm'; model: string; inputTokens: number; outputTokens: number; durationMs?: number; cacheReadTokens?:number|null;cacheWriteTokens?:number|null }): Promise<{ task: Task; approval: Approval }> {
    const result = await transaction(this.db, async (tx) => {
      const current = await this.task(brandId, taskId, tx)
      if (!current) throw new Error(`Tugas ${taskId} tidak ditemukan di brand ${brandId}.`)
      const version = (await tx.query('SELECT coalesce(max(version), 0) + 1 AS next FROM assets WHERE task_id = $1', [taskId])).rows[0].next as number
      await tx.query('INSERT INTO assets (task_id, brand_id, kind, version, content) VALUES ($1, $2, $3, $4, $5)', [taskId, brandId, current.kind, version, output.content])
      if(current.agentType==='content-creator' && current.kind!=='konten.chat') {
        const dir=findContextDir()
        const checklist=dir ? agentContextFiles(dir,current.agentType,brandId)?.find(file=>file.path.endsWith('checklist-publikasi.md'))?.content ?? '' : ''
        await this.logEvent(tx,current,'content_qc',{version,report:screenContent(output.content,checklist)})
      }
      await tx.query('INSERT INTO cost_events (task_id, brand_id, source, model, input_tokens, output_tokens, duration_ms,cache_read_tokens,cache_write_tokens) VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9)',
        [taskId, brandId, output.source, output.model, output.inputTokens, output.outputTokens, output.durationMs ?? null,output.cacheReadTokens??null,output.cacheWriteTokens??null])
      const task = await this.transition(brandId, taskId, 'waiting_approval', { actor: `agent:${current.agentType}`, reason: `hasil v${version}`, patch: { result: output.content, error: null, run_id: output.runId } }, tx)
      const { rows } = await tx.query('INSERT INTO approvals (task_id, brand_id, approval_type) VALUES ($1, $2, $3) RETURNING *', [taskId, brandId, approvalTypeFor(current.kind)])
      return { task, approval: toApproval(rows[0]) }
    })
    this.bus.publish({ type: 'approval', brandId, approvalId: result.approval.id, taskId, decision: null })
    return result
  }

  /** Local pipeline results have no fictional model run or token cost. */
  async submitProduction(brandId:string,taskId:string,output:import('./production-engines.js').ProductionResult) {
    if(!this.files)throw new Error('Penyimpanan hasil produksi belum tersedia.')
    const files=await Promise.all(output.files.map(async file=>({...file,key:await this.files!.put(brandId,file.name.split('.').pop()??'bin',file.data)})))
    const result=await transaction(this.db,async tx=>{
      await tx.query('SELECT id FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brandId,taskId])
      const current=await this.task(brandId,taskId,tx)
      if(!current||current.status!=='running')throw new Error('Tugas produksi sudah dihentikan atau statusnya berubah.')
      if(await this.isPaused(brandId,current.agentType))throw new Error('Agent dijeda; hasil belum diajukan.')
      let version=Number((await tx.query('SELECT coalesce(max(version),0) AS n FROM assets WHERE task_id=$1',[taskId])).rows[0].n)
      await tx.query('INSERT INTO assets(task_id,brand_id,kind,version,content) VALUES($1,$2,$3,$4,$5)',[taskId,brandId,current.kind,++version,output.content])
      for(const file of files)await tx.query('INSERT INTO assets(task_id,brand_id,kind,version,content,name,mime,storage_key,size_bytes) VALUES($1,$2,\'artifact\',$3,$4,$5,$6,$7,$8)',[taskId,brandId,++version,file.mime.startsWith('text/')||file.mime==='application/json'?file.data.toString('utf8'):`Hasil pipeline: ${file.name}`,file.name,file.mime,file.key,file.data.length])
      await this.logEvent(tx,current,'production_completed',output.report)
      const source=(await tx.query("SELECT payload->>'sourceTaskId' AS id FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='carousel_source' ORDER BY id DESC LIMIT 1",[brandId,taskId])).rows[0]?.id
      if(source&&source!==taskId){
        const previous=await this.task(brandId,source,tx)
        if(previous?.agentType===current.agentType&&previous.status==='waiting_approval'){
          await this.transition(brandId,previous.id,'cancelled',{actor:'worker:production',reason:'Digantikan hasil revisi yang sudah selesai'},tx)
          await this.logEvent(tx,previous,'result_superseded',{replacementTaskId:taskId})
        }
      }
      await tx.query("UPDATE production_jobs SET stage='review',report=$3,updated_at=now() WHERE brand_id=$1 AND task_id=$2",[brandId,taskId,JSON.stringify(output.report)])
      const task=await this.transition(brandId,taskId,'waiting_approval',{actor:`agent:${current.agentType}`,reason:'hasil pipeline lokal; perlu review manusia',patch:{result:output.content,error:null}},tx)
      const approval=(await tx.query('INSERT INTO approvals(task_id,brand_id,approval_type) VALUES($1,$2,$3) RETURNING *',[taskId,brandId,approvalTypeFor(current.kind)])).rows[0]
      if(current.parentId){
        const parent=await this.task(brandId,current.parentId,tx)
        if(parent?.kind==='konten.chat')await this.completeProductionChat(brandId,parent.id,taskId,tx)
      }
      return {task,approval:toApproval(approval)}
    })
    this.bus.publish({type:'approval',brandId,approvalId:result.approval.id,taskId,decision:null})
    return result
  }

  /** Finish the conversation, while the separate production task still awaits human approval. */
  async completeProductionChat(brandId:string,chatId:string,productionId:string,client?:pg.PoolClient){
    const work=async(tx:pg.PoolClient)=>{
      await tx.query('SELECT id FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brandId,chatId])
      const parent=await this.task(brandId,chatId,tx),child=await this.task(brandId,productionId,tx)
      if(!parent||parent.kind!=='konten.chat'||!child||child.parentId!==chatId||child.agentType!==parent.agentType||!['waiting_approval','approved','done'].includes(child.status))throw new Error('Hasil produksi tidak terhubung dengan percakapan ini.')
      if(parent.status==='done')return parent
      if(parent.status==='failed'){
        await this.transition(brandId,chatId,'queued',{actor:'worker:production',reason:'pemulihan tugas anak yang berhasil'},tx)
        await this.transition(brandId,chatId,'running',{actor:'worker:production'},tx)
      }else if(parent.status==='queued'){
        await this.transition(brandId,chatId,'running',{actor:'worker:production'},tx)
      }else if(parent.status!=='running'){
        throw new Error('Percakapan produksi sudah dihentikan atau dijeda.')
      }
      const count=Number((await tx.query("SELECT count(*) AS n FROM assets WHERE brand_id=$1 AND task_id=$2 AND name ~ '^slide-[0-9]+[.]png$'",[brandId,productionId])).rows[0].n)
      const nativeSnapshot=(await tx.query("SELECT 1 FROM assets WHERE brand_id=$1 AND task_id=$2 AND name='storyboard-visual.html'",[brandId,productionId])).rowCount
      const videoResult=(await tx.query("SELECT 1 FROM assets WHERE brand_id=$1 AND task_id=$2 AND mime='video/mp4'",[brandId,productionId])).rowCount
      const thumbnailOnly=(await tx.query("SELECT 1 FROM assets WHERE brand_id=$1 AND task_id=$2 AND name='thumbnail-revision.json'",[brandId,productionId])).rowCount
      const videoPreview=(await tx.query("SELECT 1 FROM assets WHERE brand_id=$1 AND task_id=$2 AND name='video-revision.json'",[brandId,productionId])).rowCount
      const restored=(await tx.query("SELECT payload->>'restoredFrom' AS id FROM production_jobs WHERE brand_id=$1 AND task_id=$2",[brandId,productionId])).rows[0]?.id
      const reply=restored?'Versi sebelumnya dipulihkan sebagai versi baru. Berkas tersedia di bawah; hasil ini memerlukan persetujuan ulang sebelum publikasi.':videoResult?'Video selesai dirender. MP4 dengan audio asli yang dinormalisasi dan laporan pemeriksaan tersedia di bawah. Tinjau hasil sebelum publikasi.':nativeSnapshot?'Storyboard visual siap ditinjau. Buka storyboard-visual.html untuk melihat komposisi dan still tiap adegan. Berikan persetujuan visual di tab Review untuk melanjutkan render video Remotion.':videoPreview?'Preview revisi video tersedia di bawah. Tinjau adegan yang berubah sebelum render final; MP4 sebelumnya tetap.':thumbnailOnly?'Thumbnail sudah direvisi. Cover 9:16 dan 3:4 tersedia di bawah untuk ditinjau. MP4 tetap, tanpa render ulang video.':child.agentType==='video-editor'?'Naskah dan rencana adegan siap ditinjau. Berkas proyek dan subtitle draf tersedia di bawah.\n\nTiming subtitle masih estimasi. Lengkapi bahan, buat storyboard visual, dan tinjau hasilnya sebelum render penuh.':`${count} slide carousel selesai dibuat. Gambar dan berkas unduhan tersedia di bawah.\n\nHasil masih draf untuk ditinjau; belum dipublikasikan. Caption, spesifikasi, dan laporan QA juga tersimpan di Folder agent.`
      await tx.query('INSERT INTO assets(task_id,brand_id,kind,version,content) SELECT $1,$2,\'konten.chat\',coalesce(max(version),0)+1,$3 FROM assets WHERE task_id=$1',[chatId,brandId,reply])
      await this.logEvent(tx,parent,'chat_production_completed',{taskId:productionId,slides:count})
      return this.transition(brandId,chatId,'done',{actor:'worker:production',reason:'hasil produksi ditampilkan di chat',patch:{result:reply,error:null,completed_at:new Date().toISOString()}},tx)
    }
    return client?work(client):transaction(this.db,work)
  }

  /**
   * Stores a finished chat reply. Chat is conversation, not publication, so the reply finishes
   * as done without an approval; every other kind of work goes through submitForApproval.
   */
  async completeChat(brandId: string, taskId: string, output: Parameters<OfficeStore['submitForApproval']>[2]): Promise<Task> {
    // A *.pdf file is rendered first, outside the transaction: the file store gets the bytes, the asset keeps the key.
    const artifacts = extractArtifacts(output.content).artifacts
    const binaries = new Map<string, { key: string; size: number }>()
    const pdfFiles = artifacts.filter((item) => item.name.endsWith('.pdf'))
    if (this.files && pdfFiles.length > 0) {
      const brand = (await this.brands()).find((item) => item.id === brandId)
      const style = brandStyle(brandId, brand?.name ?? brandId, brand?.color ?? '')
      for (const file of pdfFiles) {
        try {
          const pdf = await renderDocumentPdf(file.content, { name: file.name, brand: style })
          binaries.set(file.name, { key: await this.files.put(brandId, 'pdf', pdf), size: pdf.length })
        } catch (error) {
          console.warn(`PDF ${file.name} gagal dibuat; sumbernya tetap disimpan:`, error instanceof Error ? error.message : error)
        }
      }
    }
    return transaction(this.db, async (tx) => {
      const current = await this.task(brandId, taskId, tx)
      if (!current) throw new Error(`Tugas ${taskId} tidak ditemukan di brand ${brandId}.`)
      if (current.kind !== 'konten.chat') throw new Error(`Tugas ${taskId} bukan balasan chat; gunakan submitForApproval.`)
      const version = (await tx.query('SELECT coalesce(max(version), 0) + 1 AS next FROM assets WHERE task_id = $1', [taskId])).rows[0].next as number
      await tx.query('INSERT INTO assets (task_id, brand_id, kind, version, content) VALUES ($1, $2, $3, $4, $5)', [taskId, brandId, current.kind, version, output.content])
      // Files the reply carries (artifacts.ts) become assets of their own, numbered after the reply.
      for (const [index, file] of artifacts.entries()) {
        const binary = binaries.get(file.name)
        await tx.query('INSERT INTO assets (task_id, brand_id, kind, version, content, name, mime, storage_key, size_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [taskId, brandId, 'artifact', version + 1 + index, file.content, file.name, binary ? 'application/pdf' : null, binary?.key ?? null, binary?.size ?? null])
      }
      await tx.query('INSERT INTO cost_events (task_id, brand_id, source, model, input_tokens, output_tokens, duration_ms,cache_read_tokens,cache_write_tokens) VALUES ($1, $2, $3, $4, $5, $6, $7,$8,$9)',
        [taskId, brandId, output.source, output.model, output.inputTokens, output.outputTokens, output.durationMs ?? null,output.cacheReadTokens??null,output.cacheWriteTokens??null])
      return this.transition(brandId, taskId, 'done', { actor: `agent:${current.agentType}`, reason: `balasan chat v${version}`, patch: { result: output.content, error: null, run_id: output.runId } }, tx)
    })
  }

  async latestContentQc(brandId:string,taskId:string):Promise<ContentQc | undefined> {
    const {rows}=await this.db.query("SELECT payload FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='content_qc' ORDER BY id DESC LIMIT 1",[brandId,taskId])
    return rows[0]?.payload.report as ContentQc | undefined
  }

  /** The model overrides staff set, per agent role and weight (agent_routes). */
  async routeOverrides(): Promise<Map<string, RouteOverrides>> {
    const { rows } = await this.db.query('SELECT agent_type, weight, source, model, reasoning_effort FROM agent_routes')
    const overrides = new Map<string, RouteOverrides>()
    for (const row of rows) {
      const route: Route = { source: row.source, ...(row.model ? { model: row.model as string } : {}), ...(row.source === 'litellm' ? { provider: 'litellm' as const } : {}), reasoningEffort: row.reasoning_effort }
      overrides.set(row.agent_type, { ...overrides.get(row.agent_type), [row.weight as Weight]: route })
    }
    return overrides
  }

  async setRoute(agentType: string, weight: Weight, route: Route, actor: string): Promise<void> {
    await transaction(this.db, async (tx) => {
      const before = (await tx.query('SELECT source, model, reasoning_effort FROM agent_routes WHERE agent_type = $1 AND weight = $2', [agentType, weight])).rows[0] ?? null
      await tx.query(
        `INSERT INTO agent_routes (agent_type, weight, source, model, reasoning_effort, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (agent_type, weight) DO UPDATE SET source = $3, model = $4, reasoning_effort = $5, updated_by = $6, updated_at = now()`,
        [agentType, weight, route.source, route.model ?? null, route.reasoningEffort, actor])
      await audit(tx, { actor, action: 'model.set', objectType: 'agent-route', objectId: `${agentType}/${weight}`, before, after: route })
    })
  }

  /** All rules and memory of a brand, rules first, newest first (for the Memory views). */
  async agentNotes(brandId: string): Promise<AgentNote[]> {
    const { rows } = await this.db.query('SELECT * FROM agent_notes WHERE brand_id = $1 ORDER BY kind DESC, updated_at DESC', [brandId])
    return rows.map(toNote)
  }

  /** The notes one agent is told: its own and the brand-wide ones; inactive ones are included, notesPrompt skips them. */
  async notesFor(brandId: string, agentType: string): Promise<AgentNote[]> {
    const { rows } = await this.db.query('SELECT * FROM agent_notes WHERE brand_id = $1 AND (agent_type IS NULL OR agent_type = $2) AND active', [brandId, agentType])
    return rows.map(toNote)
  }

  async addNote(brandId: string, input: NoteInput, actor: string, client?: Queryable): Promise<AgentNote> {
    const work = async (tx: Queryable) => {
      const count = Number((await tx.query('SELECT count(*) FROM agent_notes WHERE brand_id = $1', [brandId])).rows[0].count)
      if (count >= NOTE_LIMITS.perBrand) throw new Error(`Satu brand maksimal ${NOTE_LIMITS.perBrand} catatan; hapus yang tidak terpakai dulu.`)
      const { rows } = await tx.query(
        'INSERT INTO agent_notes (brand_id, agent_type, kind, title, body, active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING *',
        [brandId, input.agentType, input.kind, input.title, input.body, input.active, actor])
      const note = toNote(rows[0])
      await audit(tx, { actor, action: 'note.create', objectType: 'agent-note', objectId: note.id, brandId, after: input })
      return note
    }
    return client ? work(client) : transaction(this.db, work)
  }

  /** Changes a note; `change` is checked against the note as it is now. Undefined when the brand has no such note. */
  async updateNote(brandId: string, id: string, change: (current: NoteInput) => NoteInput, actor: string): Promise<AgentNote | undefined> {
    return transaction(this.db, async (tx) => {
      const found = (await tx.query('SELECT * FROM agent_notes WHERE brand_id = $1 AND id = $2 FOR UPDATE', [brandId, id])).rows[0]
      if (!found) return undefined
      const before = toNote(found)
      const next = change({ kind: before.kind, title: before.title, body: before.body, agentType: before.agentType, active: before.active })
      const { rows } = await tx.query(
        'UPDATE agent_notes SET agent_type = $3, kind = $4, title = $5, body = $6, active = $7, updated_by = $8, updated_at = now() WHERE brand_id = $1 AND id = $2 RETURNING *',
        [brandId, id, next.agentType, next.kind, next.title, next.body, next.active, actor])
      await audit(tx, { actor, action: 'note.update', objectType: 'agent-note', objectId: id, brandId, before: { kind: before.kind, title: before.title, body: before.body, agentType: before.agentType, active: before.active }, after: next })
      return toNote(rows[0])
    })
  }

  async deleteNote(brandId: string, id: string, actor: string): Promise<boolean> {
    return transaction(this.db, async (tx) => {
      const removed = await tx.query('DELETE FROM agent_notes WHERE brand_id = $1 AND id = $2 RETURNING *', [brandId, id])
      if (!removed.rowCount) return false
      const note = toNote(removed.rows[0])
      await audit(tx, { actor, action: 'note.delete', objectType: 'agent-note', objectId: id, brandId, before: { kind: note.kind, title: note.title, body: note.body, agentType: note.agentType, active: note.active } })
      return true
    })
  }

  /** Connected accounts without their tokens: for the Settings page. */
  async connections(): Promise<ConnectionInfo[]> {
    const { rows } = await this.db.query('SELECT brand_id, service, account, status, scopes, connected_at FROM integration_connections')
    return rows.map((row) => ({ brandId: row.brand_id, service: row.service, account: row.account, status: row.status, scopes: row.scopes, connectedAt: iso(row.connected_at)! }))
  }

  /** The sealed tokens of one connection. Only the integrations code calls this. */
  async connectionSecret(brandId: string, service: string): Promise<ConnectionSecret | undefined> {
    const row = (await this.db.query('SELECT account, access_token, refresh_token, expires_at, status FROM integration_connections WHERE brand_id = $1 AND service = $2', [brandId, service])).rows[0]
    return row ? { account: row.account, accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at ? new Date(row.expires_at) : undefined, status: row.status } : undefined
  }

  /** Saves a connection; a new login that brings no refresh token keeps the one already stored. */
  async saveConnection(input: { brandId: string; service: string; account: string; accessToken: string; refreshToken?: string; expiresAt: Date; scopes: string }, actor: string): Promise<void> {
    await transaction(this.db, async (tx) => {
      await tx.query(
        `INSERT INTO integration_connections (brand_id, service, account, access_token, refresh_token, expires_at, scopes, status, connected_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)
         ON CONFLICT (brand_id, service) DO UPDATE SET account = $3, access_token = $4, refresh_token = coalesce($5, integration_connections.refresh_token),
           expires_at = $6, scopes = $7, status = 'active', connected_by = $8, connected_at = now(), updated_at = now()`,
        [input.brandId, input.service, input.account, input.accessToken, input.refreshToken ?? null, input.expiresAt, input.scopes, actor])
      await audit(tx, { actor, action: 'integration.connect', objectType: 'integration', objectId: input.service, brandId: input.brandId, after: { account: input.account, scopes: input.scopes } })
    })
  }

  async updateAccessToken(brandId: string, service: string, accessToken: string, expiresAt: Date): Promise<void> {
    await this.db.query("UPDATE integration_connections SET access_token = $3, expires_at = $4, status = 'active', updated_at = now() WHERE brand_id = $1 AND service = $2", [brandId, service, accessToken, expiresAt])
  }

  async markNeedsReauth(brandId: string, service: string): Promise<void> {
    await this.db.query("UPDATE integration_connections SET status = 'needs_reauth', updated_at = now() WHERE brand_id = $1 AND service = $2", [brandId, service])
  }

  /** Removes a connection and returns what it held, so the caller can revoke it at the provider. */
  async deleteConnection(brandId: string, service: string, actor: string): Promise<ConnectionSecret | undefined> {
    return transaction(this.db, async (tx) => {
      const row = (await tx.query('DELETE FROM integration_connections WHERE brand_id = $1 AND service = $2 RETURNING account, access_token, refresh_token, expires_at, status', [brandId, service])).rows[0]
      if (!row) return undefined
      await audit(tx, { actor, action: 'integration.disconnect', objectType: 'integration', objectId: service, brandId, before: { account: row.account } })
      return { account: row.account, accessToken: row.access_token, refreshToken: row.refresh_token, expiresAt: row.expires_at ? new Date(row.expires_at) : undefined, status: row.status }
    })
  }

  async createOAuthState(input: { stateHash: string; brandId: string; service: string; verifier: string; redirectUri: string; createdBy: string; ttlMs: number }): Promise<void> {
    await this.db.query('DELETE FROM oauth_states WHERE expires_at < now()')
    await this.db.query(
      'INSERT INTO oauth_states (state_hash, brand_id, service, verifier, redirect_uri, created_by, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [input.stateHash, input.brandId, input.service, input.verifier, input.redirectUri, input.createdBy, new Date(Date.now() + input.ttlMs)])
  }

  /** Takes a started connection out of the table (once only) if it has not expired. */
  async consumeOAuthState(stateHash: string): Promise<{ brandId: string; service: string; verifier: string; redirectUri: string; createdBy: string } | undefined> {
    const row = (await this.db.query('DELETE FROM oauth_states WHERE state_hash = $1 AND expires_at > now() RETURNING brand_id, service, verifier, redirect_uri, created_by', [stateHash])).rows[0]
    return row ? { brandId: row.brand_id, service: row.service, verifier: row.verifier, redirectUri: row.redirect_uri, createdBy: row.created_by } : undefined
  }

  /** The mode each brand asked for, per service: brand id → service → mode. */
  async integrationModes(): Promise<Map<string, Map<string, IntegrationMode>>> {
    const { rows } = await this.db.query('SELECT brand_id, service, mode FROM integration_modes')
    const modes = new Map<string, Map<string, IntegrationMode>>()
    for (const row of rows) modes.set(row.brand_id, (modes.get(row.brand_id) ?? new Map()).set(row.service, row.mode))
    return modes
  }

  async setIntegrationMode(brandId: string, service: string, mode: IntegrationMode, actor: string): Promise<void> {
    await transaction(this.db, async (tx) => {
      const before = (await tx.query('SELECT mode FROM integration_modes WHERE brand_id = $1 AND service = $2', [brandId, service])).rows[0]?.mode ?? null
      await tx.query(
        `INSERT INTO integration_modes (brand_id, service, mode, updated_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (brand_id, service) DO UPDATE SET mode = $3, updated_by = $4, updated_at = now()`, [brandId, service, mode, actor])
      await audit(tx, { actor, action: 'integration.mode', objectType: 'integration', objectId: service, brandId, before: { mode: before }, after: { mode } })
    })
  }

  /** Puts a role's weight back to the profile's table. Returns whether there was an override to remove. */
  async clearRoute(agentType: string, weight: Weight, actor: string): Promise<boolean> {
    return transaction(this.db, async (tx) => {
      const removed = await tx.query('DELETE FROM agent_routes WHERE agent_type = $1 AND weight = $2 RETURNING source, model, reasoning_effort', [agentType, weight])
      if (removed.rowCount) await audit(tx, { actor, action: 'model.reset', objectType: 'agent-route', objectId: `${agentType}/${weight}`, before: removed.rows[0] })
      return Boolean(removed.rowCount)
    })
  }

  /** What the model runs of each task cost: runs, tokens, time and the latest model, for the Approval box (FR-20). */
  async taskUsage(brandId: string, taskIds: string[]): Promise<Map<string, TaskUsage>> {
    if (taskIds.length === 0) return new Map()
    const { rows } = await this.db.query(
      `SELECT task_id, count(*)::int AS runs, coalesce(sum(input_tokens), 0)::int AS "inputTokens", coalesce(sum(output_tokens), 0)::int AS "outputTokens",
              sum(duration_ms)::int AS "durationMs", (array_agg(source ORDER BY id DESC))[1] AS source, (array_agg(model ORDER BY id DESC))[1] AS model
         FROM cost_events WHERE brand_id = $1 AND task_id = ANY($2::uuid[]) GROUP BY task_id`, [brandId, taskIds])
    return new Map(rows.map((row) => [row.task_id as string, { runs: row.runs, inputTokens: row.inputTokens, outputTokens: row.outputTokens, durationMs: row.durationMs ?? null, source: row.source, model: row.model }]))
  }

  async approvals(brandId: string, filter: { open?: boolean; taskId?: string } = {}): Promise<Approval[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM approvals WHERE brand_id = $1 AND (NOT $2 OR (decision IS NULL AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=approvals.task_id AND t.brand_id=approvals.brand_id AND t.status='waiting_approval'))) AND ($3::uuid IS NULL OR task_id = $3) ORDER BY created_at DESC`,
      [brandId, filter.open ?? false, filter.taskId ?? null])
    return rows.map(toApproval)
  }

  /** The brand's latest saved results with the task they belong to, newest first, without their content. */
  async assetList(brandId: string, limit = 40): Promise<AssetListItem[]> {
    const { rows } = await this.db.query(
      `SELECT a.id, a.task_id, a.kind, a.version, a.name, a.mime, (a.storage_key IS NOT NULL) AS downloadable, a.created_at, coalesce(a.size_bytes, length(a.content))::int AS size, left(a.content, 700) AS excerpt, t.title, t.agent_type
         FROM assets a JOIN tasks t ON t.id = a.task_id AND t.brand_id = a.brand_id
        WHERE a.brand_id = $1 ORDER BY a.created_at DESC, a.version DESC LIMIT $2`, [brandId, limit])
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, kind: row.kind, version: row.version, name: row.name ?? null, mime: row.mime ?? null, downloadable: row.downloadable, size: row.size, excerpt: row.excerpt, title: row.title, agentType: row.agent_type, createdAt: iso(row.created_at)! }))
  }

  /** One saved result with its content, only when it belongs to the brand. */
  async asset(brandId: string, assetId: string): Promise<(Asset & { title: string; name: string | null }) | undefined> {
    const { rows } = await this.db.query(
      `SELECT a.*, t.title FROM assets a JOIN tasks t ON t.id = a.task_id AND t.brand_id = a.brand_id WHERE a.brand_id = $1 AND a.id::text = $2`, [brandId, assetId])
    const row = rows[0]
    return row ? { id: row.id, taskId: row.task_id, kind: row.kind, version: row.version, content: row.content, createdAt: iso(row.created_at)!, title: row.title, name: row.name ?? null } : undefined
  }

  /** A downloadable file's bytes, only when the asset belongs to the brand and has a stored file. */
  async assetFile(brandId: string, assetId: string): Promise<{ data: Buffer; mime: string; name: string } | undefined> {
    if (!this.files) return undefined
    const { rows } = await this.db.query('SELECT name, mime, storage_key FROM assets WHERE brand_id = $1 AND id::text = $2 AND storage_key IS NOT NULL', [brandId, assetId])
    const row = rows[0]
    return row ? { data: await this.files.read(row.storage_key), mime: row.mime ?? 'application/octet-stream', name: row.name ?? 'berkas' } : undefined
  }

  /**
   * Prints a stored PDF again from the Markdown it was made from, with the current renderer, and points the asset
   * at the new file. Used when a PDF was made by an older or fallback renderer. The old file stays in the store.
   */
  async rerenderPdf(brandId: string, assetId: string, actor: string): Promise<{ size: number }> {
    const approved=(await this.db.query('SELECT id FROM approved_packages WHERE brand_id=$1 AND assets @> $2::jsonb LIMIT 1',[brandId,JSON.stringify([{id:assetId}])])).rows[0]
    if(approved)throw new Error('PDF ini termasuk versi yang sudah disetujui. Buat versi revisi untuk mengubahnya.')
    if (!this.files) throw new Error('Penyimpanan berkas belum aktif.')
    const { rows } = await this.db.query(`SELECT name, content FROM assets WHERE brand_id = $1 AND id::text = $2 AND storage_key IS NOT NULL AND mime = 'application/pdf'`, [brandId, assetId])
    if (!rows[0]) throw new Error('PDF tidak ditemukan di brand ini.')
    const brand = (await this.brands()).find((item) => item.id === brandId)
    const pdf = await renderDocumentPdf(rows[0].content as string, { name: rows[0].name as string, brand: brandStyle(brandId, brand?.name ?? brandId, brand?.color ?? '') })
    const key = await this.files.put(brandId, 'pdf', pdf)
    await transaction(this.db, async (tx) => {
      await tx.query('SELECT t.id FROM tasks t JOIN assets a ON a.task_id=t.id AND a.brand_id=t.brand_id WHERE a.brand_id=$1 AND a.id::text=$2 FOR UPDATE OF t',[brandId,assetId])
      if((await tx.query('SELECT id FROM approved_packages WHERE brand_id=$1 AND assets @> $2::jsonb LIMIT 1',[brandId,JSON.stringify([{id:assetId}])])).rows[0])throw new Error('PDF sudah disetujui saat proses berlangsung. Buat versi revisi untuk mengubahnya.')
      await tx.query('UPDATE assets SET storage_key = $3, size_bytes = $4 WHERE brand_id = $1 AND id::text = $2', [brandId, assetId, key, pdf.length])
      await audit(tx, { actor, action: 'asset.rerender', objectType: 'asset', objectId: assetId, brandId, after: { size: pdf.length } })
    })
    return { size: pdf.length }
  }

  /** The stored files of chat tasks (id and name per task), so a chat can link a file card to its download. */
  async artifactFiles(brandId: string, taskIds: string[]): Promise<Map<string, Array<{ id: string; name: string; mime: string;size?:number;content?:string }>>> {
    const files = new Map<string, Array<{ id: string; name: string; mime: string;size?:number;content?:string }>>()
    if (taskIds.length === 0) return files
    const { rows } = await this.db.query(`SELECT id, task_id, name, mime FROM assets WHERE brand_id = $1 AND task_id = ANY($2::uuid[]) AND storage_key IS NOT NULL ORDER BY version`, [brandId, taskIds])
    for (const row of rows) files.set(row.task_id, [...(files.get(row.task_id) ?? []), { id: row.id, name: row.name, mime: row.mime }])
    const produced=await this.db.query(`SELECT a.id,t.parent_id,a.name,a.mime,a.size_bytes,a.content FROM assets a JOIN tasks t ON t.id=a.task_id AND t.brand_id=a.brand_id JOIN tasks chat ON chat.id=t.parent_id AND chat.brand_id=t.brand_id AND chat.agent_type=t.agent_type WHERE a.brand_id=$1 AND t.kind IN ('konten.produksi','video.proyek') AND chat.kind='konten.chat' AND t.parent_id=ANY($2::uuid[]) AND a.storage_key IS NOT NULL ORDER BY a.version`,[brandId,taskIds])
    for(const row of produced.rows)files.set(row.parent_id,[...(files.get(row.parent_id)??[]),{id:row.id,name:row.name,mime:row.mime,size:row.size_bytes,content:row.mime==='image/png'?'':row.content}])
    return files
  }

  async assets(brandId: string, taskId: string): Promise<Asset[]> {
    const { rows } = await this.db.query('SELECT * FROM assets WHERE brand_id = $1 AND task_id = $2 ORDER BY version DESC', [brandId, taskId])
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, kind: row.kind, version: row.version, content: row.content, createdAt: iso(row.created_at)! }))
  }

  /**
   * Records a person's decision (FR-22): approval moves the task to approved, rejection needs a note
   * and sends the task back to the agent as a revision.
   */
  async decide(brandId: string, approvalId: string, input: { decision: 'approved' | 'rejected'; note?: string; actor: string }): Promise<{ approval: Approval; task: Task;revisionTask?:Task;handoffTask?:Task }> {
    const note = input.note?.trim() || null
    if(note&&note.length>4000)throw new Error('Arahan review maksimal 4.000 karakter.')
    if (input.decision === 'rejected' && !note) throw new Error('Penolakan wajib disertai catatan untuk revisi.')
    const result = await transaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM approvals WHERE brand_id = $1 AND id = $2 FOR UPDATE', [brandId, approvalId])
      if (!rows[0]) throw new Error(`Approval ${approvalId} tidak ditemukan di brand ${brandId}.`)
      if (rows[0].decision) throw new Error('Approval ini sudah diputuskan.')
      const decided = await tx.query(
        'UPDATE approvals SET decision = $3, note = $4, decided_by = $5, decided_at = now() WHERE brand_id = $1 AND id = $2 RETURNING *',
        [brandId, approvalId, input.decision, note, input.actor])
      const approval = toApproval(decided.rows[0])
      let task = input.decision === 'approved'
        ? await this.transition(brandId, approval.taskId, 'approved', { actor: input.actor, reason: note ?? 'disetujui', patch: { completed_at: new Date().toISOString() } }, tx)
        // A revision is new work, not a failure: it starts with a fresh retry budget (FR-13).
        : await this.transition(brandId, approval.taskId, 'revision', { actor: input.actor, reason: note ?? undefined, patch: { attempts: 0 } }, tx)
      await audit(tx, { actor: input.actor, action: `approval.${input.decision}`, objectType: 'approval', objectId: approvalId, brandId, after: { taskId: approval.taskId, note } })
      let revisionTask:Task|undefined
      let handoffTask:Task|undefined
      if(input.decision==='approved'&&approval.approvalType==='publikasi'&&task.agentType==='social-media-manager'&&task.kind==='publikasi.caption'){
        const asset=(await tx.query('SELECT id,content FROM assets WHERE brand_id=$1 AND task_id=$2 AND kind=$3 ORDER BY version DESC LIMIT 1',[brandId,task.id,task.kind])).rows[0]
        if(!asset||asset.content!==task.result)throw new Error('Versi caption publikasi tidak cocok dengan hasil yang ditinjau.')
        await tx.query("UPDATE approved_packages SET publication_asset_id=$3,drive_status='pending' WHERE brand_id=$1 AND smm_task_id=$2",[brandId,task.id,asset.id])
      }
      if(input.decision==='approved'&&approval.approvalType==='konten'&&task.kind==='konten.produksi'&&task.agentType==='content-creator'){
        handoffTask=await this.createApprovedPackage(brandId,task,approval,input.actor,tx)
      }
      if(input.decision==='approved'&&task.kind==='video.proyek'&&task.agentType==='video-editor'){
        const saved=(await tx.query("SELECT content FROM assets WHERE brand_id=$1 AND task_id=$2 AND name='video-revision.json' ORDER BY version DESC LIMIT 1",[brandId,task.id])).rows[0]
        const snapshot=saved?JSON.parse(saved.content):null
        await this.logEvent(tx,task,'video_storyboard_approved',{approvalId,sourceTaskId:task.id,snapshot})
      }
      if(input.decision==='rejected'&&task.kind==='konten.produksi'&&task.agentType==='content-creator'){
        revisionTask=await this.createTask(brandId,{agentType:task.agentType,kind:'konten.chat',title:'Revisi hasil berdasarkan review',brief:`Revisi carousel yang ditinjau. Arahan reviewer: ${(note??'').slice(0,4000)}\n\nBrief awal: ${task.brief.slice(0,6000)}\nPertahankan bagian yang tidak diminta berubah. Render ulang dan tampilkan hasil revisi di chat.`,createdBy:input.actor},tx)
        await this.logEvent(tx,revisionTask,'production_revision_requested',{sourceTaskId:task.id,approvalId})
        task=await this.transition(brandId,task.id,'cancelled',{actor:input.actor,reason:'Versi dikembalikan untuk revisi; tugas pengganti dibuat'},tx)
      }
      if(input.decision==='rejected'&&task.kind==='video.proyek'){
        const original=(await tx.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[brandId,task.id])).rows[0]
        if(!original)throw new Error('Draf proyek sumber tidak ditemukan.')
        const brief=`Arahan revisi: ${(note??'').slice(0,4000)}\n\nBrief awal: ${task.brief.slice(0,6000)}`
        if(original.payload.video?.plan){
          revisionTask=await this.createTask(brandId,{agentType:task.agentType,kind:'konten.chat',title:`Revisi: ${task.title}`.slice(0,160),brief:'Revisi rencana produksi video. '+brief,createdBy:input.actor},tx)
          await this.logEvent(tx,revisionTask,'video_revision_requested',{sourceTaskId:task.id,approvalId})
        }else{
          revisionTask=await this.createTask(brandId,{agentType:task.agentType,kind:task.kind,title:`Revisi: ${task.title}`.slice(0,160),brief,createdBy:input.actor},tx)
          await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[revisionTask.id,brandId,task.agentType,JSON.stringify({...original.payload,title:revisionTask.title,brief})])
        }
        task=await this.transition(brandId,task.id,'cancelled',{actor:input.actor,reason:'Brief proyek dikembalikan untuk revisi'},tx)
      }
      return { approval, task,revisionTask,handoffTask }
    })
    this.bus.publish({ type: 'approval', brandId, approvalId, taskId: result.task.id, decision: input.decision })
    return result
  }

  private async createApprovedPackage(brandId:string,task:Task,approval:Approval,actor:string,tx:Queryable):Promise<Task> {
    const files=(await tx.query('SELECT id,name,mime,version,size_bytes FROM assets WHERE brand_id=$1 AND task_id=$2 AND kind=$3 ORDER BY name,id',[brandId,task.id,'artifact'])).rows
    const deliverables=files.filter(file=>/^slide-\d+\.(png|jpe?g)$/i.test(file.name??'')||/\.pdf$/i.test(file.name??'')||/^caption\.(md|txt)$/i.test(file.name??''))
    if(!deliverables.length)throw new Error('Paket hasil produksi belum memiliki berkas untuk disetujui.')
    const handoff=await this.createTask(brandId,{agentType:'social-media-manager',kind:'publikasi.caption',title:`Siapkan publikasi: ${task.title}`.slice(0,160),brief:`Siapkan caption dan rekomendasi jadwal publikasi untuk paket konten yang sudah disetujui.\nTugas sumber: ${task.id}\nApproval: ${approval.id}\nBrief konten: ${task.brief}\nHasil konten: ${task.result??''}\nBerkas versi approved: ${JSON.stringify(deliverables)}\nPertahankan urutan slide berdasarkan nama berkas. Minta arahan jika kanal atau jadwal belum ditentukan. Hasil persiapan memerlukan approval publikasi. Jangan mengklaim konten sudah terbit.`,createdBy:actor},tx)
    await tx.query('INSERT INTO approved_packages(brand_id,source_task_id,approval_id,smm_task_id,assets,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[brandId,task.id,approval.id,handoff.id,JSON.stringify(deliverables),approval.decidedBy??actor,approval.decidedAt])
    await this.logEvent(tx,task,'approved_package_created',{approvalId:approval.id,smmTaskId:handoff.id,assetIds:deliverables.map(file=>file.id),driveStatus:'pending'})
    return handoff
  }

  async prepareApprovedPublication(brandId:string,taskId:string,actor:string):Promise<Task> {
    return transaction(this.db,async tx=>{
      await tx.query('SELECT id FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brandId,taskId])
      const task=await this.task(brandId,taskId,tx)
      if(!task||!['approved','done'].includes(task.status)||task.kind!=='konten.produksi'||task.agentType!=='content-creator')throw new Error('Pilih hasil produksi brand ini yang sudah disetujui.')
      const existing=(await tx.query('SELECT smm_task_id FROM approved_packages WHERE brand_id=$1 AND source_task_id=$2',[brandId,taskId])).rows[0]
      if(existing){
        const handoff=await this.task(brandId,existing.smm_task_id,tx)
        if(!handoff)throw new Error('Tugas SMM paket tidak ditemukan.')
        return handoff
      }
      const approval=(await tx.query('SELECT * FROM approvals WHERE brand_id=$1 AND task_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[brandId,taskId])).rows[0]
      if(approval?.decision!=='approved'||approval.approval_type!=='konten')throw new Error('Persetujuan konten yang sah diperlukan.')
      return this.createApprovedPackage(brandId,task,toApproval(approval),actor,tx)
    })
  }

  /** The reviewer notes of every rejected version, oldest first; a revision run gets them all. */
  async revisionNotes(brandId: string, taskId: string): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT note FROM approvals WHERE brand_id = $1 AND task_id = $2 AND decision = 'rejected' ORDER BY decided_at`, [brandId, taskId])
    return rows.map((row) => row.note as string)
  }
}
