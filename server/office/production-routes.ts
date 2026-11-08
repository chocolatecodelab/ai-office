import { productionMaterials } from './production-materials.js'
import { audit } from './store.js'
import type { Router, Request, Response } from 'express'
import { transaction } from '../db/index.js'
import type { OfficeServices } from './index.js'
import { validateProductionRequest } from './production-engines.js'
import { registerProductionVersion,productionProjects,productionVersion,compareProductionVersions,restoreProductionVersion } from './production-projects.js'
import { z } from 'zod'

export function installProductionRoutes(router:Router,services:Promise<OfficeServices>){
  const base='/brands/:brand/agents/:agent/production'
  const handle=(work:(office:OfficeServices,brand:string,agent:string,r:Request)=>Promise<unknown>)=>async(r:Request,s:Response)=>{try{
    const office=await services,brand=String(r.params.brand),agent=String(r.params.agent)
    if(!['content-creator','video-editor'].includes(agent)||!(await office.store.agents(brand)).some(a=>a.agentType===agent&&a.active))throw new Error('Mesin produksi tidak tersedia untuk agent ini.')
    s.json(await work(office,brand,agent,r))
  }catch(error){s.status(400).json({error:error instanceof Error?error.message:String(error)})}}
  router.get(base,handle(async(o,brand,agent)=>({engine:await o.production?.health(agent),context:o.production?.context(agent,brand),presets:agent==='video-editor'?await o.production?.presets():[],jobs:(await o.db.query('SELECT p.task_id AS "taskId",p.stage,p.report,t.title,t.status,t.error FROM production_jobs p JOIN tasks t ON t.id=p.task_id AND t.brand_id=p.brand_id WHERE p.brand_id=$1 AND p.agent_type=$2 ORDER BY t.created_at DESC LIMIT 20',[brand,agent])).rows})))
  router.post(`${base}/native-storyboard`,handle(async(o,brand,agent,r)=>{
    if(agent!=='video-editor'||!o.production)throw new Error('Hanya untuk Video Editor.')
    const data=z.object({sourceTaskId:z.string().uuid(),project:z.string(),file:z.string(),kind:z.enum(['storyboard','video']).default('storyboard')}).strict().parse(r.body)
    const source=await o.store.task(brand,data.sourceTaskId)
    if(!source||source.agentType!==agent)throw new Error('Tugas sumber tidak ditemukan.')
    const job=(await o.db.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[brand,source.id])).rows[0]
    const hashes:string[]=[]
    for(const binding of job?.payload?.video?.sources??[])hashes.push((await o.videoAttachments.material(brand,binding.taskId,binding.attachmentId)).sha256)
    const output=data.kind==='video'?await o.production.nativeVideo(data.project,hashes):await o.production.nativeStoryboard(data.project,data.file,hashes)
    const chat=await o.store.createTask(brand,{agentType:agent,kind:'konten.chat',title:data.kind==='video'?'Hasil render video':'Tinjau storyboard visual native',brief:'Tampilkan hasil '+data.project+' untuk review.',createdBy:'pengguna-lokal'})
    const task=await o.store.createTask(brand,{agentType:agent,kind:'video.proyek',parentId:chat.id,title:(data.kind==='video'?'Video — ':'Storyboard — ')+data.project,brief:'Tinjau snapshot native. Sumber: '+source.id,createdBy:'pengguna-lokal'})
    await o.db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,brand,agent,JSON.stringify({title:task.title,nativeSnapshot:true,nativeProject:data.project,sourceTaskId:source.id})])
    await transaction(o.db,tx=>registerProductionVersion(tx,brand,agent,task.id,task.title,source.id))
    await o.store.transition(brand,task.id,'running',{actor:'worker:production'})
    try{await o.store.submitProduction(brand,task.id,output)}catch(error){await o.store.transition(brand,task.id,'failed',{actor:'worker:production',patch:{error:String(error)}});throw error}
    return o.store.task(brand,task.id)
  }))
  router.post(`${base}/render`,handle(async(o,brand,agent,r)=>{
    if(agent!=='video-editor'||!o.production)throw new Error('Hanya untuk Video Editor.')
    const data=z.object({sourceTaskId:z.string().uuid()}).strict().parse(r.body)
    const source=await o.store.task(brand,data.sourceTaskId)
    if(!source||source.agentType!==agent)throw new Error('Tugas sumber tidak ditemukan.')
    const chat=await o.store.createTask(brand,{agentType:agent,kind:'konten.chat',title:`Render video: ${source.title}`.slice(0,160),brief:'Setuju preview terakhir, render MP4 revisinya',createdBy:'pengguna-lokal'})
    await o.db.query('INSERT INTO chat_inputs(brand_id,task_id,agent_type,production_source_task_id) VALUES($1,$2,$3,$4)',[brand,chat.id,agent,source.id])
    await o.queue.enqueue(chat)
    return chat
  }))
  router.get(`${base}/projects`,handle(async(o,brand,agent,r)=>productionProjects(o.store,brand,agent,String(r.query.q??''))))
  router.get(`${base}/asset-library`,handle(async(o,brand)=> (await o.db.query(`SELECT l.*,a.name,a.mime FROM brand_asset_library l JOIN chat_attachments a ON a.id=l.attachment_id AND a.brand_id=l.brand_id WHERE l.brand_id=$1 AND NOT a.removed ORDER BY l.updated_at DESC`,[brand])).rows))
  router.post(`${base}/asset-library`,handle(async(o,brand,agent,r)=>{
    if(agent!=='content-creator')throw new Error('Pustaka ini dikelola Content Creator.')
    const data=z.object({attachmentId:z.string().uuid(),category:z.enum(['logo','mascot','photo','material']),source:z.string().trim().min(1).max(2000),license:z.string().trim().min(1).max(1000),evidence:z.string().trim().max(4000),status:z.enum(['pending','cleared','revoked'])}).strict().parse(r.body)
    if(data.status==='cleared'&&!data.evidence)throw new Error('Catat bukti izin sebelum menyatakan aset boleh digunakan.')
    return transaction(o.db,async tx=>{
      const attachment=(await tx.query('SELECT id FROM chat_attachments WHERE id=$1 AND brand_id=$2 AND agent_type=$3 AND NOT removed FOR SHARE',[data.attachmentId,brand,agent])).rows[0]
      if(!attachment)throw new Error('Berkas bukan milik Content Creator pada brand ini.')
      const saved=(await tx.query(`INSERT INTO brand_asset_library(brand_id,attachment_id,category,source,license,evidence,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(brand_id,attachment_id) DO UPDATE SET category=excluded.category,source=excluded.source,license=excluded.license,evidence=excluded.evidence,status=excluded.status,updated_at=now() RETURNING *`,[brand,data.attachmentId,data.category,data.source,data.license,data.evidence,data.status])).rows[0]
      await audit(tx,{actor:'pengguna-lokal',action:'asset.library.update',objectType:'brand-asset',objectId:saved.id,brandId:brand,after:saved})
      return saved
    })
  }))
  router.get(`${base}/versions/:taskId`,handle(async(o,brand,agent,r)=>productionVersion(o.store,brand,agent,String(r.params.taskId))))
  router.post(`${base}/versions/:taskId/restore`,handle(async(o,brand,agent,r)=>restoreProductionVersion(o.store,brand,agent,String(r.params.taskId))))
  router.get(`${base}/compare`,handle(async(o,brand,agent,r)=>compareProductionVersions(o.store,brand,agent,String(r.query.left??''),String(r.query.right??''))))
  router.post(base,handle(async(o,brand,agent,r)=>{
    const input=validateProductionRequest(agent,brand,r.body)
    if(input.chatAssets?.length)throw new Error('Bahan lampiran hanya dapat dipilih melalui percakapan.')
    await productionMaterials(o.store,brand,input.assetBindings??[])
    if(!(await o.production?.health(agent))?.ready)throw new Error('Mesin produksi belum siap. Periksa konfigurasi dan dependensi.')
    const task=await transaction(o.db,async tx=>{
      const task=await o.store.createTask(brand,{agentType:agent,kind:agent==='content-creator'?'konten.produksi':'video.proyek',title:input.title,brief:input.brief,createdBy:'pengguna-lokal'},tx)
      await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,brand,agent,JSON.stringify(input)])
      await registerProductionVersion(tx,brand,agent,task.id,String(input.spec?.slides instanceof Array?(input.spec.slides[0] as {headline?:string})?.headline??input.title:input.title))
      return task
    })
    await o.queue.enqueue(task)
    return task
  }))
}
