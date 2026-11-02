#!/usr/bin/env node
// PreToolUse hook (blueprint L0-04, SEC-12): stops Claude Code from writing secrets into the repo.
// Blocks writes to real env files, and any Write/Edit whose text looks like an API key, token or
// private key. Exit code 2 blocks the tool call and shows the reason to Claude.
import { readFileSync } from 'node:fs'

const SECRET_PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['LiteLLM key', /sk-litellm-[A-Za-z0-9_-]{16,}/],
  ['Meta access token', /EAA[A-Za-z0-9]{60,}/],
  ['Google OAuth secret', /GOCSPX-[A-Za-z0-9_-]{20,}/],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  ['Telegram bot token', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

// Real env files hold secrets; only the *.example templates belong in the repo.
const ENV_FILE = /(^|[\\/])(\.env(\.[^\\/]*)?|[^\\/]+\.env)$/
const ENV_TEMPLATE = /\.example$/

export function findSecret(filePath, text) {
  if (filePath && ENV_FILE.test(filePath) && !ENV_TEMPLATE.test(filePath)) return `file env asli (${filePath})`
  for (const [label, pattern] of SECRET_PATTERNS) if (pattern.test(text)) return label
  return undefined
}

function textOf(input) {
  if (typeof input.content === 'string') return input.content
  if (typeof input.new_string === 'string') return input.new_string
  if (Array.isArray(input.edits)) return input.edits.map((edit) => edit.new_string ?? '').join('\n')
  return ''
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('block-secrets.mjs')) {
  let event = {}
  try { event = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { process.exit(0) }
  const input = event.tool_input ?? {}
  const found = findSecret(input.file_path ?? '', textOf(input))
  if (found) {
    process.stderr.write(`Diblokir: terdeteksi ${found}. Simpan rahasia hanya di .env / infra/env/*.env (di luar git), lalu rujuk lewat nama variabel.\n`)
    process.exit(2)
  }
}
