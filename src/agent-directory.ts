import { useEffect, useState } from 'react'

/** One agent of the office crew, as served by /api/claude/agents. */
export interface CrewAgent { id: string; name: string; role: string; project?: { name: string } }

// Shared by every page: the crew changes when Projects are registered, so labels come from the server.
let crew: CrewAgent[] = []
let pending: Promise<CrewAgent[]> | null = null
const listeners = new Set<(agents: CrewAgent[]) => void>()

export function knownAgentName(id: string): string | undefined {
  return crew.find((agent) => agent.id === id)?.name
}

export function loadCrew(force = false): Promise<CrewAgent[]> {
  if (!pending || force) {
    pending = fetch('/api/claude/agents')
      .then((response) => (response.ok ? response.json() : []))
      .then((agents: CrewAgent[]) => {
        crew = Array.isArray(agents) ? agents : []
        for (const listener of listeners) listener(crew)
        return crew
      })
      .catch(() => crew)
  }
  return pending
}

/** The current crew; refetched on mount so a newly registered Project shows up. */
export function useCrew(): CrewAgent[] {
  const [agents, setAgents] = useState<CrewAgent[]>(crew)
  useEffect(() => {
    listeners.add(setAgents)
    void loadCrew(true)
    return () => { listeners.delete(setAgents) }
  }, [])
  return agents
}
