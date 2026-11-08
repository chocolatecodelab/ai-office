# Perapian halaman operasional — 4 November 2026

Revisi panel detail agent dari screenshot pengguna: header dan navigasi tidak lagi menyusut, margin navigasi global dinetralkan, area chat memakai grid utilities/pesan/composer dengan satu area scroll. Batas lama 48vh dan layout flex yang menyusutkan kelompok pesan ditimpa khusus untuk panel agent. Lampiran memiliki baris nama penuh, label ukuran sumber (bukan ukuran PDF hasil render), serta dua aksi yang tidak berebut lebar nama file. Kolom kirim tetap di dalam panel; teks/status memakai token tema. Gulir otomatis hanya mengikuti pesan bila pengguna berada dekat bagian akhir, atau saat mengirim pesan sendiri. Browser memeriksa Social Media Manager dan Manager dengan riwayat serta PDF nyata, tanpa mengirim pesan: pada lebar 1200, 390 dan 320 area pesan tidak menimpa composer, panel/composer tetap dalam batas layar. Dua tes panel/fokus lulus; typecheck, lint dan diff check bersih. Bukti: [desktop](../tmp/agent-panel-refined-desktop.png), [mobile](../tmp/agent-panel-refined-mobile.png).

Lanjutan penyajian hasil: renderer dokumen ReadOnlyMarkdown dipakai pada jawaban chat agent, hasil lengkap tab Tugas, isi review ApprovalCard, dan hasil TaskDetailDialog. Judul/daftar/tabel ditampilkan sebagai struktur dokumen; pesan pengguna, error/pending, berkas asli, dan alur keputusan tidak diubah. Tabel dapat bergulir di dalam area hasil. Renderer tidak menjalankan HTML mentah atau script link dan tidak memuat gambar remote otomatis. Tujuh tes terkait renderer, chat, approval, serta akses detail hasil lulus; pemeriksaan tipe/lint dijalankan pada berkas terkait.

Lanjutan antrean perhatian (UX-11): Office menampilkan total kebutuhan lintas brand, urutan error → waiting_approval → waiting_quota, filter kategori, jumlah ditampilkan/total, dan Lihat semua bila lebih dari empat. Tidak lagi menyembunyikan agent kelima tanpa jalur akses. Klik hasil memperbarui lantai/konteks ke brand agent tersebut sebelum membuka panel. Urutan dalam kategori deterministik berdasarkan nama brand/peran; tidak mengklaim urutan usia karena timestamp status belum tersedia pada data agent. Pengujian memakai enam brand/agent untuk memeriksa batas empat, ekspansi, prioritas error, filter kuota, dan tujuan brand.

Penguatan panel agent selanjutnya (UX-09): draft chat dan form tugas disimpan dalam memori aplikasi, dengan kunci brand/agent/jenis field. Tutup panel, pergantian agent, perpindahan halaman, atau pergantian penerima pada composer tidak mencampur draft. Tidak memakai localStorage atau mengirim draft ke server. Reload menghapus draft; event penguncian akses/perubahan profile lock menghapus cache walaupun panel sudah ditutup. Form menyediakan Hapus draft. Teks dibersihkan setelah request diterima, dengan perbandingan isi agar draft baru yang diketik saat request berjalan tidak ikut terhapus. Pilihan jenis/prioritas/analisis/mendesak tetap terpisah per brand dan agent. Tes memeriksa pemulihan setelah unmount, isolasi brand, penguncian saat panel tertutup, serta regresi kirim chat/tugas.

Revisi berikutnya dari pengguna: halaman Event mandiri tidak diperlukan karena pekerjaan dilakukan melalui agent khusus. Navigasi dan renderer halaman Event dilepas; route lama #/event menjadi akses Office dengan panel Event Specialist OTCA terbuka. Chat, tugas, hasil, dan approval memakai panel agent yang sudah tersedia. Data dan endpoint event tidak dihapus. Catatan penguatan form Event di bawah adalah riwayat pekerjaan sebelum keputusan ini, bukan arah fitur UI selanjutnya.

Penguatan alur Event berikutnya: form memiliki submit lock, busy state, validasi judul kosong/whitespace, dan hanya membersihkan isian setelah server menerima event. Request detail diberi nomor generasi sehingga respons lama tidak menimpa event yang baru dipilih; detail lama dikosongkan saat berganti event. Sesudah pembuatan, pemuatan mengikuti pilihan ID baru tanpa memanggil ulang callback dengan selection lama. Label Objective/Benefit menjadi Tujuan/Manfaat. Tes klik ganda dan kegagalan request memastikan hanya satu POST dan judul tetap tersimpan; typecheck dan lint diperiksa. Ini menindaklanjuti UX-08, bukan kelulusan fase produksi gambar/SSO atau simulasi event bersama staf.

