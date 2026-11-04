import { useState } from 'react'
import { officeRequest, type IntegrationMode, type OfficeIntegrations } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState } from '../ui.tsx'

const MODES: IntegrationMode[] = ['mock', 'sandbox', 'live']
const MODE_LABELS: Record<IntegrationMode, string> = { mock: 'Mock (data contoh)', sandbox: 'Sandbox (akun uji)', live: 'Live (akun asli)' }
const AUTH_LABELS = { oauth: 'OAuth / akun layanan', 'api-key': 'API key / token' }

type Service = OfficeIntegrations['services'][number]

/**
 * Every outside service with whether it is connected, how to connect it, and the mode each brand runs it in.
 * Credentials are filled in infra/env/ and only checked for presence here; they never pass through the browser.
 */
export function IntegrationsPanel() {
  const data = usePolling<OfficeIntegrations>('/api/office/integrations', 30_000)
  const [open, setOpen] = useState<string>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState<string>()
  const [checked, setChecked] = useState<{ service: string; text: string }>()
  if (data.status === 'pending') return <LoadingState message="Memuat integrasi..."/>
  if (data.status === 'failed') return <EmptyState title="Belum tersedia">Daftar integrasi belum bisa dibaca. {data.message}</EmptyState>

  const { services, brands } = data.data
  const connectedCount = services.filter((service) => service.connected).length
  const recheck = async (service: Service) => {
    setError(undefined)
    try {
      const fresh = (await officeRequest<OfficeIntegrations>('GET', '/integrations')).services.find((item) => item.service === service.service)
      setChecked({ service: service.service, text: fresh?.connected ? 'Kredensial lengkap.' : `Masih kosong: ${(fresh?.missing ?? service.missing).join(', ')}` })
      data.refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const setMode = async (service: Service, brandId: string, mode: IntegrationMode) => {
    setSaving(`${service.service}/${brandId}`); setError(undefined)
    try { await officeRequest('PUT', `/brands/${brandId}/integrations/${service.service}`, { mode }); data.refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(undefined) }
  }

  return <>
    <p className="small-note" role="status">{connectedCount} dari {services.length} layanan punya kredensial. Layanan tanpa kredensial selalu berjalan sebagai mock (FR-40). Kunci tidak diketik di halaman ini supaya tidak lewat browser: isi di file env, lalu klik Periksa ulang.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <ul className="integ-list">{services.map((service) => {
      const expanded = open === service.service
      return <li key={service.service} className="integ">
        <div className="integ-head">
          <div className="integ-title">
            <strong>{service.label}</strong>
            <span className="integ-chip">{AUTH_LABELS[service.auth]}</span>
            <span className="integ-chip">{service.level}</span>
          </div>
          <span className={`integ-status ${service.connected ? 'ok' : 'off'}`}>{service.connected ? (service.adapterReady ? 'Terhubung' : 'Kredensial siap') : 'Belum terhubung'}</span>
          <button type="button" className={service.connected ? 'refresh-button' : 'primary-button'} aria-expanded={expanded} aria-controls={`integ-${service.service}`} onClick={() => setOpen(expanded ? undefined : service.service)}>{service.connected ? 'Kelola' : 'Hubungkan'}</button>
        </div>
        <p className="integ-purpose">{service.purpose}{service.connected && !service.adapterReady ? ` Adapter live belum dibuat (${service.level}); sampai itu tetap berjalan sebagai mock.` : ''}</p>
        {expanded && <div className="integ-body" id={`integ-${service.service}`}>
          {!service.connected && <>
            <ol className="integ-steps">
              <li>{service.howTo}</li>
              <li>Buka <code>infra/env/{service.file}</code> (di luar git) dan isi: {service.vars.map((name) => <code key={name} className={service.missing.includes(name) ? 'missing' : 'filled'}>{name}</code>)}</li>
              <li>Simpan file, lalu klik <b>Periksa ulang</b>. Tidak perlu restart server.</li>
            </ol>
          </>}
          {service.connected && <p className="integ-ok">Semua variabel terisi: {service.vars.map((name) => <code key={name} className="filled">{name}</code>)}</p>}
          <div className="integ-actions">
            <button type="button" className="refresh-button" onClick={() => void recheck(service)}>Periksa ulang</button>
            {checked?.service === service.service && <span role="status" className="muted">{checked.text}</span>}
          </div>
          <fieldset className="integ-modes">
            <legend>Mode per brand</legend>
            {brands.map((brand) => {
              const mode = service.modes[brand.id]
              return <label key={brand.id}>
                <span>{brand.name}</span>
                <select value={mode.requested} disabled={saving === `${service.service}/${brand.id}`} onChange={(event) => void setMode(service, brand.id, event.target.value as IntegrationMode)} aria-label={`Mode ${service.label} untuk ${brand.name}`}>
                  {MODES.map((item) => <option key={item} value={item} disabled={item !== 'mock' && !service.connected}>{MODE_LABELS[item]}</option>)}
                </select>
                {mode.effective !== mode.requested && <small>berjalan sebagai {mode.effective}</small>}
              </label>
            })}
            {!service.connected && <small className="integ-note">Sandbox dan live terbuka setelah kredensial lengkap.</small>}
          </fieldset>
        </div>}
      </li>
    })}</ul>
  </>
}
