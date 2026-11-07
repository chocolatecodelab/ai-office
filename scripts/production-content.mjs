// Runs in the content engine's own dependency environment; the Office owns output directories.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

if(process.argv[2]==='--check'){
  const root=process.argv[3]
  const {chromium}=await import(pathToFileURL(path.join(root,'node_modules/playwright/index.mjs')).href)
  if(!fs.existsSync(chromium.executablePath()))throw new Error('Browser renderer belum terpasang di mesin Content Creator.')
  await import(pathToFileURL(path.join(root,'src/render/render.ts')).href)
  console.log('Node, renderer, dan Chromium tersedia.')
}else{
  const [root,work]=process.argv.slice(2)
  const request=JSON.parse(fs.readFileSync(path.join(work,'request.json'),'utf8'))
  const {renderSpec}=await import(pathToFileURL(path.join(root,'src/render/render.ts')).href)
  const spec={...request.spec,brand:request.brand,slug:request.slug}
  let result
  try{result=await renderSpec(spec,{outRoot:path.join(work,'render')})}
  catch(error){
    if(error instanceof Error&&error.message.startsWith('Spec tidak valid:'))fs.writeFileSync(path.join(work,'failure.json'),JSON.stringify({type:'qa',issues:[{slide:1,code:'SPEC_SCHEMA',message:error.message.slice(0,3000)}]}))
    throw error
  }
  if(result.status==='DIBLOKIR'){
    const issues=result.slides.flatMap(slide=>slide.issues.filter(issue=>issue.level==='critical').map(issue=>({slide:slide.slide,code:issue.code,message:issue.message}))).slice(0,10)
    fs.writeFileSync(path.join(work,'failure.json'),JSON.stringify({type:'qa',issues}))
    throw new Error('QA desain belum lulus: '+issues.map(issue=>`slide ${issue.slide}: ${issue.message}`).join('; '))
  }
  const files=fs.readdirSync(result.dir).filter(name=>/^(slide-\d+\.png|review\.png|qa-report\.json|design-spec\.json|caption\.md)$/.test(name))
  if(!files.some(name=>/^slide-\d+\.png$/.test(name)))throw new Error('Renderer tidak menghasilkan gambar.')
  fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({directory:result.dir,status:result.status,files}))
}
