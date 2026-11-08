import {it,expect} from 'vitest'
import {customMotion,wantsFinalVideoRender} from './custom-motion.js'
import {applyVideoEdits} from './video-revision.js'
const layer={shape:'circle',keyframes:[{t:0,x:100,y:100},{t:1,x:300,y:100}]}
it('accepts declarative motion but rejects executable payloads and invalid timing',()=>{
 expect(customMotion.parse([layer])[0].keyframes[0]).toMatchObject({opacity:1,scale:1})
 expect(()=>customMotion.parse([{...layer,onLoad:'execute'}])).toThrow()
 expect(()=>customMotion.parse([{...layer,shape:'path',path:'<script>'}])).toThrow()
 expect(()=>customMotion.parse([{...layer,keyframes:[{t:1,x:0,y:0},{t:1,x:1,y:1}]}])).toThrow()
 expect(()=>applyVideoEdits({scenes:[{visual:'art',heading:[],mulai:0,selesai:.5}],pages:[]},[{type:'motion',scene:1,layers:[layer]}])).toThrow('durasi')
})
it('requires an explicit render instruction and excludes requests with changes or negation',()=>{
 expect(wantsFinalVideoRender('Setuju preview terakhir, render MP4 revisinya')).toBe(true)
 expect(wantsFinalVideoRender('Belum render video')).toBe(false)
 expect(wantsFinalVideoRender('Render tapi ubah judul dulu')).toBe(false)
 expect(wantsFinalVideoRender('Apakah sudah render?')).toBe(false)
})
