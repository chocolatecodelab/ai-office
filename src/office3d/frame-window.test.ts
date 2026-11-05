import { expect,it } from 'vitest'
import { FrameWindow } from './frame-window.ts'
it('includes long foreground frames in FPS and stall measurements',()=>{
  const window=new FrameWindow()
  for(let i=0;i<90;i++)window.add(1/60)
  const result=window.add(.6)!
  expect(result.fps).toBeCloseTo(91/2.1)
  expect(result.maxFrameMs).toBe(600)
  expect(result.stalls).toBe(1)
  expect(window.add(1/60)).toBeUndefined()
})
it('ignores invalid durations and records p95 without mixing windows',()=>{
  const window=new FrameWindow()
  for(const delta of [0,-1,NaN,Infinity])expect(window.add(delta)).toBeUndefined()
  const result=window.add(2)!
  expect(result).toMatchObject({frames:1,fps:.5,p95FrameMs:2000,stalls:1})
  expect(window.add(2)!.frames).toBe(1)
})
