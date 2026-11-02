import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { agentLook } from '../agents.ts'
import { AvatarBody, type AvatarParts } from '../scene3d/character.tsx'

// K0 test bench (docs/PLAN-KANTOR-3D.md §9): the Kenney furniture GLB, loaded with the self-hosted
// Draco decoder, next to the blocky Ruang avatars in the poses the avatar statuses need. It measures
// load time and frame rate; it is not the office.

/** Kenney's pieces are modelled about half the size of the avatars. */
export const FURNITURE_SCALE = 2

interface Loaded { furniture: GLTF; ms: number; bytes: number }

async function loadFurniture(): Promise<Loaded> {
  const started = performance.now()
  const draco = new DRACOLoader().setDecoderPath('/draco/').setDecoderConfig({ type: 'wasm' })
  const furniture = await new GLTFLoader().setDRACOLoader(draco).loadAsync('/models/furniture.glb')
  const bytes = performance.getEntriesByType('resource')
    .filter((entry) => /\/models\/|\/draco\//.test(entry.name))
    .reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize || (entry as PerformanceResourceTiming).encodedBodySize || 0), 0)
  return { furniture, ms: performance.now() - started, bytes }
}

/** One furniture piece, cloned from its named root node in furniture.glb. */
function Piece({ gltf, name, position, rotation = 0 }: { gltf: GLTF; name: string; position: [number, number, number]; rotation?: number }) {
  const object = useMemo(() => {
    const source = gltf.scene.getObjectByName(name)
    if (!source) throw new Error(`Furnitur ${name} tidak ada di furniture.glb`)
    const copy = source.clone(true)
    copy.traverse((child) => { if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true } })
    return copy
  }, [gltf, name])
  return <primitive object={object} position={position} rotation={[0, rotation, 0]} scale={FURNITURE_SCALE}/>
}

type Pose = 'kerja' | 'tidur' | 'jalan' | 'idle'

/** A Ruang avatar animated by hand for one pose, like the office does per status. */
function Avatar({ id, pose, position, rotation = 0 }: { id: string; pose: Pose; position: [number, number, number]; rotation?: number }) {
  const root = useRef<THREE.Group>(null)
  const parts: AvatarParts = { body: useRef(null), leftLeg: useRef(null), rightLeg: useRef(null), leftArm: useRef(null), rightArm: useRef(null) }
  const angle = useRef(Math.random() * Math.PI * 2)
  useFrame((state, delta) => {
    const time = state.clock.elapsedTime
    const seated = pose === 'kerja' || pose === 'tidur'
    const swing = pose === 'jalan' ? Math.sin(time * 10) * 0.6 : 0
    const legs = seated ? -Math.PI / 2.2 : swing
    if (parts.leftLeg.current) parts.leftLeg.current.rotation.x = legs
    if (parts.rightLeg.current) parts.rightLeg.current.rotation.x = seated ? legs : -swing
    if (parts.leftArm.current && parts.rightArm.current) {
      parts.leftArm.current.rotation.x = pose === 'kerja' ? -1.1 + Math.sin(time * 14) * 0.12 : pose === 'tidur' ? -1.35 : -swing
      parts.rightArm.current.rotation.x = pose === 'kerja' ? -1.1 + Math.cos(time * 14) * 0.12 : pose === 'tidur' ? -1.35 : swing
    }
    if (parts.body.current) {
      // Asleep at the desk: the upper body leans forward onto the folded arms.
      parts.body.current.rotation.x = pose === 'tidur' ? 0.45 + Math.sin(time * 1.2) * 0.02 : 0
      parts.body.current.position.y = seated ? -0.14 : pose === 'idle' ? Math.sin(time * 2) * 0.015 : 0
    }
    if (pose === 'jalan' && root.current) {
      angle.current += delta * 0.4
      root.current.position.set(position[0] + Math.cos(angle.current) * 2.4, 0, position[2] + Math.sin(angle.current) * 2.4)
      root.current.rotation.y = -angle.current
    }
  })
  return <group ref={root} position={position} rotation={[0, rotation, 0]}><AvatarBody parts={parts} colors={agentLook(id)}/></group>
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

function Controls() {
  const { camera, gl } = useThree()
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement)
    controls.target.set(0, 0.8, 0)
    controls.update()
    return () => controls.dispose()
  }, [camera, gl])
  return null
}

