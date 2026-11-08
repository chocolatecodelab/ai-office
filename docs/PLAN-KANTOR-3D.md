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
| Panel meja | **Chat + Tugas + Approval + Folder + Memori & Rules**. Sesuai permintaan terbaru, chat memakai antrean Hermes per brand; runtime chat lama tidak digunakan | [KEPUTUSAN], [BP L3-05] |
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

## Hasil implementasi K2 (2 Nov 2026)

- Renovasi langsung di halaman **Office** (`src/pages/Office.tsx`, `Office3D.tsx`), bukan halaman demonstrasi terpisah. Halaman dan menu Lab 3D dihapus. Avatar Ruang serta prop ping-pong, arcade, galon, gerobak bakso, dan kopi sepeda digunakan ulang.
- Gedung dan 18 meja bersumber dari `/api/office/brands`, hanya untuk agent aktif. Semua brand berlangganan WebSocket masing-masing; pembaruan tidak memindahkan lantai yang sedang dilihat. Saat tersambung ulang, data dimuat ulang; polling 10 detik menjadi cadangan.
- Ketujuh status server dipetakan ke posisi, pose dasar, warna indikator, label peran/status dan judul tugas. Agent idle berada di lantai dasar; perubahan tujuan mengikuti jalur layout dan lift. Label menunggu kuota menampilkan waktu retry bila tersedia.
- HUD antrean, approval terbuka, dan menunggu kuota dihitung dari database per brand, tanpa batas jumlah daftar tugas. Lantai awal memprioritaskan approval/error; jika tidak ada, OTCA.
- Fallback 2D dan pilihan tampilan tetap tersedia; kegagalan scene beralih ke 2D. Klik avatar/kartu menampilkan ringkasan dan pintasan ke Event/Approval. Panel transaksi lengkap tetap K5.
- Verifikasi: build, test layout/status, pembaruan UI melalui event WebSocket simulasi, dan integrasi Postgres. Office nyata telah dibuka di browser dengan 18 agent serta approval dari database.
- **Gerbang K2 yang masih perlu diukur:** latensi end-to-end perubahan status server sampai frame 3D ≤ 2 detik. Pengujian UI saat ini memverifikasi refresh ketika event diterima, belum mengukur latensi frame pada perangkat staf.
- Berikutnya K3: dinding/pintu ruangan, arah furnitur, dekor tiap brand, serta tampilan potongan gedung. Pemolesan pose dan animasi lengkap tetap K4.

## Hasil implementasi K3 (2 Nov 2026)

- Renovasi Office yang sama: ruang meeting **6 kursi di setiap brand**, meja kayu, notebook, layar presentasi, pembatas kaca dengan bukaan pintu, dan lounge tim. Ini ruang visual; penjadwalan atau workflow meeting belum ditambahkan.
- Tema interior: OTCA executive hitam/emas dan kayu gelap; Info Jerman krem/oak dan grid geometris; Ciao Manda galeri merah/terakota; Jepang Koey kisi shoji dan kayu natural. Aksen resmi tetap berasal dari API/visual.json; finishing arsitektur di `src/office3d/interiors.ts`.
- Papan peran meja, arah monitor/keyboard/kursi diperbaiki, logo dipasang di depan panel aksen, partisi dan penanda ruang bersama ditambahkan. Model GLB dan prop Ruang digunakan ulang; tidak ada unduhan aset baru.
- Mode **Lihat gedung** menampilkan lima lantai dengan shell dan logo saja, tanpa furnitur detail/avatar. Klik lantai atau tombol lantai untuk masuk. Kamera overview memperlebar framing dan kembali ke jarak kerja ketika masuk lantai.
- Optimalisasi: furnitur tetap berbagi geometri/material dari pustaka yang dimuat sekali; hanya lantai aktif dirender penuh; texture papan dibersihkan saat dilepas dan texture logo stabil berdasarkan ID brand.
- Verifikasi: keempat lantai dan overview diperiksa di browser. Test layout kini mencakup ruang meeting yang tidak memotong jalur meja-ke-lift. Target FPS HP tetap gerbang K6; persetujuan visual dekor oleh Pengguna belum dicatat.

### Penyempurnaan interior atas permintaan Pengguna (2 Nov 2026)

