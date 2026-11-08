# OTCA Marketing & Creative Agents

Kru AI Office untuk sistem Digital Marketing & Content Production OTCA, diturunkan dari dokumen *Struktur 5 AI Agent Marketing OTCA v2*. Daftar agen dan modelnya ada di `server/claude-service.ts` (`CEO_AGENT`, `OTCA_AGENTS`). Dokumen ini menjadi acuan untuk routing, handoff, dan approval.

## Paket konteks (`context/`)

Prompt setiap agen OTCA disusun dari paket `context/` (lihat `context/README.md`), bukan ditulis di kode:

| Agen | File yang dibaca |
|---|---|
| Spesialis (`content-creator`, `video-editor`, …) | `agents/<id>.md`, semua file `_shared/`, lalu `brands/otca/` (`brand.md`, `visual.json`, `checklist-publikasi.md`) |
| CEO | prompt CEO + `agents/manager.md`, `_shared/`, `brands/otca/` termasuk `agents.json`. CEO sekaligus menjadi Manager brand OTCA. |

- Ubah perilaku agen dengan mengedit file di `context/` lewat pull request, lalu **restart server**. File dibaca sekali saat server mulai.
- Bagian `[DRAFT]` dipakai sebagai arahan; bagian `[KONFIRMASI]` tidak boleh dikarang agen.
- Lokasi lain: set `RUANG_CONTEXT_DIR`. Jika folder tidak ditemukan, agen memakai prompt bawaan di kode dan server menulis peringatan.
- Untuk sementara hanya brand `otca` yang dipakai. Info Jerman, Ciao Manda, dan Jepang Koey sudah ada di `context/brands/`, tetapi belum punya kru sendiri.

## Kru

| Id | Agen | Pemilik pekerjaan | Modul (skill di dalam agen) |
|---|---|---|---|
| `ceo` | CEO (Orchestrator) | Memecah permintaan dan routing | delegasi, rapat, ringkasan keputusan |
| `event-specialist` | AI Event Specialist | Workflow event dari kebutuhan sampai event siap | tema, brief image ads, TOR/SKB, narasumber, LP event, PPT |
| `content-creator` | AI Content Creator | Bagaimana pesan dikemas menjadi konten | insight Parents Talk, angle, copywriting, carousel, image single, caption, script |
| `video-editor` | AI Video Editor | Eksekusi teknis dan kualitas video | storyboard, shot list, edit plan, cover, video ads, QC |
| `social-media-manager` | AI Social Media Manager | Distribusi organik dan interaksi | library, kalender, scheduling, publishing, komentar, lead routing |
| `digital-marketing` | AI Digital Marketing Specialist | Penggunaan konten untuk tujuan pemasaran dan konversi | strategi, Meta/Google Ads, ads copy, LP produk, CRO, analytics |

Human Approval (Mbak Nia / reviewer / pemegang budget) sengaja **tidak** dijadikan agen.

Carousel, caption, Meta Ads, dan komentar tetap berupa modul di dalam agen, bukan agen terpisah. Setiap agen tambahan berarti handoff tambahan, dan setiap handoff memakan token.

## Model

Sistem tier `ringan/normal/berat` sudah dibuang. Pemilihan model mengikuti blueprint (pohon keputusan Bab 08 dan rasio Sonnet Bab 10, lihat `docs/PLAN.md` FR-12) dan akan berjalan di Hermes + LiteLLM mulai L1. Sampai saat itu, runtime lama memakai satu model per agen: Haiku 5.5 untuk Social Media Manager, Sonnet 5.5 untuk yang lain.

## Penghematan token yang sudah berjalan

- **Prompt caching:** peran, daftar tim, dan memori agen dikirim sebagai blok stabil yang di-cache. Papan tugas yang sering berubah ditaruh setelah breakpoint, jadi tidak membatalkan cache.
- **Papan tugas ringkas:** hanya tugas yang belum selesai, maksimal 20, dengan deskripsi dipotong 160 karakter.
- **Riwayat chat:** 12 pesan terakhir saja (sudah ada sebelumnya).

Yang masih perlu dibangun: **pustaka insight bersama**. SPS Parents Talk, chat export, dan feedback sales diekstrak sekali dengan model murah, lalu hasilnya dipasang sebagai context file untuk Content Creator, Event Specialist, dan Digital Marketing. Dengan begitu, ketiganya tidak membaca data mentah masing-masing.

## Routing (RACI)

**Utama** = satu-satunya pemilik. Agen lain hanya memberi input lewat brief.

