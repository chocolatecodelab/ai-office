import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localFileStore } from './file-store.js'
import { pdfText, renderPdf } from './pdf.js'

describe('markdown to PDF', () => {
  it('produces a real PDF from headings, lists, code and a table', async () => {
    const pdf = await renderPdf('# Rencana\n\nParagraf **penting**.\n\n- satu\n- dua\n\n1. langkah\n\n```\nkode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---\nPenutup', { title: 'Rencana', accent: '#CB9D31' })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(800)
    expect(pdf.subarray(-6).toString()).toContain('%%EOF')
  })

  it('renders an empty document and a long one over several pages without failing', async () => {
    expect((await renderPdf('', { title: 'Kosong' })).subarray(0, 5).toString()).toBe('%PDF-')
    const long = await renderPdf(Array.from({ length: 200 }, (_, index) => `Baris ke-${index} dengan teks yang cukup panjang untuk membungkus di halaman A4.`).join('\n\n'), { title: 'Panjang' })
    expect((long.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(2)
  })

  it('strips inline markers and replaces characters the standard fonts cannot draw', () => {
    expect(pdfText('**tebal** dan `kode` dan [tautan](https://x.id)')).toBe('tebal dan kode dan tautan (https://x.id)')
    expect(pdfText('Halo “dunia” — ok')).toBe('Halo “dunia” — ok')
    expect(pdfText('日本語 test')).toBe('??? test')
  })
})

describe('local file store', () => {
  it('keeps a brand\'s files under its own folder and reads them back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fs-'))
    try {
      const store = localFileStore(root)
      const key = await store.put('otca', 'pdf', Buffer.from('isi'))
      expect(key).toMatch(/^otca\/[0-9a-f-]{36}\.pdf$/)
      expect((await store.read(key)).toString()).toBe('isi')
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('refuses a key that leaves the root, and an invalid brand or extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fs-'))
    try {
      const store = localFileStore(root)
      await expect(store.read('../../etc/passwd')).rejects.toThrow(/tidak valid/)
      await expect(store.read('otca/../../x')).rejects.toThrow(/tidak valid/)
      await expect(store.put('../x', 'pdf', Buffer.from('a'))).rejects.toThrow(/tidak valid/)
      await expect(store.put('otca', 'p/df', Buffer.from('a'))).rejects.toThrow(/tidak valid/)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
