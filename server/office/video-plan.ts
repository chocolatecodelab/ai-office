import { z } from 'zod'

export const videoPlanSchema=z.object({
  objective:z.string().trim().min(1).max(1000),audience:z.string().trim().min(1).max(500),
  subtitleStyle:z.enum(['full','split']),
  scenes:z.array(z.object({
    title:z.string().trim().min(1).max(100),duration:z.number().min(1).max(30),
    narration:z.string().trim().min(1).max(1000),onScreen:z.string().trim().min(1).max(200),
    layout:z.enum(['full','split','talent']),visual:z.string().trim().min(1).max(1500),
    motion:z.string().trim().min(1).max(1200),audio:z.string().trim().max(600),
  }).strict()).min(2).max(12),
  materials:z.array(z.string().trim().min(1).max(500)).max(20),
  risks:z.array(z.string().trim().min(1).max(1000)).max(15),
}).strict().refine(plan=>plan.scenes.reduce((sum,scene)=>sum+scene.duration,0)<=180,'Durasi rencana video maksimal 180 detik.')

export function wantsVideoPlan(message:string) {
  if(/^(?:bagaimana|gimana|apakah|apa itu)\b|\b(?:jangan|belum)\s+(?:di)?(?:buat|render|edit|siap)/i.test(message.trim()))return false
  return /\b(buat(?:kan)?|bikin(?:kan)?|siapkan|susun(?:kan)?|edit|revisi|ubah)\b/i.test(message)&&/\b(video|reels?|storyboard|naskah)\b/i.test(message)
}

export function parseVideoPlan(output:string,presets:Array<{id:string}>) {
  const input=JSON.parse(output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))
  if(typeof input?.question==='string'&&input.question.trim())return {question:input.question.trim().slice(0,1500)}
  const data=z.object({preset:z.string(),plan:videoPlanSchema}).strict().parse(input)
  if(!presets.some(preset=>preset.id===data.preset))throw new Error('Preset video tidak tersedia pada mesin lokal.')
  return {video:{preset:data.preset,seed:1,plan:data.plan}}
}

export function videoPlanInstructions(presets:unknown) {
  return `\nTOOL RENCANA PRODUKSI VIDEO. Susun naskah dan rencana adegan nyata berdasarkan brief, aturan brand, serta bahan pengguna. Gunakan preset lokal sebagai titik awal sesuai isi dan suasana, bukan batas kreativitas. Untuk semua brand, komposisi, ilustrasi dan koreografi Remotion boleh dirancang baru di luar katalog. Ikuti identitas brand masing-masing (warna, font, logo), makna ucapan, keterbacaan dan persetujuan visual. Jangan memaksakan perangkat atau layout seragam. Jangan menyalin contoh preset atau mengarang footage, transkripsi, sumber, hasil render, atau persetujuan storyboard. Timing masih estimasi untuk rencana adegan dan subtitle draf. Jelaskan kebutuhan footage/VO/gambar di materials. Variasikan layout sesuai pesan, rancang gerak objek yang menjelaskan narasi, dan nyatakan pilihan subtitle full/split. Perubahan fakta yang belum terkonfirmasi masuk risks. Jika informasi pokok belum cukup, balas hanya {"question":"Pertanyaan singkat"}. Selain itu balas hanya JSON {"preset":"id preset","plan":{"objective":"tujuan","audience":"audiens","subtitleStyle":"full|split","scenes":[{"title":"adegan","duration":5,"narration":"ucapan lengkap","onScreen":"teks singkat","layout":"full|split|talent","visual":"rancangan visual dan posisi","motion":"perilaku, pemicu, respons, ritme dan kontinuitas","audio":"arahan VO/musik/SFX"}],"materials":[],"risks":[]}}. Minimal 2 adegan, maksimal 12, total maksimal 180 detik. Paket ini diproses menjadi berkas rencana untuk review. Storyboard visual dengan still dan render penuh mengikuti gerbang pipeline terpisah.\nPRESET TERSEDIA:\n${JSON.stringify(presets)}`
}
