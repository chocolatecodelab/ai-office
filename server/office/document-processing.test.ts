import { expect,it } from 'vitest'
import { pageSelection } from './pdf-pages.js'
import { chatLimits } from './chat-limits.js'
import { boundedDocumentContext } from './document-processing.js'
import type { Task } from './store.js'
it('selects all pages by default and validates explicit ranges',()=>{
  expect(pageSelection(undefined,80)).toHaveLength(80)
  expect(pageSelection('1-3,8,3',10)).toEqual([1,2,3,8])
  expect(()=>pageSelection('1-11',10)).toThrow()
  expect(()=>pageSelection('0',10)).toThrow()
})
it('separates configurable upload limits from model context limits',()=>{
  expect(chatLimits({OFFICE_UPLOAD_MAX_MB:'40',OFFICE_CHAT_MAX_FILES:'30'})).toMatchObject({uploadBytes:40*1024*1024,filesPerMessage:30,contextChars:24000})
  expect(()=>chatLimits({OFFICE_UPLOAD_MAX_MB:'invalid'})).toThrow()
})
it('reads every part before reducing a long document, including its end',async()=>{
  const seen:string[]=[]
  const text='a'.repeat(26000)+'SENTINEL-TERAKHIR'
  const result=await boundedDocumentContext(text,'long.md',{id:'test'} as Task,2000,{run:async request=>{seen.push(request.input);return {runId:'r',status:'completed',output:'Ringkasan sumber',model:'m',inputTokens:1,outputTokens:1}}})
  expect(seen).toHaveLength(3)
  expect(seen[2]).toContain('SENTINEL-TERAKHIR')
  expect(result.summarized).toBe(true)
})
