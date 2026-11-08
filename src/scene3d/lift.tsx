import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CORE, FLOOR_HEIGHT, LIFT } from '../office3d/building.ts'

export function Lift({ floor, traffic, onClick }: { floor: number; traffic: Map<string, THREE.Vector3>; onClick?: () => void }) {
  const doors = useRef<THREE.Group>(null)
  const light = useRef<THREE.Mesh>(null)
  const opening = useRef(0)
  const called = useRef(0)
  useFrame((_,delta) => {
    called.current = Math.max(0,called.current-delta)
    const nearby = [...traffic.values()].some(p => Math.abs(p.y-floor*FLOOR_HEIGHT)<0.25 && p.x>5.7 && Math.abs(p.z-LIFT.z)<0.9)
    opening.current = THREE.MathUtils.damp(opening.current,nearby || called.current>0 ? 1 : 0,5,delta)
    doors.current?.children.forEach((door,i) => { door.position.z = (i ? 1 : -1)*(0.3+opening.current*0.65) })
    if (light.current) (light.current.material as THREE.MeshStandardMaterial).color.set(nearby ? '#69e5a0' : '#e6c477')
  })
  return <group position={[CORE.minX,floor*FLOOR_HEIGHT,LIFT.z]} onClick={e => { e.stopPropagation(); called.current=5; onClick?.() }}>
    <mesh position={[1.7,0.03,0]} receiveShadow><boxGeometry args={[2.5,0.06,1.6]}/><meshStandardMaterial color="#39494c"/></mesh>
    <mesh position={[3.05,1.25,0]}><boxGeometry args={[0.06,2.5,1.8]}/><meshStandardMaterial color="#607a81" metalness={0.65} roughness={0.22}/></mesh>
    <mesh position={[1.7,2.5,0]}><boxGeometry args={[2.5,0.06,1.7]}/><meshStandardMaterial color="#e8efe7" emissive="#647969" emissiveIntensity={0.5}/></mesh>
    {[-0.75,0.75].map(z=><mesh key={z} position={[1.7,0.95,z]}><boxGeometry args={[2.4,0.04,0.04]}/><meshStandardMaterial color="#d4dddd" metalness={0.8} roughness={0.2}/></mesh>)}
    {[0,1,2,3,4].map(i=><mesh key={i} position={[-0.13,1.65-i*0.14,1.02]}><sphereGeometry args={[0.04,8,8]}/><meshStandardMaterial color={i===floor?'#8ff0bb':'#b3bdbe'}/></mesh>)}
    <group ref={doors}>{[0,1].map(i => <mesh key={i} position={[0.03,1.1,0]}><boxGeometry args={[0.07,2.2,0.58]}/><meshStandardMaterial color="#aabdc0" metalness={0.65} roughness={0.3}/></mesh>)}</group>
    <mesh ref={light} position={[-0.12,1.2,0.95]}><boxGeometry args={[0.1,0.25,0.15]}/><meshStandardMaterial color="#e6c477" emissive="#284334"/></mesh>
  </group>
}
