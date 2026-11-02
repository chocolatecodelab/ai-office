# Rencana Kantor 3D AI Office OTCA

Rencana kerja kantor 3D (blueprint L3, di `docs/PLAN.md` menjadi L5), dikerjakan **lebih dulu** karena tidak
menunggu data dari tim. Turunan dari Blueprint v3.1 Bab 19 L3, FR-60–FR-63, dan keputusan Pengguna 2 November 2026.

- Versi: 1.0 · 2 November 2026
- Status: **DRAFT**, siap dikerjakan
- Penanda: **[BP]** = blueprint · **[KEPUTUSAN]** = dipilih Pengguna · **[KONFIRMASI]** = belum diputuskan

---

## 1. Tujuan dan gerbang

Staf membuka satu halaman dan langsung tahu: agent mana sedang bekerja, mana yang menunggu approval, mana yang
tidur karena kuota habis, dan bisa memberi tugas atau menyetujui hasil langsung dari meja agent.

**Gerbang lulus [BP L3]:**
1. Status avatar sinkron dengan status tugas di server (7 status, real-time).
2. OTCA tampil 6 meja, sister brand masing-masing 4 meja, dibaca dari `agents.json`.
3. Approve/tolak dan beri tugas bisa dilakukan dari kantor 3D.
4. Lancar di laptop dan HP kelas menengah (target ≥ 30 fps, unduhan awal ≤ 8 MB).

## 2. Keputusan

| Topik | Keputusan | |
|---|---|---|
| Bentuk gedung | **Gedung bertingkat**: lantai dasar bersama + lantai 1–4 per brand, dengan tombol pindah lantai dan tampilan potongan gedung | [KEPUTUSAN] |
| Area santai | **Bersama di lantai dasar**: lobi, lounge, game room, ruang rapat, pantry; gang & jajanan di luar gedung. Agent idle turun ke lantai dasar | [KEPUTUSAN] |
| Aset 3D | **Furnitur & interior: model GLB** (Kenney Furniture Kit, CC0) dengan kompresi Draco. **Karakter: tetap avatar Ruang** yang dibuat dari kode | [KEPUTUSAN] (karakter diubah 2 Nov setelah uji K0) |
| Panel meja | **Tugas + Approval + beri tugas**. Chat langsung dengan agent (runtime lama) dihapus | [KEPUTUSAN], [BP L3-05] |
| Sumber data | API office baru (`/api/office/brands` + WebSocket), bukan `claude-service` lama | PLAN 5.3 |
| Meja | **Meja tetap per agent** dengan papan nama peran, bukan *hot desking* | [BP]: "jumlah meja dari agents.json" |

## 3. Kondisi sekarang

Kantor 3D Ruang (`src/pages/Office3D.tsx`, `src/office3d-layout.ts`, `src/scene3d/`, sekitar 2.400 baris) sudah punya:
- Mesin pendukung yang **dipakai ulang**: kamera orbit dengan batas geser, mode siang/malam, label melayang, jalur jalan agent, pemilihan lantai, dialog detail, dan fallback 2D bila WebGL tidak ada.
- Isi gedung yang **diubah**: satu lantai kerja dengan meja yang bertambah ke kiri; lantai 2 berisi kamar, balkon, hammock, dan lesehan (**dihapus**); lounge, game room, ruang rapat, pantry, gang, gerobak bakso, dan kopi sepeda (**dipindah ke lantai dasar**).
- Semua bentuk masih **prosedural** (kotak dan silinder dari kode), jadi akan diganti GLB.
- Datanya masih dari runtime lama, memakai state `Idle/Working/Reviewing/Collaborating`. Ini diganti dengan 7 status blueprint.

## 4. Desain gedung

```
            ┌─────────── Lantai 4 · Jepang Koey (4 meja) · hitam/merah ───────────┐
            ├─────────── Lantai 3 · Ciao Manda (4 meja) · merah #D40000 ─────────┤
   lift +   ├─────────── Lantai 2 · Info Jerman (4 meja) · kuning #F3CF45 ───────┤
   tangga   ├─────────── Lantai 1 · Official OTCA (6 meja) · hitam/emas #CB9D31 ──┤
            └─ Lantai dasar · lobi & resepsionis · lounge · game room · rapat · pantry ─┘
               gang: gerobak bakso & kopi sepeda · trotoar · jalan · bendera
```

