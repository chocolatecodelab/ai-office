import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

// Where binary results (PDF today; images and video later) are kept. Assets of text live in Postgres; a file is
// written here and the asset row keeps only its key. The key starts with the brand id, so a brand's files sit apart
// and a key can never point outside the root. The local-disk store is for development; production swaps in object
// storage (R2) behind the same two methods.

export interface FileStore {
  put(brandId: string, extension: string, data: Buffer): Promise<string>
  read(key: string): Promise<Buffer>
}

export function localFileStore(root: string): FileStore {
  const base = resolve(root)
  const pathOf = (key: string) => {
    const full = resolve(base, key)
    if (!full.startsWith(base + sep)) throw new Error('Kunci berkas tidak valid.')
    return full
  }
  return {
    async put(brandId, extension, data) {
      if (!/^[a-z0-9-]{1,40}$/.test(brandId) || !/^[a-z0-9]{1,8}$/.test(extension)) throw new Error('Brand atau ekstensi berkas tidak valid.')
      const key = `${brandId}/${randomUUID()}.${extension}`
      await mkdir(join(base, brandId), { recursive: true })
      await writeFile(pathOf(key), data)
      return key
    },
    async read(key) {
      return readFile(pathOf(key))
    },
  }
}
