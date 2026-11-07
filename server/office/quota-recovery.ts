import {createHash} from 'node:crypto'
import type {OfficeStore,Task} from './store.js'
import type {LimitInfo} from './provider-limit.js'
/** Unknown reset time is probed with bounded backoff; this is never called an exact reset. */
export async function adaptiveQuotaWait(store:OfficeStore,task:Task,limit:LimitInfo){
 if(limit.timingSource==='provider')return limit
 const count=Number((await store.db.query(`SELECT count(*) AS n FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='quota_wait' AND created_at>coalesce((SELECT max(updated_at) FROM task_checkpoints WHERE brand_id=$1 AND task_id=$2 AND result->>'status'='completed'),'epoch'::timestamptz)`,[task.brandId,task.id])).rows[0]?.n??0)
 const base=Math.min(15*60000,60000*2**Math.min(count,4)),fraction=createHash('sha256').update(task.id+':'+count).digest()[0]/255
 return {...limit,retryAt:new Date(Date.now()+Math.round(base*(1+fraction*.15))).toISOString()}
}