### Lantai dasar (bersama)
- **Lobi dan resepsionis:** papan "AI Office OTCA" dan papan arah ke 4 lantai.
- **Lounge, game room, pantry dan galon:** semua dipindah dari lantai 1 sekarang.
- **Ruang rapat bersama:** dipakai bila rapat lintas agent diaktifkan lagi, dan sebagai dekor sampai saat itu.
- **Inti vertikal:** lift + tangga di satu sisi gedung. Agent yang pindah lantai berjalan ke lift, lalu muncul di lantai tujuan.

### Lantai brand (1–4)
- Ukuran tapak sama di semua lantai. Mejanya disusun dari `agents.json`: OTCA 6 meja (Manager + 5 agent), sister brand 4 meja (Manager + 3 agent).
- Meja Manager diletakkan paling depan, dekat pintu lift, karena ia "resepsionis" lantai itu.
- **Identitas brand** dari `visual.json`:
  - warna aksen untuk dinding, karpet, dan kursi;
  - papan nama lantai berisi nama brand dengan font resmi (Montserrat atau Lato);
  - suasana per brand: OTCA hitam-emas eksklusif, Info Jerman krem-kuning hangat, Ciao Manda merah-putih, Jepang Koey hitam dengan aksen merah.
- **Logo resmi** dipasang bila Brain sudah menyerahkan aset (L0-09). Sampai saat itu dipakai teks nama brand.
- Setiap meja punya papan nama peran ("Event Specialist"), monitor yang menyala saat bekerja, dan lampu status kecil.

### Tampilan
- **Tombol lantai** `G · 1 · 2 · 3 · 4`, dengan warna brand di tiap tombol. Kamera bergeser halus antar lantai, dan lantai di atasnya disembunyikan.
- **Potongan gedung (overview):** semua lantai ditumpuk seperti rumah boneka, dengan detail rendah. Gunanya untuk melihat seluruh kantor sekaligus; klik satu lantai untuk masuk.
- Lantai pertama yang dibuka adalah lantai yang punya agent paling "mendesak" (approval atau error); kalau tidak ada, lantai 1 OTCA.
- Mode siang/malam tetap ada.

## 5. Status avatar (FR-61)

Status dihitung server dari tugas agent (`server/office/status.ts`) dan dikirim lewat WebSocket.

| Status | Posisi | Animasi & tanda | Meja |
|---|---|---|---|
| `idle` | Lantai dasar: lounge, game room, pantry, jajanan (bergiliran seperti sekarang) | jalan / duduk santai / main | monitor mati |
| `working` | Di mejanya | mengetik; gelembung judul tugas | monitor menyala, lampu hijau |
| `waiting_quota` | Di mejanya | **tidur** di meja (kepala di meja, "Zzz"); jam reset kuota di label | lampu biru redup |
| `waiting_approval` | Di mejanya | duduk menunggu, ikon dokumen ✋; jenis approval di label | lampu kuning berkedip |
| `revision` | Di mejanya | mengetik cepat, ikon pensil merah | lampu oranye |
| `error` | Berdiri di samping meja | bingung (garuk kepala), ikon ⚠ | lampu merah |
| `paused` | Di mejanya | duduk diam, avatar dibuat abu-abu | papan "DIJEDA" |

Jumlah per lantai juga ditampilkan di tombol lantai, misalnya `1 OTCA · 2 menunggu approval`, supaya tidak perlu membuka tiap lantai.

## 6. Panel meja (FR-62)

Klik avatar atau meja untuk membuka panel samping dengan tiga bagian:
1. **Tugas agent:** tugas aktif dan riwayat terakhir beserta statusnya. Klik satu tugas untuk melihat hasil terbaru.
2. **Approval:** hasil yang menunggu approval untuk agent ini, dengan tombol setujui atau tolak beserta catatan. Logikanya sama dengan halaman Approval (`src/pages/Approvals.tsx`, dipakai ulang sebagai komponen).
3. **Beri tugas:** judul, brief, jenis pekerjaan (pilihan sesuai agent), prioritas, dan label mendesak.
   - Untuk Event Specialist ada pintasan ke halaman Event.
   - Label mendesak baru dibatasi per peran setelah login dan RBAC aktif (L4).

Tab Chat, Memory, dan Folder dari Ruang lama dihapus dari panel ini.

## 7. Aset GLB

