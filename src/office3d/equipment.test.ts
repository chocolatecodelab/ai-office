import { expect, it } from 'vitest'
import { createBuilding } from './building.ts'
import { equipmentPose, CAFE, LOUNGE, PINGPONG, TREADMILLS } from './equipment.ts'
import { agentSpot } from './live.ts'
import type { AgentStatus } from '../office-api.ts'

it('places exactly two players beyond opposite ends of the net, facing each other', () => {
  const layout = createBuilding([])
  const left = layout.idleSpots.find((spot) => spot.key === 'game-1')!
  const right = layout.idleSpots.find((spot) => spot.key === 'game-2')!
  expect(left.position[0]).toBeLessThan(PINGPONG.x-PINGPONG.length/2)
  expect(right.position[0]).toBeGreaterThan(PINGPONG.x+PINGPONG.length/2)
  for (const player of [left,right]) {
    expect(player.position[2]).toBe(PINGPONG.z)
    expect(Math.sin(player.facing)*(PINGPONG.x-player.position[0])).toBeGreaterThan(0)
    expect(Math.cos(player.facing)).toBeCloseTo(0)
  }
  expect(equipmentPose('pingpong-watch')).toBeUndefined()
})

it('places the feet on each treadmill deck in world coordinates, facing the console', () => {
  const layout = createBuilding([])
  for (const [i,x] of TREADMILLS.xs.entries()) {
    const user = layout.idleSpots.find((spot) => spot.key === `gym-${i+1}`)!
    expect(user.position).toEqual([x,TREADMILLS.deckHeight,TREADMILLS.z])
    expect(Math.cos(user.facing)).toBeCloseTo(-1)
  }
})

it('assigns two cushion seats to the sofa and the third person to a separate armchair', () => {
  const layout = createBuilding([])
  const seats = ['lounge-1','lounge-2','lounge-3'].map((key) => layout.idleSpots.find((spot) => spot.key === key)!)
  expect(seats.slice(0,2).map((seat) => seat.position[0])).toEqual([LOUNGE.sofa[0]-0.5,LOUNGE.sofa[0]+0.5])
  expect(seats[2].position[0]).toBe(LOUNGE.armchair[0])
  for (const seat of seats) expect(seat.position[2]).toBe(LOUNGE.seatZ)
  expect(LOUNGE.armchair[0]-0.45).toBeGreaterThan(LOUNGE.sofa[0]+1.2)
})

it('uses the same seven blueprint placements for every brand, with errors beside the desk', () => {
  for (const brand of ['otca','infojerman','ciaomanda','jepangkoey']) {
    const layout = createBuilding([{ id:brand,name:brand,color:'#ffffff',agents:['manager'] }])
    const desk = layout.floors[1].desks[0]
    for (const state of ['idle','working','revision','waiting_quota','waiting_approval','error','paused'] as AgentStatus[]) {
      const spot = agentSpot(layout,brand,'manager',state,0)!
      expect(spot.floor).toBe(state === 'idle' ? 0 : 1)
      if (state === 'error') { expect(spot.seated).toBe(false); expect(spot.position).not.toEqual(desk.seat.position) }
      else if (state !== 'idle') expect(spot.position).toEqual(desk.seat.position)
    }
  }
})

it('provides four cafe seats facing their respective tables',()=>{
 const seats=createBuilding([]).idleSpots.filter(s=>s.key.startsWith('cafe-seat'))
 expect(seats).toHaveLength(4)
 expect(new Set(seats.map(s=>s.position.join(','))).size).toBe(4)
 for(const seat of seats) {expect(CAFE.tables).toContain(seat.position[0]);expect(Math.cos(seat.facing)*(CAFE.z-seat.position[2])).toBeGreaterThan(0)}
})
