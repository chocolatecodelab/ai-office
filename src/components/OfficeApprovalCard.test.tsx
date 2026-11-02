// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import type { OfficeApproval } from '../office-api.ts'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true
const approval={id:'review-1',brandId:'infojerman',taskId:'task-1',approvalType:'konten',approver:'Reviewer',createdAt:'2026-11-03T00:00:00Z',task:{agentType:'content-creator',title:'Carousel',result:'Hasil lengkap'}} as OfficeApproval
it('submits only once to the selected brand and reloads after success',async()=>{
  let finish!:(value:Response)=>void
  const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve}))
  vi.stubGlobal('fetch',fetcher)
  const decided=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<ApprovalCard approval={approval} onDecided={decided}/>))
    const buttons=host.querySelectorAll('button')
    expect(buttons[1].disabled).toBe(true)
    await act(async()=>{buttons[0].click();buttons[0].click()})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toEqual(['/api/office/brands/infojerman/approvals/review-1',expect.objectContaining({method:'POST',body:JSON.stringify({decision:'approved',note:''})})])
    await act(async()=>finish(new Response('{}')))
    expect(decided).toHaveBeenCalledTimes(1)
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
it('keeps a failed decision retryable and does not report success',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Koneksi terputus'}),{status:503})))
  const decided=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<ApprovalCard approval={approval} onDecided={decided}/>))
    await act(async()=>host.querySelector('button')!.click())
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Koneksi terputus')
    expect(host.querySelector('button')!.disabled).toBe(false)
    expect(decided).not.toHaveBeenCalled()
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
it('submits revision notes for the specific approval being reviewed',async()=>{
  const fetcher=vi.fn(async()=>new Response('{}'))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<><ApprovalCard approval={approval} onDecided={()=>{}}/><ApprovalCard approval={{...approval,id:'review-2'}} onDecided={()=>{}}/></>))
    const textarea=host.querySelector('textarea')!
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Tambahkan sumber resmi')
      textarea.dispatchEvent(new Event('input',{bubbles:true}))
    })
    const buttons=host.querySelectorAll('button')
    expect(buttons[1].disabled).toBe(false)
    expect(buttons[3].disabled).toBe(true)
    await act(async()=>buttons[1].click())
    expect(fetcher.mock.calls[0]).toEqual(['/api/office/brands/infojerman/approvals/review-1',expect.objectContaining({body:JSON.stringify({decision:'rejected',note:'Tambahkan sumber resmi'})})])
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
