import { expect, it } from 'vitest'
import { defaultRoomControls, idleActivity, roomForSpot, ROOM_ACTIVITIES } from './activities.ts'

it('assigns the six leisure activities and keeps arcade separate from ping-pong', () => {
  expect(roomForSpot('game-1')).toBe('pingpong')
  expect(roomForSpot('game-3')).toBe('game')
  expect(roomForSpot('pantry-1')).toBe('cafe')
  expect(roomForSpot('gym-1')).toBe('gym')
  expect(roomForSpot('rest-1')).toBe('rest')
  expect(roomForSpot('lounge-1')).toBe('lounge')
  expect(roomForSpot('otca:manager')).toBeUndefined()
  expect(ROOM_ACTIVITIES).toHaveLength(6)
})

it('never gives leisure gestures to working, travelling, paused or quota-limited agents', () => {
  const controls = defaultRoomControls()
  expect(idleActivity('idle',true,'gym-1',controls)).toBe('gym')
  for (const status of ['working','revision','waiting_quota','waiting_approval','error','paused']) expect(idleActivity(status,true,'gym-1',controls)).toBeUndefined()
  expect(idleActivity('idle',false,'gym-1',controls)).toBeUndefined()
  controls.gym.enabled = false
  expect(idleActivity('idle',true,'gym-1',controls)).toBeUndefined()
  expect(idleActivity('idle',true,'pantry-1',controls)).toBe('cafe')
  expect(defaultRoomControls().gym.enabled).toBe(true)
})
