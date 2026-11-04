import { agentContextFiles, contextPrompt } from '../otca-context.js'
import type { Task } from './store.js'

// What a Hermes run is told: the agent's role and the brand's rules from context/ as instructions,
// and the task itself (brief, earlier version, reviewer notes) as input.

const OUTPUT_RULES = `
Cara menyerahkan hasil:
- Tulis hasil kerja final langsung, dalam Markdown yang rapi dan berbahasa Indonesia. Hasil ini masuk ke kotak Approval untuk direview manusia.
- Jangan bertanya balik atau menunda. Jika ada data yang belum diketahui, tandai di tempatnya dengan [KONFIRMASI: ...] dan lanjutkan.
- Jangan mengarang angka, tanggal, harga, nama narasumber, atau klaim yang tidak ada di brief atau konteks resmi.
- Pekerjaan agen lain cukup ditulis sebagai brief singkat untuk agen itu di bagian akhir.`

/** The agent's instructions, built from context/ for its brand. Throws when context/ lacks the agent. */
export function agentInstructions(contextDir: string, agentType: string, brandId: string, brandName: string, conversation = false): string {
  const files = agentContextFiles(contextDir, agentType, brandId)
  if (!files) throw new Error(`Definisi agen ${agentType} tidak ada di context/agents/.`)
  const title = files[0].content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? agentType
  return `Anda adalah ${title} untuk brand ${brandName}. Tujuan, tanggung jawab, tool, approval, dan KPI Anda ditetapkan di /context/agents/${agentType}.md.
${conversation ? 'Jawab percakapan pengguna dalam bahasa Indonesia sesuai peran dan konteks resmi. Minta klarifikasi bila diperlukan. Jangan mengarang data. Semua hasil merupakan draf untuk review; pesan chat bukan izin publikasi, pengiriman pesan eksternal, atau perubahan budget. Bila diminta membuat berkas (naskah, tabel, JSON, dan sejenisnya), tulis isinya dalam blok yang diawali satu baris ~~~file:nama-berkas.md dan diakhiri satu baris ~~~ (ekstensi yang boleh: md, txt, csv, json, html, srt, vtt, pdf; untuk pdf tulis isinya dalam Markdown dengan huruf Latin, sistem yang membuat PDF-nya; maksimal 5 berkas per jawaban). Jelaskan isi berkas di luar blok, jangan hanya menaruh blok.' : OUTPUT_RULES}

${agentType==='content-creator' && !conversation ? 'Susun draft dengan bagian: tujuan dan audiens (anonim), angle, headline/subheadline, isi per slide atau caption sesuai brief, CTA, sumber dan data yang belum dikonfirmasi, serta catatan QC. Ikuti visual.json dan checklist-publikasi.md. Jangan menyebut gambar sudah dibuat bila output hanya teks. Jangan memasukkan identitas orang dari chat/SPS; gunakan ringkasan anonim.' : ''}

${contextPrompt(files)}`
}

/** The run input: the brief, and for a revision the latest version plus every reviewer note. */
export function taskInput(task: Pick<Task, 'title' | 'brief' | 'result'>, revisionNotes: string[]): string {
  const parts = [`# Tugas: ${task.title}`, task.brief.trim()]
  if (revisionNotes.length && task.result) {
    parts.push(`## Versi sebelumnya (ditolak reviewer)\n${task.result}`)
    parts.push(`## Catatan reviewer yang wajib diperbaiki\n${revisionNotes.map((note, index) => `${index + 1}. ${note}`).join('\n')}`)
    parts.push('Tulis ulang hasil lengkapnya dengan semua catatan di atas sudah diperbaiki.')
  }
  return parts.filter(Boolean).join('\n\n')
}
