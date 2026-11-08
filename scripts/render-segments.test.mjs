import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {renderSegments} from './render-segments.mjs';
test('interrupted rendering reuses finished chunks and rejects changed or corrupted data',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'tmp','render-resume-'));let calls=[];
 const validate=async(file,frames)=>assert.equal(JSON.parse(await readFile(file,'utf8')).frames,frames)
 try{
 await assert.rejects(renderSegments({directory:dir,identity:'v1',frames:25,chunkFrames:10,validate,render:async({start,end,output})=>{calls.push(start);if(start===10)throw Error('interrupted');await writeFile(output,JSON.stringify({frames:end-start+1}))}}),/interrupted/)
 const result=await renderSegments({directory:dir,identity:'v1',frames:25,chunkFrames:10,validate,render:async({start,end,output})=>{calls.push(start);await writeFile(output,JSON.stringify({frames:end-start+1}))}})
 assert.equal(result.reused,1);assert.deepEqual(calls,[0,10,10,20]);assert.deepEqual(result.segments.map(s=>[s.start,s.end]),[[0,9],[10,19],[20,24]])
 await writeFile(join(dir,'segment-0-9.mp4'),'corrupted')
 let repaired=[];await renderSegments({directory:dir,identity:'v1',frames:25,chunkFrames:10,validate,render:async({start,end,output})=>{repaired.push(start);await writeFile(output,JSON.stringify({frames:end-start+1}))}});assert.deepEqual(repaired,[0])
 await assert.rejects(renderSegments({directory:dir,identity:'v2',frames:25,chunkFrames:10,validate,render:async()=>{}}),/identity mismatch/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
