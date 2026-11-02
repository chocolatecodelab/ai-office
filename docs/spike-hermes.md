# Spike L0: Hermes + Codex

Hasil uji hari 1 (2 November 2026) untuk pertanyaan di `docs/PLAN.md` L0. Status: **sebagian selesai**.
Jalur `api` → Hermes → LiteLLM sudah terbukti. Login Codex menunggu Pengguna karena memakai akun ChatGPT
Plus (lihat [Yang perlu Pengguna lakukan](#yang-perlu-pengguna-lakukan)).

## Lingkungan uji

| Komponen | Versi |
|---|---|
| Hermes Agent (image) | `nousresearch/hermes-agent` 0.22.5, dikunci digest di `infra/compose.hermes.yml` |
| Hermes Agent (CLI laptop) | 0.21.0 |
| LiteLLM | 1.106.6 (`main-stable`), dikunci digest di `infra/compose.yml` |
| Docker Desktop | 29.5.2, VM 8 GB |

## Jawaban

### 1. Bagaimana `api` mengirim tugas ke Hermes? → **API server Hermes (OpenAI-compatible)** ✅
- Setiap container Hermes menyalakan API server (`API_SERVER_ENABLED=true`, port 8642, kunci `API_SERVER_KEY`).
  Port tidak dibuka ke host; `api` memanggilnya lewat jaringan Docker internal.
- Teruji: `GET /health` → `{"status":"ok","version":"0.22.5"}`, `GET /v1/models`, dan
  `POST /v1/chat/completions` sampai ke LiteLLM dengan key brand `otca-umum`.
- **Untuk L1 pakai `/v1/runs`, bukan `/v1/chat/completions`.** Alasannya:
  - chat completions mengembalikan **HTTP 200** walaupun provider gagal, dengan pesan error di dalam isi balasan, sehingga `api` tidak bisa membedakan hasil dari kegagalan;
  - `/v1/runs` punya status run;
  - `/v1/runs` mendukung `Idempotency-Key`, jadi retry tidak membuat tugas ganda;
  - `/v1/runs` selalu menghormati model/provider yang diminta per request.
- **Satu container per brand, satu profil Hermes per agent.** Dengan `gateway.multiplex_profiles`, satu API server
  melayani semua profil di `/p/<profil>/v1/...`, dan autentikasinya terikat ke profil itu.
- Status `waiting_quota` dapat dibaca dari error run; Hermes juga punya probe kuota Codex (`auth_codex.py`).
- `hermes kanban` (papan tugas SQLite milik Hermes) **tidak dipakai**. Sumber status tetap Postgres di `api`
  (PLAN 5.1 butir 3), agar tidak ada dua papan tugas yang harus disinkronkan.

### 2. Login Codex (ChatGPT Plus) di container → **device-code login, satu login per container** ⏳
- Hermes punya provider `openai-codex` dengan login **device code**, jadi bisa dilakukan di container tanpa browser.
- Hermes sengaja memakai token store sendiri karena refresh token OpenAI **berotasi**. Menyalin satu `auth.json`
  ke 4 container akan membuat container lain logout saat satu container me-refresh token.
  Jadi: **login terpisah di setiap container** dengan akun ChatGPT Plus yang sama. Kuota tetap satu (milik akun).
- `hermes proxy` (satu proxy bersama) **tidak bisa** dipakai untuk Codex. Proxy saat ini hanya mendukung
  Nous Portal dan xAI.
- **[KONFIRMASI]** Apakah memakai satu langganan ChatGPT Plus dari 4 container (dan server) sesuai ketentuan
  OpenAI. Ini keputusan bisnis; kalau tidak boleh, opsinya: 1 langganan per brand, atau pindah ke API (OPS-10).

### 3. Fallback otomatis → **jangan pasang `fallback_providers` untuk tugas biasa** ✅ (dari dokumentasi)
- Fallback Hermes aktif saat terkena rate-limit (429 setelah retry habis) atau kuota habis. Untuk kuota langganan
  seperti Codex, Hermes **bertahan di fallback sampai waktu reset**.
- Kalau fallback ke LiteLLM dipasang, tugas biasa diam-diam menghabiskan pool umum. Ini bertentangan dengan FR-12.
- Keputusan untuk L1:
  - **Tugas biasa:** profil tanpa fallback. Saat Codex habis, run gagal dengan error kuota, lalu `api` menandai tugas `waiting_quota` dan menjadwalkan ulang setelah reset.
  - **Tugas mendesak:** `api` mengirim run dengan override `provider: litellm` + model `cepat`/`final` (didukung `/v1/runs`).
  - Batas pool di LiteLLM tetap menjadi pengaman terakhir.

### 4. Gerbang L0-06 (LiteLLM) ✅
- Tiga pool di LiteLLM, masing-masing dengan budget 30 hari: `pool-umum` $20 (`cepat`, `final`), `pool-video` $20 (`video`, `cepat`), dan `pool-gambar` $10 (`gambar`).
- Ada 12 virtual key, yaitu 4 brand × 3 pool. Batasnya diambil dari `agents.json`: $5 untuk pool umum dan video; untuk pool gambar $4 (OTCA) atau $2 (sister brand).
- Teruji tanpa biaya:
  - key umum yang memanggil `video` ditolak (403);
  - key video yang memanggil `final` ditolak (403);
  - key dengan budget $0 ditolak dengan `budget_exceeded` (422).

## Temuan yang mengubah rencana L1

| Temuan | Dampak | Tindakan |
|---|---|---|
| Bind mount `data/<slug>` di Docker Desktop membuat SQLite Hermes mematikan WAL (risiko korup di filesystem lintas-VM) | Hanya di laptop Windows; di VPS Linux aman | Di `compose.local.yml` pakai **named volume** untuk `/opt/data`; konfigurasi disalin dengan `docker cp` |
| Hermes memperingatkan: API server terbuka + terminal backend `local` = agent punya akses terminal & file penuh di container | Agent bisa menjalankan perintah apa saja | L1: matikan toolset `terminal`/`file` untuk profil agent; tool hanya dari MCP `api` sesuai `agents/*.md` (SEC-05, SEC-07) |
| Hermes 0.22.5 (image) lebih baru dari CLI laptop 0.21.0 | Perbedaan perilaku saat uji lokal | Uji selalu lewat container, bukan CLI laptop |

## Yang perlu Pengguna lakukan

1. **Isi key Anthropic** di `infra/env/litellm.env` (`ANTHROPIC_API_KEY=`). Key ini tidak ada di `.env` repo, jadi
   belum terisi otomatis. Setelah itu jalankan `docker compose -f infra/compose.yml -f infra/compose.local.yml restart litellm`.
2. **Login Codex di container OTCA** (device code: buka URL yang muncul, masukkan kodenya, login ChatGPT):
   ```bash
   docker exec -it ai-office-hermes-otca-1 hermes auth add openai-codex
   ```
   Lalu cek `docker exec ai-office-hermes-otca-1 hermes auth status openai-codex`.
3. **Buat akun Langfuse Cloud dan bot Telegram** (sisa L0-07). Kunci keduanya nanti diisi ke `infra/env/`.
4. Putuskan pertanyaan **[KONFIRMASI]** di bagian 2 (ketentuan memakai satu ChatGPT Plus untuk banyak container).

Setelah langkah 1–2, sisa spike: menjalankan satu run Codex dan memaksa kondisi kuota habis untuk melihat
bentuk error yang akan dipetakan ke `waiting_quota`.
