import { connect } from 'node:net'

// Is each part of the office answering? Postgres, Redis, LiteLLM and every brand's Hermes gateway are
// probed with short timeouts, so the Logs page shows a stopped service within seconds instead of hanging.

export interface HealthCheck { name: string; ok: boolean; detail: string; ms: number }

const TIMEOUT_MS = 2500

export async function probeHttp(name: string, url: string, fetcher: typeof fetch = fetch): Promise<HealthCheck> {
  const started = Date.now()
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    return { name, ok: response.ok, detail: response.ok ? 'menjawab' : `HTTP ${response.status}`, ms: Date.now() - started }
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error && error.name === 'TimeoutError' ? 'tidak menjawab dalam 2,5 detik' : 'tidak terjangkau', ms: Date.now() - started }
  }
}

export function probeTcp(name: string, url: string): Promise<HealthCheck> {
  const started = Date.now()
  return new Promise((resolve) => {
    let target: URL
    try { target = new URL(url) } catch { resolve({ name, ok: false, detail: 'alamat tidak valid', ms: 0 }); return }
    const socket = connect({ host: target.hostname, port: Number(target.port) || 6379, timeout: TIMEOUT_MS })
    const done = (ok: boolean, detail: string) => { socket.destroy(); resolve({ name, ok, detail, ms: Date.now() - started }) }
    socket.once('connect', () => done(true, 'menerima koneksi'))
    socket.once('timeout', () => done(false, 'tidak menjawab dalam 2,5 detik'))
    socket.once('error', () => done(false, 'tidak terjangkau'))
  })
}

export interface HealthDeps {
  db: { query(sql: string): Promise<unknown> }
  redisUrl: string
  litellmUrl: string
  gateways: Array<{ brandName: string; url: string | undefined }>
  fetcher?: typeof fetch
}

export async function systemHealth(deps: HealthDeps): Promise<HealthCheck[]> {
  const database = async (): Promise<HealthCheck> => {
    const started = Date.now()
    try { await deps.db.query('SELECT 1'); return { name: 'Postgres', ok: true, detail: 'menjawab', ms: Date.now() - started } } catch { return { name: 'Postgres', ok: false, detail: 'tidak terjangkau', ms: Date.now() - started } }
  }
  return Promise.all([
    database(),
    probeTcp('Redis', deps.redisUrl),
    probeHttp('LiteLLM', `${deps.litellmUrl.replace(/\/+$/, '')}/health/liveliness`, deps.fetcher),
    ...deps.gateways.map((gateway) => gateway.url
      ? probeHttp(`Hermes · ${gateway.brandName}`, `${gateway.url}/health`, deps.fetcher)
      : Promise.resolve<HealthCheck>({ name: `Hermes · ${gateway.brandName}`, ok: false, detail: 'belum dikonfigurasi', ms: 0 })),
  ])
}
