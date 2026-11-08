import PDFDocument from 'pdfkit'

// Markdown to PDF for the files an agent writes (artifacts.ts: a block named *.pdf carries Markdown). It reads
// headings, paragraphs, bullet and numbered lists, code blocks, rules and table rows, and strips inline markers.
// It uses the standard PDF fonts, so text outside Latin-1 (Japanese, for instance) is replaced by "?" until a font is
// bundled; HTML to PDF through a render worker with Chromium is the planned next step.

// Code points the standard PDF fonts (WinAnsi) draw: ASCII, Latin-1, and a few common punctuation marks.
const EXTRA = new Set([0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac])
const drawable = (code: number) => code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || EXTRA.has(code)

/** Text the standard fonts can draw: inline Markdown markers removed, other characters replaced. */
export function pdfText(text: string): string {
  const plain = text
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
  return Array.from(plain, (char) => (drawable(char.codePointAt(0)!) ? char : '?')).join('')
}

export function renderPdf(markdown: string, options: { title: string; accent?: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: pdfText(options.title), Creator: 'AI Office' } })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const accent = /^#[0-9a-fA-F]{6}$/.test(options.accent ?? '') ? options.accent! : '#1f2937'
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
    let inCode = false
    for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
      const line = raw.replace(/\s+$/, '')
      if (/^(```|~~~)/.test(line.trim())) { inCode = !inCode; doc.moveDown(0.3); continue }
      if (inCode) { doc.font('Courier').fontSize(9.5).fillColor('#111827').text(pdfText(line) || ' ', { width }); continue }
      const heading = line.match(/^(#{1,3})\s+(.*)$/)
      if (heading) {
        const level = heading[1].length
        doc.moveDown(level === 1 ? 0.2 : 0.5).font('Helvetica-Bold').fontSize([20, 15, 12.5][level - 1]).fillColor(level === 1 ? accent : '#111827').text(pdfText(heading[2]), { width })
        doc.moveDown(0.3)
        continue
      }
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        doc.moveDown(0.4)
        doc.moveTo(doc.x, doc.y).lineTo(doc.x + width, doc.y).strokeColor('#d1d5db').lineWidth(0.7).stroke()
        doc.moveDown(0.6)
        continue
      }
      if (!line.trim()) { doc.moveDown(0.5); continue }
      doc.font('Helvetica').fontSize(11).fillColor('#111827')
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
      const numbered = line.match(/^(\s*)(\d+[.)])\s+(.*)$/)
      if (bullet) doc.text(`• ${pdfText(bullet[2])}`, { width: width - 14 - bullet[1].length * 4, indent: 14 + bullet[1].length * 4, lineGap: 2 })
      else if (numbered) doc.text(`${numbered[2]} ${pdfText(numbered[3])}`, { width: width - 14, indent: 14, lineGap: 2 })
      else if (/^\|.*\|$/.test(line.trim())) doc.font('Helvetica').fontSize(10).text(pdfText(line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()).join('   |   ')), { width, lineGap: 2 })
      else doc.text(pdfText(line.replace(/^>\s?/, '')), { width, lineGap: 3 })
    }
    doc.end()
  })
}
