import { PINGPONG, TREADMILLS } from '../office3d/equipment.ts'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ROOM_ACTIVITIES, type ActivityRoom, type RoomControls } from '../office3d/activities.ts'
import type { Zone } from '../office3d/building.ts'

const BOARDS: Record<ActivityRoom, [number,number,number]> = {
  pingpong: [-7.8,1.75,-5.15], cafe: [-2,1.75,-5.15], gym: [3.1,1.75,-5.15],
  game: [3.2,1.75,1.55], rest: [-2.8,1.75,1.55], lounge: [-7.8,1.25,1.55],
}

/** A small canvas display per room; at most one texture upload per second. */
function RoomDisplay({ room, controls, occupied }: { room: ActivityRoom; controls: RoomControls; occupied: boolean }) {
  const setup = ROOM_ACTIVITIES.find((item) => item.id === room)!
  const state = controls[room]
  const last = useRef('')
  const elapsed = useRef(0)
  const { map, ctx } = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160
    const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace
    return { map, ctx: canvas.getContext('2d')! }
  }, [])
  useEffect(() => () => map.dispose(), [map])
  useFrame((_,delta) => {
    const active = state.enabled && occupied
    if (active) elapsed.current += Math.min(delta,0.1)
    const tick = Math.floor(elapsed.current)
    const key = `${active}/${state.mode}/${tick}`
    if (last.current === key) return
    last.current = key
    ctx.fillStyle = '#101e25'; ctx.fillRect(0,0,512,160)
    ctx.textAlign = 'center'; ctx.font = 'bold 25px sans-serif'; ctx.fillStyle = '#a4e7ca'
    ctx.fillText(setup.name.toUpperCase(),256,38)
    ctx.font = '22px sans-serif'; ctx.fillStyle = '#ffffff'
    ctx.fillText(!state.enabled ? 'DIJEDA' : !occupied ? 'Siap digunakan' : setup.modes[state.mode % setup.modes.length],256,80)
    const detail = room === 'pingpong' ? `Rally ${Math.floor(tick/3)}` : room === 'gym' ? `${state.mode ? '6.5' : '3.0'} km/jam · ${tick}s` : room === 'cafe' ? `Seduh ${tick % 12}/12` : room === 'game' ? `Skor ${tick*25}` : room === 'rest' ? (tick%8 < 4 ? 'Tarik napas' : 'Hembuskan') : `Sesi ${Math.floor(tick/60)}:${String(tick%60).padStart(2,'0')}`
    ctx.fillStyle = '#e5c788'; ctx.font = '23px monospace'; ctx.fillText(active ? detail : 'Klik aset untuk mulai / jeda',256,126)
    map.needsUpdate = true
  })
  return <mesh position={BOARDS[room]}><planeGeometry args={[2.4,0.75]}/><meshBasicMaterial map={map} toneMapped={false}/></mesh>
}

