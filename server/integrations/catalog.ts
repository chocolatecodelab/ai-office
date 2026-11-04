import { join } from 'node:path'
import { readEnvFile } from '../settings.js'
import { DRIVE_SCOPES } from './google.js'
import { INTEGRATION_MODES, type IntegrationMode } from './index.js'

// The outside services the office can talk to (FR-40..48) and what each one needs before it can leave mock mode.
// Credentials stay in the environment or in infra/env/*.env, never in the database, the browser or Hermes (SEC-03..05);
// this module only checks that the variables are filled in. The values are never read into a response.

export interface ServiceDef {
  service: string
  label: string
  purpose: string
  /** The roadmap level that builds the live adapter. */
  level: string
  auth: 'api-key' | 'oauth'
  /** Variables that must all be filled for the service to count as connected. */
  vars: string[]
  /** The infra/env file the variables belong in. */
  file: string
  /** One line on where the credentials come from. */
  howTo: string
  /** Whether the adapter is written; until then credentials only get the service ready for it. */
  adapterReady: boolean
  /** Modes that make sense for the service; sandbox is left out where the provider has no test account. */
  modes?: IntegrationMode[]
  /** Set when people connect their account with one click (OAuth) instead of the office filling a key. */
  oauth?: { provider: 'google'; scopes: string[] }
}

export const SERVICES: ServiceDef[] = [
    { service: 'drive', label: 'Google Drive', purpose: 'Membaca template resmi dan library konten (baca saja).', level: 'L0', auth: 'oauth', vars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'], file: 'integrations.env', howTo: 'Google Cloud: buat OAuth client (Web), aktifkan Drive API, lalu daftarkan alamat callback Ruang yang tertera di bawah.', adapterReady: true, modes: ['mock', 'live'], oauth: { provider: 'google', scopes: DRIVE_SCOPES } },
  { service: 'google-calendar', label: 'Google Calendar', purpose: 'Menampilkan dan menulis jadwal event OTCA.', level: 'L1', auth: 'oauth', vars: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'], file: 'integrations.env', howTo: 'Google Cloud: buat OAuth client (Web), aktifkan Calendar API, tambahkan alamat callback Ruang.', adapterReady: false },
  { service: 'gpt-image', label: 'GPT Image', purpose: 'Draft visual lewat pool gambar LiteLLM.', level: 'L2', auth: 'api-key', vars: ['OPENAI_API_KEY'], file: 'litellm.env', howTo: 'platform.openai.com: buat API key (bukan langganan Plus) untuk pool gambar.', adapterReady: false },
  { service: 'meta-graph', label: 'Meta Graph (IG/FB)', purpose: 'Posting dan balas komentar setelah approval, membaca komentar.', level: 'L5', auth: 'oauth', vars: ['META_APP_ID', 'META_APP_SECRET'], file: 'integrations.env', howTo: 'developers.facebook.com: buat app, tambahkan izin halaman dan Instagram, daftarkan callback.', adapterReady: false },
  { service: 'meta-ads', label: 'Meta Marketing API', purpose: 'Campaign berstatus PAUSED dan insight; tanpa aktivasi dan ubah budget.', level: 'L3', auth: 'api-key', vars: ['META_ADS_ACCESS_TOKEN', 'META_AD_ACCOUNT_ID'], file: 'integrations.env', howTo: 'Business Manager: akun iklan sandbox dan system user token dengan izin ads_read dan ads_management.', adapterReady: false },
  { service: 'tiktok', label: 'TikTok', purpose: 'Posting setelah approval sesuai izin API.', level: 'L5', auth: 'oauth', vars: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'], file: 'integrations.env', howTo: 'developers.tiktok.com: daftarkan app dan ajukan izin Content Posting.', adapterReady: false },
  { service: 'youtube', label: 'YouTube', purpose: 'Posting video setelah approval.', level: 'L5', auth: 'oauth', vars: ['YOUTUBE_OAUTH_CLIENT_ID', 'YOUTUBE_OAUTH_CLIENT_SECRET'], file: 'integrations.env', howTo: 'Google Cloud: OAuth client dengan YouTube Data API.', adapterReady: false },
  { service: 'whatsapp', label: 'WhatsApp Business', purpose: 'Handover lead ke sales, bukan broadcast.', level: 'L6', auth: 'api-key', vars: ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID'], file: 'integrations.env', howTo: 'Meta Business: nomor WhatsApp Business dan token permanen.', adapterReady: false },
  { service: 'scalev', label: 'Scalev', purpose: 'Landing page event dan pembayaran sesuai API yang tersedia.', level: 'L6', auth: 'api-key', vars: ['SCALEV_API_KEY'], file: 'integrations.env', howTo: 'Dashboard Scalev: buat API key bila paketnya menyediakan API.', adapterReady: false },
  { service: 'trello', label: 'Trello', purpose: 'Papan tugas eksternal; papan Ruang tetap sumber tugas.', level: 'L4', auth: 'api-key', vars: ['TRELLO_API_KEY', 'TRELLO_TOKEN'], file: 'integrations.env', howTo: 'trello.com/power-ups/admin: buat Power-Up untuk API key, lalu buat token.', adapterReady: false },
]

/** The variables of a service that are empty. Environment first, then the infra/env files; read on every call, so editing a file needs no restart. */
function lookup(def: ServiceDef, env: NodeJS.ProcessEnv, envDir?: string): (name: string) => string | undefined {
  const files = envDir ? [join(envDir, def.file), join(envDir, 'integrations.env'), join(envDir, 'litellm.env')].map(readEnvFile) : []
  return (name) => [env[name], ...files.map((file) => file[name])].find((value) => value?.trim().replace(/^["']|["']$/g, '').trim())?.trim().replace(/^["']|["']$/g, '')
}

/** One credential value, for the server's own use (the OAuth client, the encryption key). Never put it in a response. */
export const credentialValue = (def: ServiceDef, name: string, env: NodeJS.ProcessEnv = process.env, envDir?: string) => lookup(def, env, envDir)(name)

export function missingVars(def: ServiceDef, env: NodeJS.ProcessEnv = process.env, envDir?: string): string[] {
  const find = lookup(def, env, envDir)
  const filled = (value?: string) => Boolean(value?.trim().replace(/^["']|["']$/g, '').trim())
  return def.vars.filter((name) => !filled(find(name)))
}

export interface ConnectionState { connected: boolean; missing: string[] }

export function connectionState(def: ServiceDef, env?: NodeJS.ProcessEnv, envDir?: string): ConnectionState {
  const missing = missingVars(def, env, envDir)
  return { connected: missing.length === 0, missing }
}

/** What actually runs: a service without credentials is always mock (FR-40), and so is one whose adapter is not written yet. */
export function effectiveMode(requested: IntegrationMode | undefined, connected: boolean, adapterReady: boolean): IntegrationMode {
  return connected && adapterReady ? requested ?? 'mock' : 'mock'
}

export const isMode = (value: unknown): value is IntegrationMode => typeof value === 'string' && (INTEGRATION_MODES as readonly string[]).includes(value)
