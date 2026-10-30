// Remote MCP endpoint (Streamable HTTP at /mcp) for claude.ai custom connectors, protected by OAuth.
//
// It runs on its own port (RUANG_MCP_PORT, default 3002), separate from the office UI and /api,
// and that port only answers /mcp and the OAuth routes. Expose only this port through a tunnel:
// the office UI and its /api stay on 127.0.0.1.
//
// claude.ai registers itself (dynamic client registration) and sends the owner to /authorize,
// where the owner approves the connection with RUANG_MCP_SECRET. Only the owner holds that secret,
// so nobody else can obtain a token even though registration is open.
//
// Settings (environment or .env):
//   RUANG_MCP_SECRET      at least 16 characters; the endpoint stays off without it
//   RUANG_PUBLIC_URL      the public https address, for example https://office.example.com
//   RUANG_MCP_PORT        default 3002
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import express, { type Response } from 'express'
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { InvalidGrantError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { accessConfigDir } from './access.js'
import { claudeService } from './claude-service.js'
import { createOfficeMcpServer, type BoardTask, type OfficeBackend } from './mcp-tools.js'

const ACCESS_TOKEN_SECONDS = 60 * 60
const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60
const CODE_MS = 5 * 60 * 1000
const MIN_SECRET_LENGTH = 16

/** Reads a setting from the environment, then from .env in the working directory. */
function setting(name: string): string {
  if (process.env[name]?.trim()) return process.env[name]!.trim()
  try {
    const envPath = join(process.cwd(), '.env')
    if (!existsSync(envPath)) return ''
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const match = line.trim().match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/)
      if (match?.[1] === name) return match[2].trim().replace(/^["']|["']$/g, '').trim()
    }
  } catch {
    // unreadable .env: treated as unset
  }
  return ''
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
const token = () => randomBytes(32).toString('base64url')
const nowSeconds = () => Math.floor(Date.now() / 1000)

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(sha256(given))
  const b = Buffer.from(sha256(expected))
  return timingSafeEqual(a, b)
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

interface StoredToken { clientId: string; scopes: string[]; resource?: string; expiresAt: number }
interface PendingCode { clientId: string; codeChallenge: string; redirectUri: string; scopes: string[]; resource?: string; expiresAt: number }
interface OAuthStore { clients: Record<string, OAuthClientInformationFull>; accessTokens: Record<string, StoredToken>; refreshTokens: Record<string, StoredToken> }

/** Clients and tokens survive restarts, so claude.ai stays connected. Only token hashes are kept. */
class OfficeOAuthProvider implements OAuthServerProvider {
  private readonly file = join(accessConfigDir(), 'mcp-oauth.json')
  private store: OAuthStore = { clients: {}, accessTokens: {}, refreshTokens: {} }
  private readonly codes = new Map<string, PendingCode>()
  private failures = 0
  private blockedUntil = 0

  constructor(private readonly secret: string) {
    try {
      if (existsSync(this.file)) this.store = { ...this.store, ...JSON.parse(readFileSync(this.file, 'utf8')) }
    } catch {
      // damaged file: start over, claude.ai simply connects again
    }
  }

  private save() {
    const now = nowSeconds()
    for (const bucket of [this.store.accessTokens, this.store.refreshTokens]) {
      for (const [hash, entry] of Object.entries(bucket)) if (entry.expiresAt < now) delete bucket[hash]
    }
    mkdirSync(accessConfigDir(), { recursive: true })
    writeFileSync(this.file, JSON.stringify(this.store, null, 2), { mode: 0o600 })
    try { chmodSync(this.file, 0o600) } catch { /* not supported on every filesystem */ }
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.clients[clientId],
      registerClient: (client) => {
        const full: OAuthClientInformationFull = { ...client, client_id: randomUUID(), client_id_issued_at: nowSeconds() }
        this.store.clients[full.client_id] = full
        this.save()
        return full
      },
    }
  }

  /** Shows the owner an approval page; the form posts back to /authorize/approve. */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    res.type('html').send(approvalPage(client, params))
  }

  /** Called by the approval form. Returns the redirect target, or an error message for the page. */
  approve(form: Record<string, string>): { redirect: string } | { error: string } {
    if (Date.now() < this.blockedUntil) return { error: 'Terlalu banyak percobaan salah. Tunggu sebentar lalu coba lagi.' }
    const client = this.store.clients[form.client_id]
    if (!client) return { error: 'Aplikasi tidak dikenal. Mulai lagi koneksi dari claude.ai.' }
    // The form is outside the SDK's checks, so the redirect target is validated again here.
    if (!client.redirect_uris.map(String).includes(form.redirect_uri)) return { error: 'Alamat redirect tidak terdaftar untuk aplikasi ini.' }
    const target = new URL(form.redirect_uri)
    if (form.state) target.searchParams.set('state', form.state)
    if (form.decision !== 'allow') {
      target.searchParams.set('error', 'access_denied')
      return { redirect: target.href }
    }
    if (!sameSecret(form.secret ?? '', this.secret)) {
      this.failures += 1
      if (this.failures >= 5) this.blockedUntil = Date.now() + Math.min(300_000, 1000 * 2 ** (this.failures - 5))
      return { error: 'Kata sandi MCP salah.' }
    }
    this.failures = 0
    const code = token()
    this.codes.set(code, {
      clientId: client.client_id,
      codeChallenge: form.code_challenge,
      redirectUri: form.redirect_uri,
      scopes: form.scope ? form.scope.split(' ').filter(Boolean) : [],
      resource: form.resource || undefined,
      expiresAt: Date.now() + CODE_MS,
    })
    target.searchParams.set('code', code)
    return { redirect: target.href }
  }

  private pendingCode(client: OAuthClientInformationFull, code: string): PendingCode {
    const pending = this.codes.get(code)
    if (!pending || pending.clientId !== client.client_id || pending.expiresAt < Date.now()) throw new InvalidGrantError('Invalid or expired authorization code')
    return pending
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return this.pendingCode(client, code).codeChallenge
  }

  private issue(clientId: string, scopes: string[], resource?: string): OAuthTokens {
    const accessToken = token()
    const refreshToken = token()
    this.store.accessTokens[sha256(accessToken)] = { clientId, scopes, resource, expiresAt: nowSeconds() + ACCESS_TOKEN_SECONDS }
    this.store.refreshTokens[sha256(refreshToken)] = { clientId, scopes, resource, expiresAt: nowSeconds() + REFRESH_TOKEN_SECONDS }
    this.save()
    return { access_token: accessToken, token_type: 'bearer', expires_in: ACCESS_TOKEN_SECONDS, refresh_token: refreshToken, ...(scopes.length ? { scope: scopes.join(' ') } : {}) }
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string): Promise<OAuthTokens> {
    const pending = this.pendingCode(client, code)
    this.codes.delete(code)
    if (redirectUri && redirectUri !== pending.redirectUri) throw new InvalidGrantError('redirect_uri does not match')
    return this.issue(client.client_id, pending.scopes, pending.resource)
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string): Promise<OAuthTokens> {
    const hash = sha256(refreshToken)
    const stored = this.store.refreshTokens[hash]
    if (!stored || stored.clientId !== client.client_id || stored.expiresAt < nowSeconds()) throw new InvalidGrantError('Invalid or expired refresh token')
    // Refresh tokens are single use: each refresh hands out a new pair.
    delete this.store.refreshTokens[hash]
    return this.issue(client.client_id, stored.scopes, stored.resource)
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const stored = this.store.accessTokens[sha256(accessToken)]
    if (!stored || stored.expiresAt < nowSeconds()) throw new InvalidTokenError('Invalid or expired access token')
    return { token: accessToken, clientId: stored.clientId, scopes: stored.scopes, expiresAt: stored.expiresAt, ...(stored.resource ? { resource: new URL(stored.resource) } : {}) }
  }

  async revokeToken(client: OAuthClientInformationFull, request: { token: string }): Promise<void> {
    const hash = sha256(request.token)
    for (const bucket of [this.store.accessTokens, this.store.refreshTokens]) {
      if (bucket[hash]?.clientId === client.client_id) delete bucket[hash]
    }
    this.save()
  }
}

