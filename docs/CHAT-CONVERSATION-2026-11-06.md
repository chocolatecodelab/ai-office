# Percakapan dan memori eksplisit

Kontrol Konteks yang digunakan dan Simpan sebagai memori dihapus dari bubble; trace backend tetap tersedia, tetapi tidak dipoll oleh panel percakapan. Memori & Rules tetap menjadi tempat mengedit/menghapus catatan.

Perintah yang benar-benar menyimpan: Simpan sebagai memori: isi atau /ingat isi. Isi maksimal2000 karakter, scope hanya agent/brand saat ini, kind memory (bukan aturan resmi), hanya teks tanpa lampiran/skill. Tidak menafsirkan kutipan, permintaan tidak langsung, atau isi lampiran sebagai perintah. Simpan jawaban tadi belum melakukan resolusi referensi; pengguna harus menuliskan isi yang hendak diingat.

Task chat, catatan, audit dan konfirmasi disimpan dalam satu transaksi. Kegagalan membatalkan semuanya. Balasan lokal tidak memanggil model dan tidak membuat cost_event palsu. Perintah tidak menjalankan delegasi Manager. Ringkasan otomatis percakapan panjang tetap mekanisme terpisah.

Gaya jawaban dipengaruhi model, prompt peran/brand, riwayat dan memori; UI tidak meringkas jawaban biasa. Instruksi chat kini meminta gaya alami/proposional, tanpa memaksakan ringkas/daftar atau mengulang disclaimer rutin. Aturan approval tetap berlaku. Riwayat lama tidak diedit.

Verifikasi:36 integrasi Postgres +2 unit/UI lulus, build dan lint lulus. Browser memverifikasi kontrol bubble tidak tampil; tmp/chat-clean-bubbles.png. Perintah memori diuji pada DB uji dan Hermes simulasi, bukan menyimpan preferensi QA ke data bisnis.
## Ruang percakapan yang lebih luas

Panel desktop tertanam kini memperoleh kolom yang lebih lebar (minimum 620 px pada breakpoint 1280 px). Tombol Perbesar ruang percakapan memindahkan panel yang sama ke dialog modal; draft, tab, dan panel lampiran tidak di-remount saat membesar/mengembalikan ukuran. Pada layar kecil dialog memakai viewport penuh.

Header dipadatkan, impor/ekspor berada di menu percakapan, balasan agent memakai permukaan terbuka, dan lebar bacaan teks dibatasi terpisah dari galeri berkas. Kolom tulis tetap di bawah, riwayat memiliki scroll sendiri, pemisah tanggal, serta tombol Pesan terbaru ketika membaca pesan lama. Font isi tetap 13 px.

Verifikasi browser pada viewport awal 714 x 668: tinggi area pesan 348 menjadi 406 px; kolom tulis 106 menjadi 94 px; font teks sebelum/sesudah 13 px. Uji desktop 1280 x 800: panel inline sekitar 703 px dan native modal dapat diperbesar/dikembalikan sambil mempertahankan draft serta drawer lampiran. Uji ponsel 390 x 844: ruang chat memenuhi viewport tanpa overflow halaman horizontal. Draft QA dibersihkan, tidak dikirim ke model. Override viewport dikembalikan setelah uji.
