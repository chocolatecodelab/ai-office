import { fileURLToPath } from 'node:url'
import { expect, it, vi } from 'vitest'
import { runTask } from './runner.js'
import type { OfficeStore, Task } from './store.js'

it('keeps chat context within the agent and passes results through approval', async () => {
  const task={id:'new',brandId:'otca',agentType:'manager',kind:'konten.chat',title:'Lanjutkan',brief:'Bantu saya',status:'queued',attempts:0,createdAt:'2026-11-03T00:02:00Z',updatedAt:'now',urgent:false,complex:false} as Task
  const tasks=vi.fn(async () => [
    {...task,id:'previous',createdAt:'2026-11-03T00:01:00Z',brief:'Tema lama',result:'Jawaban sebelumnya'},
    {...task,id:'other',agentType:'video-editor',createdAt:'2026-11-03T00:01:00Z',result:'RAHASIA AGENT LAIN'},
    {...task,id:'future',createdAt:'2026-11-03T00:03:00Z',result:'PESAN MASA DEPAN'},
  ])
  const submitForApproval=vi.fn()
  const run=vi.fn(async () => ({runId:'r',status:'completed' as const,output:'Jawaban terbaru',model:'test',inputTokens:1,outputTokens:1}))
  const store={task:async()=>task,isPaused:async()=>false,transition:async()=>task,revisionNotes:async()=>[],tasks,submitForApproval} as unknown as OfficeStore
  await runTask({store,hermes:{run},endpoint:()=>({url:'http://mock',key:'test'}),contextDir:fileURLToPath(new URL('../../context',import.meta.url)),brandName:async()=> 'Official OTCA'},'otca','new')
  expect(tasks).toHaveBeenCalledWith('otca')
  const input=(run.mock.calls[0] as unknown as [unknown,{input:string}])[1].input
  expect(input).toContain('Jawaban sebelumnya')
  expect(input).not.toContain('RAHASIA AGENT LAIN')
  expect(input).not.toContain('PESAN MASA DEPAN')
  expect(submitForApproval).toHaveBeenCalledWith('otca','new',expect.objectContaining({content:'Jawaban terbaru'}))
})
