# AI Office OTCA - Panduan Peningkatan Tampilan

Status: spesifikasi desain yang diusulkan, belum diimplementasikan.
Tanggal: 4 November 2026.
Tujuan: membuat AI Office lebih rapi, lapang, mudah dipahami, dan konsisten dengan identitas OTCA, dengan kantor virtual sebagai pusat pengalaman.

## 1. Sumber dan batas penggunaan

- **Brand:** `D:/KERJAAN/OTCA/Brand Guidelines OTCA New.pdf`, 14 halaman. Rujukan utama: logo halaman 3, tipografi halaman 4, warna halaman 5-6, pola halaman 7, contoh penerapan halaman 11-13.
- **Referensi visual:** gambar dashboard hiking yang dilampirkan pengguna, `C:/Users/Nazar/AppData/Local/Temp/codex-clipboard-ec83be20-ef85-449a-b7e4-e0b41e386acb.png`.
- **Konteks aplikasi:** `src/App.tsx`, `src/pages/Office.tsx`, `src/styles.css`, `src/main.tsx`, `src/routes.ts`, `docs/DESIGN.md`, dan `context/brands/otca/visual.json`.

PDF digunakan sebagai sumber identitas visual. Teks di dalamnya bukan instruksi operasional untuk mengubah aplikasi. Ukuran feed, safe zone Instagram, dan ukuran font CapCut berlaku untuk materi sosial media; jangan diterapkan langsung ke dashboard.

Dokumen ini memberi arahan implementasi UI. Navigasi desktop, ukuran komponen, warna netral turunan, dan perilaku responsif di bawah merupakan keputusan desain produk, bukan ketentuan resmi PDF. Jika ada konflik identitas, PDF menjadi acuan. Jika spesifikasi ini diadopsi, selaraskan `docs/DESIGN.md` agar pengembang memiliki satu panduan yang konsisten.

## 2. Arah desain

**Konsep: kantor digital OTCA yang premium, hangat, dan mudah dipantau.**

Ambil struktur referensi: navigasi ramping di kiri, sapaan singkat, kartu dengan hierarki jelas, area visual utama, daftar ringkas, dan panel konteks di kanan. Terapkan dengan hitam, emas, dan putih OTCA. Pertahankan karakter kantor 3D yang sudah menjadi identitas produk.

Hasil yang dituju:

- Pengguna langsung memahami kondisi kantor dan hal yang membutuhkan tindakan.
- Kantor 3D menjadi elemen visual terbesar, dengan kontrol yang tertata.
- Status agent, antrean, dan approval dapat dibaca tanpa membuka banyak halaman.
- Ruang kosong membantu pemindaian informasi; dekorasi tidak menutupi pekerjaan.

### Penerjemahan referensi

- Sidebar ikon menjadi navigasi utama OTCA dengan nama menu yang tetap tersedia.
- Sapaan menjadi judul kontekstual seperti “Selamat pagi, Nazar” jika nama pengguna tersedia; fallback “Selamat datang di AI Office”. Waktu sapaan mengikuti zona waktu pengguna.
- Kartu peta besar menjadi viewport kantor 3D/2D.
- Daftar teman menjadi daftar agent beserta status aktual.
- Panel profil menjadi ringkasan kantor atau detail agent terpilih.
- Daftar rekomendasi menjadi pekerjaan yang membutuhkan perhatian: approval dan antrean.
- Ilustrasi pendukung digantikan aset kantor yang sudah ada atau ilustrasi ruang kerja yang harmonis dengan brand.

Hindari menyalin warna biru pastel dominan, maskot hiking, pegunungan, metrik wisata, teks kecil pada contoh, atau ikon ekspansi yang menutupi konten. Referensi menentukan komposisi, bukan identitas maupun fitur baru.

## 3. Temuan pada kode saat ini

Proyek sudah memiliki Montserrat lokal, dukungan tema gelap/terang, lapisan brand OTCA, kartu membulat, serta kantor 3D dengan fallback 2D. Perbaikan perlu membangun di atas fondasi tersebut.

Hal yang perlu ditata berdasarkan pembacaan kode:

- Navigasi aplikasi saat ini berupa drawer tersembunyi; akses halaman utama dapat dibuat lebih terlihat pada desktop.
- Toolbar Office memuat banyak kontrol sejajar: tampilan, gedung, kamera, siang/malam, grafis, panduan, lift, animasi, dan refresh. Kelompokkan berdasarkan frekuensi penggunaan.
- Stylesheet memiliki token lama berbasis nilai warna dan lapisan override brand di akhir. Konsolidasikan secara bertahap untuk mengurangi perbedaan antarhalaman.
- Bahasa shell masih banyak memakai bahasa Inggris, sementara Office memakai bahasa Indonesia. Tetapkan bahasa Indonesia untuk label UI dengan istilah produk yang konsisten.

