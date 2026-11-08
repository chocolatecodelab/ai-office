import { createHash } from 'node:crypto'
import type { OfficeStore } from '../office/store.js'
import { SERVICES, credentialValue, type ServiceDef } from './catalog.js'
import { decrypt, encrypt, encryptionKey } from './crypto.js'
import { accountEmail, authUrl, driveCheck, exchangeCode, GoogleError, pkce, randomState, refreshAccess, revoke, type Fetcher } from './google.js'

// One-click connections (OAuth) for the services whose catalog entry has `oauth`. The office owner registers the OAuth
// client once (its id and secret are in infra/env); after that a person clicks Connect, approves at the provider, and the
// callback stores the tokens encrypted in the api. Hermes and the browser never see a token.

const STATE_TTL_MS = 10 * 60_000
const REFRESH_MARGIN_MS = 60_000

/** Why a connection could not be made, as a short code the Settings page turns into a sentence. */
export class OAuthFailure extends Error {
  constructor(readonly code: 'denied' | 'state' | 'exchange' | 'config', message: string) { super(message) }
}

export interface ConnectionsDeps { store: OfficeStore; env?: NodeJS.ProcessEnv; envDir?: string; fetcher?: Fetcher }

const hash = (state: string) => createHash('sha256').update(state).digest('hex')

export class Connections {
  private readonly fetcher: Fetcher
  constructor(private readonly deps: ConnectionsDeps) { this.fetcher = deps.fetcher ?? fetch }

  private def(service: string): ServiceDef & { oauth: NonNullable<ServiceDef['oauth']> } {
    const def = SERVICES.find((item) => item.service === service)
    if (!def?.oauth) throw new Error('Layanan ini tidak memakai koneksi satu klik.')
    return def as ServiceDef & { oauth: NonNullable<ServiceDef['oauth']> }
  }
  private value(def: ServiceDef, name: string) { return credentialValue(def, name, this.deps.env ?? process.env, this.deps.envDir) }
  private client(def: ServiceDef) {
    const clientId = this.value(def, 'GOOGLE_OAUTH_CLIENT_ID')
    const clientSecret = this.value(def, 'GOOGLE_OAUTH_CLIENT_SECRET')
    if (!clientId || !clientSecret) throw new OAuthFailure('config', 'OAuth client Google belum diisi di infra/env/integrations.env.')
    return { clientId, clientSecret }
  }
  private key(def: ServiceDef) {
    try { return encryptionKey(this.value(def, 'INTEGRATIONS_ENCRYPTION_KEY')) } catch (cause) { throw new OAuthFailure('config', cause instanceof Error ? cause.message : String(cause)) }
  }

  /** Starts a connection for one brand; returns the provider's consent page to open. */
  async begin(brandId: string, service: string, redirectUri: string, actor: string): Promise<string> {
    const def = this.def(service)
    const { clientId } = this.client(def)
    this.key(def) // fail now, not after the person has approved
    const state = randomState()
    const { verifier, challenge } = pkce()
    await this.deps.store.createOAuthState({ stateHash: hash(state), brandId, service, verifier, redirectUri, createdBy: actor, ttlMs: STATE_TTL_MS })
    return authUrl({ clientId, redirectUri, state, challenge, scopes: def.oauth.scopes })
  }

  /** Finishes a connection from the provider's callback. The state is used once and expires. */
  async complete(input: { code?: string; state?: string; error?: string }): Promise<{ brandId: string; service: string }> {
    if (!input.state) throw new OAuthFailure('state', 'Permintaan tanpa state.')
    const started = await this.deps.store.consumeOAuthState(hash(input.state))
    if (!started) throw new OAuthFailure('state', 'Permintaan koneksi tidak dikenal atau sudah kedaluwarsa.')
    if (input.error) throw new OAuthFailure(input.error === 'access_denied' ? 'denied' : 'exchange', `Google menjawab: ${input.error}`)
    if (!input.code) throw new OAuthFailure('exchange', 'Google tidak mengirim kode.')
    const def = this.def(started.service)
    const { clientId, clientSecret } = this.client(def)
    const key = this.key(def)
    try {
      const tokens = await exchangeCode(this.fetcher, { clientId, clientSecret, redirectUri: started.redirectUri, code: input.code, verifier: started.verifier })
      const account = await accountEmail(this.fetcher, tokens.accessToken)
      await this.deps.store.saveConnection({
        brandId: started.brandId, service: started.service, account, accessToken: encrypt(tokens.accessToken, key),
        refreshToken: tokens.refreshToken ? encrypt(tokens.refreshToken, key) : undefined, expiresAt: tokens.expiresAt, scopes: tokens.scope,
      }, started.createdBy)
    } catch (cause) {
      throw new OAuthFailure('exchange', cause instanceof Error ? cause.message : String(cause))
    }
    return { brandId: started.brandId, service: started.service }
  }

  /** A working access token for the brand's connection, refreshed when it is about to expire. */
  async accessToken(brandId: string, service: string): Promise<string> {
    const def = this.def(service)
    const key = this.key(def)
    const secret = await this.deps.store.connectionSecret(brandId, service)
    if (!secret) throw new Error('Akun belum terhubung.')
    if (secret.status === 'needs_reauth') throw new Error('Koneksi perlu dihubungkan ulang.')
    if (secret.expiresAt && secret.expiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return decrypt(secret.accessToken, key)
    if (!secret.refreshToken) { await this.deps.store.markNeedsReauth(brandId, service); throw new Error('Koneksi perlu dihubungkan ulang.') }
    const { clientId, clientSecret } = this.client(def)
    try {
      const fresh = await refreshAccess(this.fetcher, { clientId, clientSecret, refreshToken: decrypt(secret.refreshToken, key) })
      await this.deps.store.updateAccessToken(brandId, service, encrypt(fresh.accessToken, key), fresh.expiresAt)
      return fresh.accessToken
    } catch (cause) {
      if (cause instanceof GoogleError && cause.invalidGrant) { await this.deps.store.markNeedsReauth(brandId, service); throw new Error('Akses dicabut atau kedaluwarsa; hubungkan ulang akunnya.') }
      throw cause
    }
  }

  /** Removes the connection and asks the provider to revoke the token. */
  async disconnect(brandId: string, service: string, actor: string): Promise<boolean> {
    const def = this.def(service)
    const removed = await this.deps.store.deleteConnection(brandId, service, actor)
    if (!removed) return false
    try {
      const key = encryptionKey(this.value(def, 'INTEGRATIONS_ENCRYPTION_KEY'))
      await revoke(this.fetcher, decrypt(removed.refreshToken ?? removed.accessToken, key))
    } catch { /* the stored tokens were removed; revoking is best effort */ }
    return true
  }

  /** Reads one thing from the account to prove the connection works. */
  async check(brandId: string, service: string): Promise<{ account: string; visibleFiles: number }> {
    this.def(service)
    const secret = await this.deps.store.connectionSecret(brandId, service)
    if (!secret) throw new Error('Akun belum terhubung.')
    return { account: secret.account, visibleFiles: await driveCheck(this.fetcher, await this.accessToken(brandId, service)) }
  }
}
