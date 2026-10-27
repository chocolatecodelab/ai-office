// Agents are whatever Hermes profiles the machine reports (plus OpenCode), so nothing here is
// tied to particular names: each agent's look is derived from its id.

export interface AgentLook { hair: string; skin: string; shirt: string; pants: string }

const HAIR = ['#1d293c', '#b54b45', '#6a4d8d', '#3b2a20', '#c9a24a', '#2f4f3a', '#8b5a2b', '#11151c']
const SKIN = ['#e9b57d', '#c98e5a', '#f1c9a0', '#a8714a', '#dca06e']
const SHIRT = ['#e6b34e', '#70bdcb', '#93ca67', '#e76f51', '#8f7ae6', '#f4a3b4', '#4f9c7a', '#d9534f', '#5a8dee', '#c7a17a']
const PANTS = ['#36475d', '#374052', '#344349', '#4a3b2f', '#2f3a44', '#3d2f4a']

/** A small stable hash (FNV-1a) so an agent keeps the same look on every device. */
export function hashName(name: string): number {
  let hash = 2166136261
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const SPECIAL_LOOKS: Record<string, AgentLook> = {
  ceo: { hair: '#1d293c', skin: '#e9b57d', shirt: '#2c3e50', pants: '#1a252f' },
  marketing: { hair: '#8b5a2b', skin: '#f1c9a0', shirt: '#e67e22', pants: '#34495e' },
  researcher: { hair: '#2f4f3a', skin: '#e9b57d', shirt: '#16a085', pants: '#2c3e50' },
  creator: { hair: '#6a4d8d', skin: '#dca06e', shirt: '#8e44ad', pants: '#2d3436' }
}

export function agentLook(id: string): AgentLook {
  if (SPECIAL_LOOKS[id]) {
    return SPECIAL_LOOKS[id]
  }
  const hash = hashName(id)
  return { hair: HAIR[hash % HAIR.length], skin: SKIN[(hash >>> 4) % SKIN.length], shirt: SHIRT[(hash >>> 8) % SHIRT.length], pants: PANTS[(hash >>> 12) % PANTS.length] }
}
