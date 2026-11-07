import { describe,expect,it } from 'vitest'
import { ProductionEngines,validateProductionRequest } from './production-engines.js'
import { runProductionProcess } from './production-process.js'

const request={title:'Uji',brief:'Uji pipeline',spec:{brand:'info-jerman',slides:[{layout:'free',headline:'Uji',blocks:[]}]}}
describe('local production boundaries',()=>{
  it('rejects another brand and arbitrary filesystem or URL asset reads',()=>{
    expect(()=>validateProductionRequest('content-creator','otca',request)).toThrow(/Brand/)
    for(const src of ['../../private.png','file:///C:/private.png','https://example.com/a.png','assets/brands/otca/logo/a.png','assets/stock/../private.png']){
      expect(()=>validateProductionRequest('content-creator','infojerman',{...request,spec:{...request.spec,background:{src}}})).toThrow(/Aset/)
    }
    expect(validateProductionRequest('content-creator','infojerman',{...request,spec:{...request.spec,background:{src:'assets/brands/info-jerman/logo/default.png'}}}).spec).toBeDefined()
  })
  it('does not accept executable commands, arbitrary video paths, or irrelevant roles',()=>{
    expect(()=>validateProductionRequest('manager','otca',request)).toThrow(/hanya/)
    expect(()=>validateProductionRequest('video-editor','otca',{title:'Uji',brief:'Uji',video:{preset:'x; rm -rf'}})).toThrow()
    expect(()=>validateProductionRequest('video-editor','otca',{title:'Uji',brief:'Uji',video:{preset:'glass-tech-bukti-sosial',command:'render'}})).toThrow()
    expect(validateProductionRequest('video-editor','otca',{title:'Uji',brief:'Uji',video:{preset:'glass-tech-bukti-sosial'}}).video?.seed).toBe(1)
  })
  it('reports an unconfigured engine honestly',async()=>{
    const engine=new ProductionEngines({workDir:'unused'})
    expect(await engine.health('content-creator')).toMatchObject({configured:false,ready:false})
    expect(engine.context('content-creator','otca').files).toEqual([])
  })
  it('enforces a process deadline and treats metacharacters as plain arguments',async()=>{
    const text=await runProductionProcess(process.execPath,['-e','process.stdout.write(process.argv[1])','hello; echo secret'],process.cwd())
    expect(text).toBe('hello; echo secret')
    await expect(runProductionProcess(process.execPath,['-e','setTimeout(()=>{},30000)'],process.cwd(),{timeoutMs:100})).rejects.toThrow(/batas waktu/)
  })
})
