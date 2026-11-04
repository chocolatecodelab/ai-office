import { describe, expect, it } from 'vitest'
import { decrypt, encrypt, encryptionKey } from './crypto.js'
import { authUrl, driveTemplate, pkce } from './google.js'
import { createHash } from 'node:crypto'

const key = Buffer.alloc(32, 3)

describe('token encryption', () => {
  it('round-trips and never shows the plain text', () => {
    const sealed = encrypt('ya29.rahasia', key)
    expect(sealed).not.toContain('rahasia')
    expect(decrypt(sealed, key)).toBe('ya29.rahasia')
    expect(encrypt('ya29.rahasia', key)).not.toBe(sealed) // a fresh IV every time
  })
  it('refuses a wrong key and a tampered value', () => {
    const sealed = encrypt('x', key)
    expect(() => decrypt(sealed, Buffer.alloc(32, 4))).toThrow(/kunci enkripsi berubah/)
    expect(() => decrypt(`${sealed.slice(0, -4)}AAAA`, key)).toThrow()
    expect(() => decrypt('bukan-token', key)).toThrow(/Format/)
  })
  it('accepts a 32-byte key as base64 or hex and rejects anything else', () => {
    expect(encryptionKey(key.toString('base64')).equals(key)).toBe(true)
    expect(encryptionKey(key.toString('hex')).equals(key)).toBe(true)
    expect(() => encryptionKey('')).toThrow(/belum diisi/)
    expect(() => encryptionKey('pendek')).toThrow(/32 byte/)
  })
})

describe('Google helpers', () => {
  it('makes a PKCE challenge that is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkce()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(verifier.length).toBeGreaterThanOrEqual(43)
  })
  it('builds a consent URL for offline, read-only access', () => {
    const url = new URL(authUrl({ clientId: 'c', redirectUri: 'http://x/cb', state: 's', challenge: 'h', scopes: ['openid', 'a b'] }))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'c', redirect_uri: 'http://x/cb', response_type: 'code', state: 's', code_challenge: 'h', access_type: 'offline', scope: 'openid a b' })
  })
  it('escapes quotes in the file name it searches for and skips files it cannot read as text', async () => {
    const seen: string[] = []
    const fetcher: typeof fetch = async (input) => { seen.push(String(input)); return Response.json({ files: [{ id: '1', name: "O'Brien", mimeType: 'application/pdf' }] }) }
    expect(await driveTemplate(fetcher, 't', "O'Brien")).toBeUndefined()
    expect(new URL(seen[0]).searchParams.get('q')).toContain("name = 'O\\'Brien'")
    expect(seen).toHaveLength(1) // nothing was downloaded
  })
})
