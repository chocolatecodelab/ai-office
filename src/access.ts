// Client side of the optional access code (see server/access.ts).

export interface AccessStatus { enabled: boolean; unlocked: boolean; since?: string; minLength: number; rememberDays: number }

/** Fired when any API read answers "locked", so the app shows the unlock screen again. */
export const LOCKED_EVENT = 'ruang:locked'

export type AccessResult = { ok: true; status: AccessStatus } | { ok: false; message: string }

/** POSTs to an access route. The custom header marks the request as coming from this page. */
export async function accessRequest(path: 'unlock' | 'lock' | 'code' | 'disable', body: Record<string, unknown> = {}, request: typeof fetch = fetch): Promise<AccessResult> {
  try {
    const response = await request(`/api/access/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: JSON.stringify(body), credentials: 'same-origin' })
    const data = await response.json().catch(() => undefined) as (AccessStatus & { error?: string }) | undefined
    if (!response.ok || !data) return { ok: false, message: data?.error ?? `The OTCA server answered HTTP ${response.status}.` }
    return { ok: true, status: data }
  } catch {
    return { ok: false, message: 'The OTCA server could not be reached.' }
  }
}

export async function loadAccess(request: typeof fetch = fetch): Promise<AccessStatus | undefined> {
  try {
    const response = await request('/api/access', { credentials: 'same-origin' })
    return response.ok ? await response.json() as AccessStatus : undefined
  } catch {
    return undefined
  }
}

/** A random code like ruang-7KQ4-M2XD-9PWT-H6RA (80 bits; no 0/O/1/I to misread). */
export function generateCode(random: (values: Uint32Array) => Uint32Array = (values) => crypto.getRandomValues(values)): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const values = random(new Uint32Array(16))
  const characters = Array.from(values, (value) => alphabet[value % alphabet.length])
  return `ruang-${[0, 4, 8, 12].map((start) => characters.slice(start, start + 4).join('')).join('-')}`
}

export function codeFileText(code: string, origin: string, createdAt = new Date()): string {
  return [
    'OTCA access code',
    '',
    `  ${code}`,
    '',
    `For: ${origin}`,
    `Created: ${createdAt.toISOString()}`,
    '',
    'Keep this file somewhere safe. OTCA has no password reset.',
    'Lost the code? On the machine that runs OTCA, run:',
    '  ruang access-code off   (remove it, then set a new one in Settings)',
    '  ruang access-code new   (print a new random code)',
    '',
  ].join('\n')
}

export function downloadCode(code: string): void {
  const url = URL.createObjectURL(new Blob([codeFileText(code, window.location.origin)], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'ruang-access-code.txt'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
