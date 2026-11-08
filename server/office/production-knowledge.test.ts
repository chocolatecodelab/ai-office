import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect,it } from 'vitest'
import { contentKnowledge } from './production-knowledge.js'
it('isolates brands, excludes unsafe product claims, and versions all available sources',()=>{
 const root=mkdtempSync(join(tmpdir(),'office-knowledge-'))
 try{
  for(const brand of ['otca','info-jerman'])mkdirSync(join(root,'knowledge/brands',brand),{recursive:true})
  mkdirSync(join(root,'config/brands'),{recursive:true});mkdirSync(join(root,'knowledge/shared'),{recursive:true})
  writeFileSync(join(root,'knowledge/brands/otca/profile.md'),'OTCA rules')
  const patterns='## Aturan visual wajib\n'+('Aturan visual panjang tetap wajib.\n'.repeat(400))
  writeFileSync(join(root,'knowledge/brands/otca/patterns.md'),patterns)
  writeFileSync(join(root,'config/brands/otca.json'),'{}')
  for(const file of ['copywriting.md','rubric.md'])writeFileSync(join(root,'knowledge/shared',file),'Panduan wajib')
  writeFileSync(join(root,'knowledge/brands/info-jerman/profile.md'),'FOREIGN_SECRET')
  const products=join(root,'knowledge/brands/otca/products.json')
  writeFileSync(products,JSON.stringify({items:[{id:'a',status:'terkonfirmasi',harga:'SAFE_PRICE'},{id:'b',status:'perlu_konfirmasi',harga:'UNSAFE_PRICE'},{id:'c',status:'terkonfirmasi',berlaku_sampai:'2020-01-01',harga:'EXPIRED_PRICE'}]}))
  const a=contentKnowledge(root,'otca','harga')
  expect(a.text).toContain(patterns);expect(a.omitted).not.toContain('knowledge/brands/otca/patterns.md')
  expect(()=>contentKnowledge(root,'info-jerman','')).toThrow(/Aturan wajib/)
  expect(a.text).toContain('SAFE_PRICE');expect(a.text).not.toContain('UNSAFE_PRICE');expect(a.text).not.toContain('EXPIRED_PRICE');expect(a.text).not.toContain('FOREIGN_SECRET')
  writeFileSync(join(root,'knowledge/brands/otca/questions.md'),'Pertanyaan baru')
  expect(contentKnowledge(root,'otca','harga').version).not.toBe(a.version)
  expect(()=>contentKnowledge(root,'../info-jerman','')).toThrow()
 }finally{rmSync(root,{recursive:true,force:true})}
})
