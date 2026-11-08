import { describe,it,expect } from 'vitest'
import { wantsCarousel,carouselCopySlots,applyCarouselCopy,carouselImageChoices } from './chat-production.js'

describe('carousel chat tool contract',()=>{
  it('accepts a new composition with a requested count and preserves trusted reference identity',()=>{
    const source={brand:'otca',_officeDesign:{referenceSha256:'trusted'},slides:[{headline:'Old'},{headline:'Old'},{headline:'Old'}]}
    const plan={spec:source,slots:[],revising:false,composition:true,requestedSlides:4}
    const spec={brand:'otca',_officeDesign:{referenceSha256:'forged'},verified_claims:['unchecked'],slides:Array.from({length:4},()=>({layout:'free',blocks:[{k:'title',t:'New',x:0,y:0,w:90,h:20},{k:'text',t:'New body',x:0,y:30,w:90,h:30}]}))}
    expect(applyCarouselCopy(plan,JSON.stringify({spec}))).toMatchObject({_officeDesign:{referenceSha256:'trusted'},verified_claims:[]})
    expect(()=>applyCarouselCopy(plan,JSON.stringify({spec:{...spec,brand:'info-jerman'}}))).toThrow()
    expect(()=>applyCarouselCopy(plan,JSON.stringify({spec:{...spec,slides:spec.slides.slice(0,3)}}))).toThrow()
    expect(()=>applyCarouselCopy(plan,'{"edits":[]}')).toThrow()
  })
  it('binds only images selected in the current message, supports clarification and preserves prior materials',()=>{
    const plan={images:[{id:'upload',name:'tutor.png'}],imagePaths:['slides.0.image.src'],chatTaskId:'chat',chatAssets:[],assetBindings:[]}
    expect(carouselImageChoices(plan,JSON.stringify({images:[{attachmentId:'upload',path:'slides.0.image.src'}]})).chatAssets).toEqual([{attachmentId:'upload',path:'slides.0.image.src',chatTaskId:'chat'}])
    expect(carouselImageChoices(plan,'{"edits":[]}').question).toContain('latar')
    expect(carouselImageChoices(plan,'{"question":"Di slide mana?"}').question).toBe('Di slide mana?')
    expect(carouselImageChoices(plan,'{"referenceOnly":true}').chatAssets).toEqual([])
    expect(()=>carouselImageChoices(plan,'{"images":[{"attachmentId":"foreign","path":"slides.0.image.src"}]}')).toThrow()
    expect(()=>carouselImageChoices(plan,'{"images":[{"attachmentId":"upload","path":"slides.4.image.src"}]}')).toThrow()
  })
  it('executes direct production requests, not questions or explicit opt-outs',()=>{
    for(const text of ['Buatkan carousel 4 slide tentang rutinitas belajar','Revisi judul slide kedua','Edit carousel ini'])expect(wantsCarousel(text)).toBe(true)
    for(const text of ['Apa itu carousel?','Bagaimana cara membuat carousel?','Jangan buat carousel dulu','Apakah bisa buatkan carousel?','Halo'])expect(wantsCarousel(text)).toBe(false)
  })
  it('allows only listed copy slots, preserves asset paths, and requires complete new copy',()=>{
    const spec={brand:'otca',slides:[{headline:'Judul',image:{src:'assets/stock/a.jpg'}}],caption:'Lama'}
    const plan={spec,slots:carouselCopySlots(spec),revising:false}
    expect(()=>applyCarouselCopy(plan,JSON.stringify({edits:[{path:'slides.0.image.src',value:'secret'}]}))).toThrow(/kontrak/)
    expect(()=>applyCarouselCopy(plan,JSON.stringify({edits:[{path:'slides.0.headline',value:'Baru'}]}))).toThrow(/lengkap/)
    const result=applyCarouselCopy(plan,JSON.stringify({edits:[{path:'slides.0.headline',value:'Baru'},{path:'caption',value:'Caption baru'}]}))
    expect(result).toMatchObject({slides:[{headline:'Baru',image:{src:'assets/stock/a.jpg'}}],caption:'Caption baru'})
    expect(spec.slides[0].headline).toBe('Judul')
    expect(applyCarouselCopy({...plan,revising:true},JSON.stringify({edits:[{path:'slides.0.headline',value:'Revisi'}]}))).toMatchObject({caption:'Lama'})
  })
})
