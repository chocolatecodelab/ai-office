// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import type { OfficeApproval } from '../office-api.ts'

;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('lets a reviewer inspect slides and caption and requests instructions before sending a revision',async()=>{
  const request=vi.fn<(path:RequestInfo|URL,options?:RequestInit)=>Promise<Response>>(async()=>new Response(JSON.stringify({files:[{id:'a',name:'slide-01.png',mime:'image/png',size:10},{id:'b',name:'slide-02.png',mime:'image/png',size:10}],caption:'Caption yang perlu ditinjau',content:'Hasil',brief:'Brief awal',qa:{critical:0,warnings:1,issues:[{slide:2,level:'warning',message:'Periksa kontras judul.'}]}})))
  vi.stubGlobal('fetch',request)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  const approval={id:'review-ui',taskId:'task',brandId:'otca',approvalType:'konten',approver:'Reviewer',decision:null,createdAt:'2026-11-06T12:00:00Z',task:{id:'task',title:'Carousel contoh',status:'waiting_approval',result:'Hasil',agentType:'content-creator'}} as OfficeApproval
  const button=(label:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
  try{
    await act(async()=>root.render(<ApprovalCard approval={approval} onDecided={()=>{}}/>))
    expect(host.querySelector('.review-image-stage img')?.getAttribute('alt')).toContain('Slide 1')
    await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Slide berikutnya"]')!.click())
    expect(host.querySelector('.review-image-stage img')?.getAttribute('alt')).toContain('Slide 2')
    await act(async()=>button('Caption').click())
    expect(host.querySelector('.review-caption')?.textContent).toContain('Caption yang perlu ditinjau')
    expect(host.textContent).toContain('Konten tidak otomatis dipublikasikan')
    await act(async()=>button('Minta revisi').click())
    expect(host.querySelector('textarea')).not.toBeNull()
    expect(button('Kirim arahan revisi').disabled).toBe(true)
    expect(request.mock.calls.every(([,options])=>options?.method!=='POST')).toBe(true)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

const sampleApproval={id:'review-1',brandId:'infojerman',taskId:'task-1',approvalType:'konten',approver:'Reviewer',createdAt:'2026-11-03T00:00:00Z',task:{agentType:'content-creator',title:'Carousel',result:'Hasil lengkap'}} as OfficeApproval
const readyReview={files:[],caption:null,content:'Hasil lengkap',brief:'Brief',qa:null}
const action=(host:HTMLElement,text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!

it('submits only once to the selected brand and reloads after success',async()=>{
  let finish!:(value:Response)=>void
  const fetcher=vi.fn(( _path:RequestInfo|URL,options?:RequestInit)=>options?.method==='POST'?new Promise<Response>(resolve=>{finish=resolve}):Promise.resolve(new Response(JSON.stringify(readyReview))))
  vi.stubGlobal('fetch',fetcher)
  const decided=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<ApprovalCard approval={sampleApproval} onDecided={decided}/>))
    await act(async()=>{action(host,'Setujui hasil').click();action(host,'Setujui hasil').click()})
    const posts=fetcher.mock.calls.filter(([,options])=>options?.method==='POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]).toEqual(['/api/office/brands/infojerman/approvals/review-1',expect.objectContaining({method:'POST',body:JSON.stringify({decision:'approved',note:''})})])
    await act(async()=>finish(new Response('{}')))
    expect(decided).toHaveBeenCalledTimes(1)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('keeps a failed decision retryable and does not report success',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_path:RequestInfo|URL,options?:RequestInit)=>options?.method==='POST'?new Response(JSON.stringify({error:'Koneksi terputus'}),{status:503}):new Response(JSON.stringify(readyReview))))
  const decided=vi.fn(),host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<ApprovalCard approval={sampleApproval} onDecided={decided}/>))
    await act(async()=>action(host,'Setujui hasil').click())
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Koneksi terputus')
    expect(action(host,'Setujui hasil').disabled).toBe(false)
    expect(decided).not.toHaveBeenCalled()
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('submits revision notes for the specific approval being reviewed',async()=>{
  const fetcher=vi.fn(async(_path:RequestInfo|URL,options?:RequestInit)=>new Response(JSON.stringify(options?.method==='POST'?{}:readyReview)))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<><ApprovalCard approval={{...sampleApproval,id:'review-scope-1'}} onDecided={()=>{}}/><ApprovalCard approval={{...sampleApproval,id:'review-scope-2'}} onDecided={()=>{}}/></>))
    await act(async()=>action(host,'Minta revisi').click())
    const textarea=host.querySelector('textarea')!
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Tambahkan sumber resmi');textarea.dispatchEvent(new Event('input',{bubbles:true}))})
    expect(action(host,'Kirim arahan revisi').disabled).toBe(false)
    expect(host.querySelectorAll('textarea')).toHaveLength(1)
    await act(async()=>action(host,'Kirim arahan revisi').click())
    expect(fetcher.mock.calls.filter(([,options])=>options?.method==='POST')[0]).toEqual(['/api/office/brands/infojerman/approvals/review-scope-1',expect.objectContaining({body:JSON.stringify({decision:'rejected',note:'Tambahkan sumber resmi'})})])
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
