// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { OfficeAttention } from './OfficeAttention.tsx'
import type { OfficeBrand, AgentStatus } from '../office-api.ts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('reveals needs beyond four, prioritizes errors, and opens the correct brand',async()=>{
  const statuses:AgentStatus[]=['waiting_quota','waiting_approval','error','waiting_quota','waiting_approval','error']
  const brands=statuses.map((status,i)=>({id:`brand-${i}`,name:`Brand ${i}`,agents:[{active:true,agentType:'manager',status,currentTask:`Tugas ${i}`}]})) as OfficeBrand[]
  const select=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<OfficeAttention brands={brands} onSelect={select}/>))
    expect(host.textContent).toContain('Menampilkan 4 dari 6')
    expect(host.querySelector('button')?.textContent).toContain('Tugas 2')
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Lihat semua 6 agent')!.click()})
    expect(host.textContent).toContain('Menampilkan 6 dari 6')
    await act(async()=>host.querySelector('button')!.click())
    expect(select).toHaveBeenCalledWith('brand-2/manager','brand-2')
    await act(async()=>{const filter=host.querySelector('select')!;filter.value='waiting_quota';filter.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.textContent).toContain('Menampilkan 2 dari 2')
    expect(host.textContent).not.toContain('Tugas 2')
  } finally {await act(async()=>root.unmount());host.remove()}
})
