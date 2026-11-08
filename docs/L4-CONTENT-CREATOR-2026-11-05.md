# L4 blueprint — Content Creator

Penomoran mengikuti PDF: L4 Content Creator, bukan L4 roadmap repo lama (SSO). Login ditunda sesuai arahan pengguna. Empat brand independen; hasil tetap masuk approval.

## Tahap pertama: riset audiens

Jenis tugas konten.riset tersedia pada form Content Creator untuk setiap brand. Draft default tetap carousel. Wrapper model khusus tugas riset menyaring input dan instructions sebelum seluruh panggilan Hermes, termasuk ringkasan dokumen dan hasil tahap pendahulu. Output disaring kembali sebelum disimpan. Pola: email, NIK16 digit, HP Indonesia, tautan WhatsApp, nama/alamat/tanggal lahir/rekening/paspor yang berlabel. Jejak research_privacy hanya menyimpan kebijakan, hitungan, lingkup text-only, dan kewajiban pemeriksaan manual. Detail tugas memperlihatkan hitungan dari panggilan terakhir; riwayat event mempertahankan jejak tiap panggilan.

Gambar/scan mentah pada tugas riset ditolak sebelum panggilan model: gunakan transkrip yang diperiksa dan disamarkan. Ini bukan pemindai identitas dalam piksel. Fitur analisis dokumen/chat lain tetap tersedia dan tidak memperoleh klaim perlindungan riset otomatis. Sumber asli tetap tersimpan lokal sesuai mekanisme sebelumnya; penyaringan bukan penghapusan sumber.

Keterbatasan: ini screening pola identitas langsung, bukan anonimisasi lengkap. Nama bebas dalam narasi, alamat tersirat, tanggal tanpa label, kondisi kesehatan, kombinasi atribut dan identitas dalam gambar tidak dapat dijamin aman. Sumber riset harus ditinjau/disamarkan manusia sebelum unggah; hasil tetap memerlukan pemeriksaan reviewer. Tidak ada unggahan atau publikasi eksternal otomatis.

Instruksi riset memisahkan cakupan sumber, kebutuhan audiens, tema/angle, kutipan tersamar dan batasan. Frekuensi hanya jika bisa dihitung dari sumber, tanpa klaim representatif seluruh audiens.

## Gerbang L4 yang belum ditutup

- Kontrak carousel/caption dan QC struktur terukur.
- Sumber/consent sebagai gate aset.
- Produksi visual1080×1350 dan safe zone per brand; adapter gambar belum dianggap tersedia.
- Pembatasan penggunaan model final20%.
- Dataset nyata20 tugas per brand, penilaian reviewer serta target70% tanpa revisi. Endpoint metrik tersedia, bukan bukti dataset telah lulus.
- Riset anonim penuh memerlukan kurasi sumber; filter pola tidak menutup SEC-08 secara keseluruhan.


Verifikasi:32 tes integrasi Postgres dengan Hermes simulasi dan5 tes unit/UI terkait lulus. Build produksi, lint file berubah dan git diff --check lulus. Browser live memverifikasi pilihan riset dan penjelasan privasi tanpa mengirim tugas/model nyata; bukti tmp/l4-research-task.png. API lokal dimuat ulang setelah memeriksa tidak ada tugas aktif, endpoint status kembali200. Pemeriksaan browser memakai tab baru setelah tab lama tertahan halaman error koneksi saat restart. Tidak ada klaim uji produksi/model nyata untuk riset ini.
