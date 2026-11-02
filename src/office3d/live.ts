import type { AgentStatus, OfficeBrand } from '../office-api.ts'
import { createBuilding, seatFor, type BuildingLayout, type Spot } from './building.ts'

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#8ca894', working: '#47cf77', waiting_quota: '#639fff', waiting_approval: '#ffdb59',
  revision: '#ff9748', error: '#ff5252', paused: '#999999',
}

export function liveBuilding(brands: OfficeBrand[]): BuildingLayout {
  return createBuilding(brands.map((brand) => ({ ...brand, agents: brand.agents.filter((agent) => agent.active).map((agent) => agent.agentType) })))
}

/** Choose once from the initial snapshot; subsequent updates never move the user's camera. */
export function initialFloor(brands: OfficeBrand[], layout: BuildingLayout): number {
  return layout.floors.find((floor) => brands.find((brand) => brand.id === floor.brand?.id)?.agents.some((agent) => agent.active && ['waiting_approval', 'error'].includes(agent.status)))?.index
    ?? layout.floors.find((floor) => floor.brand?.id === 'otca')?.index ?? 0
}

export function agentSpot(layout: BuildingLayout, brand: string, agent: string, status: AgentStatus, index: number): Spot | undefined {
  const seat = seatFor(layout, brand, agent)
  if (!seat) return undefined
  if (status === 'error') return { ...seat, key: `${seat.key}:error`, seated: false, position: [seat.exit[0][0],seat.position[1],seat.exit[0][1]], exit: seat.exit.slice(1) }
  if (status === 'idle' && layout.idleSpots.length) {
    const spot = layout.idleSpots[index % layout.idleSpots.length]
    const extra = Math.floor(index / layout.idleSpots.length)
    return extra === 0 ? spot : { ...spot, key: `${spot.key}-${extra}`, seated: false, position: [spot.position[0] + extra * 0.7, spot.position[1], spot.position[2]] }
  }
  return seat
}
