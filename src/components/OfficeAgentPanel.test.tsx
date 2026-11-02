// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { OfficeAgentPanel } from './OfficeAgentPanel.tsx'
import type { OfficeAgent, OfficeBrand, OfficeTask } from '../office-api.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true
it('sends chat to the selected brand and keeps the composer disabled while a response is queued',async()=>{
  vi.stubGlobal('WebSocket',class {close(){}})
  HTMLDialogElement.prototype.showModal=function(){this.open=true}
  const tasks:OfficeTask[]=[]
  const fetcher=vi.fn(async(path:string,options?:RequestInit)=>{
    if(path.endsWith('/chat')) {tasks.push({id:'one',kind:'konten.chat',agentType:'manager',brief:JSON.parse(String(options?.body)).message,status:'queued',createdAt:new Date().toISOString()} as OfficeTask); return new Response(JSON.stringify(tasks[0]))}
    return new Response(JSON.stringify(path.endsWith('/tasks') ? tasks : []))
  })
  vi.stubGlobal('fetch',fetcher)
  const agent={brandId:'ciaomanda',agentType:'manager',status:'idle',active:true} as OfficeAgent
  const brand={id:'ciaomanda',name:'Ciao Manda',agents:[agent]} as OfficeBrand
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>{root.render(<OfficeAgentPanel brand={brand} agent={agent} onClose={()=>{}}/>)})
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Kenali peran agent')!.click()})
    await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
    expect(fetcher.mock.calls.some(([path,options])=>path==='/api/office/brands/ciaomanda/agents/manager/chat' && options?.method==='POST')).toBe(true)
    expect(host.textContent).toContain('Pesan masuk antrean.')
    expect(host.querySelector<HTMLButtonElement>('form button')!.disabled).toBe(true)
    expect(fetcher.mock.calls.every(([path])=>path.startsWith('/api/office/brands/ciaomanda/'))).toBe(true)
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
