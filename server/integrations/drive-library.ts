import { randomUUID } from 'node:crypto'
import type { Fetcher } from './google.js'

const API = 'https://www.googleapis.com/drive/v3/files'
const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
interface DriveResponse {
  id:string;mimeType?:string;trashed?:boolean;capabilities?:{canAddChildren?:boolean};
  files?:Array<{id:string}>;nextPageToken?:string;ids?:string[];parents?:string[]
}

/** A server-only Drive client. Stable IDs make interrupted uploads safe to retry. */
export class DriveLibraryClient {
  constructor(private readonly token: string, private readonly fetcher: Fetcher = fetch) {}

  async request(url: string, init: RequestInit = {}): Promise<DriveResponse> {
    const response = await this.fetcher(url, {
      ...init, signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
    })
    const data = await response.json().catch(() => ({})) as DriveResponse
    if (!response.ok) throw new Error(response.status === 403
      ? 'Drive menolak akses. Hubungkan ulang dengan izin pengelolaan berkas dan pastikan folder dapat diedit.'
      : `Drive gagal (${response.status}). Coba sinkronkan ulang.`)
    return data
  }

  async folder(id: string) {
    const file = await this.request(`${API}/${encodeURIComponent(id)}?fields=id,mimeType,trashed,capabilities(canAddChildren)`)
    if (file.trashed || file.mimeType !== 'application/vnd.google-apps.folder' || !file.capabilities?.canAddChildren) {
      throw new Error('Pilih folder Drive yang aktif dan dapat diedit.')
    }
  }

  async childFolder(parent: string, name: string): Promise<string> {
    const query = new URLSearchParams({ q: `'${escapeQuery(parent)}' in parents and name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, fields: 'files(id),nextPageToken', pageSize: '100' })
    const found = await this.request(`${API}?${query}`)
    if ((found.files?.length ?? 0) > 1 || found.nextPageToken) throw new Error(`Folder ${name} ganda. Rapikan sebelum sinkronisasi.`)
    if (found.files?.[0]) return found.files[0].id
    const created = await this.request(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }) })
    return created.id
  }

  async generateId(): Promise<string> {
    const result = await this.request(`${API}/generateIds?count=1&space=drive&type=files`)
    if (!result.ids?.[0]) throw new Error('Drive tidak menyediakan ID berkas.')
    return result.ids[0]
  }

  async upload(id: string, parent: string, name: string, mime: string, data: Buffer): Promise<void> {
    // An existing stable ID was already written by a prior attempt.
    const existing = await this.fetcher(`${API}/${encodeURIComponent(id)}?fields=id,parents,trashed,size`, {
      headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(30_000),
    })
    if (existing.ok) {
      const file = await existing.json() as { parents?: string[]; trashed?: boolean; size?: string }
      if (file.trashed || !file.parents?.includes(parent) || Number(file.size) !== data.length) throw new Error('Berkas paket Drive berubah. Periksa sebelum mencoba ulang.')
      return
    }
    if (existing.status !== 404) throw new Error(`Pemeriksaan berkas Drive gagal (${existing.status}).`)
    const boundary = `office-${randomUUID()}`
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ id, name, parents: [parent] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      data, Buffer.from(`\r\n--${boundary}--`),
    ])
    await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    })
  }

  async move(id: string, from: string, to: string) {
    const file = await this.request(`${API}/${encodeURIComponent(id)}?fields=parents,trashed`)
    if (file.trashed) throw new Error('Folder paket berada di sampah Drive.')
    if (file.parents?.includes(to)) return
    if (!file.parents?.includes(from)) throw new Error('Lokasi folder paket telah berubah. Periksa Drive sebelum melanjutkan.')
    await this.request(`${API}/${encodeURIComponent(id)}?${new URLSearchParams({ addParents: to, removeParents: from })}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
  }
}
