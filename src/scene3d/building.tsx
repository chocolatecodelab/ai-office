import { CAFE, LOUNGE, PINGPONG, TREADMILLS } from '../office3d/equipment.ts'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AvatarBody } from './character.tsx'
import { agentLook } from '../agents.ts'
import { ROOM_ACTIVITIES, type ActivityRoom } from '../office3d/activities.ts'
import { INTERIORS } from '../office3d/interiors.ts'
import { AGENT_NAMES, type OfficeBrand } from '../office-api.ts'
import { asphalt, carpet, grass, pavingStones, tileFloor, woodFloor } from './textures.ts'
import * as THREE from 'three'
import { BUILDING, CORE, FLOOR_HEIGHT, LIFT, SIDEWALK_Z, type BuildingLayout, type FloorLayout, type Vec3, type Zone } from '../office3d/building.ts'
import type { FurnitureLibrary } from './furniture.ts'
import { AirConditioner, ArcadeCabinet, Armchair, Beanbag, Bookshelf, CoffeeTable, FlagPole, Fridge, GalonDispenser, Gerobak, KopiSepeda, OfficeChair, PingPongTable, Plant, RBox, Sofa, StreetLamp, Tree, WallClock, Wardrobe, WorkDesk } from './props.tsx'

// The office building drawn from its layout (src/office3d/building.ts): floor slabs, walls, the lift
// core, and the Kenney furniture of each floor. Floors above the one in view are not drawn; floors
// below show only their shell, so the building reads as a stack without drawing every desk.

const WALL = '#efe6d6'
const SLAB = '#cfc6b6'
const WALL_THICK = 0.2
const WALL_HEIGHT = FLOOR_HEIGHT - 0.1
const ZONE_TINTS = ['#7fb7d9', '#9fd39b', '#f0c27a', '#d9a3c7', '#b7b0e8']

function RoomSurface({ zone, y, color }: { zone: Zone; y: number; color: string }) {
  const map = useMemo(() => zone.key === 'cafe' ? tileFloor([1,1]) : carpet(color,[2,2]), [zone.key,color])
  return <Surface position={[(zone.minX+zone.maxX)/2,y+0.025,(zone.minZ+zone.maxZ)/2]} size={[zone.maxX-zone.minX,zone.maxZ-zone.minZ]} map={map}/>
}

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

function Surface({ position, size, map, color = '#ffffff' }: { position: Vec3; size: [number,number]; map: THREE.Texture; color?: string }) {
  return <mesh position={position} rotation={[-Math.PI/2,0,0]} receiveShadow><planeGeometry args={size}/><meshStandardMaterial map={map} color={color} roughness={0.8}/></mesh>
}