- Setiap brand memiliki ruangan Manager berpintu dekat lift, ruang santai berpartisi, meeting room, panel jendela berbingkai, tanaman, bank loker, lemari, AC, dan detail nat lantai. Tema brand tetap dipertahankan.
- Lantai dasar ditata ulang menjadi enam ruang: ping-pong, cafeteria/cafe, gym & fitness center (dua treadmill, rak dumbbell, matras), ruang istirahat dengan beanbag, lounge bersofa, dan game room dengan dua arcade. Gang bakso/kopi tetap ada.
- 18 posisi idle tersebar di keenam ruangan. Lorong tengah dan jalur masuk tetap terbuka; rute melewati bukaan pintu dan menghindari perabot. Label avatar idle muncul saat diarahkan pointer agar penanda ruang terbaca; kartu agent tetap tersedia.
- Test memeriksa ruang Manager berisi meja/seat Manager, jalur spesialis tidak memasuki ruang Manager, ukuran pintu, dan rute di sekitar meja ping-pong/cafe serta treadmill. Fasilitas tambahan bersifat visual, tanpa workflow reservasi atau simulasi alat olahraga.
- Referensi gambar Ruang dari Pengguna dipakai sebagai arah suasana, bukan salinan layout. Tekstur parket, ubin, karpet, rumput, paving dan aspal dari `textures.ts` digunakan ulang. Meja/kursi kerja, sofa, meja kopi, pohon, lampu jalan, dan bendera menggunakan prop Ruang; jejak meja pada layout diperbarui mengikuti ukuran WorkDesk asli. Monitor aktif mengikuti status working/revision dari API. Tekstur memakai cache bersama, tanpa unduhan aset baru.

### Aktivitas interaktif ruang bersama (2 Nov 2026)

- Three.js + React Three Fiber yang sudah ada dipakai untuk seluruh animasi; tidak menambah Remotion, physics engine, atau dependensi baru.
- Keenam ruang memiliki kontrol mulai/jeda dan dua pilihan aktivitas. Klik aset atau papan ruang memberi kontrol yang sama; tombol HTML juga tersedia dalam tampilan 2D. Preferensi reduced motion mematikan gerakan santai pada awal sesi dan tersedia tombol jeda seluruh animasi ruang.
- Ping-pong: bola dan gestur raket, pilihan tempo, papan rally. Cafe: uap kopi, gestur menyeduh/minum, menu espresso/cappuccino. Gym: belt treadmill, gerak cardio dan papan sesi; dua actor ditempatkan di atas belt ketika sudah tiba. Arcade: pixel bergerak, gestur bermain, neon dan papan skor. Istirahat: gerakan napas dan lingkar panduan. Lounge: gestur berbincang dan layar dengan pilihan suasana.
- Aktivitas hanya berlaku untuk agent idle yang sudah tiba; status kerja, approval, kuota, error, pause, dan perjalanan tidak diganti. Efek ruang dimuat hanya saat lantai dasar terlihat; pose offscreen dilewati; papan canvas diperbarui maksimal sekali per detik.
- Ini simulasi visual lokal per sesi browser. Angka rally/skor/seduh merupakan indikator animasi, bukan hasil pertandingan atau data operasional. Kontrol belum disinkronkan antar pengguna, tanpa reservasi fasilitas maupun simulasi fisika penuh.
- Test: pemetaan enam aktivitas, prioritas status tugas, jeda gerakan, dan kontrol gym di UI tanpa request perubahan server. Klik meja ping-pong dan perubahan/jeda latihan gym juga diverifikasi di browser.

### Koreksi penempatan dan kapasitas (2 Nov 2026)

- `office3d/equipment.ts` menjadi acuan bersama untuk meja ping-pong, posisi pemain, arah hadap, treadmill, ketinggian belt, serta titik duduk lounge. Pemain berada di dua ujung sumbu panjang meja; spectator tidak memakai raket. Pengguna treadmill memakai posisi dunia di atas belt, tanpa offset lokal yang terbalik karena rotasi avatar. Pengguna matras melakukan peregangan.
- Sofa lounge memiliki dua titik duduk sesuai bantalannya. Agent ketiga mendapat armchair terpisah. Jalur keluar dimulai dengan berdiri di depan tempat duduk, lalu melewati sisi meja kopi.
- Pose ketujuh status berlaku sama untuk empat brand. Menunggu approval diberi dokumen/pose menunggu, kuota ditandai Zzz, revisi mengetik lebih cepat, error berdiri di samping meja, paused abu-abu. Klik meja juga membuka ringkasan agent. Tombol Reset kamera mengembalikan sudut pandang awal.
- Area loker ditambah bangku, rak buku, tanaman, sudut kopi, kulkas, dan jam dinding; semuanya di sisi kanan lorong lift.
- Test regresi memeriksa dua pemain berseberangan dan saling menghadap, kaki di atas belt, kapasitas sofa/armchair, jalur menghindari meja kopi, serta pemetaan status pada keempat brand. Jalur treadmill boleh memasuki alat yang memang menjadi tujuan pengguna tersebut, tanpa memotong alat pengguna lain.

