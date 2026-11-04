import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Marked } from 'marked'
import { findContextDir } from '../otca-context.js'

// The document behind a PDF: Markdown from an agent turned into a branded, print-ready HTML page. The page is
// rendered by Chromium (render-pdf.ts), which gives real typography, tables, repeated table headers, page numbers
// and non-Latin text. Everything an agent writes is treated as untrusted: raw HTML is shown as text, images and
// non-web links are dropped, and the page carries no script and loads nothing from the network.

export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

const markdown = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => `<em class="note">[gambar: ${escapeHtml(text)}]</em>`,
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens)
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeHtml(href)}">${text}</a>` : text
    },
  },
})

/** The Markdown as safe HTML, and its first level-1 heading (the document title) taken out of the body. */
export function markdownToHtml(source: string): { title?: string; body: string } {
  const lines = source.replace(/\r\n/g, '\n').trim().split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  const heading = first >= 0 ? lines[first].match(/^#\s+(.+?)\s*#*\s*$/) : null
  const rest = heading ? lines.slice(first + 1).join('\n') : lines.join('\n')
  return { title: heading?.[1], body: markdown.parse(rest, { async: false }) as string }
}

// ---- brand -----------------------------------------------------------------------------------------------

const FONTS: Record<string, number[]> = { Montserrat: [400, 600, 700, 800], Lato: [400, 700, 900] }
const fontCache = new Map<string, string>()

/** @font-face rules with the font files inlined, so the PDF never fetches a font. */
export function fontFaces(family: string): string {
  const cached = fontCache.get(family)
  if (cached !== undefined) return cached
  const weights = FONTS[family]
  let css = ''
  if (weights) {
    const dir = join(dirname(createRequire(import.meta.url).resolve(`@fontsource/${family.toLowerCase()}/package.json`)), 'files')
    for (const weight of weights) {
      const file = join(dir, `${family.toLowerCase()}-latin-${weight}-normal.woff2`)
      if (existsSync(file)) css += `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2')}\n`
    }
  }
  fontCache.set(family, css)
  return css
}

export interface BrandStyle { name: string; accent: string; family: string; logo?: string }

/** The brand's name and colour, the font its visual.json names for body text, and its logo as a data URI. */
export function brandStyle(brandId: string, name: string, accent: string): BrandStyle {
  let family = 'Montserrat'
  let logo: string | undefined
  const contextDir = findContextDir()
  if (contextDir && /^[a-z0-9-]+$/.test(brandId)) {
    try {
      const visual = JSON.parse(readFileSync(join(contextDir, 'brands', brandId, 'visual.json'), 'utf8')) as { fonts?: Record<string, { family?: string }> }
      const named = visual.fonts?.body?.family ?? visual.fonts?.display?.family ?? visual.fonts?.headline?.family ?? ''
      family = Object.keys(FONTS).find((known) => named.toLowerCase().startsWith(known.toLowerCase())) ?? family
    } catch { /* keep the default font */ }
    const file = join(dirname(contextDir), 'public', 'brands', brandId, 'logo.png')
    if (existsSync(file)) logo = `data:image/png;base64,${readFileSync(file).toString('base64')}`
  }
  return { name, accent: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#1f2937', family, logo }
}

/** Dark or white text, whichever reads better on this background. */
export function contrastText(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111827' : '#ffffff'
}

const longDate = (date: Date) => date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })

/** Header and footer Chromium draws on every page (a separate context: styles must be inline). */
export function pageTemplates(title: string, brand: BrandStyle): { header: string; footer: string } {
  const small = `font-family:Arial,sans-serif;font-size:7.5pt;color:#6b7280;width:100%;padding:0 18mm;box-sizing:border-box;`
  return {
    header: `<div style="${small}display:flex;justify-content:space-between;border-bottom:0.5pt solid #e5e7eb;padding-bottom:3mm"><span style="font-weight:bold;color:#374151">${escapeHtml(brand.name)}</span><span>Draf AI Office</span></div>`,
    footer: `<div style="${small}display:flex;justify-content:space-between"><span>${escapeHtml(title.slice(0, 70))}</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`,
  }
}