const CREW = ['manager', 'event-specialist', 'content-creator', 'video-editor', 'social-media-manager', 'digital-marketing']

export default function Lab3D() {
  const [loaded, setLoaded] = useState<Loaded>()
  const [error, setError] = useState<string>()
  const [crowd, setCrowd] = useState(false)
  const stats = useRef<HTMLSpanElement>(null)

  useEffect(() => { loadFurniture().then(setLoaded).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))) }, [])

  if (error) return <section className="notice" role="alert"><strong>Gagal memuat model.</strong> {error}</section>
  if (!loaded) return <section className="empty-state" aria-busy="true"><h2>Memuat model…</h2><p>furnitur dan decoder Draco</p></section>
  const { furniture } = loaded
  const desk = (x: number, z: number) => <group position={[x, 0, z]}>
    <Piece gltf={furniture} name="desk" position={[0, 0, 0]}/>
    <Piece gltf={furniture} name="computerScreen" position={[0.5, 0.76, -0.2]}/>
    <Piece gltf={furniture} name="computerKeyboard" position={[0.5, 0.76, 0.24]}/>
    <Piece gltf={furniture} name="chairDesk" position={[0.5, 0, 1.1]} rotation={Math.PI}/>
  </group>

  return <div className="lab-3d">
    <div className="lab-3d-bar">
      <span><b>K0 · Lab 3D</b> · furnitur dimuat {loaded.ms.toFixed(0)} ms · {(loaded.bytes / 1024).toFixed(0)} KB · karakter Ruang</span>
      <span ref={stats}>…</span>
      <button type="button" className="chip chip-button" onClick={() => setCrowd(!crowd)}>{crowd ? 'Tampilkan 4 karakter' : 'Uji 18 karakter'}</button>
    </div>
    <Canvas shadows dpr={[1, 2]} camera={{ position: [5, 5, 7], fov: 45 }}>
      <color attach="background" args={['#1c211d']}/>
      <hemisphereLight args={['#ffffff', '#445044', 1.2]}/>
      <directionalLight position={[5, 8, 4]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]}/>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[24, 24]}/><meshStandardMaterial color="#d8cfbf"/></mesh>
      {desk(-2.5, 0)}
      {desk(1, 0)}
      <Piece gltf={furniture} name="loungeSofa" position={[-1, 0, -4]}/>
      <Piece gltf={furniture} name="pottedPlant" position={[4, 0, -3]}/>
      <Piece gltf={furniture} name="kitchenCoffeeMachine" position={[-5, 0, -3]}/>
      {!crowd && <>
        <Avatar id="event-specialist" pose="kerja" position={[-2, 0, 1.1]} rotation={Math.PI}/>
        <Avatar id="content-creator" pose="tidur" position={[1.5, 0, 1.1]} rotation={Math.PI}/>
        <Avatar id="video-editor" pose="jalan" position={[0, 0, 3]}/>
        <Avatar id="digital-marketing" pose="idle" position={[4, 0, 1]} rotation={-Math.PI / 2}/>
      </>}
      {crowd && Array.from({ length: 18 }, (_, index) => <Avatar key={index} id={`${CREW[index % CREW.length]}-${index}`}
        pose={(['kerja', 'tidur', 'jalan', 'idle'] as Pose[])[index % 4]} position={[(index % 6) * 1.5 - 3.8, 0, Math.floor(index / 6) * 1.8 + 2]}/>)}
      <FrameRate output={stats}/>
      <Controls/>
    </Canvas>
  </div>
}
