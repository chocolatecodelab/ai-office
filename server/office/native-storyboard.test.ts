import { describe,it,expect } from 'vitest'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nativeStoryboard,nativeVideo } from './native-storyboard.js'
describe('native storyboard snapshot',()=>{it('embeds artwork, binds source, and blocks traversal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'office-sb-'));try{
 const p=join(root,'proyek','sample');await mkdir(join(p,'out'),{recursive:true});await mkdir(join(p,'cache'))
 await writeFile(join(p,'cache/sumber.json'),JSON.stringify({utama:{sha256:'a'.repeat(64)}}))
 await writeFile(join(p,'out/scene.png'),Buffer.from([137,80,78,71]))
 await writeFile(join(p,'out/storyboard.html'),'<img src="scene.png">')
 const result=await nativeStoryboard(root,'sample','storyboard.html',['a'.repeat(64)])
 expect(result.files[0].data.toString()).toContain('data:image/png;base64,')
 expect(result.report.renderedByOffice).toBe(false)
 await expect(nativeStoryboard(root,'sample','storyboard.html',['b'.repeat(64)])).rejects.toThrow('tidak cocok')
 await writeFile(join(p,'out/storyboard.html'),'<img src="../secret.png">')
 await expect(nativeStoryboard(root,'sample','storyboard.html',['a'.repeat(64)])).rejects.toThrow('Sumber gambar')
 await expect(nativeStoryboard(root,'../sample','storyboard.html',['a'.repeat(64)])).rejects.toThrow('tidak valid')
 }finally{await rm(root,{recursive:true,force:true})}
})})
it('rejects unfinished or altered native video deliveries',async()=>{
 const root=await mkdtemp(join(tmpdir(),'office-video-'));try{
 const p=join(root,'proyek','sample');await mkdir(join(p,'out'),{recursive:true});await mkdir(join(p,'cache'))
 await writeFile(join(p,'cache/sumber.json'),JSON.stringify({utama:{sha256:'a'.repeat(64)}}))
 await writeFile(join(p,'out/render-provenance.json'),JSON.stringify({stage:'picture-rendered-audio-pending'}))
 await expect(nativeVideo(root,'sample',['a'.repeat(64)])).rejects.toThrow('belum selesai')
 await writeFile(join(p,'out/render-provenance.json'),JSON.stringify({stage:'encoded-and-verified',videoSha256:'b'.repeat(64),approval:{compositionSha256:'c'.repeat(64)}}))
 await writeFile(join(p,'out/sample.mp4'),'altered file')
 await expect(nativeVideo(root,'sample',['a'.repeat(64)])).rejects.toThrow('berubah')
 await expect(nativeVideo(root,'sample',['d'.repeat(64)])).rejects.toThrow('tidak cocok')
 }finally{await rm(root,{recursive:true,force:true})}
})
