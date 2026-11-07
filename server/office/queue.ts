import { Queue, Worker, type ConnectionOptions } from 'bullmq'
import { runTask, type RunnerDeps } from './runner.js'
import type { OfficeStore, Task } from './store.js'
import type { ApprovedLibrary } from './approved-library.js'
import type { MetaPublisher } from './meta-publisher.js'

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

  constructor(private readonly connection: ConnectionOptions, private readonly deps: RunnerDeps, private readonly library?: ApprovedLibrary, private readonly publisher?:MetaPublisher) {
    this.queue = new Queue<JobData>(QUEUE, { connection, defaultJobOptions: { removeOnComplete: 500, removeOnFail: 500 } })
  }

  async publishSchedule(brandId:string,scheduleId:string,scheduledAt:Date|string):Promise<void> {
    await this.queue.add('publish-social',{brandId,taskId:scheduleId},{jobId:`publish-${scheduleId}-${Date.now()}`,delay:Math.max(0,new Date(scheduledAt).getTime()-Date.now()),attempts:5,backoff:{type:'fixed',delay:60_000}})
  }

  async syncLibrary(brandId: string, taskId: string): Promise<void> {
    await this.queue.add('sync-library', { brandId, taskId }, {
      jobId: `library-${taskId}-${Math.floor(Date.now()/1000)}`, attempts: 8,
      backoff: { type: 'exponential', delay: 60_000 },
    })
  }

  /** Schedules a run of the task; one pending job per task and moment, so repeated calls are harmless. */
  async enqueue(task: Pick<Task, 'brandId' | 'id'> & Partial<Pick<Task, 'priority'>>, delayMs = 0): Promise<void> {
    const at = Date.now() + delayMs
    await this.queue.add('run', { brandId: task.brandId, taskId: task.id }, { jobId: `${task.id}-${Math.floor(at / 1000)}`, delay: delayMs, priority: task.priority ?? 2 })
  }

  /** Starts processing; `concurrency` bounds parallel runs across brands. */
  start(concurrency = 2): void {
    this.worker = new Worker<JobData>(QUEUE, async (job) => {
      if(job.name==='publish-social'){
        if(!this.publisher)throw new Error('Mesin publikasi belum tersedia.')
        await this.publisher.run(job.data.brandId,job.data.taskId)
        const pending=(await this.deps.store.db.query("SELECT p.source_task_id FROM approved_packages p JOIN social_publications r ON r.package_id=p.id AND r.brand_id=p.brand_id WHERE r.brand_id=$1 AND r.schedule_id=$2 AND p.drive_status<>'synced'",[job.data.brandId,job.data.taskId])).rows[0]
        if(pending)await this.syncLibrary(job.data.brandId,pending.source_task_id)
        return
      }
      if (job.name === 'sync-library') {
        if (!this.library) throw new Error('Pustaka Approved belum dikonfigurasi.')
        await this.library.sync(job.data.brandId, job.data.taskId)
        return
      }
      const outcome = await runTask(this.deps, job.data.brandId, job.data.taskId)
      if (outcome.next === 'retry') {
        for(const child of outcome.children ?? [])await this.enqueue(child)
        const task = await this.deps.store.task(job.data.brandId, job.data.taskId)
        if (task) await this.enqueue(task, outcome.delayMs)
      }
    }, { connection: this.connection, concurrency })
    this.worker.on('failed', (job, error) => console.error(`Tugas ${job?.data.taskId} gagal diproses:`, error.message))
  }

  /** After a restart: running tasks lost their run, so they are queued again; the rest are rescheduled. */
  async recover(store: OfficeStore): Promise<number> {
    if(this.publisher){
      const deliveries=await store.db.query("SELECT d.brand_id,d.schedule_id,s.scheduled_at FROM social_deliveries d JOIN social_schedule s ON s.id=d.schedule_id AND s.brand_id=d.brand_id WHERE d.state IN ('queued','preparing','publishing') AND s.status='planned'")
      for(const delivery of deliveries.rows)await this.publishSchedule(delivery.brand_id,delivery.schedule_id,delivery.scheduled_at)
    }
    if (this.library) {
      const packages = await store.db.query("SELECT brand_id,source_task_id FROM approved_packages WHERE drive_status<>'synced'")
      for (const pack of packages.rows) await this.syncLibrary(pack.brand_id,pack.source_task_id)
    }
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
