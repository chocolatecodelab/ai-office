import { expect, it } from 'vitest'
import { LiftQueue } from './lift-queue.ts'
it('boards five passengers on the same trip and holds a sixth until everyone exits',()=>{
 const lift=new LiftQueue()
 for(let i=0;i<5;i++) expect(lift.request('p'+i,0,2,0)).toBe(true)
 expect(lift.request('six',0,2,0)).toBe(false)
 expect(new Set(Array.from({length:5},(_,i)=>lift.slot('p'+i))).size).toBe(5)
 expect(lift.canDepart('p0',3)).toBe(false)
 expect(lift.canDepart('p4',4)).toBe(true)
 for(let i=0;i<4;i++)lift.release('p'+i)
 expect(lift.request('six',0,2,5)).toBe(false)
 lift.release('p4');expect(lift.request('six',0,2,5)).toBe(true)
})
it('does not mix departure floors or destinations and cleans cancelled requests',()=>{
 const lift=new LiftQueue()
 expect(lift.request('a',0,2,0)).toBe(true)
 expect(lift.request('b',1,2,0)).toBe(false)
 expect(lift.request('c',0,3,0)).toBe(false)
 lift.release('b');lift.release('a')
 expect(lift.request('c',0,3,5)).toBe(true)
})
