import { useEffect, useState } from 'react'

// Client side of the profile lock (see server/profile-lock.ts). The server withholds a locked
// agent's private data; this only decides what to show and asks for the PIN.

export interface ProfileLockStatus { enabled: boolean; agents: string[]; unlocked: string[]; pinLength: number; unlockMinutes: number }

/** Fired after a PIN unlocks or locks an agent, so every view refreshes its data. */
export const PROFILES_CHANGED = 'ruang:profiles-changed'

export type ProfileLockResult = { ok: true; status: ProfileLockStatus } | { ok: false; message: string }

export async function profileLockRequest(path: 'setup' | 'update' | 'disable' | 'unlock' | 'lock', body: Record<string, unknown> = {}, request: typeof fetch = fetch): Promise<ProfileLockResult> {
  try {
    const response = await request(`/api/profile-lock/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: JSON.stringify(body), credentials: 'same-origin' })
    const data = await response.json().catch(() => undefined) as (ProfileLockStatus & { error?: string }) | undefined
    if (!response.ok || !data) return { ok: false, message: data?.error ?? `The OTCA server answered HTTP ${response.status}.` }
    if (path === 'unlock' || path === 'lock' || path === 'update' || path === 'disable') window.dispatchEvent(new Event(PROFILES_CHANGED))
    return { ok: true, status: data }
  } catch {
    return { ok: false, message: 'The OTCA server could not be reached.' }
  }
}

/** The profile lock status, refreshed on changes and every 30 s (unlocks expire). */
export function useProfileLock(): ProfileLockStatus | undefined {
  const [status, setStatus] = useState<ProfileLockStatus | undefined>()
  useEffect(() => {
    let active = true
    const load = () => void fetch('/api/profile-lock', { credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() as Promise<ProfileLockStatus> : undefined))
      .then((next) => { if (active && next && Array.isArray(next.agents)) setStatus(next) })
      .catch(() => undefined)
    load()
    const timer = window.setInterval(load, 30_000)
    window.addEventListener(PROFILES_CHANGED, load)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener(PROFILES_CHANGED, load) }
  }, [])
  return status
}

/** 'locked' (PIN needed), 'unlocked' (opened in this browser) or 'open' (not locked). */
export function agentPrivacy(status: ProfileLockStatus | undefined, agent: string | undefined): 'locked' | 'unlocked' | 'open' {
  if (!status?.enabled || !agent) return 'open'
  const match = (list: string[]) => list.some((item) => item.toLowerCase() === agent.trim().toLowerCase() || (item === 'opencode' && agent.trim().toLowerCase() === 'open-code'))
  if (!match(status.agents)) return 'open'
  return match(status.unlocked) ? 'unlocked' : 'locked'
}
