# Integrasi mesin produksi lokal — 6 November 2026

## Yang tersedia

AI Office memakai dua checkout terpisah melalui worker lokal. Kode mesin tidak disalin atau diubah oleh adapter.

- Content Creator: tab **Tugas → Produksi carousel**, pilih spesifikasi JSON brand yang sama. Renderer asli menjalankan render, QA, dan lembar review. PNG, caption, spec, dan laporan QA diimpor ke Folder agent, lalu tugas menunggu approval manusia. `SIAP_DIREVIEW` tidak berarti approved/published.
- Video Editor: tab **Tugas → Produksi video**, pilih preset. Adapter memakai resolver preset Python yang sudah ada untuk menyiapkan manifest, brief, dan beat-sheet di folder proyek terisolasi. Output berstatus **DRAFT_PROJECT**; beat-sheet masih memuat contoh dari preset. Approval tugas ini adalah review draf proyek, bukan persetujuan storyboard.
- Percakapan tentang produksi mendapat referensi mesin terpilih: Content Creator menerima panduan copywriting/rubrik/profil/pola/config brand yang sama; Video Editor menerima INDEX dan pintu masuk pipeline. Berkas dicache berdasarkan metadata, versi dan daftar sumber dicatat dalam konteks tugas. Referensi ini tidak mengizinkan eksekusi shell oleh model dan tidak membuktikan tool telah berjalan.

## Konfigurasi

Isi `infra/env/production.env` (gitignored), atau environment server:

```dotenv
OFFICE_CONTENT_ENGINE_ROOT=D:/path/CONTENT_CREATOR
OFFICE_VIDEO_ENGINE_ROOT=D:/path/VIDEO_EDITOR/video-system
OFFICE_PRODUCTION_DIR=D:/path/AI_OFFICE/data/production
# Opsional jika browser Playwright berada di direktori khusus:
OFFICE_CONTENT_BROWSER_DIR=C:/path/ms-playwright
```

Restart API setelah mengubah konfigurasi. Lokasi komputer pengguna tidak ditulis ke konfigurasi tracked.

Kesiapan Content Creator memeriksa loader TSX, renderer, Playwright, serta browser terpasang. Kesiapan Video Editor saat ini hanya untuk **persiapan proyek** (Python venv dan struktur mesin); bukan bukti FFmpeg, WhisperX, GPU, atau full-render Remotion sudah teruji.

## Penyimpanan dan proses

- PostgreSQL: tugas, payload `production_jobs`, tahap, laporan, approval, metadata aset; tidak ada cost event model palsu.
- `data/production/<brand>/<agent>/<task>/<attempt>/`: request, hasil renderer atau proyek video, cache kerja. Setiap percobaan terpisah.
- `data/files/<brand>/`: salinan immutable berkas yang terdaftar di Folder. Perubahan file kerja tidak diam-diam mengubah berkas hasil review.
- Redis/BullMQ: antrean tugas dan pemulihan setelah server restart.
- Advisory lock database: satu produksi lokal pada satu waktu; lease per tugas mencegah run ganda. Proses mempunyai timeout dan dipantau untuk cancel/pause. Pada Windows penghentian mencakup tree proses renderer.
- Brand Office dipetakan eksplisit: `infojerman → info-jerman`, `ciaomanda → ciao-manda`, `jepangkoey → jepang-koey`, `otca → otca`.
- Path aset input dibatasi pustaka brand dan stock bersama; tidak menerima perintah shell, URL media arbitrer, atau path proyek dari request.
- Permintaan revisi pada Review hasil membuat tugas pengganti. Carousel terikat pada spesifikasi hasil yang dipilih dan memakai arahan reviewer; draf video mencatat arahan pada brief proyek baru tanpa mengaktifkan render penuh. Penolakan tidak merender ulang input lama tanpa perubahan. Kegagalan pipeline tidak dijalankan berulang otomatis. Retry manual membuat folder percobaan baru.

## API

`GET /api/office/brands/:brand/agents/:agent/production`: kesiapan, sumber/versi konteks, preset, 20 job terbaru.

`POST` pada URL yang sama:

```json
{"title":"Judul","brief":"Arahan","spec":{"brand":"otca","slides":[]}}
```

