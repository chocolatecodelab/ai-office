import {it,expect,vi} from 'vitest'
import {adaptiveQuotaWait} from './quota-recovery.js'
import type {OfficeStore,Task} from './store.js'
it('keeps reported reset times and probes unknown resets with bounded adaptive delays',async()=>{
 let count=0
 const query=vi.fn(async()=>({rows:[{n:count}]})),store={db:{query}} as unknown as OfficeStore,task={id:'task',brandId:'otca'} as Task
 const reported={retryAt:new Date(Date.now()+100000).toISOString(),timingSource:'provider' as const,reason:'429'}
 expect(await adaptiveQuotaWait(store,task,reported)).toBe(reported);expect(query).not.toHaveBeenCalled()
 const fallback={...reported,timingSource:'fallback' as const};const before=Date.now();const first=await adaptiveQuotaWait(store,task,fallback)
 expect(Date.parse(first.retryAt)-before).toBeGreaterThanOrEqual(60000);expect(Date.parse(first.retryAt)-before).toBeLessThan(70000)
 count=100;const later=await adaptiveQuotaWait(store,task,fallback)
 expect(Date.parse(later.retryAt)-Date.now()).toBeLessThanOrEqual(17.25*60000)
 expect(later.timingSource).toBe('fallback')
})
