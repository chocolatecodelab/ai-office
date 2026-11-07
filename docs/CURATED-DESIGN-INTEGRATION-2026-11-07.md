# Perbaikan integrasi kurasi Content Creator — 7 November 2026

## Akar masalah

Pemilih contoh mengutamakan tanggal direktori specs, bukan referensi yang dikurasi. Aturan visual patterns.md dapat terbuang dari konteks. Kontrak model hanya mengizinkan penggantian teks, sehingga layout dan ikon lama terus diwariskan. Kelulusan QA teknis keliru dipakai sebagai bukti integrasi desain lengkap.

## Perubahan

- Referensi eksplisit per brand berada di server/office/curated-designs.ts. Referensi tidak tersedia atau brand salah menghentikan produksi; tidak fallback ke contoh bertanggal.
- profile.md, patterns.md, config brand, copywriting.md, dan rubric.md wajib tersedia dan dimuat utuh. Anggaran referensi opsional dipisahkan dari dokumen wajib.
- Produksi baru memakai kontrak komposisi JSON lengkap oleh model di belakang chat. Jumlah slide dan brand diperiksa. Pengguna tetap cukup menulis brief. Revisi teks biasa tetap mempertahankan proyek sumber secara sengaja.
- QA komposisi baru dapat memperbaiki copy dan geometri; tidak boleh melewati QA atau mengubah bahan gambar yang dipilih.
- Identitas referensi, SHA-256, commit mesin, dan versi konteks dicatat. Perubahan sumber di tengah render menggagalkan penyimpanan hasil.
- design-provenance.json disertakan pada hasil kurasi. Status tertinggi tetap SIAP_DIREVIEW, bukan disetujui atau siap publikasi.

## Bukti

Empat referensi kurasi pada commit 96f35051e3eeac1722c3d223949aa0e026fb9619 berhasil dirender menggunakan mesin asli. Semua memuat patterns.md wajib dan menghasilkan SIAP_DIREVIEW. Bukti tmp/curated-four-brand-proof.json. Ini memvalidasi referensi/render, bukan penilaian estetika oleh manusia.

Uji chat komposisi baru terpisah dicatat di tmp/curated-chat-composition-proof.json. Hasil akhir uji harus diperiksa sebelum dinyatakan berhasil.

## Pemeliharaan

Saat kurasi mengubah lokasi referensi, perbarui katalog eksplisit dan jalankan tes empat brand. Jangan menganggap folder dengan tanggal terbesar adalah standar yang disetujui. Penyempurnaan visual tetap dievaluasi reviewer per brand; L4 tidak otomatis selesai.

Hasil uji chat nyata: chat 59f086c1-6183-4824-8cfe-065db2f8da9f dan produksi 8755f058-19ff-4b59-99b6-4b2d3777db8b selesai sebagai draf menunggu review. Model menghasilkan empat slide baru dari referensi lima slide, memakai latar foto bangunan, komposisi free baru, serta caption sesuai brief. Ada satu perbaikan QA; hasil akhir 0 kritis dan 4 catatan ruang kosong/padding. Bukti tmp/curated-chat-composition-proof.json dan design-provenance.json pada hasil. Belum disetujui reviewer atau dipublikasikan.

## Tinjauan visual setelah render — 7 November 2026

Produksi baru dari chat memakai gambar referensi kurasi sebagai input multimodal dan reasoning tinggi pada model yang sudah dipilih, bukan mengganti provider secara diam-diam. Setelah render, reviewer AI membaca PNG setiap slide bersama referensi brand, memeriksa hierarki, skala teks, kepadatan, maskot, dan spasi. Temuan blocking memicu perbaikan spec dan render ulang dengan batas dua perbaikan visual, terpisah dari maksimal dua perbaikan teknis; temuan selera ringan dicatat sebagai suggestion.

Biaya review dan perbaikan dicatat pada tugas chat. Penilaian tersimpan sebagai visual-review.json dan terlihat di tab Review. Penilaian ini eksplisit milik AI, bukan keputusan manusia. Jika masih ada masalah blocking setelah batas perbaikan, hasil diberi PERLU_REVISI_VISUAL dan tetap berupa draf untuk diperiksa manusia. Tidak ada janji setara estetika Claude atau bebas kesalahan.

## Perbandingan visual dengan contoh pengguna

Uji baru memakai topik jalur kuliah Jerman dan enam slide agar sebanding dengan contoh pengguna. Gambar contoh Claude diunggah sebagai referensi saja, bukan bahan foto yang dipasang. ID chat: 101a26ee-2048-4dd2-a46f-278832d88ad1. Bukti hasil disimpan di tmp/visual-comparison-chat-proof.json dan tmp/visual-comparison-final-state.json.

Uji pertama menemukan format brief.sources yang tidak sesuai schema engine (model memakai supports/accessed, bukan claim/source). Wrapper kini meneruskan kegagalan schema sebagai feedback perbaikan terstruktur, bukan menganggap renderer rusak atau melewati validasi. Kontrak brief.sources juga dijelaskan eksplisit pada prompt komposisi. Sumber fakta tidak diisi otomatis oleh adapter.


Penilaian visual nyata pada enam slide pertama menolak slide 2, 5, dan 6 (rongga panel, komposisi berulang, penutup terlalu kosong); slide 4 diberi saran ikon. Draf ditandai PERLU_REVISI_VISUAL, bukan dianggap setara referensi hanya karena 0 masalah teknis kritis. Uji revisi komposisi yang terikat ke proyek tersebut dicatat di tmp/visual-comparison-revision-proof.json. Batas perbaikan teknis dan visual dipisahkan setelah ditemukan bahwa schema + overflow menghabiskan dua perbaikan sebelum review visual pertama.

Uji revisi selesai: chat aad915a0-4b88-455e-935c-9df798e02b87 / produksi 04a0cc05-6fed-4a1c-a35a-943905eec485, render akhir 12. Peninjauan visual pertama menolak skala maskot slide 2 dan alur waktu slide 5. Hasil diperbaiki, lalu peninjauan kedua tidak menemukan blocking; masih ada satu suggestion penomoran tahap. QA teknis akhir 0 kritis / 1 catatan jarak teks cover. Hasil tetap menunggu reviewer manusia dan tidak dipublikasikan. Ini bukan bukti bahwa kualitas sudah identik dengan Claude atau bahwa prompt asli pengguna telah direplikasi persis.

Kontrak schema mesin dimuat langsung dari src/schema.ts pada proses komposisi/perbaikan untuk mengurangi halusinasi enum dan field. Hasil uji juga memperlihatkan catatan operasional model pada brief.risks yang tidak semestinya menjadi risiko editorial; instruksi berikutnya secara eksplisit melarang status tool dalam brief.risks. Catatan ini tidak tampil pada gambar slide.
