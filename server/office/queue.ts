import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import { runTask, type RunnerDeps } from './runner.js'
import type { OfficeStore, Task } from './store.js'

// BullMQ carries "run this task now / at this time"; Postgres stays the source of truth for the
// task itself. Delayed jobs give the quota wait and retries (FR-12, FR-13), and on startup every
// unfinished task is scheduled again so nothing is lost when the server restarts.

const QUEUE = 'office-tasks'

interface JobData { brandId: string; taskId: string }

export function redisConnection(url: string): ConnectionOptions {
  const parsed = new URL(url)
  return { host: parsed.hostname, port: Number(parsed.port) || 6379, password: parsed.password || undefined, maxRetriesPerRequest: null }
}

export class TaskQueue {
  private readonly queue: Queue<JobData>
  private worker?: Worker<JobData>

  constructor(private readonly connection: ConnectionOptions, private readonly deps: RunnerDeps) {
    this.queue = new Queue<JobData>(QUEUE, { connection, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500 } })
  }

  /** Schedules a run of the task; one pending job per task and moment, so repeated calls are harmless. */
  async enqueue(task: Pick<Task, 'brandId' | 'id'>, delayMs = 0): Promise<void> {
    const at = Date.now() + delayMs
    await this.queue.add('run', { brandId: task.brandId, taskId: task.id }, { jobId: `${task.id}-${Math.floor(at / 1000)}`, delay: delayMs })
  }

  /** Starts processing; `concurrency` bounds parallel runs across brands. */
  start(concurrency = 2): void {
    this.worker = new Worker<JobData>(QUEUE, async (job) => {
      const outcome = await runTask(this.deps, job.data.brandId, job.data.taskId)
      if (outcome.next === 'retry') await this.enqueue({ brandId: job.data.brandId, id: job.data.taskId }, outcome.delayMs)
    }, { connection: this.connection, concurrency })
    this.worker.on('failed', (job, error) => console.error(`Tugas ${job?.data.taskId} gagal diproses:`, error.message))
  }

  /** After a restart: running tasks lost their run, so they are queued again; the rest are rescheduled. */
  async recover(store: OfficeStore): Promise<number> {
    const pending = await store.pendingTasks()
    for (const task of pending) {
      if (task.status === 'running') {
        await store.transition(task.brandId, task.id, 'queued', { actor: 'sistem', reason: 'server dimulai ulang' })
      }
      const wait = task.status === 'waiting_quota' && task.retryAt ? Math.max(0, Date.parse(task.retryAt) - Date.now()) : 0
      await this.enqueue(task, wait)
    }
    return pending.length
  }

  async close(): Promise<void> {
    await this.worker?.close()
    await this.queue.close()
  }
}
