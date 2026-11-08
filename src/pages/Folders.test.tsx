// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { Folders } from './Folders.tsx'
import type { AssetItem } from '../office-api.ts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('includes older PDFs in All, renders PNG thumbnails and keeps filter counts consistent',async()=>{
  const assets:AssetItem[]=Array.from({length:10},(_,i)=>({id:String(i),taskId:String(i),brandId:'otca',brandName:'Official OTCA',kind:'artifact',version:1,name:i===9?'older.pdf':`slide-${i}.png`,mime:i===9?'application/pdf':'image/png',downloadable:true,size:100,excerpt:'Pipeline text',title:'QA',agentType:'content-creator',createdAt:new Date(Date.UTC(2026,10,6-i)).toISOString()}))
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({assets}))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<Folders/>))
    expect(host.querySelectorAll('.fb-card')).toHaveLength(10)
    expect(host.textContent).toContain('older.pdf')
    const image=host.querySelector<HTMLImageElement>('.fb-thumbnail-image')!
    expect(image.getAttribute('src')).toBe('/api/office/brands/otca/assets/0/file?inline=1')
    await act(async()=>image.dispatchEvent(new Event('error')))
    expect(host.textContent).toContain('Pratinjau tidak tersedia')
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.fb-chip')).find(b=>b.textContent?.startsWith('PDF'))!.click())
    expect(host.querySelectorAll('.fb-card')).toHaveLength(1)
    expect(host.querySelector('.fb-card')?.textContent).toContain('older.pdf')
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.fb-chip')).find(b=>b.textContent?.startsWith('Semua'))!.click())
    expect(host.querySelectorAll('.fb-card')).toHaveLength(10)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('paginates all matching files and resets the page when filtering or changing page size',async()=>{
  const assets:AssetItem[]=Array.from({length:27},(_,i)=>({id:String(i),taskId:String(i),brandId:'otca',brandName:'Official OTCA',kind:'artifact',version:1,name:i===26?'last.pdf':`document-${i}.md`,mime:i===26?'application/pdf':'text/markdown',downloadable:true,size:100,excerpt:'',title:'QA',agentType:'manager',createdAt:new Date(Date.UTC(2026,10,6,0,0,-i)).toISOString()}))
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({assets}))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  const button=(text:string)=>Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===text)!
  try{
    await act(async()=>root.render(<Folders/>))
    expect(host.querySelectorAll('.fb-card')).toHaveLength(24)
    expect(button('Sebelumnya').disabled).toBe(true)
    await act(async()=>button('Berikutnya').click())
    expect(host.querySelectorAll('.fb-card')).toHaveLength(3)
    expect(host.textContent).toContain('25–27 dari 27')
    expect(button('Berikutnya').disabled).toBe(true)
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.fb-chip')).find(b=>b.textContent?.startsWith('PDF'))!.click())
    expect(host.querySelectorAll('.fb-card')).toHaveLength(1)
    expect(host.textContent).toContain('Halaman 1 dari 1')
    await act(async()=>Array.from(host.querySelectorAll<HTMLButtonElement>('.fb-chip')).find(b=>b.textContent?.startsWith('Semua'))!.click())
    const select=host.querySelector<HTMLSelectElement>('.fb-pagination select')!
    await act(async()=>{select.value='12';select.dispatchEvent(new Event('change',{bubbles:true}))})
    expect(host.querySelectorAll('.fb-card')).toHaveLength(12)
    expect(host.textContent).toContain('Halaman 1 dari 3')
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