function BrandSign({ floor }: { floor: FloorLayout }) {
  const brand = floor.brand
  const brandId = brand?.id
  const texture = useMemo(() => {
    if (!brandId) return undefined
    const file = brandId === 'otca' ? 'logo-glow.png' : 'logo.png'
    const map = new THREE.TextureLoader().load(`/brands/${brandId}/${file}`)
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [brandId])
  useEffect(() => () => texture?.dispose(), [texture])
  if (!brand || !floor.sign || !texture) return null
  const [x, y, z] = floor.sign
  // OTCA's gold logo sits on its black; the sister brands' logos need a light board.
  const board = brand.id === 'otca' ? '#0b0b0b' : brand.id === 'infojerman' ? '#F7F1E2' : '#ffffff'
  return <group position={[x, y + 2.2, z + 0.25]}>
    <mesh><boxGeometry args={[3.4, 1.3, 0.05]}/><meshStandardMaterial color={board} roughness={0.6}/></mesh>
    <mesh position={[0, 0, 0.03]}><planeGeometry args={[3, 1.1]}/><meshBasicMaterial map={texture} transparent toneMapped={false}/></mesh>
    <mesh position={[0, -0.72, 0.01]}><boxGeometry args={[3.4, 0.08, 0.06]}/><meshStandardMaterial color={brand.color}/></mesh>
  </group>
}

function Shell({ floor, open }: { floor: FloorLayout; open: boolean }) {
  const theme = INTERIORS[floor.brand?.id ?? '']
  const surface = useMemo(() => floor.index > 0 ? woodFloor([5,3]) : tileFloor([3,2]), [floor.index])
  const { minX, maxX, minZ, maxZ } = BUILDING
  const width = maxX - minX
  const depth = maxZ - minZ
  const base = floor.y
  const mid = base + WALL_HEIGHT / 2
  return <group>
    <Box position={[0, base - 0.06, 0]} size={[width, 0.12, depth]} color={theme?.floor ?? SLAB}/>
    {open && <Surface position={[0,base+0.004,0]} size={[width,depth]} map={surface} color={floor.brand?.id === 'jepangkoey' ? '#b6bcb3' : floor.brand?.id === 'otca' ? '#c8bda9' : '#ffffff'}/>}
    <Box position={[0, mid, minZ - WALL_THICK / 2]} size={[width, WALL_HEIGHT, WALL_THICK]} color={theme?.wall ?? WALL}/>
    <Box position={[minX - WALL_THICK / 2, mid, 0]} size={[WALL_THICK, WALL_HEIGHT, depth + WALL_THICK * 2]} color={WALL}/>
    <Box position={[maxX + WALL_THICK / 2, mid, 0]} size={[WALL_THICK, WALL_HEIGHT, depth + WALL_THICK * 2]} color={WALL}/>
    {/* The front is glass on the floor in view (so the camera sees in) and solid on the floors below. */}
    {open ? <group>{[-5.5,5.5].map(x => <Box key={x} position={[x, base + 0.5, maxZ + WALL_THICK / 2]} size={[9, 1, WALL_THICK / 2]} color="#a9c9d6" opacity={0.25}/>)}</group>
      : <Box position={[0, mid, maxZ + WALL_THICK / 2]} size={[width, WALL_HEIGHT, WALL_THICK]} color={WALL}/>}
    {/* Lift core: shaft walls with the door facing the floor, a light strip over the door. */}
    <Box position={[(CORE.minX + CORE.maxX) / 2, mid, CORE.maxZ]} size={[CORE.maxX - CORE.minX, WALL_HEIGHT, WALL_THICK]} color="#d9cdb8"/>
    <Box position={[CORE.minX + 0.3, mid, LIFT.z - 1.25]} size={[0.6, WALL_HEIGHT, 1.3]} color="#d9cdb8"/>
    <Box position={[CORE.minX + 0.3, mid, LIFT.z + 1.25]} size={[0.6, WALL_HEIGHT, 1.3]} color="#d9cdb8"/>
    {!open && <Box position={[CORE.minX + 0.05, base + 1.1, LIFT.z]} size={[0.06, 2.2, 1.2]} color="#9aa3a6"/>}
    <Box position={[CORE.minX + 0.02, base + 2.35, LIFT.z]} size={[0.04, 0.12, 1.2]} color={floor.brand?.color ?? '#74c59a'}/>
  </group>
}

function FloorInterior({ floor, library, brands, onAgentSelect, onRoomInteract, onVendor }: { floor: FloorLayout; library: FurnitureLibrary; brands?: OfficeBrand[]; onAgentSelect?: (id: string) => void; onRoomInteract?: (room: ActivityRoom) => void; onVendor?: (key: 'bakso' | 'kopi') => void }) {
  const brandColor = floor.brand?.color
  return <group onClick={floor.index === 0 ? (event) => {
    const zone = floor.zones.find((zone) => event.point.x >= zone.minX && event.point.x <= zone.maxX && event.point.z >= zone.minZ && event.point.z <= zone.maxZ)
    if (zone && ROOM_ACTIVITIES.some((room) => room.id === zone.key)) { event.stopPropagation(); onRoomInteract?.(zone.key as ActivityRoom) }
  } : undefined}>
    {/* Rooms as tinted floor until their walls come (K3); brand floors tint the work area in the brand colour. */}
    {floor.zones.filter((zone) => zone.key !== 'kerja').map((zone, index) => <RoomSurface key={zone.key} zone={zone} y={floor.y} color={INTERIORS[floor.brand?.id ?? '']?.soft ?? (zone.key === 'gym' ? '#536461' : ZONE_TINTS[index % ZONE_TINTS.length])}/>)}
    {floor.desks.map((desk) => <group key={desk.agentType} onClick={(event) => { event.stopPropagation(); onAgentSelect?.(`${floor.brand?.id}/${desk.agentType}`) }}>
      <WorkDesk position={desk.center} withChair={false} active={['working','revision'].includes(brands?.find((brand) => brand.id === floor.brand?.id)?.agents.find((agent) => agent.agentType === desk.agentType)?.status ?? '')}/>
      <OfficeChair position={desk.seat.position} color={INTERIORS[floor.brand?.id ?? '']?.soft}/>
      <group position={[desk.center[0], desk.center[1]+0.94, desk.center[2]+0.46]} scale={0.24}><Sign text={AGENT_NAMES[desk.agentType] ?? desk.agentType} position={[0,0,0]} color={brandColor}/></group>
    </group>)}
    {floor.decor.filter((item) => !['loungeSofaLong','tableCoffee'].includes(item.piece)).map((item, index) => <Piece key={index} library={library} name={item.piece} position={item.position} rotation={item.rotation}/>)}
    <BrandSign floor={floor}/>
    {floor.brand ? <BrandInterior floor={floor}/> : <><GroundPartitions floor={floor}/><SharedAmenities/></>}
    {floor.index === 0 && <group>
      <PingPongTable position={[PINGPONG.x,0,PINGPONG.z]}/>
      <GalonDispenser position={[-1.4, 0, -5]}/>
      <group onClick={e => {e.stopPropagation();onVendor?.('bakso')}}><Vendor kind="bakso" position={[-14.2,0,4.1]}/><Gerobak position={[-13.5, 0, 2.6]} rotation={Math.PI / 2}/></group>
      <group onClick={e => {e.stopPropagation();onVendor?.('kopi')}}><Vendor kind="kopi" position={[-14.2,0,-1.2]}/><KopiSepeda position={[-13.5, 0, -1.2]} rotation={Math.PI / 2}/></group>
    </group>}
  </group>
}

function Sign({ text, position, color = '#efe6d6' }: { text: string; position: Vec3; color?: string }) {
  const map = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 96
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#202824'; ctx.fillRect(0, 0, 768, 96)
    ctx.fillStyle = color; ctx.font = '500 36px sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(text, 384, 60, 740)
    return new THREE.CanvasTexture(canvas)
  }, [text, color])
  useEffect(() => () => map.dispose(), [map])
  return <mesh position={position}><planeGeometry args={[3.8, 0.48]}/><meshBasicMaterial map={map} toneMapped={false}/></mesh>
}

