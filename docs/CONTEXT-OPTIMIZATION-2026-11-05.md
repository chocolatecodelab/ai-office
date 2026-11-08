# Optimasi konteks agent — 5 November 2026

Implementasi:
- File konteks resmi dibaca dari cache proses selama metadata file tidak berubah. Perubahan isi/atomic replace menyebabkan invalidasi otomatis tanpa restart. Ini penghematan I/O lokal, bukan klaim penghematan token provider.
- Prompt dipisah menjadi awalan stabil (peran, aturan umum, approval, batas tanggung jawab, fakta brand) dan referensi opsional di belakangnya. RACI/daftar kru/panduan visual/checklist dipilih menurut peran dan kebutuhan. Pekerjaan produksi serta permintaan lanjutan mempertahankan referensi lengkap. Semua aturan inti dipertahankan, tidak diringkas oleh model atau dibuang demi cache.
- Catatan memori dinamis ditempatkan pada input, setelah riwayat, agar perubahan memori tidak mengubah awalan sistem. Pemilihan memori relevan yang sudah ada tetap berlaku.
- Riwayat terbaru dibatasi ukuran melalui OFFICE_CHAT_HISTORY_CHARS (default12000 karakter, rentang1000–100000). Blok berkas dalam balasan lama diganti penunjuk agar isi berkas besar tidak dikirim ulang. Batas ini bukan jumlah token eksak; token aktual berasal dari laporan model. Ringkasan percakapan lama menyesuaikan batas riwayat yang benar-benar dipertahankan, bukan selalu sepuluh pesan.
- Ringkasan dokumen panjang disimpan permanen berdasarkan attachment, hash isi/versi algoritme dan anggaran konteks. Sumber/rentang atau anggaran berubah menghasilkan cache baru. Ringkasan yang sama dapat dipakai ulang tanpa pemanggilan model lagi. Penghapusan sumber menghapus cache. OCR per halaman yang sudah tersimpan tetap dipakai ulang.
- Konten resmi memakai hash versi untuk jejak; core memiliki versi tersendiri. Batas isi dan sumber yang dipilih dicatat per tugas.
- Migrasi012 menambah chat_context_metrics, document_context_cache, serta kolom cache_read_tokens/cache_write_tokens pada cost_events. Counter cache yang tidak disediakan provider tetap null, dibedakan dari nol yang benar-benar dilaporkan.
- Runs dan Responses membaca cache_read_tokens/cache_write_tokens, padanan Anthropic, dan input_tokens_details.cached_tokens bila disediakan. Tidak mengirim parameter cache_control yang tidak diketahui didukung oleh gateway.
- Pada konteks jawaban ditampilkan jumlah dokumen inti/referensi, jumlah dan ukuran riwayat, input/output token aktual, counter cache provider atau “belum dilaporkan”, waktu eksekusi, dan pemakaian ulang ringkasan dokumen.

Batas interpretasi:
- Aturan inti tetap disertakan setiap permintaan; model tidak dianggap otomatis mengingat semua instruksi. Sesi tetap terisolasi per tugas agar tidak menggandakan riwayat atau mencampur permintaan agent.
- Awalan stabil memudahkan caching provider; aplikasi tidak mengklaim cache hit, tarif, atau penghematan latensi sebelum ada laporan provider dan pembanding yang sesuai.
- Ukuran karakter dan jumlah dokumen adalah pengukuran aplikasi, bukan tokenisasi persis model. Prompt inti dilindungi; anggaran riwayat dapat menyebabkan hanya cuplikan balasan lama yang tersedia. Riwayat lengkap tetap tersimpan di database.

Validasi awal: 12 tes pada empat file lulus untuk pemilihan referensi, invalidasi konteks setelah edit, batas riwayat, cache tidak diketahui versus nol, dan regresi chat. Seluruh 26 tes integrasi Postgres office_test juga lulus, termasuk pemakaian ulang ringkasan tanpa panggilan model tambahan, hash sumber baru, pencatatan counter cache, penghapusan cache, ringkasan memori, handoff, dan pemulihan PDF. Model pada pengujian integrasi disimulasikan. Referensi kontrak gateway: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server .

Build produksi, TypeScript, ESLint file yang diubah, dan git diff --check lulus. API dimuat ulang dengan migrasi012. QA browser langsung pada Content Creator Official OTCA berhasil: pertanyaan peran memakai 5 dokumen inti + 0 referensi dari 8 tersedia; 2 percakapan/570 karakter riwayat dari anggaran12000; provider melaporkan 8633 input token dan32 output token, tanpa counter cache. Waktu eksekusi sampel9,5 detik bukan benchmark penghematan. Screenshot: tmp/context-optimized-chat.png.
