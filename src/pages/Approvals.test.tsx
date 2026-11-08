// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { Approvals } from './Approvals.tsx'

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('includes sister-brand approvals by default and filters them without changing their scope',async()=>{
  vi.stubGlobal('WebSocket',class{close(){}})
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(JSON.stringify(path.endsWith('/brands')?[{id:'otca',name:'Official OTCA'},{id:'infojerman',name:'Info Jerman'}]:path.includes('/infojerman/')?[{id:'review',brandId:'infojerman',taskId:'task',approvalType:'konten',approver:'Reviewer',createdAt:'2026-11-04T00:00:00Z',task:{title:'Hasil Info Jerman',agentType:'manager',result:'Draft untuk ditinjau'}}]:[]))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Approvals/>))
    expect(host.textContent).toContain('Hasil Info Jerman')
    const filter=host.querySelector('select')!
    expect(filter.value).toBe('all')
    await act(async()=>{filter.value='otca';filter.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.textContent).not.toContain('Hasil Info Jerman')
    expect(host.textContent).toContain('Tidak ada yang menunggu')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
