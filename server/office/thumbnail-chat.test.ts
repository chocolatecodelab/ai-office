import {it,expect} from 'vitest'
import {thumbnailPatch,wantsThumbnailRevision} from './thumbnail-chat.js'
it('recognizes the reported conversational cover revision and validates bounded edit parameters',()=>{
 expect(wantsThumbnailRevision('pada thumbnail, tolong tulisannya ditambah margin kiri atau padding karena terlalu mepet kiri')).toBe(true)
 expect(wantsThumbnailRevision('Jangan revisi thumbnail')).toBe(false)
 expect(wantsThumbnailRevision('Ubah judul adegan 1. Jangan ubah thumbnail.')).toBe(false)
 expect(thumbnailPatch.parse({margin:64})).toEqual({margin:64})
 expect(()=>thumbnailPatch.parse({command:'delete'})).toThrow()
 expect(()=>thumbnailPatch.parse({margin:-1})).toThrow()
 expect(()=>thumbnailPatch.parse({})).toThrow()
})
