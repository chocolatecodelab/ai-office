# Chat agent — 5 November 2026

Implementasi tiga fokus pengembangan:

- Lampiran: pustaka tersimpan di Postgres per brand/agent; unggah biner dan pilih folder kecil; maksimal 5 berkas/pesan, 5 MB/berkas, pustaka 100 berkas/200 MB. PDF teks (40 halaman awal), DOCX, UTF-8 TXT/MD/CSV/JSON; PNG/JPG/WebP dinormalisasi ke JPEG. PDF scan belum OCR. Parser dokumen memakai worker dengan batas waktu/heap. Dokumen dipotong maksimal 60.000 karakter tersimpan, 10.000 per berkas dan 24.000 total saat dikirim. Peringatan pemotongan tampil di jejak konteks.
- Skill aplikasi: katalog per peran, pilihan tervalidasi server, instruksi kerja disertakan dalam run. Ini preset instruksi aplikasi, bukan pemasangan plugin/tool Hermes. Skill tidak memperluas izin publikasi atau budget.
- Connector baca: pilih hasil tersimpan dari brand sendiri, atau daftar/impor berkas Google Drive dari koneksi brand aktif. Google Docs diekspor ke teks. Drive tidak tersedia jika belum terhubung atau mode mock. Token hanya di server. Berkas yang dipilih disalin ke pustaka lampiran sebelum dikirim. Pemilihan folder tidak rekursif tak terbatas; unggah folder lokal tetap mengikuti batas lima berkas.
- Bukti: setiap pesan menyimpan pilihan dan jejak lampiran/sumber, skill, catatan yang dipilih serta versi ringkasan. Isi lampiran diperlakukan sebagai data sumber. Penghapusan pustaka membuang byte/teks lampiran; riwayat jawaban dan nama sumber yang telah tercatat tidak ikut dihapus.
- Memori: aturan tim tetap disertakan sesuai batas prompt; memori tambahan dipilih melalui kecocokan kata pada judul/isi (maksimal enam), bukan pencarian embedding. Pengguna bisa meninjau jawaban lalu menyimpannya sebagai memori agent, mencari/mengedit/menonaktifkan/menghapus catatan.
- Ringkasan model: setelah minimal enam percakapan lama di luar sepuluh percakapan terbaru, Hermes merangkum percakapan lama. Pemakaian model tambahan dicatat. Ringkasan dapat diedit, dinonaktifkan, atau dilupakan; cursor mencegah percakapan sebelum tindakan melupakan diringkas ulang. Kontrol per pesan dapat mengecualikan memori. Riwayat chat terbaru dan konteks resmi tetap terpisah dari ringkasan. Versi optimistis mencegah pekerjaan ringkasan menimpa edit pengguna.
- Lampiran/skill untuk percakapan chat; jika mode delegasi Manager aktif, kirim ditolak dengan arahan menonaktifkan delegasi agar pilihan tidak hilang diam-diam. Belum meneruskan lampiran ke tugas anak.

Transport gambar memakai Hermes `/v1/responses` dengan konten gambar inline; teks tetap memakai Runs API. Referensi resmi: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server . Kegagalan kompatibilitas gambar HTTP 4xx (selain kuota) ditampilkan tanpa pengulangan otomatis tiga kali.

QA:
- Integrasi database memakai office_test terpisah dan Hermes simulasi: isolasi lampiran antar-brand/agent, pemilihan skill/memori, bukti konteks, penghapusan, ringkasan, konflik versi dan lupa tanpa regenerasi.
- PDF/DOCX sungguhan serta normalisasi gambar diuji; jalur multimodal diperiksa bentuk payload dan pemakaiannya.
- Browser live berhasil unggah dua contoh non-bisnis ke Content Creator OTCA lalu mengirim satu pesan dengan skill Analisis dokumen. Hermes membaca kode OTCA-QA-7419 dan warna merah dengan benar. Contoh berkas dan chat QA tetap tersimpan, diberi nama qa-chat-*.
- Ketersediaan connector dan daftar hasil brand diverifikasi lewat browser. Google Drive live tidak diuji karena koneksi belum aktif.
- Composer/pemilih lampiran diperiksa pada 390 × 844, override dikembalikan.
- Bukti: tmp/chat-attachments-live.png dan tmp/chat-attachments-mobile.png.
- Dependensi: pdf-parse 2.4.5, mammoth 1.13.0; sharp dinaikkan dari 0.34.5 ke 0.35.5 sebelum dipakai untuk unggahan.

