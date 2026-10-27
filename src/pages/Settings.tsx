import { useEffect, useState, type FormEvent } from 'react'
import { accessRequest, downloadCode, generateCode, type AccessStatus } from '../access.ts'
import { formatDateTime } from '../format.ts'
import { PageTitle } from '../ui.tsx'
import { ProfileLockSettings } from './ProfileLockSettings.tsx'

type Mode = 'idle' | 'set' | 'off'

function CodeField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (value: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return <><label className="field-label" htmlFor={id}>{label}</label>
    <div className="code-input-row"><input id={id} className="text-input" type={show ? 'text' : 'password'} autoComplete={autoComplete} spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} /><button type="button" className="refresh-button" onClick={() => setShow(!show)} aria-pressed={show} aria-label={`${show ? 'Hide' : 'Show'} ${label.toLowerCase()}`}>{show ? 'HIDE' : 'SHOW'}</button></div></>
}

/** Turn the access code on, or replace it: a generated code (default) or a custom one. */
function CodeSetup({ status, onDone, onCancel }: { status: AccessStatus; onDone: (status: AccessStatus) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'generated' | 'custom'>('generated')
  const [generated, setGenerated] = useState(() => generateCode())
  const [custom, setCustom] = useState('')
  const [confirm, setConfirm] = useState('')
  const [current, setCurrent] = useState('')
  const [saved, setSaved] = useState(false)
  const [remember, setRemember] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const code = kind === 'generated' ? generated : custom.trim()
  const customProblem = kind === 'custom' && (code.length < status.minLength ? `Use at least ${status.minLength} characters.` : custom !== confirm ? 'The two codes do not match.' : undefined)
  const changeCode = (next: () => void) => { next(); setSaved(false); setCopied(false) }

  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true) } catch { setError('Copy is not available here. Download the code instead.') }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (customProblem) { setError(customProblem); return }
    if (status.enabled && !current.trim()) { setError('Enter the current access code.'); return }
    setBusy(true)
    setError(undefined)
    const result = await accessRequest('code', { code, remember, ...(status.enabled ? { currentCode: current } : {}) })
    setBusy(false)
    if (result.ok) onDone(result.status); else setError(result.message)
  }

  return <form className="access-setup" onSubmit={submit}>
    <fieldset className="segmented"><legend className="field-label">Code</legend>
      <label className={kind === 'generated' ? 'active' : ''}><input type="radio" name="code-kind" checked={kind === 'generated'} onChange={() => changeCode(() => setKind('generated'))} /> Generate</label>
      <label className={kind === 'custom' ? 'active' : ''}><input type="radio" name="code-kind" checked={kind === 'custom'} onChange={() => changeCode(() => setKind('custom'))} /> Custom</label>
    </fieldset>
    {kind === 'generated'
      ? <div className="generated-code"><code aria-label="Generated access code">{generated}</code><button type="button" className="refresh-button" onClick={() => changeCode(() => setGenerated(generateCode()))}>↻ ANOTHER</button></div>
      : <><CodeField id="custom-code" label="New access code" value={custom} onChange={(value) => changeCode(() => setCustom(value))} autoComplete="new-password" />
        <CodeField id="confirm-code" label="Repeat the new code" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <p className="small-note">At least {status.minLength} characters. Spaces at the start and end are ignored.</p></>}
    <p className="muted">Ruang has no password reset, so keep a copy of the code. It is only shown here, while you set it.</p>
    <div className="access-actions">
      <button type="button" className="refresh-button" onClick={() => downloadCode(code)} disabled={Boolean(customProblem) || !code}>⬇ DOWNLOAD .TXT</button>
      <button type="button" className="refresh-button" onClick={() => void copy()} disabled={Boolean(customProblem) || !code}>{copied ? '✓ COPIED' : 'COPY'}</button>
    </div>
    {status.enabled && <CodeField id="current-code" label="Current access code" value={current} onChange={setCurrent} autoComplete="current-password" />}
    <label className="check-label"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> I have saved this code (downloaded or copied)</label>
    <label className="check-label"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember this device for {status.rememberDays} days</label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="access-actions">
      <button type="submit" className="primary-button" disabled={!saved || busy}>{busy ? 'Saving…' : status.enabled ? 'Save new code' : 'Turn on access code'}</button>
      <button type="button" className="refresh-button" onClick={onCancel}>CANCEL</button>
    </div>
  </form>
}

function TurnOff({ onDone, onCancel }: { onDone: (status: AccessStatus) => void; onCancel: () => void }) {
  const [current, setCurrent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!current.trim()) { setError('Enter the current access code.'); return }
    setBusy(true)
    const result = await accessRequest('disable', { currentCode: current })
    setBusy(false)
    if (result.ok) onDone(result.status); else setError(result.message)
  }
  return <form className="access-setup" onSubmit={submit}>
    <p className="muted">Anyone who can open this address will see Ruang without a code.</p>
    <CodeField id="disable-code" label="Current access code" value={current} onChange={setCurrent} autoComplete="current-password" />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="access-actions"><button type="submit" className="primary-button danger" disabled={busy}>{busy ? 'Turning off…' : 'Turn off access code'}</button><button type="button" className="refresh-button" onClick={onCancel}>CANCEL</button></div>
  </form>
}

