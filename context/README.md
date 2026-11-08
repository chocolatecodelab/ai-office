# Paket konteks AI Office 3D OTCA

Paket ini adalah "otak" agent: aturan brand, peran agent, approval, dan batas tanggung jawab,
dalam bentuk file yang bisa dibaca Hermes dan direview manusia. Simpan di repo pada folder
`context/`, lalu mount read-only ke setiap container Hermes:

```
volumes:
  - ./context/_shared:/context/_shared:ro
  - ./context/agents:/context/agents:ro
  - ./context/brands/otca:/brand:ro        # hanya brand milik container ini
```

## Isi

| Folder | Isi | Pemilik |
|---|---|---|
| `_shared/` | Aturan umum, matriks approval, RACI, batas tanggung jawab | Brain + Marketing & Creative Supervisor |
| `agents/` | Definisi 5 agent + Manager: tujuan, modul/skill, tool, approval, KPI | Brain |
| `brands/<slug>/` | `brand.md` (strategi & suara), `visual.json` (warna, font, ukuran), `checklist-publikasi.md`, `agents.json` | Brain |

## Agent aktif per brand

| Brand | Content Creator | Video Editor | Social Media Manager | Digital Marketing | Event Specialist |
|---|---|---|---|---|---|
| Official OTCA | ya | ya | ya | ya | ya |
| Info Jerman | ya | ya | ya | - | - |
| Ciao Manda | ya | ya | ya | - | - |
| Jepang Koey | ya | ya | ya | - | - |

Manager (orkestrator) ada di setiap brand. Kebutuhan iklan atau event sister brand diajukan
sebagai brief ke agent Digital Marketing / Event Specialist milik OTCA.

## Status review

Tanda di setiap file:
- **[RESMI]**: diambil dari dokumen resmi (Brand Guidelines, Struktur 5 AI Agent). Jangan diubah tanpa persetujuan.
- **[DRAFT]**: usulan untuk melengkapi bagian yang belum ada. **Wajib direview Brain dan disetujui
  Marketing & Creative Supervisor** sebelum dipakai agent di produksi.

| File | Status | Reviewer | Tanggal disetujui |
|---|---|---|---|
| brands/otca/brand.md (verbal) | DRAFT | | |
| brands/otca/visual.json | RESMI | | |
| brands/infojerman/brand.md | RESMI (catatan: guideline menyebut dirinya "rekomendasi arah brand"; konfirmasi sudah final) | | |
| brands/infojerman/visual.json | RESMI | | |
| brands/ciaomanda/brand.md (verbal) | DRAFT | | |
| brands/ciaomanda/visual.json | RESMI | | |
| brands/jepangkoey/brand.md (verbal) | DRAFT | | |
| brands/jepangkoey/visual.json | RESMI | | |
| agents/*.md | RESMI (dari Struktur 5 AI Agent) + DRAFT (bagian tool & model) | | |

## Sumber
- Struktur 5 AI Agent Marketing & Creative OTCA, versi 2 Oktober 2026
- Brand Guidelines OTCA (New)
- Info Jerman Brand Guideline 2026
- Brand Guidelines Video Ciao Manda
- Brand Guidelines Video Jepang Koey
