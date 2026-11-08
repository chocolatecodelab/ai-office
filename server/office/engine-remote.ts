import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec=promisify(execFile)
type Git=(args:string[])=>Promise<string>
/** Read-only live remote verification. Never fetch, checkout, merge or discard local changes. */
export async function verifyRemoteSource(root:string,git:Git=async args=>(await exec('git',args,{cwd:root,windowsHide:true,timeout:15000,maxBuffer:1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never'}})).stdout.trim()){
 let ref:string
 try{await git(['rev-parse','--verify','refs/remotes/otca/master']);ref='refs/remotes/otca/master'}catch{
   try{ref=await git(['rev-parse','--symbolic-full-name','@{upstream}'])}catch{throw new Error('Remote mesin belum ditentukan. Atur upstream repo sebelum produksi.')}
 }
 const match=/^refs\/remotes\/([^/]+)\/(.+)$/.exec(ref)
 if(!match)throw new Error('Upstream mesin tidak menunjuk remote branch.')
 const [,remote,branch]=match
 let advertised:string
 try{advertised=await git(['ls-remote','--exit-code',remote,`refs/heads/${branch}`])}catch{throw new Error('Versi terbaru remote belum dapat diverifikasi. Periksa koneksi dan akses repo; produksi ditahan.')}
 const lines=advertised.split('\n').map(line=>line.trim().split(/\s+/)).filter(parts=>parts[1]===`refs/heads/${branch}`)
 const commit=lines[0]?.[0]
 if(lines.length!==1||!commit||!/^[a-f0-9]{40,64}$/.test(commit))throw new Error('Respons versi remote tidak valid; produksi ditahan.')
 try{await git(['merge-base','--is-ancestor',commit,'HEAD'])}catch{throw new Error('Ada versi remote yang belum tergabung di repo lokal. Fetch dan sinkronkan repo tanpa menghapus perubahan lokal, lalu ulangi produksi.')}
 return {remote,branch,remoteCommit:commit,checkedAt:new Date().toISOString(),verification:'live-remote' as const}
}
