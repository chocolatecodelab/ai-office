import { describe, expect, it } from 'vitest'
import { routeFor, routesFor } from './model-routes.js'

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

  it('gives a role without its own row Codex in prod, and gives every known agent a row', () => {
    expect(routeFor({ agentType: 'new-role', urgent: true, complex: false }, 'prod')).toMatchObject({ source: 'codex' })
    for (const agentType of AGENTS) expect(routesFor(agentType, 'prod')).toHaveProperty('urgent')
  })
})
