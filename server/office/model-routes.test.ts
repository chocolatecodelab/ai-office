import { describe, expect, it } from 'vitest'
import { routeFor, routesFor, validateRoute } from './model-routes.js'

const AGENTS = ['manager', 'event-specialist', 'content-creator', 'digital-marketing', 'social-media-manager', 'video-editor']

describe('model routes', () => {
  it('runs every agent on Codex in dev, urgent or not, with reasoning by weight', () => {
    for (const agentType of AGENTS) {
      expect(routeFor({ agentType, urgent: false, complex: true })).toEqual({ source: 'codex', reasoningEffort: 'high' })
      expect(routeFor({ agentType, urgent: true, complex: false })).toEqual({ source: 'codex', reasoningEffort: 'low' })
    }
  })

  it('defaults to dev, so no Claude key is needed unless the profile says prod', () => {
    expect(routeFor({ agentType: 'video-editor', urgent: false, complex: true })).toEqual({ source: 'codex', reasoningEffort: 'high' })
  })

  it('splits the work by agent in prod as FR-12 describes', () => {
    expect(routeFor({ agentType: 'manager', urgent: false, complex: true }, 'prod')).toEqual({ source: 'codex', reasoningEffort: 'high' })
    expect(routeFor({ agentType: 'manager', urgent: true, complex: false }, 'prod')).toMatchObject({ source: 'litellm', model: 'cepat' })
    expect(routeFor({ agentType: 'event-specialist', urgent: false, complex: false }, 'prod')).toMatchObject({ source: 'litellm', model: 'cepat' })
    expect(routeFor({ agentType: 'content-creator', urgent: true, complex: true }, 'prod')).toMatchObject({ source: 'litellm', model: 'final' })
    expect(routeFor({ agentType: 'video-editor', urgent: false, complex: true }, 'prod')).toMatchObject({ source: 'litellm', model: 'video', provider: 'litellm' })
  })

  it('puts an override on top of the table for one agent and weight only', () => {
    const override = { complex: { source: 'codex' as const, model: 'gpt-lain', reasoningEffort: 'low' as const } }
    expect(routeFor({ agentType: 'manager', urgent: false, complex: true }, 'dev', override)).toEqual(override.complex)
    expect(routeFor({ agentType: 'manager', urgent: false, complex: false }, 'dev', override)).toEqual({ source: 'codex', reasoningEffort: 'low' })
    expect(routeFor({ agentType: 'manager', urgent: false, complex: true }, 'dev')).toEqual({ source: 'codex', reasoningEffort: 'high' })
    expect(routesFor('manager', 'prod', override).complex).toEqual(override.complex)
  })

  it('ignores a Claude pool override when the profile is dev', () => {
    const claudePool = { simple: { source: 'litellm' as const, provider: 'litellm' as const, model: 'cepat', reasoningEffort: 'low' as const } }
    expect(routeFor({ agentType: 'manager', urgent: false, complex: false }, 'dev', claudePool)).toEqual({ source: 'codex', reasoningEffort: 'low' })
    expect(routeFor({ agentType: 'manager', urgent: false, complex: false }, 'prod', claudePool)).toEqual(claudePool.simple)
  })

  it('accepts a Codex model in dev and a Claude alias only in prod, and refuses everything else', () => {
    expect(validateRoute({ source: 'codex', model: ' gpt-6-sol ', reasoningEffort: 'high' }, 'dev')).toEqual({ source: 'codex', model: 'gpt-6-sol', reasoningEffort: 'high' })
    expect(validateRoute({ source: 'codex', reasoningEffort: 'low' }, 'dev')).toEqual({ source: 'codex', reasoningEffort: 'low' })
    expect(() => validateRoute({ source: 'litellm', model: 'cepat', reasoningEffort: 'low' }, 'dev')).toThrow(/development/)
    expect(validateRoute({ source: 'litellm', model: 'final', reasoningEffort: 'high' }, 'prod')).toEqual({ source: 'litellm', provider: 'litellm', model: 'final', reasoningEffort: 'high' })
    expect(() => validateRoute({ source: 'litellm', model: 'gpt-x', reasoningEffort: 'low' }, 'prod')).toThrow(/cepat/)
    expect(() => validateRoute({ source: 'codex', model: 'a b; rm', reasoningEffort: 'low' }, 'dev')).toThrow(/tidak valid/)
    expect(() => validateRoute({ source: 'codex', reasoningEffort: 'medium' }, 'dev')).toThrow(/reasoningEffort/)
    expect(() => validateRoute({ source: 'lain', reasoningEffort: 'low' }, 'dev')).toThrow(/source/)
    expect(() => validateRoute(undefined, 'dev')).toThrow()
  })

  it('gives a role without its own row Codex in prod, and gives every known agent a row', () => {
    expect(routeFor({ agentType: 'new-role', urgent: true, complex: false }, 'prod')).toMatchObject({ source: 'codex' })
    for (const agentType of AGENTS) expect(routesFor(agentType, 'prod')).toHaveProperty('urgent')
  })
})
