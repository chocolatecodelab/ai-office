import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessStore, Throttle, generateCode, installAccess, issueToken, normalizeCode, tokenValid } from './access.js'

const CODE = 'correct-horse-battery'
let dir: string
let base: string
let close: () => void
let store: AccessStore

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ruang-access-'))
  store = new AccessStore(dir)
  const app = express()
  installAccess(app, store, new Throttle())
  app.get('/api/health', (_request, response) => { response.json({ ok: true }) })
  app.get('/api/secret', (_request, response) => { response.json({ secret: 'agent data' }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
})
afterEach(() => close())

const post = (path: string, body: unknown, cookie = '') => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) })
const get = (path: string, cookie = '') => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {} })
const sessionOf = (response: Response) => response.headers.get('set-cookie')?.split(';')[0] ?? ''

describe('access code', () => {
  it('is off by default and leaves every route open', async () => {
    expect(await (await get('/api/access')).json()).toMatchObject({ enabled: false, unlocked: true, minLength: 12, rememberDays: 7 })
    expect((await get('/api/secret')).status).toBe(200)
  })

  it('locks the data routes once set, and only stores a hash', async () => {
    const set = await post('/api/access/code', { code: `  ${CODE}  ` })
    expect(set.status).toBe(200)
    const cookie = sessionOf(set)
    expect(set.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/)
    expect(set.headers.get('set-cookie')).not.toMatch(/Max-Age/)

    const locked = await get('/api/secret')
    expect(locked.status).toBe(401)
    expect(JSON.stringify(await locked.json())).not.toContain('agent data')
    expect((await get('/api/health')).status).toBe(200)
    expect(await (await get('/api/access')).json()).toMatchObject({ enabled: true, unlocked: false })
    expect((await get('/api/secret', cookie)).status).toBe(200)

    const saved = await readFile(join(dir, 'access.json'), 'utf8')
    expect(saved).not.toContain(CODE)
    // Windows has no POSIX file modes.
    if (process.platform !== 'win32') expect((await stat(join(dir, 'access.json'))).mode & 0o777).toBe(0o600)
  })

  it('unlocks with the code, remembers the device for 7 days on request, and locks again', async () => {
    await post('/api/access/code', { code: CODE })
    expect((await post('/api/access/unlock', { code: 'wrong-code-wrong' })).status).toBe(401)
    const remembered = await post('/api/access/unlock', { code: CODE, remember: true })
    expect(remembered.status).toBe(200)
    expect(remembered.headers.get('set-cookie')).toMatch(/Max-Age=604800/)
    const cookie = sessionOf(remembered)
    expect((await get('/api/secret', cookie)).status).toBe(200)
    const lock = await post('/api/access/lock', {}, cookie)
    expect(lock.headers.get('set-cookie')).toMatch(/Max-Age=0/)
  })

  it('needs the current code to change or turn off the code, and ends old sessions', async () => {
    const first = sessionOf(await post('/api/access/code', { code: CODE }))
    expect((await post('/api/access/code', { code: 'another-long-code', currentCode: CODE })).status).toBe(401)
    expect((await post('/api/access/code', { code: 'another-long-code', currentCode: 'nope-nope-nope' }, first)).status).toBe(401)
    const changed = await post('/api/access/code', { code: 'another-long-code', currentCode: CODE }, first)
    expect(changed.status).toBe(200)
    expect((await get('/api/secret', first)).status).toBe(401)
    const second = sessionOf(changed)
    expect((await post('/api/access/disable', { currentCode: CODE }, second)).status).toBe(401)
    expect((await post('/api/access/disable', { currentCode: 'another-long-code' }, second)).status).toBe(200)
    expect((await get('/api/secret')).status).toBe(200)
  })

  it('rejects short codes, cross-site posts and repeated guessing', async () => {
    expect((await post('/api/access/code', { code: 'short' })).status).toBe(400)
    const forged = await fetch(`${base}/api/access/code`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE }) })
    expect(forged.status).toBe(403)
    await post('/api/access/code', { code: CODE })
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await post('/api/access/unlock', { code: `guess-number-${attempt}` })).status).toBe(401)
    const throttled = await post('/api/access/unlock', { code: CODE })
    expect(throttled.status).toBe(429)
    expect(throttled.headers.get('retry-after')).toBe('1')
  })

  it('stays locked when the stored file is damaged, and follows changes made by the CLI', async () => {
    await writeFile(join(dir, 'access.json'), 'not json')
    expect((await get('/api/secret')).status).toBe(401)
    expect((await post('/api/access/unlock', { code: CODE })).status).toBe(401)
    await new AccessStore(dir).clear()
    expect((await get('/api/secret')).status).toBe(200)
  })
})

describe('access code helpers', () => {
  it('generates readable 80-bit codes and validates custom ones', () => {
    expect(generateCode()).toMatch(/^ruang-([2-9A-HJ-NP-Z]{4}-){3}[2-9A-HJ-NP-Z]{4}$/)
    expect(generateCode()).not.toBe(generateCode())
    expect(normalizeCode('  my long custom code ')).toBe('my long custom code')
    expect(() => normalizeCode('x'.repeat(129))).toThrow()
    expect(() => normalizeCode('twelve chars\n!')).toThrow()
  })

  it('signs sessions that expire and cannot be forged', async () => {
    const file = await new AccessStore(dir).set(CODE)
    const now = Date.parse('2026-10-01T00:00:00Z')
    const token = issueToken(file, false, now)
    expect(tokenValid(file, token, now + 60_000)).toBe(true)
    expect(tokenValid(file, token, now + 13 * 3_600_000)).toBe(false)
    expect(tokenValid(file, issueToken(file, true, now), now + 6 * 86_400_000)).toBe(true)
    expect(tokenValid(file, token.replace(/\.0\./, '.1.'), now)).toBe(false)
    expect(tokenValid({ ...file, secret: Buffer.alloc(32, 1).toString('base64') }, token, now)).toBe(false)
  })
})
