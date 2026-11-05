import { transaction } from '../db/index.js'
import { audit, type OfficeStore, type Task } from './store.js'

// A bounded draft-only vocabulary: the model cannot select publish, budget or arbitrary tools.
export const DELEGATION_KINDS: Record<string, readonly string[]> = {
  'content-creator': ['konten.carousel','konten.caption','konten.script','konten.brief'],
  'video-editor': ['video.storyboard','video.edit-plan'],
  'social-media-manager': ['publikasi.kalender','publikasi.caption'],
  'digital-marketing': ['iklan.brief','iklan.copy'],
  'event-specialist': ['event.brief'],
}
export interface Delegation { agentType: string; kind: string; title: string; brief: string; dependsOn?:string[] }
export interface ManagerPlan { summary: string; tasks: Delegation[] }
export function parseManagerPlan(output: string, active: string[]): ManagerPlan {
  let value: unknown
  try { value=JSON.parse(output.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) } catch { throw new Error('Rencana Manager bukan JSON yang valid. Coba ulang perencanaan.') }
  if (!value || typeof value!=='object') throw new Error('Rencana Manager tidak valid.')
  const plan=value as Record<string,unknown>
  if('handoffs' in plan || 'targetBrandId' in plan)throw new Error('Setiap brand independen. Delegasi lintas brand tidak tersedia.')
  if (typeof plan.summary!=='string' || !plan.summary.trim() || plan.summary.length>2000 || !Array.isArray(plan.tasks) || plan.tasks.length<1 || plan.tasks.length>5) throw new Error('Rencana harus memiliki ringkasan dan 1–5 tugas spesialis.')
  const seen=new Set<string>()
  const tasks=plan.tasks.map((item: unknown)=>{
    if(!item || typeof item!=='object')throw new Error('Tugas delegasi tidak valid.')
    const t=item as Record<string,unknown>
    if('targetBrandId' in t || 'brandId' in t || 'handoff' in t)throw new Error('Setiap brand independen. Delegasi hanya untuk kru brand sendiri.')
    if(typeof t.agentType!=='string' || !active.includes(t.agentType) || typeof t.kind!=='string' || !DELEGATION_KINDS[t.agentType]?.includes(t.kind))throw new Error('Manager memilih peran atau jenis tugas yang tidak tersedia di brand ini.')
    if(seen.has(t.agentType))throw new Error('Satu spesialis hanya menerima satu paket pekerjaan dalam rencana ini.')
    seen.add(t.agentType)
    if(typeof t.title!=='string' || !t.title.trim() || t.title.length>200 || typeof t.brief!=='string' || !t.brief.trim() || t.brief.length>12000)throw new Error('Judul atau brief delegasi tidak valid.')
    if(t.dependsOn!==undefined && (!Array.isArray(t.dependsOn)||t.dependsOn.length>4||new Set(t.dependsOn).size!==t.dependsOn.length||t.dependsOn.some(id=>typeof id!=='string')))throw new Error('Dependensi tugas harus berupa daftar peran yang berbeda.')
    return {agentType:t.agentType,kind:t.kind,title:t.title.trim(),brief:t.brief.trim(),...(t.dependsOn!==undefined?{dependsOn:t.dependsOn as string[]}: {})}
  })
  const graph=new Map(tasks.map(t=>[t.agentType,t.dependsOn??[]]))
  const visiting=new Set<string>(),visited=new Set<string>()
  const visit=(id:string)=>{
    if(visiting.has(id))throw new Error('Rencana memiliki dependensi melingkar.')
    if(visited.has(id))return
    visiting.add(id)
    for(const dependency of graph.get(id)??[]){
      if(dependency===id||!graph.has(dependency))throw new Error('Dependensi harus menunjuk spesialis lain di dalam rencana brand ini.')
      visit(dependency)
    }
    visiting.delete(id);visited.add(id)
  }
  for(const task of tasks)visit(task.agentType)
  return {summary:plan.summary.trim(),tasks}
}
export function planningInstructions(active: string[]) {
  return `\n\nMODE PERENCANAAN MANAGER. Jangan mengerjakan hasil spesialis. Bagi permintaan sesuai RACI dalam konteks resmi; satu pemilik utama per pekerjaan. Pilih hanya spesialis yang diperlukan. Semua tugas adalah draft, tanpa publikasi atau aksi eksternal. Buat 1–5 paket, satu per spesialis. Paket tanpa dependensi dapat berjalan paralel. Untuk tahap berurutan, isi dependsOn dengan agentType spesialis pendahulu dalam rencana ini. Tahap berikutnya baru berjalan setelah semua hasil pendahulu disetujui manusia; hasil tersebut akan disertakan server. Jangan menyalin hasil yang belum tersedia atau mengarang bahwa tahap sebelumnya selesai. Dilarang dependensi ke diri sendiri, peran di luar rencana, atau siklus. Tidak boleh mendelegasikan kembali ke Manager atau brand lain. Jangan mengarang akses tool/gambar/video yang belum tersedia.\nBalas HANYA JSON: {"summary":"rencana dan batasan","tasks":[{"agentType":"content-creator","kind":"konten.caption","title":"Judul","brief":"brief mandiri lengkap, tujuan, audiens, input tersedia, batasan, kriteria hasil","dependsOn":[]}]}.\nPilihan peran dan jenis: ${JSON.stringify(Object.fromEntries(Object.entries(DELEGATION_KINDS).filter(([agent])=>active.includes(agent))))}`
}
export async function orchestrationState(store: OfficeStore, task: Task) {
  const {rows}=await store.db.query('SELECT plan FROM manager_plans WHERE brand_id=$1 AND task_id=$2',[task.brandId,task.id])
  if(!rows.length)return undefined
  const children=(await store.db.query('SELECT id FROM tasks WHERE brand_id=$1 AND parent_id=$2 ORDER BY created_at,id',[task.brandId,task.id])).rows
  const tasks=await Promise.all(children.map(row=>store.task(task.brandId,row.id)))
  return {plan:rows[0].plan as ManagerPlan,children:tasks.filter((t):t is Task=>!!t)}
}
export type OrchestrationState=NonNullable<Awaited<ReturnType<typeof orchestrationState>>>
export function dependencyTasks(state:OrchestrationState,task:Task):Task[] {
  const node=state.plan.tasks.find(t=>t.agentType===task.agentType)
  if(!node || !state.children.some(t=>t.id===task.id && t.brandId===task.brandId && t.parentId===task.parentId))throw new Error('Tugas bukan bagian rencana Manager.')
  return (node.dependsOn??[]).map(agent=>{
    const source=state.children.find(t=>t.agentType===agent && t.brandId===task.brandId && t.parentId===task.parentId)
    if(!source)throw new Error('Sumber dependensi tidak ditemukan dalam brand dan rencana ini.')
    return source
  })
}
export const dependencyApproved=(task:Task)=>['approved','done'].includes(task.status)
export function readyChildren(state:OrchestrationState) {
  return state.children.filter(child=>child.status==='queued' && dependencyTasks(state,child).every(dependencyApproved))
}
export async function cancelWorkflow(store:OfficeStore,brandId:string,taskId:string,actor:string,reason:string) {
  return transaction(store.db,async tx=>{
    const parent=await store.transition(brandId,taskId,'cancelled',{actor,reason},tx)
    if(parent.kind==='konten.orchestrasi'){
      const {rows}=await tx.query("SELECT id FROM tasks WHERE brand_id=$1 AND parent_id=$2 AND status NOT IN ('approved','done','cancelled') ORDER BY id FOR UPDATE",[brandId,taskId])
      for(const child of rows)await store.transition(brandId,child.id,'cancelled',{actor,reason:'Workflow Manager dibatalkan'},tx)
    }
    return parent
  })
}
export async function persistManagerPlan(store: OfficeStore, task: Task, plan: ManagerPlan, usage: {runId:string;source:string;model:string;inputTokens:number;outputTokens:number;durationMs:number}) {
  return transaction(store.db,async tx=>{
    const locked=await tx.query('SELECT status FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[task.brandId,task.id])
    if(locked.rows[0]?.status!=='running')throw new Error('Perencanaan dihentikan karena status tugas berubah.')
    const existing=await tx.query('SELECT task_id FROM manager_plans WHERE brand_id=$1 AND task_id=$2',[task.brandId,task.id])
    if(existing.rows.length)return
    await tx.query('INSERT INTO manager_plans (task_id,brand_id,plan) VALUES ($1,$2,$3)',[task.id,task.brandId,JSON.stringify(plan)])
    for(const child of plan.tasks){const created=await store.createTask(task.brandId,{...child,parentId:task.id,priority:task.priority,complex:task.complex,urgent:task.urgent,createdBy:'agent:manager'},tx);await tx.query(`INSERT INTO chat_inputs(task_id,brand_id,agent_type,attachment_ids,skills,use_memory,page_ranges,use_summary,excluded_memory_ids) SELECT $1,brand_id,$2,attachment_ids,ARRAY(SELECT unnest(skills) INTERSECT SELECT unnest(ARRAY['document-search','csv-profile','document-analysis','review-draft']::text[])),use_memory,page_ranges,use_summary,ARRAY(SELECT n.id FROM agent_notes n WHERE n.brand_id=i.brand_id AND n.agent_type IS NULL AND n.kind='memory' AND n.id=ANY(i.excluded_memory_ids)) FROM chat_inputs i WHERE task_id=$3 AND brand_id=$4`,[created.id,child.agentType,task.id,task.brandId])}
    await tx.query('INSERT INTO cost_events (task_id,brand_id,source,model,input_tokens,output_tokens,duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7)',[task.id,task.brandId,usage.source,usage.model,usage.inputTokens,usage.outputTokens,usage.durationMs])
    await audit(tx,{actor:'agent:manager',action:'manager.delegate',objectType:'task',objectId:task.id,brandId:task.brandId,after:{plan,runId:usage.runId}})
    await store.transition(task.brandId,task.id,'queued',{actor:'agent:manager',reason:'Menunggu hasil dan approval spesialis',patch:{attempts:0,error:null}},tx)
  })
}
