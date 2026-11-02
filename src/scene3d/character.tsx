import type { ThreeEvent } from '@react-three/fiber'
import type { RefObject } from 'react'
import * as THREE from 'three'
import type { AgentLook } from '../agents.ts'
import { RBox } from './props.tsx'

// The blocky Ruang avatar: body parts only. The scene that owns it animates the limbs through the refs
// (legs and arms pivot at hip and shoulder), so the office and the K0 test bench share one look.

export interface AvatarParts {
  body: RefObject<THREE.Group | null>
  leftLeg: RefObject<THREE.Mesh | null>
  rightLeg: RefObject<THREE.Mesh | null>
  leftArm: RefObject<THREE.Mesh | null>
  rightArm: RefObject<THREE.Mesh | null>
}

// Legs and arms pivot at the hip / shoulder: translate the geometry so its top sits at the origin.
const legGeometry = new THREE.BoxGeometry(0.17, 0.62, 0.2).translate(0, -0.31, 0)
const armGeometry = new THREE.BoxGeometry(0.12, 0.52, 0.14).translate(0, -0.26, 0)

export function AvatarBody({ parts, colors, tint = (color) => color, onClick, onPointerOver, onPointerOut, children }: {
  parts: AvatarParts
  colors: AgentLook
  tint?: (color: string) => string
  onClick?: (event: ThreeEvent<MouseEvent>) => void
  onPointerOver?: () => void
  onPointerOut?: () => void
  children?: React.ReactNode
}) {
  return <group ref={parts.body} onClick={onClick} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
    <mesh ref={parts.leftLeg} position={[-0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
    <mesh ref={parts.rightLeg} position={[0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
    <RBox position={[0, 0.98, 0]} size={[0.48, 0.58, 0.3]} radius={0.07} color={tint(colors.shirt)} roughness={0.85}/>
    <mesh ref={parts.leftArm} position={[-0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
    <mesh ref={parts.rightArm} position={[0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
    <RBox position={[0, 1.5, 0]} size={[0.4, 0.4, 0.37]} radius={0.08} color={tint(colors.skin)} roughness={0.7}/>
    <RBox position={[0, 1.72, -0.02]} size={[0.43, 0.13, 0.41]} radius={0.05} color={tint(colors.hair)} roughness={0.9}/>
    <RBox position={[0, 1.58, -0.19]} size={[0.43, 0.3, 0.06]} radius={0.03} color={tint(colors.hair)} roughness={0.9}/>
    <RBox position={[-0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
    <RBox position={[0.09, 1.52, 0.186]} size={[0.06, 0.07, 0.01]} radius={0.004} color="#17201e" shadow={false}/>
    <RBox position={[0, 1.4, 0.186]} size={[0.12, 0.025, 0.01]} radius={0.004} color="#9a5a44" shadow={false}/>
    {children}
  </group>
}
