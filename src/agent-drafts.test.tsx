// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it } from 'vitest'
import { useAgentDraft } from './agent-drafts.ts'
import { LOCKED_EVENT } from './access.ts'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
function Draft({scope}:{scope:string}) {const [text,setText]=useAgentDraft<string>(scope,'');return <input value={text} onChange={e=>setText(e.target.value)}/>}
it('restores a closed draft, isolates brands, and clears closed drafts when access locks',async()=>{
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try {
    await act(async()=>root.render(<Draft scope="otca/manager/chat"/>))
    await act(async()=>{const input=host.querySelector('input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Brief OTCA');input.dispatchEvent(new Event('input',{bubbles:true}))})
    await act(async()=>root.render(<Draft scope="infojerman/manager/chat"/>))
    expect(host.querySelector('input')!.value).toBe('')
    await act(async()=>root.render(null))
    await act(async()=>root.render(<Draft scope="otca/manager/chat"/>))
    expect(host.querySelector('input')!.value).toBe('Brief OTCA')
    await act(async()=>root.render(null))
    await act(async()=>window.dispatchEvent(new Event(LOCKED_EVENT)))
    await act(async()=>root.render(<Draft scope="otca/manager/chat"/>))
    expect(host.querySelector('input')!.value).toBe('')
  } finally {await act(async()=>root.unmount());host.remove()}
})
