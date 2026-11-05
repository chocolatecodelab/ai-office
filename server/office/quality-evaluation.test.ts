import { expect, it } from 'vitest'
import { evaluateQuality, validateEvaluationIds } from './quality-evaluation.js'
import type { Approval, Task } from './store.js'

const task=(id:string,status='approved',kind='konten.carousel')=>({id,brandId:'otca',agentType:'content_creator',status,kind} as Task)
const approval=(taskId:string,decision:Approval['decision'],createdAt='2026-11-05T10:00:00Z')=>({id:taskId+createdAt,taskId,brandId:'otca',decision,createdAt} as Approval)
it('counts the original decision rather than a later approval after revision',()=>{
  const result=evaluateQuality('otca',[task('a')],[approval('a','approved','2026-11-06'),approval('a','rejected')])
  expect(result.agents[0]).toMatchObject({firstPass:0,revised:1,acceptance:'insufficient_evidence'})
})
it('requires 20 evaluated tasks and reaches exactly 70 percent without rounding',()=>{
  const tasks=Array.from({length:20},(_,i)=>task(String(i)))
  const reviews=tasks.map((t,i)=>approval(t.id,i<14?'approved':'rejected'))
  expect(evaluateQuality('otca',tasks,reviews).agents[0]).toMatchObject({evaluated:20,firstPassRate:0.7,acceptance:'metric_met'})
  reviews[13].decision='rejected'
  expect(evaluateQuality('otca',tasks,reviews).agents[0].acceptance).toBe('metric_not_met')
})
it('keeps failed tasks in the denominator and excludes chat; pending and cancellation remain explicit',()=>{
  const result=evaluateQuality('otca',[task('a','failed'),task('b','done','konten.chat'),task('c','queued'),task('d','cancelled')],[])
  expect(result.agents[0]).toMatchObject({evaluated:1,failed:1,firstPassRate:0,excludedChats:1,pending:1,cancelled:1,acceptance:'insufficient_evidence'})
  expect(evaluateQuality('otca',[task('p','queued')],[]).agents[0].firstPassRate).toBeNull()
})
it('does not mix brands or accept ambiguous duplicate cohorts',()=>{
  expect(()=>evaluateQuality('ciaomanda',[task('a')],[])).toThrow()
  expect(()=>evaluateQuality('otca',[],[{...approval('a','approved'),brandId:'ciaomanda'}])).toThrow()
  const id='11111111-1111-4111-8111-111111111111'
  expect(validateEvaluationIds([id])).toEqual([id])
  for(const value of [[],[id,id],['bad'],Array(101).fill(id),null]) expect(()=>validateEvaluationIds(value)).toThrow()
})
