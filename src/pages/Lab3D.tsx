import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { agentLook } from '../agents.ts'
import { createBuilding, FLOOR_HEIGHT, floorAt, route, seatFor, type BrandInput, type BuildingLayout, type Spot } from '../office3d/building.ts'
import { BuildingScene } from '../scene3d/building.tsx'
import { AvatarBody, type AvatarParts } from '../scene3d/character.tsx'
import { useFurniture } from '../scene3d/furniture.ts'

// Test bench for the 3D office (docs/PLAN-KANTOR-3D.md K0–K1): the building from its layout with the
// Kenney furniture and the Ruang avatars, one floor at a time, plus an agent walking from its desk on
// lantai 1 to the pantry on the ground floor and back, by lift. Not the office page itself.

// The crews of context/brands/*/agents.json; the office proper reads them from /api/office/brands (K2).
const BRANDS: BrandInput[] = [
  { id: 'otca', name: 'Official OTCA', color: '#CB9D31', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager', 'digital-marketing', 'event-specialist'] },
  { id: 'infojerman', name: 'Info Jerman', color: '#F3CF45', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'ciaomanda', name: 'Ciao Manda', color: '#D40000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
  { id: 'jepangkoey', name: 'Jepang Koey', color: '#000000', agents: ['manager', 'content-creator', 'video-editor', 'social-media-manager'] },
]

type Pose = 'kerja' | 'tidur' | 'jalan' | 'idle'

function useParts(): AvatarParts {
  return { body: useRef(null), leftLeg: useRef(null), rightLeg: useRef(null), leftArm: useRef(null), rightArm: useRef(null) }
}

function animate(parts: AvatarParts, pose: Pose, time: number) {
  const seated = pose === 'kerja' || pose === 'tidur'
  const swing = pose === 'jalan' ? Math.sin(time * 10) * 0.6 : 0
  if (parts.leftLeg.current) parts.leftLeg.current.rotation.x = seated ? -Math.PI / 2.2 : swing
  if (parts.rightLeg.current) parts.rightLeg.current.rotation.x = seated ? -Math.PI / 2.2 : -swing
  if (parts.leftArm.current) parts.leftArm.current.rotation.x = pose === 'kerja' ? -1.1 + Math.sin(time * 14) * 0.12 : pose === 'tidur' ? -1.35 : -swing
  if (parts.rightArm.current) parts.rightArm.current.rotation.x = pose === 'kerja' ? -1.1 + Math.cos(time * 14) * 0.12 : pose === 'tidur' ? -1.35 : swing
  if (parts.body.current) {
    // Asleep at the desk: the upper body leans forward onto the folded arms.
    parts.body.current.rotation.x = pose === 'tidur' ? 0.45 + Math.sin(time * 1.2) * 0.02 : 0
    parts.body.current.position.y = seated ? -0.14 : 0
  }
}

function SeatedAvatar({ id, seat, pose }: { id: string; seat: Spot; pose: Pose }) {
  const parts = useParts()
  useFrame((state) => animate(parts, pose, state.clock.elapsedTime))
  return <group position={seat.position} rotation={[0, seat.facing, 0]}><AvatarBody parts={parts} colors={agentLook(id)}/></group>
}

/** Walks the layout's route between two spots, back and forth, and is drawn only on the floor in view. */
function Walker({ id, layout, from, to, floor }: { id: string; layout: BuildingLayout; from: Spot; to: Spot; floor: number }) {
  const root = useRef<THREE.Group>(null)
  const parts = useParts()
  const legs = useMemo(() => [route(layout, from, to), route(layout, to, from)], [layout, from, to])
  const state = useRef({ leg: 0, index: 0, pause: 0, position: new THREE.Vector3(...from.position) })
  useFrame((frame, delta) => {
    const walker = state.current
    const group = root.current
    if (!group) return
    const target = legs[walker.leg][walker.index]
    let moving = false
    if (walker.pause > 0) {
      walker.pause -= delta
    } else if (target) {
      const next = new THREE.Vector3(...target)
      const toNext = next.clone().sub(walker.position)
      const distance = toNext.length()
      // The lift is quicker than walking.
      const speed = Math.abs(toNext.y) > 0.01 ? 3.4 : 1.6
      if (distance < 0.03) {
        walker.index += 1
        if (walker.index >= legs[walker.leg].length) { walker.leg = 1 - walker.leg; walker.index = 0; walker.pause = 3 }
      } else {
        moving = Math.abs(toNext.y) < 0.01
        walker.position.add(toNext.normalize().multiplyScalar(Math.min(distance, delta * speed)))
        if (moving) group.rotation.y = Math.atan2(toNext.x, toNext.z)
      }
    }
    group.position.copy(walker.position)
    if (!moving && walker.pause > 0) group.rotation.y = (walker.leg === 1 ? to : from).facing
    group.visible = floorAt(walker.position.y) === floor
    animate(parts, moving ? 'jalan' : 'idle', frame.clock.elapsedTime)
  })
  return <group ref={root}><AvatarBody parts={parts} colors={agentLook(id)}/></group>
}

function FrameRate({ output }: { output: React.RefObject<HTMLSpanElement | null> }) {
  const frames = useRef(0)
  const since = useRef(performance.now())
  const { gl } = useThree()
  useFrame(() => {
    frames.current += 1
    const now = performance.now()
    if (now - since.current < 500) return
    if (output.current) output.current.textContent = `${((frames.current * 1000) / (now - since.current)).toFixed(0)} fps · ${gl.info.render.calls} draw calls · ${(gl.info.render.triangles / 1000).toFixed(0)}k segitiga`
    frames.current = 0
    since.current = now
  })
  return null
}

/** Orbit camera that glides to the floor in view. */
function Camera({ floor }: { floor: number }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    controls.maxPolarAngle = Math.PI / 2.15
    camera.position.set(0, 14, 17)
    return () => controls.dispose()
  }, [camera, controls])
  const goal = useRef(new THREE.Vector3())
  useFrame(() => {
    goal.current.set(-1, floor * FLOOR_HEIGHT + 0.8, 0)
    const step = goal.current.clone().sub(controls.target).multiplyScalar(0.08)
    controls.target.add(step)
    camera.position.add(step)
    controls.update()
  })
  return null
}

