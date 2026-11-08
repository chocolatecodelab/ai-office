export const LOCAL_FAQ = [
 {id:'schedule',question:'Jadwal kelas',keywords:['jadwal','jam kelas'],answer:'Jadwal perlu dikonfirmasi oleh tim brand sebelum diberikan kepada audiens.'},
 {id:'price',question:'Biaya program',keywords:['biaya','harga','cicilan'],answer:'Biaya dan ketentuan pembayaran perlu dikonfirmasi oleh tim brand.'},
 {id:'registration',question:'Pendaftaran',keywords:['daftar','pendaftaran'],answer:'Gunakan kanal pendaftaran resmi yang telah dikonfirmasi oleh tim brand.'},
] as const

export type CommentCategory='sensitive'|'complaint'|'spam'|'lead'|'faq'|'praise'|'manual'
/** Local deterministic baseline. Never hides comments, replies publicly, or follows comment instructions. */
export function classifyComment(text:string) {
 if(typeof text!=='string'||!text.trim()||text.length>2000)throw new Error('Komentar harus 1–2000 karakter.')
 const clean=text.normalize('NFKC').toLowerCase()
 let category:CommentCategory='manual'
 if(/bunuh diri|menyakiti diri|nomor (?:ktp|rekening)|\b\d{16}\b|\b(?:0|62|\+62)8\d{8,11}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(clean))category='sensitive'
 else if(/kecewa|komplain|keluhan|refund|penipuan|tidak dibalas|belum dibalas/.test(clean))category='complaint'
 else if(/judi|slot gacor|pinjol|klik link|ignore previous|abaikan (?:aturan|instruksi)|system prompt/.test(clean))category='spam'
 else if(/ingin (?:daftar|konsultasi)|mau (?:daftar|konsultasi)|hubungi saya|minat (?:kelas|program)/.test(clean))category='lead'
 const faq=category==='manual'?LOCAL_FAQ.find(item=>item.keywords.some(keyword=>clean.includes(keyword))):undefined
 if(faq)category='faq'
 if(category==='manual' && /terima kasih|bagus sekali|keren|bermanfaat/.test(clean))category='praise'
 return {category,faqId:faq?.id??null,reviewRequired:true,autoReply:false,moderationAction:'none' as const,
  suggestion:faq?.answer??null,reason:'Aturan kata kunci lokal; periksa konteks, ironi dan salah klasifikasi sebelum tindakan.'}
}

export function previewComments(input:unknown) {
 const comments=(input as {comments?:unknown}|null)?.comments
 if(!Array.isArray(comments)||comments.length<1||comments.length>20)throw new Error('Pilih 1–20 komentar simulasi.')
 const ids=new Set<string>()
 return comments.map(comment=>{
  if(!comment||typeof comment.id!=='string'||!comment.id.trim()||comment.id.length>100||ids.has(comment.id))throw new Error('ID komentar harus unik dan maksimal100 karakter.')
  ids.add(comment.id)
  return {id:comment.id,...classifyComment(comment.text)}
 })
}

export function mockComments(brandId:string) {
 return {brandId,mode:'mock',source:'local-fixture',comments:[
  {id:`${brandId}:qa-1`,text:'Berapa biaya program?'},
  {id:`${brandId}:qa-2`,text:'Saya ingin konsultasi.'},
  {id:`${brandId}:qa-3`,text:'Pesan saya belum dibalas, kecewa.'},
 ],note:'Data sintetis, bukan komentar Instagram. Tidak ada tindakan publik.'}
}

export function classifyCommentFiles(files:Array<{name:string;text:string}>) {
 const sources=files.filter(file=>file.name.toLowerCase().endsWith('.json'))
 if(!sources.length)throw new Error('Skill klasifikasi komentar membutuhkan JSON dengan objek comments: [{id,text}].')
 const comments:unknown[]=[]
 for(const file of sources){
  let data:unknown
  try{data=JSON.parse(file.text)}catch{throw new Error('Lampiran komentar bukan JSON yang valid.')}
  const batch=(data as {comments?:unknown}|null)?.comments
  if(!Array.isArray(batch))throw new Error('Lampiran JSON harus memiliki array comments.')
  comments.push(...batch)
 }
 return {mode:'local-preview',sources:sources.map(s=>s.name),items:previewComments({comments}),externalActions:false}
}
