import type { ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, type RefObject } from 'react'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import * as THREE from 'three'
import type { AgentLook } from '../agents.ts'


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
  const shirt=tint(colors.shirt),skin=tint(colors.skin),hair=tint(colors.hair)
  // Merge rigid body/face pieces into one vertex-coloured draw, keeping animated limbs separate.
  const rigid=useMemo(()=>{
    const pieces: Array<{size:[number,number,number];position:[number,number,number];radius:number;color:string}>=[
      {size:[0.48,0.58,0.3],position:[0,0.98,0],radius:0.07,color:shirt},
      {size:[0.4,0.4,0.37],position:[0,1.5,0],radius:0.08,color:skin},
      {size:[0.43,0.13,0.41],position:[0,1.72,-0.02],radius:0.05,color:hair},
      {size:[0.43,0.3,0.06],position:[0,1.58,-0.19],radius:0.03,color:hair},
      ...[-0.09,0.09].map(x=>({size:[0.06,0.07,0.01] as [number,number,number],position:[x,1.52,0.186] as [number,number,number],radius:0.004,color:'#17201e'})),
      {size:[0.12,0.025,0.01],position:[0,1.4,0.186],radius:0.004,color:'#9a5a44'},
    ]
    const geometries=pieces.map(piece=>{
      const geometry=new RoundedBoxGeometry(...piece.size,2,Math.min(piece.radius,...piece.size.map(v=>v/2-0.001)))
      geometry.translate(...piece.position)
      const color=new THREE.Color(piece.color),data=new Float32Array(geometry.attributes.position.count*3)
      for(let i=0;i<data.length;i+=3){data[i]=color.r;data[i+1]=color.g;data[i+2]=color.b}
      geometry.setAttribute('color',new THREE.BufferAttribute(data,3))
      return geometry
    })
    const merged=mergeGeometries(geometries,false)
    geometries.forEach(g=>g.dispose())
    return merged
  },[shirt,skin,hair])
  useEffect(()=>()=>rigid.dispose(),[rigid])
  return <group ref={parts.body} onClick={onClick} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
    <mesh ref={parts.leftLeg} position={[-0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
    <mesh ref={parts.rightLeg} position={[0.11, 0.66, 0]} castShadow geometry={legGeometry}><meshStandardMaterial color={tint(colors.pants)} roughness={0.8}/></mesh>
    <mesh ref={parts.leftArm} position={[-0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
    <mesh ref={parts.rightArm} position={[0.31, 1.2, 0]} castShadow geometry={armGeometry}><meshStandardMaterial color={tint(colors.shirt)} roughness={0.85}/></mesh>
    <mesh geometry={rigid} castShadow receiveShadow><meshStandardMaterial vertexColors roughness={0.85}/></mesh>
    {children}
  </group>
}
