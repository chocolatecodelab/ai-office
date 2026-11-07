import {it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile,rm,utimes} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {engineSource} from './engine-source.js'
it('detects edits with unchanged size/time and untracked source, and blocks known upstream updates',async()=>{
 const root=await mkdtemp(join(tmpdir(),'office-source-'))
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim()
 try{git('init');await mkdir(join(root,'src'));await writeFile(join(root,'src/code.ts'),'old');git('add','src');git('commit','-m','initial');const first=engineSource(root)
 const fixed=new Date('2025-01-01');await writeFile(join(root,'src/code.ts'),'new');await utimes(join(root,'src/code.ts'),fixed,fixed);const second=engineSource(root);expect(second.fingerprint).not.toBe(first.fingerprint)
 await writeFile(join(root,'src/code.ts'),'now');await utimes(join(root,'src/code.ts'),fixed,fixed);expect(engineSource(root).fingerprint).not.toBe(second.fingerprint)
 await writeFile(join(root,'src/new.ts'),'new component');expect(engineSource(root).changedFiles).toContain('src/new.ts')
 const next=git('commit-tree','HEAD^{tree}','-p','HEAD','-m','upstream');git('update-ref','refs/remotes/otca/master',next);expect(()=>engineSource(root)).toThrow('tertinggal')
 }finally{await rm(root,{recursive:true,force:true})}
},20000)
