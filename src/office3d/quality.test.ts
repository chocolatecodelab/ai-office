import { expect,it } from 'vitest'
import { renderQuality } from './quality.ts'
it('automatically reduces pixel and shadow cost while preserving explicit choices',()=>{
 expect(renderQuality('auto',true,false)).toEqual({low:true,dpr:1,shadows:false})
 expect(renderQuality('auto',false,true).low).toBe(true)
 expect(renderQuality('high',true,true).shadows).toBe(true)
 expect(renderQuality('low',false,false).dpr).toBe(1)
})
