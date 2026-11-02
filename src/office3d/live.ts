import type { AgentStatus, OfficeBrand, OfficeTask } from '../office-api.ts'
import { createBuilding, seatFor, type BuildingLayout, type Spot } from './building.ts'

export const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#95a5a6', working: '#32c975', waiting_quota: '#6495ed', waiting_approval: '#f4d03f',
  revision: '#ed8936', error: '#ef5350', paused: '#777777',
}
export const STATUS_ICONS: Record<AgentStatus, string> = {
  idle: '○', working: '●', waiting_quota: 'Zzz', waiting_approval: '✋', revision: '✎', error: '⚠', paused: 'Ⅱ',
}
export function liveBuilding(brands: OfficeBrand[]): BuildingLayout {
  return createBuilding(brands.map((brand) => ({ ...brand, agents: brand.agents.filter((agent) => agent.active).map((agent) => agent.agentType) })))
}
export function agentSpot(layout: BuildingLayout, brand: string, role: string, status: AgentStatus, index: number): Spot | undefined {
  return status === 'idle' ? layout.idleSpots[index % layout.idleSpots.length] : seatFor(layout, brand, role)
}
export function initialFloor(brands: OfficeBrand[], layout: BuildingLayout): number {
  const urgent = brands.find((brand) => brand.agents.some((agent) => agent.status === 'waiting_approval' || agent.status === 'error'))
  return layout.floors.find((floor) => floor.brand?.id === (urgent?.id ?? 'otca'))?.index ?? 0
}
export function officeTotals(tasks: OfficeTask[], approvals: number) {
  return { queued: tasks.filter((task) => task.status === 'queued').length, approvals, quota: tasks.filter((task) => task.status === 'waiting_quota').length }
}
