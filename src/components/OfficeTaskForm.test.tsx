// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { OfficeTaskForm } from './OfficeTaskForm.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true
it('preserves a failed brief and clears it only after the selected brand accepts the task',async()=>{
  let succeeds=false
  const fetcher=vi.fn(async()=>new Response(JSON.stringify(succeeds ? {} : {error:'Tidak tersambung'}),{status:succeeds ? 200 : 503}))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  const failures:string[]=[]
  try {
    await act(async()=>root.render(<OfficeTaskForm brand="jepangkoey" agent="content-creator" disabled={false} submit={async work=>{try{await work()}catch(e){failures.push(String(e))}}}/>))
    const input=host.querySelector('input')!,brief=host.querySelector('textarea')!
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Carousel baru')
      input.dispatchEvent(new Event('input',{bubbles:true}))
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(brief,'Buat konsep dari konteks resmi')
      brief.dispatchEvent(new Event('input',{bubbles:true}))
    })
    const submit=()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
    await act(async()=>{submit()})
    expect(failures[0]).toContain('Tidak tersambung')
    expect(brief.value).toBe('Buat konsep dari konteks resmi')
    succeeds=true
    await act(async()=>{submit()})
    expect(fetcher.mock.calls[1]).toEqual(['/api/office/brands/jepangkoey/tasks',expect.objectContaining({method:'POST',body:JSON.stringify({agentType:'content-creator',kind:'konten.carousel',title:'Carousel baru',brief:'Buat konsep dari konteks resmi',priority:2,urgent:false,complex:false})})])
    expect(input.value).toBe('')
    expect(brief.value).toBe('')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