### Sumber
Prioritas aset berlisensi **CC0**, sehingga bebas dipakai komersial tanpa atribusi:
- **Furnitur dan interior kantor:** paket CC0 seperti Kenney *Furniture Kit*, dan paket kantor/interior dari Quaternius atau Poly Pizza (hanya yang CC0).
- **Karakter:** satu model dasar yang sudah di-*rig*, dengan animasi minimal: idle, jalan, duduk, mengetik, tidur, dan bingung. Kandidat utamanya paket karakter animasi CC0 dari Quaternius. Animasi yang tidak ada di paket dibuat dari pose sederhana atau di-*retarget*.
- Setiap aset dicatat di `docs/aset-3d.md` (nama, sumber, URL, lisensi, tanggal unduh). Aset tanpa lisensi yang jelas **tidak dipakai**.
- **[KONFIRMASI]** Kalau tim punya anggaran untuk aset berbayar atau desainer 3D, kualitas bisa naik, tapi rencana ini tidak bergantung padanya.

### Pipeline
```
aset-sumber/ (tidak di-git, besar)  →  scripts/optimize-models.mjs (gltf-transform)  →  public/models/*.glb
```
- **Optimasi dengan `@gltf-transform/cli`:**
  - gabung mesh dan material;
  - hapus data yang tidak dipakai;
  - kompres geometri dengan **Draco** dan tekstur dengan **WebP/KTX2**;
  - batasi ukuran tekstur 1024 px (512 px untuk props kecil).
- **Decoder Draco disajikan dari server sendiri** (`public/draco/`, disalin dari `three/examples/jsm/libs/draco`), bukan dari CDN.
- **Batas ukuran:** gedung + lantai dasar ≤ 3 MB, tiap lantai brand ≤ 1 MB, karakter ≤ 1,5 MB (dipakai bersama 18 agent).
- **Warna per agent** diatur dengan *material override* (baju sesuai peran, aksen sesuai brand), jadi cukup satu file karakter.

## 8. Kinerja dan perangkat

- Hanya lantai yang sedang dilihat yang dirender penuh; lantai lain dan tampilan potongan memakai LOD rendah.
- Meja, kursi, dan monitor yang berulang memakai **instancing**. Bayangan hanya untuk lampu utama, dengan peta bayangan kecil di HP.
- **Lazy load:** model lantai brand baru diunduh saat lantai itu dibuka; ada layar pemuatan dengan progres.
- **Uji di:** laptop pengembangan, satu HP Android kelas menengah, dan Chrome mode mobile.
  - Batas minimal: 30 fps dan memori GPU wajar.
  - **[KONFIRMASI]** Model HP uji yang dipakai staf.
- Bila WebGL tidak ada atau terlalu lambat, tampilkan **tampilan 2D**: daftar lantai, kartu agent, dan statusnya.

## Hasil K0 (2 Nov 2026)

- **Pipeline:**
  - `scripts/optimize-models.mjs` menghasilkan `public/models/furniture.glb`, berisi 47 furnitur dengan total 103 KB.
  - Decoder Draco disajikan dari server sendiri (`public/draco/`).
  - Unduhan furnitur + decoder sekitar 1,2 MB dan termuat dalam ±0,1–0,9 detik di laptop.
- **Skala:** furnitur Kenney berukuran setengah skala avatar, jadi dipakai faktor skala **2**.
- **Karakter:**
  - Karakter GLB Quaternius sempat diuji (pria/wanita ber-rig, 10 animasi) lalu **dibatalkan** karena terlihat aneh.
  - Avatar Ruang dipindah ke `src/scene3d/character.tsx` dan dipakai bersama kantor lama dan Lab 3D.
  - Pose **tidur** (badan condong ke meja, tangan dilipat) dan **kerja** (mengetik) sudah teruji.
- **Kinerja:**
  - 18 avatar Ruang memakai 48 ribu segitiga dan sekitar 300 draw call. Sebagai perbandingan, karakter Quaternius memakai 533 ribu segitiga.
  - Panel browser bawaan membatasi tampilan di 30 fps, jadi angka fps sebenarnya diukur di HP uji (K6).
  - Draw call bisa diturunkan nanti dengan menggabungkan bagian avatar.
- **Logo:**
  - Logo keempat brand ada di `public/brands/<slug>/`. Logo Info Jerman adalah wordmark yang dirender dari vektor PDF.
  - Sumber semua aset dan logo dicatat di `docs/aset-3d.md`.
