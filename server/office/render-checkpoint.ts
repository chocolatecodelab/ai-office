import {createHash} from 'node:crypto'
import type {OfficeStore,Task} from './store.js'
import type {ProductionResult} from './production-engines.js'
export async function renderedCheckpoint(store:OfficeStore,task:Task,identity:unknown,render:()=>Promise<ProductionResult>):Promise<ProductionResult>{
 const key='render:'+createHash('sha256').update(JSON.stringify(identity)).digest('hex')
 const saved=(await store.db.query('SELECT result FROM task_checkpoints WHERE task_id=$1 AND brand_id=$2 AND checkpoint_key=$3',[task.id,task.brandId,key])).rows[0]?.result
 if(saved&&store.checkpointFileStore){
 const files=[]
 for(const f of saved.files){if(!f.key.startsWith(task.brandId+'/'))throw new Error('Checkpoint berkas tidak sesuai brand.');const data=await store.checkpointFileStore.read(f.key);if(createHash('sha256').update(data).digest('hex')!==f.sha256)throw new Error('Berkas checkpoint berubah.');files.push({name:f.name,mime:f.mime,data})}
 await store.logEvent(store.db,task,'render_checkpoint_resumed',{files:files.length})
 return {content:saved.content,report:saved.report,files}
 }
 const result=await render()
 if(store.checkpointFileStore){const files=[];for(const f of result.files)files.push({name:f.name,mime:f.mime,key:await store.checkpointFileStore.put(task.brandId,f.name.split('.').pop()??'bin',f.data),sha256:createHash('sha256').update(f.data).digest('hex')});await store.db.query('INSERT INTO task_checkpoints(task_id,brand_id,checkpoint_key,result) VALUES($1,$2,$3,$4) ON CONFLICT(task_id,checkpoint_key) DO UPDATE SET result=excluded.result,updated_at=now()',[task.id,task.brandId,key,JSON.stringify({content:result.content,report:result.report,files})])}
 return result
}
