# Pembaruan blueprint — 5 November 2026

Prioritas pada putaran ini mengikuti celah pertama laporan STATUS-BLUEPRINT-2026-11-04.md: keramaian K4. PDF Blueprint_AI_Office_3D_OTCA_v3.1.pdf dibaca ulang sebagai referensi; sumber asli tidak diubah. Penomoran K0–K7 berasal dari rencana kantor Ruang dalam repo, bukan fase L blueprint. Ambang tidak bertumpuk lebih dari 5 detik adalah gerbang simulasi proyek yang sudah ditetapkan sebelumnya.

## K4 — gerbang simulasi keramaian kini lulus

- Antrean menggunakan jarak 0,65 meter dan nomor urut pada lantai masing-masing. Urutan pelayanan tetap FIFO global. Antrean penuh 18 agent memiliki area tunggu melimpah di lobi; tidak memanjang melewati dinding depan. Perjalanan menuju/meninggalkan slot limpahan melewati sisi luar shaft, bukan memotong dindingnya.
- Maksimal 5 penumpang per kelompok asal/tujuan tetap berlaku. Keluar pintu memakai urutan slot dan interval 1,3 detik berdasarkan waktu keluar yang sebenarnya. Penumpang yang datang terlambat tidak melewati interval kelompok sebelumnya. Reservasi runtime dilepas setelah agent keluar ke lajur lantai.
- Agent berjalan searah memperlambat langkah ketika terlalu dekat dengan agent di depan, dengan target jarak 0,6 meter. Penanganan pertemuan tepat satu titik memiliki prioritas deterministik. Sistem hanya memendekkan langkah di jalur yang sudah ada, tidak mendorong avatar menembus furnitur. Arah berlawanan dan persimpangan tetap boleh berpapasan.
- Scene dan simulasi memakai helper followingStep dan slot antre dari LiftQueue yang sama. Simulasi juga diperbaiki agar ketinggian anchor fasilitas diinterpolasi ke waypoint berikutnya seperti scene; sebelumnya ketinggian 0,28 meter dapat terbawa sepanjang lantai dan membuat model berbeda dari render.
- Tes it.fails untuk penumpukan diubah menjadi tes biasa. Tujuh seed: 7, 42, 2026, 19, 73, 1234, 4096; 18 agent; 900 detik waktu simulasi per skenario.
- Hasil: durasi berdekatan di bawah 0,5 meter terlama 1,1–1,2 detik (batas 5 detik); kapasitas maksimum 3–5 sesuai skenario; setiap agent minimal 4–6 kunjungan; 147–165 perjalanan lift; tunggu lift terlama 68,1–84,6 detik (batas 120 detik).
- Sebanyak 56 tes pada 10 file terkait kantor 3D lulus. Termasuk jalur tidak melintasi meja, pintu ruangan, fasilitas, roaming, FIFO/kapasitas/keluar lift, area antre penuh, serta prioritas langkah berjalan.

Batas penerimaan: jarak terdekat di simulasi masih dapat nol sewaktu berpapasan; ini penyelesaian penumpukan berkepanjangan, bukan solver fisika semua tabrakan. Simulasi tetap model waktu/kapasitas (misalnya slot antre diposisikan langsung dan kecepatan jalan model berbeda dari scene), bukan bukti FPS atau jarak avatar pada setiap frame render. K6 perangkat menengah dan K7 tiga sesi staf tetap memerlukan penerimaan nyata.

## Perkembangan agent sejak laporan awal

