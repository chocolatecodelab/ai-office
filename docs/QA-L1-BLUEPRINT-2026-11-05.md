# QA semua ID L1 blueprint PDF

Sumber: Blueprint v3.1, halaman 33–34, ID L1-01–L1-12. Ekstraksi lokal: tmp/blueprint-v31.txt. Ini L1 Social Media Manager OTCA, bukan L1 Event pada roadmap repo lama. Audit mengikuti keputusan pengguna: brand independen, Event di agent, login ditunda. Kelulusan kode tidak menggantikan penerimaan manusia atau akun uji.

## L1-01 — Hermes OTCA dan konteks read-only: sebagian

Mount read-only tersedia di infra/compose.hermes.yml; pemilihan konteks, aturan brand dan isolasi diuji di server/otca-context.test.ts serta office.test.ts. Ditemukan konteks OTCA lama yang masih menyatakan menaungi tiga brand lain; diperbaiki sesuai keputusan pengguna. Bukti agent mengutip aturan secara benar tetap memerlukan dataset/konteks yang disahkan. Brand verbal masih DRAFT.

## L1-02 — Codex dan LiteLLM: sebagian

Klien Hermes, routing model, biaya, kuota dan fallback tersedia. Tes menggunakan Hermes simulasi membuktikan routing, bukan bahwa kredensial kedua jalur hidup saat audit. Spike historis ada dalam docs/spike-hermes.md. Perlu smoke kedua jalur pada konfigurasi aktif sebelum kelulusan live.

## L1-03 — skema DB: diperbaiki dan teruji

Migrasi otomatis serta brands, agents, tasks, approvals dan audit_log tersedia. Audit menemukan sources dan consents belum tersedia; migrasi016 menambahkan keduanya. Foreign key composite mencegah consent menunjuk sumber brand lain dan status granted mewajibkan referensi bukti. Ini fondasi registri, belum form/API pengelolaan atau enforcement sumber/consent pada ingest/publikasi; lampiran dan trace tidak disamakan dengan registri tersebut.

## L1-04 — API, status, approval dan WebSocket: tersedia, QA otomatis

OfficeStore, queue dan endpoint Office tersedia. Regresi server serta office-live.test.tsx dan office-dialog-focus.test.tsx menguji perubahan status/pembaruan browser. Pengukuran latensi perangkat nyata bukan cakupan tes ini.

## L1-05 — BullMQ, kuota dan auto-resume: tersedia, QA otomatis

queue.ts dan runner.ts menangani waiting_quota, retry dan pemulihan. Regresi integrasi memakai kuota simulasi; jangan menyebut reset kuota provider nyata diuji pada audit ini.

## L1-06 — Drive content library dan klasifikasi: sebagian

OAuth brand dan pemilih berkas Drive tersedia, baca saja. Tes OAuth/Drive mencakup pemulihan dan isolasi. Belum ada gate library approved beserta metadata brand/platform/format yang lengkap; koneksi akun nyata dan berkas approved belum dibuktikan.

## L1-07 — draft, schedule, komentar: sebagian, diperbaiki

Draft caption memakai publikasi.caption dan approval publikasi. Migrasi015 menambahkan social_schedule; endpoint POST /api/office/brands/:brand/tasks/:id/social-schedule menerima platform instagram/facebook dan scheduledAt ISO dengan zona waktu. Jadwal hanya menerima caption SMM berstatus approved, approval publikasi dan aset versi cocok, dalam brand yang sama. Transaksi mengunci tugas, mencegah duplikasi dan menolak penimpaan jadwal berbeda. GET /api/office/brands/:brand/social-schedule menampilkan rencana brand.

Status planned dan delivery local-plan-only sengaja tidak berarti posted. Belum ada worker publikasi provider, UI jadwal sosial, read_comments atau klasifikasi komentar. Kalender Event tidak disamakan dengan scheduler sosial. ID ini belum selesai.

## L1-08 — dashboard 2D dan approval: tersedia, QA otomatis

Papan tugas, daftar agent, jenis approval dan reviewer tersedia. Tes alur tugas, approval, draf yang gagal dan pengembalian fokus tersedia. Hak identitas reviewer melalui SSO/RBAC tetap ditunda; label approver tidak sama dengan enforcement per pengguna.

## L1-09 — Instagram akun uji: belum

Adapter meta-graph masih adapterReady:false. Tidak ada posting yang dibuat pada audit ini. Diperlukan implementasi adapter dan koneksi akun uji/izin Meta serta bukti posting tampil. Jangan mengirim caption produksi untuk smoke test.

## L1-10 — brand verbal RESMI: menunggu supervisor

context/brands/otca/brand.md masih menandai strategi/suara DRAFT dan data KONFIRMASI. Tidak diubah menjadi RESMI oleh pengembang. Memerlukan keputusan Supervisor atas layanan, klaim, suara dan sapaan.

## L1-11 — FAQ dan dataset20: belum disahkan

Belum ada KB FAQ tervalidasi untuk auto-reply beserta dataset SMM resmi. Harus dikurasi dari jawaban yang benar dan diizinkan; dilarang mengarang harga/program atau mengaktifkan balasan publik otomatis sebelum review.

## L1-12 —20 tugas, approval rate, biaya/kuota: belum

Endpoint evaluasi cohort sudah tersedia di quality-evaluation.ts, tetapi tidak menggantikan20 hasil SMM nyata. Minimum dan target70% harus dinilai atas cohort yang ditetapkan sebelum tes, mode mock/live dipisahkan. Unit dan integrasi bukan20 tugas yang disetujui manusia.

## Keputusan audit

L1 keseluruhan BELUM LULUS. Celah implementasi: sumber/consent, library approved dan klasifikasi, worker/provider posting, komentar, FAQ. Gerbang eksternal: konteks verbal supervisor, akun Meta uji, Drive aktif dan20 penilaian manusia. Memperbaiki draft/schedule tidak menutup seluruh L1.


## Bukti pengujian putaran ini

- Suite menyeluruh sebelum perbaikan terakhir:345 lulus,1 skipped,73 file (tmp/l1-qa-tests.log). Skipped tetap tidak dianggap lulus.
- Setelah gerbang jadwal ditambahkan:33 integrasi Postgres lulus (tmp/l1-social-tests.log), termasuk transaksi paralel/idempotensi, penolakan sebelum approval dan lintas brand.
- Build produksi dan lint file berubah lulus. Tidak ada posting eksternal, pengesahan Supervisor, maupun20 penilaian manusia pada audit ini.

Pemeriksaan migrasi akhir:34 integrasi Postgres lulus, termasuk penolakan consent lintas brand dan granted tanpa bukti (tmp/l1-final-integration.log). Unit validasi zona waktu/tanggal kalender jadwal juga lulus. Tidak ada API/form consent yang diklaim tersedia dari skema saja.


## Lanjutan lokal setelah jawaban pengguna

Pengguna meminta persiapan lokal karena akun/Reviewer belum tersedia. Tool comment-classification untuk SMM, mock read_comments, FAQ draft dan20 fixture sintetis ditambahkan. Panduan docs/L1-LOCAL-SMM-2026-11-05.md. Perkembangan ini menggantikan ketiadaan klasifikasi/fixture pada audit awal, tetapi tidak menutup L1-07 produksi, L1-09 akun nyata, L1-11 pengesahan atau L1-12 penilaian manusia.