Temuan ini berasal dari kode; belum merupakan audit screenshot aplikasi yang berjalan.

## 4. Identitas visual wajib

### Warna resmi

- Hitam `#000000`: latar utama.
- Solid Gold `#CB9D31`: headline, subheadline, dan elemen pendukung.
- Putih `#FFFFFF`: teks isi dan elemen pendukung.
- Gradient Gold: `#CB9D31 → #FDF1A4 → #B3822C`, untuk elemen pendukung.

Pertahankan hitam sebagai bidang dominan pada tema utama. Sebagai panduan komposisi UI, gunakan kira-kira 75-85% bidang netral gelap, aksen emas secara terbatas, dan putih untuk informasi yang mudah dibaca. Persentase tersebut merupakan usulan UI, bukan angka dari PDF.

### Logo

- Gunakan aset logo resmi tanpa glow untuk sidebar dan header kecil, sesuai penggunaan logo kecil pada halaman 3.
- Pertahankan proporsi asli; jangan mengetik ulang atau membuat versi simbol baru.
- Ukuran praktis awal: lebar 96-120 px pada sidebar terbuka; pada rail gunakan varian kecil resmi bila tersedia. Jika belum ada, gunakan wordmark di header, bukan memotong logo.
- Glow hanya dipertimbangkan untuk tampilan brand besar; hindari pada kontrol dan label rutin.

### Tipografi

- Montserrat ExtraBold 800 untuk judul utama.
- Montserrat Bold 700 untuk subjudul dan penekanan.
- Montserrat Medium 500 atau SemiBold 600 untuk isi dan kontrol.
- Monospace hanya untuk kode, log, path, dan data yang memang memerlukan karakter sejajar.

Ukuran adaptasi web: judul halaman 28-36 px desktop dan 24-28 px mobile; judul kartu 16-18 px; isi 14-16 px; metadata 12-13 px; angka ringkasan 26-32 px. Isi memakai line-height 1,5-1,6. Label ringkas dapat memakai 1,3-1,4. Hindari huruf kapital panjang dan judul raksasa yang mendorong kantor keluar layar.

### Pola dan ilustrasi

Gunakan garis gradien emas sebagai aksen pemisah header atau identitas kartu utama. PDF menyebut ketebalan 7 untuk materi desain; adaptasi UI memakai 2-3 px agar ringan. Rectangle gradient gold boleh menjadi detail dekoratif kecil, dengan bidang hitam tetap dominan.

Gaya 3D atau vector diperbolehkan dalam PDF jika warnanya harmonis. Gunakan aset kantor yang sudah ada; tampilkan warna status pada indikator, bukan dengan mewarnai seluruh ruangan. Foto latar dan ketentuan transparansi contoh sosial media tidak perlu dibawa ke dashboard.

## 5. Token desain yang diusulkan

Warna netral dan semantik berikut adalah tambahan UI, bukan perluasan palet resmi untuk materi brand. Hubungkan token baru ke alias semantik yang sudah ada, lalu migrasikan pemakaiannya bertahap.

```css
:root {
  color-scheme: dark;
  --brand-black: #000000;
  --brand-gold: #cb9d31;
  --brand-white: #ffffff;
  --brand-gold-gradient: linear-gradient(90deg, #cb9d31, #fdf1a4 50%, #b3822c);

  --page-bg: #000000;
  --surface: #111111;
  --surface-2: #1a1a1a;
  --surface-3: #222222;
  --text: #ffffff;
  --text-muted: #b7b7b7;
  --text-dim: #929292;
  --border: #303030;
  --border-strong: #777777;
  --accent: var(--brand-gold);
  --on-accent: #000000;
  --accent-soft: rgb(203 157 49 / 12%);
  --focus-ring: #fdf1a4;

  --status-success: #74c59a;
  --status-warning: #e6be65;
  --status-danger: #ff9d8f;
  --status-info: #a9d4ff;

  --radius-card: 20px;
  --radius-control: 12px;
  --radius-pill: 999px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --shadow-card: 0 8px 24px rgb(0 0 0 / 16%);
}
```

Tema gelap memakai border tipis dan perbedaan permukaan sebagai pemisah utama. Bayangan lebih terlihat pada tema terang.

