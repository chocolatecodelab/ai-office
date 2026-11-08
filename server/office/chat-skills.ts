export interface ChatSkill {id:string;name:string;description:string;instruction:string}
const common:ChatSkill[]=[
  {id:'document-search',name:'Cari di dokumen',description:'Menjalankan pencarian bagian dokumen dengan sumber yang cocok.',instruction:'Gunakan hasil tool pencarian dokumen sebagai bukti. Rujuk nama sumber dan bagian, bukan nomor halaman yang tidak tersedia.'},
  {id:'csv-profile',name:'Analisis tabel CSV',description:'Menghitung baris, kolom, nilai kosong dan rentang angka dari lampiran CSV.',instruction:'Jelaskan hasil perhitungan tool CSV dan keterbatasan data. Jangan mengarang statistik tambahan.'},
  {id:'review-draft',name:'Review draft',description:'Menilai kejelasan, konsistensi brand, dan klaim yang perlu diverifikasi.',instruction:'Review input dengan bagian: temuan menurut prioritas, perbaikan konkret, klaim yang perlu diverifikasi. Jangan mengklaim fakta sudah diverifikasi tanpa sumber.'},
  {id:'document-analysis',name:'Analisis dokumen',description:'Membaca lampiran dan menyusun temuan dengan nama sumber.',instruction:'Analisis dokumen yang dilampirkan. Pisahkan fakta sumber, kesimpulan, dan informasi yang belum diketahui. Rujuk nama berkas; jangan mengarang nomor halaman.'},
]
const role:Record<string,ChatSkill>={
  manager:{id:'team-brief',name:'Susun brief tim',description:'Menyusun tujuan, pemilik pekerjaan, input dan kriteria hasil.',instruction:'Susun brief terstruktur berisi tujuan, pemilik utama sesuai RACI, input tersedia, keluaran, dependensi, kriteria selesai, approval. Ini penyusunan brief, bukan bukti tugas sudah didelegasikan.'},
  'content-creator':{id:'content-outline',name:'Struktur konten',description:'Menyusun angle, headline, isi, CTA dan catatan QC.',instruction:'Susun konten dengan tujuan/audiens, angle, headline, isi per bagian, CTA, sumber, dan QC. Jangan mengklaim gambar sudah dihasilkan.'},
  'video-editor':{id:'video-plan',name:'Rencana video',description:'Menyusun storyboard, shot list dan kebutuhan editing.',instruction:'Susun storyboard dengan urutan scene, durasi perkiraan, visual, audio, teks layar, dan kebutuhan aset. Nyatakan ini rencana, bukan video yang sudah dirender.'},
  'social-media-manager':{id:'publishing-plan',name:'Kalender publikasi',description:'Menyusun jadwal draft dan checklist review.',instruction:'Susun draft kalender publikasi: kanal, konten, jadwal (tandai bila belum dikonfirmasi), CTA, pemilik, status approval. Jangan melakukan atau mengklaim posting.'},
  'digital-marketing':{id:'campaign-brief',name:'Brief campaign',description:'Menyusun hipotesis, audiens, variasi copy dan metrik.',instruction:'Susun draft campaign: tujuan, hipotesis, audiens, copy, kebutuhan aset, metrik, batasan dan approval budget. Jangan mengaktifkan iklan.'},
  'event-specialist':{id:'event-outline',name:'Rencana event',description:'Menyusun konsep, kebutuhan, risiko dan pembagian peran.',instruction:'Susun draft event dengan tujuan, konsep, audiens, kebutuhan, rundown, risiko, PIC dan data yang perlu dikonfirmasi. Jangan mengklaim sudah menghubungi pihak luar.'},
}
const community:ChatSkill={id:'comment-classification',name:'Klasifikasi komentar',description:'Tool lokal membaca JSON comments (id, text), maksimal20 komentar. Tidak membalas atau memoderasi akun.',instruction:'Gunakan hasil tool klasifikasi komentar sebagai pemeriksaan awal. Tampilkan kategori, prioritas review dan keterbatasan; koreksi salah klasifikasi bila konteks mendukung. FAQ hanya draf internal yang belum disetujui. Jangan mengirim balasan, menyembunyikan komentar, atau mengklaim sudah membaca akun sosial nyata.'}
export const chatSkills=(agent:string):ChatSkill[]=>[...common,...(role[agent]?[role[agent]]:[]),...(agent==='social-media-manager'?[community]:[])]
export const skillExecution=(id:string)=>['document-search','csv-profile','comment-classification'].includes(id)?'tool' as const:'instruction' as const
export function selectedSkills(agent:string,ids:unknown):ChatSkill[]{
  if(ids===undefined)return []
  if(!Array.isArray(ids) || ids.length>3 || new Set(ids).size!==ids.length)throw new Error('Pilih maksimal 3 skill yang berbeda.')
  return ids.map(id=>{const skill=chatSkills(agent).find(s=>s.id===id);if(!skill)throw new Error('Skill tidak tersedia untuk agent ini.');return skill})
}
