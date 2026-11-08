// Which model each agent uses (blueprint FR-12, table in docs/PLAN.md 3.2 and the "Model" part of each
// context/agents/*.md). A route is chosen by the agent, the task's weight (simple or complex) and urgency.
//
// Two profiles, set with ENGINE_PROFILE:
//  - dev (default): Codex on ChatGPT Plus for every agent; no Claude key is needed.
//  - prod: the FR-12 split. Codex stays the main engine; Haiku 5.5 (cepat), Sonnet 5.5 (final) and
//    Opus 5.5 (video) run through LiteLLM pools. Urgent tasks use the agent's reserve model.
// Either table can be changed per agent and weight without a deploy: staff set an override (stored in
// agent_routes) and `validateRoute` keeps it inside the profile, so dev can never ask for a Claude pool.
// The Sonnet share caps (20/30/50%) are not enforced yet.

export type EngineProfile = 'dev' | 'prod'
export type Weight = 'simple' | 'complex' | 'urgent'
export const WEIGHTS: readonly Weight[] = ['simple', 'complex', 'urgent']

export const CLAUDE_ALIASES = ['cepat', 'final', 'video'] as const
/** Codex models known to work; any other id can be set, and the model test says whether it runs. */
export const CODEX_MODELS = ['gpt-6-sol'] as const

export interface Route { source: 'codex' | 'litellm'; model?: string; provider?: 'litellm'; reasoningEffort: 'low' | 'high' }
export type AgentRoutes = Record<Weight, Route>
export type RouteOverrides = Partial<Record<Weight, Route>>

const codex = (reasoningEffort: Route['reasoningEffort'], model?: string): Route => ({ source: 'codex', ...(model ? { model } : {}), reasoningEffort })
const claude = (model: (typeof CLAUDE_ALIASES)[number], reasoningEffort: Route['reasoningEffort'] = 'low'): Route => ({ source: 'litellm', provider: 'litellm', model, reasoningEffort })

const PROD_ROUTES: Record<string, AgentRoutes> = {
  manager: { simple: codex('low'), complex: codex('high'), urgent: claude('cepat') },
  'event-specialist': { simple: claude('cepat'), complex: codex('high'), urgent: claude('final', 'high') },
  'content-creator': { simple: codex('low'), complex: codex('high'), urgent: claude('final', 'high') },
  'digital-marketing': { simple: claude('cepat'), complex: codex('high'), urgent: claude('final', 'high') },
  'social-media-manager': { simple: codex('low'), complex: codex('high'), urgent: claude('cepat') },
  'video-editor': { simple: claude('cepat'), complex: claude('video', 'high'), urgent: claude('video', 'high') },
}

// An agent without its own row (a new role) falls back to Codex by weight.
const DEFAULT_ROUTES: AgentRoutes = { simple: codex('low'), complex: codex('high'), urgent: codex('high') }

/** The route a staff member asked for, checked against the profile. Throws a message staff can read. */
export function validateRoute(input: unknown, profile: EngineProfile): Route {
  const value = (input ?? {}) as Record<string, unknown>
  const reasoningEffort = value.reasoningEffort
  if (reasoningEffort !== 'low' && reasoningEffort !== 'high') throw new Error('reasoningEffort harus "low" atau "high".')
  if (value.source === 'codex') {
    const model = typeof value.model === 'string' ? value.model.trim() : ''
    if (model && !/^[A-Za-z0-9][\w.:/-]{0,63}$/.test(model)) throw new Error('Nama model Codex tidak valid.')
    return codex(reasoningEffort, model || undefined)
  }
  if (value.source === 'litellm') {
    if (profile !== 'prod') throw new Error('Pool Claude belum aktif di profil development; pakai Codex.')
    if (!(CLAUDE_ALIASES as readonly string[]).includes(String(value.model))) throw new Error(`Model Claude harus salah satu dari ${CLAUDE_ALIASES.join(', ')}.`)
    return claude(value.model as (typeof CLAUDE_ALIASES)[number], reasoningEffort)
  }
  throw new Error('source harus "codex" atau "litellm".')
}

/** The agent's three routes: the profile's table with any overrides on top. */
export function routesFor(agentType: string, profile: EngineProfile = 'dev', overrides: RouteOverrides = {}): AgentRoutes {
  const base = profile === 'prod' ? PROD_ROUTES[agentType] ?? DEFAULT_ROUTES : DEFAULT_ROUTES
  const merged = { ...base }
  for (const weight of WEIGHTS) {
    const override = overrides[weight]
    // An override that the profile no longer allows (a Claude pool saved in prod, read in dev) is ignored.
    if (override && (override.source === 'codex' || profile === 'prod')) merged[weight] = override
  }
  return merged
}

export function routeFor(task: { agentType?: string; urgent: boolean; complex: boolean }, profile: EngineProfile = 'dev', overrides: RouteOverrides = {}): Route {
  const routes = routesFor(task.agentType ?? '', profile, overrides)
  // In dev there is no reserve model, so urgency does not change the route.
  return task.urgent && profile === 'prod' ? routes.urgent : task.complex ? routes.complex : routes.simple
}
