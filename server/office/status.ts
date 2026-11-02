// Task status machine (FR-11) and the avatar status derived from it (FR-61). One source of truth:
// the task statuses in Postgres drive the queue, the dashboard and the 3D office alike.

export const TASK_STATUSES = ['queued', 'running', 'waiting_quota', 'waiting_approval', 'revision', 'approved', 'done', 'failed', 'paused', 'cancelled'] as const
export type TaskStatus = typeof TASK_STATUSES[number]

export const AGENT_STATUSES = ['idle', 'working', 'waiting_quota', 'waiting_approval', 'revision', 'error', 'paused'] as const
export type AgentStatus = typeof AGENT_STATUSES[number]

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ['running', 'paused', 'cancelled'],
  running: ['waiting_approval', 'waiting_quota', 'queued', 'failed', 'paused', 'cancelled'],
  waiting_quota: ['queued', 'running', 'paused', 'cancelled'],
  waiting_approval: ['approved', 'revision', 'cancelled'],
  revision: ['running', 'paused', 'cancelled'],
  approved: ['done'],
  done: [],
  failed: ['queued', 'cancelled'],
  paused: ['queued', 'cancelled'],
  cancelled: [],
}

/** Statuses a worker may pick up. */
export const RUNNABLE: readonly TaskStatus[] = ['queued', 'waiting_quota', 'revision']

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) throw new Error(`Status tugas tidak bisa berpindah dari ${from} ke ${to}.`)
}

/**
 * What an agent's avatar shows, from the statuses of its open tasks. Work in progress wins over
 * waiting, and waiting on the quota (the avatar sleeps) over waiting on a person.
 */
export function agentStatus(taskStatuses: readonly TaskStatus[], paused: boolean): AgentStatus {
  if (paused) return 'paused'
  const has = (status: TaskStatus) => taskStatuses.includes(status)
  if (has('running')) return 'working'
  if (has('revision')) return 'revision'
  if (has('waiting_quota')) return 'waiting_quota'
  if (has('failed')) return 'error'
  if (has('waiting_approval')) return 'waiting_approval'
  return 'idle'
}