Contoh di atas hanya bentuk payload; `spec` harus memenuhi schema mesin dan berisi 1–10 slide. Maksimal spec 80 KB. Untuk Video Editor:

```json
{"title":"Judul","brief":"Arahan","video":{"preset":"glass-tech-bukti-sosial","seed":1}}
```

## Validasi yang dilakukan

- Unit: penolakan lintas brand/path aset, pembatasan perintah, deadline proses, kesiapan tidak dikonfigurasi.
- PostgreSQL office_test: impor file memerlukan approval, akses file brand lain ditolak, local render tidak membuat cost event, cancel saat produksi tidak menghasilkan aset/approval.
- Mesin asli Content Creator: salinan spec OTCA menghasilkan empat PNG, review PNG, caption, spec, QA, `SIAP_DIREVIEW` (sekitar 4 MB); sumber carousel yang sempat salah direvisi tidak dipakai untuk uji ini.
- Mesin asli Video Editor: preset diselesaikan, enam file draf dihasilkan tanpa mengubah INDEX/proyek existing mesin.
- API/queue live lokal: dua job `[QA]` diproses melalui antrean asli dan masuk waiting_approval; tidak disetujui atau dipublikasikan. Folder agent memperlihatkan PNG dan preview.

## Batas tahap ini

Chat Content Creator sudah dapat memanggil tool carousel dari permintaan langsung (buatkan/render carousel), serta merevisi copy carousel terakhir pada brand dan agent yang sama. Desain memakai dasar spec brand yang tersedia, copy disusun model, hasil dirender dan QA oleh mesin asli. Permintaan belum mendukung desain bebas baru atau pengeditan piksel gambar/PDF arbitrer. Video Editor belum mendukung upload footage video besar, transkripsi, preview storyboard, persetujuan berdasarkan hash beat-sheet, maupun render/ekspor video penuh dari UI Office. Tahap berikutnya menghubungkan fitur tersebut secara bertahap, menjaga gerbang storyboard mesin asli. Drive tidak wajib dan tidak menerima upload dari pekerjaan ini.

Backup lokal perlu mencakup PostgreSQL, `data/files`, folder produksi, dan repositori mesin; push GitHub tidak menyertakan database atau media.

## Alur carousel dari chat

1. Permintaan langsung pengguna mengaktifkan tool; pertanyaan biasa tidak menjalankan render.
2. Model mengisi slot copy dari dasar desain brand. Tidak ada perintah shell atau path aset arbitrer dari model. Permintaan revisi memakai spec produksi chat terakhir yang berhasil pada brand dan agent yang sama.
3. Tugas produksi anak persisten dibuat dan masuk antrean; chat menunggu hasil. Jika server restart, relasi tugas dipakai ulang tanpa mengulang generasi copy.
4. Renderer menghasilkan PNG dan QA. Kegagalan QA dapat memicu maksimal dua perbaikan copy oleh model, setiap panggilan dicatat sebagai biaya nyata; QA tidak dilewati.
5. Transaksi menyimpan hasil dan approval produksi, lalu menyelesaikan balasan chat dengan galeri gambar dan unduhan. Chat selesai tidak berarti hasil approved atau published.
6. Versi sebelumnya tetap tersedia pada pesan asal. Tugas yang dibatalkan tidak dihitung sebagai approval terbuka.

Validasi percakapan nyata: permintaan empat slide rutinitas belajar bahasa, perbaikan QA label yang terlalu panjang, lalu revisi CTA melalui chat. Bukti hasil dan identitas tugas disimpan lokal di tmp, tidak diunggah ke Drive atau dipublikasikan.

## Review hasil

Tab Approval kini berlabel Review. Antrean Menunggu dipisahkan dari Riwayat; satu hasil dibuka pada satu waktu, terbaru lebih dahulu. Carousel ditampilkan per slide dengan navigasi thumbnail dan caption tersendiri. QA desain berasal dari berkas hasil renderer; pemeriksaan teks dan verifikasi manusia tetap dibedakan. Brief, laporan mentah, dan statistik pemrosesan ada pada detail pendukung.

