import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
const roots=['dist/assets','public/models','public/brands','public/draco']
async function bytes(dir){let total=0;for(const file of await readdir(dir,{withFileTypes:true})){const path=join(dir,file.name);total+=file.isDirectory()?await bytes(path):(await stat(path)).size}return total}
const entries=await Promise.all(roots.map(async path=>({path,bytes:await bytes(path)})))
const total=entries.reduce((sum,item)=>sum+item.bytes,0),limit=8*1024*1024
console.log(JSON.stringify({scope:'All build chunks, models, logos and Draco decoders (raw files; not a network trace)',entries,totalBytes:total,limitBytes:limit,pass:total<=limit},null,2))
if(total>limit)process.exitCode=1
