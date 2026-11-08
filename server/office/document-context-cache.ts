import { createHash } from 'node:crypto'
import type { OfficeStore,Task } from './store.js'
import { boundedDocumentContext,type DocumentRuntime } from './document-processing.js'
import { HermesError } from './hermes-client.js'

export async function cachedDocumentContext(store:OfficeStore,task:Task,file:{id:string;name:string;extracted:string},budget:number,runtime?:DocumentRuntime) {
  if(file.extracted.length<=budget)return {text:file.extracted,summarized:false,cacheHit:false}
  const sourceHash=createHash('sha256').update('document-summary-v1\n'+file.extracted).digest('hex')
  const client=await store.db.connect(),key=`doc-summary:${file.id}:${sourceHash}:${budget}`
  let locked=false
  try{
    locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked
    if(!locked)throw new HermesError('Ringkasan dokumen sedang disiapkan tugas lain.',true)
    const saved=await client.query('SELECT c.content FROM document_context_cache c JOIN chat_attachments a ON a.id=c.attachment_id WHERE c.attachment_id=$1 AND c.source_hash=$2 AND c.budget=$3 AND a.brand_id=$4 AND NOT a.removed',[file.id,sourceHash,budget,task.brandId])
    if(saved.rows.length)return {text:saved.rows[0].content as string,summarized:true,cacheHit:true}
    const result=await boundedDocumentContext(file.extracted,file.name,task,budget,runtime)
    await client.query(`INSERT INTO document_context_cache(attachment_id,source_hash,budget,content) SELECT id,$2,$3,$4 FROM chat_attachments WHERE id=$1 AND brand_id=$5 AND NOT removed ON CONFLICT DO NOTHING`,[file.id,sourceHash,budget,result.text,task.brandId])
    return {...result,cacheHit:false}
  }finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key]).catch(()=>undefined);client.release()}
}