Setujui hasil konten tidak mempublikasikan konten. Minta revisi membuka kolom arahan wajib. Arahan disimpan pada tugas pengganti dan sumber hasil dipasang eksplisit agar tidak merevisi carousel lain yang kebetulan terbaru. Versi lama tetap dapat dibaca pada chat dan riwayat. Hasil revisi yang selesai menggantikan versi sumber yang masih menunggu; approval versi sumber tidak lagi ditawarkan sebagai keputusan aktif. Snapshot hasil riwayat memakai aset yang sudah ada saat approval tersebut dibuat.

## Proyek dan versi carousel — 6 November 2026

Chat Content Creator menyediakan pemilih Proyek carousel di atas composer. Pengguna dapat memilih hasil yang akan direvisi atau melepas pilihan untuk membuat carousel baru. ID sumber disimpan pada pesan sehingga revisi eksplisit tetap mengarah ke hasil yang dipilih. Server memeriksa brand, agent, dan keberadaan hasil gambar.

Produksi baru memiliki proyek dan nomor versi. Revisi yang memiliki sumber disimpan pada proyek yang sama. Perbandingan dua versi dalam proyek yang sama menampilkan slide berdampingan dan mendeteksi perubahan dari SHA-256 berkas, tanpa panggilan model. Hasil lama sebelum migrasi tetap proyek terpisah; hubungan tidak ditebak dari judul yang sama.

Tahap ini menyediakan pemilihan sumber dan riwayat versi. Perubahan struktur slide serta penggantian aset melalui bahasa alami belum ditambahkan; editor produksi masih menggunakan slot teks yang divalidasi renderer.
## Penempatan bahan ke slot gambar — 7 November 2026

Di Tugas → Produksi carousel, pilih spesifikasi JSON lalu gunakan bagian Bahan desain. Slot yang tersedia diturunkan dari referensi gambar aktual pada spesifikasi. Bahan dipilih dari pustaka brand ini yang berstatus boleh digunakan dan memiliki bukti izin. PNG/JPG/WebP didukung; PDF dan dokumen tetap bahan referensi.

Server memeriksa pilihan sebelum antrean, worker memeriksanya lagi sebelum render dan sebelum penyimpanan hasil. Gambar didekode dan disalin sebagai PNG ke direktori tugas. Mesin asli tidak diubah. asset-provenance.json menyimpan ID bahan, slot, sumber, lisensi, bukti, serta SHA-256 salinan gambar. Revisi teks terhadap proyek tersebut mempertahankan pilihan bahan dan memeriksa kembali izin.

Batas: pilihan ini mengganti slot gambar yang sudah tersedia. Logo dan maskot yang dipanggil lewat konfigurasi atau ID internal engine belum dapat diganti dari picker ini. Belum ada pemilihan otomatis bahan baru dari percakapan bebas. Hasil tetap memerlukan review manusia.

Smoke test renderer nyata menggunakan gambar sintetis lingkaran emas pada slot gambar cover menghasilkan empat slide dan status SIAP_DIREVIEW. Bukti teknis tersimpan di tmp/material-smoke-proof.json. Hasil tes tidak dipublikasikan atau dimasukkan sebagai tugas pengguna.

## Chat dengan bahan gambar — 7 November 2026

Pengguna mengunggah PNG/JPG/WebP lewat lampiran Chat Content Creator dan menyebut fungsi gambar dalam prompt produksi carousel. Tool menerima pilihan attachmentId dan slot desain yang tersedia; ID gambar di luar pesan ditolak. Ketidakjelasan penempatan menghasilkan pertanyaan klarifikasi, bukan render dengan gambar bawaan secara diam-diam. Jawaban klarifikasi langsung berikutnya yang membahas gambar/slide membawa lampiran sebelumnya tanpa unggah ulang. Percakapan baru yang tidak berkaitan tidak membawa bahan tersebut.

Worker memverifikasi bahwa gambar benar-benar dipilih pada chat sumber, berada pada brand dan role yang sama, serta belum dihapus. Bahan dinormalisasi ke PNG, disalin ke direktori tugas, dan dicatat pada asset-provenance.json. Revisi proyek mempertahankan gambar lama tanpa membaca aset brand lain. Bahan chat dipakai untuk draf; izin publikasi belum diverifikasi dan tidak otomatis menjadi aset permanen.

