import { describe, expect, it } from 'vitest'
import { extractArtifacts, MAX_ARTIFACTS, safeArtifactName } from './artifacts.js'

describe('chat artifacts', () => {
  it('lifts a file block out of the reply and leaves a marker in its place', () => {
    const reply = 'Ini naskahnya.\n\n~~~file:naskah-reels.md\n# Judul\n\n```js\nkode\n```\nIsi\n~~~\n\nSilakan dicek.'
    const { text, artifacts } = extractArtifacts(reply)
    expect(artifacts).toEqual([{ name: 'naskah-reels.md', content: '# Judul\n\n```js\nkode\n```\nIsi' }])
    expect(text).toBe('Ini naskahnya.\n\n[Berkas: naskah-reels.md]\n\nSilakan dicek.')
  })

  it('reads several files and keeps duplicate names apart', () => {
    const { artifacts } = extractArtifacts('~~~file:a.csv\n1,2\n~~~\n~~~file:a.csv\n3,4\n~~~\n~~~file:b.json\n{}\n~~~')
    expect(artifacts.map((item) => item.name)).toEqual(['a.csv', 'a-2.csv', 'b.json'])
    expect(extractArtifacts('~~~file:a-catatan.csv\n1\n~~~\n~~~file:a.csv\n2\n~~~').artifacts.map((item) => item.name)).toEqual(['a-catatan.csv', 'a.csv'])
  })

  it('keeps only plain names with a text extension', () => {
    expect(safeArtifactName('../../etc/passwd.md')).toBe('passwd.md')
    expect(safeArtifactName('C:\\Windows\\hosts.txt')).toBe('hosts.txt')
    expect(safeArtifactName('.hidden.md')).toBe('hidden.md')
    expect(safeArtifactName('rencana konten.md')).toBe('rencana-konten.md')
    expect(safeArtifactName('laporan.pdf')).toBe('laporan.pdf')
    expect(safeArtifactName('virus.exe')).toBeUndefined()
    expect(safeArtifactName('tanpa-ekstensi')).toBeUndefined()
    expect(safeArtifactName('   ')).toBeUndefined()
  })

  it('leaves a block with an unsafe name, an unclosed block, and anything past the limit as plain text', () => {
    const unsafe = extractArtifacts('~~~file:run.exe\nx\n~~~')
    expect(unsafe.artifacts).toEqual([])
    expect(unsafe.text).toContain('~~~file:run.exe')
    expect(extractArtifacts('~~~file:a.md\nbelum ditutup').artifacts).toEqual([])
    const many = Array.from({ length: MAX_ARTIFACTS + 2 }, (_, index) => `~~~file:f${index}.md\nx\n~~~`).join('\n')
    expect(extractArtifacts(many).artifacts).toHaveLength(MAX_ARTIFACTS)
  })

  it('rejects a file over the size limit', () => {
    expect(extractArtifacts(`~~~file:besar.md\n${'x'.repeat(200_001)}\n~~~`).artifacts).toEqual([])
  })

  it('returns a reply without blocks unchanged', () => {
    expect(extractArtifacts('Jawaban biasa.')).toEqual({ text: 'Jawaban biasa.', artifacts: [] })
  })
})
