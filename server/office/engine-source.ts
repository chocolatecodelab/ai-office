import { execFileSync } from 'node:child_process'
import { readFileSync,existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const scopes=['AGENTS.md','CLAUDE.md','ATURAN_KERJA.md','INDEX.md','package.json','package-lock.json','src','config','knowledge','assets','docs/designs','docs/preview','pipeline','remotion/src','remotion/package.json','remotion/package-lock.json','tokens','gaya','template','konteks','preset','thumbnail','.claude/skills']
/** Commit plus content of relevant working changes, excluding project media/output. No persistent cache. */
export function engineSource(root:string){
 const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']})
 const commit=git(['rev-parse','HEAD']).trim()
 let trackingRef:string|undefined,remoteCommit:string|undefined,behind=0
 for(const ref of ['refs/remotes/otca/master','@{upstream}'])try{remoteCommit=git(['rev-parse',ref]).trim();trackingRef=ref;behind=Number(git(['rev-list','--count','HEAD..'+ref]).trim());break}catch{/* Offline/local repos can have no upstream. */}
 if(behind>0)throw new Error('Repo mesin tertinggal '+behind+' commit dari '+trackingRef+'. Sinkronkan repo sebelum produksi.')
 const changed=[...new Set((git(['diff','--name-only','-z','HEAD','--',...scopes])+git(['ls-files','--others','--exclude-standard','-z','--',...scopes])).split('\0').filter(Boolean))].sort()
 const hash=createHash('sha256').update(commit)
 for(const name of changed){hash.update(name+'\0');hash.update(existsSync(join(root,name))?readFileSync(join(root,name)):'<removed>')}
 return {commit,trackingRef,remoteCommit,behind,fingerprint:hash.digest('hex'),dirty:changed.length>0,changedFiles:changed}
}
