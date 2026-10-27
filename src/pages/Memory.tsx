import { useState } from 'react'
import { formatDateTime, formatNumber } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { AgentMemory, MemoryDocument, MemorySnapshot } from '../types.ts'
import { EmptyState, LoadingState, PageTitle, SourceStatus, Unavailable } from '../ui.tsx'
import { PixelCharacter } from './Office.tsx'
import { PrivateGate, ProfileUnlock } from '../ProfileLock.tsx'

function DocumentBody({ document, empty }: { document?: MemoryDocument; empty: string }) {
  if (!document || !document.exists) return <p className="muted">{empty}</p>
  if (document.error) return <p className="file-notice locked">{document.error}</p>
  return <>
    <p className="doc-meta">{formatNumber(document.chars ?? 0)} chars · updated {formatDateTime(document.modified)}{document.redactions ? ` · ${document.redactions} line(s) redacted` : ''}{document.truncated ? ' · showing first 256 KB' : ''}</p>
    <pre className="task-text doc-text">{document.content || <span className="muted">(empty file)</span>}</pre>
  </>
}

function ClaudeAgentMemoryPanel({ agent, onOpenFolders }: { agent: AgentMemory; onOpenFolders?: () => void }) {
  const [workspace, setWorkspace] = useState(agent.workspacePath || agent.path)
  const [editingWorkspace, setEditingWorkspace] = useState(false)
  const [workspaceInput, setWorkspaceInput] = useState(agent.workspacePath || agent.path)
  const [workspaceSaving, setWorkspaceSaving] = useState(false)
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null)

  const [rules, setRules] = useState(agent.claudeRules?.content || '')
  const [rulesSaving, setRulesSaving] = useState(false)
  const [rulesFeedback, setRulesFeedback] = useState<string | null>(null)

  const [notes, setNotes] = useState<string[]>(agent.notes || agent.memory?.entries || [])
  const [newNote, setNewNote] = useState('')
  const [notesSaving, setNotesSaving] = useState(false)

  const [contextFiles, setContextFiles] = useState(agent.contextFiles || [])
  const [openContext, setOpenContext] = useState<string | undefined>()
  const [pickingFiles, setPickingFiles] = useState(false)
  const [workspaceFiles, setWorkspaceFiles] = useState<Array<{ name: string; path: string; isDir: boolean }>>([])

  const handleSaveWorkspace = async (targetPath: string) => {
    setWorkspaceSaving(true)
    setWorkspaceFeedback(null)
    try {
      const res = await fetch(`/api/agents/${agent.profile}/workspace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath })
      })
      const data = await res.json()
      if (data.success) {
        setWorkspace(data.path)
        setWorkspaceInput(data.path)
        setEditingWorkspace(false)
        setWorkspaceFeedback(`✓ Terhubung: ${data.path}`)
        setTimeout(() => setWorkspaceFeedback(null), 3000)
      } else {
        setWorkspaceFeedback(data.error || 'Gagal mengubah folder.')
      }
    } catch {
      setWorkspaceFeedback('Gagal menghubungi server.')
    } finally {
      setWorkspaceSaving(false)
    }
  }

  const handleSaveRules = async () => {
    setRulesSaving(true)
    setRulesFeedback(null)
    try {
      const res = await fetch(`/api/agents/${agent.profile}/memory/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules })
      })
      const data = await res.json()
      if (data.success) {
        setRulesFeedback('✓ Pedoman CLAUDE.md berhasil disimpan!')
        setTimeout(() => setRulesFeedback(null), 3000)
      }
    } catch {
      setRulesFeedback('Gagal menyimpan aturan.')
    } finally {
      setRulesSaving(false)
    }
  }

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNote.trim()) return
    setNotesSaving(true)
    try {
      const res = await fetch(`/api/agents/${agent.profile}/memory/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote.trim() })
      })
      const data = await res.json()
      if (Array.isArray(data.notes)) {
        setNotes(data.notes)
        setNewNote('')
      }
    } finally {
      setNotesSaving(false)
    }
  }

  const handleDeleteNote = async (index: number) => {
    try {
      const res = await fetch(`/api/agents/${agent.profile}/memory/notes/${index}`, { method: 'DELETE' })
      const data = await res.json()
      if (Array.isArray(data.notes)) setNotes(data.notes)
    } catch {}
  }

  const handleTogglePicker = async () => {
    const next = !pickingFiles
    setPickingFiles(next)
    if (next) {
      try {
        const res = await fetch(`/api/agents/${agent.profile}/workspace`)
        const data = await res.json()
        if (Array.isArray(data.files)) {
          setWorkspaceFiles(data.files.filter((f: any) => !f.isDir))
        }
      } catch {}
    }
  }

  const handleAddContextFile = async (filePath: string) => {
    try {
      const res = await fetch(`/api/agents/${agent.profile}/memory/context-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      })
      const data = await res.json()
      if (Array.isArray(data.contextFiles)) {
        setContextFiles(data.contextFiles)
        setPickingFiles(false)
      }
    } catch {}
  }

  const handleRemoveContextFile = async (filePath: string) => {
    try {
      const res = await fetch(`/api/agents/${agent.profile}/memory/context-files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
      })
      const data = await res.json()
      if (Array.isArray(data.contextFiles)) setContextFiles(data.contextFiles)
    } catch {}
  }

  return (
    <div className="claude-memory-container">
      {/* Workspace Connection Header */}
      <div className="memory-workspace-bar">
        <div className="workspace-info">
          <span className="ws-label">WORKSPACE FOLDER</span>
          <code className="ws-path">{workspace}</code>
          {workspaceFeedback && <span className="ws-feedback">{workspaceFeedback}</span>}
        </div>
        <div className="workspace-actions">
          <button
            type="button"
            className="btn-ws-toggle"
            onClick={() => setEditingWorkspace(!editingWorkspace)}
          >
            {editingWorkspace ? 'Tutup Pengaturan' : '⚙️ Hubungkan / Ganti Folder'}
          </button>
          {onOpenFolders && (
            <button type="button" className="refresh-button" onClick={onOpenFolders}>
              JELAJAHI FILE WORKSPACE →
            </button>
          )}
        </div>
      </div>

      {/* Inline Workspace Editor */}
      {editingWorkspace && (
        <div className="workspace-editor-box">
          <p className="ws-editor-desc">
            Masukkan direktori lokal komputer yang akan dikelola oleh agen <strong>{agent.label}</strong>:
          </p>
          <div className="ws-input-row">
            <input
              type="text"
              className="ws-input"
              value={workspaceInput}
              onChange={(e) => setWorkspaceInput(e.target.value)}
              placeholder="Contoh: D:\KERJAAN\CODING\CLAUDE\VIDEO_EDITOR"
            />
            <button
              type="button"
              className="btn-ws-save"
              onClick={() => handleSaveWorkspace(workspaceInput)}
              disabled={workspaceSaving || !workspaceInput.trim()}
            >
              {workspaceSaving ? 'Memverifikasi...' : 'Simpan & Hubungkan'}
            </button>
          </div>
          <div className="ws-presets-row">
            <span className="preset-label">Pilihan Cepat:</span>
            <button
              type="button"
              className="preset-chip"
              onClick={() => handleSaveWorkspace('d:\\KERJAAN\\CODING\\CLAUDE\\VIDEO_EDITOR')}
            >
              📁 VIDEO_EDITOR (Video & Remotion)
            </button>
            <button
              type="button"
              className="preset-chip"
              onClick={() => handleSaveWorkspace('d:\\KERJAAN\\CODING\\CLAUDE\\AI_OFFICE')}
            >
              🏢 AI_OFFICE (Kantor Virtual)
            </button>
          </div>
        </div>
      )}

      {/* Grid: Rules, Notes, Context Documents */}
      <div className="memory-editor-grid">
        {/* Card 1: CLAUDE.md Rules */}
        <article className="card memory-card memory-rules-card">
          <header className="memory-card-head">
            <div>
              <p className="eyebrow">PEDOMAN AGENT (CLAUDE.MD)</p>
              <h2>Rules & Instruksi Kerja</h2>
            </div>
            <button
              type="button"
              className="btn-save-rules"
              onClick={handleSaveRules}
              disabled={rulesSaving}
            >
              {rulesSaving ? 'Menyimpan...' : 'Simpan CLAUDE.md'}
            </button>
          </header>
          {rulesFeedback && <div className="feedback-banner">{rulesFeedback}</div>}
          <p className="card-note">
            Aturan khusus, tone bicara, standar teknis, atau batasan kerja yang selalu ditaati agen setiap berdiskusi.
          </p>
          <textarea
            className="rules-textarea"
            rows={10}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
            placeholder="# Masukkan pedoman kerja, framework, dan aturan formatting di sini..."
          />
        </article>

        {/* Card 2: Memory Notes (MEMORY.md) */}
        <article className="card memory-card memory-notes-card">
          <header className="memory-card-head">
            <div>
              <p className="eyebrow">MEMORI PERMANEN (MEMORY.MD)</p>
              <h2>Catatan & Preferensi</h2>
            </div>
            <span className="badge muted">{notes.length} Catatan</span>
          </header>
          <p className="card-note">
            Informasi permanen yang diingat agen antar sesi (misal: gaya video favorit, link referensi, KPI).
          </p>

          <form className="add-note-form" onSubmit={handleAddNote}>
            <input
              type="text"
              placeholder="+ Tambah catatan memori baru..."
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              disabled={notesSaving}
            />
            <button type="submit" disabled={notesSaving || !newNote.trim()}>
              Tambah
            </button>
          </form>

          <div className="notes-list-scroll">
            {notes.length === 0 ? (
              <p className="muted">Belum ada catatan memori tersimpan.</p>
            ) : (
              <ol className="memory-notes-list">
                {notes.map((entry, idx) => (
                  <li key={idx} className="memory-note-item">
                    <span className="note-text">{entry}</span>
                    <button
                      type="button"
                      className="note-delete-btn"
                      onClick={() => handleDeleteNote(idx)}
                      title="Hapus catatan ini"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </article>
      </div>

      {/* Card 3: Context Files Attached to Agent */}
      <article className="card memory-context-card">
        <header className="memory-card-head">
          <div>
            <p className="eyebrow">DOKUMEN WORKSPACE AKTIF</p>
            <h2>Context Documents Terkoneksi</h2>
          </div>
          <button
            type="button"
            className="btn-add-context"
            onClick={handleTogglePicker}
          >
            {pickingFiles ? 'Tutup Pilihan' : '+ Tambah Dokumen dari Workspace'}
          </button>
        </header>

        {pickingFiles && (
          <div className="context-picker-panel">
            <h4>Pilih File dari Workspace: <code>{workspace}</code></h4>
            {workspaceFiles.length === 0 ? (
              <p className="muted">Tidak ada file teks di folder utama ini.</p>
            ) : (
              <div className="picker-files-grid">
                {workspaceFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    className="picker-file-chip"
                    onClick={() => handleAddContextFile(file.path)}
                  >
                    📄 {file.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {contextFiles.length === 0 ? (
          <p className="muted">
            Belum ada dokumen konteks yang disematkan. Klik tombol di atas untuk memilih file dokumen proyek dari workspace.
          </p>
        ) : (
          <ul className="context-list">
            {contextFiles.map((document) => (
              <li key={document.path} className="context-item-row">
                <button
                  type="button"
                  className="file-row"
                  aria-expanded={openContext === document.path}
                  onClick={() => setOpenContext(openContext === document.path ? undefined : document.path)}
                >
                  <span className="file-icon" aria-hidden="true">📄</span>
                  <span className="file-name">{document.name}</span>
                  <span className="file-size">{formatNumber(document.chars ?? document.size ?? 0)} chars</span>
                </button>
                <button
                  type="button"
                  className="btn-remove-context"
                  onClick={() => handleRemoveContextFile(document.path)}
                  title="Lepaskan dokumen dari konteks memori agen"
                >
                  ✕ Lepas
                </button>
                {openContext === document.path && <DocumentBody document={document} empty="" />}
              </li>
            ))}
          </ul>
        )}
      </article>

      {/* Card 4: Agent Identity */}
      <article className="card memory-soul">
        <header className="memory-card-head">
          <div>
            <p className="eyebrow">IDENTITY.MD · SYSTEM PROMPT</p>
            <h2>Profil & Peran Dasar Agen</h2>
          </div>
        </header>
        <DocumentBody document={agent.soul} empty="Tidak ada system prompt yang terdaftar." />
      </article>
    </div>
  )
}

function AgentPanel({ agent, onOpenFolders }: { agent: AgentMemory; onOpenFolders?: () => void }) {
  if (!agent.available) return <EmptyState title="Not available">{agent.reason ?? 'This agent folder is not available.'}</EmptyState>
  return <ClaudeAgentMemoryPanel agent={agent} onOpenFolders={onOpenFolders} />
}

/** One agent's memory (SOUL.md, MEMORY.md, USER.md, context files), for the Office agent dialog. */
export function AgentMemoryView({ profile }: { profile: string }) {
  const snapshot = usePolling<MemorySnapshot>('/api/memory', 30_000)
  const agent = snapshot.status === 'ready' ? snapshot.data.agents.find((item) => item.profile === profile) : undefined
  if (snapshot.status === 'pending') return <LoadingState message="Reading agent memory..." />
  if (snapshot.status === 'failed') return <EmptyState title="Not Available">{snapshot.message ?? 'Memory could not be read.'}</EmptyState>
  if (!agent) return <EmptyState title="Not available">No memory was found for this agent.</EmptyState>
  return <PrivateGate agent={agent.profile} compact>{agent.locked ? <ProfileUnlock agent={agent.profile} compact /> : <AgentPanel key={agent.profile} agent={agent} />}</PrivateGate>
}

export function Memory({ onOpenFolders }: { onOpenFolders?: () => void }) {
  const snapshot = usePolling<MemorySnapshot>('/api/memory', 30_000)
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const [selected, setSelected] = useState<string | undefined>()
  const agents = data?.agents ?? []
  const agent = agents.find((item) => item.profile === selected) ?? agents.find((item) => item.available) ?? agents[0]
  const source = data ? { availability: 'available' as const, data: null } : undefined
  return <>
    <PageTitle eyebrow="MEMORY & CONTEXT" title="Agent Memory">
      Memori permanen, pedoman CLAUDE.md, dan dokumen konteks workspace yang dibawa setiap agen Claude ke dalam sesi kerjanya.
    </PageTitle>
    <SourceStatus source={source} fetchedAt={data?.fetchedAt} request={snapshot} />
    <Unavailable source={source} request={snapshot} />
    {snapshot.status === 'pending' ? <LoadingState message="Reading agent memory..." /> : agent && <>
      <div className="memory-tabs" role="tablist" aria-label="Agents">{agents.map((item) => (
        <button key={item.profile} role="tab" aria-selected={item.profile === agent.profile} className={`memory-tab${item.profile === agent.profile ? ' active' : ''}`} onClick={() => setSelected(item.profile)} disabled={!item.available && !item.locked}>
          <span className="folder-glyph small" aria-hidden="true"><PixelCharacter agent={item.profile} /></span>
          <span><strong>{item.locked ? '🔒 ' : ''}{item.label}</strong><small>{item.workspacePath?.split(/[\\/]/).pop() || item.profile}</small></span>
        </button>
      ))}</div>
      <PrivateGate agent={agent.profile}>{agent.locked ? <ProfileUnlock agent={agent.profile} /> : <AgentPanel key={agent.profile} agent={agent} onOpenFolders={onOpenFolders} />}</PrivateGate>
    </>}
  </>
}
