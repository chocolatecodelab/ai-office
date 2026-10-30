# Menghubungkan AI Office ke Claude (MCP)

`server/mcp.ts` adalah MCP server yang membuat chat di **Claude Desktop** atau **Claude Code** bisa mengontrol AI Office: melihat status agen, chat dengan agen, membuat dan menjalankan tugas Kanban, memanggil rapat, dan menyimpan memori agen.

MCP server ini berbicara ke server AI Office lewat HTTP API-nya, jadi **AI Office harus sedang berjalan**:

```bash
npm run dev      # atau: npm run build && npm start
```

## Tools yang tersedia

| Tool | Fungsi |
|---|---|
| `office_status` | Siapa sedang apa dan di ruangan mana |
| `list_agents` | Daftar agen dan perannya |
| `chat_with_agent` | Kirim pesan ke agen dan terima balasannya (tersimpan di riwayat chat office) |
| `list_tasks`, `get_task` | Lihat tugas Kanban |
| `create_task`, `update_task_status`, `run_task` | Buat, pindahkan, dan kerjakan tugas |
| `start_meeting`, `end_meeting` | Panggil atau bubarkan rapat di kantor 3D |
| `add_agent_note` | Simpan catatan ke memori jangka panjang agen |
| `list_scheduled_jobs` | Daftar jadwal rutin agen |
| `register_project_agent` | Buat atau perbarui agen dari satu Project Claude |
| `remove_agent` | Hapus agen (bukan CEO); tugas dan jadwalnya pindah ke CEO |

## Satu agen per Project Claude

Setiap Project di claude.ai bisa menjadi satu agen di office. CEO selalu ada sebagai orchestrator dan mendelegasikan pekerjaan ke agen Project yang sesuai.

claude.ai tidak punya API untuk membaca Projects, jadi Project mendaftarkan dirinya sendiri lewat connector:

1. Buka Project di claude.ai, mulai chat baru, dan pastikan connector **AI Office** aktif.
2. Ketik: *"Daftarkan Project ini ke AI Office sebagai agen. Pakai instruksi Project apa adanya dan ringkas knowledge-nya."*
3. Claude memanggil `register_project_agent`: instruksi Project menjadi aturan agen (`CLAUDE.md` di halaman Memory) dan ringkasan knowledge menjadi `PROJECT_KNOWLEDGE.md`.
4. Ulangi untuk setiap Project. Mendaftarkan Project yang sama lagi akan **memperbarui** agennya. Jika knowledge tidak disertakan, knowledge yang lama tetap dipakai.

Agen bawaan (Marketing, Researcher, Creator) bisa dihapus dengan meminta Claude: *"Hapus agen marketing, researcher, dan creator dari AI Office."*

Jika tool baru belum muncul di claude.ai, buka **Settings → Connectors**, putuskan lalu sambungkan lagi connector AI Office, kemudian mulai chat baru.

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
- "Buat tugas riset kompetitor untuk researcher, prioritas tinggi, lalu jalankan."
- "Simpan ke memori marketing: target audiens kita UMKM di Jawa Timur."

## Catatan

- Balasan agen memakai Anthropic API jika API key sudah diisi (`.env` atau halaman Settings). Tanpa key, office mencoba Claude Code CLI dengan login Anda; jika itu juga gagal, balasannya simulasi dan diberi label "Mode simulasi".
- Untuk claude.ai (web dan aplikasi mobile), pakai endpoint remote di bawah.

# claude.ai: endpoint remote `/mcp` lewat Cloudflare Tunnel

claude.ai hanya bisa memakai connector di alamat HTTPS publik. Server office punya endpoint MCP HTTP terpisah dengan OAuth (`server/mcp-http.ts`):

