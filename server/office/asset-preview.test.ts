import { describe, expect, it } from 'vitest'
import { buildPreview } from './asset-preview.js'

const brand = { id: 'otca', name: 'Official OTCA', color: '#CB9D31' }
const asset = (patch: Partial<Parameters<typeof buildPreview>[0]>) => ({ name: null, kind: 'konten.chat', title: 'Judul tugas', content: '# Isi\n\nparagraf', ...patch })

describe('asset preview', () => {
  it('lays a reply, a Markdown file and a PDF source out as a branded document', () => {
    for (const patch of [{}, { kind: 'artifact', name: 'catatan.md' }, { kind: 'artifact', name: 'laporan.pdf' }]) {
      const preview = buildPreview(asset(patch), brand, new Date('2026-11-04T05:00:00Z'))
      expect(preview.type).toBe('document')
      expect(preview.type === 'document' && preview.html).toContain('<h1 class="title">Isi</h1>')
    }
  })

  it('titles a document from its first heading, then its file name, then the task', () => {
    const html = (patch: Partial<Parameters<typeof buildPreview>[0]>) => (buildPreview(asset(patch), brand) as { html: string }).html
    expect(html({ content: 'tanpa judul', kind: 'artifact', name: 'rencana-konten.md' })).toContain('<h1 class="title">rencana konten</h1>')
    expect(html({ content: 'tanpa judul' })).toContain('<h1 class="title">Judul tugas</h1>')
  })

  it('shows an HTML file in a page with no network and no script policy of its own to loosen', () => {
    const preview = buildPreview(asset({ kind: 'artifact', name: 'halaman.html', content: '<h1>Hai</h1><script>alert(1)</script>' }), brand)
    expect(preview.type).toBe('html')
    expect(preview.type === 'html' && preview.html).toContain("default-src 'none'")
    expect(preview.type === 'html' && preview.html.indexOf("default-src 'none'")).toBeLessThan((preview as { html: string }).html.indexOf('<script>'))
  })

  it('shows data files as plain text, untouched', () => {
    expect(buildPreview(asset({ kind: 'artifact', name: 'data.csv', content: 'a,b\n1,2' }), brand)).toEqual({ type: 'text', text: 'a,b\n1,2' })
    expect(buildPreview(asset({ kind: 'artifact', name: 'x.json', content: '{"a":1}' }), brand)).toEqual({ type: 'text', text: '{"a":1}' })
  })

  it('shows raw HTML inside Markdown as text, never as markup', () => {
    const preview = buildPreview(asset({ content: '# T\n\n<script>alert(1)</script>' }), brand)
    expect(preview.type === 'document' && preview.html).not.toContain('<script>alert')
  })
})