Batas: renderer menggunakan slot gambar pada desain yang tersedia. Menambah komposisi bebas/foto tutor pada slide yang belum mempunyai slot memerlukan pengembangan layout; agent harus meminta penyesuaian, bukan mengklaim penempatan berhasil. Perilaku model tidak dijanjikan identik dengan ChatGPT/Claude. Penyimpanan bahan permanen lewat perintah chat belum tersedia.

Uji end-to-end nyata (7 November): chat b6122e48-1aee-425d-bcb8-2bdcff90697a menggunakan unggahan 256ab577-0a5a-44a1-ae65-d1b2ab6a4cb8 pada slides.0.image.src. Produksi c9d21e59-7f9b-43d1-a2f6-a820a8411a2d menghasilkan empat slide, satu perbaikan QA, dan status menunggu review. Bukti lokal tmp/chat-upload-smoke.json. Tidak ada persetujuan atau publikasi otomatis.

## Paket video dan versi mesin (7 November 2026)
- Remote sudah di-fetch: Content Creator origin/main 7b96070; Video Editor otca/master 1dd6891. Kedua HEAD lokal sesuai; perubahan lokal Video Editor dipertahankan.
- engine-source.ts mencatat commit dan hash isi perubahan kode/aturan/aset relevan, termasuk sumber baru yang belum tracked. Proyek/output media dikecualikan. Remote tracking yang diketahui lebih baru memblokir produksi; tidak ada pull otomatis di working tree pengguna. Lakukan fetch sebelum sesi produksi untuk mengetahui pembaruan remote.
- Konteks tidak lagi memakai cache mtime/ukuran. Skill humanizer CC dan panduan thumbnail Video Editor terbaru dimuat. Aturan brand CC tetap terpisah.
- Rencana video baru mengikat sourceVersion. Rencana lama tanpa versi atau versi berubah ditolak sebelum produksi; perubahan di tengah produksi menahan impor hasil. engine-source.json tersedia bersama hasil.
- Paket video memerlukan MP4 terverifikasi, thumbnail.png 9:16, thumbnail-grid.png 3:4, thumbnail-qa.json LULUS, subtitle.srt dan subtitle.vtt, laporan QA dan provenance. Delivery manifest mencatat versi pengemasan dan hash berkas; tidak mengklaim MP4 lama dirender ulang dengan versi baru.
- Chat menampilkan poster pada player, cover sebagai gambar, tautan SRT, dan track VTT opsional (video sudah berisi subtitle bakar, sehingga track tidak diaktifkan default). Laporan dan berkas teknis berada di berkas pendukung.
- Cover baru R4 memakai template otca@1.2 dan memerlukan review pengguna; MP4 dipertahankan.

### Pemeriksaan remote langsung
Produksi baru menjalankan `git ls-remote` pada upstream sebelum menjalankan mesin dan sesudah proses mesin selesai. Prioritas upstream Video Editor adalah otca/master jika tersedia; repo lain mengikuti upstream branch aktif. Commit yang diiklankan remote harus merupakan ancestor HEAD lokal; commit lokal tambahan dan perubahan kerja dipertahankan. Objek commit remote yang belum tersedia atau belum tergabung menyebabkan produksi ditahan, bukan pull/reset otomatis. Kegagalan jaringan/izin dan branch tidak valid juga menahan produksi. Pengecekan ini tidak menjamin kepatuhan artistik; review desain/isi tetap diperlukan. Status kesiapan dapat tersimpan 30 detik, tetapi pemeriksaan di jalur produksi tidak memakai cache tersebut. Commit remote dan waktu verifikasi dicatat di laporan hasil.

### Revisi thumbnail dari chat
Riwayat teks saja tidak memberi alat revisi. thumbnail-chat.ts mengikat permintaan cover ke hasil terbaru yang sudah tersimpan untuk brand dan agent yang sama. Nama proyek berasal dari catatan produksi atau nama MP4 tersimpan; bukan path bebas dari prompt. Settings thumbnail dari manifest disertakan kepada model. Model mengusulkan patch terbatas (margin/headline/subheadline/frame_time); backend memeriksa izin footage, brand, lokasi proyek, versi remote dan sidik jari sumber, kemudian memakai renderer thumbnail native dengan salinan konfigurasi khusus proyek. Template bersama tidak diubah. Hasil menjadi proyek/approval baru dengan sourceTaskId dan revisionOf; MP4 tidak dirender ulang.