| Aktivitas | Event | Content | Video | SMM | Digital Mkt |
|---|---|---|---|---|---|
| Olah SPS Parents Talk (konten) | input | **Utama** | — | input | input |
| Olah SPS Parents Talk (tema event) | **Utama** | input | — | — | input |
| Tema event | **Utama** | — | — | — | insight |
| Konsep 3 image ads event | **Utama** (brief) | produksi | — | — | — |
| Angle konten | — | **Utama** | input | input | input campaign |
| Carousel, image single, caption | — | **Utama** | — | distribusi | ads usage |
| Script video | brief | **Utama** | input | — | input campaign |
| Editing video, cover, video ads | brief | — | **Utama** | — | brief ads |
| Testimoni eksternal | — | seleksi & undangan | editing | komunikasi & izin | campaign usage |
| TOR, SKB, koordinasi narasumber | **Utama** | — | — | — | — |
| Landing page event | **Utama** | copy input | — | distribusi link | CRO |
| Landing page produk/umum | — | copy input | — | distribusi link | **Utama** |
| Integrasi Scalev & payment | koordinasi | — | — | — | — |
| PPT event | **Utama** | bantu visual | — | — | — |
| Kalender, scheduling, publishing | — | input | — | **Utama** | input campaign |
| Balas & moderasi komentar | — | — | — | **Utama** | leads insight |
| Ads copy | — | creative input | — | — | **Utama** |
| Meta/Google Ads (termasuk event) | campaign brief | — | aset | — | **Utama** |
| Analytics organik | — | insight | insight | **Utama** | — |
| Analytics berbayar & conversion | input data event | — | — | lead routing | **Utama** |

Tabel di atas sekaligus menyelesaikan bentrok di dokumen v2:
- **Meta Ads event:** Event Specialist hanya membuat campaign brief. Setup, aktivasi, dan optimasi dikerjakan Digital Marketing.
- **Landing page:** LP event milik Event Specialist, LP produk/umum milik Digital Marketing, dan CRO selalu milik Digital Marketing.
- **SPS Parents Talk:** pemiliknya dibedakan menurut tujuan, yaitu konten atau tema event.

## Kontrak handoff

Antar-agen hanya bertukar brief ringkas berikut, bukan transkrip percakapan. Tulis brief di deskripsi tugas (`delegate_task` / `create_task`).

```yaml
content_brief:      # → content-creator / video-editor
  tujuan: awareness | engagement | leads | registration
  audiens: ...
  masalah: ...            # dari pustaka insight
  angle: ...
  pesan_utama: ...
  format: carousel | image | reels | video-ads | ...
  platform: [ig-feed, ig-reels, ig-stories, facebook]
  cta: ...
  referensi: [...]        # file / link Drive
  deadline: YYYY-MM-DD

campaign_brief:     # → digital-marketing
  objective: ...
  kpi: { metrik: target }
  audiens: ...
  budget_usulan: ...      # tetap butuh otorisasi
  aset: [...]
  destination: url-landing-page
  jadwal: { mulai: ..., selesai: ... }

event_brief:        # dari event-specialist ke agen lain
  tema: ...
  angle: [angle-1, angle-2, angle-3]
  narasumber: [...]
  tanggal: ...
  harga: ...
  benefit: [...]
  kebutuhan:
    content-creator: ...
    video-editor: ...
    digital-marketing: ...
    social-media-manager: ...

asset_handoff:      # hasil produksi → social-media-manager / digital-marketing
  file: [...]
  versi: v1
  platform: [...]
  status_qc: lolos | revisi
  catatan: ...

approval_request:   # → manusia
  item: ...
  approver: mbak-nia | reviewer | atasan-marketing | pemegang-budget | pemilik-cerita
  risiko: ...
  deadline: ...
```

## Approval

| Hasil | Approver |
|---|---|
| Tema event dan angle konten | Reviewer / Mbak Nia |
| Carousel, image, video internal & eksternal | Reviewer / Mbak Nia |
| Caption dan publikasi | Reviewer sesuai SOP |
| Balasan komentar di luar FAQ knowledge base, hide/hapus komentar | Reviewer sesuai SOP |
| Pesan WhatsApp ke kandidat testimoni / narasumber | Reviewer sesuai SOP |
| Ads creative dan copy | Marketing / Atasan |
| Landing page dan alur pembayaran Scalev | Reviewer + IT |
| Budget dan running Ads | Pemegang otorisasi budget |
| Testimoni dan izin publikasi | Pemilik cerita dan pihak berwenang |

## Data lama

Saat server dijalankan, office yang tersimpan dengan kru lama dipindahkan otomatis:

| Lama | Baru |
|---|---|
| `creator` | `video-editor` |
| `marketing` | `digital-marketing` |
| `researcher` | `content-creator` |

Yang ikut dipindahkan: tugas, jadwal, riwayat chat, catatan, dan context file yang Anda tambahkan sendiri. Aturan CEO lama diganti dengan aturan routing OTCA. Agen Project hasil sinkronisasi claude.ai dihapus; tugas dan jadwalnya dipindahkan ke CEO.
