import { CAFE, PINGPONG, TREADMILLS } from './equipment.ts'
import { describe, expect, it } from 'vitest'
import { BUILDING, CORE, createBuilding, DESK_SIZE, FLOOR_HEIGHT, floorAt, LIFT, route, seatFor, type BrandInput, type BuildingLayout, type Vec3 } from './building.ts'

// The crews of context/brands/*/agents.json.
const BRANDS: BrandInput[] = [
  { id: 'jepangkoey', name: 'Jepang Koey', color: '#000000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'otca', name: 'Official OTCA', color: '#CB9D31', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager', 'digital-marketing', 'event-specialist'] },
  { id: 'infojerman', name: 'Info Jerman', color: '#F3CF45', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'ciaomanda', name: 'Ciao Manda', color: '#D40000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
]

const layout: BuildingLayout = createBuilding(BRANDS)

interface Box { minX: number; maxX: number; minZ: number; maxZ: number }
const deskBoxes = (floor: number): Box[] => layout.floors[floor].desks.map(({ center: [x, , z] }) => ({ minX: x - DESK_SIZE.width / 2, maxX: x + DESK_SIZE.width / 2, minZ: z - DESK_SIZE.depth / 2, maxZ: z + DESK_SIZE.depth / 2 }))
const inside = (box: Box, x: number, z: number, margin = 0) => x > box.minX - margin && x < box.maxX + margin && z > box.minZ - margin && z < box.maxZ + margin

/** Samples every leg of a path, so a walk that cuts through furniture is caught between waypoints. */
function samples(start: Vec3, path: Vec3[]): Vec3[] {
  const points: Vec3[] = []
  let from = start
  for (const to of path) {
    for (let step = 0; step <= 20; step++) points.push([0, 1, 2].map((axis) => from[axis] + ((to[axis] - from[axis]) * step) / 20) as Vec3)
    from = to
  }
  return points
}

describe('office building layout', () => {
  it('separates opposite walking directions on the shared aisle', () => {
    const left=layout.idleSpots.find(s=>s.key==='lounge-1')!
    const right=layout.idleSpots.find(s=>s.key==='game-3')!
    const east=route(layout,left,right).filter(p=>Math.abs(p[2]-0.92)<0.001)
    const west=route(layout,right,left).filter(p=>Math.abs(p[2]-0.28)<0.001)
    expect(east.length).toBeGreaterThanOrEqual(2)
    expect(west.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(east[0][2]-west[0][2])).toBeGreaterThan(0.6)
  })
  it('routes shared-room visitors around the ping-pong table, cafe table and treadmills', () => {
    const obstacles = [
      { owner: undefined, minX: PINGPONG.x-PINGPONG.length/2, maxX: PINGPONG.x+PINGPONG.length/2, minZ: PINGPONG.z-PINGPONG.width/2, maxZ: PINGPONG.z+PINGPONG.width/2 },
      ...CAFE.tables.map(x => ({owner:undefined,minX:x-0.5,maxX:x+0.5,minZ:CAFE.z-0.275,maxZ:CAFE.z+0.275})),
      { owner: undefined, minX: -8.55, maxX: -7.05, minZ: 2.875, maxZ: 3.525 },
      ...TREADMILLS.xs.map((x,i) => ({ owner: `gym-${i+1}`, minX: x-0.425, maxX: x+0.425, minZ: -4.325, maxZ: -2.675 })),
    ]
    const collisions: string[] = []
    for (const from of layout.idleSpots) for (const to of layout.idleSpots) {
      if (from === to) continue
      if (samples(from.position,route(layout,from,to)).some(([x,,z]) => obstacles.some((box) => box.owner !== from.key && box.owner !== to.key && inside(box,x,z,-0.02)))) collisions.push(`${from.key} → ${to.key}`)
    }
    expect(collisions).toEqual([])
  })
  it('provides six shared rooms with doorways and a private manager office on every brand floor', () => {
    expect(layout.floors[0].zones.map((zone) => zone.key).sort()).toEqual(['cafe','game','gym','lounge','pingpong','rest'])
    for (const floor of layout.floors) {
      for (const zone of floor.zones.filter((zone) => zone.door)) {
        expect(zone.door!.x - zone.door!.width/2).toBeGreaterThanOrEqual(zone.minX)
        expect(zone.door!.x + zone.door!.width/2).toBeLessThanOrEqual(zone.maxX)
      }
      if (!floor.brand) continue
      const manager = floor.desks.find((desk) => desk.manager)!
      const room = floor.zones.find((zone) => zone.key === 'manager')!
      expect(inside(room, manager.center[0], manager.center[2])).toBe(true)
      expect(inside(room, manager.seat.position[0], manager.seat.position[2])).toBe(true)
      const path = samples(manager.seat.position, route(layout, manager.seat, layout.idleSpots[0]))
      const exit = path.find(([x,,z]) => !inside(room,x,z))!
      expect(Math.abs(exit[0]-room.door!.x)).toBeLessThan(room.door!.width/2)
      for (const desk of floor.desks.filter((desk) => !desk.manager)) {
        expect(samples(desk.seat.position, route(layout,desk.seat,layout.idleSpots[0])).some(([x,height,z]) => height === floor.y && inside(room,x,z))).toBe(false)
      }
    }
  })
  it('provides each brand with a meeting suite clear of desk routes and the lift aisle', () => {
    for (const floor of layout.floors.slice(1)) {
      const meeting = floor.zones.find((zone) => zone.key === 'meeting')!
      expect(meeting.door?.width).toBeGreaterThanOrEqual(1.2)
      expect(meeting.minZ).toBeGreaterThan(floor.aisleZ + 0.5)
      for (const desk of floor.desks) {
        const points = samples(desk.seat.position, route(layout, desk.seat, layout.idleSpots[0]))
        expect(points.some(([x, y, z]) => Math.abs(y - floor.y) < 0.01 && inside(meeting, x, z))).toBe(false)
      }
    }
  })
  it('stacks the shared ground floor and the four brand floors in blueprint order', () => {
    expect(layout.floors.map((floor) => floor.brand?.id ?? 'ground')).toEqual(['ground', 'otca', 'infojerman', 'ciaomanda', 'jepangkoey'])
    expect(layout.floors.map((floor) => floor.y)).toEqual([0, 1, 2, 3, 4].map((index) => index * FLOOR_HEIGHT))
  })

  it('gives OTCA six desks and each sister brand four, one per agent, the Manager by the lift', () => {
    expect(layout.floors.map((floor) => floor.desks.length)).toEqual([0, 6, 4, 4, 4])
    for (const floor of layout.floors.slice(1)) {
      const manager = floor.desks.find((desk) => desk.manager)!
      const others = floor.desks.filter((desk) => !desk.manager)
      expect(new Set(floor.desks.map((desk) => desk.agentType)).size).toBe(floor.desks.length)
      const toLift = (desk: typeof manager) => Math.hypot(desk.center[0] - LIFT.x, desk.center[2] - LIFT.z)
      expect(others.every((desk) => toLift(desk) > toLift(manager))).toBe(true)
    }
    expect(seatFor(layout, 'otca', 'event-specialist')?.floor).toBe(1)
    expect(seatFor(layout, 'infojerman', 'event-specialist')).toBeUndefined()
  })

  it('keeps desks inside the building, apart, clear of the lift core and of the aisle', () => {
    for (const floor of layout.floors.slice(1)) {
      const boxes = deskBoxes(floor.index)
      for (const [index, box] of boxes.entries()) {
        expect(box.minX).toBeGreaterThan(BUILDING.minX)
        expect(box.maxX).toBeLessThan(CORE.minX)
        expect(box.minZ).toBeGreaterThan(BUILDING.minZ)
        expect(box.maxZ).toBeLessThan(floor.aisleZ - 0.5)
        for (const other of boxes.slice(index + 1)) expect(other.minX > box.maxX || other.maxX < box.minX || other.minZ > box.maxZ || other.maxZ < box.minZ).toBe(true)
      }
    }
  })

  it('walks from any desk to any other place without crossing a desk', () => {
    const places = [...layout.floors.flatMap((floor) => floor.desks.map((desk) => desk.seat)), ...layout.idleSpots]
    const boxes = layout.floors.map((floor) => deskBoxes(floor.index))
    const crossings: string[] = []
    for (const from of places) {
      for (const to of places) {
        if (from === to) continue
        // One collected list instead of an expect per sample: there are tens of thousands of samples.
        const hit = samples(from.position, route(layout, from, to)).find(([x, height, z]) => boxes[floorAt(height)].some((box) => inside(box, x, z, -0.05)))
        if (hit) crossings.push(`${from.key} → ${to.key} melewati meja di (${hit[0].toFixed(2)}, ${hit[2].toFixed(2)})`)
      }
    }
    expect(crossings).toEqual([])
  })

  it('changes floors only inside the lift shaft', () => {
    const from = seatFor(layout, 'jepangkoey', 'video-editor')!
    const to = layout.idleSpots.find((spot) => spot.key === 'pantry-1')!
    const path = route(layout, from, to)
    let previous = from.position
    for (const point of path) {
      if (point[1] !== previous[1]) expect([point[0], point[2], previous[0], previous[2]]).toEqual([LIFT.x, LIFT.z, LIFT.x, LIFT.z])
      previous = point
    }
    expect(path[path.length - 1]).toEqual(to.position)
  })

  it('stays inside the building, except outside spots that go out through the entrance', () => {
    for (const spot of layout.idleSpots) {
      const path = route(layout, seatFor(layout, 'otca', 'manager')!, spot)
      const outdoors = path.filter(([x, , z]) => x < BUILDING.minX || z > BUILDING.maxZ)
      if (spot.key === 'bakso' || spot.key === 'kopi') expect(outdoors.length).toBeGreaterThan(0)
      else expect(outdoors).toEqual([])
    }
  })

  it('reaches every room spot through its door, never through a room wall', () => {
    const ground = layout.floors[0]
    for (const spot of layout.idleSpots) {
      const zone = ground.zones.find((item) => inside(item, spot.position[0], spot.position[2]))
      if (!zone?.door) continue
      const [doorX, doorZ] = [zone.door.x, zone.door.z]
      // The walk out crosses the room's edge only at its door.
      const crossing = samples(spot.position, route(layout, spot, layout.idleSpots.find((place) => place.key === 'bakso')!))
        .find(([x, , z]) => !inside(zone, x, z))
      expect(crossing, spot.key).toBeDefined()
      const near = Math.abs(crossing![0] - doorX) <= zone.door.width / 2 + 0.1 || Math.abs(crossing![2] - doorZ) <= zone.door.width / 2 + 0.1
      expect(near, `${spot.key} keluar lewat (${crossing![0].toFixed(2)}, ${crossing![2].toFixed(2)})`).toBe(true)
    }
  })

  it('walks straight back to the same floor without a lift trip', () => {
    const path = route(layout, seatFor(layout, 'otca', 'content-creator')!, seatFor(layout, 'otca', 'manager')!)
    expect(path.every(([, height]) => height === FLOOR_HEIGHT)).toBe(true)
    expect(path.some(([x, , z]) => x === LIFT.x && z === LIFT.z)).toBe(false)
  })
})
