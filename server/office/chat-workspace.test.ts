import { expect, it } from 'vitest'
import sharp from 'sharp'
import PDFDocument from 'pdfkit'
import JSZip from 'jszip'
import { pdfRead } from './pdf-pages.js'
import { readAttachment } from './chat-attachments.js'
import { relevantNotes, validateChatInput } from './chat-workspace.js'
import { selectedSkills } from './chat-skills.js'
import { createHermesClient } from './hermes-client.js'
import type { AgentNote } from './agent-notes.js'

it('reads bounded UTF-8 documents and rejects binary/unsupported payloads',async()=>{
  expect(await readAttachment('../brief.md',Buffer.from('# Brief konten'))).toMatchObject({name:'brief.md',extracted:'# Brief konten'})
  await expect(readAttachment('file.exe',Buffer.from('x'))).rejects.toThrow('Format')
  await expect(readAttachment('scan.pdf',Buffer.from('fake'))).rejects.toThrow('PDF')
  await expect(readAttachment('x.txt',Buffer.from([0xff,0xff]))).rejects.toThrow()
})
it('extracts real PDF text and normalizes images',async()=>{
  const chunks:Buffer[]=[]
  const doc=new PDFDocument();const done=new Promise<Buffer>(resolve=>{doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)))})
  doc.text('OTCA lampiran dokumen');doc.end()
  const pdf=await done;expect((await readAttachment('brief.pdf',pdf)).extracted).toBe('');expect(JSON.stringify(await pdfRead(pdf,'text',[1]))).toContain('OTCA lampiran dokumen')
  const image=await sharp({create:{width:10,height:10,channels:3,background:'red'}}).png().toBuffer()
  const file=await readAttachment('test.png',image)
  expect(file.mime).toBe('image/jpeg')
  expect((await sharp(file.data).metadata()).format).toBe('jpeg')
})
it('extracts the text of a real DOCX document',async()=>{
  const zip=new JSZip()
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Brief Word OTCA</w:t></w:r></w:p></w:body></w:document>')
  expect((await readAttachment('brief.docx',await zip.generateAsync({type:'nodebuffer'}))).extracted).toContain('Brief Word OTCA')
})
it('keeps rules, ranks only relevant memories, and respects the per-message memory switch',()=>{
  const note=(id:string,kind:'rule'|'memory',title:string,body:string)=>({id,kind,title,body,active:true,updatedAt:'2026-11-04'} as AgentNote)
  const notes=[note('rule','rule','Approval','Selalu review'),note('match','memory','Beasiswa Jerman','Target SMA'),note('other','memory','Espresso','Kopi tanpa gula')]
  expect(relevantNotes(notes,'Buat konten beasiswa Jerman').map(n=>n.id)).toEqual(['rule','match'])
  expect(relevantNotes(notes,'Beasiswa',false).map(n=>n.id)).toEqual(['rule'])
  expect(()=>validateChatInput({attachmentIds:['bad']},'manager')).toThrow()
  expect(()=>selectedSkills('video-editor',['campaign-brief'])).toThrow()
})
it('sends actual image content through Hermes multimodal Responses and reads text + usage',async()=>{
  let submitted:Record<string,unknown>={}
  const fetcher=(async(url:unknown,init?:RequestInit)=>{expect(String(url)).toBe('http://hermes/v1/responses');submitted=JSON.parse(String(init?.body));return new Response(JSON.stringify({id:'image-run',status:'completed',output:[{content:[{type:'output_text',text:'Gambar merah'}]}],usage:{input_tokens:30,output_tokens:4}}))}) as typeof fetch
  const result=await createHermesClient({fetcher}).run({url:'http://hermes',key:'secret'},{input:'Apa isi gambar?',instructions:'Analisis gambar',sessionId:'task-image',images:['data:image/jpeg;base64,test']},'image-1')
  expect(JSON.stringify(submitted.input)).toContain('input_image')
  expect(result).toMatchObject({output:'Gambar merah',inputTokens:30,outputTokens:4})
})
