import { useRef, useState } from 'react'
import { formatDateTime } from '../format.ts'
import { AGENT_NAMES, officeRequest, type OfficeApproval } from '../office-api.ts'

export function ApprovalCard({ approval, onDecided }: { approval: OfficeApproval; onDecided: () => void | Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const submitting = useRef(false)
  const task = approval.task
  const decide = async (decision: 'approved' | 'rejected') => {
    if(submitting.current || !task?.result || (decision==='rejected' && !note.trim())) return
    submitting.current=true
    setBusy(true)
    setError(undefined)
    try {
      await officeRequest('POST', `/brands/${approval.brandId}/approvals/${approval.id}`, { decision, note })
      await onDecided()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      submitting.current=false
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
    {approval.usage && <p className="small-note">Biaya AI: {approval.usage.source === 'codex' ? 'Codex, langganan ChatGPT Plus (tanpa biaya per token)' : `Claude via LiteLLM (${approval.usage.model})`} · {approval.usage.runs} run · {(approval.usage.inputTokens + approval.usage.outputTokens).toLocaleString('id-ID')} token ({approval.usage.inputTokens.toLocaleString('id-ID')} masuk, {approval.usage.outputTokens.toLocaleString('id-ID')} keluar){approval.usage.durationMs !== null ? ` · ${(approval.usage.durationMs / 1000).toFixed(1)} dtk` : ''}</p>}
    {approval.qc && <details className="office-qc"><summary>QC teks · {approval.qc.checks.filter(c=>c.status==='warning').length} peringatan · pemeriksaan manusia tetap diperlukan</summary><p>Hanya penyaringan teks otomatis. Fakta, izin, visual, dan tautan belum diverifikasi.</p><ul>{approval.qc.checks.map((check,i)=><li key={i}><strong>{check.status==='manual' ? 'Periksa manual' : check.status==='warning' ? 'Peringatan' : 'Cek teks lolos'}: {check.label}</strong><small>{check.note}</small></li>)}</ul></details>}
    <div className="office-result">{task?.result ?? '(hasil tidak tersedia)'}</div>
    <label className="office-field">
      <span>Catatan (wajib bila ditolak; dikirim ke agen sebagai revisi)</span>
      <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: tambahkan angle tentang beasiswa, hapus klaim jumlah siswa"/>
    </label>
    {error && <p className="text-bad" role="alert">{error}</p>}
    <div className="office-actions">
      <button type="button" className="primary-button" disabled={busy || !task?.result} onClick={() => void decide('approved')}>Setujui</button>
      <button type="button" className="primary-button danger" disabled={busy || !task?.result || !note.trim()} onClick={() => void decide('rejected')}>Tolak &amp; minta revisi</button>
      <small>Masuk {formatDateTime(approval.createdAt)}</small>
    </div>
  </article>
}
