// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { ChatProjects } from './ChatProjects.tsx'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('selects an explicit ready version without creating a task and compares only within its project',async()=>{
  const change=vi.fn(),fetcher=vi.fn(async(path:string)=>new Response(JSON.stringify(path.includes('/compare?')?{slides:[],captionChanged:false}:[{id:'p',title:'Belajar bersama',versions:[{taskId:'v2',version:2,ready:true},{taskId:'v1',version:1,ready:true},{taskId:'pending',version:3,ready:false}]}])))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<ChatProjects base="/brands/otca/agents/content-creator" brand="otca" value="v2" onChange={change} refresh="" disabled={false}/>))
    await act(async()=>host.querySelector<HTMLButtonElement>('button')!.click())
    const selects=host.querySelectorAll('select')
    expect(selects[0].querySelector<HTMLOptionElement>('[value="pending"]')!.disabled).toBe(true)
    await act(async()=>{selects[0].value='v1';selects[0].dispatchEvent(new Event('change',{bubbles:true}))})
    expect(change).toHaveBeenCalledWith('v1')
    await act(async()=>{selects[1].value='v1';selects[1].dispatchEvent(new Event('change',{bubbles:true}))})
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Bandingkan')!.click())
    expect(host.textContent).toContain('Caption sama')
    expect(fetcher.mock.calls.every(([path])=>path.includes('/production/'))).toBe(true)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('compares videos and subtitle text, and restores only after an explicit confirmation',async()=>{
  const change=vi.fn(),fetcher=vi.fn(async(path:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{taskId:'v3',version:3}:path.includes('/compare?')?{slides:[],captionChanged:false,left:{version:1},right:{version:2},summary:{changed:2,unchanged:0,added:0,removed:0},files:[{name:'Video MP4',kind:'video',left:'a',right:'b',changed:true},{name:'subtitle.srt',kind:'text',left:'c',right:'d',leftText:'Old words',rightText:'New words',changed:true}]}:[{id:'video',title:'Reels Jepang',versions:[{taskId:'v2',version:2,ready:true,stage:'video-review'},{taskId:'v1',version:1,ready:true,stage:'video-review'}]}])))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<ChatProjects base="/brands/jepangkoey/agents/video-editor" brand="jepangkoey" value="v2" onChange={change} refresh="" disabled={false} onClose={()=>{}}/>))
    const selects=host.querySelectorAll('select')
    await act(async()=>{selects[1].value='v1';selects[1].dispatchEvent(new Event('change',{bubbles:true}))})
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Bandingkan')!.click())
    expect(host.querySelectorAll('video')).toHaveLength(2)
    expect(host.textContent).toContain('Old words')
    expect(host.textContent).toContain('New words')
    expect(host.textContent).toContain('2 berkas berubah')
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Pulihkan versi 2 sebagai versi baru')!.click())
    expect(fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(false)
    await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Pulihkan sebagai versi baru')!.click())
    expect(fetcher.mock.calls.find(([,init])=>init?.method==='POST')?.[0]).toContain('/versions/v2/restore')
    expect(change).toHaveBeenCalledWith('v3')
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Menunggu persetujuan baru')
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
