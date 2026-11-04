import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the office finds Postgres, Redis and each brand's Hermes. On the VPS these come from the
// environment (OFFICE_DATABASE_URL, OFFICE_REDIS_URL, HERMES_<SLUG>_URL / _KEY). In local development
// they fall back to the files scripts/setup-env.mjs and scripts/hermes-init.mjs write in infra/env/,
// with the 127.0.0.1 ports of infra/compose.local.yml.

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]build[\\/]?$/, '')

// Local Hermes ports published by infra/compose.hermes.local.yml, one per brand.
const LOCAL_HERMES_PORTS: Record<string, number> = { otca: 18642, infojerman: 18643, ciaomanda: 18644, jepangkoey: 18645 }

export function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(([, key, value]) => [key, value]))
}

export interface HermesEndpoint { url: string; key: string }

export interface LangfuseConfig { baseUrl: string; publicKey: string; secretKey: string }

export interface OfficeSettings {
  databaseUrl?: string
  redisUrl: string
  hermes(brand: string): HermesEndpoint | undefined
  langfuse?: LangfuseConfig
  /** Model table for the agents: dev runs everything on Codex, prod adds the Claude pools (server/office/model-routes.ts). */
  engineProfile: 'dev' | 'prod'
}

/** Langfuse keys for the usage view: the environment first, then observability.env, then Hermes' copy. */
function langfuseConfig(env: NodeJS.ProcessEnv, envDir: string): LangfuseConfig | undefined {
  const observability = readEnvFile(join(envDir, 'observability.env'))
  const hermes = readEnvFile(join(envDir, 'hermes-otca.env'))
  const publicKey = env.LANGFUSE_PUBLIC_KEY || observability.LANGFUSE_PUBLIC_KEY || env.HERMES_LANGFUSE_PUBLIC_KEY || hermes.HERMES_LANGFUSE_PUBLIC_KEY
  const secretKey = env.LANGFUSE_SECRET_KEY || observability.LANGFUSE_SECRET_KEY || env.HERMES_LANGFUSE_SECRET_KEY || hermes.HERMES_LANGFUSE_SECRET_KEY
  const baseUrl = env.LANGFUSE_HOST || observability.LANGFUSE_HOST || env.HERMES_LANGFUSE_BASE_URL || hermes.HERMES_LANGFUSE_BASE_URL || 'https://cloud.langfuse.com'
  return publicKey && secretKey ? { baseUrl: baseUrl.replace(/\/+$/, ''), publicKey, secretKey } : undefined
}

export function officeSettings(env: NodeJS.ProcessEnv = process.env, root = REPO_ROOT): OfficeSettings {
  const envDir = join(root, 'infra', 'env')
  const postgres = readEnvFile(join(envDir, 'postgres.env'))
  const localDatabase = postgres.POSTGRES_PASSWORD
    ? `postgresql://${postgres.POSTGRES_USER || 'office'}:${encodeURIComponent(postgres.POSTGRES_PASSWORD)}@127.0.0.1:15432/${postgres.POSTGRES_DB || 'office'}`
    : undefined
  return {
    databaseUrl: env.OFFICE_DATABASE_URL || localDatabase,
    redisUrl: env.OFFICE_REDIS_URL || 'redis://127.0.0.1:16379',
    langfuse: langfuseConfig(env, envDir),
    engineProfile: env.ENGINE_PROFILE === 'prod' ? 'prod' : 'dev',
    hermes(brand) {
      const name = brand.toUpperCase()
      const key = env[`HERMES_${name}_KEY`] || readEnvFile(join(envDir, `hermes-${brand}.env`)).API_SERVER_KEY
      const url = env[`HERMES_${name}_URL`] || (LOCAL_HERMES_PORTS[brand] ? `http://127.0.0.1:${LOCAL_HERMES_PORTS[brand]}` : undefined)
      return key && url ? { url: url.replace(/\/+$/, ''), key } : undefined
    },
  }
}
