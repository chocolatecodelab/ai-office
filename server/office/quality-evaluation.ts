import type { Approval, Task } from './store.js'

/** Explicit cohorts prevent smoke tests and everyday chats silently becoming acceptance evidence. */
export function validateEvaluationIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 || value.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error('Pilih 1–100 ID tugas UUID untuk evaluasi.')
  if (new Set(value).size !== value.length) throw new Error('ID tugas evaluasi tidak boleh duplikat.')
  return value
}

export function evaluateQuality(brandId: string, tasks: Task[], approvals: Approval[]) {
  if (tasks.some(task => task.brandId !== brandId) || approvals.some(approval => approval.brandId !== brandId)) throw new Error('Evaluasi hanya boleh memuat satu brand.')
  const samples = tasks.map(task => {
    const first = approvals.filter(a => a.taskId === task.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0]
    const outcome = task.kind === 'konten.chat' ? 'excluded_chat' : task.status === 'cancelled' ? 'cancelled' : first?.decision === 'approved' ? 'first_pass' : first?.decision === 'rejected' ? 'revised' : task.status === 'failed' ? 'failed' : 'pending'
    return { taskId:task.id, agentType:task.agentType, outcome, firstApprovalId:first?.id ?? null }
  })
  const agents = [...new Set(samples.map(s=>s.agentType))].sort().map(agentType=>{
    const group=samples.filter(s=>s.agentType===agentType)
    const count=(outcome:string)=>group.filter(s=>s.outcome===outcome).length
    const firstPass=count('first_pass'), revised=count('revised'), failed=count('failed')
    const evaluated=firstPass+revised+failed, pending=count('pending'), cancelled=count('cancelled')
    const rate=evaluated ? firstPass/evaluated : null
    return { agentType, selected:group.length, evaluated, firstPass, revised, failed, pending, cancelled, excludedChats:count('excluded_chat'), firstPassRate:rate,
      acceptance: evaluated<20 || pending>0 || cancelled>0 ? 'insufficient_evidence' : rate!>=0.7 ? 'metric_met' : 'metric_not_met' }
  })
  return { brandId, target:0.7, minimumPerAgent:20, agents, samples,
    limitation:'Metrik approval pertama, bukan penilaian rubrik kualitas atau kelulusan fase. Gunakan cohort representatif yang ditetapkan sebelum pengujian; hasil mock dan live harus dievaluasi terpisah.' }
}
