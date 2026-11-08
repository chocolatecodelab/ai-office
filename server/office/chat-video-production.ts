import { transaction } from '../db/index.js'
import type { OfficeStore,Task } from './store.js'
import type { RunResult } from './hermes-client.js'
import { validateProductionRequest,type ProductionRequest } from './production-engines.js'
import { registerProductionVersion } from './production-projects.js'
import { ChatWorkspace } from './chat-workspace.js'

export async function dispatchVideoPlan(store:OfficeStore,task:Task,video:NonNullable<ProductionRequest['video']>,result:RunResult,usage:{source:'codex'|'litellm';model:string;durationMs:number}) {
  const chat=new ChatWorkspace(store),selected=await chat.input(task)
  const sources=[]
  for(const id of selected.attachmentIds){const file=await chat.taskAttachment(task,id);if(file?.mime.startsWith('video/'))sources.push({attachmentId:id,taskId:task.id})}
  const sourceTaskId=(await store.db.query("SELECT payload->>'sourceTaskId' AS id FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='video_revision_requested' ORDER BY id DESC LIMIT 1",[task.brandId,task.id])).rows[0]?.id as string|undefined
  if(sourceTaskId&&!sources.length){
    const original=(await store.db.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[task.brandId,task.agentType,sourceTaskId])).rows[0]
    if(!original)throw new Error('Sumber revisi video tidak tersedia.')
    sources.push(...(original.payload.video?.sources??[]))
  }
  const payload=validateProductionRequest('video-editor',task.brandId,{title:task.title.slice(0,160),brief:task.brief,video:{...video,sources}})
  return transaction(store.db,async tx=>{
    await tx.query('SELECT id FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[task.brandId,task.id])
    const current=await store.task(task.brandId,task.id,tx)
    if(current?.status!=='running')throw new Error('Permintaan produksi sudah dihentikan.')
    let production:Task
    if(task.kind==='video.rencana-produksi'){
      const manager=task.parentId?await store.task(task.brandId,task.parentId,tx):undefined
      if(manager?.kind!=='konten.orchestrasi'||manager.status==='cancelled')throw new Error('Workflow Manager tidak tersedia.')
      production=task
      await tx.query(`INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)
        ON CONFLICT(task_id) DO UPDATE SET payload=$4,stage='queued',report='{}',updated_at=now()`,[task.id,task.brandId,task.agentType,JSON.stringify(payload)])
    }else{
      const existing=(await tx.query("SELECT id FROM tasks WHERE brand_id=$1 AND parent_id=$2 AND kind='video.proyek'",[task.brandId,task.id])).rows[0]
      if(existing)return (await store.task(task.brandId,existing.id,tx))!
      production=await store.createTask(task.brandId,{agentType:'video-editor',kind:'video.proyek',title:payload.title,brief:payload.brief,parentId:task.id,createdBy:'agent:video-editor'},tx)
      await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[production.id,task.brandId,task.agentType,JSON.stringify(payload)])
    }
    await registerProductionVersion(tx,task.brandId,task.agentType,production.id,payload.title,sourceTaskId)
    await tx.query('INSERT INTO cost_events(task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7)',[task.id,task.brandId,usage.source,usage.model,result.inputTokens,result.outputTokens,usage.durationMs])
    await store.logEvent(tx,task,'video_plan_dispatched',{taskId:production.id,runId:result.runId})
    if(production.id===task.id)return store.transition(task.brandId,task.id,'queued',{actor:'agent:video-editor',reason:'Naskah siap; menyiapkan paket rencana produksi',patch:{attempts:0,result:'Naskah selesai. Sedang menyiapkan rencana adegan dan subtitle draf.'}},tx)
    await tx.query('UPDATE tasks SET result=$3 WHERE brand_id=$1 AND id=$2',[task.brandId,task.id,'Naskah selesai. Sedang menyiapkan rencana adegan dan subtitle draf.'])
    return production
  })
}
