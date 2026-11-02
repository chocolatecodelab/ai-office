import { agentContextFiles, findContextDir } from '../otca-context.js'
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

export async function audit(db: Queryable, entry: { actor: string; action: string; objectType: string; objectId: string; brandId?: string; before?: unknown; after?: unknown }): Promise<void> {
  await db.query(
    'INSERT INTO audit_log (actor, action, object_type, object_id, brand_id, before, after) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [entry.actor, entry.action, entry.objectType, entry.objectId, entry.brandId ?? null,
      entry.before === undefined ? null : JSON.stringify(entry.before), entry.after === undefined ? null : JSON.stringify(entry.after)])
}

export class OfficeStore {
  constructor(readonly db: Db, private readonly bus: OfficeBus) {}

  async brands(): Promise<Array<{ id: string; name: string; color: string; paused: boolean }>> {
    return (await this.db.query('SELECT id, name, color, paused FROM brands ORDER BY id')).rows
  }

  async summary(brandId: string): Promise<{ queued: number; approvals: number; waitingQuota: number }> {
    const { rows } = await this.db.query(`SELECT
      (SELECT count(*)::int FROM tasks WHERE brand_id = $1 AND status = 'queued') AS queued,
      (SELECT count(*)::int FROM approvals WHERE brand_id = $1 AND decision IS NULL) AS approvals,
      (SELECT count(*)::int FROM tasks WHERE brand_id = $1 AND status = 'waiting_quota') AS "waitingQuota"`, [brandId])
    return rows[0]
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

  async isPaused(brandId: string, agentType: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT a.paused OR b.paused AS paused FROM agents a JOIN brands b ON b.id = a.brand_id WHERE a.brand_id = $1 AND a.agent_type = $2',
      [brandId, agentType])
    return rows[0]?.paused ?? true
  }

  async createTask(brandId: string, input: NewTask, client: Queryable = this.db): Promise<Task> {
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
  async submitForApproval(brandId: string, taskId: string, output: { content: string; runId: string; source: 'codex' | 'litellm'; model: string; inputTokens: number; outputTokens: number }): Promise<{ task: Task; approval: Approval }> {
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
      await tx.query('INSERT INTO cost_events (task_id, brand_id, source, model, input_tokens, output_tokens) VALUES ($1, $2, $3, $4, $5, $6)',
        [taskId, brandId, output.source, output.model, output.inputTokens, output.outputTokens])
      const task = await this.transition(brandId, taskId, 'waiting_approval', { actor: `agent:${current.agentType}`, reason: `hasil v${version}`, patch: { result: output.content, error: null, run_id: output.runId } }, tx)
      const { rows } = await tx.query('INSERT INTO approvals (task_id, brand_id, approval_type) VALUES ($1, $2, $3) RETURNING *', [taskId, brandId, approvalTypeFor(current.kind)])
      return { task, approval: toApproval(rows[0]) }
    })
    this.bus.publish({ type: 'approval', brandId, approvalId: result.approval.id, taskId, decision: null })
    return result
  }

  async latestContentQc(brandId:string,taskId:string):Promise<ContentQc | undefined> {
    const {rows}=await this.db.query("SELECT payload FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='content_qc' ORDER BY id DESC LIMIT 1",[brandId,taskId])
    return rows[0]?.payload.report as ContentQc | undefined
  }

  async approvals(brandId: string, filter: { open?: boolean; taskId?: string } = {}): Promise<Approval[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM approvals WHERE brand_id = $1 AND (NOT $2 OR decision IS NULL) AND ($3::uuid IS NULL OR task_id = $3) ORDER BY created_at DESC`,
      [brandId, filter.open ?? false, filter.taskId ?? null])
    return rows.map(toApproval)
  }

  async assets(brandId: string, taskId: string): Promise<Asset[]> {
    const { rows } = await this.db.query('SELECT * FROM assets WHERE brand_id = $1 AND task_id = $2 ORDER BY version DESC', [brandId, taskId])
    return rows.map((row) => ({ id: row.id, taskId: row.task_id, kind: row.kind, version: row.version, content: row.content, createdAt: iso(row.created_at)! }))
  }

  /**
   * Records a person's decision (FR-22): approval moves the task to approved, rejection needs a note
   * and sends the task back to the agent as a revision.
   */
  async decide(brandId: string, approvalId: string, input: { decision: 'approved' | 'rejected'; note?: string; actor: string }): Promise<{ approval: Approval; task: Task }> {
    const note = input.note?.trim() || null
    if (input.decision === 'rejected' && !note) throw new Error('Penolakan wajib disertai catatan untuk revisi.')
    const result = await transaction(this.db, async (tx) => {
      const { rows } = await tx.query('SELECT * FROM approvals WHERE brand_id = $1 AND id = $2 FOR UPDATE', [brandId, approvalId])
      if (!rows[0]) throw new Error(`Approval ${approvalId} tidak ditemukan di brand ${brandId}.`)
      if (rows[0].decision) throw new Error('Approval ini sudah diputuskan.')
      const decided = await tx.query(
        'UPDATE approvals SET decision = $3, note = $4, decided_by = $5, decided_at = now() WHERE brand_id = $1 AND id = $2 RETURNING *',
        [brandId, approvalId, input.decision, note, input.actor])
      const approval = toApproval(decided.rows[0])
      const task = input.decision === 'approved'
        ? await this.transition(brandId, approval.taskId, 'approved', { actor: input.actor, reason: note ?? 'disetujui', patch: { completed_at: new Date().toISOString() } }, tx)
        // A revision is new work, not a failure: it starts with a fresh retry budget (FR-13).
        : await this.transition(brandId, approval.taskId, 'revision', { actor: input.actor, reason: note ?? undefined, patch: { attempts: 0 } }, tx)
      await audit(tx, { actor: input.actor, action: `approval.${input.decision}`, objectType: 'approval', objectId: approvalId, brandId, after: { taskId: approval.taskId, note } })
      return { approval, task }
    })
    this.bus.publish({ type: 'approval', brandId, approvalId, taskId: result.task.id, decision: input.decision })
    return result
  }

  /** The reviewer notes of every rejected version, oldest first; a revision run gets them all. */
  async revisionNotes(brandId: string, taskId: string): Promise<string[]> {
    const { rows } = await this.db.query(
      `SELECT note FROM approvals WHERE brand_id = $1 AND task_id = $2 AND decision = 'rejected' ORDER BY decided_at`, [brandId, taskId])
    return rows.map((row) => row.note as string)
  }
}