Margin khusus proyek menyebabkan pemenggalan ulang kata yang sama oleh native wrapper, tanpa mengecilkan font atau memotong teks. Batas tiga baris dan QA native tetap berlaku. Jika tidak muat, proses gagal dengan alasan, bukan mengklaim revisi selesai. Ini belum alat revisi video umum seperti editor agentic penuh.

### Revisi komposisi video terarah
video-revision.ts mendefinisikan edit bertipe untuk judul adegan, mode full/overlay, ilustrasi yang tersedia, skala judul/grafis, ukuran caption, gradasi gelap, serta koreksi kata subtitle tanpa perubahan timestamp. Edit tidak menerima kode/path/file baru dan tidak mengganti logo/font/palet brand. Proyek sumber mengikuti rantai revisi thumbnail hingga props komposisi ditemukan; metadata cover terbaru diwariskan ke proyek revisi. Compositor OfficeRevision terpisah dari R4 yang sudah disetujui. Renderer menghasilkan PNG adegan terpengaruh, revision-preview.html, catatan edit dan SRT; MP4 lama tidak ditimpa atau dirender ulang.

Uji chat nyata: task 4404a3bb-ddde-4de5-8d6f-6a53ba01a7fd mengganti hanya judul adegan 1, selesai sekali jalan dan mengembalikan preview. Batas: compositor ini mendukung keluarga EditorialStudy/R4; proyek dengan renderer lain belum otomatis diadaptasi. Preview still bukan review kelancaran motion, bukan MP4 revisi, dan bukan kelulusan QA artistik. Animasi baru di luar parameter dan render final dari preview memerlukan integrasi lanjutan; agent diberi instruksi menyatakan batas kemampuan.

### Render revisi dan motion deklaratif
- Perintah eksplisit render/ekspor memakai proyek preview aktif sebelum pesan dibuat. Persetujuan render dicatat pada task dengan hash props, compositor dan HTML preview dari snapshot aset tersimpan; file native yang berubah atau preview lama tanpa hash ditolak. Render tidak dijalankan dari sekadar “oke” atau pertanyaan.
- Renderer revisi menghasilkan MP4 baru tanpa menimpa versi sebelumnya, audio asli dinormalisasi dua tahap, cover dua ukuran, SRT/VTT dan laporan QA teknis. Hasil masuk review, tidak otomatis dipublikasikan. Cancel/pause membatalkan process tree; mesin tetap diserialisasi melalui advisory lock.
- custom-motion.ts memvalidasi layer rect/circle/path/text dan keyframe x/y/scale/rotate/opacity. Warna dibatasi token brand, font tetap brand, path SVG hanya data geometri, tidak menerima JavaScript/HTML/file luar. Time/keyframe/order/durasi dicek; preview gerak baru memperlihatkan awal/tengah/akhir, bukan klaim bahwa kehalusan motion sudah lulus.
- Ini memperluas desain di luar katalog ilustrasi, tetapi belum menjalankan sembarang plugin, 3D, audio generatif atau kode dari chat. Implementasi compositor saat ini mendukung keluarga proyek OfficeRevision/EditorialStudy yang terhubung.
- video-intent.ts menjadi pemilih intent semantik untuk permintaan bahasa sehari-hari yang tidak dikenali pola cepat. Hasil tidak valid kembali menjadi percakapan, bukan eksekusi. Permintaan render tetap memakai gerbang eksplisit, bukan persetujuan yang ditebak model.

