#!/usr/bin/env node
// Creates the service env files in infra/env/ from their *.example templates, filling generated
// passwords and the LiteLLM master key, and the Anthropic key from the repo's .env when present.
// Existing files are left alone. Nothing secret is printed.
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const envDir = join(root, 'infra', 'env')

function readEnv(file) {
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^["']|["']$/g, '')]))
}

function fill(template, values) {
  return readFileSync(template, 'utf8').split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    return match && match[1] in values ? `${match[1]}=${values[match[1]]}` : line
  }).join('\n')
}

function create(name, values) {
  const target = join(envDir, `${name}.env`)
  if (existsSync(target)) return console.log(`- infra/env/${name}.env sudah ada, tidak diubah`)
  writeFileSync(target, fill(join(envDir, `${name}.env.example`), values), { mode: 0o600 })
  console.log(`- infra/env/${name}.env dibuat`)
}

const repoEnv = readEnv(join(root, '.env'))
const postgres = readEnv(join(envDir, 'postgres.env'))
const password = postgres.POSTGRES_PASSWORD || randomBytes(18).toString('base64url')
const anthropic = repoEnv.ANTHROPIC_API_KEY || repoEnv.API_KEY_ANTHROPIC_CLAUDE || ''

create('postgres', { POSTGRES_PASSWORD: password })
create('litellm', {
  LITELLM_MASTER_KEY: `sk-${randomBytes(24).toString('base64url')}`,
  DATABASE_URL: `postgresql://office:${password}@postgres:5432/litellm`,
  ANTHROPIC_API_KEY: anthropic,
})
if (!anthropic) console.log('! Anthropic API key tidak ditemukan di .env; isi ANTHROPIC_API_KEY di infra/env/litellm.env')
