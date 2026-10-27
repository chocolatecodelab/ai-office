import { useEffect, useRef, useState, type FormEvent } from 'react'
import { accessRequest, type AccessStatus } from './access.ts'

/** Shown instead of the app while an access code is set and this browser has no session. */
export function LockScreen({ status, onUnlocked }: { status: AccessStatus; onUnlocked: (status: AccessStatus) => void }) {
  const [code, setCode] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { document.title = 'Locked · Ruang'; input.current?.focus() }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!code.trim()) { setError('Enter the access code.'); return }
    setBusy(true)
    setError(undefined)
    const result = await accessRequest('unlock', { code, remember })
    setBusy(false)
    if (result.ok) { onUnlocked(result.status); return }
    setError(result.message)
    input.current?.select()
  }

  return <main className="lock-screen">
    <form className="lock-card" onSubmit={submit} aria-labelledby="lock-title">
      <p className="brand">RUANG<span>CLAUDE 3D</span></p>
      <h1 id="lock-title">Enter access code</h1>
      <p className="muted">This Ruang is protected with an access code.</p>
      <label className="field-label" htmlFor="access-code">Access code</label>
      <div className="code-input-row">
        <input ref={input} id="access-code" className="text-input" type={show ? 'text' : 'password'} autoComplete="current-password" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'lock-error' : undefined}/>
        <button type="button" className="refresh-button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'HIDE' : 'SHOW'}</button>
      </div>
      <label className="check-label"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)}/> Remember this device for {status.rememberDays} days</label>
      {error && <p id="lock-error" className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
      <p className="small-note">Lost the code? On the machine that runs Ruang, run <code>ruang access-code off</code>.</p>
    </form>
  </main>
}