Tema terang merupakan alternatif kenyamanan UI: halaman `#F4F4F1`, kartu putih, teks `#171717`, teks sekunder `#59554B`, border dekoratif `#E3E0D4`, dan aksen teks `#8A6410`. Simpan `--brand-gold` tetap `#CB9D31`; ubah token fungsional `--accent`, bukan warna resmi. Label tombol pada solid gold menggunakan hitam di kedua tema. Jika tombol memakai emas gelap, tentukan label putih berdasarkan pengukuran kontras.

Target kontras: minimal 4,5:1 untuk teks biasa, 3:1 untuk teks besar dan indikator kontrol yang diperlukan. Ukur semua pasangan aktual, termasuk stop gradien, badge, placeholder, dan focus ring. Border dekoratif tidak boleh menjadi satu-satunya penanda kontrol. Angka token di atas tetap perlu diverifikasi saat implementasi.

## 6. Susunan halaman Office

### Desktop lebar, mulai 1280 px

Gunakan tiga area: rail navigasi 80 px, konten fleksibel `minmax(0, 1fr)`, dan panel konteks 288-320 px. Gap 24 px, padding luar 24-32 px. Konten dashboard dapat dibatasi sekitar 1600 px dan dipusatkan pada layar sangat lebar; mode kantor diperbesar dapat memakai seluruh ruang tersedia.

Urutan baca:

1. Header: nama halaman, sapaan singkat, status sinkronisasi, tema, dan tindakan segarkan.
2. Ringkasan: agent aktif, antrean tugas, approval terbuka, dan menunggu kuota.
3. Kartu kantor: pemilih lantai/brand, viewport 3D/2D, kontrol utama.
4. Kartu “Perlu perhatian”: approval atau pekerjaan yang perlu ditinjau, dengan tautan ke halaman terkait.
5. Panel kanan: ringkasan kantor dan daftar agent; berubah menjadi detail agent ketika dipilih.

Viewport kantor memiliki tinggi awal `clamp(360px, 52vh, 680px)`. Prioritaskan ruang kantor pada layar pendek: ringkasan harus ringkas dan halaman boleh bergulir secara normal. Jangan mengunci seluruh dashboard ke tinggi layar hingga konten terpotong.

### Navigasi

- Rail berisi ikon konsisten, indikator aktif emas, tooltip saat hover maupun fokus, dan nama aksesibel untuk setiap menu.
- Sediakan pilihan memperluas sidebar menjadi 224 px untuk label lengkap.
- Kelompok utama: Office, Task Board, Approval, Agents. Kelompok pendukung: Event, Calendar, Activity, Memory, Folders, Usage. Logs dan Settings berada di bagian utilitas.
- Semua route yang ada tetap dapat dijangkau; panel kanan tidak menggantikan halaman detail utama.
- Pada mode kantor diperbesar, sidebar dapat disembunyikan; sediakan tombol keluar yang jelas.
- Ini mengganti usulan drawer-only desktop di `docs/DESIGN.md`; drawer tetap digunakan pada mobile.

### Panel konteks kanan

Saat tidak ada agent dipilih: tampilkan nama kantor/brand aktif, jumlah agent pada lingkup tersebut, daftar agent dengan avatar, peran, status, dan tautan “Lihat semua agent”. Hindari kartu profil pengguna jika data profil belum tersedia.

Saat agent dipilih: tampilkan detail agent menggunakan kemampuan `OfficeAgentPanel` yang sudah ada. Nama, peran, status, tugas, dan tindakan tetap berasal dari data aktual. Tombol tutup mengembalikan ringkasan dan fokus ke pemicu pilihan. Panel desktop bersifat nonmodal; jika dipresentasikan sebagai dialog mobile, gunakan focus trap, Escape, dan pengembalian fokus.

### Ringkasan data

Label lingkup harus eksplisit: “Semua kantor” atau nama brand/lantai aktif. Total global dari `brands` tidak boleh diberi label seolah hanya milik lantai aktif. Pergantian lantai memperbarui informasi kontekstual tanpa mencampur lingkup hitungan.

Gunakan nilai yang benar-benar tersedia. Data belum dimuat ditampilkan sebagai skeleton atau “Belum tersedia”, bukan angka nol. Jumlah agent aktif tidak otomatis berarti semua agent sedang bekerja. Pisahkan data runtime yang teramati dari aktivitas animasi kantor.

## 7. Komponen dan interaksi

### Kartu

Sudut 20 px, padding 20-24 px, gap internal 12-16 px. Header kartu memuat satu judul, metadata singkat, dan maksimal satu tindakan sekunder. Kartu ringkasan memakai label 12-13 px dan nilai 26-32 px. Kartu statis tidak diberi hover yang menyiratkan dapat diklik.