## Verifikasi K3–K5 (3 Nov 2026)

Diperiksa ulang di `main` (5d758ba) pada server dev. Tidak ada perubahan data atau keputusan selama verifikasi.

- **Baseline:** 183 tes lulus (1 dilewati), typecheck client dan server bersih, lint lulus, build lulus.
- **K3 (lingkungan):** sekat dan pintu ruang sudah ada di lantai dasar dan lantai brand (`GroundPartitions`, `BrandInterior` di `src/scene3d/building.tsx`). Tidak ada perubahan pada tahap ini.
- **K4 (pose tujuh status):** Panduan status menampilkan tujuh contoh karakter dalam satu baris, dengan pose yang berbeda. Nama status ada sebagai label di kanvas 3D, sehingga tidak terbaca sebagai teks halaman. Pemeriksaan ini visual, bukan pengukuran.
- **K5 (panel meja):** panel agent terbuka dari daftar Tim dengan tab Chat, Tugas, Approval (1), Folder, dan Memori & Rules. Tab Approval menampilkan hasil yang menunggu keputusan. Tombol keputusan tidak diklik.

**Gerbang yang belum tertutup dan belum bisa diukur tanpa mengubah data:**
- ~~Latensi status server sampai 3D ≤ 2 detik (K2)~~ — **diukur 3 Nov 2026**: satu tugas uji `event.tema` (Codex, sekitar 5,6 ribu token). Transisi `running` diterima browser 27 ms setelah tercatat di database; `waiting_approval` 43 ms. Jam browser dan database berada di mesin yang sama, sehingga selisih kecil bisa berasal dari jam. Pengukuran mencakup penerimaan WebSocket sampai data diperbarui, bukan render frame. Gerbang lulus.
  - Tugas uji itu menghasilkan satu approval terbuka ("Uji latensi WS (3 Nov)") yang perlu dibersihkan atau ditolak oleh pengguna.
- Uji keramaian lift dan jalur (K4) dengan kru penuh: sudah diukur dengan model, tetapi belum lulus karena agen yang bertumpuk (lihat "Uji keramaian K4" di bawah).
- ~~Keputusan approve, tolak, dan beri tugas dengan provider nyata (K5)~~ — **diuji 3 Nov 2026 dari panel Event Specialist di kantor 3D**, dengan Codex (`gpt-6-sol`): tugas "Uji K5 1" diberikan, disetujui, dan berstatus `approved`; tugas "Uji K5 2" diberikan lalu ditolak dengan catatan, masuk `revision`, dikerjakan ulang, dan kembali ke `waiting_approval` (versi 2). Approval versi 2 kemudian disetujui sebagai pembersihan uji.
- K6 (performa di HP) dan K7 (tiga staf) tetap sesuai `docs/UJI-KANTOR.md`.

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


