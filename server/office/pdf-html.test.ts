import { describe, expect, it } from 'vitest'
import { brandStyle, contrastText, documentHtml, escapeHtml, fontFaces, markdownToHtml, pageTemplates } from './pdf-html.js'

describe('document HTML', () => {
  it('takes the first heading as the title and renders tables, lists and quotes', () => {
    const { title, body } = markdownToHtml('# Rencana Konten\n\n## Ide\n\n- satu\n- dua\n\n> catatan\n\n| a | b |\n|---|---|\n| 1 | 2 |')
    expect(title).toBe('Rencana Konten')
    expect(body).not.toContain('Rencana Konten')
    expect(body).toContain('<h2>Ide</h2>')
    expect(body).toContain('<li>satu</li>')
    expect(body).toContain('<blockquote>')
    expect(body).toMatch(/<table>[\s\S]*<th>a<\/th>[\s\S]*<td>1<\/td>/)
  })

  it('has no title when the text does not start with a heading', () => {
    expect(markdownToHtml('Paragraf dulu.\n\n# Nanti').title).toBeUndefined()
    expect(markdownToHtml('\n\n# Setelah baris kosong\nisi').title).toBe('Setelah baris kosong')
  })

  it('shows raw HTML as text and never lets a script, event handler or remote image through', () => {
    const { body } = markdownToHtml('<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\nTeks ![logo](http://evil.example/a.png) dan [aman](https://ok.example/x) dan [jahat](javascript:alert(3))')
    expect(body).not.toContain('<script')
    expect(body).not.toMatch(/<img/i)
    expect(body).toContain('&lt;script&gt;')
    expect(body).toContain('[gambar: logo]')
    expect(body).toContain('<a href="https://ok.example/x">aman</a>')
    expect(body).not.toContain('javascript:')
    expect(body).toContain('jahat')
  })

  it('escapes text placed in the page', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
  })

  it('builds a branded page that loads nothing from the network', () => {
    const brand = { name: 'Official <OTCA>', accent: '#CB9D31', family: 'Montserrat' }
    const html = documentHtml({ title: 'Judul <b>', body: '<p>isi</p>', brand, date: new Date('2026-11-04T05:00:00Z') })
    expect(html).toContain('Official &lt;OTCA&gt;')
    expect(html).toContain('<h1 class="title">Judul &lt;b&gt;</h1>')
    expect(html).toContain('4 November 2026')
    expect(html).toContain('#CB9D31')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('@font-face')
    expect(html).toContain("font-family:'Montserrat'")
    expect(html).not.toMatch(/https?:\/\/fonts\./)
    expect(html).not.toContain('<script')
  })

  it('reads a brand\'s font and logo from its visual data, with a safe default for unknown brands', () => {
    expect(brandStyle('infojerman', 'Info Jerman', '#F3CF45')).toMatchObject({ family: 'Lato', accent: '#F3CF45' })
    expect(brandStyle('otca', 'Official OTCA', '#CB9D31').logo).toMatch(/^data:image\/png;base64,/)
    expect(brandStyle('tidak-ada', 'X', 'bukan warna')).toMatchObject({ family: 'Montserrat', accent: '#1f2937' })
    expect(brandStyle('../x', 'X', '#000000').logo).toBeUndefined()
  })

  it('inlines the fonts it names and chooses readable text on a brand colour', () => {
    expect(fontFaces('Lato')).toContain('font-weight:900')
    expect(fontFaces('Comic Sans')).toBe('')
    expect(contrastText('#F3CF45')).toBe('#111827')
    expect(contrastText('#000000')).toBe('#ffffff')
    expect(contrastText('#D40000')).toBe('#ffffff')
  })

  it('draws the brand name and the page count in the page header and footer', () => {
    const { header, footer } = pageTemplates('Rencana Konten', { name: 'Official OTCA', accent: '#CB9D31', family: 'Montserrat' })
    expect(header).toContain('Official OTCA')
    expect(footer).toContain('class="pageNumber"')
    expect(footer).toContain('class="totalPages"')
  })
})