/** Cutaway glazing: low front panels retain a readable view into each room. */
function GroundPartitions({ floor }: { floor: FloorLayout }) {
  return <group>{floor.zones.filter((zone) => zone.door).map((zone) => {
    const door = zone.door!
    const z = door.z; const y = floor.y
    const left = door.x - door.width / 2; const right = door.x + door.width / 2
    return <group key={zone.key}>
      <Box position={[zone.minX, y + 0.65, (zone.minZ + zone.maxZ) / 2]} size={[0.08, 1.3, zone.maxZ - zone.minZ]} color="#9eb8b3" opacity={0.25}/>
      <Box position={[zone.maxX, y + 0.65, (zone.minZ + zone.maxZ) / 2]} size={[0.08, 1.3, zone.maxZ - zone.minZ]} color="#9eb8b3" opacity={0.25}/>
      <Box position={[(zone.minX+zone.maxX)/2,y+0.55, z === zone.minZ ? zone.maxZ : zone.minZ]} size={[zone.maxX-zone.minX,1.1,0.08]} color="#9eb8b3" opacity={0.25}/>
      {[ [zone.minX, left], [right, zone.maxX] ].map(([a,b], i) => b > a && <Box key={i} position={[(a+b)/2, y + 0.55, z]} size={[b-a, 1.1, 0.08]} color="#acc9cb" opacity={0.3}/>)}
      <Sign text={zone.label} position={[(zone.minX + zone.maxX)/2, y + 2.45, zone.minZ + 0.1]}/>
    </group>
  })}</group>
}

