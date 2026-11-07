# Audit integrasi Video Editor — 7 November 2026

Referensi: proyek native `2026-11_otca-nina-beasiswa-s1/out/storyboard-r2.html`.

## Temuan
Adapter Office hanya menyalin preset dan menerjemahkan rencana model menjadi beat-sheet judul. Belum memanggil ingest, koreksi transkrip, persiapan aset/koreografi, renderer still, atau pra-QA native. Karena itu file HTML yang dibuat adapter adalah rencana adegan tertulis, bukan storyboard visual. Nama keluaran baru diubah menjadi rencana-adegan.html. Berkas lama tidak ditimpa dan persetujuan lama tidak direkayasa.

Storyboard R2 native mempunyai 10 komposisi adegan dengan PNG pendamping, perbandingan subtitle full/split, contoh awal–aksi–akhir, catatan revisi, serta pemeriksaan sebelum persetujuan. Model Office menghasilkan 7 bagian narasi; ini belum setara 10 komposisi desain tersebut. Menambah thumbnail footage saja tidak memperbaiki kesenjangan ini.

Pipeline `pipeline/scripts/storyboard.py` menggunakan Renderer untuk mengambil still pada waktu elemen terbaca penuh dan melakukan pra-QA. Output HTML bergantung pada folder gambar pendamping. HTML tunggal tanpa pengemasan aset akan kehilangan gambar.

## Perbaikan pembaca berkas
Chat memakai dialog pembaca luas yang mengambil isi penuh dari endpoint aset terotorisasi. Markdown memiliki pratinjau dan sumber; HTML memiliki iframe terisolasi tanpa skrip dan sumber; JSON diformat dengan indentasi. Salin dan unduh tersedia. Tidak menyediakan penyuntingan tersimpan karena hal itu harus menghasilkan versi baru serta membatalkan persetujuan yang terkait.

## Integrasi yang masih diperlukan
1. Ingest footage dan transkrip bertimestamp melalui pipeline asli pada proyek terisolasi.
2. Terjemahkan rencana menjadi komposisi/aset/koreografi native lengkap, bukan judul generik.
3. Jalankan renderer storyboard dan pra-QA; kesalahan harus tampil sebagai kegagalan tahap visual.
4. Impor HTML beserta semua gambar lokal yang tervalidasi; gunakan URL terotorisasi atau paket mandiri tanpa akses path bebas.
5. Tampilkan storyboard visual dan catatan revisi di Approval; kaitkan persetujuan dengan hash komposisi/beat-sheet yang benar-benar ditinjau.
6. Render hanya setelah persetujuan visual tersebut; lanjut QA audio, subtitle, gerak, dan MP4.

Rencana produksi yang disetujui di Office belum merupakan persetujuan visual native. Jangan menjalankan `setuju` secara otomatis.

## Penghubung snapshot native
Endpoint produksi Video Editor `native-storyboard` menerima sourceTaskId, slug proyek, dan nama storyboard. Hanya proyek di root video terkonfigurasi yang dapat dibaca. Hash sumber utama pada cache native harus cocok dengan footage yang diizinkan oleh tugas brand tersebut. Semua gambar lokal dikemas sebagai data URI; traversal, symlink keluar, sumber gambar remote, serta paket >40 MB ditolak. CSP dan sandbox pembaca mematikan skrip/network HTML. Fitur JavaScript bawaan R2 (filter, zoom, localStorage catatan) tidak dijalankan; revisi disampaikan melalui UI review Office.

Impor menghasilkan tugas/approval baru dan salinan berkas mandiri, tanpa menimpa file native maupun memanggil setuju. Sumber, hash gambar dan HTML dicatat di storyboard-provenance.json. Uji nyata R2: 17 gambar, chat selesai, approval pending. Penghubung ini mengimpor storyboard yang sudah dibuat; pembuatan komposisi dan render storyboard baru secara otomatis dari brief tetap belum tersambung.