Batas: plugin Hermes native tidak dipasang/diaktifkan, tidak ada OCR PDF scan, vector retrieval, handoff lampiran ke delegasi, atau penghapusan menyeluruh riwayat chat. Ringkasan dapat keliru dan tersedia untuk ditinjau pengguna.
Build produksi, lint file berubah, dan 37 tes pada 6 file lulus pada pemeriksaan akhir. Server lokal telah dimuat dengan build terbaru.

## Peningkatan lanjutan 5 November 2026

Batas sebelumnya telah ditingkatkan:
- PDF tanpa teks kini diterima dan dirender untuk pembacaan visual/OCR model multimodal: maksimal enam halaman awal per PDF, total 12 halaman/gambar per pesan. Ini pembacaan visual model saat eksekusi, belum OCR yang disimpan menjadi indeks pencarian.
- Skill `document-search` mengeksekusi pencarian chunk dokumen; `csv-profile` menghitung baris, kolom, sel kosong, format baris dan rentang numerik. Hasil tool disertakan ke model dan status eksekusinya tercatat dalam jejak konteks. Skill lain tetap preset instruksi. Belum katalog plugin Hermes native.
- Lampiran Manager kini disimpan bersama tugas orkestrasi dan diwariskan ke tugas spesialis. Hak baca berbasis hubungan parent dan input asli, tetap dalam brand yang sama; pustaka pribadi agent lain tidak ikut terbuka. Tautan bukti konteks memakai task-scoped access. Menghapus sumber menghilangkan akses bagi tugas berikutnya.
- Pemilih lampiran menambah pratinjau gambar/PDF/teks, tempel gambar dan drag-and-drop ke composer; batas lima berkas tetap berlaku. Maksimal tiga skill dipilih melalui UI.
- Connector Drive menambah pencarian nama dalam folder serta tautan Kelola koneksi. OAuth akun brand tetap diperlukan; tidak ada bypass izin Google. Integrasi live Google belum diuji tanpa akun terhubung.
- Build produksi dan lint lulus. Sebanyak 23 tes integrasi Postgres lulus, termasuk handoff dan isolasi; sembilan tes terpisah lulus untuk render scan, hitungan CSV, pembaca dokumen dan regresi chat. Dua upaya suite gabungan terputus pada worker; pengujian diulang terpisah sampai selesai, tanpa melewati tes gagal.
- Pengujian OCR mencakup render PDF scan sungguhan; pembacaan multimodal live telah terbukti pada uji gambar tahap sebelumnya. Belum mengeklaim OCR scan live sudah diuji atau setara seluruh kemampuan Claude/ChatGPT.

## Pembacaan lengkap dan kapasitas unggahan — 5 November 2026

