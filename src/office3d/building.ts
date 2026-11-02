// Layout of the OTCA office building (docs/PLAN-KANTOR-3D.md §4), kept apart from the scene so it
// can be tested. World units are metres, y up, +z towards the street; the camera looks from +z.
//
//  floor 4  Jepang Koey ┐
//  floor 3  Ciao Manda  │ brand floors: a row of desks along the back wall, the Manager's desk in
//  floor 2  Info Jerman │ front by the lift, a lounge corner; one desk per agent in agents.json
//  floor 1  Official OTCA┘
//  ground   shared: lobby & reception, lounge, game room, meeting room, pantry; the gang outside
//
//   z -5.5 ┌───────────────── back wall ──────────────────┬──────────┐
//          │ (brand) desks in one row            [logo]   │   lift   │
//          │                                              │   core   │
//          │                        Manager desk          ├──────────┘
//   z  2.8 │ ─ ─ ─ ─ ─ ─ ─ ─ aisle ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤ lane x 6
//   z  5.5 └──────────────── front (glass) ─ entrance ────┘
//
// Agents never walk through furniture: every spot has an exit, a list of waypoints from the spot to
// its floor's aisle, and a walk between two spots is exit → aisle (→ lift → aisle) → exit reversed.

export type Vec3 = [number, number, number]
export type Point = [number, number]

export const FLOOR_HEIGHT = 3.4
export const BUILDING = { minX: -10, maxX: 10, minZ: -5.5, maxZ: 5.5 }
/** Brand floors, bottom to top (blueprint: lantai 1 OTCA … lantai 4 Jepang Koey); others go above. */
export const FLOOR_ORDER = ['otca', 'infojerman', 'ciaomanda', 'jepangkoey']

/** Lift core on the right: the shaft, its door on the -x side, and the lane in front of it. */
export const CORE = { minX: 6.6, maxX: 10, minZ: -5.5, maxZ: -1.4 }
export const LIFT = { x: 8.5, z: -3.6, doorX: 7.2 }
export const LIFT_LANE_X = 6

/** Kenney desk at furniture scale 2: footprint in metres (width along x, depth along z). */
export const DESK_SIZE = { width: 1.44, depth: 1.12 }
/** Seat behind the desk, facing the camera (+z), and the gap beside the desk used to reach it. */
const SEAT_BEHIND = 1.05
const DESK_GAP = 1.3

const BRAND_AISLE_Z = 2.8
const GROUND_AISLE_Z = 0.6
/** Five desk slots along the back wall; a crew of fewer specialists takes the middle ones. */
const BACK_ROW_X = [-8.2, -5.6, -3, -0.4, 2.2]
const BACK_ROW_Z = -3.2
const MANAGER_DESK: Point = [3.6, 0.2]

/** Outside: the entrance gap in the front wall, the sidewalk and the gang (alley) left of the building. */
export const ENTRANCE_X = 0
export const SIDEWALK_Z = 6.4
export const GANG_LANE_X = -11.2

export interface Spot {
  key: string
  floor: number
  position: Vec3
  /** Radians around y; 0 faces +z (the camera). */
  facing: number
  seated: boolean
  label: string
  /** Waypoints (x, z) from the spot to its floor's aisle; the last one lies on the aisle. */
  exit: Point[]
}

export interface Desk { agentType: string; center: Vec3; seat: Spot; manager: boolean }

export interface DecorItem { piece: string; position: Vec3; rotation: number }

export interface BrandInput { id: string; name: string; color: string; agents: string[] }

export interface FloorLayout {
  index: number
  y: number
  aisleZ: number
  brand?: { id: string; name: string; color: string }
  desks: Desk[]
  /** Where the brand sign hangs on the back wall (brand floors only). */
  sign?: Vec3
  decor: DecorItem[]
  /** Rooms on the floor: their bounds and the door gap (on the aisle side) that every exit uses. */
  zones: Zone[]
}

export interface Zone { key: string; label: string; minX: number; maxX: number; minZ: number; maxZ: number; door?: { x: number; z: number; width: number } }

export interface BuildingLayout {
  floors: FloorLayout[]
  /** Shared places an idle agent can go, all on the ground floor or outside. */
  idleSpots: Spot[]
}

const y = (floor: number) => floor * FLOOR_HEIGHT

function deskSeat(key: string, floor: number, [x, z]: Point, aisleZ: number, gapSide: -1 | 1, label: string): Spot {
  const seatZ = z - SEAT_BEHIND
  const laneX = x + gapSide * DESK_GAP
  return { key, floor, position: [x, y(floor), seatZ], facing: 0, seated: true, label, exit: [[laneX, seatZ], [laneX, aisleZ]] }
}

/** The middle `count` of the back-row slots. */
function backRow(count: number): number[] {
  const start = Math.max(0, Math.floor((BACK_ROW_X.length - count) / 2))
  return BACK_ROW_X.slice(start, start + count)
}