Lanjutan pengembangan persetujuan: halaman default kini menggabungkan approval terbuka semua brand, sesuai ringkasan global Office. Filter brand menggunakan select, setiap hasil diberi konteks brand, dan hasil diurutkan dari yang paling lama menunggu. Pembaruan live dipantau per brand; kegagalan satu sumber menampilkan error tanpa mengaku seluruh brand kosong. Tersedia status loading, retry, dan data terakhir. Generasi request mencegah respons lama mengubah state setelah unmount. Tes lintas brand dan tiga tes keputusan approval lulus; pemeriksaan tipe serta lint dilakukan untuk perubahan ini. Belum memutuskan approval nyata dalam QA.

Masalah dari screenshot pengguna: informasi model, status, tugas, dan kontrol bercampur di kartu Agent; Aktivitas menggunakan judul kosong; dokumen Memori tampil sebagai daftar path dengan pembaca jauh di bawah; layanan Log dan peran Pengaturan berupa daftar rapat tanpa ritme. Perubahan mengikuti frontend-design dan identitas OTCA yang sudah dipakai.

- **Agent:** kartu dengan header portrait/peran/status, pekerjaan saat ini, aksi Chat/Beri tugas, dan konfigurasi tersendiri. Filter brand dan pencarian peran; jeda, model, serta uji model tetap tersedia melalui konfigurasi.
- **Aktivitas:** satu riwayat berurutan, judul berbasis aksi saat judul objek kosong, waktu/brand/pelaku jelas, PDF render diterjemahkan; pencarian dan filter tetap tersedia.
- **Memori:** pilihan brand/agent, catatan tim, dan panduan resmi dipisahkan. Daftar panduan mengontrol area baca di sebelahnya; Markdown menjadi heading, paragraf, daftar, dan tabel. Raw HTML tidak dijalankan, gambar remote tidak dimuat otomatis, link script tidak diaktifkan. JSON tetap teks. Isi/kewenangan dokumen tidak berubah.
- **Pemakaian:** USD tetap terlihat dengan estimasi rupiah pada LiteLLM dan Langfuse. Kurs tetap pengguna US$1 = Rp18.168; dihitung dari nilai USD asli, dibulatkan ke rupiah penuh. Contoh aktual US$0,3758 menjadi sekitar Rp6.828. Estimasi Langfuse tetap ditampilkan saat run lokal nol.
- **Log sistem:** nama layanan, keterangan, status teks, latensi sejajar; tugas gagal berada dalam panel terpisah dan dapat membuka detail. Gagal memuat dibedakan dari tidak ada tugas gagal.
- **Pengaturan:** navigasi bagian tanpa mengganti route, detail peran dapat dibuka, status belum SSO dipertahankan, integrasi berupa baris, budget tiga kelompok dengan progress berlabel dan estimasi rupiah, serta daftar gateway sejajar. Tidak mengubah mode integrasi, kredensial, atau aturan akses.

## Validasi

Build produksi, lint berkas yang diubah, dan git diff --check lulus. Suite akhir: **280 lulus, 1 dilewati**, 55 berkas, dengan `npm test -- --maxWorkers=4 --testTimeout=15000`. Eksekusi default sebelumnya mengalami satu timeout 5 detik pada pengujian PDF lama; pengulangan dengan jumlah pekerja lebih kecil lulus, tanpa mengubah atau melewati pengujian tersebut.

Tes baru memeriksa aritmetika kurs/format rupiah, estimasi Langfuse saat data lokal kosong, serta rendering Markdown tanpa raw HTML, script link, atau auto-loading gambar remote. Browser lokal memeriksa keenam halaman di desktop 1440 px, mobile 390 px, dan layar kecil 320 px tanpa overflow horizontal halaman; Pemakaian diperiksa kembali setelah data biaya termuat. Tema terang dan gelap diperiksa. Ini belum merupakan validasi perangkat HP fisik atau audit WCAG lengkap.

## Bukti tampilan

- [Agent](../tmp/agents-polished.png)
- [Memori](../tmp/memory-polished.png)
- [Aktivitas](../tmp/activity-polished.png)
- [Pemakaian dan rupiah](../tmp/usage-rupiah.png)
- [Log sistem](../tmp/logs-polished.png)
- [Pengaturan terang](../tmp/settings-polished.png)
- [Daftar peran pada tema gelap](../tmp/settings-polished-dark.png)

Perubahan masih lokal; belum di-commit atau di-push.

## Lanjutan — dashboard Pemakaian

Halaman Pemakaian diperbarui lagi atas permintaan pengguna. Kartu besar dengan empat grafik kecil diganti ringkasan empat metrik, komposisi token input/output, sorotan brand/agent terbesar yang dihitung dari data, serta grafik ranking lebar. Pengguna dapat memilih kategori Brand/Agent/Jenis pekerjaan/Model, mengganti ukuran Token/Eksekusi/Biaya LiteLLM, dan membuka baris untuk melihat angka rinci. Grafik menggunakan baseline nol, skala bersama, label angka dan persentase, legenda, sumber, serta periode. Nilai nol tetap nol, tanpa bar minimum kosmetik atau pembagian yang menghasilkan NaN.

Langfuse memiliki area tersendiri untuk estimasi USD/IDR, token, generasi, dan grafik per model dengan pilihan biaya/token. Biaya Langfuse dan LiteLLM tidak digabung karena sumber/cakupannya berbeda. Kurs tetap Rp18.168/US$ tetap digunakan. Tidak menambahkan tren waktu karena endpoint hanya mengembalikan agregat periode.

