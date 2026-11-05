import { expect,it } from 'vitest'
import { scheduleInput } from './social-schedule.js'
it('requires explicit timezone and a real future calendar date',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z')
 expect(scheduleInput({platform:'instagram',scheduledAt:'2026-11-06T10:00:00+07:00'},now)).toEqual({platform:'instagram',scheduledAt:'2026-11-06T03:00:00.000Z'})
 for(const scheduledAt of ['2026-02-30T10:00:00Z','2026-11-06T10:00:00','garbage','2025-01-01T10:00:00Z'])expect(()=>scheduleInput({platform:'instagram',scheduledAt},now)).toThrow()
 expect(()=>scheduleInput({platform:'tiktok',scheduledAt:'2026-11-06T10:00:00Z'},now)).toThrow()
})