### Penyempurnaan 3 November 2026 — mobilitas dan panel agent
- Mengembalikan perilaku idle Ruang ke layout baru: jeda aktivitas 12–30 detik setelah tiba, reservasi tempat asal/tujuan selama berjalan, kunjungan ruang bersama, bakso/kopi, serta kembali ke meja brand melalui lift. Aktivitas visual lokal tidak mengubah status tugas server.
- Lift memiliki pintu geser yang merespons agent di dekatnya, jeda naik/turun, serta panel pilihan lantai dari klik lift/tombol toolbar. Ini visualisasi perpindahan, belum simulasi satu kabin dengan antrean penumpang lintas lantai.
- Gerobak bakso/kopi bisa diklik untuk mengajak agent idle yang sudah tiba di tempatnya. Slot pedagang tidak direbut saat dipakai. Avatar menghadap pedagang dan memiliki gestur makan/minum. Pintu masuk depan kini benar-benar memiliki celah.
- Toolbar dipadatkan; aktivitas ruang dan roster berada di bagian yang bisa dilipat. Dialog agent mengikuti pola Ruang: Chat, Tugas, Approval, Folder, Memori & Rules. Kamera reset menyesuaikan lebar viewport agar area luar ikut terlihat.
- Chat tersimpan sebagai tugas konten.chat pada Postgres dan antrean Hermes; sepuluh hasil chat sebelumnya dari agent/brand yang sama menjadi konteks. Respons diperbarui lewat WebSocket/polling (belum streaming token). Kuota, retry, audit dan approval tetap memakai pipeline Office. Tidak mengirim pesan lewat runtime Claude lama.
- Panel mendukung kirim pesan, status respons, coba ulang kegagalan, ekspor JSON, tempel riwayat sebagai konteks pengguna, review/revisi, membaca versi hasil tugas serta konteks resmi brand. Folder di sini berisi aset tugas; belum editor filesystem. Memori resmi bersifat baca-saja, bukan editor aturan atau penghapusan riwayat.
- Pengujian baru: reservasi selama perjalanan, kunjungan luar/brand, jeda dan kembali kerja; pemisahan konteks chat antar agent; pengiriman chat ke brand terpilih dan pencegahan kirim saat respons masih antre. Validasi browser tidak mengirim tugas produksi atau mengeksekusi keputusan approval.

### Tahap berikutnya — tugas dari meja agent
- Tab Tugas memiliki form brief, jenis hasil sesuai peran, prioritas, analisis mendalam, dan opsi mendesak yang menjelaskan penggunaan pool Claude berbayar.
- Hasil tugas dapat dibaca lengkap; tugas gagal dapat dicoba ulang, dan tugas antre/menunggu kuota/dijeda/gagal dapat dibatalkan lewat API brand yang sama.
- Tab Folder dapat mengunduh setiap versi hasil sebagai Markdown.
- Prioritas tugas sekarang diteruskan ke BullMQ dan dipertahankan saat retry.
- Form diperiksa di browser tanpa membuat tugas produksi; pengujian panel/chat terkait dan build digunakan untuk validasi.

### K4 — antrean lift dan transisi pose
- Lift memiliki reservasi satu penumpang dari masuk sampai keluar di lantai tujuan, dengan urutan FIFO. Agent yang menunggu ditempatkan berjarak di koridor lift; reservasi dibersihkan saat agent dilepas dari scene.
- Perjalanan yang sudah berada di lift tetap diselesaikan ketika aktivitas idle dijeda, agar penumpang tidak mengunci lift.
- Arah hadap serta pose kaki, tangan, dan badan diinterpolasi saat berubah dari berjalan ke aktivitas/status tujuan. Jeda boarding tetap memperbarui visibilitas dan pose.
- Validasi: 40 tes layout/aktivitas/roaming/lift lulus; lint dan build berhasil. Gerbang K4 belum ditutup: pengecekan visual ketujuh status dan pengujian perjalanan ramai di browser masih diperlukan. Antrean ini belum merupakan simulasi kabin fisik dengan pemanggilan antar lantai, dan belum menangani semua perpotongan agent di koridor lain.

### Koreksi cafe, pingpong, pedagang, dan kapasitas lift
- Cafe memakai dua meja dan empat kursi; anchor posisi/facing kursi serta agent memakai definisi bersama. Jalur keluar menyamping menghindari kedua meja.
- Bola diam di atas meja ketika kedua pemain belum tiba atau aktivitas dijeda. Spectator tidak mengaktifkan rally. Gestur pemain juga menunggu pasangan.
- Dua NPC pedagang dengan apron dan gestur melayani ditempatkan pada bakso dan kopi; bukan agent pekerjaan dan tidak masuk hitungan kru.
- Lift mengelompokkan maksimal lima penumpang dengan lantai asal/tujuan sama dalam jendela boarding empat detik. Penumpang keenam menunggu sampai kelompok selesai; tiap penumpang memiliki posisi visual tersendiri. Interior ditambah plafon menyala, panel lantai, dinding metal, dan handrail.
- Uji layout/aktivitas/lift lulus (40 tes), ditambah regresi empat kursi cafe. Build, lint, dan pemeriksaan browser berhasil. Simulasi kabin fisik/multi-stop tetap belum tersedia.

