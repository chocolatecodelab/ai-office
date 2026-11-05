import { expect, it } from 'vitest'
import { parseManagerPlan, planningInstructions } from './orchestration.js'
const item={agentType:'content-creator',kind:'konten.caption',title:'Caption',brief:'Tujuan dan batasan'}
const json=(tasks:unknown[])=>JSON.stringify({summary:'Rencana',tasks})
it('accepts bounded specialist work and fenced JSON',()=>{
  expect(parseManagerPlan('```json\n'+json([item])+'\n```',['content-creator']).tasks).toEqual([item])
  expect(planningInstructions(['content-creator'])).not.toContain('"digital-marketing":')
})
it('rejects recursive delegation, foreign/inactive roles, publication actions, duplicate owners and empty plans',()=>{
  for(const tasks of [[],[item,item],[{...item,agentType:'manager'}],[{...item,agentType:'digital-marketing'}],[{...item,kind:'publikasi.publish'}],Array(6).fill(item)])expect(()=>parseManagerPlan(json(tasks),['content-creator'])).toThrow()
  expect(()=>parseManagerPlan('not json',['content-creator'])).toThrow('JSON')
})
it('rejects model-supplied brand targets instead of silently accepting or redirecting them',()=>{
  for(const fields of [{targetBrandId:'otca'},{targetBrandId:'infojerman'},{brandId:'ciaomanda'},{handoff:{target:'otca'}}])expect(()=>parseManagerPlan(json([{...item,...fields}]),['content-creator'])).toThrow('independen')
  expect(()=>parseManagerPlan(JSON.stringify({summary:'Rencana',tasks:[item],handoffs:[]}),['content-creator'])).toThrow('independen')
})
it('accepts out-of-order acyclic stages and rejects missing, self, duplicate and circular prerequisites',()=>{
  const video={agentType:'video-editor',kind:'video.storyboard',title:'Storyboard',brief:'Gunakan naskah yang disetujui',dependsOn:['content-creator']}
  expect(parseManagerPlan(json([video,item]),['content-creator','video-editor']).tasks[0].dependsOn).toEqual(['content-creator'])
  for(const tasks of [[{...item,dependsOn:['content-creator']}],[{...item,dependsOn:['other']}],[{...item,dependsOn:null}],[{...item,dependsOn:['video-editor','video-editor']},video],[{...item,dependsOn:['video-editor']},video]])expect(()=>parseManagerPlan(json(tasks),['content-creator','video-editor'])).toThrow()
})
