import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Tokens of connected accounts are stored encrypted (SEC-03..05): AES-256-GCM with a key that lives only in the
// environment (INTEGRATIONS_ENCRYPTION_KEY, 32 bytes as base64 or hex). The database alone is not enough to use them.

const VERSION = 'v1'

/** The key from its text form; throws a message meant for the Settings page when it is missing or the wrong size. */
export function encryptionKey(text: string | undefined): Buffer {
  const value = text?.trim().replace(/^["']|["']$/g, '')
  if (!value) throw new Error('INTEGRATIONS_ENCRYPTION_KEY belum diisi di infra/env/integrations.env (jalankan node scripts/setup-env.mjs).')
  const key = /^[0-9a-fA-F]{64}$/.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64')
  if (key.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY harus 32 byte (base64 atau hex 64 karakter).')
  return key
}

export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decrypt(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(':')
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Format token tersimpan tidak dikenal.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  try {
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Token tersimpan tidak bisa dibuka: kunci enkripsi berubah. Hubungkan ulang akunnya.')
  }
}
