import type { OfficeApproval } from './office-api.ts'
export const approvalTitle=(a:OfficeApproval)=>a.review?.title||a.task?.title||'Hasil pekerjaan'
export const approvalPending=(a:OfficeApproval)=>!a.decision&&(!a.task?.status||a.task.status==='waiting_approval')
export const reviewDate=(value:string)=>new Date(value).toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
