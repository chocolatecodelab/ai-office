# Menghubungkan AI Office ke Claude Code (MCP)

`server/mcp.ts` adalah MCP server lokal (stdio) yang membuat sesi **Claude Code** atau **Claude Desktop** di komputer ini bisa membaca dan mengontrol AI Office: melihat status agen, membuat dan menjalankan tugas Kanban, memanggil rapat, dan menyimpan memori agen. Ini alat bantu pengembangan untuk Builder.

Akses dari claude.ai (endpoint remote `/mcp` dengan OAuth), pendaftaran Project claude.ai sebagai agen, dan mode cermin **sudah dihapus** sesuai `docs/PLAN.md`. Di L1, infrastruktur MCP ini dipakai ulang sebagai tool kantor untuk container Hermes.

MCP server ini berbicara ke server AI Office lewat HTTP API-nya, jadi **AI Office harus sedang berjalan**:

```bash
npm run dev      # atau: npm run build && npm start
```

## Tools yang tersedia

| Tool | Fungsi |
|---|---|
| `office_status` | Siapa sedang apa dan di ruangan mana |
| `list_agents` | Daftar agen dan perannya |
| `list_tasks`, `get_task` | Lihat tugas Kanban |
| `create_task`, `update_task_status`, `run_task` | Buat, pindahkan, dan kerjakan tugas |
| `start_meeting`, `end_meeting` | Panggil atau bubarkan rapat di kantor 3D |
| `add_agent_note` | Simpan catatan ke memori jangka panjang agen |
| `list_scheduled_jobs` | Daftar jadwal rutin agen |

## Claude Desktop

Buka **Settings → Developer → Edit Config** (file `%APPDATA%\Claude\claude_desktop_config.json`), lalu tambahkan:

```json
{
  "mcpServers": {
    "ai-office": {
      "command": "node",
      "args": [
        "D:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE\\node_modules\\tsx\\dist\\cli.mjs",
        "D:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE\\server\\mcp.ts"
      ],
      "env": {
        "RUANG_URL": "http://127.0.0.1:3001"
      }
    }
  }
}
```

Tutup Claude Desktop sepenuhnya (termasuk dari system tray), lalu buka lagi. Tool `ai-office` akan muncul di menu tools pada kotak chat.

## Claude Code

```bash
claude mcp add ai-office --scope user -- node "D:\KERJAAN\CODING\CLAUDE\AI_OFFICE\node_modules\tsx\dist\cli.mjs" "D:\KERJAAN\CODING\CLAUDE\AI_OFFICE\server\mcp.ts"
```

Cek dengan `claude mcp list`. Di aplikasi Claude desktop (tab Code), server MCP dari konfigurasi user ini juga ikut terbaca di sesi baru.

## Pengaturan

| Variabel | Default | Keterangan |
|---|---|---|
| `RUANG_URL` | `http://127.0.0.1:3001` | Alamat AI Office |
| `RUANG_PORT` | `3001` | Dipakai jika `RUANG_URL` tidak diisi |
| `RUANG_ACCESS_CODE` | kosong | Wajib diisi hanya jika **Settings → Access code** aktif |

## Contoh perintah di chat Claude

- "Cek status AI Office, siapa yang sedang sibuk?"
- "Minta CEO menyusun rencana kampanye produk baru dan bagi tugasnya ke tim."
- "Buat tugas tema event untuk event-specialist, prioritas tinggi, lalu jalankan."
- "Simpan ke memori content-creator: fokus minggu ini persiapan studi ke Jerman."

## Catatan

- Balasan agen memakai Anthropic API jika API key sudah diisi (`.env` atau halaman Settings). Tanpa key, office mencoba Claude Code CLI dengan login Anda; jika itu juga gagal, balasannya simulasi dan diberi label "Mode simulasi".
