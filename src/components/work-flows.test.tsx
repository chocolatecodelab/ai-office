// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { TaskBoard } from '../pages/TaskBoard.tsx'
import { TaskComposer } from './TaskComposer.tsx'
import type { OfficeBrand, OfficeTask } from '../office-api.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true
const task = {id:'task-jerman',brandId:'infojerman',agentType:'manager',title:'Rencana konten',brief:'Brief yang benar',result:'Hasil untuk Info Jerman',status:'done',updatedAt:'2026-11-04T12:00:00Z'} as OfficeTask
const brands = ['otca','infojerman'].map(id=>({id,name:id==='otca'?'Official OTCA':'Info Jerman',paused:false,agents:[{brandId:id,agentType:'manager',active:true,paused:false,status:'idle',currentTask:null}]})) as OfficeBrand[]

it('opens brand-scoped task results and returns to the same board filter',async()=>{
  vi.stubGlobal('WebSocket',class {close(){}})
  const fetcher=vi.fn(async(path:string)=>new Response(JSON.stringify(
    path.includes('/tasks/task-jerman') ? {task,approvals:[]} : path.startsWith('/api/office/tasks') ? [{...task,brandName:'Info Jerman'}] : path.startsWith('/api/office/brands') ? brands : {assets:[]}
  )))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<TaskBoard/>))
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Info Jerman')!.click()})
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Rencana konten')!.click()})
    expect(host.querySelector('[role=dialog]')?.textContent).toContain('Hasil untuk Info Jerman')
    expect(fetcher.mock.calls.some(([path])=>path.startsWith('/api/office/brands/infojerman/tasks/task-jerman'))).toBe(true)
    expect(fetcher.mock.calls.some(([path])=>path.includes('/brands/otca/tasks/'))).toBe(false)
    await act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="Kembali ke daftar tugas"]')!.click()})
    expect(host.querySelector('[role=dialog]')).toBeNull()
    expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Info Jerman')?.getAttribute('aria-pressed')).toBe('true')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('submits once to the chosen brand and reports the accepted task',async()=>{
  let accept:((response:Response)=>void)|undefined
  const fetcher=vi.fn<(path:string,options?:RequestInit)=>Promise<Response>>(()=>new Promise<Response>(resolve=>{accept=resolve}))
  vi.stubGlobal('fetch',fetcher)
  const created=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<TaskComposer brands={brands} initialBrand="infojerman" onClose={()=>{}} onCreated={created}/>))
    const form=host.querySelector('form')!,title=host.querySelector<HTMLInputElement>('input:not([type=checkbox])')!,brief=host.querySelector('textarea')!
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'Rencana konten');title.dispatchEvent(new Event('input',{bubbles:true}))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(brief,'Tujuan untuk Info Jerman');brief.dispatchEvent(new Event('input',{bubbles:true}))
    })
    await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe('/api/office/brands/infojerman/tasks')
    expect(host.textContent).toContain('Mengirim tugas…')
    await act(async()=>accept!(new Response(JSON.stringify(task))))
    expect(created).toHaveBeenCalledWith(task)
    expect(brief.value).toBe('')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
