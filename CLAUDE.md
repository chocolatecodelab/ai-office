# AI Office 3D OTCA

Kantor virtual tempat 4 brand OTCA (Official OTCA, Info Jerman, Ciao Manda, Jepang Koey) menjalankan AI agent
marketing & creative. Repo ini adalah **Ruang**: `web` (React + kantor 3D) dan `api` (Express) dari arsitektur
Blueprint v3.1. Agent sendiri berjalan di container Hermes per brand.

## Baca dulu
- `docs/PLAN.md`: requirement, arsitektur, roadmap per level (L0–L8). Prioritas: **Event Specialist OTCA**.
- `context/`: aturan, definisi agent, dan brand. Sumber tunggal; jangan menyalin isinya ke kode.
- `docs/otca-agents.md`: RACI, kontrak handoff, approval.
- `docs/spike-hermes.md`: hasil uji Hermes + Codex (cara `api` bicara dengan Hermes).

## Perintah
```bash
npm run dev        # api 127.0.0.1:3001 + Vite UI
npm test           # vitest
npm run lint
npm run build
node scripts/setup-env.mjs          # sekali: infra/env/*.env dari template
docker compose -f infra/compose.yml -f infra/compose.local.yml up -d   # postgres, redis, litellm
node scripts/litellm-setup.mjs      # sekali: pool budget + virtual key per brand
node scripts/hermes-init.mjs otca   # lalu tambah -f infra/compose.hermes.yml untuk hermes-otca
```
Port lokal (hanya 127.0.0.1): postgres 15432, redis 16379, litellm 14000.

## Aturan kerja
- **Rahasia** hanya di `.env` dan `infra/env/*.env` (di luar git). Hook `.claude/hooks/block-secrets.mjs` memblokir penulisan key/token.
- **Aksi ke luar** (posting, iklan, pesan, LP) hanya lewat `api` setelah approval. Agent tidak pernah memegang token platform. Tidak ada endpoint aktivasi iklan atau ubah budget.
- **Isolasi brand:** setiap query, event, dan file memakai `brand_id`.
- **Integrasi** dibuat sebagai adapter dengan mode `mock` / `sandbox` / `live`.
- **`context/`**: bagian `[RESMI]` tidak diubah tanpa persetujuan; perubahan lewat PR, lalu restart service.
- UI dan output agent berbahasa Indonesia; kode dan komentar mengikuti gaya file di sekitarnya.
- Pengembangan di Windows: test yang bergantung pada path POSIX atau file mode diberi `skipIf(win32)`, bukan dihapus.
- Setiap level selesai bila gerbangnya di `docs/PLAN.md` lulus.