function brandFloor(index: number, brand: BrandInput): FloorLayout {
  const specialists = brand.agents.filter((agent) => agent !== 'manager')
  if (specialists.length > BACK_ROW_X.length) throw new Error(`Lantai ${brand.name} hanya punya ${BACK_ROW_X.length} meja spesialis.`)
  const desks: Desk[] = backRow(specialists.length).map((x, slot) => ({
    agentType: specialists[slot], manager: false, center: [x, y(index), BACK_ROW_Z],
    // The gap left of each desk leads to the aisle; the leftmost slot keeps clear of the wall.
    seat: deskSeat(`${brand.id}:${specialists[slot]}`, index, [x, BACK_ROW_Z], BRAND_AISLE_Z, -1, 'Meja kerja'),
  }))
  if (brand.agents.includes('manager')) {
    desks.unshift({
      agentType: 'manager', manager: true, center: [MANAGER_DESK[0], y(index), MANAGER_DESK[1]],
      seat: deskSeat(`${brand.id}:manager`, index, MANAGER_DESK, BRAND_AISLE_Z, 1, 'Meja Manager'),
    })
  }
  const at = (x: number, z: number): Vec3 => [x, y(index), z]
  return {
    index, y: y(index), aisleZ: BRAND_AISLE_Z, brand: { id: brand.id, name: brand.name, color: brand.color }, desks,
    sign: at(-3, -5.42),
    zones: [{ key: 'kerja', label: 'Ruang kerja', minX: -9.8, maxX: 4.6, minZ: -5.4, maxZ: -1.3 }],
    decor: [
      { piece: 'loungeSofaLong', position: at(-8.6, 4.6), rotation: Math.PI },
      { piece: 'tableCoffee', position: at(-7.6, 3.9), rotation: 0 },
      { piece: 'pottedPlant', position: at(-9.4, -5), rotation: 0 },
      { piece: 'pottedPlant', position: at(5.6, -5), rotation: 0 },
      { piece: 'bookcaseOpen', position: at(4.6, -5.3), rotation: 0 },
      { piece: 'pottedPlant', position: at(5.6, 4.8), rotation: 0 },
    ],
  }
}

/** Ground floor: idle places (lounge, game room, meeting room, pantry) and the gang outside. */
function groundFloor(): { floor: FloorLayout; idleSpots: Spot[] } {
  const spot = (key: string, label: string, x: number, z: number, facing: number, seated: boolean, exit: Point[]): Spot =>
    ({ key, floor: 0, position: [x, 0, z], facing, seated, label, exit })
  // Rooms behind the aisle have doors on it; the lounge in front is left by its right-hand edge.
  const viaDoor = (doorX: number, z: number): Point[] => [[doorX, z], [doorX, GROUND_AISLE_Z]]
  // Outside spots are left along the gang lane, the sidewalk and in through the entrance.
  const outside = (z: number): Point[] => [[GANG_LANE_X, z], [GANG_LANE_X, SIDEWALK_Z], [ENTRANCE_X, SIDEWALK_Z], [ENTRANCE_X, GROUND_AISLE_Z]]
  const idleSpots: Spot[] = [
    spot('lounge-1', 'Santai di lounge', -8.4, 3.9, Math.PI, true, viaDoor(-4.4, 3.9)),
    spot('lounge-2', 'Santai di lounge', -7.4, 3.9, Math.PI, true, viaDoor(-4.4, 3.9)),
    spot('lounge-3', 'Nonton TV', -5.6, 2.9, -Math.PI / 2, true, viaDoor(-4.4, 2.9)),
    spot('game-1', 'Main ping-pong', -8.2, -2.2, Math.PI, false, viaDoor(-5, -2.2)),
    spot('game-2', 'Main ping-pong', -8.2, -4.6, 0, false, viaDoor(-5, -4.6)),
    spot('game-3', 'Main arcade', -6.2, -4.7, Math.PI, false, viaDoor(-5, -4.7)),
    spot('meeting-1', 'Diskusi di ruang rapat', -2.4, -2.4, Math.PI, true, viaDoor(-0.4, -2.4)),
    spot('meeting-2', 'Diskusi di ruang rapat', -1, -2.4, Math.PI, true, viaDoor(-0.4, -2.4)),
    spot('pantry-1', 'Bikin kopi', 4.2, -4.6, Math.PI, false, [[4.2, GROUND_AISLE_Z]]),
    spot('pantry-2', 'Ambil air di galon', 5.4, -4.6, Math.PI, false, [[5.4, GROUND_AISLE_Z]]),
    spot('bakso', 'Jajan bakso', -12.6, 2.6, Math.PI / 2, false, outside(2.6)),
    spot('kopi', 'Ngopi di gang', -12.6, -1.2, Math.PI / 2, false, outside(-1.2)),
  ]
  const at = (x: number, z: number): Vec3 => [x, 0, z]
  return {
    idleSpots,
    floor: {
      index: 0, y: 0, aisleZ: GROUND_AISLE_Z, desks: [],
      zones: [
        { key: 'game', label: 'Game room', minX: -9.8, maxX: -4.6, minZ: -5.4, maxZ: -1.2, door: { x: -5, z: -1.2, width: 1.2 } },
        { key: 'rapat', label: 'Ruang rapat', minX: -3.8, maxX: 2.6, minZ: -5.4, maxZ: -1.2, door: { x: -0.4, z: -1.2, width: 1.2 } },
        { key: 'pantry', label: 'Pantry', minX: 3.2, maxX: 6.4, minZ: -5.4, maxZ: -1.6 },
        { key: 'lounge', label: 'Lounge', minX: -9.8, maxX: -4, minZ: 1.6, maxZ: 5.4, door: { x: -4.4, z: 3.4, width: 3.6 } },
        { key: 'lobi', label: 'Lobi & resepsionis', minX: -1.6, maxX: 4.6, minZ: 1.6, maxZ: 5.4 },
      ],
      decor: [
        { piece: 'desk', position: at(3, 3.4), rotation: Math.PI }, // reception
        { piece: 'loungeSofaLong', position: at(-8, 4.5), rotation: Math.PI },
        { piece: 'televisionModern', position: at(-7.9, 1.6), rotation: 0 },
        { piece: 'tableCoffee', position: at(-7.2, 3), rotation: 0 },
        { piece: 'table', position: at(-1.7, -3.4), rotation: 0 }, // meeting room
        { piece: 'kitchenBar', position: at(4.2, -5.2), rotation: 0 },
        { piece: 'kitchenCoffeeMachine', position: at(4.2, -5.2), rotation: 0 },
        { piece: 'kitchenFridge', position: at(5.8, -5.2), rotation: 0 },
        { piece: 'pottedPlant', position: at(-0.9, 5), rotation: 0 },
        { piece: 'pottedPlant', position: at(0.9, 5), rotation: 0 },
      ],
    },
  }
}

