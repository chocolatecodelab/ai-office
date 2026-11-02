import { useCallback, useEffect, useState } from 'react'
import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, officeRequest, useOfficeLive, type OfficeApproval, type OfficeBrand } from '../office-api.ts'
import { EmptyState, PageTitle } from '../ui.tsx'

// The Approval box (FR-20–FR-22): every result waits here for the person the approval matrix names.
// Rejecting needs a note, which goes back to the agent as its revision brief.

function ApprovalCard({ approval, onDecided }: { approval: OfficeApproval; onDecided: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const task = approval.task
  const decide = async (decision: 'approved' | 'rejected') => {
    setBusy(true)
    setError(undefined)
    try {
      await officeRequest('POST', `/brands/${approval.brandId}/approvals/${approval.id}`, { decision, note })
      onDecided()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }
  return <article className="card approval-card">
    <div className="approval-head">
      <div>
        <p className="eyebrow">{approval.approvalType.toUpperCase()} · {AGENT_NAMES[task?.agentType ?? ''] ?? task?.agentType}</p>
        <h2>{task?.title ?? approval.taskId}</h2>
      </div>
      <span className="badge unknown">Approver: {approval.approver}</span>
    </div>
    <div className="office-result">{task?.result ?? '(hasil tidak tersedia)'}</div>
    <label className="office-field">
      <span>Catatan (wajib bila ditolak; dikirim ke agen sebagai revisi)</span>
      <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: tambahkan angle tentang beasiswa, hapus klaim jumlah siswa"/>
    </label>
    {error && <p className="text-bad" role="alert">{error}</p>}
    <div className="office-actions">
      <button type="button" className="primary-button" disabled={busy} onClick={() => void decide('approved')}>Setujui</button>
      <button type="button" className="primary-button danger" disabled={busy || !note.trim()} onClick={() => void decide('rejected')}>Tolak &amp; minta revisi</button>
      <small>Masuk {formatDateTime(approval.createdAt)}</small>
    </div>
  </article>
}

export function Approvals() {
  const [brands, setBrands] = useState<OfficeBrand[]>([])
  const [brand, setBrand] = useState('otca')
  const [approvals, setApprovals] = useState<OfficeApproval[]>()
  const [error, setError] = useState<string>()

  const load = useCallback(async () => {
    try {
      const [brandList, open] = await Promise.all([
        officeRequest<OfficeBrand[]>('GET', '/brands'),
        officeRequest<OfficeApproval[]>('GET', `/brands/${brand}/approvals?open=1`),
      ])
      setBrands(brandList)
      setApprovals(open)
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [brand])

  useEffect(() => { void load() }, [load])
  useOfficeLive(brand, () => { void load() })

  return <>
    <PageTitle eyebrow="APPROVAL" title="Kotak Approval">Hasil kerja agen menunggu keputusan manusia sesuai matriks approval. Tidak ada yang dipublikasikan atau dipakai sebelum disetujui.</PageTitle>
    <div className="chip-row office-brands" role="tablist" aria-label="Brand">
      {brands.map((item) => <button key={item.id} type="button" role="tab" aria-selected={brand === item.id} className={`chip chip-button${brand === item.id ? ' active' : ''}`} onClick={() => setBrand(item.id)}>
        <span className="brand-swatch" style={{ background: item.color }}/>{item.name}
      </button>)}
    </div>
    {error && <section className="notice" role="alert"><strong>Office API belum siap.</strong> {error}</section>}
    {approvals && approvals.length === 0 && <EmptyState title="Tidak ada yang menunggu">Semua hasil kerja brand ini sudah diputuskan.</EmptyState>}
    <div className="approval-list">{approvals?.map((approval) => <ApprovalCard key={approval.id} approval={approval} onDecided={() => void load()}/>)}</div>
  </>
}
