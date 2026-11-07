import { expect,it } from 'vitest'
import { parseVideoPlan,wantsVideoPlan,videoPlanSchema } from './video-plan.js'

const scene={title:'Hook',duration:5,narration:'Mulai dari tujuan belajar.',onScreen:'Tentukan tujuan',layout:'full',visual:'Judul dan bahan pengguna',motion:'Kartu merespons penekanan kata utama.',audio:'VO asli'}
const plan={objective:'Reels edukasi',audience:'Orang tua',subtitleStyle:'full',scenes:[scene,{...scene,title:'Penutup'}],materials:['Footage pengguna'],risks:['Periksa transkrip ASR.']}
it('parses a bounded narrative plan using only an available preset',()=>{
 expect(parseVideoPlan(JSON.stringify({preset:'glass-tech-bukti-sosial',plan}),[{id:'glass-tech-bukti-sosial'}]).video?.plan?.scenes).toHaveLength(2)
 expect(()=>parseVideoPlan(JSON.stringify({preset:'unknown',plan}),[])).toThrow('Preset')
 expect(videoPlanSchema.safeParse({...plan,scenes:[{...scene,duration:999}]}).success).toBe(false)
 expect(videoPlanSchema.safeParse({...plan,command:'render'}).success).toBe(false)
 expect(parseVideoPlan('{"question":"Apa tujuan videonya?"}',[]).question).toBe('Apa tujuan videonya?')
})
it('activates production planning for direct requests and leaves questions conversational',()=>{
 expect(wantsVideoPlan('Siapkan rencana produksi video untuk OTCA')).toBe(true)
 expect(wantsVideoPlan('Buatkan naskah Reels dari footage ini')).toBe(true)
 expect(wantsVideoPlan('Apakah video ini bisa diedit?')).toBe(false)
 expect(wantsVideoPlan('Jangan buat video dulu')).toBe(false)
})
