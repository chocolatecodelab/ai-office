import { expect,it } from 'vitest'
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { renderPdfPages } from './pdf-pages.js'
import { profileCsv,searchDocuments } from './document-tools.js'
import { readAttachment } from './chat-attachments.js'
it('calculates CSV values with quoted commas and missing cells',()=>{
  expect(profileCsv('name,value\n"A, B",12\nC,\nD,5')).toMatchObject({rows:3,columns:2,fields:[{name:'name',empty:0},{name:'value',empty:1,min:5,max:12}]})
  expect(()=>profileCsv('a\n"missing')).toThrow()
  expect(searchDocuments([{name:'one',text:'topik lain'},{name:'two',text:'beasiswa Jepang'}],'beasiswa Jepang')[0].source).toBe('two')
})
it('accepts a scanned PDF and renders a real page for multimodal reading',async()=>{
  const image=await sharp({create:{width:50,height:50,channels:3,background:'red'}}).png().toBuffer()
  const doc=new PDFDocument(),chunks:Buffer[]=[]
  const data=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
  doc.image(image,40,40);doc.end()
  const pdf=await data,file=await readAttachment('scan.pdf',pdf)
  expect(file.extracted).toBe('')
  const pages=await renderPdfPages(pdf)
  expect(pages).toHaveLength(1)
  expect(pages[0]).toMatch(/^data:image\//)
},30000)
