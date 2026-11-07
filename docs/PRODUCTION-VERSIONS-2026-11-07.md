# Sumber revisi dan perbandingan hasil

Content Creator dan Video Editor memakai menu percakapan → **Proyek dan versi**.

- Pilih hasil dan versi sebelum mengirim revisi. Sumber ditampilkan di atas kolom pesan dan terikat pada pesan yang dikirim.
- Tanpa pilihan, sistem hanya memakai hasil terbaru bila seluruh kandidat berada dalam satu proyek. Jika ada beberapa proyek, sistem meminta pengguna memilih sumber.
- Riwayat video native dan revisinya dicatat bersama riwayat carousel. Backfill memakai ID sumber atau `revisionOf` yang sudah tersimpan; judul yang mirip tidak dipakai untuk menggabungkan proyek.
- Perbandingan memakai hash berkas tersimpan. Gambar ditampilkan berdampingan, MP4 memakai dua pemutar, dan teks/subtitle dapat dibuka pada berkas pendukung. Nama MP4 yang berubah antarversi dipasangkan sebagai peran Video MP4.
- Ringkasan menunjukkan berkas berubah, tetap, ditambahkan, atau tidak tersedia pada salah satu versi. Gambar adegan yang tidak disimpan pada versi pembanding ditandai tidak tersedia; sistem tidak mengarang frame sebelumnya.
- **Pulihkan sebagai versi baru** menyalin hasil versi yang dipilih, mencatat sumbernya, dan membuat approval baru. Versi serta keputusan sebelumnya tetap tersimpan. Pemulihan tidak merender ulang atau mempublikasikan berkas.
- Semua sumber, file, perbandingan, dan pemulihan dibatasi pada brand serta agent yang bersangkutan.

## Verifikasi

67 tes terkait lulus: 53 tes integrasi office/Postgres, serta 14 tes UI, kontrak revisi, pemulihan kuota, dan deteksi limit provider. Pengujian database memakai `office_test`, terpisah dari data aplikasi. Tes ffmpeg/OCR memakai `--testTimeout=60000`.

`npm run build` lulus. QA Chrome memeriksa sumber di atas composer, perbandingan MP4, dan lebar mobile 390 px tanpa overflow horizontal. Pemulihan diuji pada database pengujian tanpa membuat salinan tambahan pada percakapan produksi pengguna.