export default function Lab3D() {
  const { library, error } = useFurniture()
  const layout = useMemo(() => createBuilding(BRANDS), [])
  const [floor, setFloor] = useState(1)
  const stats = useRef<HTMLSpanElement>(null)
  const walkFrom = seatFor(layout, 'otca', 'event-specialist')!
  const walkTo = layout.idleSpots.find((spot) => spot.key === 'pantry-1')!

  if (error) return <section className="notice" role="alert"><strong>Gagal memuat furnitur.</strong> {error}</section>
  if (!library) return <section className="empty-state" aria-busy="true"><h2>Memuat furnitur…</h2><p>furniture.glb dan decoder Draco</p></section>
  const current = layout.floors[floor]

  return <div className="lab-3d">
    <div className="lab-3d-bar">
      <span><b>K1 · Lab 3D</b> · {current.brand ? `Lantai ${floor} · ${current.brand.name} · ${current.desks.length} meja` : 'Lantai dasar · area bersama'}</span>
      <span ref={stats}>…</span>
      <span className="chip-row lab-3d-floors" role="group" aria-label="Lantai">
        {[...layout.floors].reverse().map((item) => <button key={item.index} type="button" className={`chip chip-button${item.index === floor ? ' active' : ''}`} aria-pressed={item.index === floor} onClick={() => setFloor(item.index)}>
          {item.brand && <span className="brand-swatch" style={{ background: item.brand.color }}/>}{item.index === 0 ? 'G · Bersama' : `${item.index} · ${item.brand?.name}`}
        </button>)}
      </span>
    </div>
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 42, near: 0.5, far: 200 }}>
      <color attach="background" args={['#1c211d']}/>
      <hemisphereLight args={['#ffffff', '#445044', 1.1]}/>
      <directionalLight position={[8, 30, 12]} intensity={1.7} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-14} shadow-camera-right={14} shadow-camera-top={14} shadow-camera-bottom={-14}/>
      <BuildingScene layout={layout} library={library} floor={floor}/>
      {current.desks.map((desk, index) => <SeatedAvatar key={`${floor}-${desk.agentType}`} id={`${current.brand?.id}-${desk.agentType}`} seat={desk.seat} pose={index === 2 ? 'tidur' : 'kerja'}/>)}
      <Walker id="otca-event-specialist" layout={layout} from={walkFrom} to={walkTo} floor={floor}/>
      <FrameRate output={stats}/>
      <Camera floor={floor}/>
    </Canvas>
  </div>
}
