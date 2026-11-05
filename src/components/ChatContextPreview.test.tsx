// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ChatContextPreview } from './ChatContextPreview.tsx'
import type { ChatSelection } from './ChatWorkspace.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT:boolean }).IS_REACT_ACT_ENVIRONMENT=true
it('loads only on request, hides stale results, and keeps previews separate from sending chat',async()=>{
  const fetcher=vi.fn<(path:string,options?:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify({official:{core:['/context/agents/manager.md'],references:[],available:1,characters:100},notes:[{id:'one',title:'Beasiswa Jerman',body:'Mahasiswa',kind:'memory',scope:'agent',reason:'Kata cocok: beasiswa'}],omitted:[],unmatchedMemories:0,characters:100,budget:6000,memoryEnabled:true,summary:null,skills:[]})))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),manage=vi.fn()
  const render=(message:string)=><ChatContextPreview base="/brands/infojerman/agents/manager" message={message} selection={{attachments:[],skills:[],useMemory:true}} delegate={false} disabled={false} onManage={manage} onChange={()=>{}}/>
  const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click()})
  try{
    await act(async()=>root.render(render('Beasiswa')))
    expect(fetcher).not.toHaveBeenCalled()
    await click('Tinjau konteks')
    expect(host.textContent).toContain('Beasiswa Jerman')
    await act(async()=>root.render(render('Kopi')))
    expect(host.textContent).not.toContain('Beasiswa Jerman')
    expect(host.textContent).toContain('Pesan atau pilihan berubah')
    expect(fetcher).toHaveBeenCalledTimes(1)
    await click('Perbarui tinjauan')
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).message).toBe('Kopi')
    expect(fetcher.mock.calls.every(([path])=>String(path).endsWith('/context-preview'))).toBe(true)
    await click('Kelola memori & rules')
    expect(manage).toHaveBeenCalledOnce()
    expect(host.querySelector('section')).toBeNull()
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('excludes and restores a memory for one message and separately controls the summary',async()=>{
  const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  const fetcher=vi.fn(async(_path:string,options?:RequestInit)=>{
    expect(_path).toContain('/context-preview')
    const input=JSON.parse(String(options?.body))
    return new Response(JSON.stringify({official:{core:[],references:[],available:0},notes:[{id:'rule',title:'Approval wajib',body:'Review',kind:'rule',scope:'brand',reason:'Aturan aktif'},...(input.excludedMemoryIds.includes(id)?[]:[{id,title:'Beasiswa Jerman',body:'Isi memori khusus',kind:'memory',scope:'agent',reason:'Kata cocok: beasiswa'}])],excludedNotes:input.excludedMemoryIds.includes(id)?[{id,title:'Beasiswa Jerman'}]:[],omitted:[],unmatchedMemories:0,characters:100,budget:6000,memoryEnabled:true,summaryAvailable:true,summary:input.useSummary?{text:'Ringkasan lama',revision:1}:null,skills:[]}))
  })
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  function Wrapper(){const [selection,setSelection]=useState<ChatSelection>({attachments:[],skills:[],useMemory:true});return <ChatContextPreview base="/brands/infojerman/agents/manager" message="Beasiswa" selection={selection} onChange={setSelection} delegate={false} disabled={false} onManage={()=>{}}/>}
  const click=async(text:string)=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===text)!.click()})
  try{
    await act(async()=>root.render(<Wrapper/>))
    await click('Tinjau konteks')
    expect(host.textContent).toContain('Isi memori khusus')
    await click('Abaikan untuk pesan ini')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Gunakan kembali Beasiswa Jerman')
    expect(host.textContent).not.toContain('Isi memori khusus')
    expect(host.textContent).toContain('Approval wajib')
    expect(host.textContent).toContain('1 memori dikecualikan')
    await act(async()=>host.querySelector<HTMLInputElement>('.chat-summary-choice input')!.click())
    expect(host.textContent).not.toContain('Ringkasan lama')
    expect(host.textContent).toContain('Ringkasan tersimpan tidak disertakan')
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({excludedMemoryIds:[id],useSummary:false})
    await click('Gunakan kembali')
    expect(document.activeElement?.textContent).toBe('Abaikan untuk pesan ini')
    expect(host.textContent).toContain('Isi memori khusus')
    await click('Atur ulang pilihan pesan')
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({excludedMemoryIds:[],useSummary:true})
    expect(host.textContent).toContain('Ringkasan lama')
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
