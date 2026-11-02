# Aset 3D dan logo: sumber dan lisensi

Setiap aset yang dipakai kantor 3D dicatat di sini (`docs/PLAN-KANTOR-3D.md` §7). Aset tanpa lisensi yang jelas
tidak dipakai. Paket mentah disimpan di `aset-sumber/` (tidak masuk git); hasil optimasi di `public/models/`
dibuat ulang dengan `node scripts/optimize-models.mjs`.

## Model 3D

| Paket | Pembuat | Versi | Lisensi | Sumber | Diunduh | Dipakai untuk |
|---|---|---|---|---|---|---|
| Furniture Kit | Kenney | 2.0 | CC0 1.0 | https://kenney.nl/assets/furniture-kit | 2 Nov 2026 | `public/models/furniture.glb` (47 bagian, lihat `FURNITURE` di skrip) |

CC0 tidak mewajibkan atribusi. Sebagai bentuk terima kasih, kredit "Kenney (kenney.nl)" boleh dicantumkan di
halaman Settings.

**Karakter:** tetap memakai avatar kotak-kotak Ruang yang dibuat dari kode (`src/scene3d/character.tsx`), tanpa
file aset. Karakter Quaternius *Universal Base Characters* dan *Universal Animation Library* (CC0) sempat diuji di K0
dan **ditolak Pengguna** (2 Nov 2026) karena terlihat aneh; paketnya masih ada di `aset-sumber/` tetapi tidak dipakai.

### Catatan teknis
- Decoder Draco di `public/draco/` disalin dari `three/examples/jsm/libs/draco/gltf/` (three.js, lisensi MIT).

## Logo brand

| File | Asal | Catatan |
|---|---|---|
| `public/brands/otca/logo.png` | Brand Guidelines OTCA (New), hlm. 3 | Versi tanpa glow: logo kecil, sudut konten |
| `public/brands/otca/logo-glow.png` | Brand Guidelines OTCA (New), hlm. 3 | Versi glow: logo besar (banner, papan nama lantai) |
| `public/brands/infojerman/logo.png` | Info Jerman Brand Guideline 2026, hlm. 1 | Wordmark "INFO JERMAN by OTCA" dirender dari vektor PDF; latar dibuat transparan |
| `public/brands/ciaomanda/logo.png` | Brand Guidelines Video Ciao Manda, hlm. 3 | |
| `public/brands/jepangkoey/logo.png` | Brand Guidelines Video Jepang Koey, hlm. 3 | |

Logo adalah milik OTCA dan hanya dipakai di AI Office internal.