- Endpoint ini jalan di **port sendiri (3002)**, yang **hanya** melayani `/mcp` dan route OAuth. UI office dan `/api` tetap di `127.0.0.1:3001` dan **tidak** ikut terbuka ke internet.
- claude.ai mendaftarkan dirinya sendiri, lalu Anda menyetujui koneksi di halaman izin dengan **kata sandi MCP** (`RUANG_MCP_SECRET`). Tanpa kata sandi itu, tidak ada yang bisa mendapatkan token.
- Token berlaku 1 jam dan diperbarui otomatis (refresh token berlaku 30 hari, sekali pakai). Hanya hash token yang disimpan, di `~/.config/ruang/mcp-oauth.json`.

## 1. Atur `.env`

```
RUANG_MCP_SECRET=kata-sandi-panjang-minimal-16-karakter
RUANG_PUBLIC_URL=https://alamat-tunnel-anda
# RUANG_MCP_PORT=3002
```

Endpoint remote **mati** selama `RUANG_MCP_SECRET` kosong. Setelah mengubah `.env`, restart `npm run dev`. Log server akan menampilkan `Remote MCP listening on http://127.0.0.1:3002/mcp`.

## 2. Pasang cloudflared

```bash
winget install --id Cloudflare.cloudflared
```

Tutup lalu buka lagi terminal agar perintah `cloudflared` dikenali.

## 3a. Tes cepat (tanpa akun, alamat berubah setiap kali dijalankan)

```bash
cloudflared tunnel --url http://localhost:3002
```

Salin alamat `https://xxxx.trycloudflare.com` yang muncul, isi ke `RUANG_PUBLIC_URL`, lalu restart office. Biarkan jendela cloudflared tetap terbuka. Alamat ini **berganti setiap kali cloudflared dijalankan ulang**, jadi connector di claude.ai harus ditambahkan ulang. Cocok untuk mencoba, tidak untuk dipakai sehari-hari.

## 3b. Alamat tetap (butuh domain yang dikelola Cloudflare, akun gratis cukup)

```bash
cloudflared tunnel login
cloudflared tunnel create ai-office
cloudflared tunnel route dns ai-office office.domainanda.com
```

Buat `%USERPROFILE%\.cloudflared\config.yml` (ganti `<TUNNEL-ID>` dengan id dari perintah `create`):

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\Nazar\.cloudflared\<TUNNEL-ID>.json
ingress:
  - hostname: office.domainanda.com
    service: http://localhost:3002
  - service: http_status:404
```

Isi `RUANG_PUBLIC_URL=https://office.domainanda.com`, restart office, lalu jalankan:

```bash
cloudflared tunnel run ai-office
```

Supaya tunnel otomatis jalan saat Windows menyala: `cloudflared service install` (dari terminal Administrator).

**Penting:** arahkan tunnel ke port **3002**, jangan ke 3001. Port 3001 berisi UI dan API office yang tidak dirancang untuk dibuka ke internet.

## 4. Tambahkan di claude.ai

1. Buka **Settings → Connectors → Add custom connector**.
2. Isi nama `AI Office` dan URL `https://alamat-anda/mcp` (dengan `/mcp` di belakang).
3. Klik **Connect**. Halaman "Izinkan akses ke AI Office?" akan terbuka. Isi kata sandi MCP, lalu klik **Izinkan**.
4. Di chat, aktifkan connector AI Office dari menu tools, lalu coba: "Cek status AI Office."

## Mencabut akses

Hapus `~/.config/ruang/mcp-oauth.json`, lalu restart office. Semua koneksi akan putus dan harus disetujui ulang. Ganti juga `RUANG_MCP_SECRET` jika kata sandinya mungkin bocor.

## Batasan

- PC, office (`npm run dev`), dan cloudflared harus menyala.
- Cloudflare memutus request yang tidak dibalas dalam ±100 detik. Chat atau `run_task` yang sangat panjang bisa gagal dengan error 524. Pakai pesan yang lebih ringkas, atau buat tugas lalu cek hasilnya dengan `get_task`.
- Lewat endpoint ini, profile lock tidak berlaku. Pemilik yang sudah menyetujui koneksi dengan kata sandi MCP bisa mengakses semua agen.
