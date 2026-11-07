// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it } from 'vitest'
import { PaginatedItems } from './PaginatedItems.tsx'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('resets on filter change, clamps after deletion, and preserves page during polling',async()=>{
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  const data=Array.from({length:45},(_,i)=>i+1)
  const render=(items:number[],scope='all')=>act(async()=>root.render(<PaginatedItems items={items} scope={scope} label="aktivitas">{rows=><ul>{rows.map(n=><li key={n}>{n}</li>)}</ul>}</PaginatedItems>))
  const next=()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Berikutnya')!
  try{
    await render(data)
    expect(host.querySelectorAll('li')).toHaveLength(20)
    await act(async()=>next().click())
    await render([...data])
    expect(host.querySelector('li')?.textContent).toBe('21')
    await act(async()=>next().click())
    expect(host.querySelectorAll('li')).toHaveLength(5)
    expect(next().disabled).toBe(true)
    await render(data.slice(0,25))
    expect(host.querySelector('li')?.textContent).toBe('21')
    await render(data,'brand-otca')
    expect(host.querySelector('li')?.textContent).toBe('1')
    const size=host.querySelector('select')!
    await act(async()=>{size.value='10';size.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.querySelectorAll('li')).toHaveLength(10)
    await render([1,2,3],'emptying')
    expect(host.querySelector('nav')).toBeNull()
  }finally{await act(async()=>root.unmount());host.remove()}
})
