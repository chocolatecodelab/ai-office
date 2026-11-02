import { useMemo } from 'react'
import * as THREE from 'three'
import { BUILDING, CORE, FLOOR_HEIGHT, LIFT, SIDEWALK_Z, type BuildingLayout, type FloorLayout, type Vec3 } from '../office3d/building.ts'
import type { FurnitureLibrary } from './furniture.ts'

// The office building drawn from its layout (src/office3d/building.ts): floor slabs, walls, the lift
// core, and the Kenney furniture of each floor. Floors above the one in view are not drawn; floors
// below show only their shell, so the building reads as a stack without drawing every desk.

const WALL = '#efe6d6'
const SLAB = '#cfc6b6'
const WALL_THICK = 0.2
const WALL_HEIGHT = FLOOR_HEIGHT - 0.1
const ZONE_TINTS = ['#7fb7d9', '#9fd39b', '#f0c27a', '#d9a3c7', '#b7b0e8']

/** One furniture piece at a floor position (centre of its footprint), turned around y. */
export function Piece({ library, name, position, rotation = 0 }: { library: FurnitureLibrary; name: string; position: Vec3; rotation?: number }) {
  const object = useMemo(() => library.piece(name), [library, name])
  return <primitive object={object} position={position} rotation={[0, rotation, 0]}/>
}

function Box({ position, size, color, opacity }: { position: Vec3; size: Vec3; color: string; opacity?: number }) {
  return <mesh position={position} castShadow={opacity === undefined} receiveShadow>
    <boxGeometry args={size}/>
    <meshStandardMaterial color={color} roughness={0.9} transparent={opacity !== undefined} opacity={opacity ?? 1}/>
  </mesh>
}

