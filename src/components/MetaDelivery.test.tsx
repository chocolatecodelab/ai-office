// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect,it,vi } from 'vitest'
import { MetaDelivery } from './MetaDelivery.tsx'

;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true

it('requires an explicit delivery action and withholds resending an uncertain post',async()=>{
  const request=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({ready:true,configured:true,mode:'live'})))
  vi.stubGlobal('fetch',request)
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host),changed=vi.fn<()=>Promise<void>>().mockResolvedValue()
  const props={brand:'otca',scheduleId:'schedule',platform:'instagram',caption:'Approved caption',scheduledAt:'2099-01-01T00:00:00Z',onChanged:changed}
  try{
    await act(async()=>root.render(<MetaDelivery {...props}/>))
    expect(request).toHaveBeenCalledTimes(1)
    expect(host.querySelector('textarea')?.value).toBe('Approved caption')
    const send=[...host.querySelectorAll('button')].find(button=>button.textContent==='Aktifkan pengiriman terjadwal')!
    await act(async()=>send.click())
    expect(String(request.mock.calls[1][0])).toContain('/social-schedule/schedule/dispatch')
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({caption:'Approved caption'})
    expect(changed).toHaveBeenCalledTimes(1)
    await act(async()=>root.render(<MetaDelivery {...props} state="uncertain" error="Konfirmasi terputus"/>))
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.textContent).toContain('Periksa akun platform')
    expect([...host.querySelectorAll('button')].some(button=>button.textContent?.includes('Kirim'))).toBe(false)
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})

it('directs an unconfigured brand to Settings without enabling dispatch',async()=>{
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({ready:false,configured:false,mode:'mock'}))))
  const host=document.body.appendChild(document.createElement('div')),root=createRoot(host)
  try{
    await act(async()=>root.render(<MetaDelivery brand="infojerman" scheduleId="schedule" platform="instagram" caption="Caption" scheduledAt="2099-01-01T00:00:00Z" onChanged={async()=>{}}/>))
    expect(host.querySelector('a')?.getAttribute('href')).toBe('#/settings')
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('button')).toBeNull()
  }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals()}
})