export function RoomEffects({ controls, occupied, zones, onInteract }: { controls: RoomControls; occupied: Set<ActivityRoom>; zones: Zone[]; onInteract?: (room: ActivityRoom) => void }) {
  const ball = useRef<THREE.Mesh>(null)
  const belts = useRef<THREE.Group>(null)
  const steam = useRef<THREE.Group>(null)
  const neon = useRef<THREE.Mesh>(null)
  const breath = useRef<THREE.Mesh>(null)
  const screen = useRef<THREE.Mesh>(null)
  const arcade = useRef<THREE.Group>(null)
  const clocks = useRef<Record<ActivityRoom,number>>({ pingpong:0,cafe:0,gym:0,game:0,rest:0,lounge:0 })
  useFrame((_,delta) => {
    for (const room of ROOM_ACTIVITIES) if (controls[room.id].enabled && occupied.has(room.id)) clocks.current[room.id] += Math.min(delta,0.05)
    const t = clocks.current
    if (ball.current) {
      ball.current.visible = true
      if (!occupied.has('pingpong') || !controls.pingpong.enabled) { ball.current.position.set(PINGPONG.x+0.5,0.83,PINGPONG.z); } else
      ball.current.position.set(PINGPONG.x+Math.sin(t.pingpong*(controls.pingpong.mode ? 5 : 3))*1.55, 0.83+Math.abs(Math.sin(t.pingpong*(controls.pingpong.mode ? 10 : 6)))*0.5, PINGPONG.z+Math.sin(t.pingpong)*0.15)
    }
    belts.current?.children.forEach((stripe,i) => { stripe.position.z = -4.1 + ((t.gym*(controls.gym.mode ? 1.8 : 0.8)+i*0.22)%1.2) })
    steam.current?.children.forEach((particle,i) => { particle.position.y = 1.4+((t.cafe*0.22+i*0.15)%0.6); particle.position.x = -3.5+Math.sin(t.cafe+i)*0.06 })
    if (neon.current) (neon.current.material as THREE.MeshBasicMaterial).color.set(controls.game.mode ? '#d165ff' : '#4dcbb4').multiplyScalar(0.7+Math.sin(t.game*3)*0.2)
    if (breath.current) breath.current.scale.setScalar(1+Math.sin(t.rest*(controls.rest.mode ? 0.8 : 0.3))*0.15)
    if (screen.current) (screen.current.material as THREE.MeshBasicMaterial).color.set(controls.lounge.mode ? '#5274b8' : '#4e776b').multiplyScalar(0.85+Math.sin(t.lounge)*0.1)
    arcade.current?.children.forEach((pixel,i) => { pixel.position.x = [1.9,3.2][i]+Math.sin(t.game*(controls.game.mode ? 4 : 2)+i)*0.19; pixel.position.y = 1.35+Math.cos(t.game*3+i)*0.14 })
  })
  return <group onClick={(event) => {
    const room = zones.find((zone) => event.point.x >= zone.minX && event.point.x <= zone.maxX && event.point.z >= zone.minZ && event.point.z <= zone.maxZ)
    if (room) { event.stopPropagation(); onInteract?.(room.key as ActivityRoom) }
  }}>
    {/* Room-specific fixtures reuse simple meshes and emissive materials, without extra shadow lights. */}
    {[-3.6,-1.8].map((x) => <group key={x} position={[x,0,-3.8]}>
      <mesh position={[0,2.55,0]}><cylinderGeometry args={[0.014,0.014,0.65,6]}/><meshStandardMaterial color="#383b37"/></mesh>
      <mesh position={[0,2.15,0]}><coneGeometry args={[0.25,0.28,12,1,true]}/><meshStandardMaterial color="#b9915b" side={THREE.DoubleSide}/></mesh>
      <mesh position={[0,2.02,0]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[0.18,12]}/><meshBasicMaterial color="#ffe3a6"/></mesh>
    </group>)}
    <mesh position={[3.1,1.15,-5.22]}><boxGeometry args={[3.8,1.25,0.025]}/><meshStandardMaterial color="#a6bfc5" metalness={0.85} roughness={0.15}/></mesh>
    {[1.25,5].map((x) => <mesh key={x} position={[x,1.35,-5.15]}><boxGeometry args={[0.035,1.8,0.04]}/><meshBasicMaterial color="#84dbcb"/></mesh>)}
    {[1.5,4.8].map((x) => <mesh key={x} position={[x,1.5,5.12]}><boxGeometry args={[0.03,2.25,0.04]}/><meshBasicMaterial color="#ad7ce8"/></mesh>)}
    <mesh position={[-2.8,0.045,3.5]} rotation={[-Math.PI/2,0,0]}><circleGeometry args={[1.25,32]}/><meshStandardMaterial color="#9894ac" roughness={1}/></mesh>
    {ROOM_ACTIVITIES.map((room) => <RoomDisplay key={room.id} room={room.id} controls={controls} occupied={occupied.has(room.id)}/>)}
    <mesh ref={ball}><sphereGeometry args={[0.07,10,8]}/><meshStandardMaterial color="#ffffff"/></mesh>
    <group ref={belts}>{TREADMILLS.xs.flatMap((x) => Array.from({length:6},(_,i) => <mesh key={`${x}-${i}`} position={[x,0.285,0]}><boxGeometry args={[0.6,0.008,0.025]}/><meshStandardMaterial color="#5b7479"/></mesh>))}</group>
    <group ref={steam}>{[0,1,2].map((i) => <mesh key={i} position={[-3.5,1.5,-4.9]}><sphereGeometry args={[0.055,8,6]}/><meshBasicMaterial color="#f0e8d6" transparent opacity={0.3} depthWrite={false}/></mesh>)}</group>
    <mesh ref={neon} position={[3,0.06,3.8]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[1.15,1.2,32]}/><meshBasicMaterial color="#4dcbb4" transparent opacity={0.8}/></mesh>
    <mesh ref={breath} position={[-2.8,0.06,3.5]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[0.9,0.95,32]}/><meshBasicMaterial color="#b9c8e7" transparent opacity={0.6}/></mesh>
    <mesh ref={screen} position={[-7.8,1.25,1.48]}><boxGeometry args={[1.9,0.95,0.07]}/><meshBasicMaterial color="#4e776b"/></mesh>
    <group ref={arcade}>{[1.9,3.2].map((x) => <mesh key={x} position={[x,1.35,4.67]}><sphereGeometry args={[0.025,8,6]}/><meshBasicMaterial color="#ffffff"/></mesh>)}</group>
  </group>
}
