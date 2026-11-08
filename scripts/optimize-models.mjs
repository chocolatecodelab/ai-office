#!/usr/bin/env node
// Builds the 3D office models (docs/PLAN-KANTOR-3D.md §7): reads the raw CC0 packs in aset-sumber/
// and writes small, Draco-compressed GLBs to public/models/. Licences are recorded in docs/aset-3d.md.
//
//   furniture.glb        the Kenney Furniture Kit pieces the office uses, one root node per piece
//
// The avatars stay the procedural Ruang characters (src/scene3d/character.tsx): the rigged Quaternius
// base characters were tried in K0 and dropped as too odd for the office.
//
// Usage: node scripts/optimize-models.mjs   (prints each output size and fails if over budget)
//
// Textures are re-encoded by scripts/lib/webp.mjs in a separate process: inside this process, after
// gltf-transform has run, sharp/libvips fails on the same files ("colourspace: parameter space not
// set") that it converts fine on its own.
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions'
import { dedup, draco, mergeDocuments, prune, unpartition, weld } from '@gltf-transform/functions'
import { spawnSync } from 'node:child_process'

const root = join(import.meta.dirname, '..')
const src = join(root, 'aset-sumber')
const out = join(root, 'public', 'models')
mkdirSync(out, { recursive: true })

// Pieces of the Kenney Furniture Kit the office uses (aset-sumber/kenney_furniture-kit/Models/GLTF format).
export const FURNITURE = [
  'desk', 'deskCorner', 'chairDesk', 'computerScreen', 'computerKeyboard', 'computerMouse', 'laptop',
  'bookcaseOpen', 'bookcaseClosedWide', 'books', 'pottedPlant', 'plantSmall1', 'plantSmall2', 'trashcan', 'coatRackStanding',
  'loungeSofa', 'loungeSofaLong', 'loungeChair', 'loungeDesignChair', 'tableCoffee', 'tableCoffeeGlass', 'rugRectangle', 'rugRound',
  'table', 'tableGlass', 'chair', 'chairModernCushion', 'televisionModern', 'cabinetTelevision', 'speaker',
  'kitchenBar', 'kitchenCabinet', 'kitchenCoffeeMachine', 'kitchenFridge', 'kitchenMicrowave', 'kitchenSink', 'stoolBar',
  'lampSquareFloor', 'lampRoundTable', 'lampSquareCeiling', 'ceilingFan', 'sideTable', 'cardboardBoxClosed',
  'stairs', 'doorway', 'wallWindow', 'wall',
]

// Size budgets in bytes (docs/PLAN-KANTOR-3D.md §7).
const BUDGET = { furniture: 3_000_000 }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

/** Shrinks every texture to at most `size` px and re-encodes it as WebP. */
async function compressTextures(document, size) {
  const textures = document.getRoot().listTextures()
  if (!textures.length) return
  document.createExtension(EXTTextureWebP).setRequired(true)
  for (const texture of textures) {
    const image = texture.getImage()
    if (!image) continue
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'lib', 'webp.mjs'), String(size)], { input: Buffer.from(image), maxBuffer: 64 * 1024 * 1024 })
    if (result.status !== 0) throw new Error(`Tekstur ${texture.getURI() || texture.getName()}: ${result.stderr.toString().trim().split(/\r?\n/).pop()}`)
    texture.setImage(new Uint8Array(result.stdout))
    texture.setMimeType('image/webp')
    texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, '.webp'))
  }
}

async function furniture() {
  const dir = join(src, 'kenney_furniture-kit', 'Models', 'GLTF format')
  // Each piece hangs under one root node named after it, so the scene can find it by name.
  const wrap = (document, name) => {
    const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]
    const node = document.createNode(name)
    for (const child of scene.listChildren()) { scene.removeChild(child); node.addChild(child) }
    scene.addChild(node)
    return scene
  }
  const target = await io.read(join(dir, `${FURNITURE[0]}.glb`))
  const scene = wrap(target, FURNITURE[0])
  for (const name of FURNITURE.slice(1)) {
    const piece = await io.read(join(dir, `${name}.glb`))
    const pieceScene = wrap(piece, name)
    const merged = mergeDocuments(target, piece).get(pieceScene)
    for (const child of merged.listChildren()) { merged.removeChild(child); scene.addChild(child) }
    merged.dispose()
  }
  return { document: target, name: 'furniture.glb', budget: BUDGET.furniture, textureSize: 512 }
}

const builds = [await furniture()]
for (const build of builds) if (build.textureSize) await compressTextures(build.document, build.textureSize)

const draco3d = (await import('draco3dgltf')).default
io.registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule(), 'draco3d.decoder': await draco3d.createDecoderModule() })
let overBudget = false
for (const { document, name, budget } of builds) {
  await document.transform(dedup(), weld(), prune(), draco({ method: 'edgebreaker' }), unpartition())
  const path = join(out, name)
  await io.write(path, document)
  const size = statSync(path).size
  overBudget ||= size > budget
  console.log(`${size > budget ? '✗' : '✓'} ${name.padEnd(24)} ${(size / 1024).toFixed(0).padStart(6)} KB  (batas ${(budget / 1024).toFixed(0)} KB)`)
}
if (overBudget) { console.error('Ada model yang melewati batas ukuran.'); process.exit(1) }