function SharedAmenities() {
  return <group>
    {/* Cafe: counter, espresso machine, tables and chairs. */}
    <RBox position={[-3,0.5,-4.9]} size={[2.8,1,0.65]} radius={0.05} color="#956e4e"/>
    <RBox position={[-3.5,1.2,-4.9]} size={[0.5,0.4,0.4]} color="#2b3336"/>
    {CAFE.tables.map(x => <group key={x}><RBox position={[x,0.72,CAFE.z]} size={[1,0.08,0.55]} color="#d4b48a"/>{CAFE.seatZ.map((z,i) => <OfficeChair key={z} position={[x,0,z]} rotation={i ? Math.PI : 0}/>)}</group>)}
    <Plant position={[-4.2,0,-5]}/>
    {/* Gym: two treadmills, weights rack, and a yoga mat. */}
    {TREADMILLS.xs.map((x) => <group key={x} position={[x,0,TREADMILLS.z]}>
      <RBox position={[0,0.15,0]} size={[0.85,0.2,1.65]} radius={0.08} color="#30383c"/>
      <Box position={[0,0.27,0]} size={[0.62,0.02,1.35]} color="#161f23"/>
      {[-0.38,0.38].map((dx) => <Box key={dx} position={[dx,0.7,-0.65]} size={[0.05,1.1,0.05]} color="#8d999d"/>)}
      <RBox position={[0,1.2,-0.65]} size={[0.8,0.22,0.15]} color="#354a50"/>
    </group>)}
    <Box position={[4.4,0.03,-3.8]} size={[0.7,0.04,1.8]} color="#7f9b87"/>
    {[1.5,2.2,2.9,3.6].map((x) => <group key={x} position={[x,0.8,-5]}>
      <Box position={[0,0,0]} size={[0.4,0.04,0.04]} color="#a1a9ac"/>
      {[-0.2,0.2].map((dx) => <Box key={dx} position={[dx,0,0]} size={[0.09,0.23,0.23]} color="#30383c"/>)}
    </group>)}
    <Box position={[2.6,0.65,-5]} size={[3.4,0.08,0.4]} color="#676e70"/>
    <Sofa position={LOUNGE.sofa} rotation={Math.PI} color="#527367"/>
    <Armchair position={LOUNGE.armchair} rotation={Math.PI} color="#718b78"/>
    <RBox position={[-7.8,0.4,3.2]} size={[1.5,0.08,0.65]} color="#aa8b69"/>
    <Plant position={[-9.4,0,4.8]}/>
    {[-3.7,-2.5].map((x) => <group key={x} position={[x,0,4.5]}><Beanbag position={[0,0,0]} color="#7d8297"/></group>)}
    <Beanbag position={[-3.2,0,2.4]} color="#9a887d"/>
    <Wardrobe position={[-4.4,0,1.9]} rotation={Math.PI/2}/>
    <group position={[1.9,0,5]} rotation={[0,Math.PI,0]}><ArcadeCabinet position={[0,0,0]} color="#c04b4d"/></group>
    <group position={[3.2,0,5]} rotation={[0,Math.PI,0]}><ArcadeCabinet position={[0,0,0]} color="#486da3"/></group>
    <Beanbag position={[2.5,0,2.4]} color="#6e5c91"/>
    <AirConditioner position={[-7.8,2.7,-5.1]}/>
    <AirConditioner position={[3.2,2.7,-5.1]}/>
  </group>
}

