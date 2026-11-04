import type { AgentRoute } from './office-api.ts'

export const CLAUDE_NAMES: Record<string, string> = { cepat: 'Haiku 5.5', final: 'Sonnet 5.5', video: 'Opus 5.5' }

/** One route as staff read it: a Codex model with its reasoning level, or a Claude model through LiteLLM. */
export function routeLabel(route: AgentRoute): string {
  if (route.source === 'codex') return `Codex · ${route.model ?? 'gpt-6-sol'}, reasoning ${route.reasoningEffort === 'high' ? 'tinggi' : 'rendah'}`
  return `${route.model ? CLAUDE_NAMES[route.model] ?? route.model : 'Claude'} · LiteLLM`
}