- FR-02: konteks resmi berlapis, referensi berdasarkan kebutuhan, riwayat berbatas ukuran, cache versi dokumen, jejak penggunaan aktual, serta preview dan pilihan memori per pesan telah ditambahkan. Lihat dokumen CHAT-WORKSPACE, CONTEXT-OPTIMIZATION, CONTEXT-PREVIEW dan MEMORY-CHOICES bertanggal 5 November.
- FR-03: Manager memiliki delegasi persisten dalam brand sendiri, kini dengan DAG terbatas (dependsOn), gerbang approval pendahulu, penerusan hasil berversi dan rangkuman akhir untuk approval. Maksimal lima paket, satu per spesialis; belum DAG dinamis atau pengulangan peran. Lihat docs/MANAGER-WORKFLOW-2026-11-05.md.
- FR-04: dibatalkan sesuai keputusan pengguna 5 November 2026. Keempat brand independen, tanpa kewajiban Manager mengirim pekerjaan ke OTCA. Lihat docs/BRAND-INDEPENDENCE-2026-11-05.md.
- FR-05: JSON rencana delegasi, lampiran dengan grant terbatas dan asset_handoff dari hasil pendahulu yang disetujui tersedia di dalam brand sendiri. Jejak mencatat aset/versi sumber. Kontrak kerja tidak memberi kewajiban atau akses lintas brand.
- Produksi image ads, evaluasi kualitas per agent, SSO/RBAC, gate sumber/consent, Ads/LP, SMM dan worker video tetap mengikuti gerbang roadmap. Pembaruan chat atau kelulusan simulasi K4 tidak menutup fase-fase tersebut.
- Keputusan pengguna dipertahankan: Event adalah workflow Event Specialist, tanpa halaman Event tersendiri.

Pemeriksaan akhir: TypeScript, ESLint file yang diubah, build produksi dan git diff --check lulus. Smoke test browser pada ruang bersama memperlihatkan perpindahan agent di beberapa pengamatan waktu; tidak ada error console yang tercatat pada pemeriksaan. Bukti: tmp/k4-crowd-scene-start.png dan tmp/k4-crowd-scene-final.png. Tidak ada pengukuran FPS perangkat nyata atau pengukuran jarak per frame dari browser pada putaran ini. Tampilan diperbesar dikembalikan ke tampilan biasa setelah QA.


## Evaluasi kualitas — fondasi pengukuran

Status tetap L2 roadmap repo sebagian (berbeda dari nomor level PDF). Manager DAG dan penyempurnaan chat tidak menutup gerbang produksi gambar atau evaluasi kualitas. K4 simulasi lulus; K6 perangkat nyata dan K7 sesi staf tetap terbuka.

Endpoint baca-saja POST /api/office/brands/:brand/quality/preview menerima taskIds (1–100 UUID unik) dari cohort yang ditetapkan untuk satu brand. Tugas brand lain/tidak ditemukan ditolak. Tidak ada panggilan model, perubahan approval, atau publikasi. Hasil per agent memisahkan firstPass, revised, failed, pending, cancelled dan excludedChats.

Rasio = approval pertama disetujui / (approval pertama disetujui + ditolak + tugas gagal). Revisi yang kemudian disetujui tidak mengubah keputusan pertama. Chat bukan sampel kualitas produksi. Minimum 20 hasil per agent dan target 70%; tugas pending/cancelled menahan status bukti. Status metric_met hanya memenuhi metrik, bukan kelulusan rubrik desain/fakta/izin atau fase. Cohort harus representatif dan ditetapkan sebelum pengujian; mock dan live harus dipisah oleh pemilih cohort. Endpoint belum menyimpan cohort atau menegakkan mode mock/live otomatis.

Belum ada klaim 20 tugas nyata per agent/brand selesai. Langkah berikutnya: cohort persisten dengan mode eksekusi dan rubrik reviewer, dilanjutkan dataset uji bersama pemilik brand; produksi gambar serta sumber/consent tetap terbuka.


## Penomoran dan prioritas pengguna — L4 blueprint

Untuk percakapan pengembangan selanjutnya gunakan nomor blueprint PDF: L2 empat brand/SSO, L3 kantor 3D, L4 Content Creator. Nomor roadmap repo lama tetap dipertahankan sebagai referensi historis dan harus diberi label eksplisit. Penyebutan L2 sebagian pada laporan sebelumnya menggunakan roadmap repo (Content Creator), bukan L2 PDF.

L3 PDF: fitur utama kantor sudah tersedia, simulasi K4 lulus. Belum ditutup penuh karena gerbang K6 perangkat nyata dan K7 tiga sesi staf belum selesai. Pekerjaan tersebut dapat berjalan paralel dengan L4, bukan prasyarat implementasi Content Creator lokal.

