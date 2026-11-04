import { useEffect, useState } from 'react'
import { officeRequest, type IntegrationMode, type OfficeIntegrations } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState } from '../ui.tsx'

const MODE_LABELS: Record<IntegrationMode, string> = { mock: 'Mock (data contoh)', sandbox: 'Sandbox (akun uji)', live: 'Live (akun asli)' }
const AUTH_LABELS = { oauth: 'Satu klik (OAuth)', 'api-key': 'API key / token' }
const OUTCOMES: Record<string, { ok: boolean; text: string }> = {
  'drive-ok': { ok: true, text: 'Google Drive berhasil dihubungkan.' },
  'error-denied': { ok: false, text: 'Izin dibatalkan di halaman Google, jadi akun belum terhubung.' },
  'error-state': { ok: false, text: 'Permintaan koneksi sudah kedaluwarsa atau tidak dikenal. Klik Hubungkan lagi.' },
  'error-exchange': { ok: false, text: 'Google menolak pertukaran kode. Periksa client ID, secret, dan alamat callback, lalu coba lagi.' },
  'error-config': { ok: false, text: 'Konfigurasi OAuth belum lengkap. Lihat langkah di kartu layanan.' },
}

type Service = OfficeIntegrations['services'][number]
const fail = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

/** The result of coming back from the provider's consent page, read once from ?oauth= and then removed from the address. */
function useOAuthOutcome() {
  const [outcome] = useState(() => {
    try {
      const key = new URLSearchParams(window.location.search).get('oauth')
      if (key) window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`)
      return key ? OUTCOMES[key] : undefined
    } catch { return undefined }
  })
  return outcome
}

/**
 * Every outside service with whether it is connected, how to connect it, and the mode each brand runs it in.
 * Services with one-click sign-in connect per brand here; the others take a key in infra/env/, only checked for presence.
 * Secrets never pass through the browser.
 */
export function IntegrationsPanel() {
  const data = usePolling<OfficeIntegrations>('/api/office/integrations', 30_000)
  const outcome = useOAuthOutcome()
  const [open, setOpen] = useState<string | undefined>(() => outcome ? 'drive' : undefined)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [confirming, setConfirming] = useState<string>()
  useEffect(() => { if (outcome) data.refresh() }, [outcome]) // eslint-disable-line react-hooks/exhaustive-deps
  if (data.status === 'pending') return <LoadingState message="Memuat integrasi..."/>
  if (data.status === 'failed') return <EmptyState title="Belum tersedia">Daftar integrasi belum bisa dibaca. {data.message}</EmptyState>

  const { services, brands, redirectUri, encryptionReady } = data.data
  const connectedCount = services.filter((service) => service.oneClick ? brands.some((brand) => service.modes[brand.id].account?.status === 'active') : service.connected).length
  const note = (key: string, text: string) => setNotes((current) => ({ ...current, [key]: text }))
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key); setError(undefined)
    try { await work() } catch (cause) { setError(fail(cause)) } finally { setBusy(undefined) }
  }
  const recheck = (service: Service) => run(`check/${service.service}`, async () => {
    const fresh = (await officeRequest<OfficeIntegrations>('GET', '/integrations')).services.find((item) => item.service === service.service)
    note(service.service, fresh?.connected ? 'Kredensial lengkap.' : `Masih kosong: ${(fresh?.missing ?? service.missing).join(', ')}`)
    data.refresh()
  })
  const setMode = (service: Service, brandId: string, mode: IntegrationMode) => run(`mode/${service.service}/${brandId}`, async () => {
    await officeRequest('PUT', `/brands/${brandId}/integrations/${service.service}`, { mode }); data.refresh()
  })
  const connect = (service: Service, brandId: string) => run(`connect/${service.service}/${brandId}`, async () => {
    const { url } = await officeRequest<{ url: string }>('POST', `/brands/${brandId}/integrations/${service.service}/connect`)
    window.location.assign(url)
  })
  const disconnect = (service: Service, brandId: string) => run(`disconnect/${service.service}/${brandId}`, async () => {
    await officeRequest('DELETE', `/brands/${brandId}/integrations/${service.service}/connect`)
    setConfirming(undefined); note(`${service.service}/${brandId}`, 'Akun diputus dan aksesnya dicabut di Google.'); data.refresh()
  })
  const test = (service: Service, brandId: string) => run(`test/${service.service}/${brandId}`, async () => {
    const result = await officeRequest<{ account: string; visibleFiles: number }>('POST', `/brands/${brandId}/integrations/${service.service}/test`)
    note(`${service.service}/${brandId}`, `Koneksi bekerja: ${result.account} dapat membaca Drive.`)
  })
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); note('copied', 'Tersalin.') } catch { note('copied', 'Salin manual.') } }

  const statusOf = (service: Service): { label: string; tone: 'ok' | 'ready' | 'off' } => {
    if (service.oneClick) {
      const active = brands.filter((brand) => service.modes[brand.id].account?.status === 'active').length
      if (active) return { label: `Terhubung · ${active} brand`, tone: 'ok' }
      return service.connected ? { label: 'Siap dihubungkan', tone: 'ready' } : { label: 'Belum terhubung', tone: 'off' }
    }
    return service.connected ? { label: service.adapterReady ? 'Terhubung' : 'Kredensial siap', tone: 'ok' } : { label: 'Belum terhubung', tone: 'off' }
  }

  return <>
    {outcome && <p className={outcome.ok ? 'form-success' : 'form-error'} role={outcome.ok ? 'status' : 'alert'}>{outcome.text}</p>}
    <p className="small-note" role="status">{connectedCount} dari {services.length} layanan terhubung. Layanan yang belum terhubung selalu berjalan sebagai mock (FR-40). Token tersimpan terenkripsi di server, tidak pernah di browser atau agent.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <ul className="integ-list">{services.map((service) => {
      const expanded = open === service.service
      const status = statusOf(service)
      return <li key={service.service} className="integ">
        <div className="integ-head">
          <div className="integ-title">
            <strong>{service.label}</strong>
            <span className="integ-chip">{AUTH_LABELS[service.oneClick ? 'oauth' : 'api-key']}</span>
            <span className="integ-chip">{service.level}</span>
          </div>
          <span className={`integ-status ${status.tone}`}>{status.label}</span>
          <button type="button" className={status.tone === 'off' || status.tone === 'ready' ? 'primary-button' : 'refresh-button'} aria-expanded={expanded} aria-controls={`integ-${service.service}`} onClick={() => setOpen(expanded ? undefined : service.service)}>{status.tone === 'ok' ? 'Kelola' : 'Hubungkan'}</button>
        </div>
        <p className="integ-purpose">{service.purpose}{service.connected && !service.adapterReady && !service.oneClick ? ` Adapter live belum dibuat (${service.level}); sampai itu tetap berjalan sebagai mock.` : ''}</p>
        {expanded && <div className="integ-body" id={`integ-${service.service}`}>
          {!service.connected && <ol className="integ-steps">
            <li>{service.howTo}</li>
            {service.oneClick && <li>Alamat callback yang didaftarkan: {redirectUri ? <><code>{redirectUri}</code> <button type="button" className="integ-copy" onClick={() => void copy(redirectUri)}>Salin</button>{notes.copied && <small> {notes.copied}</small>}</> : <>belum bisa ditentukan; isi <code>RUANG_PUBLIC_URL</code> di <code>infra/env/{service.file}</code>.</>}</li>}
            <li>Buka <code>infra/env/{service.file}</code> (di luar git) dan isi: {service.vars.map((name) => <code key={name} className={service.missing.includes(name) ? 'missing' : 'filled'}>{name}</code>)}</li>
            <li>Simpan file, lalu klik <b>Periksa ulang</b>. Tidak perlu restart server.{service.oneClick ? ' Setelah itu tombol Hubungkan muncul untuk tiap brand.' : ''}</li>
          </ol>}
          {service.connected && !service.oneClick && <p className="integ-ok">Semua variabel terisi: {service.vars.map((name) => <code key={name} className="filled">{name}</code>)}</p>}
          {service.connected && service.oneClick && !encryptionReady && <p className="form-error" role="alert">Kunci enkripsi token belum ada. Jalankan <code>node scripts/setup-env.mjs</code>, lalu Periksa ulang.</p>}
          {service.connected && service.oneClick && encryptionReady && <p className="integ-ok">OAuth siap. Hubungkan akun untuk tiap brand; izin hanya baca.</p>}
          <div className="integ-actions">
            <button type="button" className="refresh-button" disabled={busy === `check/${service.service}`} onClick={() => void recheck(service)}>Periksa ulang</button>
            {notes[service.service] && <span role="status" className="muted">{notes[service.service]}</span>}
          </div>
          <fieldset className="integ-modes">
            <legend>{service.oneClick ? 'Akun dan mode per brand' : 'Mode per brand'}</legend>
            {brands.map((brand) => {
              const mode = service.modes[brand.id]
              const account = mode.account
              const key = `${service.service}/${brand.id}`
              const ready = service.oneClick ? account?.status === 'active' : service.connected
              return <div className="integ-brand" key={brand.id}>
                <span className="integ-brand-name">{brand.name}</span>
                {service.oneClick && <div className="integ-account">
                  {account ? <span className={account.status === 'active' ? 'integ-ok-text' : 'integ-warn-text'}>{account.status === 'active' ? `Terhubung · ${account.email}` : `Perlu dihubungkan ulang · ${account.email}`}</span> : <span className="muted">Belum terhubung</span>}
                  <span className="integ-account-actions">
                    {confirming === key
                      ? <><span role="alert">Putuskan akun ini?</span><button type="button" className="notes-danger" disabled={Boolean(busy)} onClick={() => void disconnect(service, brand.id)}>Ya, putuskan</button><button type="button" onClick={() => setConfirming(undefined)}>Batal</button></>
                      : <>
                        <button type="button" className={account?.status === 'active' ? 'refresh-button' : 'primary-button'} disabled={!service.connected || !encryptionReady || Boolean(busy)} onClick={() => void connect(service, brand.id)}>{account ? 'Hubungkan ulang' : 'Hubungkan'}</button>
                        {account?.status === 'active' && <button type="button" className="refresh-button" disabled={Boolean(busy)} onClick={() => void test(service, brand.id)}>Uji koneksi</button>}
                        {account && <button type="button" className="refresh-button" disabled={Boolean(busy)} onClick={() => setConfirming(key)}>Putuskan</button>}
                      </>}
                  </span>
                  {notes[key] && <small role="status">{notes[key]}</small>}
                </div>}
                <label>
                  <span className="integ-mode-label">Mode</span>
                  <select value={mode.requested} disabled={busy === `mode/${key}`} onChange={(event) => void setMode(service, brand.id, event.target.value as IntegrationMode)} aria-label={`Mode ${service.label} untuk ${brand.name}`}>
                    {service.modeOptions.map((item) => <option key={item} value={item} disabled={item !== 'mock' && !ready}>{MODE_LABELS[item]}</option>)}
                  </select>
                  {mode.effective !== mode.requested && <small>berjalan sebagai {mode.effective}</small>}
                </label>
              </div>
            })}
            {!service.connected && <small className="integ-note">Live terbuka setelah akun terhubung.</small>}
          </fieldset>
        </div>}
      </li>
    })}</ul>
  </>
}
