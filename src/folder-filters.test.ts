import { describe, expect, it } from 'vitest'
import { NO_FILTERS, fileKind, filterAssets, isFiltered, thumbText } from './folder-filters.ts'
import type { AssetItem } from './office-api.ts'

const now = Date.parse('2026-11-04T12:00:00Z')
const asset = (patch: Partial<AssetItem>): AssetItem => ({
  id: 'a', taskId: 't', brandId: 'otca', brandName: 'Official OTCA', kind: 'artifact', version: 2, name: 'x.md', mime: null, downloadable: false, size: 100, excerpt: '',
  title: 'Chat', agentType: 'manager', createdAt: '2026-11-04T11:00:00Z', ...patch,
})
const ASSETS = [
  asset({ id: '1', name: 'ringkasan.pdf', downloadable: true, size: 2000, createdAt: '2026-11-04T10:00:00Z' }),
  asset({ id: '2', name: 'ide.md', size: 500, createdAt: '2026-11-02T10:00:00Z', agentType: 'content-creator' }),
  asset({ id: '3', name: 'data.csv', size: 900, createdAt: '2026-10-01T10:00:00Z', brandId: 'infojerman', brandName: 'Info Jerman' }),
  asset({ id: '4', name: null, kind: 'konten.chat', size: 300, title: 'Halo apa kabar', createdAt: '2026-11-04T09:00:00Z' }),
  asset({ id: '5', name: 'halaman.html', size: 4000, createdAt: '2026-11-03T10:00:00Z' }),
]
const ids = (filters: Partial<typeof NO_FILTERS>, ignore?: keyof typeof NO_FILTERS) => filterAssets(ASSETS, { ...NO_FILTERS, ...filters }, now, ignore).map((item) => item.id)

describe('folder filters', () => {
  it('tells a file\'s type from its extension and a reply from a file', () => {
    expect(ASSETS.map(fileKind)).toEqual(['pdf', 'doc', 'data', 'reply', 'web'])
    expect(fileKind({ kind: 'artifact', name: 'a.srt' })).toBe('subtitle')
    expect(fileKind({ kind: 'artifact', name: 'a.JSON' })).toBe('data')
    expect(fileKind({ kind: 'artifact', name: null })).toBe('doc')
  })

  it('keeps everything, newest first, when no filter is set', () => {
    expect(ids({})).toEqual(['1', '4', '5', '2', '3'])
    expect(isFiltered(NO_FILTERS)).toBe(false)
  })

  it('filters by brand, type, agent and period', () => {
    expect(ids({ brand: 'infojerman' })).toEqual(['3'])
    expect(ids({ kind: 'pdf' })).toEqual(['1'])
    expect(ids({ kind: 'reply' })).toEqual(['4'])
    expect(ids({ agent: 'content-creator' })).toEqual(['2'])
    expect(ids({ period: '1d' })).toEqual(['1', '4'])
    expect(ids({ period: '7d' })).toEqual(['1', '4', '5', '2'])
    expect(ids({ period: '30d' })).toEqual(['1', '4', '5', '2'])
  })

  it('searches names, titles and brand names, ignoring case', () => {
    expect(ids({ query: 'RINGKASAN' })).toEqual(['1'])
    expect(ids({ query: 'halo' })).toEqual(['4'])
    expect(ids({ query: 'info jerman' })).toEqual(['3'])
    expect(ids({ query: 'tidak ada' })).toEqual([])
  })

  it('combines filters', () => {
    expect(ids({ brand: 'otca', kind: 'doc', period: '7d' })).toEqual(['2'])
    expect(isFiltered({ ...NO_FILTERS, kind: 'pdf' })).toBe(true)
    expect(isFiltered({ ...NO_FILTERS, query: '  ' })).toBe(false)
  })

  it('sorts by age, name or size', () => {
    expect(ids({ sort: 'oldest' })).toEqual(['3', '2', '5', '4', '1'])
    expect(ids({ sort: 'name' })).toEqual(['3', '5', '4', '2', '1'])
    expect(ids({ sort: 'size' })).toEqual(['5', '1', '3', '2', '4']) // 4000, 2000, 900, 500, 300 bytes
  })

  it('leaves one filter out so its own counts do not depend on it', () => {
    expect(ids({ kind: 'pdf', brand: 'otca' }, 'kind')).toEqual(['1', '4', '5', '2'])
  })
})

describe('thumbText', () => {
  const card = (patch: Partial<Parameters<typeof thumbText>[0]>) => ({ kind: 'artifact', name: 'a.md', excerpt: '', ...patch })
  it('drops Markdown marks and keeps the words', () => {
    expect(thumbText(card({ excerpt: '# Rencana\n\n- **Satu** [tautan](http://x.y)\n- dua\n\n| a | b |\n|---|---|' }))).toBe('Rencana\n• Satu tautan\n• dua\na b')
  })
  it('strips tags and styles from a web file', () => {
    expect(thumbText(card({ name: 'p.html', excerpt: '<style>p{}</style><h1>Hai</h1><p>dunia</p>' }))).toBe('Hai dunia')
  })
  it('leaves data files as they are', () => {
    expect(thumbText(card({ name: 'd.csv', excerpt: 'a,b\n1,2' }))).toBe('a,b\n1,2')
  })
})
