import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { brandStyle } from './pdf-html.js'
import { findBrowser, htmlToPdf, renderDocumentPdf } from './render-pdf.js'

const browser = findBrowser()
const otca = () => brandStyle('otca', 'Official OTCA', '#CB9D31')

/** Every text stream of a PDF, to check what was drawn on its pages. */
function drawnText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  return [...raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map((match) => { try { return inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1') } catch { return '' } }).join('\n')
}

describe('PDF rendering', () => {
  it('rejects when there is no browser to print with', async () => {
    await expect(htmlToPdf('<p>x</p>', { header: '', footer: '' }, '')).rejects.toThrow(/tidak ditemukan/)
  })

  it('still produces a plain PDF when the browser cannot be started', async () => {
    const pdf = await renderDocumentPdf('# Cadangan\n\nIsi.', { name: 'c.pdf', brand: { name: 'X', accent: '#1f2937', family: 'Montserrat' }, browserPath: '/tidak/ada/chrome' })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  }, 30_000)

  it.skipIf(!browser)('prints a branded multi-page document with its tables and fonts embedded', async () => {
    const rows = Array.from({ length: 60 }, (_, index) => `| Ide ${index + 1} | Reels | Minggu ${index % 4 + 1} |`).join('\n')
    const pdf = await renderDocumentPdf(`# Rencana Konten Q4\n\n## Ringkasan\n\nParagraf **penting**.\n\n- satu\n- dua\n\n| Ide | Format | Waktu |\n|---|---|---|\n${rows}\n\n## Penutup\n\nSelesai.`, { name: 'rencana.pdf', brand: otca() })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1)
    expect(pdf.length).toBeGreaterThan(20_000) // fonts and logo are embedded
  }, 90_000)

  it.skipIf(!browser)('does not run scripts or fetch anything from the network', async () => {
    const pdf = await htmlToPdf('<!doctype html><body><p id="a">aman</p><script>document.getElementById("a").textContent="DIJALANKAN"</script><img src="http://127.0.0.1:9/x.png"></body>', { header: '', footer: '' })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(drawnText(pdf)).not.toContain('DIJALANKAN')
  }, 90_000)
})
