import type { OfficeStore } from './store.js'
import { videoPlanSchema } from './video-plan.js'

export async function reviewSummary(store:OfficeStore,brand:string,taskId:string){
  const job=(await store.db.query('SELECT payload,report FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[brand,taskId])).rows[0]
  if(!job)return undefined
  const headline=job.payload.spec?.slides?.[0]?.headline
  const superseded=(await store.db.query("SELECT payload FROM task_events WHERE brand_id=$1 AND task_id=$2 AND type='result_superseded' ORDER BY id DESC LIMIT 1",[brand,taskId])).rows[0]
  return {title:typeof headline==='string'?headline.replaceAll('**',''):job.payload.title,kind:job.payload.spec?'carousel':job.payload.video?.plan?'video-plan':'video-project',slides:job.payload.spec?.slides?.length??0,revision:/^Revisi\b/i.test(job.payload.brief??''),status:superseded?'superseded':job.report?.status}
}

/** Only saved outputs of this exact brand/task are eligible for human review. */
export async function approvalReview(store:OfficeStore,brand:string,id:string){
  const approval=(await store.approvals(brand)).find(a=>a.id===id)
  if(!approval)throw new Error('Review tidak ditemukan pada brand ini.')
  const task=await store.task(brand,approval.taskId)
  if(!task)throw new Error('Hasil pekerjaan tidak ditemukan.')
  const rows=(await store.db.query('SELECT a.id,a.name,a.mime,a.size_bytes,a.content,a.version FROM assets a JOIN approvals p ON p.brand_id=a.brand_id AND p.task_id=a.task_id WHERE a.brand_id=$1 AND p.id=$2 AND a.storage_key IS NOT NULL AND a.created_at<=p.created_at ORDER BY a.version DESC',[brand,id])).rows
  const saved=(await store.db.query("SELECT a.content FROM assets a JOIN approvals p ON p.brand_id=a.brand_id AND p.task_id=a.task_id WHERE a.brand_id=$1 AND p.id=$2 AND a.kind<>'artifact' AND a.created_at<=p.created_at ORDER BY a.version DESC LIMIT 1",[brand,id])).rows[0]
  const seen=new Set<string>()
  const files=rows.filter(row=>{if(seen.has(row.name))return false;seen.add(row.name);return true}).sort((a,b)=>a.name.localeCompare(b.name))
  const qaFile=files.find(row=>row.name==='qa-report.json')
  let qa: {status:string;critical:number;warnings:number;issues:Array<{slide:number;level:string;message:string}>}|null=null
  if(qaFile)try{
    const report=JSON.parse(qaFile.content)
    if(typeof report.critical==='number'&&typeof report.warnings==='number')qa={status:report.status,critical:report.critical,warnings:report.warnings,issues:(report.slides??[]).flatMap((slide:{slide:number;issues?:Array<{level:string;message:string}>})=>(slide.issues??[]).map(issue=>({slide:slide.slide,level:issue.level,message:issue.message}))).slice(0,30)}
  }catch{ /* Do not claim QA passed if the report is unreadable. */ }
  const visualFile=files.find(row=>row.name==='visual-review.json')
  let visual:null|{summary:string;passed:boolean;issues:Array<{slide:number;severity:string;message:string}>}=null
  if(visualFile)try{const data=JSON.parse(visualFile.content);visual=data.rounds?.at(-1)??null}catch{ /* Missing review is never a pass. */ }
  let videoPlan:null|ReturnType<typeof videoPlanSchema.parse>=null
  const planFile=files.find(file=>file.name==='production-plan.json')
  if(planFile)try{videoPlan=videoPlanSchema.parse(JSON.parse(planFile.content))}catch{/* An invalid saved plan is never presented as validated. */}
  return {summary:await reviewSummary(store,brand,task.id),files:files.map(f=>({id:f.id,name:f.name,mime:f.mime,size:f.size_bytes,version:f.version})),caption:files.find(f=>f.name==='caption.md')?.content??null,qa,visual,videoPlan,brief:task.brief,content:saved?.content??task.result}
}
