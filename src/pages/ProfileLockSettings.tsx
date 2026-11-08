import { useState, type FormEvent } from 'react'
import { PinInput } from '../ProfileLock.tsx'
import { usePolling } from '../polling.ts'
import { profileLockRequest, useProfileLock, type ProfileLockStatus } from '../profile-lock.ts'
import type { RuntimeSnapshot } from '../types.ts'

type Mode = 'idle' | 'setup' | 'agents' | 'pin' | 'off'

/** Pick the agents whose private data needs the PIN, and manage that one 6-digit PIN. */
export function ProfileLockSettings() {
  const status = useProfileLock()
  const runtime = usePolling<RuntimeSnapshot>('/api/runtime', 60_000)
  const [mode, setMode] = useState<Mode>('idle')
  const [message, setMessage] = useState<string>()
  const agents = runtime.status === 'ready' ? [
    ...(runtime.data.profiles.availability === 'available' ? runtime.data.profiles.data.map((profile) => profile.name) : []),
    ...(runtime.data.openCode.availability === 'available' ? ['opencode'] : []),
  ] : []
  const finish = (text: string) => () => { setMode('idle'); setMessage(text) }
  const start = (next: Mode) => () => { setMessage(undefined); setMode(next) }
  return <section className="card settings-card" aria-labelledby="profile-lock-title">
    <div className="settings-head"><div><p className="eyebrow">PRIVACY</p><h2 id="profile-lock-title">Profile lock</h2></div>{status && <span className={`badge ${status.enabled ? 'good' : 'muted'}`}>{status.enabled ? `On · ${status.agents.length} locked` : 'Off'}</span>}</div>
    <p className="muted">Like app lock on a phone: pick agents and set one 6-digit PIN. Locked agents still work and walk around the office, but their memory, files, Kanban tasks, cron job names, live activity and (for <code>default</code>) sessions and logs stay private until the PIN opens that agent in this browser for {status?.unlockMinutes ?? 15} minutes. The server withholds the data, not just the page.</p>
    {!status ? <p className="muted">Loading…</p> : <>
      {status.enabled && <p className="small-note">Locked: {status.agents.length ? status.agents.map((agent) => `${agent}${status.unlocked.includes(agent) ? ' (unlocked here)' : ''}`).join(', ') : 'no agents yet'}.</p>}
      {message && mode === 'idle' && <p className="form-success" role="status">{message}</p>}
      {mode === 'idle' && <div className="access-actions">
        {status.enabled ? <>
          <button type="button" className="primary-button" onClick={start('agents')}>Choose agents</button>
          <button type="button" className="refresh-button" onClick={start('pin')}>CHANGE PIN</button>
          <button type="button" className="refresh-button" onClick={start('off')}>TURN OFF</button>
          {status.unlocked.length > 0 && <button type="button" className="refresh-button" onClick={() => void profileLockRequest('lock').then(() => setMessage('Every agent is locked again in this browser.'))}>🔒 LOCK ALL AGAIN</button>}
        </> : <button type="button" className="primary-button" onClick={start('setup')}>Set up profile lock</button>}
      </div>}
      {mode === 'setup' && <LockForm kind="setup" agents={agents} status={status} onDone={finish('Profile lock is on.')} onCancel={() => setMode('idle')}/>}
      {mode === 'agents' && <LockForm kind="agents" agents={agents} status={status} onDone={finish('Locked agents saved.')} onCancel={() => setMode('idle')}/>}
      {mode === 'pin' && <LockForm kind="pin" agents={agents} status={status} onDone={finish('New PIN saved. Every unlocked agent is locked again.')} onCancel={() => setMode('idle')}/>}
      {mode === 'off' && <LockForm kind="off" agents={agents} status={status} onDone={finish('Profile lock is off. Every agent is visible.')} onCancel={() => setMode('idle')}/>}
      <p className="small-note">Lost the PIN? On the machine that runs OTCA, run <code>ruang profile-lock off</code>.</p>
    </>}
  </section>
}

function LockForm({ kind, agents, status, onDone, onCancel }: { kind: 'setup' | 'agents' | 'pin' | 'off'; agents: string[]; status: ProfileLockStatus; onDone: () => void; onCancel: () => void }) {
  const [chosen, setChosen] = useState<string[]>(kind === 'agents' ? status.agents : [])
  const [pin, setPin] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const choosing = kind === 'setup' || kind === 'agents'
  const newPin = kind === 'setup' || kind === 'pin'
  const toggle = (agent: string) => setChosen((list) => list.includes(agent) ? list.filter((item) => item !== agent) : [...list, agent])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const fresh = kind === 'setup' ? pin : next
    if (newPin && (fresh.length !== 6 || fresh !== repeat)) { setError(fresh.length !== 6 ? 'The PIN has 6 digits.' : 'The two PINs do not match.'); return }
    if (kind !== 'setup' && pin.length !== 6) { setError('Enter the current 6-digit PIN.'); return }
    if (kind === 'setup' && chosen.length === 0) { setError('Pick at least one agent to lock.'); return }
    setBusy(true)
    setError(undefined)
    const result = kind === 'setup' ? await profileLockRequest('setup', { pin, agents: chosen })
      : kind === 'agents' ? await profileLockRequest('update', { pin, agents: chosen })
        : kind === 'pin' ? await profileLockRequest('update', { pin, newPin: next })
          : await profileLockRequest('disable', { pin })
    setBusy(false)
    if (result.ok) onDone(); else { setError(result.message); setPin('') }
  }
  // Agents locked before but no longer listed (e.g. a removed profile) stay choosable.
  const list = [...new Set([...agents, ...status.agents])]
  return <form className="access-setup" onSubmit={submit}>
    {choosing && <fieldset className="lock-agents"><legend className="field-label">Agents to lock</legend>
      {list.length === 0 ? <p className="muted">No agents found.</p> : list.map((agent) => <label key={agent} className={`lock-agent${chosen.includes(agent) ? ' active' : ''}`}><input type="checkbox" checked={chosen.includes(agent)} onChange={() => toggle(agent)}/> {chosen.includes(agent) ? '🔒' : '🔓'} {agent}</label>)}
    </fieldset>}
    {kind === 'setup' ? <>
      <PinInput id="lock-new-pin" value={pin} onChange={setPin} label="New 6-digit PIN" autoFocus/>
      <PinInput id="lock-repeat-pin" value={repeat} onChange={setRepeat} label="Repeat the PIN"/>
      <p className="small-note">There is no PIN reset in the app. Remember it, or use <code>ruang profile-lock off</code> on the machine.</p>
    </> : <PinInput id="lock-current-pin" value={pin} onChange={setPin} label="Current PIN" autoFocus/>}
    {kind === 'pin' && <>
      <PinInput id="lock-next-pin" value={next} onChange={setNext} label="New 6-digit PIN"/>
      <PinInput id="lock-next-repeat" value={repeat} onChange={setRepeat} label="Repeat the new PIN"/>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="access-actions">
      <button type="submit" className={`primary-button${kind === 'off' ? ' danger' : ''}`} disabled={busy}>{busy ? 'Saving…' : kind === 'setup' ? 'Turn on profile lock' : kind === 'agents' ? 'Save locked agents' : kind === 'pin' ? 'Save new PIN' : 'Turn off profile lock'}</button>
      <button type="button" className="refresh-button" onClick={onCancel}>CANCEL</button>
    </div>
  </form>
}
