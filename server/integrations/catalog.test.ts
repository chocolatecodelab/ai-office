import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SERVICES, connectionState, effectiveMode, isMode } from './catalog.js'

const dirs: string[] = []
const envDir = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'integrations-'))
  dirs.push(dir)
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const service = (name: string) => SERVICES.find((item) => item.service === name)!

describe('integration connection state', () => {
  it('is not connected until every variable is filled', () => {
    const dir = envDir({ 'integrations.env': 'TRELLO_API_KEY=abc\nTRELLO_TOKEN=\n' })
    expect(connectionState(service('trello'), {}, dir)).toEqual({ connected: false, missing: ['TRELLO_TOKEN'] })
    writeFileSync(join(dir, 'integrations.env'), 'TRELLO_API_KEY=abc\nTRELLO_TOKEN="tok"\n')
    expect(connectionState(service('trello'), {}, dir)).toEqual({ connected: true, missing: [] })
  })
  it('reads the environment first and the OpenAI key from litellm.env, and counts empty quotes as empty', () => {
    expect(connectionState(service('scalev'), { SCALEV_API_KEY: 'x' }).connected).toBe(true)
    expect(connectionState(service('gpt-image'), {}, envDir({ 'litellm.env': 'OPENAI_API_KEY=sk-test\n' })).connected).toBe(true)
    expect(connectionState(service('scalev'), {}, envDir({ 'integrations.env': 'SCALEV_API_KEY=""\n' })).connected).toBe(false)
  })
  it('never carries a credential value in its result', () => {
    const state = connectionState(service('scalev'), { SCALEV_API_KEY: 'rahasia-123' })
    expect(JSON.stringify(state)).not.toContain('rahasia-123')
  })
})

describe('integration mode', () => {
  it('stays mock without credentials or without an adapter, whatever was asked', () => {
    expect(effectiveMode('live', false, true)).toBe('mock')
    expect(effectiveMode('live', true, false)).toBe('mock')
    expect(effectiveMode('sandbox', true, true)).toBe('sandbox')
    expect(effectiveMode(undefined, true, true)).toBe('mock')
  })
  it('accepts only the three modes', () => {
    expect(['mock', 'sandbox', 'live', 'prod', undefined].map(isMode)).toEqual([true, true, true, false, false])
  })
  it('lists each service once', () => {
    expect(new Set(SERVICES.map((item) => item.service)).size).toBe(SERVICES.length)
  })
})
