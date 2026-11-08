import {it,expect} from 'vitest'
import {applyVideoEdits,wantsVideoRevision,wantsPreviewRefresh} from './video-revision.js'
it('applies selective edits without changing timings, source assets or the original version',()=>{
 const source={footage:'brand/video.mov',logo:'brand/logo.png',scenes:[{visual:'directory',heading:['Lama'],mode:'split',mulai:0,selesai:3},{visual:'brand',heading:[],mulai:3,selesai:4}],pages:[[{w:'OTKA',s:0,e:1}]]}
 const result=applyVideoEdits(source,[{type:'heading',scene:1,lines:['Baru']},{type:'subtitle',page:1,word:1,text:'OTCA'}])
 expect(result.props.scenes[0]).toMatchObject({heading:['Baru'],mulai:0,selesai:3});expect(source.scenes[0].heading).toEqual(['Lama']);expect(result.props.pages[0][0]).toEqual({w:'OTCA',s:0,e:1});expect(result.props.footage).toBe(source.footage)
 expect(()=>applyVideoEdits(source,[{type:'heading',scene:2,lines:['Override logo']}])).toThrow('terkunci')
 expect(()=>applyVideoEdits(source,[{type:'style',values:{captionSize:4}}])).toThrow()
 expect(()=>applyVideoEdits(source,[{type:'style',values:{file:'../secret'}}])).toThrow()
 expect(wantsVideoRevision('Perbesar judul pada adegan 1')).toBe(true)
})

it('refreshes only an explicit unchanged preview request',()=>{
 expect(wantsPreviewRefresh('Perbarui preview proyek terakhir. Jangan render MP4.')).toBe(true)
 expect(wantsPreviewRefresh('Buat ulang preview dan ubah judulnya')).toBe(false)
 expect(wantsPreviewRefresh('Jangan perbarui preview')).toBe(false)
})
