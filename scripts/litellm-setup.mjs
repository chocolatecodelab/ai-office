#!/usr/bin/env node
// Creates the LiteLLM budget pools (blueprint Bab 10, L0-06) and one virtual key per brand per pool,
// with the soft caps from context/brands/<slug>/agents.json. Safe to run again: existing pools are
// reused and brands that already have keys are skipped. Keys go to infra/env/brand-<slug>.env and
// are never printed.
//
// Usage: node scripts/litellm-setup.mjs [--url http://127.0.0.1:14000]
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const urlFlag = process.argv.indexOf('--url')
const BASE = (urlFlag > 0 ? process.argv[urlFlag + 1] : 'http://127.0.0.1:14000').replace(/\/+$/, '')

// Pool → monthly budget (USD), the aliases it may call, and the agents.json cap that sizes its brand keys.
export const POOLS = {
  umum: { team: 'pool-umum', budget: 20, models: ['cepat', 'final'], cap: 'pool_umum' },
  video: { team: 'pool-video', budget: 20, models: ['video', 'cepat'], cap: 'pool_video' },
  gambar: { team: 'pool-gambar', budget: 10, models: ['gambar'], cap: 'pool_gambar' },
}

const masterKey = readFileSync(join(root, 'infra', 'env', 'litellm.env'), 'utf8').match(/^LITELLM_MASTER_KEY=(.+)$/m)?.[1]?.trim()
if (!masterKey) throw new Error('LITELLM_MASTER_KEY kosong; jalankan dulu node scripts/setup-env.mjs')

async function call(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${masterKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`)
  return response.json()
}

const existing = await call('/team/list')
const teams = {}
for (const [pool, spec] of Object.entries(POOLS)) {
  const found = existing.find((team) => team.team_alias === spec.team)
  teams[pool] = found?.team_id ?? (await call('/team/new', {
    team_alias: spec.team, max_budget: spec.budget, budget_duration: '30d', models: spec.models,
  })).team_id
  console.log(`- ${spec.team}: $${spec.budget}/30 hari ${found ? '(sudah ada)' : '(dibuat)'}`)
}

const brandsDir = join(root, 'context', 'brands')
for (const slug of readdirSync(brandsDir)) {
  const brand = JSON.parse(readFileSync(join(brandsDir, slug, 'agents.json'), 'utf8'))
  const target = join(root, 'infra', 'env', `brand-${slug}.env`)
  if (existsSync(target)) { console.log(`- ${slug}: key sudah ada, dilewati`); continue }
  const lines = [`# Virtual key LiteLLM brand ${brand.brand} (dibuat scripts/litellm-setup.mjs)`, `BRAND_SLUG=${slug}`]
  for (const [pool, spec] of Object.entries(POOLS)) {
    const cap = brand.budget_soft_cap_usd?.[spec.cap]
    if (cap === undefined) continue
    const { key } = await call('/key/generate', {
      team_id: teams[pool], key_alias: `${slug}-${pool}`, max_budget: cap, budget_duration: '30d',
      models: spec.models, metadata: { brand_id: slug, pool },
    })
    lines.push(`LITELLM_KEY_${pool.toUpperCase()}=${key}`)
    console.log(`- ${slug}/${pool}: key dibuat, batas $${cap}`)
  }
  writeFileSync(target, `${lines.join('\n')}\n`, { mode: 0o600 })
}
