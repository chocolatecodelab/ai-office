import { expect,it,vi } from 'vitest'
import sharp from 'sharp'
import type { OfficeStore } from './store.js'
import { productionMaterials,imageSlots } from './production-materials.js'
import { validateProductionRequest } from './production-engines.js'
it('only binds existing image slots and rejects duplicates or nonexistent paths',()=>{
 const spec={brand:'otca',slides:[{image:{src:'assets/stock/photo.png'}}]}
 expect(imageSlots(spec)).toEqual(['slides.0.image.src'])
 const assetId='11111111-1111-4111-8111-111111111111'
 expect(validateProductionRequest('content-creator','otca',{title:'QA',brief:'QA',spec,assetBindings:[{assetId,path:'slides.0.image.src'}]})).toBeDefined()
 for(const paths of [['slides.2.image.src'],['slides.0.image.src','slides.0.image.src'],['__proto__.src']])expect(()=>validateProductionRequest('content-creator','otca',{title:'QA',brief:'QA',spec,assetBindings:paths.map(path=>({path,assetId}))})).toThrow()
})
it('rejects pending, revoked, missing evidence and foreign assets and reencodes cleared raster images',async()=>{
 const data=await sharp({create:{width:8,height:8,channels:3,background:'#f00'}}).jpeg().toBuffer()
 const row={id:'id',status:'cleared',evidence:'Owner permission',source:'QA',license:'Internal',mime:'image/jpeg',data}
 const query=vi.fn().mockResolvedValue({rows:[row]})
 const store={db:{query}} as unknown as OfficeStore
 const bindings=[{assetId:'id',path:'slides.0.image.src'}]
 const [result]=await productionMaterials(store,'otca',bindings)
 expect((await sharp(result.data).metadata()).format).toBe('png')
 expect(result.sha256).toHaveLength(64)
 expect(query.mock.calls[0][1]).toEqual(['id','otca'])
 for(const patch of [{status:'pending'},{status:'revoked'},{evidence:''},{mime:'image/svg+xml'}]){query.mockResolvedValueOnce({rows:[{...row,...patch}]});await expect(productionMaterials(store,'otca',bindings)).rejects.toThrow()}
 query.mockResolvedValueOnce({rows:[]});await expect(productionMaterials(store,'ciaomanda',bindings)).rejects.toThrow()
})
