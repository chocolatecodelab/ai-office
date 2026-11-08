import { describe, expect, it } from 'vitest'
import type { AgentStatus, OfficeBrand } from '../office-api.ts'
import { agentSpot, initialFloor, liveBuilding, STATUS_COLORS } from './live.ts'

const brands: OfficeBrand[] = ['jepangkoey', 'otca', 'infojerman', 'ciaomanda'].map((id) => ({
  id, name: id, color: '#ffffff', paused: false,
  agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager', ...(id === 'otca' ? ['digital-marketing', 'event-specialist'] : [])].map((agentType) => ({ brandId: id, agentType, status: 'working', active: true, paused: false, currentTask: null })),
}))

describe('live office placements', () => {
  it('builds 18 desks from active API agents in blueprint order', () => {
    const layout = liveBuilding(brands)
    expect(layout.floors.map((floor) => floor.desks.length)).toEqual([0, 6, 4, 4, 4])
    expect(initialFloor(brands, layout)).toBe(1)
    const next = brands.map((brand) => ({ ...brand, agents: brand.agents.map((agent) => ({ ...agent, status: brand.id === 'ciaomanda' ? 'waiting_approval' as const : agent.status })) }))
    expect(initialFloor(next, liveBuilding(next))).toBe(3)
    next[1].agents[0].active = false
    expect(liveBuilding(next).floors[1].desks).toHaveLength(5)
  })

  it('puts idle agents downstairs and all six task states at their assigned desks', () => {
    const layout = liveBuilding(brands)
    const states = Object.keys(STATUS_COLORS) as AgentStatus[]
    expect(states).toHaveLength(7)
    for (const state of states) expect(agentSpot(layout, 'otca', 'manager', state, 0)?.floor).toBe(state === 'idle' ? 0 : 1)
    const spots = Array.from({ length: 18 }, (_, index) => agentSpot(layout, 'otca', 'manager', 'idle', index)!)
    expect(new Set(spots.map((spot) => spot.position.join(','))).size).toBe(18)
    expect(agentSpot(layout, 'otca', 'unknown', 'working', 0)).toBeUndefined()
  })
})
