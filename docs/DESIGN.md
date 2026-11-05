# Desain OTCA

Panduan tampilan antarmuka kantor, mengikuti Brand Guidelines OTCA (`context/brands/otca/visual.json`, status RESMI).
Warna dan huruf di sini sama dengan guideline; bagian tata letak adalah keputusan antarmuka.

## Penerapan 4 November 2026

Pemakaian kini memakai ringkasan empat metrik, komposisi input/output, sorotan penggunaan terbesar, dan grafik ranking yang dapat diganti antara Brand/Agent/Jenis pekerjaan/Model serta Token/Eksekusi/Biaya LiteLLM. Semua baris memakai skala yang sama dari nol dan dapat dibuka untuk angka rinci; nilai nol tidak diberi panjang bar minimum palsu. Bagian Langfuse memiliki metrik dan grafik model sendiri, tidak dijumlahkan dengan catatan kantor. API saat ini menyediakan agregat periode, sehingga grafik menunjukkan perbandingan kategori, bukan tren waktu rekaan. Pemilih periode membuat reader baru untuk menghindari respons lama tampil sebagai periode baru. Konteks filter kelompok/ukuran tetap dipertahankan saat periode diganti.

Perapian halaman operasional: Agent memakai kartu satu kolom dengan portrait/peran/status, ringkasan pekerjaan, Chat/Beri tugas, dan konfigurasi yang dapat dibuka. Aktivitas memakai riwayat dengan judul aksi bermakna; Memori memakai selector lingkup dan daftar panduan di samping pembaca Markdown yang dirender lewat React (tanpa HTML mentah). Log memakai baris nama/status/latensi dan panel tugas gagal terpisah. Pengaturan memiliki navigasi bagian, detail peran, baris integrasi, kartu budget, dan status koneksi. Semua halaman memakai skala judul 30 px desktop / 26 px mobile dan permukaan tanpa bayangan berulang.

Pemakaian dan budget menampilkan USD serta estimasi IDR memakai kurs tetap yang diminta pengguna: USD_TO_IDR = 18168 dalam src/usage.ts. Konversi memakai angka USD asli sebelum pembulatan tampilan, lalu dibulatkan ke rupiah penuh dengan tanda estimasi; kurs bukan data pasar otomatis. Angka Langfuse tetap estimasi, bukan tagihan ChatGPT Plus. Konversi Langfuse tetap tampil walaupun periode lokal belum memiliki run.

Tindak lanjut audit: roster desktop tetap 304 px, panel kerja agent terbuka memakai 460 px. Di bawah 1280 px tersedia pilihan Tim/Kantor 3D, dengan Tim sebagai akses awal; brand dapat dipilih tanpa membuka scene. CTA Beri tugas tersedia dari Office/board dan kartu Agent. Detail tugas memakai dialog yang mempertahankan filter board, menghubungkan hasil, berkas, dan approval dalam konteks brand yang sama. Preview hasil memakai komponen Berkas yang sudah tersedia.

Arah design.md diadopsi untuk shell dan Office: rail desktop 80 px yang dapat diperluas, drawer mobile, Montserrat, ringkasan dengan lingkup semua kantor, viewport utama, pencarian agent, area perlu perhatian, serta panel nonmodal pada layar >=1280 px. Pada layar kecil detail agent tetap dialog. Kontrol sekunder berada di Pengaturan tampilan; perbesar kantor dapat ditutup dengan Escape.

Komposisi workspace dikelola dalam src/workspace.css, terpisah dari primitif lama styles.css. Dokumen ini menggantikan aturan drawer-only desktop dan label kapital berjarak lebar untuk UI rutin di bagian lama di bawah. Semua route/API/approval tetap memakai alur yang sama. Pemeriksaan visual bukan pernyataan kelulusan seluruh audit WCAG.

Validasi penerapan: build produksi, lint berkas yang diubah, dan 52 berkas pengujian lulus (275 tes, 1 dilewati). Tema gelap dan terang diperiksa pada lebar 1440, 1280, 1024, 768, 390, dan 320 px tanpa overflow horizontal halaman. Pencarian agent, drawer mobile, dan panel detail desktop juga diperiksa di browser lokal. Perubahan ini menyempurnakan shell dan halaman Office; pemeriksaan visual mendalam seluruh halaman lain tetap pekerjaan lanjutan.

## Identitas
- **Nama produk:** OTCA (sebelumnya "Ruang"). Perintah `ruang`, variabel `RUANG_*`, dan nama ruangan berbahasa Indonesia ("Ruang kerja") tidak berubah.
- **Kesan:** eksklusif, premium, kredibel; hitam dan emas, tetap hangat dan mudah dibaca.

## Warna
| Peran | Gelap | Terang |
|---|---|---|
| Halaman | `#000000` | `#F4F4F1` |
| Kartu | `#111111` (permukaan `#1A1A1A`) | `#FFFFFF` |
| Emas utama (judul, aksen, status aktif) | `#CB9D31` | `#8A6410` (digelapkan agar kontras ≥ 4,5:1 di atas putih) |
| Gradien emas (garis header, tombol utama) | `#CB9D31 → #FDF1A4 → #B3822C` | sama |
| Teks isi | putih / abu terang | hitam / abu tua |

Aturan: hitam adalah latar utama, emas untuk judul dan elemen pendukung, putih untuk teks isi. Warna status (hijau berhasil,
merah gagal, biru info) tetap bertahan karena maknanya semantik. Warna tidak pernah menjadi satu-satunya petunjuk: status
selalu bertulisan.

Semua warna adalah token di `src/styles.css`: blok `:root` (gelap) dan `:root[data-theme="light"]` (terang) untuk palet,
alias semantik (`--surface`, `--border`, `--text`, `--accent`), dan lapisan "OTCA brand layer" di akhir berkas.
Komponen baru memakai alias semantik, bukan nilai heksa.

## Huruf
Montserrat, dimuat dari `@fontsource/montserrat` (500, 600, 700, 800). Kode memakai monospace sistem.
- Judul halaman: ExtraBold 800, emas. Sub-judul: Bold 700. Isi: Medium 500 / SemiBold 600.
- Label kecil (eyebrow, lencana): Bold, huruf kapital, jarak huruf lebar.

## Bentuk dan tata letak
- Kartu bersudut 16 px di atas halaman yang tenang; di mode terang kartu putih dengan bayangan lembut, di mode gelap
  cukup garis tipis. Kontrol berbentuk pil.
- Satu-satunya hiasan: **garis gradien emas** di bawah header (guideline: "line gradient gold") dan tombol utama bergradien emas.
- Navigasi tetap menjadi laci (tombol menu, tombol M) agar kantor 3D memenuhi layar.
- Fokus papan ketik: garis emas 2 px. Target sentuh minimal 28 px. Gerak dikurangi bila sistem memintanya.

## Yang tidak berubah
- Aset 3D kantor (logo OTCA di dinding dan papan) memakai warna aslinya.
- PDF dan dokumen berbrand memakai templat sendiri (`server/office/pdf-html.ts`) dengan palet yang sama.

## Cara memeriksa
Buka tiap halaman di mode gelap dan terang, lebar 1280 dan 390 px, lalu cek kontras teks emas di atas putih dan hitam.
