#!/usr/bin/env node
// Gate L0-07: sends one test trace to Langfuse and one test alert to Telegram, using
// infra/env/observability.env. Without TELEGRAM_CHAT_ID it lists the chats that recently
// messaged the bot, so the id can be copied from there. Secrets are never printed.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const file = join(import.meta.dirname, '..', 'infra', 'env', 'observability.env')
const env = Object.fromEntries(readFileSync(file, 'utf8').split(/\r?\n/)
  .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.trim()]))

// Langfuse only takes traces over OpenTelemetry now (the legacy /api/public/ingestion rejects them).
async function langfuse() {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return console.log('Langfuse: kunci belum diisi, dilewati')
  const nanos = BigInt(Date.now()) * 1_000_000n
  const text = (value) => ({ stringValue: value })
  const response = await fetch(`${env.LANGFUSE_HOST.replace(/\/+$/, '')}/api/public/otel/v1/traces`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ resourceSpans: [{
      resource: { attributes: [{ key: 'service.name', value: text('ai-office') }] },
      scopeSpans: [{ scope: { name: 'check-observability' }, spans: [{
        traceId: randomBytes(16).toString('hex'), spanId: randomBytes(8).toString('hex'), name: 'uji-L0-07', kind: 1,
        startTimeUnixNano: String(nanos), endTimeUnixNano: String(nanos + 1_000_000n),
        attributes: [
          { key: 'langfuse.trace.name', value: text('uji-L0-07') },
          { key: 'langfuse.trace.tags', value: { arrayValue: { values: [text('ai-office'), text('uji')] } } },
          { key: 'langfuse.trace.metadata.brand_id', value: text('otca') },
        ],
      }] }],
    }] }),
  })
  console.log(response.ok ? 'Langfuse: trace uji terkirim (cari "uji-L0-07" di menu Tracing)' : `Langfuse: gagal, HTTP ${response.status} ${(await response.text()).slice(0, 800)}`)
}

async function telegram() {
  if (!env.TELEGRAM_BOT_TOKEN) return console.log('Telegram: token belum diisi, dilewati')
  const api = (method, body) => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
  }).then((response) => response.json())
  const me = await api('getMe')
  if (!me.ok) return console.log(`Telegram: token ditolak (${me.description})`)
  if (!env.TELEGRAM_CHAT_ID) {
    const updates = await api('getUpdates')
    const chats = new Map((updates.result ?? []).map((update) => update.message ?? update.my_chat_member ?? update.channel_post)
      .filter(Boolean).map(({ chat }) => [chat.id, chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(' ')]))
    if (!chats.size) return console.log(`Telegram: bot @${me.result.username} siap, tapi belum ada chat. Kirim pesan ke bot (atau ke grup yang berisi bot), lalu jalankan lagi.`)
    console.log(`Telegram: bot @${me.result.username} siap. Isi TELEGRAM_CHAT_ID dengan salah satu id ini:`)
    for (const [id, name] of chats) console.log(`  ${id}  ${name}`)
    return
  }
  const sent = await api('sendMessage', { chat_id: env.TELEGRAM_CHAT_ID, text: '✅ AI Office OTCA: uji alert L0-07 berhasil.' })
  console.log(sent.ok ? `Telegram: alert uji terkirim lewat @${me.result.username}` : `Telegram: gagal kirim (${sent.description})`)
}

await langfuse()
await telegram()