Bukti uji penuh 7 November 2026: chat c8ec237f-b2eb-483b-aad2-66db1e5893c7 menghasilkan animasi dua lingkaran dan jalur baru, dengan preview beberapa waktu. Chat 1abfd5be-ca82-4aba-b297-cfac27cf09e9 menjalankan render teknis dari snapshot tersebut sampai paket hasil tersimpan di chat. Hasil 51.513521s, H.264/AAC, 1080×1920, -14.37 LUFS, -1.98 dBTP, decode penuh berhasil. Uji ini bukan persetujuan artistik manusia/publikasi. Preview yang dibuat sebelum pengikatan hash footage baru perlu dibuat ulang sebelum render produksi berikutnya. Pengikatan yang baru telah diterapkan pada preview berikutnya; uji awal memakai snapshot props/compositor/HTML.

### Kuota provider dan checkpoint tugas
- Limit dari HTTP, hasil run gagal, maupun exception SDK ditangani lintas provider. Kapasitas concurrent-run Hermes dipisahkan dari kuota model. Retry-After (detik/tanggal), reset header, metadata retry/reset dan waktu relatif berzona yang jelas dipakai bila tersedia; jika tidak, retry berkala 30 menit dengan penanda fallback, bukan klaim mengetahui reset pasti.
- waiting_quota menyimpan retryAt dan tidak menghabiskan attempts gagal. Worker menolak memulai sebelum retryAt meskipun parent memeriksa anak. Antrean restart memakai retryAt yang sama. Chat menampilkan waktu coba ulang.
- task_checkpoints menyimpan hasil model selesai dan run_id yang sudah dibuat. Retry dapat polling run yang sama tanpa POST baru; hasil tahap selesai dipakai ulang dengan token panggilan ulang nol. Identitas checkpoint mengikat task/brand, input, instruksi, model, gambar dan hash kredensial (bukan kunci asli). Perubahan sumber/input menghasilkan checkpoint baru. JSON/schema model yang tidak valid dibatalkan agar tidak dipakai berulang.
- Hasil renderer disimpan di FileStore dengan hash dan referensi checkpoint DB sebelum review. Jika limit terjadi saat review, berkas render dipakai ulang; metadata sumber, payload dan hash bahan menjadi bagian identitas. Checkpoint tidak melewati QA atau persetujuan.
- OCR mempertahankan halaman selesai dan metadata limit, berhenti sementara pada kuota, lalu melanjutkan halaman yang belum selesai. Checkpoint riset disimpan setelah penyamaran data pribadi.
- Batas teknis yang tidak bisa dijanjikan: provider yang tidak memberikan waktu reset memakai perkiraan; run yang dinyatakan gagal/dihapus provider tidak dapat dilanjutkan per token. Dalam kondisi tersebut tahap model yang belum selesai diulang, sementara tahap/berkas yang selesai tetap dipertahankan. Render lokal yang terputus di tengah frame/encoding belum dilanjutkan per frame melalui fitur ini; checkpoint berada pada hasil tahap selesai.

### Pemulihan tanpa informasi reset dan render terputus
Waktu reset yang tidak dikirim provider tetap tidak diketahui. Scheduler kini memakai probe pemulihan adaptif (sekitar 1, 2, 4, 8, lalu 15 menit dengan jitter kecil), direset setelah tahap model berhasil. Waktu dari provider tetap diutamakan. Tidak ada klaim mengetahui reset pasti hanya dari backoff.

Render revisi kini menyimpan segmen video 5 detik. Checksum, frame range dan jumlah frame diverifikasi sebelum segmen dijadikan checkpoint; jurnal metadata ditulis atomik. Retry memakai cache yang terikat pada brand, props, compositor, footage dan versi mesin. Segmen parsial/korup diulang, segmen selesai dipakai kembali; hasil gabungan diperiksa jumlah framenya sebelum audio dan QA. Ini memperkecil kehilangan kerja menjadi segmen yang belum selesai, bukan menjanjikan pemulihan frame yang belum tersimpan.

Uji Remotion nyata 31 frame: interupsi sebelum segmen kedua, retry memakai ulang satu segmen selesai, lalu gabungan tepat 31 frame. Tes juga menolak identitas berbeda dan merender ulang berkas cache korup. Cache segmen disimpan di D: dan tidak dibersihkan otomatis agar dapat dipakai untuk recovery. Provider yang menghapus run/token tetap tidak dapat dipulihkan per token; checkpoint tahapan selesai tetap dipakai.
