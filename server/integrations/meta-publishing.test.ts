import { expect,it,vi } from 'vitest'
import { MetaGraph,metaConfiguration,type MetaConfig,type MetaCheckpoint } from './meta-publishing.js'

const config:MetaConfig={token:'test-secret',pageId:'123',instagramId:'456',version:'v25.0',publicUrl:'https://office.example',mediaKey:Buffer.alloc(32,1).toString('base64')}
const json=(value:unknown)=>new Response(JSON.stringify(value))

it('keeps credentials brand scoped and rejects private media origins',()=>{
 const env={META_GRAPH_VERSION:'v25.0',META_OTCA_PAGE_ID:'123',META_OTCA_INSTAGRAM_ID:'456',META_OTCA_PAGE_ACCESS_TOKEN:'test-secret',OFFICE_MEDIA_PUBLIC_URL:'https://office.example',INTEGRATIONS_ENCRYPTION_KEY:config.mediaKey}
 expect(metaConfiguration('otca','instagram',undefined,env).ready).toBe(true)
 expect(metaConfiguration('infojerman','instagram',undefined,env).missing).toContain('META_INFOJERMAN_PAGE_ACCESS_TOKEN')
 for(const publicUrl of ['http://localhost:3001','https://127.0.0.1','https://192.168.1.5','https://office.example/path']){
  expect(metaConfiguration('otca','instagram',undefined,{...env,OFFICE_MEDIA_PUBLIC_URL:publicUrl}).ready).toBe(false)
 }
})

it('resumes Instagram preparation in slide order and never publishes during preparation',async()=>{
 const fetcher=vi.fn<typeof fetch>()
  .mockResolvedValueOnce(json({id:'12'}))
  .mockResolvedValueOnce(json({id:'20'}))
  .mockResolvedValueOnce(json({status_code:'FINISHED'}))
 const saved:MetaCheckpoint[]=[]
 const result=await new MetaGraph(config,fetcher).prepare('instagram',['https://office.example/one.jpg','https://office.example/two.jpg'],'Approved caption',{children:['11']},async checkpoint=>{saved.push(structuredClone(checkpoint))})
 expect(result).toBe('20')
 expect(fetcher.mock.calls[0][1]?.body?.toString()).toContain('two.jpg')
 const parent=new URLSearchParams(String(fetcher.mock.calls[1][1]?.body))
 expect(parent.get('children')).toBe('11,12')
 expect(saved.at(-1)).toEqual({children:['11','12'],container:'20'})
 expect(fetcher.mock.calls.some(call=>String(call[0]).includes('media_publish'))).toBe(false)
 expect(fetcher.mock.calls.every(call=>!String(call[0]).includes('test-secret'))).toBe(true)
})

it('prepares Facebook photos unpublished and creates one ordered feed post',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({id:'31'})).mockResolvedValueOnce(json({id:'32'})).mockResolvedValueOnce(json({id:'123_45'}))
 let checkpoint:MetaCheckpoint={}
 const graph=new MetaGraph(config,fetcher)
 await graph.prepare('facebook',['https://office.example/one.jpg','https://office.example/two.jpg'],'Caption',checkpoint,async next=>{checkpoint=next})
 expect(new URLSearchParams(String(fetcher.mock.calls[0][1]?.body)).get('published')).toBe('false')
 expect(await graph.publish('facebook','Caption',checkpoint)).toBe('123_45')
 expect(JSON.parse(new URLSearchParams(String(fetcher.mock.calls[2][1]?.body)).get('attached_media')!)).toEqual([{media_fbid:'31'},{media_fbid:'32'}])
})

it('checks linked Instagram ownership and resets expired preparation without posting',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(json({id:'123',instagram_business_account:{id:'999'}})).mockResolvedValueOnce(json({status_code:'EXPIRED'}))
 const graph=new MetaGraph(config,fetcher)
 await expect(graph.check('instagram')).rejects.toThrow('belum terhubung')
 const saved=vi.fn< (value:MetaCheckpoint)=>Promise<void> >().mockResolvedValue()
 await expect(graph.prepare('instagram',['https://office.example/one.jpg'],'Caption',{children:['11'],container:'11'},saved)).rejects.toThrow('kedaluwarsa')
 expect(saved).toHaveBeenCalledWith({})
})