### K4 — jalur berpapasan dan verifikasi status
- Jalur utama menggunakan sisi berbeda untuk arah berlawanan (jarak 0,64 m di lantai dasar); pengujian jalur memastikan furnitur dan pintu tetap terhindar. Ini belum solver tabrakan umum pada setiap persimpangan.
- Tujuan trip lift dibaca dari segmen vertikal aktual, sehingga pergantian tujuan saat sedang berjalan tidak salah memesan lantai. Gerakan ke slot antre memakai jarak sebelum normalisasi dan animasi berjalan.
- Tombol Panduan status di Office memperlihatkan tujuh contoh dengan komponen Agent yang sama seperti runtime. Contoh diberi penanda visual dan tidak mengubah API/server. Ketujuh pose diperiksa di browser dan bukti disimpan.
- Pemeriksaan: 42 tes terkait lulus, ditambah regresi jalur berlawanan; lint, TypeScript, dan build berhasil. Gerbang visual tujuh status sudah diperiksa; pengukuran performa perangkat tetap K6 dan uji keramaian dengan staf tetap K7.

### Uji keramaian K4 — kru penuh (3 Nov 2026)
- **Metode:** `src/office3d/crowd.test.ts` menjalankan 18 agen (OTCA 6; tiga sister brand masing-masing 4) selama 900 detik waktu simulasi. Agen memakai `nextVisits`, `route`, dan `LiftQueue` yang sama dengan scene. Status tiap agen berganti idle dan working secara acak, sehingga seed mengubah lalu lintas (seed 7, 42, 2026). Antrean lift memakai slot antre Office3D, dan penumpang keluar lift dari slot kabin.
- **Lolos:**
  - Tidak ada agen yang menunggu lift lebih dari 120 detik.
  - Penumpang dalam kabin maksimal 3–4 (batas 5).
  - 156–166 kali naik lift per skenario; tiap agen minimal 5 kunjungan.
- **Dicatat, belum menjadi gerbang:** waktu tunggu lift terlama 66–84 detik untuk satu lift dengan 18 agen.
- **Gagal:** pasangan agen di lantai yang sama berada di bawah 0,5 m selama 833–890 episode per skenario. Episode terlama 59–65 detik. Batas "tidak bertumpuk lebih dari 5 detik" adalah ambang yang saya pilih untuk uji ini.
- **Penyebab:** dua agen yang naik lift bersama lalu menuju arah yang sama mengikuti waypoint yang sama dengan kecepatan yang sama. Mereka bertumpuk sampai rutenya bercabang. Contoh: manager dan video-editor Ciao Manda di lajur lift lantai 3 pada detik ke-60. Jalan kaki tidak memakai offset lateral per agen, dan belum ada solver tabrakan.
- **Batasan:** ini model, bukan render. Hasilnya belum dicek di browser atau di HP, dan kabin multi-lantai fisik tidak disimulasikan.
- **Status:** gerbang keramaian K4 belum tertutup. Uji pemisahan ditandai `it.fails` sebagai celah yang diketahui. Hapus `.fails` setelah celah ini diperbaiki.
- **Perbaikan yang diusulkan (belum dikerjakan):** offset lateral per agen pada jalur searah, serta penyebaran titik keluar lift. Perubahan ini menyentuh scene, jadi perlu persetujuan. Setelah itu uji dijalankan ulang.

### K5 — panel meja dan alur review
- Panel Office dan halaman Approval memakai komponen ApprovalCard yang sama. Tiap approval menyimpan catatannya sendiri, memperlihatkan approver/jenis pekerjaan, menolak revisi tanpa catatan, dan menonaktifkan keputusan bila hasil belum tersedia.
- Kunci sinkron mencegah klik ganda mengirim keputusan/transaksi berulang. Kesalahan ditampilkan dan keputusan dapat dicoba lagi; refresh dilakukan setelah sukses.
- Respons lama pada perpindahan brand atau pemilihan aset tidak menimpa pilihan terbaru. Dialog agent memiliki nama aksesibel.
- Uji UI mencakup kirim tugas pada brand terpilih, brief tetap utuh ketika gagal, reset form setelah sukses, setujui sekali, revisi dengan catatan khusus hasil, serta kegagalan keputusan tanpa sukses palsu. Uji store/runner Postgres mencakup hasil, penolakan, revisi, dan persetujuan.
- Validasi: 177 tes lulus, 1 dilewati; lint dan build diperiksa. Panel hasil Event Specialist diperiksa di browser tanpa menjalankan keputusan produksi. Alur K5 terverifikasi melalui UI dengan API tiruan dan integrasi database office_test; uji langsung pengguna dengan provider nyata tetap bagian pilot.