Arahan pengguna: tunda login/SSO L2 selama pengembangan dan pengujian lokal. Prioritas berikutnya L4 PDF (Content Creator): anonimisasi riset sebelum model, kontrak carousel/caption dan QC, sumber/izin aset, produksi visual 1080×1350, lalu evaluasi minimal20 tugas per brand. Manager tetap dalam brand sendiri. Login tidak ditambahkan dalam lingkup ini; tidak ada klaim isolasi pengguna/SSO atau kesiapan produksi.


## Penutupan pekerjaan teknis K6/K7 — penerimaan nyata tertunda

Monitor frame diperbaiki agar frame foreground >250ms ikut diperhitungkan. Tersedia warm-up10 detik, FPS berbasis durasi seluruh frame, p95/maksimum waktu frame, jumlah stall, draw calls dan segitiga, serta ekspor JSON lokal dengan maksimal300 sampel. Sesi direset saat konteks tampilan atau visibility berubah.

58 tes kantor 3D lulus, build dan lint terarah lulus. Audit ukuran mentah5.167.900 byte, di bawah8MiB; bukan transfer jaringan HP. Uji browser desktop monitor/ekspor berhasil, contoh tampilan54–58FPS dan tanpa error console pada inspeksi. Bukti tmp/k6-performance-monitor.png dan tmp/k6-desktop-performance.json. Ini bukan benchmark HP, bukan bukti seluruh skenario K6.

K6-DEVICE-RESULTS.csv dan K7-SESSION-RESULTS.csv siap diisi; seluruh hasil nyata tetap NOT_RUN. Pengguna menyatakan sesi staf sementara belum tersedia karena server lokal. Status akhir: K6 perangkat nyata menunggu pengukuran; K7 tiga staf tertunda akses peserta. Jangan menandai L3 sepenuhnya lulus.


## Perbaikan gerakan berhenti setelah pindah tab

Renderer Fiber mereset clock.elapsedTime menjadi0 saat frameloop berubah never/always (terkonfirmasi pada paket lokal). Jadwal LiftQueue sebelumnya memakai elapsedTime sehingga setelah resume jadwal departure/exit bisa berada jauh di masa depan. Scene kini memiliki SimulationClock tersendiri yang maju maksimal0,1 detik per frame, dibagikan kepada semua agent sebelum callback geraknya. Clock tidak direset oleh visibility atau pergantian kualitas. Delta background tidak membuat lompatan perjalanan.

60 tes kantor3D lulus, termasuk regresi deadline lift setelah600 detik lalu renderer reset dan delta background300 detik. Penanda aktivitas dijeda serta tombol lanjutkan kini terlihat di luar menu. Ini memperbaiki penyebab clock mundur, bukan mengklaim semua kemungkinan kemacetan jalur tidak mungkin terjadi.

Verifikasi akhir:60 tes scene +3 regresi UI lulus; build produksi dan lint file berubah lulus. Browser menunjukkan posisi agent berubah antara tmp/movement-fixed-start.png dan tmp/movement-fixed-final.png. Tombol jeda menampilkan penanda, tombol lanjutkan di luar menu menghilangkannya dan aktivitas dilanjutkan. Siklus reset waktu/deadline lift diverifikasi lewat regresi unit; tidak mengklaim siklus background perangkat fisik sudah diuji. Saat build berganti, halaman lama sempat fallback2D karena chunk lama hilang; setelah reload build final scene3D kembali termuat.


L4 PDF dimulai: tugas riset audiens dengan penyaringan identitas teks sebelum panggilan model dan jejak hitungan untuk reviewer. Status sebagian; batasan dan backlog ada di docs/L4-CONTENT-CREATOR-2026-11-05.md. Login tidak ditambahkan.


Audit seluruh L1 PDF (12 ID) ada di docs/QA-L1-BLUEPRINT-2026-11-05.md. Perbaikan: konteks OTCA independen, registri sources/consents migrasi016, dan rencana jadwal sosial berapproval migrasi015. L1 tetap belum lulus karena gate produksi sosial, library approved, FAQ dan penilaian manusia terbuka.
