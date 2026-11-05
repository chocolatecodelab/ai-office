// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { Events } from './Events.tsx'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('blocks double submission and keeps the event brief when sending fails',async()=>{
  let rejectRequest:((response:Response)=>void)|undefined
  vi.stubGlobal('WebSocket',class{close(){}})
  const fetcher=vi.fn(async(path:string,options?:RequestInit)=>options?.method==='POST'?new Promise<Response>(resolve=>{rejectRequest=resolve}):new Response(JSON.stringify(path.endsWith('/status')?{integrations:[]}:[])))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Events/>))
    const title=host.querySelector('input')!,form=host.querySelector('form')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title,'Parents Talk');title.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))})
    expect(fetcher.mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1)
    expect(host.textContent).toContain('Membuat event…')
    await act(async()=>rejectRequest!(new Response(JSON.stringify({error:'Coba lagi nanti'}),{status:503})))
    expect(title.value).toBe('Parents Talk')
    expect(host.textContent).toContain('Coba lagi nanti')
    expect(host.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false)
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
