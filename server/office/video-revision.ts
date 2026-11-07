import {customMotion} from './custom-motion.js'
import {z} from 'zod'
import {readFile,realpath} from 'node:fs/promises'
import {resolve,sep} from 'node:path'
const style=z.object({titleScale:z.number().min(.8).max(1.2).optional(),artScale:z.number().min(.7).max(1.3).optional(),captionSize:z.number().min(40).max(64).optional(),darkness:z.number().min(.5).max(1).optional()}).strict()
const propsSchema=z.object({scenes:z.array(z.object({visual:z.string(),heading:z.array(z.string()),mode:z.string().optional(),art:z.string().optional(),mulai:z.number(),selesai:z.number()}).passthrough()),pages:z.array(z.array(z.object({w:z.string(),s:z.number(),e:z.number()}).passthrough())),editorial:style.optional()}).passthrough()
export const videoEdits=z.array(z.discriminatedUnion('type',[
 z.object({type:z.literal('motion'),scene:z.number().int().min(1),layers:customMotion}).strict(),
 z.object({type:z.literal('style'),values:style}).strict(),
 z.object({type:z.literal('heading'),scene:z.number().int().min(1),lines:z.array(z.string().min(1).max(55)).min(1).max(3)}).strict(),
 z.object({type:z.literal('layout'),scene:z.number().int().min(1),mode:z.enum(['full','split'])}).strict(),
 z.object({type:z.literal('art'),scene:z.number().int().min(1),art:z.enum(['gate','directory','calendar','compare','selection','plan','link'])}).strict(),
 z.object({type:z.literal('subtitle'),page:z.number().int().min(1),word:z.number().int().min(1),text:z.string().min(1).max(50)}).strict(),
])).min(1).max(20)
export function applyVideoEdits(original:Record<string,unknown>,input:unknown){
 const edits=videoEdits.parse(input),props=propsSchema.parse(structuredClone(original))
 for(const edit of edits){
  if(edit.type==='style'){props.editorial={...props.editorial,...edit.values};continue}
  if(edit.type==='subtitle'){const word=props.pages?.[edit.page-1]?.[edit.word-1];if(!word)throw new Error('Posisi subtitle tidak ditemukan.');word.w=edit.text;continue}
  const scene=props.scenes?.[edit.scene-1];if(!scene||scene.visual==='brand')throw new Error('Adegan tidak ditemukan atau merupakan identitas brand terkunci.')
  if(edit.type==='motion'){if(edit.layers.some(l=>l.keyframes.at(-1)!.t>scene.selesai-scene.mulai))throw new Error('Keyframe melewati durasi adegan.');scene.customGraphics=edit.layers}
  if(edit.type==='heading')scene.heading=edit.lines
  if(edit.type==='layout')scene.mode=edit.mode
  if(edit.type==='art')scene.art=edit.art
 }
 for(const scene of props.scenes){const graphics=scene.customGraphics as Array<{shape:string}>|undefined;if(scene.mode!=='full'&&graphics?.some(l=>l.shape==='text'))throw new Error('Teks pada grafis kustom memerlukan layout full agar terbaca.')}
 return {props,edits}
}
export async function revisionSource(root:string,project:string){
 const base=await realpath(resolve(root,'proyek'));let current=project
 for(let depth=0;depth<10;depth++){
  if(!/^[-a-z0-9_]{1,120}$/.test(current))throw new Error('Proyek tidak valid.')
  const dir=await realpath(resolve(base,current));if(!dir.startsWith(base+sep))throw new Error('Proyek di luar pustaka.')
  for(const name of ['revision-props.json','storyboard-props-r4.json'])try{
   const path=await realpath(resolve(dir,name));if(!path.startsWith(dir+sep))throw new Error('Props di luar proyek.')
   const props=propsSchema.parse(JSON.parse(await readFile(path,'utf8')))
   if(!Array.isArray(props.scenes)||!props.scenes.every(s=>Array.isArray(s.heading)))throw new Error('Komposisi belum mendukung revisi terstruktur.')
   return {project:current,dir,props}
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e}
  const previous=JSON.parse(await readFile(resolve(dir,'out/thumbnail-revision.json'),'utf8'));current=previous.sourceProject
 }
 throw new Error('Rantai versi proyek terlalu panjang.')
}
export function wantsVideoRevision(message:string){return !/^\s*(jangan|tidak perlu|apakah|bagaimana)/i.test(message)&&/revisi|ubah|ganti|perbesar|perkecil|geser|gelapkan|terangkan|lebih (besar|kecil|gelap|terang)|(buat|tambahkan|rancang).*(animasi|motion|diagram|ilustrasi)/i.test(message)}
export function videoRevisionInstructions(source:unknown){return `\nALAT REVISI KOMPOSISI VIDEO. Sumber lengkap: ${JSON.stringify(source)}. Gunakan proyek yang tersedia tanpa meminta unggah ulang. Balas JSON {"edits":[{"type":"style","values":{"titleScale":1.1,"artScale":1.1,"captionSize":48,"darkness":0.8}}]} atau {"question":"klarifikasi"}. Nilai style opsional, hanya sertakan yang diminta: titleScale .8–1.2, artScale .7–1.3, captionSize 40–64, darkness .5–1 (lebih kecil lebih terang). Edit lain: {type:"heading",scene:1,lines:["judul"]}, {type:"layout",scene:1,mode:"full|split"}, {type:"art",scene:1,art:"gate|directory|calendar|compare|selection|plan|link"}, {type:"subtitle",page:1,word:1,text:"koreksi"}. Indeks dimulai 1. Pertahankan timing suara, font, warna dan logo brand. Subtitle adalah kata dengan timestamp; jangan mengubah timing. Maksimal 20 edits. Ini membuat preview still dan props versi baru untuk review, bukan render MP4 final. Animasi baru boleh dibuat memakai {type:"motion",scene:1,layers:[{shape:"rect|circle|path|text",width:100,height:100,radius:0,text:"opsional",path:"M0 0 L100 100",fill:"gold|white|black|none",stroke:"gold|white|black|none",strokeWidth:2,fontSize:48,keyframes:[{t:0,x:100,y:200,scale:1,rotate:0,opacity:0},{t:1,x:300,y:200,scale:1,rotate:0,opacity:1}]}]}. Maksimal 16 layer, 2–12 keyframe unik berurutan; t relatif awal adegan, tidak melewati durasinya. Koordinat panggung 920×620, x/y titik pusat objek; pada layout overlay panggung ditampilkan lebih kecil, gunakan sedikit teks dan skala besar. Gabungkan bentuk/jalur untuk ilustrasi dan hubungan aksi–reaksi baru, bukan wajib katalog art. Warna/font mengikuti brand. Tidak menerima JavaScript, HTML, gambar/path file eksternal. Jika kebutuhan di luar alat, minta klarifikasi secara jujur. Jangan mengubah hal di luar arahan pengguna.`}

export function wantsPreviewRefresh(text:string){return /\b(perbarui|perbaharui|buat ulang)\b.*preview/i.test(text)&&!/^\s*(jangan|tidak perlu|apakah|bagaimana)/i.test(text)&&!/(ubah|ganti|tambahkan|perbesar|perkecil|gelapkan|terangkan|lebih gelap|lebih terang)/i.test(text.replace(/jangan[^.!?]*/gi,''))}
