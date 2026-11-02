import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// The Kenney furniture (public/models/furniture.glb, docs/aset-3d.md), loaded once with the
// self-hosted Draco decoder. Kenney models a piece from one corner and at half the avatar scale,
// so every copy handed out is scaled and re-centred: its footprint is centred on the origin and it
// stands on y = 0. Positions in the layout are therefore the centre of the piece on the floor.

/** Kenney's pieces are modelled about half the size of the avatars. */
export const FURNITURE_SCALE = 2

export interface FurnitureLibrary {
  /** A fresh copy of one piece, centred and scaled; throws for a name the GLB does not have. */
  piece(name: string): THREE.Object3D
  /** Size of a piece in metres (after scaling), for layout and tests. */
  size(name: string): THREE.Vector3
}

let loading: Promise<FurnitureLibrary> | undefined

export function loadFurniture(url = '/models/furniture.glb'): Promise<FurnitureLibrary> {
  loading ??= (async () => {
    const draco = new DRACOLoader().setDecoderPath('/draco/').setDecoderConfig({ type: 'wasm' })
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url)
    draco.dispose()
    const prepared = new Map<string, { object: THREE.Object3D; size: THREE.Vector3 }>()
    const prepare = (name: string) => {
      const cached = prepared.get(name)
      if (cached) return cached
      const source = gltf.scene.getObjectByName(name)
      if (!source) throw new Error(`Furnitur "${name}" tidak ada di furniture.glb`)
      const inner = source.clone(true)
      inner.position.set(0, 0, 0)
      inner.scale.setScalar(FURNITURE_SCALE)
      inner.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(inner)
      const center = box.getCenter(new THREE.Vector3())
      inner.position.set(-center.x, -box.min.y, -center.z)
      inner.traverse((child) => { if ((child as THREE.Mesh).isMesh) { child.castShadow = true; child.receiveShadow = true } })
      const object = new THREE.Group().add(inner)
      object.name = name
      const entry = { object, size: box.getSize(new THREE.Vector3()) }
      prepared.set(name, entry)
      return entry
    }
    return { piece: (name) => prepare(name).object.clone(true), size: (name) => prepare(name).size.clone() }
  })()
  return loading
}

export function useFurniture(): { library?: FurnitureLibrary; error?: string } {
  const [state, setState] = useState<{ library?: FurnitureLibrary; error?: string }>({})
  useEffect(() => {
    let live = true
    loadFurniture().then((library) => { if (live) setState({ library }) })
      .catch((error: unknown) => { if (live) setState({ error: error instanceof Error ? error.message : String(error) }) })
    return () => { live = false }
  }, [])
  return state
}
