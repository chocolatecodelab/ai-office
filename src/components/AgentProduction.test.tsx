// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { AgentProduction } from './AgentProduction.tsx'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
it('creates a carousel through chat from a brief without requiring a JSON file',async()=>{
 const fetcher=vi.fn(async()=>new Response(JSON.stringify({engine:{ready:true,checks:[]},presets:[],jobs:[]})))
 vi.stubGlobal('fetch',fetcher)
 const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),onChat=vi.fn()
 try{
  await act(async()=>root.render(<AgentProduction base="/brands/otca/agents/content-creator" agent="content-creator" onCreated={()=>{}} onFiles={()=>{}} onChat={onChat}/>))
  expect(host.querySelector('input[type=file]')).toBeNull()
  const input=host.querySelector<HTMLInputElement>('input[maxlength="160"]')!,textarea=host.querySelector('textarea')!
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Rutinitas bahasa');input.dispatchEvent(new Event('input',{bubbles:true}));Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'Untuk orang tua, CTA simpan');textarea.dispatchEvent(new Event('input',{bubbles:true}))})
  const button=host.querySelector<HTMLButtonElement>('.primary-button')!
  expect(button.disabled).toBe(false)
  await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  expect(fetcher).toHaveBeenCalledWith('/api/office/brands/otca/agents/content-creator/chat',expect.objectContaining({method:'POST',body:expect.stringContaining('Untuk orang tua')}))
  expect(onChat).toHaveBeenCalledOnce()
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
