import { AGENT_NAMES, type AssetItem } from './office-api.ts'

// Filtering and sorting of the Folders list. The list is small (a few hundred rows), so it is done in the page.

export type FileKind = 'pdf' | 'image' | 'doc' | 'data' | 'web' | 'subtitle' | 'reply'
export const KIND_LABELS: Record<FileKind, string> = { pdf: 'PDF', image:'Gambar', doc: 'Dokumen', data: 'Data', web: 'Web', subtitle: 'Subtitel', reply: 'Balasan' }
export const KINDS = Object.keys(KIND_LABELS) as FileKind[]

export type Period = 'all' | '1d' | '7d' | '30d'
export const PERIOD_LABELS: Record<Period, string> = { all: 'Semua waktu', '1d': '24 jam terakhir', '7d': '7 hari terakhir', '30d': '30 hari terakhir' }
const PERIOD_MS: Record<Period, number> = { all: Infinity, '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 }

export type SortKey = 'newest' | 'oldest' | 'name' | 'size'
export const SORT_LABELS: Record<SortKey, string> = { newest: 'Terbaru', oldest: 'Terlama', name: 'Nama A–Z', size: 'Ukuran terbesar' }

export interface Filters { brand: string; kind: FileKind | 'all'; agent: string; period: Period; query: string; sort: SortKey }
export const NO_FILTERS: Filters = { brand: 'all', kind: 'all', agent: 'all', period: 'all', query: '', sort: 'newest' }

/** What kind of result an asset is: a file by its extension, or the agent's reply itself. */
export function fileKind(asset: Pick<AssetItem, 'kind' | 'name'>): FileKind {
  if (asset.kind !== 'artifact') return 'reply'
  const extension = asset.name?.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'pdf') return 'pdf'
  if (extension === 'png') return 'image'
  if (extension === 'csv' || extension === 'json') return 'data'
  if (extension === 'html') return 'web'
  if (extension === 'srt' || extension === 'vtt') return 'subtitle'
  return 'doc'
}

export const isFiltered = (filters: Filters) => filters.brand !== 'all' || filters.kind !== 'all' || filters.agent !== 'all' || filters.period !== 'all' || filters.query.trim() !== ''

const label = (asset: AssetItem) => asset.name ?? asset.title

/** The assets that pass the filters, in the chosen order. Pass `ignore` to leave one filter out (for the counts). */
export function filterAssets(assets: AssetItem[], filters: Filters, now = Date.now(), ignore?: keyof Filters): AssetItem[] {
  const needle = filters.query.trim().toLowerCase()
  const active = (key: keyof Filters) => ignore !== key
  const passing = assets.filter((asset) =>
    (!active('brand') || filters.brand === 'all' || asset.brandId === filters.brand)
    && (!active('kind') || filters.kind === 'all' || fileKind(asset) === filters.kind)
    && (!active('agent') || filters.agent === 'all' || asset.agentType === filters.agent)
    && (!active('period') || filters.period === 'all' || now - Date.parse(asset.createdAt) <= PERIOD_MS[filters.period])
    && (!active('query') || !needle || `${label(asset)} ${asset.title} ${asset.kind} ${AGENT_NAMES[asset.agentType] ?? asset.agentType} ${asset.brandName}`.toLowerCase().includes(needle)))
  const order: Record<SortKey, (a: AssetItem, b: AssetItem) => number> = {
    newest: (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.version - a.version,
    oldest: (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.version - b.version,
    name: (a, b) => label(a).localeCompare(label(b), 'id'),
    size: (a, b) => b.size - a.size,
  }
  return [...passing].sort(order[filters.sort])
}

/** The few lines a card shows as its page thumbnail: Markdown marks and HTML tags removed, whitespace tidied. */
export function thumbText(asset: Pick<AssetItem, 'kind' | 'name' | 'excerpt'>): string {
  const web = fileKind(asset) === 'web'
  const text = (web ? asset.excerpt.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ') : asset.excerpt)
  const plain = fileKind(asset) === 'data' ? text : text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`|]/g, '')
    .replace(/^[-: ]{3,}$/gm, '')
  return plain.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 420)
}

/** An agent's file keeps its own name; a reply is saved as <title>-v<version>.md. */
export function fileName(asset: AssetItem): string {
  if (asset.name) return asset.name
  const slug = asset.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'hasil'
  return `${slug}-v${asset.version}.md`
}

export const assetLabel = (asset: AssetItem) => asset.name ?? asset.title