function BrandInterior({ floor }: { floor: FloorLayout }) {
  const brand = floor.brand!
  const theme = INTERIORS[brand.id] ?? INTERIORS.otca
  const y = floor.y
  const meeting = floor.zones.find((zone) => zone.key === 'meeting')!
  const door = meeting.door!
  return <group>
    <Sofa position={[3.5,y,4.9]} rotation={Math.PI} color={theme.soft}/>
    <CoffeeTable position={[3.5,y,3.9]}/>
    <GroundPartitions floor={{ ...floor, zones: floor.zones.filter((zone) => ['manager','relax'].includes(zone.key)) }}/>
    <AirConditioner position={[4.5,y+2.75,-1.05]}/>
    <AirConditioner position={[-7,y+2.75,-5.05]}/>
    <Plant position={[2.75,y,1.35]} size={0.7}/>
    <Plant position={[1.4,y,4.9]} size={0.7}/>
    <Wardrobe position={[2.85,y,-0.65]} rotation={Math.PI/2}/>
    {/* Locker bank kept against the side wall, outside the lift lane at x=6. */}
    {[0,1,2].map((i) => <group key={i} position={[8+i*0.55,y,2.2]}>
      <RBox position={[0,0.9,0]} size={[0.5,1.8,0.48]} color={theme.metal}/>
      <Box position={[0.12,0.95,0.25]} size={[0.04,0.16,0.025]} color="#d9dfdf"/>
    </group>)}
    {/* Amenities stay to the right of the circulation lane at x=6. */}
    <Box position={[8.5,y+0.015,2]} size={[2.7,0.025,6.2]} color={theme.soft} opacity={0.18}/>
    <RBox position={[8.2,y+0.43,0.4]} size={[1.6,0.14,0.55]} radius={0.06} color={theme.wood}/>
    {[7.6,8.8].map((x) => <Box key={x} position={[x,y+0.2,0.4]} size={[0.08,0.4,0.45]} color={theme.metal}/>)}
    <Bookshelf position={[9.6,y,-0.2]} rotation={-Math.PI/2}/>
    <Plant position={[7.5,y,3.45]} size={0.9}/>
    <RBox position={[8.1,y+0.48,4.75]} size={[1.45,0.96,0.65]} color={theme.wood}/>
    <RBox position={[8.1,y+1.2,4.75]} size={[0.4,0.45,0.4]} color={theme.metal}/>
    <Fridge position={[9.3,y,4.7]}/>
    <group position={[9.92,y+2.25,2.3]} rotation={[0,-Math.PI/2,0]}><WallClock position={[0,0,0]}/></group>
    <Sign text="LOCKERS · COFFEE · LIBRARY" position={[8.35,y+2.55,4.95]} color={brand.color === '#000000' ? '#ffffff' : brand.color}/>
    {/* Inset window panels with frames and mullions; kept on the side facing the cutaway camera. */}
    {[-2.5,1.5,4].map((z) => <group key={z} position={[-9.94,y+2,z]} rotation={[0,Math.PI/2,0]}>
      <Box position={[0,0,0]} size={[1.7,1.25,0.06]} color="#adcbd5"/>
      {[-0.85,0,0.85].map((x) => <Box key={x} position={[x,0,0.05]} size={[0.045,1.3,0.06]} color={theme.metal}/>)}
      {[-0.65,0.65].map((h) => <Box key={h} position={[0,h,0.05]} size={[1.75,0.045,0.06]} color={theme.metal}/>)}
    </group>)}
    {/* Accent wall, a continuous light band, and a different architectural motif per brand. */}
    <Box position={[-3, y + 1.55, -5.36]} size={[13.6, 3, 0.08]} color={theme.wall}/>
    <Box position={[-3, y + 3.05, -5.25]} size={[13.6, 0.045, 0.06]} color={brand.color}/>
    {Array.from({ length: theme.motif === 'gallery' ? 3 : 12 }, (_, i) => {
      const gallery = theme.motif === 'gallery'
      const x = gallery ? -8 + i * 4.5 : -9.3 + i * 1.15
      return <Box key={i} position={[x, y + (gallery ? 2.3 : 1.5), -5.25]} size={[gallery ? 1.2 : 0.05, gallery ? 0.75 : 2.7, 0.06]} color={gallery ? brand.color : theme.wood}/>
    })}
    {(theme.motif === 'grid' || theme.motif === 'shoji') && [0.8, 1.6, 2.4].map((h) => <Box key={h} position={[-3, y+h, -5.2]} size={[13.3, 0.04, 0.04]} color={theme.wood}/>)}
    {/* Six-person meeting suite occupies the front band, clear of every desk route and the aisle. */}
    {[[-9.6, door.x-door.width/2], [door.x+door.width/2, -1]].map(([a,b],i) => <group key={i}>
      <Box position={[(a+b)/2,y+1.05,3.35]} size={[b-a,2.1,0.045]} color="#aac4c7" opacity={0.18}/>
      <Box position={[(a+b)/2,y+2.1,3.35]} size={[b-a,0.035,0.05]} color={theme.metal}/>
    </group>)}
    {[-9.6,-1].map((x) => <Box key={x} position={[x,y+0.6,4.325]} size={[0.06,1.2,1.95]} color={theme.wood}/>)}
    <RBox position={[-5.8,y+0.74,4.3]} size={[5.6,0.08,0.65]} radius={0.08} color={theme.wood}/>
    {[-7.5,-5.8,-4.1].map((x) => <group key={x}>
      <RBox position={[x,y+0.8,4.3]} size={[0.3,0.025,0.22]} radius={0.015} color="#e7e3d8"/>
      <Box position={[x+0.3,y+2.8,4.3]} size={[0.7,0.025,0.12]} color="#fff2d3"/>
    </group>)}
    {[-8,-3.6].map((x) => <Box key={x} position={[x,y+0.36,4.3]} size={[0.1,0.72,0.4]} color={theme.metal}/>)}
    {[-7.5,-5.8,-4.1].flatMap((x) => [3.7,4.95].map((z) => <group key={`${x}-${z}`} position={[x,y,z]} scale={0.65}><OfficeChair position={[0,0,0]} rotation={z < 4 ? 0 : Math.PI} color={theme.soft}/></group>))}
    <Sign text={theme.room + ' · 6 tempat'} position={[-5.7,y+1.75,3.4]} color={brand.color === '#000000' ? '#ffffff' : brand.color}/>
    <group position={[-1.06,y+1.35,4.32]} rotation={[0,-Math.PI/2,0]}>
      <RBox position={[0,0,0]} size={[1.25,0.7,0.06]} radius={0.03} color="#242c30"/>
      <Box position={[0,0,0.04]} size={[1.12,0.57,0.012]} color="#45656b"/>
      <Box position={[0,-0.1,0.05]} size={[0.75,0.015,0.01]} color={brand.color}/>
    </group>
    <Sign text="TEAM LOUNGE" position={[3.5,y+0.08,5.25]}/>
  </group>
}

