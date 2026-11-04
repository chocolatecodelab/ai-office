import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { formatDateTime } from '../format.ts'
import { officeRequest, type AgentNote, type NoteKind } from '../office-api.ts'

const LIMITS = { title: 120, body: 2000 }
const KIND_LABELS: Record<NoteKind, string> = { rule: 'Aturan', memory: 'Memori' }
const KIND_HINTS: Record<NoteKind, string> = {
  rule: 'Instruksi yang harus diikuti agent, misalnya gaya bahasa atau hal yang dihindari.',
  memory: 'Fakta atau pelajaran yang perlu diingat, misalnya pilihan klien atau alasan revisi.',
}

interface Draft { id?: string; kind: NoteKind; title: string; body: string; shared: boolean }
const blank: Draft = { kind: 'rule', title: '', body: '', shared: false }

/**
 * Rules and memory people add for one agent of one brand, on top of the official context (which is read only).
 * Brand-wide notes (shared with every agent of the brand) are listed too and say so. Changes reach the agent on its
 * next task; nothing needs a restart.
 */
export function AgentNotes({ brandId, agentType, agentName }: { brandId: string; agentType: string; agentName: string }) {
  const base = `/brands/${encodeURIComponent(brandId)}/notes`
  const [notes, setNotes] = useState<AgentNote[]>()
  const [draft, setDraft] = useState<Draft>()
  const [confirming, setConfirming] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const failure = (cause: unknown) => cause instanceof Error ? cause.message : String(cause)

  const load = useCallback(async () => {
    try { setNotes(await officeRequest<AgentNote[]>('GET', base)) } catch (cause) { setError(failure(cause)) }
  }, [base])
  useEffect(() => { setNotes(undefined); setDraft(undefined); setConfirming(undefined); setError(undefined); void load() }, [load, agentType])

  const mine = (notes ?? []).filter((note) => note.agentType === null || note.agentType === agentType)
  const sorted = [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(undefined)
    try { await work(); await load(); return true } catch (cause) { setError(failure(cause)); return false } finally { setBusy(false) }
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const payload = { kind: draft.kind, title: draft.title, body: draft.body, agentType: draft.shared ? null : agentType }
    const done = await run(() => draft.id ? officeRequest('PUT', `${base}/${draft.id}`, payload) : officeRequest('POST', base, payload))
    if (done) setDraft(undefined)
  }
  const toggle = (note: AgentNote) => run(() => officeRequest('PUT', `${base}/${note.id}`, { active: !note.active }))
  const remove = async (note: AgentNote) => { if (await run(() => officeRequest('DELETE', `${base}/${note.id}`))) setConfirming(undefined) }

  return <section className="notes" aria-label="Memori dan aturan tambahan">
    <div className="notes-head">
      <div>
        <h3>Aturan dan memori tim</h3>
        <p>Catatan ini dimuat ke {agentName} pada tugas berikutnya. Konteks resmi di bawah tetap menang: catatan tidak bisa melewati approval, publikasi, iklan, atau budget.</p>
      </div>
      {!draft && <button type="button" className="notes-add" onClick={() => { setDraft(blank); setError(undefined) }}>Tambah catatan</button>}
    </div>

    {draft && <form className="notes-form" onSubmit={(event) => void save(event)} aria-label={draft.id ? 'Ubah catatan' : 'Catatan baru'}>
      <fieldset className="notes-kind">
        <legend>Jenis</legend>
        {(Object.keys(KIND_LABELS) as NoteKind[]).map((kind) => <label key={kind}><input type="radio" name="note-kind" checked={draft.kind === kind} onChange={() => setDraft({ ...draft, kind })}/> {KIND_LABELS[kind]}</label>)}
        <small>{KIND_HINTS[draft.kind]}</small>
      </fieldset>
      <label className="notes-field">Judul
        <input type="text" value={draft.title} maxLength={LIMITS.title} required autoFocus onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={draft.kind === 'rule' ? 'Contoh: Sapaan pembuka' : 'Contoh: Preferensi klien'}/>
      </label>
      <label className="notes-field">Isi
        <textarea value={draft.body} maxLength={LIMITS.body} required rows={5} onChange={(event) => setDraft({ ...draft, body: event.target.value })}/>
        <small>{draft.body.length} / {LIMITS.body}</small>
      </label>
      <label className="notes-check"><input type="checkbox" checked={draft.shared} onChange={(event) => setDraft({ ...draft, shared: event.target.checked })}/> Berlaku untuk semua agent di brand ini, bukan hanya {agentName}</label>
      <div className="notes-actions">
        <button type="submit" className="primary-button" disabled={busy || !draft.title.trim() || !draft.body.trim()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        <button type="button" disabled={busy} onClick={() => { setDraft(undefined); setError(undefined) }}>Batal</button>
      </div>
    </form>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {!notes && !error && <p className="muted">Memuat catatan…</p>}
    {notes && mine.length === 0 && !draft && <p className="notes-empty">Belum ada catatan. Tambahkan aturan (misalnya &ldquo;selalu tulis harga dalam rupiah&rdquo;) atau memori (misalnya &ldquo;klien memilih akhir pekan&rdquo;).</p>}

    <ul className="notes-list">
      {sorted.map((note) => <li key={note.id} className={note.active ? undefined : 'off'}>
        <div className="notes-row-head">
          <span className={`notes-badge notes-${note.kind}`}>{KIND_LABELS[note.kind]}</span>
          {note.agentType === null && <span className="notes-badge notes-shared" title="Dimuat oleh semua agent di brand ini">Semua agent</span>}
          {!note.active && <span className="notes-badge notes-off">Nonaktif</span>}
          <strong>{note.title}</strong>
        </div>
        <p className="notes-body">{note.body}</p>
        <div className="notes-row-foot">
          <small>Diubah {formatDateTime(note.updatedAt)} oleh {note.updatedBy}</small>
          <span className="notes-row-actions">
            {confirming === note.id
              ? <><span role="alert">Hapus catatan ini?</span><button type="button" className="notes-danger" disabled={busy} onClick={() => void remove(note)}>Ya, hapus</button><button type="button" onClick={() => setConfirming(undefined)}>Batal</button></>
              : <>
                <button type="button" disabled={busy} onClick={() => { setDraft({ id: note.id, kind: note.kind, title: note.title, body: note.body, shared: note.agentType === null }); setError(undefined) }} aria-label={`Ubah ${note.title}`}>Ubah</button>
                <button type="button" disabled={busy} aria-pressed={note.active} onClick={() => void toggle(note)} aria-label={`${note.active ? 'Nonaktifkan' : 'Aktifkan'} ${note.title}`}>{note.active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                <button type="button" disabled={busy} onClick={() => setConfirming(note.id)} aria-label={`Hapus ${note.title}`}>Hapus</button>
              </>}
          </span>
        </div>
      </li>)}
    </ul>
  </section>
}
