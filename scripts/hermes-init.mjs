#!/usr/bin/env node
// Prepares one brand's Hermes container: data/<slug>/config.yaml from hermes/config.yaml, and
// infra/env/hermes-<slug>.env with the API server key plus the brand's pool-umum LiteLLM key only
// (video and image keys stay with the workers and the api). Run scripts/litellm-setup.mjs first.
// An existing config and API server key are kept. Usage: node scripts/hermes-init.mjs <slug>
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const slug = process.argv[2]
if (!slug || !existsSync(join(root, 'context', 'brands', slug))) throw new Error('Pakai: node scripts/hermes-init.mjs <slug brand di context/brands>')

const data = join(root, 'data', slug)
mkdirSync(data, { recursive: true })
if (!existsSync(join(data, 'config.yaml'))) copyFileSync(join(root, 'hermes', 'config.yaml'), join(data, 'config.yaml'))

const valueIn = (file, name) => existsSync(file) ? readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]?.trim() : undefined
const env = join(root, 'infra', 'env', `hermes-${slug}.env`)
const poolKey = valueIn(join(root, 'infra', 'env', `brand-${slug}.env`), 'LITELLM_KEY_UMUM')
if (!poolKey) throw new Error(`LITELLM_KEY_UMUM brand ${slug} belum ada; jalankan dulu node scripts/litellm-setup.mjs`)
const serverKey = valueIn(env, 'API_SERVER_KEY') ?? randomBytes(24).toString('base64url')
writeFileSync(env, `API_SERVER_KEY=${serverKey}\nLITELLM_KEY_UMUM=${poolKey}\n`, { mode: 0o600 })
console.log(`- data/${slug} dan infra/env/hermes-${slug}.env siap`)
