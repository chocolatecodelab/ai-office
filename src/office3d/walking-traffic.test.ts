import {expect,it} from 'vitest'
import {followingStep,type WalkingAgent} from './walking-traffic.ts'

const position=(x:number,z=0,y=0)=>({x,y,z})
it('keeps a following walker behind the leader without changing its route',()=>{
  const leader:WalkingAgent={id:'leader',position:position(0.8),target:position(10),insideLift:false}
  expect(followingStep('follower',position(0),position(10),0.5,[leader])).toBeCloseTo(0.2)
  expect(followingStep('follower',position(0.5),position(10),0.2,[leader])).toBe(0)
  expect(followingStep('leader',position(0.8),position(10),0.2,[{...leader,id:'follower',position:position(0)}])).toBe(0.2)
})
it('breaks exact merges deterministically and lets opposing/crossing traffic pass',()=>{
  const other:WalkingAgent={id:'b',position:position(0),target:position(10),insideLift:false}
  expect(followingStep('a',position(0),position(10),0.1,[other])).toBe(0.1)
  expect(followingStep('c',position(0),position(10),0.1,[other])).toBe(0)
  for(const peer of [{...other,target:position(-10)},{...other,target:position(0,10)},{...other,insideLift:true},{...other,position:position(0,0,3.4)},{...other,target:undefined}])expect(followingStep('c',position(0),position(10),0.1,[peer])).toBe(0.1)
})
