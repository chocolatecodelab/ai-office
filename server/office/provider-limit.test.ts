import {it,expect} from 'vitest'
import {quotaInfo,limitFromError,ProviderLimitError} from './provider-limit.js'
import {createHermesClient,HermesError} from './hermes-client.js'
const now=Date.parse('2026-11-07T10:00:00Z')
it('reads provider reset times and labels fallback honestly',()=>{
 expect(quotaInfo('rate limit',new Headers({'retry-after':'120'}),now)?.retryAt).toBe('2026-11-07T10:02:01.000Z')
 expect(quotaInfo({error:{message:'quota exceeded',reset_at:'2026-11-07T12:00:00Z'}},undefined,now)?.retryAt).toBe('2026-11-07T12:00:01.000Z')
 expect(quotaInfo('429',new Headers({'x-ratelimit-reset-tokens':'1m30s'}),now)?.retryAt).toBe('2026-11-07T10:01:31.000Z')
 expect(quotaInfo('usage limit reached, try again in 2 hours 5 minutes',undefined,now)?.retryAt).toBe('2026-11-07T12:05:01.000Z')
 expect(quotaInfo('quota exceeded',undefined,now)?.timingSource).toBe('fallback')
 expect(limitFromError(new HermesError('HTTP 429 concurrent run cap',true))).toBeUndefined()
 expect(limitFromError(Object.assign(new Error('limited'),{status:429,headers:{'retry-after':'60'}}))?.timingSource).toBe('provider')
})
it('handles HTTP quota for images and resumes polling an existing run without a second POST',async()=>{
 const endpoint={url:'http://hermes',key:'not-logged'},request={input:'test',instructions:'test',sessionId:'s'}
 const limited=createHermesClient({fetcher:async()=>new Response('{"error":"rate limit"}',{status:429,headers:{'retry-after':'90'}})})
 await expect(limited.run(endpoint,{...request,images:['data:image/png;base64,AA']},'key')).rejects.toBeInstanceOf(ProviderLimitError)
 const paths:string[]=[]
 const client=createHermesClient({pollMs:0,fetcher:async url=>{paths.push(String(url));return new Response(JSON.stringify({status:'completed',output:'done'}))}})
 const result=await client.run(endpoint,{...request,resumeRunId:'existing'},'key');expect(result.output).toBe('done');expect(paths).toEqual(['http://hermes/v1/runs/existing'])
})