### K6 — kualitas adaptif dan layout mobile
- Pengaturan Grafis Otomatis/Hemat/Detail. Hemat memakai DPR 1 dan tanpa shadow map; Otomatis memilih Hemat pada pointer sentuh/perangkat <=4 core, atau saat rata-rata frame di bawah 23 FPS setelah warm-up. Detail tetap bisa dipilih manual.
- Frameloop berhenti ketika dokumen tersembunyi dan kembali berjalan ketika terlihat. Kamera menggunakan interpolasi berbasis delta dan menyesuaikan framing ketika viewport berubah. Buffer pose dan vektor gerakan dipakai ulang untuk mengurangi alokasi per frame.
- Monitor Performa opsional menampilkan estimasi FPS browser, draw calls dan segitiga, diperbarui dua detik sekali. Ini bukan hasil benchmark HP.
- Layout 390x844 diperiksa di browser: tab lantai dapat digeser horizontal, kontrol sentuh memiliki target lebih besar, panel agent menggunakan tinggi dinamis dan form tugas satu kolom pada layar kecil.
- scripts/check-office-budget.mjs mengaudit seluruh chunk dist/assets, model, logo dan decoder Draco sebagai batas konservatif berkas mentah 8 MiB. Hasil awal sekitar 4,25 MB; bukan rekaman transfer jaringan.
- 44 tes terkait lulus, termasuk pilihan kualitas manual/otomatis. Build dan lint diperiksa. K6 belum ditutup: target >=30 FPS dan unduhan jaringan awal masih harus diukur pada HP kelas menengah yang dipakai staf; instancing/LOD lebih lanjut mengikuti hasil profiling itu.

### K6 lanjutan dan K7 — hasil pengembang
- Tujuh bagian tubuh/wajah kaku avatar digabung menjadi satu geometry vertex-color; empat anggota gerak tetap terpisah. Penghematan enam draw per avatar pada pass utama secara struktur mesh, bukan klaim perbandingan FPS antarperangkat.
- Loader furnitur membuang decoder lewat finally dan menghapus cache promise yang gagal, sehingga percobaan 3D berikutnya bisa memuat ulang aset.
- Area 3D dapat difokuskan dengan Tab, pan memakai panah, dan pindah lantai memakai Page Up/Down. Posisi pan dipertahankan saat kamera bergeser vertikal. Browser memverifikasi Page Down dari OTCA ke G dan pan horizontal.
- K7: bantuan Cara menggunakan kantor tersedia di halaman; Escape menutup lift; memilih lantai keluar dari panduan status; kontrol grafis/kamera/panduan nonaktif pada 2D. Regresi fallback 2D diperbarui untuk menegaskan kontrol yang tepat.
- Suite lengkap: 178 lulus, 1 dilewati. Lint/build dan audit budget lulus (4.261.820 byte mentah untuk scope skrip). Pengamatan desktop di lantai G mode Detail: sekitar 56 FPS, 728 draw calls, 144.090 segitiga pada satu sampel; angka berubah dengan scene dan bukan benchmark HP.
- Prosedur uji penerimaan ada di docs/UJI-KANTOR.md. Implementasi dan pemeriksaan pengembang K6/K7 sudah maju; gerbang HP nyata dan tiga staf belum lulus karena belum dijalankan. Jangan menandai keseluruhan kantor selesai sebelum hasil tersebut tercatat.

### 5 November 2026 — Gerbang otomatis keramaian K4
Antrean lift diperlebar dan dihitung per lantai, limpahan ditempatkan di lobi, keluar lift diurutkan dengan interval, serta agent searah menjaga jarak melalui pembatas langkah bersama scene/simulasi. Tes penumpukan menjadi tes biasa dan lulus pada7 seed,18 agent,900 detik/skenario; durasi berdekatan terlama1,1–1,2 detik. Sebanyak56 tes terkait lulus. Ini menggantikan status it.fails pada laporan keramaian terdahulu. Perpotongan singkat tetap mungkin; bukan solver semua tabrakan. K6 perangkat dan K7 sesi staf tetap terbuka. Detail: docs/BLUEPRINT-PROGRESS-2026-11-05.md.