function OfficeEntranceSign({ night }: { night: boolean }) {
  const logo = useMemo(() => {
    const map = new THREE.TextureLoader().load('/brands/otca/logo-glow.png')
    map.colorSpace = THREE.SRGBColorSpace
    return map
  }, [])
  useEffect(() => () => logo.dispose(), [logo])
  return <group position={[3.7,0,7.2]}>
    {[-1.4,1.4].map(x => <Box key={x} position={[x,0.75,0]} size={[0.1,1.5,0.12]} color="#b58c36"/>)}
    <RBox position={[0,1.55,0]} size={[3.5,1.55,0.18]} radius={0.06} color="#101713"/>
    <mesh position={[0,1.78,0.1]}><planeGeometry args={[2.9,0.84]}/><meshBasicMaterial map={logo} transparent toneMapped={false}/></mesh>
    <group position={[0,1.11,0.11]} scale={0.78}><Sign text="OFFICIAL OTCA · OFFICE" position={[0,0,0]} color="#ebd394"/></group>
    <mesh position={[0,0.84,0.11]}><boxGeometry args={[3.3,0.035,0.025]}/><meshStandardMaterial color="#d6ae51" emissive="#d6ae51" emissiveIntensity={night ? 0.8 : 0.1}/></mesh>
  </group>
}

