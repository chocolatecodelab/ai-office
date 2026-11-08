import { createHash, randomBytes } from 'node:crypto'

// Google OAuth 2.0 (authorization code + PKCE) and the one Drive call the office needs. Every function takes the
// fetch to use, so tests run against a stand-in for Google.

export type Fetcher = typeof fetch

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const DRIVE_URL = 'https://www.googleapis.com/drive/v3'

export const DRIVE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive']

export interface Pkce { verifier: string; challenge: string }
export function pkce(): Pkce {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}
export const randomState = () => randomBytes(24).toString('base64url')

export function authUrl(input: { clientId: string; redirectUri: string; state: string; challenge: string; scopes: string[] }): string {
  const query = new URLSearchParams({
    client_id: input.clientId, redirect_uri: input.redirectUri, response_type: 'code', scope: input.scopes.join(' '),
    state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256',
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
  })
  return `${AUTH_URL}?${query}`
}

export interface Tokens { accessToken: string; refreshToken?: string; expiresAt: Date; scope: string }

async function tokenRequest(fetcher: Fetcher, form: Record<string, string>): Promise<Tokens> {
  const response = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
  const data = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }
  if (!response.ok || !data.access_token) throw new GoogleError(data.error ?? `HTTP ${response.status}`)
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000), scope: data.scope ?? '' }
}

/** A Google error; `invalidGrant` means the user revoked access or the refresh token expired, so they must connect again. */
export class GoogleError extends Error {
  get invalidGrant() { return this.message === 'invalid_grant' }
}

export const exchangeCode = (fetcher: Fetcher, input: { clientId: string; clientSecret: string; redirectUri: string; code: string; verifier: string }) =>
  tokenRequest(fetcher, { grant_type: 'authorization_code', code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, code_verifier: input.verifier })

export const refreshAccess = (fetcher: Fetcher, input: { clientId: string; clientSecret: string; refreshToken: string }) =>
  tokenRequest(fetcher, { grant_type: 'refresh_token', refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret })

export async function accountEmail(fetcher: Fetcher, accessToken: string): Promise<string> {
  const response = await fetcher(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await response.json().catch(() => ({})) as { email?: string }
  if (!response.ok || !data.email) throw new GoogleError('Email akun Google tidak terbaca.')
  return data.email
}

/** Best effort: the connection is removed here whether or not Google answers. */
export async function revoke(fetcher: Fetcher, token: string): Promise<void> {
  try { await fetcher(REVOKE_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }) } catch { /* nothing more to do */ }
}

const escapeQuery = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
const MAX_TEMPLATE_CHARS = 60_000

/** The text of the first Drive file with exactly this name: a Google Doc is exported as text, a text file is read. */
export async function driveTemplate(fetcher: Fetcher, accessToken: string, name: string, folderId?: string): Promise<{ name: string; content: string; source: string } | undefined> {
  const auth = { Authorization: `Bearer ${accessToken}` }
  const parent = folderId ? ` and '${escapeQuery(folderId)}' in parents` : ''
  const list = new URLSearchParams({ q: `name = '${escapeQuery(name)}' and trashed = false${parent}`, fields: 'files(id,name,mimeType)', pageSize: '1', orderBy: 'modifiedTime desc' })
  const found = await fetcher(`${DRIVE_URL}/files?${list}`, { headers: auth })
  const listed = await found.json().catch(() => ({})) as { files?: Array<{ id: string; name: string; mimeType: string }>; error?: { message?: string } }
  if (!found.ok) throw new GoogleError(listed.error?.message ?? `Drive HTTP ${found.status}`)
  const file = listed.files?.[0]
  if (!file) return undefined
  const isDoc = file.mimeType === 'application/vnd.google-apps.document'
  if (!isDoc && !file.mimeType.startsWith('text/')) return undefined
  const content = await fetcher(isDoc ? `${DRIVE_URL}/files/${file.id}/export?mimeType=text%2Fplain` : `${DRIVE_URL}/files/${file.id}?alt=media`, { headers: auth })
  if (!content.ok) throw new GoogleError(`Drive HTTP ${content.status}`)
  return { name: file.name, content: (await content.text()).slice(0, MAX_TEMPLATE_CHARS), source: `Google Drive · ${file.name}` }
}

/** A harmless read that proves the token works: the first file name visible to the account. */
export async function driveCheck(fetcher: Fetcher, accessToken: string): Promise<number> {
  const response = await fetcher(`${DRIVE_URL}/files?${new URLSearchParams({ pageSize: '1', fields: 'files(id)' })}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = await response.json().catch(() => ({})) as { files?: unknown[]; error?: { message?: string } }
  if (!response.ok) throw new GoogleError(data.error?.message ?? `Drive HTTP ${response.status}`)
  return data.files?.length ?? 0
}