- **Halaman uji:** `#/lab-3d`, dihapus setelah K4.

## Hasil K1 (2 Nov 2026)

- **Tata letak di `src/office3d/building.ts`.** Ini fungsi murni yang menerima daftar brand dan krunya, lalu menghasilkan lantai, meja, zona ruangan, tempat santai, dan jalur jalan. Tata letak lama (`src/office3d-layout.ts`) masih dipakai halaman Office sampai K2.
  - **Gedung:** 20 × 11 m, tinggi tiap lantai 3,4 m. Lantai dasar dipakai bersama; lantai 1–4 berurutan OTCA, Info Jerman, Ciao Manda, Jepang Koey.
  - **Lantai brand:** meja spesialis berjajar di dinding belakang di bawah papan logo, dengan meja Manager di depan dekat lift. OTCA punya 6 meja, sister brand masing-masing 4.
  - **Lantai dasar:** ada 5 zona dengan pintu masing-masing (game room, ruang rapat, pantry, lounge, lobi), ditambah 12 tempat santai, termasuk gerobak bakso dan kopi di gang.
- **Jalur jalan.** Setiap tempat punya "jalan keluar" ke lorong lantainya. Perpindahan antar lantai hanya lewat lift: lajur di depan lift, masuk ke dalam lift, naik atau turun, lalu keluar.
- **Test (`src/office3d/building.test.ts`, 8 test).** Yang diuji:
  - urutan lantai dan jumlah meja per lantai;
  - meja tidak saling tumpuk, berada di luar inti lift dan lorong, dan meja Manager paling dekat ke lift;
  - lebih dari 400 jalur antar tempat tidak ada yang menembus meja;
  - perpindahan lantai hanya terjadi di dalam lift;
  - agent keluar ruangan lewat pintunya;
  - hanya tempat di luar gedung yang keluar lewat pintu masuk.
- **Pratinjau (`#/lab-3d`).**
  - Gedung digambar dari tata letak (`src/scene3d/building.tsx`) dengan furnitur Kenney (`src/scene3d/furniture.ts`, posisi dipusatkan dan skala 2) dan papan logo brand.
  - Ada tombol untuk tiap lantai, dan satu agent berjalan dari mejanya di lantai 1 ke pantry lewat lift.
  - Satu lantai brand memakai sekitar 270 draw call dan 23 ribu segitiga, dengan 60 fps di laptop.
- **Ditunda ke K3:**
  - dinding dan pintu ruangan (sekarang zona hanya diberi warna lantai);
  - arah monitor dan kursi;
  - perabot game room dan gerobak di gang (memakai ulang prop Ruang).

## Implementasi K2 (2 Nov 2026)

- Halaman Office memakai `BlueprintOffice.tsx`, bukan komponen runtime lama. Layout dan kru dibaca dari API office; Lab 3D tetap menjadi scene uji K1.
- Snapshot menggabungkan brand, tugas dan approval terbuka. WebSocket tiap brand memicu refresh; koneksi ulang juga melakukan refresh. Polling 1,5 detik menjadi cadangan. Saat gagal, data terakhir ditandai; data contoh tidak dipakai.
- Ketujuh status memiliki label, ikon dan warna berbeda; agen idle ditempatkan di lantai dasar, lainnya di meja masing-masing. Pose kerja/revisi dan tidur kuota memakai avatar Ruang. Animasi lengkap dan perjalanan antar lantai tetap K4.
- HUD menampilkan jumlah tugas antre, approval terbuka dan tugas menunggu kuota. Lantai awal memprioritaskan agen menunggu approval/error. Ada pemilih lantai dan fallback daftar 2D.
- Validasi: 157 test lulus termasuk integrasi Postgres, build lulus, ESLint file yang disentuh lulus, transformasi modul Vite dan API brand melalui proxy lulus.
- **Gerbang K2 belum dinyatakan lulus:** pengukuran perubahan visual ≤2 detik di browser dengan perubahan tugas nyata belum dilakukan. Uji rendering WebGL/perangkat dan animasi lengkap masih diperlukan. Halaman Agents/Task Board lama belum dimigrasikan.

## 9. Tahapan kerja

Total sekitar **12 hari kerja** (blueprint L3 hanya 6 hari karena memakai fork siap pakai; tambahan waktu untuk GLB dan 4 lantai).

