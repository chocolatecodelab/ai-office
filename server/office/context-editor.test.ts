import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { updateContext } from './context-editor.js'

it('edits an allowed document, preserves its previous revision and rejects stale or invalid edits',()=>{
  const dir=mkdtempSync(join(tmpdir(),'office-context-edit-'))
  try {
    mkdirSync(join(dir,'agents'),{recursive:true});mkdirSync(join(dir,'brands','otca'),{recursive:true})
    writeFileSync(join(dir,'agents','manager.md'),'# Manager\n')
    writeFileSync(join(dir,'brands','otca','visual.json'),'{}\n')
    const result=updateContext(dir,'otca','manager',{path:'/context/agents/manager.md',previousContent:'# Manager',content:'# Manager baru'},'tester')
    expect(result.content).toBe('# Manager baru')
    expect(readFileSync(join(dir,'agents','manager.md'),'utf8')).toBe('# Manager baru\n')
    const backup=JSON.parse(readFileSync(join(dir,'.history',readdirSync(join(dir,'.history'))[0]),'utf8'))
    expect(backup).toMatchObject({actor:'tester',content:'# Manager\n',brand:'otca'})
    expect(()=>updateContext(dir,'otca','manager',{path:'/context/agents/manager.md',previousContent:'# Manager',content:'stale'},'tester')).toThrow('sudah berubah')
    expect(()=>updateContext(dir,'otca','manager',{path:'/brand/visual.json',previousContent:'{}',content:'{'},'tester')).toThrow('JSON')
    expect(()=>updateContext(dir,'otca','manager',{path:'/context/../../.env',content:'oops'},'tester')).toThrow('tidak dapat diedit')
    expect(()=>updateContext(dir,'other','manager',{path:'/brand/visual.json',content:'{}'},'tester')).toThrow('tidak dapat diedit')
    expect(readdirSync(join(dir,'.history'))).toHaveLength(1)
  } finally {rmSync(dir,{recursive:true,force:true})}
})
