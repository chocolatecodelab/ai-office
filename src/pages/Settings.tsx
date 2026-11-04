import { useState, type FormEvent } from 'react'
import { IntegrationsPanel } from '../components/IntegrationsPanel.tsx'
import { accessRequest, downloadCode, generateCode, type AccessStatus } from '../access.ts'
import { formatDateTime } from '../format.ts'
import { formatCost } from '../usage.ts'
import { type OfficeSettingsView } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'
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

const ALERT_TEXT: Record<OfficeSettingsView['pools'][number]['alert'], string> = { ok: 'Aman', '50': 'Sudah 50%', '80': 'Sudah 80%', over: 'Melewati budget' }

/** Office setup as blueprint describes it: access and roles, integration modes, LiteLLM pools, and gateways. Read only. */
function OfficeSetup() {
  const setup = usePolling<OfficeSettingsView>('/api/office/settings', 60_000)
  if (setup.status === 'pending') return <section className="card settings-card"><LoadingState message="Memuat pengaturan kantor..."/></section>
  if (setup.status === 'failed') return <section className="card settings-card"><EmptyState title="Belum tersedia">Pengaturan kantor belum bisa dibaca. {setup.message}</EmptyState></section>
  const { access, roles, pools, gateways, langfuse } = setup.data
  return <>
    <section className="card settings-card" aria-labelledby="office-access">
      <div className="settings-head"><div><p className="eyebrow">AKSES</p><h2 id="office-access">Akses dan peran</h2></div><span className="badge muted">{access.sso ? 'SSO aktif' : 'Belum SSO'}</span></div>
      <p className="muted">{access.note}</p>
      <p className="small-note">Aktor saat ini: {access.actor}</p>
      <ul className="role-list">{roles.map((role) => <li key={role.id}><strong>{role.label}</strong>{role.note && <span className="muted"> · {role.note}</span>}</li>)}</ul>
    </section>
    <section className="card settings-card" aria-labelledby="office-integrations">
      <div className="settings-head"><div><p className="eyebrow">INTEGRASI</p><h2 id="office-integrations">Integrasi</h2></div></div>
      <IntegrationsPanel/>
    </section>
    <section className="card settings-card" aria-labelledby="office-pools">
      <div className="settings-head"><div><p className="eyebrow">BUDGET</p><h2 id="office-pools">Pool LiteLLM</h2></div></div>
      <p className="small-note">Pemakaian 30 hari dari LiteLLM. Budget hanya diubah di LiteLLM, tidak dari halaman ini.</p>
      <ul className="role-list">{pools.map((pool) => <li key={pool.id}>
        <strong>{pool.label}</strong> <span className="muted">· {pool.models.join(', ')}</span>
        <div><progress max={pool.budgetUsd} value={Math.min(pool.spentUsd, pool.budgetUsd)}/> {formatCost(pool.spentUsd)} dari {formatCost(pool.budgetUsd)} · <span className={`badge ${pool.alert === 'ok' ? 'muted' : pool.alert === 'over' ? 'danger' : 'good'}`}>{ALERT_TEXT[pool.alert]}</span></div>
      </li>)}</ul>
    </section>
    <section className="card settings-card" aria-labelledby="office-gateways">
      <div className="settings-head"><div><p className="eyebrow">GATEWAY</p><h2 id="office-gateways">Hermes dan Langfuse</h2></div></div>
      <ul className="role-list">{gateways.map((gateway) => <li key={gateway.brandId}><strong>Hermes · {gateway.name}</strong> <span className={`badge ${gateway.configured ? 'good' : 'muted'}`}>{gateway.configured ? 'Terhubung' : 'Belum'}</span></li>)}
        <li><strong>Langfuse</strong> <span className={`badge ${langfuse.configured ? 'good' : 'muted'}`}>{langfuse.configured ? 'Terhubung' : 'Belum'}</span></li></ul>
    </section>
  </>
}

export function Settings({ access, onAccessChange }: { access: AccessStatus | undefined; onAccessChange: (status: AccessStatus) => void }) {
  const [mode, setMode] = useState<Mode>('idle')
  const [message, setMessage] = useState<string>()
  const done = (text: string) => (status: AccessStatus) => { setMode('idle'); setMessage(text); onAccessChange(status) }
  const lock = async () => {
    const result = await accessRequest('lock')
    if (result.ok) onAccessChange(result.status)
  }
  return <><PageTitle eyebrow="RUANG" title="Settings">Pengaturan kantor: akses, integrasi, budget, dan gateway. Rahasia tidak diisi dari halaman ini; kunci API tetap di infra/env.</PageTitle>
    <OfficeSetup />
    <section className="card settings-card" aria-labelledby="access-title">
      <div className="settings-head"><div><p className="eyebrow">SECURITY</p><h2 id="access-title">Kunci akses sementara</h2></div>{access && <span className={`badge ${access.enabled ? 'good' : 'muted'}`}>{access.enabled ? 'On' : 'Off'}</span>}</div>
      <p className="small-note">Sementara. Diganti login Google SSO dan RBAC di L4.</p>
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
