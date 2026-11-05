import { expect,it,vi } from 'vitest'
import { privateResearchClient,screenResearchText } from './research-privacy.js'
import type { HermesClient,RunRequest } from './hermes-client.js'

it('removes direct identifiers while preserving the research question and course facts',()=>{
 const input='Nama: Sari Wijaya\nNama anak: Budi\nAlamat: Jalan Mawar 12\nNIK 1234567890123456\nsari@example.com +62 812-3456-7890\nhttps://wa.me/6281234567890\nKursus 12 minggu, biaya Rp 2.000.000. Bagaimana belajar bahasa?'
 const result=screenResearchText(input)
 for(const secret of ['Sari','Budi','Mawar','1234567890123456','sari@example.com','812-3456'])expect(result.text).not.toContain(secret)
 expect(result.text).toContain('Kursus 12 minggu, biaya Rp 2.000.000. Bagaimana belajar bahasa?')
 expect(result.counts.email).toBe(1)
})
it('screens main and intermediate model requests, records counts only, and blocks raw images before transmission',async()=>{
 const run=vi.fn<HermesClient['run']>().mockResolvedValue({runId:'r',status:'completed',output:'Kontak: x@example.com',model:'test',inputTokens:1,outputTokens:1})
 const record=vi.fn().mockResolvedValue(undefined),client=privateResearchClient({run},record)
 const endpoint={url:'http://example.invalid',key:'test'}
 const request:RunRequest={input:'Riset dari x@example.com',instructions:'Alamat: Jalan Rahasia',sessionId:'t'}
 const result=await client.run(endpoint,request,'one')
 expect(run.mock.calls[0][1].input).not.toContain('x@example.com')
 expect(run.mock.calls[0][1].instructions).not.toContain('Rahasia')
 expect(JSON.stringify(record.mock.calls)).not.toContain('example.com')
 expect(result.output).not.toContain('x@example.com')
 await expect(client.run(endpoint,{...request,images:['data:image/png;base64,test']},'two')).rejects.toThrow('gambar/scan mentah')
 expect(run).toHaveBeenCalledTimes(1)
})
