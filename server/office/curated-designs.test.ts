import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect,it } from 'vitest'
import { curatedDesign } from './curated-designs.js'
it('selects explicit curated references instead of future-dated legacy examples and fails closed if missing',()=>{
 const root=mkdtempSync(join(tmpdir(),'curated-design-'))
 try{
  mkdirSync(join(root,'specs/2099-01-01/otca'),{recursive:true})
  writeFileSync(join(root,'specs/2099-01-01/otca/old.json'),JSON.stringify({brand:'otca',slug:'old',slides:[{},{},{}]}))
  expect(()=>curatedDesign(root,'otca')).toThrow(/kurasi/)
  mkdirSync(join(root,'specs/khusus/otca'),{recursive:true})
  const path=join(root,'specs/khusus/otca/jalur-sesuai-profil-anak.json')
  writeFileSync(path,JSON.stringify({brand:'otca',slug:'curated',slides:[{},{},{}]}))
  const first=curatedDesign(root,'otca')
  expect(first.spec.slug).toBe('curated')
  expect(first.provenance.referenceTracked).toBe(false)
  writeFileSync(path,JSON.stringify({brand:'otca',slug:'curated-v2',slides:[{},{},{}]}))
  expect(curatedDesign(root,'otca').provenance.referenceSha256).not.toBe(first.provenance.referenceSha256)
  expect(()=>curatedDesign(root,'info-jerman')).toThrow()
 }finally{rmSync(root,{recursive:true,force:true})}
})
