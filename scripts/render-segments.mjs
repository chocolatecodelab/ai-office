import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
/** Completed, validated segments survive a crash. A partial segment is never reused. */
export async function renderSegments({directory,identity,frames,chunkFrames,render,validate,onProgress=()=>{}}){
 if(!Number.isSafeInteger(frames)||frames<1||!Number.isSafeInteger(chunkFrames)||chunkFrames<1)throw Error('Invalid segment range')
 await mkdir(directory,{recursive:true})
 const identityPath=join(directory,'identity.json')
 try{const meta=JSON.parse(await readFile(identityPath,'utf8'));if(meta.identity!==identity||meta.frames!==frames||meta.chunkFrames!==chunkFrames)throw Error('Render cache identity mismatch')}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(identityPath+'.tmp',JSON.stringify({identity,frames,chunkFrames}));await rename(identityPath+'.tmp',identityPath)}
 const segments=[];let reused=0
 for(let start=0;start<frames;start+=chunkFrames){
  const end=Math.min(frames-1,start+chunkFrames-1),name=`segment-${start}-${end}.mp4`,path=join(directory,name),metaPath=path+'.json'
  let valid=false
  try{const meta=JSON.parse(await readFile(metaPath,'utf8'));valid=meta.start===start&&meta.end===end&&meta.sha256===digest(await readFile(path));if(valid)await validate(path,end-start+1)}catch(e){if(e.message==='Render cache identity mismatch')throw e;valid=false}
  if(valid)reused++
  else{
   const partial=join(directory,`pending-${start}-${end}.mp4`)
   await render({start,end,output:partial})
   await validate(partial,end-start+1)
   if(!(await stat(partial)).size)throw Error('Empty render segment')
   const sha256=digest(await readFile(partial));await rename(partial,path)
   await writeFile(metaPath+'.tmp',JSON.stringify({start,end,sha256}));await rename(metaPath+'.tmp',metaPath)
  }
  segments.push({name,start,end});onProgress(Math.round((end+1)/frames*100))
 }
 return {segments,reused}
}
