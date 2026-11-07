import { expect,it } from 'vitest'
import { scheduleInput,publicationInput } from './social-schedule.js'
it('requires explicit timezone and a real future calendar date',()=>{
 const now=Date.parse('2026-01-01T00:00:00Z')
 expect(scheduleInput({platform:'instagram',scheduledAt:'2026-11-06T10:00:00+07:00'},now)).toEqual({platform:'instagram',scheduledAt:'2026-11-06T03:00:00.000Z'})
 for(const scheduledAt of ['2026-02-30T10:00:00Z','2026-11-06T10:00:00','garbage','2025-01-01T10:00:00Z'])expect(()=>scheduleInput({platform:'instagram',scheduledAt},now)).toThrow()
 expect(()=>scheduleInput({platform:'tiktok',scheduledAt:'2026-11-06T10:00:00Z'},now)).toThrow()
})
it('accepts a manual receipt only for an actual post URL on the selected platform',()=>{
 const now=Date.parse('2026-11-07T10:00:00Z')
 expect(publicationInput({postUrl:'https://www.instagram.com/p/approved-post/',publishedAt:'2026-11-07T09:00:00Z'},'instagram',now).postUrl).toContain('/p/approved-post/')
 for(const postUrl of ['https://instagram.com/brand/','https://instagram.com.evil.test/p/test','http://instagram.com/p/test','https://user:password@instagram.com/p/test','https://facebook.com/posts/123']){
  expect(()=>publicationInput({postUrl,publishedAt:'2026-11-07T09:00:00Z'},'instagram',now)).toThrow()
 }
 expect(()=>publicationInput({postUrl:'https://instagram.com/p/test',publishedAt:'2026-11-08T09:00:00Z'},'instagram',now)).toThrow()
})
