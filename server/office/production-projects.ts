import { createHash } from 'node:crypto'
import type { Queryable } from '../db/index.js'
import type { OfficeStore } from './store.js'
import { transaction } from '../db/index.js'
export class ProductionSourceChoiceRequired extends Error {}

export async function registerProductionVersion(tx:Queryable,brand:string,agent:string,taskId:string,title:string,sourceTaskId?:string,ancestors=new Set<string>()){
  if(ancestors.has(taskId))throw new Error('Rantai versi produksi membentuk siklus.')
  ancestors.add(taskId)
  const job=(await tx.query('SELECT task_id FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3 FOR UPDATE',[brand,agent,taskId])).rows[0]
  if(!job)throw new Error('Tugas produksi tidak ditemukan pada brand dan agent ini.')
  const existing=(await tx.query('SELECT project_id,version FROM production_versions WHERE brand_id=$1 AND task_id=$2',[brand,taskId])).rows[0]
  if(existing)return existing
  let project:string
  if(sourceTaskId){
    let source=(await tx.query('SELECT project_id FROM production_versions WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[brand,agent,sourceTaskId])).rows[0]
    if(!source){
      const original=(await tx.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[brand,agent,sourceTaskId])).rows[0]
      if(!original)throw new Error('Versi sumber tidak tersedia pada brand dan agent ini.')
      source=await registerProductionVersion(tx,brand,agent,sourceTaskId,original.payload.spec?.slides?.[0]?.headline??original.payload.title??'Hasil produksi',original.payload.revisionOf??original.payload.sourceTaskId,ancestors)
    }
    project=source.project_id
  }else project=(await tx.query('INSERT INTO production_projects(brand_id,agent_type,title) VALUES($1,$2,$3) RETURNING id',[brand,agent,String(title??'Hasil produksi').replaceAll('**','').slice(0,200)])).rows[0].id
  await tx.query('SELECT id FROM production_projects WHERE id=$1 AND brand_id=$2 FOR UPDATE',[project,brand])
  const version=Number((await tx.query('SELECT coalesce(max(version),0)+1 AS n FROM production_versions WHERE project_id=$1',[project])).rows[0].n)
  await tx.query('INSERT INTO production_versions(task_id,project_id,brand_id,agent_type,version,source_task_id) VALUES($1,$2,$3,$4,$5,$6)',[taskId,project,brand,agent,version,sourceTaskId??null])
  return {project_id:project,version}
}

/** Legacy video imports carry explicit lineage. Never group separate projects by title. */
export async function backfillProductionVersions(store:OfficeStore){
  const missing=(await store.db.query(`SELECT j.task_id,j.brand_id,j.agent_type,j.payload,t.title FROM production_jobs j JOIN tasks t ON t.id=j.task_id AND t.brand_id=j.brand_id
    WHERE NOT EXISTS(SELECT 1 FROM production_versions v WHERE v.task_id=j.task_id) ORDER BY t.created_at,j.task_id`)).rows
  for(const row of missing)await transaction(store.db,tx=>registerProductionVersion(tx,row.brand_id,row.agent_type,row.task_id,row.title,row.payload.revisionOf??row.payload.sourceTaskId))
}

export async function productionProjects(store:OfficeStore,brand:string,agent:string,query=''){
  if(query.length>200)throw new Error('Pencarian proyek maksimal 200 karakter.')
  const rows=(await store.db.query(`SELECT p.id,p.title,p.created_at AS "createdAt",v.task_id AS "taskId",v.version,v.source_task_id AS "sourceTaskId",t.status,t.error,t.title AS "requestTitle",j.report,
    (SELECT a.id FROM assets a WHERE a.brand_id=t.brand_id AND a.task_id=t.id AND a.mime LIKE 'image/%' AND a.storage_key IS NOT NULL ORDER BY (a.name IN ('slide-01.png','thumbnail.png')) DESC,a.name,a.version DESC LIMIT 1) AS "posterId",
    EXISTS(SELECT 1 FROM assets a WHERE a.brand_id=t.brand_id AND a.task_id=t.id AND a.storage_key IS NOT NULL AND (a.mime LIKE 'image/%' OR a.mime='video/mp4' OR a.name='storyboard-visual.html')) AS ready
    FROM production_projects p JOIN production_versions v ON v.project_id=p.id AND v.brand_id=p.brand_id AND v.agent_type=p.agent_type JOIN tasks t ON t.id=v.task_id AND t.brand_id=v.brand_id JOIN production_jobs j ON j.task_id=v.task_id AND j.brand_id=v.brand_id
    WHERE p.brand_id=$1 AND p.agent_type=$2 AND p.id IN (SELECT id FROM production_projects WHERE brand_id=$1 AND agent_type=$2 AND title ILIKE $3 ORDER BY created_at DESC LIMIT 30)
    ORDER BY p.created_at DESC,v.version DESC`,[brand,agent,`%${query}%`])).rows
  const projects=new Map<string,{id:string;title:string;createdAt:string;versions:Array<Record<string,unknown>>}>()
  for(const row of rows){
    if(!projects.has(row.id))projects.set(row.id,{id:row.id,title:row.title.replaceAll('**',''),createdAt:new Date(row.createdAt).toISOString(),versions:[]})
    projects.get(row.id)!.versions.push({taskId:row.taskId,version:row.version,sourceTaskId:row.sourceTaskId,status:row.status,ready:row.ready,posterId:row.posterId,error:row.error,requestTitle:row.requestTitle,stage:row.report?.stage})
  }
  return [...projects.values()]
}

export async function productionVersion(store:OfficeStore,brand:string,agent:string,taskId:string){
  if(!/^[0-9a-f-]{36}$/i.test(taskId))throw new Error('ID versi tidak valid.')
  const row=(await store.db.query(`SELECT v.project_id AS "projectId",v.version,p.title,j.payload,j.report FROM production_versions v JOIN production_projects p ON p.id=v.project_id AND p.brand_id=v.brand_id JOIN production_jobs j ON j.task_id=v.task_id AND j.brand_id=v.brand_id WHERE v.brand_id=$1 AND v.agent_type=$2 AND v.task_id=$3`,[brand,agent,taskId])).rows[0]
  if(!row)throw new Error('Versi tidak ditemukan pada brand dan agent ini.')
  const files=(await store.db.query(`SELECT DISTINCT ON(name) id,name,mime,size_bytes AS size,content FROM assets WHERE brand_id=$1 AND task_id=$2 AND storage_key IS NOT NULL ORDER BY name,version DESC`,[brand,taskId])).rows
  return {projectId:row.projectId,version:row.version,title:row.title.replaceAll('**',''),taskId,spec:row.payload.spec,files:files.map(f=>({id:f.id,name:f.name,mime:f.mime as string,size:f.size})),caption:files.find(f=>f.name==='caption.md')?.content??'',qa:row.report?.status??null}
}

export async function compareProductionVersions(store:OfficeStore,brand:string,agent:string,leftId:string,rightId:string){
  const [left,right]=await Promise.all([productionVersion(store,brand,agent,leftId),productionVersion(store,brand,agent,rightId)])
  if(left.projectId!==right.projectId)throw new Error('Pilih dua versi dalam proyek yang sama untuk dibandingkan.')
  const digest=async(file:{id:string}|undefined)=>{if(!file)return null;const data=await store.assetFile(brand,file.id);return data?createHash('sha256').update(data.data).digest('hex'):null}
  const names=[...new Set([...left.files,...right.files].filter(f=>/^slide-\d+\.png$/.test(f.name)).map(f=>f.name))].sort()
  const slides=await Promise.all(names.map(async name=>{const a=left.files.find(f=>f.name===name),b=right.files.find(f=>f.name===name);return {name,left:a?.id??null,right:b?.id??null,changed:await digest(a)!==await digest(b)}}))
  // Video filenames include the revision's project slug; compare their role, not their name.
  const role=(f:{name:string;mime:string})=>f.mime==='video/mp4'?'Video MP4':f.name
  const keys=[...new Set([...left.files,...right.files].map(role))].sort()
  const files=await Promise.all(keys.map(async name=>{
    const a=left.files.find(f=>role(f)===name),b=right.files.find(f=>role(f)===name),mime=b?.mime??a!.mime
    const kind=mime.startsWith('image/')?'image':mime==='video/mp4'?'video':mime.startsWith('text/')||mime==='application/json'?'text':'file'
    const text=async(f:typeof a)=>{if(!f||kind!=='text'||Number(f.size)>512000||f.mime==='text/html')return undefined;return (await store.assetFile(brand,f.id))?.data.toString('utf8')}
    return {name,mime,kind,left:a?.id??null,right:b?.id??null,changed:await digest(a)!==await digest(b),leftText:await text(a),rightText:await text(b)}
  }))
  const changed=files.filter(f=>f.changed)
  return {left,right,slides,files,captionChanged:left.caption!==right.caption,summary:{changed:changed.length,unchanged:files.length-changed.length,added:changed.filter(f=>!f.left).length,removed:changed.filter(f=>!f.right).length}}
}

/** Restoring makes a fresh reviewable version. Existing files and approvals are immutable. */
export async function restoreProductionVersion(store:OfficeStore,brand:string,agent:string,taskId:string){
  const original=await productionVersion(store,brand,agent,taskId)
  if(!original.files.some(f=>f.mime.startsWith('image/')||f.mime==='video/mp4'||f.name==='storyboard-visual.html'))throw new Error('Versi ini belum memiliki hasil yang dapat dipulihkan.')
  const source=(await store.db.query('SELECT payload,report FROM production_jobs WHERE brand_id=$1 AND agent_type=$2 AND task_id=$3',[brand,agent,taskId])).rows[0]
  const files=[]
  for(const file of original.files){
    const saved=await store.assetFile(brand,file.id)
    if(!saved)throw new Error('Berkas versi sumber tidak tersedia. Pemulihan dibatalkan.')
    files.push({name:file.name,mime:file.mime,data:saved.data})
  }
  const child=await transaction(store.db,async tx=>{
    const parent=await store.createTask(brand,{agentType:agent,kind:'konten.chat',title:`Pulihkan versi ${original.version}`,brief:`Pulihkan ${original.title} versi ${original.version} sebagai versi baru.`,createdBy:'pengguna-lokal'},tx)
    const task=await store.createTask(brand,{agentType:agent,kind:agent==='video-editor'?'video.proyek':'konten.produksi',parentId:parent.id,title:`${original.title} (pulihan v${original.version})`.slice(0,200),brief:parent.brief,createdBy:'pengguna-lokal'},tx)
    await tx.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[task.id,brand,agent,JSON.stringify({...source.payload,revisionOf:taskId,restoredFrom:taskId})])
    await registerProductionVersion(tx,brand,agent,task.id,original.title,taskId)
    await store.logEvent(tx,task,'production_version_restored',{sourceTaskId:taskId,sourceVersion:original.version})
    return task
  })
  try{
    await store.transition(brand,child.id,'running',{actor:'sistem'})
    await store.submitProduction(brand,child.id,{content:`Versi ${original.version} dipulihkan sebagai versi baru. Perlu persetujuan ulang sebelum digunakan untuk publikasi.`,files,report:{...source.report,restoredFrom:taskId}})
  }catch(error){
    const current=await store.task(brand,child.id)
    if(current?.status==='running'||current?.status==='queued')await store.transition(brand,child.id,'failed',{actor:'sistem',patch:{error:String(error)}})
    if(child.parentId){const parent=await store.task(brand,child.parentId);if(parent&&['queued','running'].includes(parent.status))await store.transition(brand,parent.id,'failed',{actor:'sistem',patch:{error:'Pemulihan belum berhasil: '+String(error)}})}
    throw error
  }
  return productionVersion(store,brand,agent,child.id)
}