function approvalPage(client: OAuthClientInformationFull, params: AuthorizationParams, error = ''): string {
  const fields: Record<string, string> = {
    client_id: client.client_id,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    state: params.state ?? '',
    scope: (params.scopes ?? []).join(' '),
    resource: params.resource?.href ?? '',
  }
  const hidden = Object.entries(fields).map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join('')
  const name = escapeHtml(client.client_name || 'Aplikasi tanpa nama')
  const host = escapeHtml(new URL(params.redirectUri).host)
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Izinkan akses AI Office</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f1ea;color:#1f2430;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
main{background:#fff;border-radius:14px;padding:28px;max-width:420px;width:100%;box-shadow:0 8px 30px rgba(0,0,0,.08)}
h1{font-size:1.25rem;margin:0 0 8px}p{line-height:1.5;margin:8px 0}input[type=password]{width:100%;box-sizing:border-box;padding:10px;border:1px solid #c9c4b8;border-radius:8px;font-size:1rem;margin:6px 0 14px}
.row{display:flex;gap:10px}button{flex:1;padding:10px;border-radius:8px;border:0;font-size:1rem;cursor:pointer}.allow{background:#2f6b4f;color:#fff}.deny{background:#e7e2d7}
.err{background:#fdecea;color:#8a1c12;padding:8px 10px;border-radius:8px}.muted{color:#6b6f7a;font-size:.9rem}
@media (prefers-color-scheme:dark){body{background:#16181d;color:#e7e9ee}main{background:#22252c}input[type=password]{background:#16181d;color:#e7e9ee;border-color:#3a3e48}.deny{background:#3a3e48;color:#e7e9ee}.muted{color:#9aa0ab}}</style></head>
<body><main><h1>Izinkan akses ke AI Office?</h1>
<p><strong>${name}</strong> meminta izin untuk melihat dan mengontrol AI Office Anda: chat dengan agen, membuat dan menjalankan tugas, serta memanggil rapat.</p>
<p class="muted">Setelah diizinkan, Anda akan diarahkan ke <strong>${host}</strong>.</p>
${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize/approve">${hidden}
<label for="secret">Kata sandi MCP (RUANG_MCP_SECRET)</label>
<input id="secret" name="secret" type="password" autocomplete="current-password" autofocus>
<div class="row"><button class="deny" name="decision" value="deny">Tolak</button><button class="allow" name="decision" value="allow">Izinkan</button></div>
</form></main></body></html>`
}

/** The tools act on the office directly. The owner approved the connection, so the profile lock does not apply. */
const directBackend: OfficeBackend = {
  office: async () => claudeService.getOfficeSnapshot(),
  agents: async () => claudeService.getAgents(),
  registerProjectAgent: async (input) => claudeService.upsertProjectAgent(input),
  reportActivity: async (input) => claudeService.reportActivity(input),
  removeAgent: async (agentId) => claudeService.removeAgent(agentId),
  chat: (agent, message) => claudeService.sendMessage(agent, message),
  tasks: async () => (claudeService.getTaskBoardSnapshot().tasks.data ?? []) as BoardTask[],
  task: async (id) => {
    const detail = claudeService.getTaskDetail(id)
    if (!detail) throw new Error(`Tugas ${id} tidak ditemukan.`)
    return detail
  },
  createTask: async (task) => claudeService.addTask(task),
  updateTaskStatus: async (id, status) => claudeService.updateTaskStatus(id, status),
  runTask: (id) => claudeService.runTaskNow(id),
  meeting: async (active, agenda) => {
    claudeService.setMeeting(active, agenda ?? '')
    return { ok: true, active }
  },
  addNote: async (agent, note) => claudeService.addAgentNote(agent, note),
  jobs: async () => claudeService.getScheduledJobs(),
}

/** Starts the public MCP listener when RUANG_MCP_SECRET is set. */
export function startRemoteMcp(host: string): void {
  const secret = setting('RUANG_MCP_SECRET')
  if (!secret) return
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`Remote MCP is off: RUANG_MCP_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`)
    return
  }
  const port = Number(setting('RUANG_MCP_PORT')) || 3002
  const publicUrl = new URL(setting('RUANG_PUBLIC_URL') || `http://localhost:${port}`)
  const mcpUrl = new URL('/mcp', publicUrl)
  const provider = new OfficeOAuthProvider(secret)

  const app = express()
  app.disable('x-powered-by')
  // Requests arrive through the local tunnel; its X-Forwarded-For carries the real client address.
  app.set('trust proxy', 'loopback')
  app.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store')
    next()
  })

  app.post('/authorize/approve', express.urlencoded({ extended: false, limit: '16kb' }), (request, response) => {
    const form = Object.fromEntries(Object.entries(request.body ?? {}).map(([key, value]) => [key, String(value)]))
    const result = provider.approve(form)
    if ('redirect' in result) { response.redirect(302, result.redirect); return }
    const client = provider.clientsStore.getClient(form.client_id) as OAuthClientInformationFull | undefined
    if (!client || !client.redirect_uris.map(String).includes(form.redirect_uri)) { response.status(400).type('text').send(result.error); return }
    response.status(400).type('html').send(approvalPage(client, {
      redirectUri: form.redirect_uri,
      codeChallenge: form.code_challenge,
      state: form.state || undefined,
      scopes: form.scope ? form.scope.split(' ') : [],
      resource: form.resource ? new URL(form.resource) : undefined,
    }, result.error))
  })

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: publicUrl,
    resourceServerUrl: mcpUrl,
    resourceName: 'AI Office',
    // Client secrets never expire: the SDK default (30 days) would silently break the
    // claude.ai connector when it next refreshes its token. Revoking is done by deleting mcp-oauth.json.
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
  }))

  const auth = requireBearerAuth({ verifier: provider, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) })
  // Stateless: every request gets its own server and transport.
  app.post('/mcp', auth, express.json({ limit: '1mb' }), async (request, response) => {
    const server = createOfficeMcpServer(directBackend)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(request, response, request.body)
    } catch (error) {
      console.error('MCP request failed:', error)
      if (!response.headersSent) response.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
    }
  })
  const notAllowed = (_request: unknown, response: Response) => {
    response.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null })
  }
  app.get('/mcp', auth, notAllowed)
  app.delete('/mcp', auth, notAllowed)
  app.use((_request, response) => { response.status(404).json({ error: 'Not found' }) })

  app.listen(port, host, () => console.log(`Remote MCP listening on http://${host}:${port}/mcp (public address ${mcpUrl.href})`))
}