/** The full print page: title block with logo, then the body, in the brand's font and colour. */
export function documentHtml(options: { title: string; body: string; brand: BrandStyle; date?: Date }): string {
  const { brand } = options
  const onAccent = contrastText(brand.accent)
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${escapeHtml(options.title)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">
<style>
${fontFaces(brand.family)}
@page { size: A4; }
* { box-sizing: border-box; }
:root { color-scheme: light; }
html { background: #ffffff; }
body { background: #ffffff; color: #1f2937; font-family: '${brand.family}', 'Segoe UI', 'Yu Gothic', 'Microsoft YaHei', 'Noto Sans CJK JP', Arial, sans-serif; font-size: 10pt; line-height: 1.62; margin: 0; }
.masthead { align-items: center; border-bottom: 2.5pt solid ${brand.accent}; display: flex; gap: 14pt; justify-content: space-between; margin-bottom: 16pt; padding-bottom: 12pt; }
.masthead img { max-height: 15mm; max-width: 52mm; object-fit: contain; }
.masthead .brand { font-size: 9pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.masthead .meta { color: #6b7280; font-size: 8pt; text-align: right; }
h1.title { font-size: 22pt; font-weight: 800; line-height: 1.2; margin: 0 0 4pt; color: #111827; }
.subtitle { color: #6b7280; font-size: 9pt; margin: 0 0 18pt; }
h1, h2, h3, h4 { break-after: avoid; color: #111827; line-height: 1.3; }
h1 { font-size: 17pt; font-weight: 800; margin: 18pt 0 6pt; }
h2 { border-bottom: 1pt solid ${brand.accent}; font-size: 13.5pt; font-weight: 700; margin: 16pt 0 7pt; padding-bottom: 3pt; }
h3 { font-size: 11.5pt; font-weight: 700; margin: 12pt 0 4pt; }
h4 { font-size: 10pt; font-weight: 700; margin: 10pt 0 3pt; }
p { margin: 0 0 7pt; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
li { margin: 0 0 3pt; }
li > ul, li > ol { margin-top: 3pt; margin-bottom: 0; }
a { color: #1d4ed8; text-decoration: underline; }
strong { font-weight: 700; color: #111827; }
hr { border: 0; border-top: 0.75pt solid #d1d5db; margin: 14pt 0; }
blockquote { background: #f9fafb; border-left: 3pt solid ${brand.accent}; break-inside: avoid; color: #374151; margin: 8pt 0; padding: 6pt 12pt; }
blockquote p:last-child { margin-bottom: 0; }
code { background: #f3f4f6; border-radius: 2pt; font-family: Consolas, 'Courier New', monospace; font-size: 8.8pt; padding: 0.5pt 3pt; }
pre { background: #f3f4f6; border: 0.5pt solid #e5e7eb; border-radius: 3pt; break-inside: avoid; margin: 8pt 0; overflow-wrap: anywhere; padding: 8pt 10pt; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; font-size: 9pt; margin: 9pt 0 12pt; width: 100%; }
thead { display: table-header-group; }
th { background: ${brand.accent}; color: ${onAccent}; font-weight: 700; padding: 5pt 8pt; text-align: left; }
td { border-bottom: 0.5pt solid #e5e7eb; padding: 5pt 8pt; vertical-align: top; }
tr { break-inside: avoid; }
tbody tr:nth-child(even) td { background: #f9fafb; }
.note { color: #6b7280; }
</style></head><body>
<header class="masthead">
  ${brand.logo ? `<img src="${brand.logo}" alt="${escapeHtml(brand.name)}">` : `<span class="brand" style="color:${brand.accent === '#F3CF45' ? '#25272B' : brand.accent}">${escapeHtml(brand.name)}</span>`}
  <div class="meta">${escapeHtml(brand.name)}<br>${longDate(options.date ?? new Date())}</div>
</header>
<h1 class="title">${escapeHtml(options.title)}</h1>
<p class="subtitle">Draf AI Office · untuk ditinjau sebelum dipakai</p>
${options.body}
</body></html>`
}