Perubahan periode me-remount reader agar respons terlambat dari periode lama tidak menimpa tampilan baru; filter kelompok dan ukuran tetap disimpan pada halaman. Tes fitur mencakup kasus ini, perubahan grouping/metric, rincian biaya nol, dan Langfuse saat periode lokal kosong. Build, lint, git diff --check, serta 6 tes Usage yang relevan lulus. Pemeriksaan browser dengan data aktual: semua pilihan kategori dan metric, rincian baris, tema terang/gelap, serta lebar 1440/1280/1024/768/390/320 tanpa overflow halaman. Tidak menjalankan ulang seluruh suite yang sebelumnya lulus untuk perubahan UI yang terlokalisasi ini.

Bukti terbaru: [desktop terang](../tmp/usage-analytics-desktop.png), [desktop gelap](../tmp/usage-analytics-dark.png), [rincian mobile](../tmp/usage-analytics-mobile.png).

## Panel agent: Tugas, Approval, Folder, Memori & Rules
- Tugas kerja dipisahkan dari chat; pencarian, filter aktif/selesai, brief dan hasil dalam disclosure, tindakan retry/cancel dipertahankan.
- Approval diperjelas hierarki, area hasil bergulir, arahan revisi dan keputusan tetap memakai API sebelumnya.
- Folder memakai grid berkas agent/brand, pencarian, versi terbaru/semua, balasan opsional dan pratinjau inline sandbox.
- Memori memisahkan Catatan tim dan Konteks resmi. Dokumen dirender sebagai Markdown; editor menampilkan cakupan perubahan dan meminta pengakuan cakupan.
- PUT konteks hanya menerima dokumen yang tersedia bagi agent, menolak konflik isi/JSON tidak valid/path asing. Susunan agents.json tetap konfigurasi, tidak diedit dari panel. Versi sebelumnya beserta aktor disimpan di context/.history/ (diabaikan Git); pemulihan saat ini melalui berkas cadangan, belum melalui UI.
- Konteks dibaca ulang ketika tugas berikutnya dibangun; proses yang sedang berjalan tidak berubah. Belum ada SSO/RBAC pada aplikasi lokal ini.
- QA: typecheck dan lint file berubah lulus; pengujian editor memakai direktori sementara, tidak mengubah konteks bisnis asli. Browser memverifikasi grid terisi/kosong serta navigasi dokumen dan tombol edit. Penyimpanan konteks bisnis asli sengaja tidak dijalankan untuk QA.
- Bukti: tmp/agent-context-library.png.

## 2026-11-04 — Orkestrasi Manager tahap awal

Implementasi: mode eksplisit “Delegasikan pesan ini ke tim” pada chat Manager dan jenis tugas “Delegasikan ke tim”. Chat biasa tetap percakapan. Alur: Hermes merencanakan JSON → validasi 1–5 paket spesialis → simpan rencana/tugas anak dalam satu transaksi → antrekan spesialis → tunggu approval setiap hasil → Hermes Manager merangkum → approval rangkuman.

- Rencana dan hubungan parent_id persisten; advisory lock mencegah pemrosesan Manager bersamaan. Menunggu spesialis tidak memanggil model atau memakai jatah percobaan. Pengulangan/restart membaca rencana yang sama; antrean ulang tugas anak yang masih queued menutup celah DB commit sebelum enqueue.
- Pilihan spesialis dibatasi agent aktif di brand yang sama dan jenis pekerjaan draft yang diizinkan; tidak ada delegasi rekursif. Satu paket per spesialis. Gagal/dibatalkannya anak menghentikan agregasi; pembatalan induk menghentikan anak sebelum mulai atau sebelum menyimpan hasil in-flight. Eksekusi model in-flight belum dibatalkan seketika.
- Progress tersedia pada detail tugas dan disclosure pekerjaan Manager. Status induk selama menunggu masih Antre; rincian progress menjelaskan penantian hasil/approval.
- Migrasi 009_manager_orchestration.sql menambah manager_plans dan indeks parent.
- Batas tahap: paket mandiri paralel dalam satu brand. Belum ada DAG dependensi, handoff sister-brand ke spesialis OTCA, lampiran chat, katalog skill/plugin/connector, atau retrieval memori berkelanjutan. RACI dipakai sebagai instruksi perencana; kesesuaian semantik hasil rencana tetap memerlukan penilaian manusia. Tidak mengklaim seluruh FR-03–FR-05 telah selesai.
- QA: build produksi, lint file berubah, diff whitespace lulus. Empat file pengujian/25 tes lulus dengan Postgres office_test terpisah; Hermes disimulasikan. Termasuk dua eksekusi Manager bersamaan, rencana tunggal, menunggu approval, agregasi, kegagalan anak dan pembatalan. Belum uji model Hermes live untuk orkestrasi.
- Bukti UI kontrol Manager: tmp/manager-delegation-mode.png. Tidak mengirim tugas bisnis untuk QA browser.