### Tombol, input, dan ikon

- Satu tindakan primer per area; emas dengan label hitam. Gunakan gradien secara terbatas, terutama pada aksen brand.
- Tombol sekunder memakai surface dan border; tombol tersier berupa teks atau ikon dengan label aksesibel.
- Tinggi kontrol utama 40-44 px, target sentuh mobile minimal 44 × 44 px. Ini meningkatkan batas lama 28 px di panduan proyek.
- Input memakai label yang tetap terlihat, border yang dapat dikenali, dan error dekat kolom terkait.
- Ikon memakai satu gaya outline, ukuran 18-20 px dan ketebalan konsisten. Hindari campuran emoji, karakter Unicode, dan ikon berbeda gaya untuk kontrol rutin.
- Pencarian hanya ditampilkan jika benar-benar bekerja; implementasi awal dapat memakai filter lokal pada daftar agent. Pencarian global dan notifikasi baru tidak menjadi syarat redesign.

### Toolbar kantor

Bar utama memuat pemilih lantai, toggle 2D/3D, dan “Perbesar kantor”. Kelompok pengaturan sekunder berada di menu “Pengaturan tampilan”: grafis, siang/malam, panduan status, dan jeda aktivitas. Reset kamera dan lift dapat berada pada kontrol viewport yang ringkas dan mudah dijangkau.

Segarkan data cukup satu kontrol yang jelas. Kelompok baru harus mempertahankan seluruh kemampuan lama, termasuk akses keyboard. Kontrol yang hanya berlaku untuk 3D dinonaktifkan dengan penjelasan ketika 2D aktif. Tema aplikasi dan siang/malam adegan adalah pengaturan terpisah dengan label yang tidak membingungkan.

### Status dan approval

Gunakan label teks bersama titik atau ikon: “Bekerja”, “Siaga”, “Menunggu persetujuan”, “Menunggu kuota”, “Gagal”, atau “Tidak diketahui”, sesuai status backend. Warna semantik hanya membantu pembacaan; emas tetap menunjukkan identitas, pilihan aktif, dan penekanan.

Kartu approval menampilkan konteks tindakan dan objek yang akan dipengaruhi. Pertahankan langkah review, aturan izin, serta status pending/error yang sudah ada. Disable tombol saat permintaan berlangsung untuk mencegah pengiriman ganda. Jangan mengubah status runtime hanya melalui animasi atau notifikasi sukses lokal.

## 8. Penerapan pada halaman lain

- **Agents:** grid kartu avatar, nama, peran, status, dan tindakan detail. Pemilihan agent konsisten dengan panel Office.
- **Task Board:** kolom dan kartu lebih rapi, status terbaca, filter di atas. Pada mobile gunakan pemilih kolom atau area horizontal khusus board, bukan overflow seluruh halaman.
- **Approval:** dahulukan item yang menunggu keputusan; pisahkan riwayat dan gunakan tindakan primer yang jelas.
- **Usage:** angka, unit, periode, dan lingkup selalu terlihat. Grafik hanya memakai data tersedia; jangan membuat tren atau persentase perubahan fiktif.
- **Event, Calendar, Activity:** struktur tanggal/waktu konsisten dan kepadatan informasi terkontrol.
- **Memory dan Folders:** area pencarian/filter jelas, pemisahan daftar dan preview, nama file panjang tidak memecahkan layout.
- **Logs:** monospace untuk isi log, filter status, pembungkusan atau scroll lokal untuk baris panjang.
- **Settings dan layar kunci:** gunakan tipografi, field, tombol, dan pesan validasi yang sama; kelompokkan pengaturan berdasarkan tugas pengguna.

## 9. Responsif dan aksesibilitas

- **1024-1279 px:** rail tetap terlihat, panel kanan menjadi drawer sesuai kebutuhan, konten utama mengisi sisa ruang. Ringkasan dapat menjadi grid 2 × 2.
- **768-1023 px:** satu area konten utama dengan rail ringkas jika cukup; panel agent dibuka melalui tombol berlabel. Kontrol viewport membungkus dengan rapi.
- **Di bawah 768 px:** navigasi drawer, padding 16 px, kartu bertumpuk, ringkasan 2 × 2. Panel konteks menjadi sheet/dialog. Viewport sekitar 280-360 px sesuai ruang tersedia.
- **320-390 px:** judul dan tombol boleh membungkus; tidak ada scroll horizontal halaman. Tabel, board, dan log boleh memiliki scroll lokal yang diberi konteks.

