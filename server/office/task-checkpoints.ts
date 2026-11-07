import {createHash} from 'node:crypto'
import type {OfficeStore,Task} from './store.js'
import type {HermesClient,RunResult} from './hermes-client.js'
import {ProviderLimitError,quotaInfo,limitFromError} from './provider-limit.js'
export function checkpointHermes(store:OfficeStore,task:Task,client:HermesClient):HermesClient{let lastKey:string|undefined;return {async invalidateLastCompleted(){if(lastKey)await store.db.query('UPDATE task_checkpoints SET result=NULL,run_id=NULL,generation=generation+1,updated_at=now() WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,lastKey])},async run(endpoint,request){
 const key='model:'+createHash('sha256').update(JSON.stringify({endpoint:endpoint.url,credentialFingerprint:createHash('sha256').update(endpoint.key).digest('hex'),...request,sessionId:undefined,onRunCreated:undefined,resumeRunId:undefined})).digest('hex')
 lastKey=key
 await store.db.query('INSERT INTO task_checkpoints(task_id,brand_id,checkpoint_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[task.id,task.brandId,key])
 const row=(await store.db.query('SELECT * FROM task_checkpoints WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,key])).rows[0]
 if(row.result)return {...row.result,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,checkpointReused:true} as RunResult
 let terminal=false
 try{
 const result=await client.run(endpoint,{...request,resumeRunId:row.run_id??undefined,onRunCreated:async id=>{await store.db.query('UPDATE task_checkpoints SET run_id=$4,updated_at=now() WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,key,id])}},`${task.id}:${key}:${row.generation}`)
 terminal=true
 const limit=result.status==='failed'?(result.limit??quotaInfo(result.output)):undefined
 if(result.status==='completed')await store.db.query('UPDATE task_checkpoints SET result=$4,run_id=NULL,updated_at=now() WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,key,JSON.stringify(result)])
 else await store.db.query('UPDATE task_checkpoints SET generation=generation+1,run_id=NULL,updated_at=now() WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,key])
 if(limit)throw new ProviderLimitError(result.output||'Provider membatasi pemakaian.',limit)
 return result
 }catch(error){
 if(!terminal&&limitFromError(error)&&!row.run_id)await store.db.query('UPDATE task_checkpoints SET generation=generation+1,updated_at=now() WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3 AND run_id IS NULL',[task.id,task.brandId,key])
 throw error
 }
}}}
