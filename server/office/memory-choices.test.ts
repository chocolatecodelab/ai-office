import { expect,it } from 'vitest'
import { validateMemoryChoices } from './memory-choices.js'
import { relevantNotes } from './chat-workspace.js'
import type { AgentNote } from './agent-notes.js'

it('keeps old messages compatible and canonicalizes UUID choices before duplicate checks',()=>{
  expect(validateMemoryChoices({})).toEqual({excludedMemoryIds:[],useSummary:true})
  const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  expect(validateMemoryChoices({excludedMemoryIds:[id.toUpperCase()],useSummary:false})).toEqual({excludedMemoryIds:[id],useSummary:false})
  for(const excludedMemoryIds of [[id,id.toUpperCase()],['bad'],'bad',Array(101).fill(id)])expect(()=>validateMemoryChoices({excludedMemoryIds})).toThrow()
  expect(()=>validateMemoryChoices({useSummary:'false'})).toThrow()
})
it('filters optional memories before ranking so another relevant memory can fill the place, while rules remain',()=>{
  const notes=[{id:'rule',kind:'rule',title:'Approval',body:'Review',active:true,updatedAt:'now'},...Array.from({length:7},(_,i)=>({id:String(i),kind:'memory',title:'Beasiswa',body:'Jerman',active:true,updatedAt:String(7-i)}))] as AgentNote[]
  const selected=relevantNotes(notes,'Beasiswa',true,['rule','0'])
  expect(selected.map(n=>n.id)).toEqual(['rule','1','2','3','4','5','6'])
  expect(relevantNotes(notes,'Beasiswa',false,['rule']).map(n=>n.id)).toEqual(['rule'])
})
