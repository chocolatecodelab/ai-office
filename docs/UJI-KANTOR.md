# Uji penerimaan Kantor OTCA — K6 dan K7

Dokumen ini adalah prosedur uji, bukan bukti bahwa staf atau HP nyata sudah diuji.

## Persiapan

- Gunakan lingkungan uji, brand dan tugas uji. Jangan menyetujui hasil produksi untuk menguji tombol.
- Catat tanggal, model HP/laptop, OS, browser, resolusi layar, jaringan, dan versi commit/build.
- Jalankan `npm run build`, `node scripts/check-office-budget.mjs`, dan `npm test` sebelum sesi.
- Gunakan tiga staf dengan tugas mandiri; satu fasilitator mencatat hasil tanpa mengarahkan langkah awal.

## K6 — performa pada HP nyata

1. Buka Office dengan cache kosong, catat total transfer awal dari Network browser bila tersedia. Jangan menganggap ukuran berkas mentah sebagai transfer terukur.
2. Pilih Grafis Otomatis, buka lantai G dan aktifkan monitor Performa. Tunggu 10 detik untuk warm-up.
3. Amati selama 60 detik: FPS terendah yang terlihat, kisaran stabil, draw calls, dan apakah grafis turun ke Hemat.
4. Ulangi pada lantai OTCA, tampilan gedung, dan lantai G pada mode Hemat serta Detail. Catat mode, jumlah agent, serta animasi aktif agar hasil dapat dibandingkan.
5. Putar, zoom, pan dua jari, ganti lantai, rotasi orientasi HP, lalu buka panel chat/tugas/approval. Periksa teks terpotong dan tombol yang sulit disentuh.
6. Pindah tab selama 15 detik lalu kembali. Periksa jalur agent dan lift melanjutkan tanpa teleport besar atau antrean terkunci.
7. Beralih ke 2D dan pastikan roster/status/panel tugas masih dapat digunakan.

Gerbang: >=30 FPS pada HP kelas menengah target, transfer awal <=8 MB, kontrol sentuh dapat digunakan. Catat kondisi yang gagal; jangan mengubah status gerbang menjadi lulus dari FPS desktop atau emulasi viewport.

## K7 — skenario untuk masing-masing staf (sekitar 20 menit)

1. Temukan Event Specialist OTCA yang membutuhkan approval dan jelaskan arti statusnya.
2. Buka Panduan status, bandingkan tujuh pose, lalu kembali ke kantor.
3. Pindah ke satu sister brand lewat tombol lantai atau panel lift; pastikan nama brand pada panel agent sesuai.
4. Kirim tugas uji dengan brief, jenis hasil, dan prioritas normal. Pastikan tugas hanya muncul di brand/agent yang dituju.
5. Buka hasil uji, setujui satu hasil, dan minta revisi hasil lain dengan catatan. Pastikan catatan tidak terbawa ke hasil lain.
6. Pada lingkungan uji, putuskan koneksi saat mengirim. Periksa pesan gagal dan apakah brief/catatan tetap utuh untuk dicoba ulang.
7. Baca versi hasil di Folder, unduh Markdown, lalu periksa Memori & Rules.
8. Di lantai G, jeda pingpong, periksa bola diam; lanjutkan permainan saat dua pemain tersedia. Periksa kursi cafe, NPC, dan antrean lift.
9. Gunakan keyboard: Tab ke area kantor, pan dengan panah, Page Up/Down untuk lantai, Escape untuk menutup panel. Ulangi bagian inti pada HP.
10. Ganti 2D/3D dan grafis. Pastikan setiap staf dapat menemukan jalan kembali tanpa bantuan fasilitator.

## Format catatan hasil

Untuk setiap staf, catat nama/inisial, perangkat, skenario, lulus/gagal, waktu penyelesaian, bantuan fasilitator, masalah, tingkat dampak, serta bukti screenshot bila diperlukan. Hindari menyimpan data pribadi atau isi percakapan sensitif dalam laporan.

## Status saat dokumen dibuat

- Otomasi layout, status, panel tugas/review dan fallback tersedia dalam suite pengujian.
- Pemeriksaan browser oleh pengembang dilakukan terpisah dari sesi staf.
- Pengukuran HP nyata dan tiga sesi staf: BELUM DILAKUKAN.
- K6/K7 baru ditutup setelah hasil nyata dicatat dan masalah penghambat diperbaiki.