Semua fungsi inti harus tersedia dengan keyboard. Gunakan elemen button/link asli, `aria-current` pada navigasi, `aria-pressed` untuk toggle, dan label pada kontrol ikon. Focus ring minimal 2 px dengan offset 3 px. Sediakan skip link menuju konten utama.

Tampilan 2D harus menjadi alternatif interaktif yang memadai bagi pengguna tanpa WebGL atau yang tidak dapat mengoperasikan canvas 3D. Pemilihan agent juga tersedia melalui daftar teks.

Dukung zoom 200%, label panjang, reduced motion, dan scroll konten tanpa menutup tindakan penting. Hormati pengaturan motion yang sudah ada. Transisi UI 150-200 ms; kurangi atau hilangkan untuk `prefers-reduced-motion`. Status sinkronisasi memakai live region yang tidak membacakan setiap polling secara mengganggu.

## 10. Kondisi tampilan wajib

- **Loading:** skeleton untuk angka/daftar dan placeholder viewport berukuran stabil.
- **Kosong:** jelaskan penyebab dan tindakan yang relevan; “Belum ada approval” berbeda dari gagal memuat approval.
- **Koneksi terganggu:** pertahankan data terakhir dengan label kedaluwarsa dan waktu pembaruan; tawarkan coba lagi.
- **Gagal memuat 3D:** fallback ke 2D dengan penjelasan singkat; alur kerja tetap tersedia.
- **Akses terkunci:** pertahankan layar kunci dan batas akses profil yang sudah ada.
- **Pending tindakan:** indikator proses, pencegahan klik ganda, serta pesan gagal yang memberi langkah berikutnya.
- **Teks panjang:** wrap atau truncation dengan cara melihat teks lengkap; jangan memotong status penting.

## 11. Rencana implementasi

1. Konsolidasikan token semantik dan tipografi dalam `src/styles.css`. Pertahankan aset 3D serta warna semantik yang bermakna. Hindari menambahkan lapisan override panjang baru.
2. Susun shell di `src/App.tsx`: rail desktop, drawer mobile, header ringkas, fokus keyboard, dan label bahasa Indonesia. Pertahankan hash route, refresh, pemberitahuan versi, dan mekanisme lock.
3. Susun ulang `src/pages/Office.tsx`: ringkasan, kartu viewport, toolbar berkelompok, serta panel konteks. Gunakan sumber data dan lifecycle live update yang sudah ada.
4. Sesuaikan `OfficeAgentPanel`, kartu approval, dan form tugas dengan komponen visual bersama. Jangan mengubah kontrak API, izin, maupun alur persetujuan sebagai bagian styling.
5. Terapkan pola kartu, label, field, dan keadaan tampilan ke halaman lain. Hapus aturan CSS lama hanya setelah seluruh pemakai diperiksa.
6. Selaraskan `docs/DESIGN.md` dengan keputusan final dan jalankan pemeriksaan visual serta regresi yang relevan.

Komponen presentasional yang dapat dipisahkan sesuai kebutuhan: `AppRail`, `PageHeader`, `SummaryCard`, `OfficeToolbar`, `AgentList`, `ContextPanel`, dan `StatusBadge`. Hindari abstraksi baru jika komponen yang ada sudah cukup.

## 12. Kriteria selesai

- [ ] Warna brand, Montserrat, dan proporsi logo sesuai sumber; warna turunan UI dibedakan dari warna resmi.
- [ ] Tampilan mengambil hierarki dan ruang kosong referensi, dengan kantor virtual OTCA sebagai fokus.
- [ ] Semua route dan kontrol kantor lama tetap tersedia, termasuk fallback 2D.
- [ ] Ringkasan dan daftar agent memakai data aktual dengan lingkup yang jelas.
- [ ] Approval, task, lock, refresh, polling, dan live update tetap berfungsi.
- [ ] Keadaan loading, kosong, gagal, stale, pending, dan terkunci dapat dibedakan.
- [ ] Tampilan diperiksa pada 1440, 1280, 1024, 768, 390, dan 320 px, dalam tema gelap dan terang.
- [ ] Tidak ada teks terpotong, kontrol bertumpuk, atau overflow horizontal halaman.
- [ ] Kontras, fokus keyboard, dialog, zoom 200%, reduced motion, dan alternatif daftar untuk canvas diperiksa.
- [ ] Pemeriksaan lint/build dan tes relevan yang sudah ada lulus setelah implementasi; sertakan screenshot sebelum/sesudah dengan data yang sama.

Dokumen ini selesai ketika spesifikasi tersimpan. Checklist di atas merupakan syarat penerimaan untuk tahap implementasi berikutnya, bukan klaim bahwa UI telah diubah atau diuji.