function ClaudeSettings() {
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-5-5')
  const [hasKey, setHasKey] = useState(false)
  const [keyMasked, setKeyMasked] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/claude/config')
      .then((res) => res.json())
      .then((data) => {
        setHasKey(Boolean(data.hasKey))
        if (data.defaultModel) setModel(data.defaultModel)
        if (data.keyMasked) setKeyMasked(data.keyMasked)
      })
      .catch(() => { })
  }, [])

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setStatusMsg('')
    try {
      const res = await fetch('/api/claude/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          defaultModel: model
        })
      })
      const data = await res.json()
      if (data.success) {
        setStatusMsg('Pengaturan Claude berhasil disimpan!')
        setHasKey(true)
        if (apiKey.trim()) {
          setKeyMasked(`${apiKey.trim().slice(0, 7)}...${apiKey.trim().slice(-4)}`)
          setApiKey('')
        }
      }
    } catch (err: any) {
      setStatusMsg(`Gagal menyimpan: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="card settings-card" aria-labelledby="claude-title">
      <div className="settings-head">
        <div>
          <p className="eyebrow">INTEGRASI AI</p>
          <h2 id="claude-title">Anthropic Claude API</h2>
        </div>
        <span className={`badge ${hasKey ? 'good' : 'warn'}`}>
          {hasKey ? 'Terhubung' : 'Belum Ada Key'}
        </span>
      </div>
      <p className="muted">
        AI Office ini ditenagai langsung oleh model Claude (CEO Orchestrator, Marketing & Sales, Researcher, dan Creator Video Editor).
      </p>

      <form onSubmit={handleSave} style={{ display: 'grid', gap: '14px', marginTop: '16px' }}>
        <div>
          <label className="field-label" htmlFor="claude-key">
            Anthropic API Key {hasKey && <span style={{ color: 'var(--accent)' }}>({keyMasked})</span>}
          </label>
          <input
            id="claude-key"
            className="text-input"
            type="password"
            placeholder={hasKey ? 'Masukkan key baru untuk mengganti...' : 'sk-ant-api03-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
          <p className="small-note">Dapatkan API key dari <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>console.anthropic.com</a>.</p>
        </div>

        <div>
          <label className="field-label" htmlFor="claude-model">Pilihan Model Default</label>
          <select
            id="claude-model"
            className="text-input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{ width: '100%', maxWidth: '400px' }}
          >
            <option value="claude-sonnet-5-5">Claude 5.5 Sonnet (Terbaik & Direkomendasikan)</option>
            <option value="claude-haiku-5-5">Claude 5.5 Haiku (Paling Cepat & Hemat Token)</option>
            <option value="claude-opus-5-5">Claude 5.5 Opus (Penalaran Kompleks)</option>
          </select>
        </div>

        {statusMsg && <p className="form-success">{statusMsg}</p>}

        <div>
          <button type="submit" className="primary-button" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Pengaturan Claude'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function Settings({ access, onAccessChange }: { access: AccessStatus | undefined; onAccessChange: (status: AccessStatus) => void }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [message, setMessage] = useState<string>()
  const done = (text: string) => (status: AccessStatus) => { setMode('idle'); setMessage(text); onAccessChange(status) }
  const lock = async () => {
    const result = await accessRequest('lock')
    if (result.ok) onAccessChange(result.status)
  }
  return <><PageTitle eyebrow="RUANG" title="Settings">Settings of this Ruang server and Claude AI engine.</PageTitle>
    <ClaudeSettings />
    <section className="card settings-card" aria-labelledby="access-title">
      <div className="settings-head"><div><p className="eyebrow">SECURITY</p><h2 id="access-title">Access code</h2></div>{access && <span className={`badge ${access.enabled ? 'good' : 'muted'}`}>{access.enabled ? 'On' : 'Off'}</span>}</div>
      <p className="muted">Ask for a code every time Ruang is opened in a browser. Like an API key: you generate (or choose) it once, download it, and enter it when asked. Only a hash is stored on the server.</p>
      {!access ? <p className="muted">Loading…</p> : <>
        {access.enabled && access.since && <p className="small-note">Set {formatDateTime(access.since)}.</p>}
        {message && mode === 'idle' && <p className="form-success" role="status">{message}</p>}
        {mode === 'idle' && <div className="access-actions">
          {access.enabled
            ? <><button type="button" className="primary-button" onClick={() => { setMessage(undefined); setMode('set') }}>Change code</button><button type="button" className="refresh-button" onClick={() => { setMessage(undefined); setMode('off') }}>TURN OFF</button><button type="button" className="refresh-button" onClick={() => void lock()}>LOCK THIS BROWSER</button></>
            : <button type="button" className="primary-button" onClick={() => { setMessage(undefined); setMode('set') }}>Set up access code</button>}
        </div>}
        {mode === 'set' && <CodeSetup status={access} onDone={done(access.enabled ? 'New access code saved. Other browsers have been signed out.' : 'Access code is on. Other browsers now need the code.')} onCancel={() => setMode('idle')} />}
        {mode === 'off' && <TurnOff onDone={done('Access code is off.')} onCancel={() => setMode('idle')} />}
        <p className="small-note">Lost the code? On the machine that runs Ruang, run <code>ruang access-code off</code> (or <code>ruang access-code new</code> for a new random code).</p>
      </>}
    </section>
    <ProfileLockSettings />
  </>
}