function Outdoors({ night = false }: { night?: boolean }) {
  const lawn = useMemo(() => grass([12,10]), [])
  const sidewalk = useMemo(() => pavingStones([10,2]), [])
  const road = useMemo(() => asphalt([8,1]), [])
  return <group>
    <Surface position={[0,-0.14,0]} size={[52,40]} map={lawn}/>
    <Surface position={[0,-0.035,SIDEWALK_Z+0.5]} size={[34,3.6]} map={sidewalk}/>
    <Surface position={[-12.4,-0.03,0]} size={[4,11]} map={sidewalk}/>
    <Surface position={[0,-0.04,11]} size={[52,4.5]} map={road}/>
    {[[-15,-7],[13,-7],[-16,3],[14,5],[-8,-8],[7,-8]].map(([x,z],i) => <Tree key={i} position={[x,0,z]} size={1.1}/>)}
    <StreetLamp position={[-8,0,8.5]} night={night}/><StreetLamp position={[6,0,8.5]} night={night}/>
    <FlagPole position={[9,0,6.2]}/>
    <OfficeEntranceSign night={night}/>
  </group>
}

export function BuildingScene({ layout, library, floor, brands, night, overview = false, onAgentSelect, onRoomInteract, onFloorSelect, onVendor }: { layout: BuildingLayout; library: FurnitureLibrary; floor: number; brands?: OfficeBrand[]; night?: boolean; onAgentSelect?: (id: string) => void; overview?: boolean; onRoomInteract?: (room: ActivityRoom) => void; onFloorSelect?: (floor: number) => void; onVendor?: (key: 'bakso' | 'kopi') => void }) {
  return <group>
    <Outdoors night={night}/>
    {layout.floors.filter((item) => overview || item.index <= floor).map((item) => <group key={item.index} onClick={overview ? (event) => { event.stopPropagation(); onFloorSelect?.(item.index) } : undefined}>
      <Shell floor={item} open={overview || item.index === floor}/>
      {overview ? <group>{item.brand && <BrandSign floor={item}/>}<Box position={[0,item.y+0.03,0]} size={[19,0.02,10]} color={item.brand?.color ?? '#a4b6a4'} opacity={0.15}/></group> : item.index === floor && <FloorInterior onVendor={onVendor} floor={item} library={library} brands={brands} onAgentSelect={onAgentSelect} onRoomInteract={onRoomInteract}/>}
    </group>)}
  </group>
}

function Vendor({kind,position}: {kind:string;position:Vec3}) {
 const parts={body:useRef<THREE.Group>(null),leftLeg:useRef<THREE.Mesh>(null),rightLeg:useRef<THREE.Mesh>(null),leftArm:useRef<THREE.Mesh>(null),rightArm:useRef<THREE.Mesh>(null)}
 useFrame(({clock})=>{if(parts.rightArm.current)parts.rightArm.current.rotation.x=-0.7+Math.sin(clock.elapsedTime*1.8)*0.25})
 return <group position={position} rotation={[0,Math.PI/2,0]}><AvatarBody parts={parts} colors={agentLook('vendor-'+kind)}/><RBox position={[0,1.05,0.18]} size={[0.4,0.5,0.035]} color={kind==='bakso'?'#f0e3cd':'#6d4937'}/></group>
}
