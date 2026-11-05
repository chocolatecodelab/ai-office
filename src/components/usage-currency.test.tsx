// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { Usage } from '../pages/Usage.tsx'

const figures={runs:2,tokens:1000,inputTokens:800,outputTokens:200,costUsd:0}
function report(brand:string) {return {totals:figures,brands:[{...figures,brandId:'otca',label:brand}],agents:[{...figures,brandId:'otca',brandName:brand,agentType:'manager'}],kinds:[{...figures,kind:'konten.chat'}],models:[{...figures,source:'codex',model:'test-model'}],langfuse:{status:'ok',generations:2,inputTokens:800,outputTokens:200,costUsd:0.3758,models:[],environments:[]}}}

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('keeps the Langfuse USD and rupiah estimate visible even when the local period has no runs',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({totals:{runs:0},langfuse:{status:'ok',generations:1,inputTokens:10,outputTokens:2,costUsd:0.3758,models:[],environments:[]}}))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Usage/>))
    expect(host.textContent).toContain('Belum ada pemakaian kantor')
    expect(host.textContent).toContain('$0.3758')
    expect(host.textContent?.replace(/\s/g,'')).toContain('Rp6.828')
    expect(host.textContent).toContain('bukan kurs otomatis')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('changes the chart grouping and metric, and shows exact details for zero paid usage',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify(report('Official OTCA')))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Usage/>))
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='Agent')!.click()})
    expect(host.querySelector('.ranking-label')?.textContent).toContain('Manager')
    const select=host.querySelector<HTMLSelectElement>('.usage-breakdown select')!
    await act(async()=>{select.value='costUsd';select.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.textContent).toContain('Belum ada biaya LiteLLM yang tercatat')
    await act(async()=>host.querySelector<HTMLButtonElement>('.ranking-row')!.click())
    expect(host.querySelector('.ranking-details')?.textContent).toContain('800 token')
    expect(host.querySelector('.ranking-details')?.textContent).toContain('$0.00')
    expect(host.innerHTML).not.toContain('NaN')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('does not show a late old response under a newly selected period',async()=>{
  let resolveSeven:((response:Response)=>void)|undefined
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.includes('days=30')?new Response(JSON.stringify(report('PEROLEHAN 30 HARI'))):new Promise<Response>(resolve=>{resolveSeven=resolve})))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Usage/>))
    await act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent==='30 hari')!.click()})
    expect(host.textContent).toContain('PEROLEHAN 30 HARI')
    await act(async()=>resolveSeven!(new Response(JSON.stringify(report('DATA LAMA 7 HARI')))))
    expect(host.textContent).not.toContain('DATA LAMA 7 HARI')
    expect(host.textContent).toContain('PEROLEHAN 30 HARI')
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