Menggantikan batas enam/40 halaman awal pada implementasi sebelumnya:
- Upload PDF menyimpan sumber lengkap lebih dahulu. Pembacaan dilakukan di antrean tugas saat dikirim, per batch halaman, bukan memuat semua gambar sekaligus.
- Default mencakup seluruh halaman PDF; pemilihan `1-5,8` tersedia per lampiran. Tidak ada pemotongan halaman awal diam-diam. Rentang di luar dokumen ditolak dengan pesan jelas.
- Teks setiap halaman disimpan di `chat_attachment_pages`. Halaman scan ditranskripsikan satu per satu melalui model multimodal. Cakupan total/pilihan/berhasil dan halaman gagal tersimpan di metadata progres.
- Retry memakai hasil halaman sebelumnya, hanya melanjutkan halaman yang belum berhasil. Bila ada halaman gagal, jawaban akhir ditahan; sistem tidak menyatakan dokumen sudah lengkap. Penghapusan lampiran menghapus cache halaman pula.
- Dokumen panjang dirangkum dengan membaca semua chunk, lalu mereduksi ringkasan secara bertahap hingga muat pada konteks dokumen. Teks asli/hasil OCR tidak dipotong ketika disimpan. Jejak jawaban membedakan ringkasan konteks dari pembacaan halaman.
- Model OCR dan peringkasan memakai pemakaian model tambahan, dicatat terhadap tugas. OCR dapat keliru; penanda ketidakbacaan dipertahankan.
- Native parser PDF dijalankan pada proses terisolasi dengan batas waktu per operasi. Kegagalan parser tidak boleh menghentikan proses API; kegagalan dilaporkan dan progres sebelumnya tetap tersimpan. Batas waktu adalah batas satu operasi, bukan batas halaman awal.
- Kapasitas dapat dikonfigurasi melalui environment server: OFFICE_UPLOAD_MAX_MB (default25), OFFICE_CHAT_MAX_FILES (20), OFFICE_LIBRARY_MAX_FILES (500), OFFICE_LIBRARY_MAX_MB (1024). Batas konteks OFFICE_DOCUMENT_CONTEXT_CHARS (24000) dan batch OFFICE_PDF_BATCH_PAGES (3) terpisah. Perubahan memerlukan restart API. Batas kapasitas tetap berlaku agar penggunaan sumber daya terkendali.
- UI membaca kapasitas dari server, menyediakan rentang halaman, progres pembacaan dan jejak cakupan. Lampiran Manager mewariskan rentang yang sama ke spesialis.

Verifikasi baru: PDF delapan halaman terbaca hingga sentinel halaman terakhir; rentang 7–8 memakai cache; PDF scan tujuh halaman dengan kegagalan di halaman4 berhasil dilanjutkan dengan hanya satu pemanggilan OCR tambahan (8 panggilan untuk total7 halaman). Pengujian OCR menggunakan Hermes simulasi; tidak mengklaim OCR panjang live sudah diuji. Unit peringkasan memastikan chunk terakhir ikut dibaca. Suite awal sempat terputus pada native worker, sehingga parser PDF dipisahkan ke proses tersendiri dan pengujian diulang.

Pemeriksaan akhir: build produksi, lint file berubah dan 36 tes terkait lulus (25 integrasi Postgres +11 unit/regresi). Uji browser live pada dokumen QA delapan halaman berhasil menunjukkan progres6/8, kemudian jawaban jumlah8 halaman dan kode QA-PDF-LENGKAP-831 yang hanya ada di halaman8; jejak mencatat cakupan8/8 seluruh dokumen. Bukti: tmp/pdf-complete-progress.png dan tmp/pdf-complete-result.png. Dokumen/chat contoh non-bisnis tetap tersimpan untuk ditinjau. OCR scan tujuh halaman dan pemulihan halaman gagal diverifikasi menggunakan model simulasi, bukan klaim uji OCR panjang live.


## Penyempurnaan proporsi chat — 5 November 2026

- Dialog menggunakan tinggi viewport, header ringkas, serta tab satu baris yang dapat digeser pada layar sempit. Area riwayat memiliki scroll tersendiri.
- Composer dua baris: pesan dengan tinggi otomatis 48–132 px, diikuti ikon lampiran, skill, connector, memori, tinjauan konteks dan kirim. Ikon memiliki nama aksesibel, tooltip, status aktif dan fokus keyboard.
- Impor/ekspor menjadi aksi ikon sekunder; pilihan lampiran tetap dibatasi tingginya agar tidak mengambil seluruh dialog. Fitur pembacaan berkas, delegasi dan kendali memori tetap tersedia.
- Browser live 699×665: area percakapan 337 px, composer 106 px. Uji breakpoint 390×740: tab dapat digeser, dialog/composer tidak meluap horizontal. Pustaka lampiran serta tinjauan konteks berhasil dibuka/ditutup tanpa mengirim pesan/model; draf uji dibersihkan.
- Build produksi dan lint lulus. Tiga tes komponen lulus, mencakup kirim ke brand terpilih, antrean, toggle memori, buka/tutup lampiran dan pengembalian fokus, serta pilihan konteks.
