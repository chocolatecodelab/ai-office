// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { OfficeAgentPanel } from './OfficeAgentPanel.tsx'
import type { OfficeAgent,OfficeBrand } from '../office-api.ts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('shows produced video directly in chat, with controls and a download, outside supporting files',async()=>{
 vi.stubGlobal('WebSocket',class{close(){}})
 HTMLDialogElement.prototype.showModal=function(){this.open=true}
 HTMLDialogElement.prototype.close=function(){this.open=false}
 const tasks=[{id:'chat',kind:'konten.chat',agentType:'video-editor',brief:'Render video',result:'Video selesai',status:'done',createdAt:'2026-11-07T00:00:00Z',updatedAt:'2026-11-07T00:00:01Z',artifacts:[{name:'reels.mp4',mime:'video/mp4',assetId:'clip',content:'',size:1000},{name:'thumbnail.png',mime:'image/png',assetId:'cover',content:''},{name:'subtitle.vtt',mime:'text/vtt',assetId:'captions',content:''},{name:'qa.md',mime:'text/markdown',assetId:'qa',content:'QA'}]}]
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>new Response(JSON.stringify(path.endsWith('/tasks')?tasks:[]))))
 const agent={brandId:'otca',agentType:'video-editor',status:'idle',active:true} as OfficeAgent
 const brand={id:'otca',name:'Official OTCA',agents:[agent]} as OfficeBrand
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
 try{
 await act(async()=>root.render(<OfficeAgentPanel brand={brand} agent={agent} onClose={()=>{}}/>))
 const video=host.querySelector('video')!
 expect(video).not.toBeNull();expect(video.controls).toBe(true);expect(video.autoplay).toBe(false);expect(video.playsInline).toBe(true)
 expect(video.getAttribute('src')).toBe('/api/office/brands/otca/assets/clip/file?inline=1')
 expect(video.getAttribute('poster')).toContain('/assets/cover/file?inline=1')
 expect(video.querySelector('track')?.getAttribute('src')).toContain('/assets/captions/file?inline=1')
 expect(video.closest('details')).toBeNull()
 expect(host.querySelector('a[download="reels.mp4"]')).not.toBeNull()
 expect(host.querySelector('.artifact-reader')).toBeNull()
 await act(async()=>video.dispatchEvent(new Event('error')))
 expect(host.textContent).toContain('tidak dapat diputar di browser')
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