| Tahap | Isi | Hari | Selesai jika |
|---|---|---|---|
| **K0 · Spike aset & pipeline** ✅ | Pilih paket CC0, pipeline Draco, logo brand, scene uji furnitur GLB + avatar Ruang (lihat "Hasil K0") | 1,5 | Furnitur GLB dan avatar tampil di scene uji; ukuran tercatat (fps HP diukur di K6) |
| **K1 · Tata letak gedung** ✅ | Tulis ulang `office3d-layout.ts`: lantai dasar + lantai brand dari `agents.json`, posisi meja per agent, lift/tangga, jalur jalan antar lantai. Hapus kamar/balkon. Test unit tata letak | 2 | Test layout lulus; OTCA 6 meja, sister brand 4 |
| **K2 · Data & status** | Hook data dari `/api/office/brands` + WebSocket, pemetaan 7 status ke posisi dan animasi, HUD baru (antre, approval terbuka, menunggu kuota). Lepas halaman Office dari runtime lama | 1,5 | Status berubah di 3D ≤ 2 detik setelah berubah di server |
| **K3 · Lingkungan GLB** | Gedung, lantai dasar, furnitur, dan dekor brand dari GLB; warna dan papan nama dari `visual.json`. Tombol lantai dan tampilan potongan | 2 | Semua lantai tampil dengan identitas brand; ukuran sesuai batas |
| **K4 · Karakter & animasi** | Avatar Ruang untuk 18 agent (warna per peran dan brand), pose per status (kerja, tidur, menunggu, revisi, bingung, dijeda), perpindahan lantai lewat lift, gelembung dan ikon status | 1,5 | Ketujuh status terlihat berbeda (cek visual per status) |
| **K5 · Panel meja** | Panel tugas, approval (komponen bersama dengan halaman Approval), dan formulir beri tugas | 1,5 | Approve, tolak, dan beri tugas berhasil dari kantor 3D |
| **K6 · Optimasi & mobile** | Instancing, LOD, lazy load, pengaturan bayangan, kontrol sentuh, fallback 2D | 1 | ≥ 30 fps di HP uji; unduhan awal ≤ 8 MB |
| **K7 · Uji kegunaan & rapikan** | Uji dengan 3 staf [BP L3-08], perbaikan, dokumentasi | 0,5 | Daftar perbaikan selesai; gerbang §1 lulus |

Dengan mulai 3 November 2026, perkiraan selesai **18 November 2026**.

### Dampak ke roadmap utama
Kantor 3D (L5 di `docs/PLAN.md`) maju dan dikerjakan sebelum L2–L4. Sisa L1 (gerbang uji bersama tim event,
template TOR/SKB) berjalan paralel karena bergantung pada data dari tim. Tanggal L2 dan seterusnya bergeser sekitar
12 hari kerja.

## 10. Yang dibutuhkan

| Kebutuhan | Dari | Kapan | Wajib? |
|---|---|---|---|
| Logo resmi 4 brand (PNG/SVG resolusi tinggi) | Brain / Pengguna | K3 | Tidak; diganti teks dulu |
| Model HP uji yang dipakai staf | Pengguna | K6 | Ya, untuk gerbang kinerja |
| 3 staf untuk uji kegunaan (±20 menit masing-masing) | Pengguna | K7 | Ya, [BP L3-08] |
| Persetujuan arah dekor per lantai | Pengguna / Brain | Akhir K3 (tangkapan layar) | Ya, [BP L3-07] |

## 11. Risiko

| Risiko | Mitigasi |
|---|---|
| Paket CC0 tidak punya animasi tidur atau mengetik | Buat dari pose statis yang diinterpolasi; atau ganti ke karakter lain di K0 sebelum dipakai luas |
| Ukuran unduhan terlalu besar untuk HP | Batas ukuran per file di §7, lazy load per lantai, cek ukuran otomatis di build |
| Gaya aset dari beberapa paket tidak serasi | Pilih satu paket utama di K0; paket kedua hanya untuk yang tidak ada |
| 18 karakter beranimasi membebani GPU | Satu skeleton bersama, animasi di-*throttle* untuk lantai yang tidak dilihat, LOD di tampilan potongan |
| Lisensi aset tidak jelas | Hanya CC0 atau lisensi yang tercatat di `docs/aset-3d.md`; aset tanpa catatan tidak di-merge |
