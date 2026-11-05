# Keputusan: empat brand independen — 5 November 2026

Arahan pengguna: Official OTCA, Info Jerman, Ciao Manda dan Jepang Koey tidak berkaitan dalam kewajiban operasional. Manager setiap brand mengatur brand sendiri, bukan bawahan OTCA. Tidak ada kewajiban penerusan pekerjaan, akun, aset, konteks atau anggaran ke brand lain.

Hasil pemeriksaan sumber:
- PDF Blueprint_AI_Office_3D_OTCA_v3.1.pdf halaman 24 (Bab 13) memuat alur brief iklan sister brand ke Digital Marketing OTCA. Halaman 37, L7-05, menyebut alur tersebut kembali. Dokumen PDF asli tidak diubah.
- PLAN.md FR-04 dan paket context/ memperluas alur itu menjadi kewajiban Manager untuk iklan sekaligus event. Ini interpretasi repo yang terlalu luas.
- Sesuai keputusan pengguna terbaru, alur lintas brand tersebut tidak diterapkan. FR-04 dan bagian L7-05 yang menghubungkan brand ditandai tidak berlaku pada roadmap proyek ini. Keputusan ini mengungguli dokumen sumber yang lebih lama.

Perubahan:
- Kode handoff dan migrasi 014 yang baru disusun dibatalkan sebelum dihubungkan ke runner/API atau diaktifkan.
- Instruksi Manager dan batas tanggung jawab menyatakan independensi brand. Kebutuhan di luar kru aktif dikembalikan kepada pengguna untuk diputuskan, tanpa otomatis membuat pekerjaan di OTCA.
- brief_to_otca dihapus dari konfigurasi keempat brand dan dari pembaca definisi brand. Jumlah dan jenis agent aktif tetap mengikuti kru yang sudah dikonfigurasi; tidak menambah peran tanpa permintaan pengguna.
- Parser rencana menolak tujuan/handoff brand dari keluaran model secara eksplisit. Rencana tidak boleh diam-diam mengubah tujuan menjadi brand lain, ataupun mengabaikan field lintas brand lalu mengeksekusinya sebagai tugas lokal.
- Delegasi persisten Manager ke spesialis dalam brand yang sama tetap menjadi alur yang digunakan. Approval, pemisahan data dan batas akses brand tetap berlaku.

Prioritas pengembangan selanjutnya: melengkapi orkestrasi dan kemampuan produksi masing-masing brand menurut roadmap; handoff lintas brand bukan backlog wajib. Pekerjaan yang memerlukan akun, peran atau keputusan tambahan harus dijelaskan kepada pengguna sesuai kebutuhan brand tersebut.

Validasi: 42 tes terkait lulus (14 konteks/parser/kebijakan dan28 integrasi Postgres office_test), lint file berubah dan build produksi lulus. Parser menguji penolakan tujuan/handoff lintas brand; paket konteks Manager keempat brand tidak memuat brief_to_otca dan hanya membaca konfigurasi kru brand sendiri. API lokal dimuat ulang setelah dipastikan tidak ada tugas berjalan. Tidak ada pengembangan handoff lintas brand yang diaktifkan.