export function createBuilding(brands: BrandInput[]): BuildingLayout {
  const ordered = [...brands].sort((a, b) => rank(a.id) - rank(b.id))
  const ground = groundFloor()
  return { floors: [ground.floor, ...ordered.map((brand, slot) => brandFloor(slot + 1, brand))], idleSpots: ground.idleSpots }
}

const rank = (id: string) => (FLOOR_ORDER.indexOf(id) + 1 || FLOOR_ORDER.length + 1)

export function floorOfBrand(layout: BuildingLayout, brandId: string): FloorLayout | undefined {
  return layout.floors.find((floor) => floor.brand?.id === brandId)
}

export function seatFor(layout: BuildingLayout, brandId: string, agentType: string): Spot | undefined {
  return floorOfBrand(layout, brandId)?.desks.find((desk) => desk.agentType === agentType)?.seat
}

/** The floor a height belongs to. */
export const floorAt = (height: number) => Math.max(0, Math.round(height / FLOOR_HEIGHT))

/**
 * Waypoints from one spot to another, ending on `to.position`. Changing floors goes by the lift:
 * along the aisle to the lift lane, into the shaft, up or down, and out again.
 */
export function route(layout: BuildingLayout, from: Spot, to: Spot): Vec3[] {
  const aisle = (floor: number) => layout.floors[floor]?.aisleZ ?? GROUND_AISLE_Z
  const on = (floor: number) => ([x, z]: Point): Vec3 => [x, y(floor), z]
  const points: Vec3[] = [...from.exit.map(on(from.floor))]
  if (from.floor !== to.floor) {
    const lift = (floor: number): Vec3[] => [[LIFT_LANE_X, y(floor), aisle(floor)], [LIFT_LANE_X, y(floor), LIFT.z], [LIFT.doorX, y(floor), LIFT.z], [LIFT.x, y(floor), LIFT.z]]
    points.push(...lift(from.floor), ...lift(to.floor).reverse())
  }
  points.push(...[...to.exit].reverse().map(on(to.floor)), to.position)
  return tidy(from.position, points)
}

/** Drops waypoints that do not move the walker, and middle points of straight runs. */
function tidy(start: Vec3, points: Vec3[]): Vec3[] {
  const path: Vec3[] = []
  let last = start
  for (const point of points) {
    if (Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) > 0.05) { path.push(point); last = point }
  }
  const straight = (a: Vec3, b: Vec3, c: Vec3) => [0, 1, 2].filter((axis) => Math.abs(a[axis] - b[axis]) < 1e-6 && Math.abs(b[axis] - c[axis]) < 1e-6).length >= 2
  for (let index = path.length - 2; index >= 0; index--) {
    const before = index === 0 ? start : path[index - 1]
    if (straight(before, path[index], path[index + 1])) path.splice(index, 1)
  }
  return path
}
