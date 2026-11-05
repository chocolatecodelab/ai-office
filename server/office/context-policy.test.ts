import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect,it } from 'vitest'
import { boundedHistory,selectOfficialContext } from './context-policy.js'
import { agentContextFiles } from '../otca-context.js'
import { cacheUsage } from './hermes-client.js'

it('keeps policy/role/approval/brand facts and selects optional references only when needed',()=>{
  const files=['/context/agents/manager.md','/context/_shared/aturan-umum.md','/context/_shared/approval-matrix.md','/context/_shared/batas-tanggung-jawab.md','/brand/brand.md','/context/_shared/raci.md','/brand/visual.json','/brand/checklist-publikasi.md'].map(path=>({path,content:'Mandatory '+path}))
  const greeting=selectOfficialContext(files,'manager','Halo!',true)
  expect(greeting.core).toHaveLength(5)
  expect(greeting.references).toHaveLength(0)
  expect(greeting.selectedChars).toBeLessThan(greeting.fullChars)
  expect(selectOfficialContext(files,'manager','Delegasikan konten carousel',true).references).toHaveLength(3)
  expect(selectOfficialContext(files,'manager','lanjutkan',true).references).toHaveLength(3)
})
it('bounds recent history and removes large inline file blocks',()=>{
  const turns=Array.from({length:20},(_,i)=>({id:String(i),brief:'Brief '.repeat(600),result:'Hasil '.repeat(3000),createdAt:'now'}))
  const result=boundedHistory(turns,12000)
  expect(result.characters).toBeLessThanOrEqual(12000)
  expect(result.turns.length).toBeLessThan(10)
  expect(boundedHistory([{...turns[0],result:'Jawaban\n~~~file:x.md\nRAHASIA_BLOK_BESAR\n~~~'}]).turns[0].result).not.toContain('RAHASIA_BLOK_BESAR')
})
it('invalidates file cache and context version after official edits without restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'context-cache-'))
  try{
    mkdirSync(join(dir,'agents'));mkdirSync(join(dir,'_shared'));writeFileSync(join(dir,'agents','manager.md'),'# Role A');writeFileSync(join(dir,'_shared','aturan-umum.md'),'Aturan A')
    const before=agentContextFiles(dir,'manager','otca')!
    writeFileSync(join(dir,'_shared','aturan-umum.md'),'Aturan B versi baru')
    const after=agentContextFiles(dir,'manager','otca')!
    expect(after.find(f=>f.path.endsWith('aturan-umum.md'))?.content).toContain('versi baru')
    expect(selectOfficialContext(before,'manager','halo',true).version).not.toBe(selectOfficialContext(after,'manager','halo',true).version)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
it('distinguishes missing cache reports from a reported zero',()=>{
  expect(cacheUsage()).toEqual({cacheReadTokens:null,cacheWriteTokens:null})
  expect(cacheUsage({cache_read_tokens:0,cache_write_tokens:30})).toEqual({cacheReadTokens:0,cacheWriteTokens:30})
  expect(cacheUsage({input_tokens_details:{cached_tokens:400}}).cacheReadTokens).toBe(400)
})
