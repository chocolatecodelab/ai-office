import { transaction } from '../db/index.js'
import type { OfficeStore } from './store.js'

export function scheduleInput(value:unknown,now=Date.now()) {
 const input=value as {platform?:unknown;scheduledAt?:unknown}|null
 if(!input || !['instagram','facebook'].includes(String(input.platform)))throw new Error('Pilih platform instagram atau facebook.')
 if(typeof input.scheduledAt!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(input.scheduledAt))throw new Error('Jadwal harus ISO8601 dengan zona waktu.')
 const time=Date.parse(input.scheduledAt)
 const calendarDay=new Date(input.scheduledAt.slice(0,10)+'T00:00:00Z')
 if(!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0,10)!==input.scheduledAt.slice(0,10))throw new Error('Tanggal kalender tidak valid.')
 if(!Number.isFinite(time)||time<=now)throw new Error('Jadwal harus di masa depan.')
 return {platform:String(input.platform),scheduledAt:new Date(time).toISOString()}
}

export async function planSocialPost(store:OfficeStore,brand:string,taskId:string,input:unknown,actor:string) {
 const plan=scheduleInput(input)
 return transaction(store.db,async tx=>{
  const row=(await tx.query('SELECT * FROM tasks WHERE brand_id=$1 AND id=$2 FOR UPDATE',[brand,taskId])).rows[0]
  if(!row || row.agent_type!=='social-media-manager' || row.kind!=='publikasi.caption' || row.status!=='approved')throw new Error('Jadwal hanya untuk caption SMM brand ini yang sudah disetujui untuk publikasi.')
  const approval=(await tx.query('SELECT * FROM approvals WHERE brand_id=$1 AND task_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[brand,taskId])).rows[0]
  if(approval?.decision!=='approved'||approval.approval_type!=='publikasi')throw new Error('Approval publikasi yang sah diperlukan.')
  const asset=(await tx.query('SELECT * FROM assets WHERE brand_id=$1 AND task_id=$2 AND kind=$3 ORDER BY version DESC LIMIT 1',[brand,taskId,row.kind])).rows[0]
  if(!asset || asset.content!==row.result)throw new Error('Versi hasil yang disetujui tidak cocok.')
  const existing=(await tx.query('SELECT * FROM social_schedule WHERE brand_id=$1 AND task_id=$2 AND platform=$3',[brand,taskId,plan.platform])).rows[0]
  if(existing){
   if(existing.asset_id!==asset.id || existing.scheduled_at.toISOString()!==plan.scheduledAt || existing.status!=='planned')throw new Error('Jadwal berbeda sudah tersedia; jangan menimpa tanpa review baru.')
   return {...existing,delivery:'local-plan-only'}
  }
  const result=(await tx.query('INSERT INTO social_schedule(brand_id,task_id,asset_id,asset_version,approval_id,platform,scheduled_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[brand,taskId,asset.id,asset.version,approval.id,plan.platform,plan.scheduledAt,actor])).rows[0]
  await store.logEvent(tx,{id:taskId,brandId:brand},'social_schedule',{id:result.id,assetId:asset.id,version:asset.version,approvalId:approval.id,...plan,delivery:'local-plan-only',actor})
  return {...result,delivery:'local-plan-only'}
 })
}
