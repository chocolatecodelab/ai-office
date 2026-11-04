// Which model each agent uses (blueprint FR-12, table in docs/PLAN.md 3.2 and the "Model" part of each
// context/agents/*.md). A route is chosen by the agent, the task's weight (complex or not) and urgency.
//
// Two profiles, set with ENGINE_PROFILE:
//  - dev (default): Codex on ChatGPT Plus for every agent; no Claude key is needed.
//  - prod: the FR-12 split. Codex stays the main engine; Haiku 5.5 (cepat), Sonnet 5.5 (final) and
//    Opus 5.5 (video) run through LiteLLM pools. Urgent tasks use the agent's reserve model.
// The Sonnet share caps (20/30/50%) are not enforced yet.

export type EngineProfile = 'dev' | 'prod'
export type ClaudeAlias = 'cepat' | 'final' | 'video'

export interface Route { source: 'codex' | 'litellm'; model?: ClaudeAlias; provider?: 'litellm'; reasoningEffort: 'low' | 'high' }
export interface AgentRoutes { simple: Route; complex: Route; urgent: Route }

const codex = (reasoningEffort: Route['reasoningEffort']): Route => ({ source: 'codex', reasoningEffort })
const claude = (model: ClaudeAlias, reasoningEffort: Route['reasoningEffort'] = 'low'): Route => ({ source: 'litellm', provider: 'litellm', model, reasoningEffort })

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
const DEV_ROUTES: AgentRoutes = DEFAULT_ROUTES

export function routesFor(agentType: string, profile: EngineProfile = 'dev'): AgentRoutes {
  return profile === 'prod' ? PROD_ROUTES[agentType] ?? DEFAULT_ROUTES : DEV_ROUTES
}

export function routeFor(task: { agentType?: string; urgent: boolean; complex: boolean }, profile: EngineProfile = 'dev'): Route {
  const routes = routesFor(task.agentType ?? '', profile)
  // In dev there is no reserve model, so urgency does not change the route.
  return task.urgent && profile === 'prod' ? routes.urgent : task.complex ? routes.complex : routes.simple
}
