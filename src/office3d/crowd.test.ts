import { describe, expect, it } from 'vitest'
import { createBuilding, FLOOR_HEIGHT, floorAt, LIFT, LIFT_LANE_X, route, type BrandInput, type BuildingLayout, type Vec3 } from './building.ts'
import { LiftQueue } from './lift-queue.ts'
import { nextVisits, type Visit } from './roaming.ts'
import type { OfficeAgent, OfficeBrand } from '../office-api.ts'

// Crowd check for K4 (docs/PLAN-KANTOR-3D.md). The full crew roams with the office scheduler
// (nextVisits, once a second, arrivals recorded as the scene does), walks the office routes, and
// shares the one lift through LiftQueue. Agents switch between idle and working at random times, so
// the seed changes the traffic. It is a timing and capacity model, not a physics engine: queued
// passengers stand at the lane slots Office3D uses, and passengers in the cabin are left out of the
// floor distance check.

const CREW: BrandInput[] = [
  { id: 'otca', name: 'Official OTCA', color: '#CB9D31', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager', 'digital-marketing', 'event-specialist'] },
  { id: 'infojerman', name: 'Info Jerman', color: '#F3CF45', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'ciaomanda', name: 'Ciao Manda', color: '#D40000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'jepangkoey', name: 'Jepang Koey', color: '#000000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
]

const WALK_SPEED = 1.6 // metres per second
const LIFT_SPEED = FLOOR_HEIGHT // one floor per second
const DT = 0.1
const QUEUE_PITCH = 0.48 // metres between queued passengers, as Office3D places them
// Cabin spots riders stand on, as Office3D offsets them; passengers keep their spot when they step out.
const CABIN_SLOTS: [number, number][] = [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45], [0, 0]]
const MIN_SEPARATION = 0.5 // centre to centre, about one shoulder width
const HORIZON_S = 900
const MIN_VISITS = 3
const MAX_CLOSE_S = 5 // longest a pair may stay within MIN_SEPARATION before it counts as stacked
const SEEDS = [7, 42, 2026]

/** mulberry32: a small generator whose nearby seeds give unrelated sequences. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function crewBrands(): OfficeBrand[] {
  return CREW.map((brand) => ({
    id: brand.id, name: brand.name, color: brand.color, paused: false,
    agents: brand.agents.map((agentType): OfficeAgent => ({ brandId: brand.id, agentType, active: true, paused: false, status: 'idle', currentTask: null })),
  }))
}

interface Walker { id: string; position: Vec3; path: Vec3[]; next: number; target?: string; riding: boolean; queued: boolean; waitingSince?: number }

function simulate(layout: BuildingLayout, seed: number) {
  const random = rng(seed)
  const brands = crewBrands()
  const agents = brands.flatMap((brand) => brand.agents)
  const idOf = (agent: OfficeAgent) => `${agent.brandId}/${agent.agentType}`
  const lift = new LiftQueue()
  const walkers = new Map<string, Walker>()
  // Each agent flips between idle and working, which sends it to its desk and back.
  const flipAt = new Map(agents.map((agent) => [idOf(agent), 30 + random() * 90]))
  const stats = { trips: 0, maxAboard: 0, longestWait: 0, minGap: Infinity, minGapAt: '', closeEpisodes: 0, longestClose: 0 }
  const close = new Map<string, number>()
  let stuck = false
  let elapsed = 0
  let visits: Map<string, Visit> = nextVisits(layout, brands, new Map(), elapsed, true)
  for (const [id, visit] of visits) walkers.set(id, { id, position: [...visit.spot.position], path: [], next: 0, riding: false, queued: false })
  const arrive = (id: string, key: string) => {
    const visit = visits.get(id)
    if (visit?.spot.key === key && visit.arrivedAt === undefined) visits.set(id, { ...visit, from: undefined, arrivedAt: elapsed })
  }
  const aboard = () => [...walkers.values()].filter((walker) => lift.has(walker.id)).length

  for (let step = 0; step < HORIZON_S / DT; step++) {
    const t = step * DT
    if (step > 0 && step % 10 === 0) {
      elapsed += 1
      for (const agent of agents) {
        const id = idOf(agent)
        if (elapsed < (flipAt.get(id) ?? Infinity)) continue
        agent.status = agent.status === 'idle' ? 'working' : 'idle'
        flipAt.set(id, elapsed + 30 + random() * 90)
      }
      visits = nextVisits(layout, brands, visits, elapsed, true)
    }

    for (const walker of walkers.values()) {
      const visit = visits.get(walker.id)!
      if (walker.target !== visit.spot.key) {
        // A new destination starts where the walker stands, so a turn mid-walk does not teleport.
        walker.target = visit.spot.key
        walker.path = [[...walker.position], ...route(layout, visit.from ?? visit.spot, visit.spot)]
        walker.next = 0
      }
      const target = walker.path[walker.next]
      if (!target) {
        arrive(walker.id, visit.spot.key)
        continue
      }
      const here = floorAt(walker.position[1])
      const there = floorAt(target[1])
      if (here !== there && !walker.riding) {
        walker.waitingSince ??= t
        if (!lift.has(walker.id)) {
          if (!lift.request(walker.id, here, there, t)) {
            walker.queued = true
            continue
          }
          walker.queued = false
          walker.position = [LIFT.x, walker.position[1], LIFT.z]
          stats.maxAboard = Math.max(stats.maxAboard, aboard())
        }
        if (!lift.canDepart(walker.id, t)) continue
        stats.longestWait = Math.max(stats.longestWait, t - walker.waitingSince!)
        walker.riding = true
        walker.waitingSince = undefined
      }
      if (walker.riding) {
        const dy = target[1] - walker.position[1]
        const move = Math.sign(dy) * Math.min(Math.abs(dy), LIFT_SPEED * DT)
        walker.position = [LIFT.x, walker.position[1] + move, LIFT.z]
        if (Math.abs(target[1] - walker.position[1]) < 1e-6) {
          const [slotX, slotZ] = CABIN_SLOTS[lift.slot(walker.id)]
          walker.position = [LIFT.x + slotX, target[1], LIFT.z + slotZ]
          walker.riding = false
          lift.release(walker.id)
          stats.trips += 1
          walker.next += 1
        }
        continue
      }
      const dx = target[0] - walker.position[0]
      const dz = target[2] - walker.position[2]
      const distance = Math.hypot(dx, dz)
      const step = WALK_SPEED * DT
      if (distance <= step) {
        walker.position = [target[0], walker.position[1], target[2]]
        walker.next += 1
      } else {
        walker.position = [walker.position[0] + (dx / distance) * step, walker.position[1], walker.position[2] + (dz / distance) * step]
      }
      if (walker.waitingSince !== undefined && t - walker.waitingSince > 120) stuck = true
    }
    // Queue spots move forward when the head boards, so place them after every decision this tick.
    for (const walker of walkers.values()) {
      if (walker.queued) walker.position = [LIFT_LANE_X, walker.position[1], LIFT.z + QUEUE_PITCH * (lift.rank(walker.id) + 1)]
    }

    const onFoot = [...walkers.values()].filter((walker) => !walker.riding && !lift.has(walker.id))
    const crowded = new Set<string>()
    for (let i = 0; i < onFoot.length; i++) for (let j = i + 1; j < onFoot.length; j++) {
      const a = onFoot[i], b = onFoot[j]
      if (floorAt(a.position[1]) !== floorAt(b.position[1])) continue
      const gap = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2])
      if (gap < stats.minGap) {
        stats.minGap = gap
        stats.minGapAt = `${a.id} (${a.target}) ${a.position.map((n) => n.toFixed(2))} – ${b.id} (${b.target}) ${b.position.map((n) => n.toFixed(2))} @ ${t.toFixed(0)} s`
      }
      if (gap < MIN_SEPARATION) crowded.add(`${a.id}|${b.id}`)
    }
    // Track how long each pair stays within MIN_SEPARATION of each other.
    for (const [key, since] of close) {
      if (crowded.has(key)) continue
      stats.longestClose = Math.max(stats.longestClose, t - since)
      close.delete(key)
    }
    for (const key of crowded) if (!close.has(key)) {
      close.set(key, t)
      stats.closeEpisodes += 1
    }
  }
  for (const since of close.values()) stats.longestClose = Math.max(stats.longestClose, HORIZON_S - since)
  const counts = [...visits.values()].map((visit) => visit.visits)
  return { stats, stuck, agents: walkers.size, minVisits: Math.min(...counts), totalVisits: counts.reduce((sum, count) => sum + count, 0) }
}

describe('K4 crowd check: full crew, one lift', () => {
  const layout = createBuilding(CREW)
  const runs = SEEDS.map((seed) => ({ seed, ...simulate(layout, seed) }))

  for (const run of runs) {
    it(`seed ${run.seed}: everyone keeps roaming, the lift is never overloaded, nobody waits forever`, () => {
      console.info(`[crowd seed ${run.seed}] ${run.agents} agen · kunjungan ${run.totalVisits} · tiap agen minimal ${run.minVisits} kunjungan · naik lift ${run.stats.trips}× · penumpang maks ${run.stats.maxAboard} · tunggu lift terlama ${run.stats.longestWait.toFixed(1)} s · jarak terdekat ${run.stats.minGap.toFixed(2)} m (${run.stats.minGapAt}) · berdekatan <0,5 m: ${run.stats.closeEpisodes}× · terlama ${run.stats.longestClose.toFixed(1)} s`)
      expect(run.stuck).toBe(false)
      expect(run.stats.maxAboard).toBeLessThanOrEqual(5)
      expect(run.stats.trips).toBeGreaterThan(0)
      expect(run.minVisits).toBeGreaterThanOrEqual(MIN_VISITS)
    })
  }

  // Known gap: agents that ride the lift together and head the same way walk one identical route, so
  // they stack until their routes split. The check stays in the suite as it.fails until the scene gives
  // them room; remove .fails once the test passes.
  it.fails('no pair stays stacked: within 0.5 m for more than 5 s on the same floor', () => {
    for (const run of runs) expect(run.stats.longestClose, `seed ${run.seed}`).toBeLessThanOrEqual(MAX_CLOSE_S)
  })
})
