# Desain OTCA

Panduan tampilan antarmuka kantor, mengikuti Brand Guidelines OTCA (`context/brands/otca/visual.json`, status RESMI).
Warna dan huruf di sini sama dengan guideline; bagian tata letak adalah keputusan antarmuka.

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
