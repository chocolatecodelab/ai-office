// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {ManagerProgress} from './ManagerProgress.tsx'
import type {OfficeTask} from '../office-api.ts'

;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('shows approval-gated stages instead of presenting every queued task as ready to run',async()=>{
  const task={id:'qa-dag-progress',brandId:'infojerman',status:'queued'} as OfficeTask
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({orchestration:{plan:{summary:'Naskah lalu storyboard',tasks:[{agentType:'content-creator'},{agentType:'video-editor',dependsOn:['content-creator']}]},children:[{id:'b',agentType:'video-editor',title:'Storyboard',status:'queued'},{id:'a',agentType:'content-creator',title:'Naskah',status:'waiting_approval'}]}})))
  vi.stubGlobal('fetch',fetcher)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<ManagerProgress task={task}/>))
    expect(host.textContent).toContain('Menunggu tahap sebelumnya')
    expect(host.textContent).toContain('Setelah disetujui: Content Creator')
    expect(host.textContent).toContain('0 dari 2')
    expect([...host.querySelectorAll('li strong')].map(node=>node.textContent)).toEqual(['Content Creator','Video Editor'])
    expect(host.textContent).toContain('Semua tetap dalam brand ini')
    expect(fetcher.mock.calls).toHaveLength(1)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
