import { it,expect } from 'vitest'
import sharp from 'sharp'
import { parseVisualReview,visualSlideImages } from './production-visual-review.js'
it('does not treat blocking visual issues or malformed model output as a pass',()=>{
 expect(parseVisualReview('{"summary":"Rapi","issues":[]}').passed).toBe(true)
 expect(parseVisualReview('{"summary":"Teks terlalu kecil","issues":[{"slide":2,"severity":"blocking","message":"Besarkan hierarki teks agar setara referensi"}]}').passed).toBe(false)
 expect(()=>parseVisualReview('{"passed":true}')).toThrow()
})
it('uses actual slide images in order and rejects empty render results',async()=>{
 const png=await sharp({create:{width:8,height:8,channels:3,background:'#fff'}}).png().toBuffer()
 const images=await visualSlideImages([{name:'slide-02.png',mime:'image/png',data:png},{name:'slide-01.png',mime:'image/png',data:png},{name:'review.png',mime:'image/png',data:png}])
 expect(images).toHaveLength(2);expect(images[0]).toMatch(/^data:image\/jpeg;base64,/)
 await expect(visualSlideImages([])).rejects.toThrow()
})
