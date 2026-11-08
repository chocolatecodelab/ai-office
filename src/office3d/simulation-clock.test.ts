import { expect,it } from 'vitest'
import { SimulationClock } from './simulation-clock.ts'
import { LiftQueue } from './lift-queue.ts'
it('preserves lift deadlines when a resumed renderer starts its elapsed time from zero',()=>{
 const clock=new SimulationClock(),lift=new LiftQueue()
 for(let i=0;i<6000;i++)clock.advance(.1)
 expect(lift.request('rider',0,1,clock.current)).toBe(true)
 expect(lift.canDepart('rider',0)).toBe(false) // old renderer-clock behavior
 clock.advance(300) // first background/resume delta is bounded
 for(let i=0;i<41;i++)clock.advance(.1)
 expect(lift.canDepart('rider',clock.current)).toBe(true)
 expect(lift.canExit('rider',clock.current)).toBe(true)
 lift.release('rider')
 expect(lift.request('next',1,0,clock.current)).toBe(true)
})
it('does not reverse time or jump across a background pause',()=>{
 const clock=new SimulationClock()
 clock.advance(1/60)
 for(const delta of [0,-10,NaN,Infinity])clock.advance(delta)
 expect(clock.current).toBeCloseTo(1/60)
 expect(clock.advance(900)).toBeCloseTo(1/60+.1)
})
