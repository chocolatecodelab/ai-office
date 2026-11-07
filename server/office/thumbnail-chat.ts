import {z} from 'zod'
import {videoEdits} from './video-revision.js'
import type {OfficeStore,Task} from './store.js'
import type {RunnerDeps} from './runner.js'
import {transaction} from '../db/index.js'
import {registerProductionVersion,ProductionSourceChoiceRequired} from './production-projects.js'
export class VideoSourceChoiceRequired extends ProductionSourceChoiceRequired {
 constructor(message='Ada beberapa proyek video. Pilih hasil yang ingin direvisi melalui menu percakapan → Proyek dan versi, lalu kirim ulang arahan Anda.'){super(message)}
}
export const thumbnailPatch=z.object({margin:z.number().int().min(8).max(160).optional(),headline:z.string().min(1).max(180).optional(),subheadline:z.string().max(180).optional(),frame_time:z.number().min(0).max(600).optional()}).strict().refine(x=>Object.keys(x).length>0)
export function wantsThumbnailRevision(message:string){const positive=message.split(/[.!?\n]/).filter(clause=>!/^\s*(jangan|tidak perlu)/i.test(clause)).join(' ').replace(/bukan\s+(thumbnail|cover|sampul)/gi,'');return /thumbnail|cover|sampul/i.test(positive)&&/revisi|ubah|ganti|tolong|margin|padding|geser|perbesar|perkecil/i.test(positive)&&!/^\s*(jangan|tidak perlu)/i.test(message)}
export async function activeVideoProject(store:OfficeStore,task:Task){
 const selected=(await store.db.query('SELECT production_source_task_id AS id FROM chat_inputs WHERE brand_id=$1 AND task_id=$2',[task.brandId,task.id])).rows[0]?.id
 const rows=(await store.db.query(`SELECT p.payload,t.id,a.name,p.report,v.project_id FROM production_jobs p JOIN tasks t ON t.id=p.task_id AND t.brand_id=p.brand_id LEFT JOIN production_versions v ON v.task_id=t.id AND v.brand_id=t.brand_id LEFT JOIN LATERAL (SELECT name FROM assets WHERE task_id=t.id AND brand_id=t.brand_id AND mime='video/mp4' AND storage_key IS NOT NULL LIMIT 1) a ON true
 WHERE t.brand_id=$1 AND t.agent_type=$2 AND t.created_at<$3 AND ($4::uuid IS NULL OR t.id=$4) AND (t.status IN ('waiting_approval','approved','done') OR $4::uuid IS NOT NULL) AND (p.payload->>'nativeProject' IS NOT NULL OR a.name IS NOT NULL)
 AND EXISTS(SELECT 1 FROM assets WHERE task_id=t.id AND brand_id=t.brand_id AND storage_key IS NOT NULL)
 ORDER BY t.created_at DESC`,[task.brandId,task.agentType,task.createdAt,selected??null])).rows
 if(!selected&&new Set(rows.map(r=>r.project_id??r.id)).size>1)throw new VideoSourceChoiceRequired()
 const row=rows[0]
 if(selected&&!row)throw new VideoSourceChoiceRequired('Versi sumber yang dipilih tidak memiliki proyek video yang dapat diedit. Pilih hasil video lain melalui Proyek dan versi.')
 if(!row)return undefined
 const project=row.payload.nativeProject??row.name?.replace(/\.mp4$/i,'')
 if(!/^[a-z0-9_-]{1,120}$/.test(project??''))return undefined
 return {project,stage:row.report?.stage,sourceTaskId:row.payload.sourceTaskId as string,taskId:row.id}
}
export function thumbnailInstructions(project:unknown){return `\nALAT REVISI THUMBNAIL TERSEDIA. Proyek aktif: ${JSON.stringify(project)}. Gunakan proyek ini; pengguna tidak perlu unggah ulang. Revisi hanya cover, MP4 tetap. Balas hanya JSON {"patch":{"margin":64,"headline":"teks dengan pemenggalan baris\\nberikutnya"}}; field opsional subheadline, frame_time. margin adalah padding kiri/kanan dalam px pada lebar 1080; pilih 48–80 untuk permintaan lebih lapang tanpa angka. Headline maksimal 3 baris, subheadline maksimal 2. Jika margin membuat baris terlalu panjang, ubah pemenggalan saja dan pertahankan kata/isi kecuali pengguna meminta ubah teks. Jangan mengecilkan font. Jika maksud ambigu balas {"question":"..."}. Jangan mengklaim hasil sebelum renderer selesai.`}
export async function executeThumbnailRevision(deps:RunnerDeps,task:Task,source:NonNullable<Awaited<ReturnType<typeof activeVideoProject>>>,output:string,kind:'thumbnail'|'video'|'render'='thumbnail'){
 const parsed=JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))
 if(parsed.question)return {question:z.string().min(1).max(1200).parse(parsed.question)}
 const patch=kind==='thumbnail'?thumbnailPatch.parse(parsed.patch):undefined
 const edits=kind==='video'?videoEdits.parse(parsed.edits):undefined
 const job=(await deps.store.db.query('SELECT payload FROM production_jobs WHERE brand_id=$1 AND task_id=$2',[task.brandId,source.sourceTaskId])).rows[0]
 if(!deps.videoAttachments||!deps.production)throw new Error('Alat produksi atau pustaka footage belum tersedia.')
 const hashes:string[]=[]
 for(const binding of job?.payload.video?.sources??[])hashes.push((await deps.videoAttachments!.material(task.brandId,binding.taskId,binding.attachmentId)).sha256)
 if(!hashes.length)throw new Error('Izin footage proyek sumber tidak tersedia.')
 let approval:Record<string,unknown>={}
 if(kind==='render'){
  const saved=(await deps.store.db.query("SELECT content FROM assets WHERE brand_id=$1 AND task_id=$2 AND name='video-revision.json' ORDER BY version DESC LIMIT 1",[task.brandId,source.taskId])).rows[0]
  const snapshot=saved?JSON.parse(saved.content):null
  if(!snapshot?.staticFootageSha256||!snapshot?.propsSha256||!snapshot?.compositionSha256||!snapshot?.previewSha256)throw new Error('Preview ini belum memiliki versi persetujuan lengkap. Buat preview terbaru dahulu.')
  approval={staticFootageSha256:snapshot.staticFootageSha256,propsSha256:snapshot.propsSha256,compositionSha256:snapshot.compositionSha256,previewSha256:snapshot.previewSha256,previewTaskId:source.taskId,requestedBy:task.createdBy,instruction:task.brief,requestedAt:task.createdAt}
  await deps.store.logEvent(deps.store.db,task,'video_render_requested',approval)
 }
 const client=await deps.store.db.connect()
 const abort=new AbortController()
 let checking=false
 const monitor=kind==='render'?setInterval(()=>{if(checking)return;checking=true;void Promise.all([deps.store.task(task.brandId,task.id),deps.store.isPaused(task.brandId,task.agentType)]).then(([current,paused])=>{if(current?.status==='cancelled'||paused)abort.abort()}).catch(()=>abort.abort()).finally(()=>{checking=false})},1500):undefined
 let locked=false
 let result:Awaited<ReturnType<NonNullable<RunnerDeps['production']>['reviseThumbnail']>>
 try{
   locked=(await client.query('SELECT pg_try_advisory_lock(7234017) AS locked')).rows[0].locked
   if(!locked)throw new Error('Mesin produksi sedang dipakai. Revisi thumbnail menunggu percobaan berikutnya.')
   result=kind==='render'?await deps.production!.renderRevision(task.brandId,task.id,source.project,hashes,approval,abort.signal,percent=>{void deps.store.db.query("UPDATE tasks SET result=$3,updated_at=now() WHERE brand_id=$1 AND id=$2 AND status='running'",[task.brandId,task.id,'Merender MP4 revisi · '+percent+'% gambar selesai. Penggabungan audio dan QA menyusul.']).catch(()=>abort.abort())}):kind==='thumbnail'?await deps.production!.reviseThumbnail(task.brandId,task.id,source.project,patch!,hashes):await deps.production!.reviseVideo(task.brandId,task.id,source.project,edits,hashes)
 }finally{if(monitor)clearInterval(monitor);if(locked)await client.query('SELECT pg_advisory_unlock(7234017)');client.release()}
 if((await deps.store.task(task.brandId,task.id))?.status==='cancelled'||await deps.store.isPaused(task.brandId,task.agentType))throw new Error('Revisi dihentikan atau agent dijeda; hasil belum diajukan.')
 const child=await deps.store.createTask(task.brandId,{agentType:'video-editor',kind:'video.proyek',parentId:task.id,title:kind==='render'?'Hasil render revisi':kind==='thumbnail'?'Revisi thumbnail':'Preview revisi video',brief:task.brief,createdBy:'agent:video-editor'})
 await deps.store.db.query('INSERT INTO production_jobs(task_id,brand_id,agent_type,payload) VALUES($1,$2,$3,$4)',[child.id,task.brandId,task.agentType,JSON.stringify({nativeProject:result.report.project,sourceTaskId:source.sourceTaskId,revisionOf:source.taskId})])
 await transaction(deps.store.db,tx=>registerProductionVersion(tx,task.brandId,task.agentType,child.id,child.title,source.taskId))
 await deps.store.transition(task.brandId,child.id,'running',{actor:'worker:production'})
 try{await deps.store.submitProduction(task.brandId,child.id,result)}catch(error){await deps.store.transition(task.brandId,child.id,'failed',{actor:'worker:production',patch:{error:String(error)}});throw error}
 return {taskId:child.id}
}
