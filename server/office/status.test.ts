import { describe, expect, it } from 'vitest'
import { agentStatus, assertTransition, canTransition } from './status.js'

describe('task status machine', () => {
  it('moves work through approval and revision', () => {
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('running', 'waiting_approval')).toBe(true)
    expect(canTransition('waiting_approval', 'revision')).toBe(true)
    expect(canTransition('revision', 'running')).toBe(true)
    expect(canTransition('waiting_approval', 'approved')).toBe(true)
  })

  it('finishes chat replies directly and never skips approval for work', () => {
    expect(canTransition('running', 'done')).toBe(true)
    expect(canTransition('running', 'approved')).toBe(false)
    expect(canTransition('queued', 'done')).toBe(false)
    expect(canTransition('done', 'queued')).toBe(false)
    expect(() => assertTransition('cancelled', 'running')).toThrow(/cancelled ke running/)
  })
})

describe('avatar status', () => {
  it('shows the most pressing state of the agent\'s tasks', () => {
    expect(agentStatus([], false)).toBe('idle')
    expect(agentStatus(['waiting_approval', 'running'], false)).toBe('working')
    expect(agentStatus(['waiting_approval', 'waiting_quota'], false)).toBe('waiting_quota')
    expect(agentStatus(['waiting_approval'], false)).toBe('waiting_approval')
    expect(agentStatus(['failed', 'waiting_approval'], false)).toBe('error')
    expect(agentStatus(['running'], true)).toBe('paused')
  })
})
