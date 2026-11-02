import { seatFor, type BuildingLayout, type Spot } from './building.ts'
import type { OfficeBrand } from '../office-api.ts'
import { agentSpot } from './live.ts'

export interface Visit { spot: Spot; from?: Spot; arrivedAt?: number; visits: number }
/** Reserve both ends of a journey until arrival; a seat cannot be reassigned under a walker. */
export function nextVisits(layout: BuildingLayout, brands: OfficeBrand[], previous: Map<string, Visit>, now: number, enabled: boolean): Map<string, Visit> {
  const next = new Map<string, Visit>()
  let index = 0
  for (const brand of brands) for (const agent of brand.agents.filter(a => a.active)) {
    const id = `${brand.id}/${agent.agentType}`
    const fallback = agentSpot(layout, brand.id, agent.agentType, agent.status, index++)!
    const old = previous.get(id)
    if (!old) next.set(id, { spot: fallback, arrivedAt: now, visits: 0 })
    else if (agent.status !== 'idle' && old.spot.key !== fallback.key && !old.from) next.set(id, { ...old, spot: fallback, from: old.spot, arrivedAt: undefined })
    else next.set(id, old)
  }
  const reserved = new Set([...next.values()].flatMap(v => [v.spot.key, ...(v.from ? [v.from.key] : [])]))
  if (!enabled) return next
  let ordinal = 0
  for (const brand of brands) for (const agent of brand.agents.filter(a => a.active)) {
    const id = `${brand.id}/${agent.agentType}`, visit = next.get(id)!
    const order = ordinal++
    if (agent.status !== 'idle' || visit.from || visit.arrivedAt === undefined || now - visit.arrivedAt < 12 + order % 7 * 3) continue
    const desk = seatFor(layout, brand.id, agent.agentType)!
    // Include an office visit, so idle agents also ride the lift back to their own floor.
    const choices = visit.visits % 3 === 2 ? [desk, ...layout.idleSpots] : [...layout.idleSpots.filter(s => ['bakso','kopi'].includes(s.key)), ...layout.idleSpots.filter(s => !['bakso','kopi'].includes(s.key)), desk]
    for (let offset = 0; offset < choices.length; offset++) {
      const spot = choices[(order + visit.visits * 7 + offset) % choices.length]
      if (reserved.has(spot.key)) continue
      reserved.add(spot.key)
      next.set(id, { spot, from: visit.spot, visits: visit.visits + 1 })
      break
    }
  }
  return next
}