function BrandSign({ floor }: { floor: FloorLayout }) {
  const brand = floor.brand
  const texture = useMemo(() => {
    if (!brand) return undefined
    const file = brand.id === 'otca' ? 'logo-glow.png' : 'logo.png'
    const map = new THREE.TextureLoader().load(`/brands/${brand.id}/${file}`)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [brand])
  if (!brand || !floor.sign || !texture) return null
  const [x, y, z] = floor.sign
  // OTCA's gold logo sits on its black; the sister brands' logos need a light board.
  const board = brand.id === 'otca' ? '#0b0b0b' : brand.id === 'infojerman' ? '#F7F1E2' : '#ffffff'
  return <group position={[x, y + 2.2, z]}>
    <mesh><boxGeometry args={[3.4, 1.3, 0.05]}/><meshStandardMaterial color={board} roughness={0.6}/></mesh>
    <mesh position={[0, 0, 0.03]}><planeGeometry args={[3, 1.1]}/><meshBasicMaterial map={texture} transparent toneMapped={false}/></mesh>
    <mesh position={[0, -0.72, 0.01]}><boxGeometry args={[3.4, 0.08, 0.06]}/><meshStandardMaterial color={brand.color}/></mesh>
  </group>
}

function Shell({ floor, open }: { floor: FloorLayout; open: boolean }) {
  const { minX, maxX, minZ, maxZ } = BUILDING
  const width = maxX - minX
  const depth = maxZ - minZ
  const base = floor.y
  const mid = base + WALL_HEIGHT / 2
  return <group>
    <Box position={[0, base - 0.06, 0]} size={[width, 0.12, depth]} color={SLAB}/>
    <Box position={[0, mid, minZ - WALL_THICK / 2]} size={[width, WALL_HEIGHT, WALL_THICK]} color={WALL}/>
    <Box position={[minX - WALL_THICK / 2, mid, 0]} size={[WALL_THICK, WALL_HEIGHT, depth + WALL_THICK * 2]} color={WALL}/>
    <Box position={[maxX + WALL_THICK / 2, mid, 0]} size={[WALL_THICK, WALL_HEIGHT, depth + WALL_THICK * 2]} color={WALL}/>
    {/* The front is glass on the floor in view (so the camera sees in) and solid on the floors below. */}
    {open ? <Box position={[0, base + 0.5, maxZ + WALL_THICK / 2]} size={[width, 1, WALL_THICK / 2]} color="#a9c9d6" opacity={0.25}/>
      : <Box position={[0, mid, maxZ + WALL_THICK / 2]} size={[width, WALL_HEIGHT, WALL_THICK]} color={WALL}/>}
    {/* Lift core: shaft walls with the door facing the floor, a light strip over the door. */}
    <Box position={[(CORE.minX + CORE.maxX) / 2, mid, CORE.maxZ]} size={[CORE.maxX - CORE.minX, WALL_HEIGHT, WALL_THICK]} color="#d9cdb8"/>
    <Box position={[CORE.minX + 0.3, mid, LIFT.z - 1.25]} size={[0.6, WALL_HEIGHT, 1.3]} color="#d9cdb8"/>
    <Box position={[CORE.minX + 0.3, mid, LIFT.z + 1.25]} size={[0.6, WALL_HEIGHT, 1.3]} color="#d9cdb8"/>
    <Box position={[CORE.minX + 0.05, base + 1.1, LIFT.z]} size={[0.06, 2.2, 1.2]} color="#9aa3a6" opacity={open ? 0.5 : undefined}/>
    <Box position={[CORE.minX + 0.02, base + 2.35, LIFT.z]} size={[0.04, 0.12, 1.2]} color={floor.brand?.color ?? '#74c59a'}/>
  </group>
}

function FloorInterior({ floor, library }: { floor: FloorLayout; library: FurnitureLibrary }) {
  const brandColor = floor.brand?.color
  return <group>
    {/* Rooms as tinted floor until their walls come (K3); brand floors tint the work area in the brand colour. */}
    {floor.zones.map((zone, index) => <Box key={zone.key} position={[(zone.minX + zone.maxX) / 2, floor.y + 0.01, (zone.minZ + zone.maxZ) / 2]}
      size={[zone.maxX - zone.minX, 0.02, zone.maxZ - zone.minZ]} color={brandColor ?? ZONE_TINTS[index % ZONE_TINTS.length]} opacity={0.35}/>)}
    {floor.desks.map((desk) => <group key={desk.agentType}>
      <Piece library={library} name="desk" position={desk.center}/>
      <Piece library={library} name="computerScreen" position={[desk.center[0], desk.center[1] + 0.76, desk.center[2] - 0.15]} rotation={Math.PI}/>
      <Piece library={library} name="computerKeyboard" position={[desk.center[0], desk.center[1] + 0.76, desk.center[2] - 0.38]} rotation={Math.PI}/>
      <Piece library={library} name="chairDesk" position={[desk.seat.position[0], desk.seat.position[1], desk.seat.position[2] - 0.1]} rotation={Math.PI}/>
    </group>)}
    {floor.decor.map((item, index) => <Piece key={index} library={library} name={item.piece} position={item.position} rotation={item.rotation}/>)}
    <BrandSign floor={floor}/>
  </group>
}

function Outdoors() {
  const { minX, maxX, maxZ } = BUILDING
  return <group>
    <Box position={[0, -0.08, SIDEWALK_Z]} size={[maxX - minX + 8, 0.1, 1.8]} color="#b9b2a5"/>
    <Box position={[0, -0.12, SIDEWALK_Z + 3]} size={[maxX - minX + 8, 0.1, 4.2]} color="#4a4f52"/>
    <Box position={[minX - 2.3, -0.1, 0]} size={[4, 0.1, maxZ * 2]} color="#a39b8c"/>
  </group>
}

export function BuildingScene({ layout, library, floor }: { layout: BuildingLayout; library: FurnitureLibrary; floor: number }) {
  return <group>
    <Outdoors/>
    {layout.floors.filter((item) => item.index <= floor).map((item) => <group key={item.index}>
      <Shell floor={item} open={item.index === floor}/>
      {item.index === floor && <FloorInterior floor={item} library={library}/>}
    </group>)}
  </group>
}
