import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { OfficeStation } from '../types.ts'
import { PixelCharacter } from '../pages/Office.tsx'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  toolCalls?: Array<{ name: string; args: any; result?: any }>
}

interface AgentChatProps {
  station: OfficeStation
  onStationUpdated?: () => void
  onSwitchTab?: (tab: 'Chat' | 'Overview' | 'Folder' | 'Memory') => void
}

export function AgentChat({ station, onStationUpdated, onSwitchTab }: AgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [claudeProConnected, setClaudeProConnected] = useState(false)
  const [workspacePath, setWorkspacePath] = useState('')
  const [inputKey, setInputKey] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [isMeeting, setIsMeeting] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importText, setImportText] = useState('')
  const [importLoading, setImportLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Check Claude config & load history
  useEffect(() => {
    let active = true

    fetch('/api/claude/config')
      .then((res) => res.json())
      .then((data) => {
        if (active) {
          setHasKey(Boolean(data.hasKey))
          setClaudeProConnected(Boolean(data.claudeProConnected))
        }
      })
      .catch(() => {
        if (active) {
          setHasKey(false)
          setClaudeProConnected(false)
        }
      })

    fetch(`/api/agents/${station.id}/workspace`)
      .then((res) => res.json())
      .then((data) => {
        if (active && data.workspacePath) setWorkspacePath(data.workspacePath)
      })
      .catch(() => {})

    fetch(`/api/chat/${station.id}/history`)
      .then((res) => res.json())
      .then((data) => {
        if (active && Array.isArray(data.messages)) {
          setMessages(data.messages)
        }
      })
      .catch(() => {})

    return () => { active = false }
  }, [station.id])

  const handleImportConversation = async () => {
    if (!importText.trim()) return
    setImportLoading(true)
    try {
      let parsedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
      try {
        const json = JSON.parse(importText)
        if (Array.isArray(json)) {
          parsedMessages = json.map((item: any) => ({
            role: item.role === 'assistant' || item.sender === 'assistant' ? 'assistant' : 'user',
            content: item.content || item.text || JSON.stringify(item)
          }))
        } else if (json.chat_messages && Array.isArray(json.chat_messages)) {
          parsedMessages = json.chat_messages.map((m: any) => ({
            role: m.sender === 'human' ? 'user' : 'assistant',
            content: m.text || ''
          }))
        }
      } catch {
        parsedMessages = [
          {
            role: 'user',
            content: `[Riwayat Percakapan Claude.ai Diimpor]:\n\n${importText}`
          },
          {
            role: 'assistant',
            content: `Saya telah menyerap seluruh konteks riwayat percakapan yang Anda impor. Saya siap melanjutkan diskusi dan tugas sebagai ${station.role}!`
          }
        ]
      }

      const res = await fetch(`/api/chat/${station.id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: parsedMessages })
      })
      if (res.ok) {
        setShowImportModal(false)
        setImportText('')
        const hRes = await fetch(`/api/chat/${station.id}/history`)
        const hData = await hRes.json()
        if (Array.isArray(hData.messages)) setMessages(hData.messages)
        onStationUpdated?.()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setImportLoading(false)
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingText])

  const handleSaveKey = async (e: FormEvent) => {
    e.preventDefault()
    if (!inputKey.trim()) return
    setKeySaving(true)
    try {
      const res = await fetch('/api/claude/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: inputKey.trim() })
      })
      if (res.ok) {
        setHasKey(true)
        setInputKey('')
      }
    } catch (err) {
      console.error(err)
    } finally {
      setKeySaving(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm(`Hapus seluruh riwayat obrolan dengan ${station.name}?`)) return
    try {
      await fetch(`/api/chat/${station.id}/history`, { method: 'DELETE' })
      setMessages([])
    } catch (err) {
      console.error(err)
    }
  }

  const handleToggleMeeting = async () => {
    const next = !isMeeting
    setIsMeeting(next)
    try {
      await fetch('/api/team/meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: next, agenda: next ? 'Koordinasi Proyek Bersama CEO' : '' })
      })
      if (onStationUpdated) onStationUpdated()
    } catch (err) {
      console.error(err)
    }
  }

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim()
    if (!text || loading) return

    setInput('')
    setLoading(true)
    setStreamingText('')

    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    }
    setMessages((prev) => [...prev, tempUserMsg])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: station.id, message: text })
      })

      if (!response.ok || !response.body) {
        throw new Error('Gagal terhubung ke Claude API.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let streamAcc = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'chunk') {
                streamAcc += data.text
                setStreamingText(streamAcc)
              } else if (data.type === 'done') {
                setStreamingText('')
                setMessages((prev) => [
                  ...prev,
                  {
                    id: `resp-${Date.now()}`,
                    role: 'assistant',
                    content: data.response || streamAcc,
                    timestamp: new Date().toISOString(),
                    toolCalls: data.toolResults
                  }
                ])
                if (onStationUpdated) onStationUpdated()
              } else if (data.type === 'error') {
                throw new Error(data.error)
              }
            } catch (err) {
              // json parse or stream error
            }
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Error: ${err.message || 'Terjadi kesalahan saat menghubungi Claude.'}`,
          timestamp: new Date().toISOString()
        }
      ])
    } finally {
      setLoading(false)
      setStreamingText('')
      if (onStationUpdated) onStationUpdated()
    }
  }

  const quickPrompts: Record<string, string[]> = {
    ceo: [
      'Tolong koordinasikan tim untuk proyek kampanye pemasaran produk baru.',
      'Panggil seluruh tim untuk rapat evaluasi strategi di ruang meeting.',
      'Buatkan pembagian tugas untuk seluruh tim sesuai keahlian masing-masing.'
    ],
    marketing: [
      'Buatkan strategi positioning dan Unique Selling Proposition (USP) produk.',
      'Tuliskan 3 alternatif headline copy iklan yang menarik klik.',
      'Bagaimana susunan sales funnel terbaik untuk produk ini?'
    ],
    researcher: [
      'Riset tren minat konsumen terhadap layanan berbasis AI tahun ini.',
      'Analisis apa saja kelebihan dan kekurangan kompetitor utama.',
      'Buatkan ringkasan data riset dalam bentuk poin-poin terstruktur.'
    ],
    creator: [
      'Buatkan konsep video TikTok/Reels 30 detik dengan hook viral 3 detik pertama.',
      'Susun naskah video lengkap dengan arahan visual, audio, dan voiceover.',
      'Berikan panduan editing footage agar transisi terasa dinamis dan engaging.'
    ]
  }

  // Agents registered from a claude.ai Project have no tailored prompts.
  const agentPrompts = quickPrompts[station.id] || [
    'Apa saja yang bisa kamu kerjakan sesuai peranmu?',
    'Buatkan rencana kerja minggu ini untuk Project ini.',
    'Ringkas aturan kerja dan knowledge yang kamu pegang.'
  ]

  return (
    <div className="agent-chat-container">
      {/* Minimal API Key Bar only if not connected to Pro and no key */}
      {hasKey === false && !claudeProConnected && (
        <div className="chat-key-minimal">
          <span>🔑 Anthropic Key:</span>
          <form className="key-minimal-form" onSubmit={handleSaveKey}>
            <input
              type="password"
              placeholder="sk-ant-api03-..."
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              required
            />
            <button type="submit" disabled={keySaving}>
              {keySaving ? '...' : 'Simpan'}
            </button>
          </form>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="import-modal-overlay">
          <div className="import-modal-box">
            <div className="import-modal-header">
              <h4>📥 Hubungkan Riwayat Chat Claude ke {station.name}</h4>
              <button type="button" className="close-btn" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <p className="import-modal-desc">
              Tempelkan teks riwayat obrolan Anda dari <strong>claude.ai</strong> atau data JSON export (<code>conversations.json</code>) untuk memasukkannya ke memori karakter ini:
            </p>
            <textarea
              className="import-modal-textarea"
              rows={6}
              placeholder="Tempel teks diskusi, skrip, atau riset claude.ai di sini..."
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            <div className="import-modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setShowImportModal(false)}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn-confirm"
                onClick={handleImportConversation}
                disabled={importLoading || !importText.trim()}
              >
                {importLoading ? 'Menyimpan...' : 'Simpan ke Memori Karakter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Bar (Professional Tools & Workspace Link) */}
      <div className="chat-action-bar">
        <div className="agent-role-pill">
          <span className="dot dot-active" />
          <span className="agent-role-name">{station.role}</span>
          <span className="model-tag">
            {claudeProConnected ? 'Claude 5.5 Pro' : 'Claude 5.5 Sonnet'}
          </span>
          {workspacePath && (
            <button
              type="button"
              className="workspace-chip-btn"
              onClick={() => onSwitchTab?.('Folder')}
              title={`Workspace: ${workspacePath}. Klik untuk membuka tab Folder.`}
            >
              📁 {workspacePath.split(/[\\/]/).pop()}
            </button>
          )}
        </div>
        <div className="chat-controls">
          <button
            type="button"
            className="chat-nav-btn"
            onClick={() => onSwitchTab?.('Folder')}
            title="Buka dan kelola file proyek di tab Folder"
          >
            📁 Folder
          </button>
          <button
            type="button"
            className="chat-nav-btn"
            onClick={() => onSwitchTab?.('Memory')}
            title="Kelola aturan CLAUDE.md dan catatan memori agen"
          >
            📝 Memori & Rules
          </button>
          <button
            type="button"
            className="chat-nav-btn"
            onClick={() => setShowImportModal(true)}
            title="Impor riwayat obrolan dari Claude.ai"
          >
            📥 Impor Chat
          </button>
          {station.id === 'ceo' && (
            <button
              type="button"
              className={`meeting-btn ${isMeeting ? 'meeting-active' : ''}`}
              onClick={handleToggleMeeting}
              title={isMeeting ? 'Akhiri Rapat Tim' : 'Panggil Seluruh Tim ke Ruang Rapat'}
            >
              {isMeeting ? '🚪 Akhiri Rapat' : '👥 Rapat Tim'}
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              className="clear-chat-btn"
              onClick={handleClear}
              title="Hapus riwayat obrolan"
            >
              Bersihkan
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="chat-messages-area">
        {messages.length === 0 && !streamingText && (
          <div className="chat-empty-hint">
            <div className="empty-avatar-circle">
              <PixelCharacter agent={station.id} />
            </div>
            <h3>Halo! Saya {station.name}.</h3>
            <p>{station.activity || 'Saya siap membantu tugas Anda. Pilih rekomendasi perintah di bawah atau ketik langsung pesan Anda.'}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble-row ${msg.role === 'user' ? 'user-row' : 'agent-row'}`}>
            {msg.role === 'assistant' && (
              <div className="agent-msg-avatar">
                <PixelCharacter agent={station.id} />
              </div>
            )}
            <div className={`chat-bubble ${msg.role === 'user' ? 'user-bubble' : 'agent-bubble'}`}>
              <div className="bubble-header">
                <span className="bubble-author">{msg.role === 'user' ? 'Anda' : station.name}</span>
                <span className="bubble-time">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="bubble-content" style={{ whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </div>

              {/* Tool Calls Execution Cards */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="tool-calls-container">
                  {msg.toolCalls.map((tc, idx) => (
                    <div key={idx} className="tool-card">
                      <div className="tool-card-title">
                        {tc.name === 'delegate_task' && '📋 Delegasi Tugas Selesai'}
                        {tc.name === 'call_team_meeting' && '👥 Rapat Tim Dimulai'}
                        {tc.name === 'end_team_meeting' && '🚪 Rapat Tim Diakhiri'}
                      </div>
                      <div className="tool-card-body">
                        {tc.name === 'delegate_task' && (
                          <p>
                            <strong>{tc.args.task_title}</strong> → Ditugaskan ke: <code>{tc.args.target_agent}</code>
                          </p>
                        )}
                        {tc.name === 'call_team_meeting' && (
                          <p>Agenda: {tc.args.agenda}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Live Streaming Bubble */}
        {streamingText && (
          <div className="chat-bubble-row agent-row">
            <div className="agent-msg-avatar">
              <PixelCharacter agent={station.id} />
            </div>
            <div className="chat-bubble agent-bubble streaming-bubble">
              <div className="bubble-header">
                <span className="bubble-author">{station.name}</span>
                <span className="bubble-status">Mengetik...</span>
              </div>
              <div className="bubble-content" style={{ whiteSpace: 'pre-wrap' }}>
                {streamingText}
              </div>
            </div>
          </div>
        )}

        {loading && !streamingText && (
          <div className="chat-bubble-row agent-row">
            <div className="agent-msg-avatar">
              <PixelCharacter agent={station.id} />
            </div>
            <div className="chat-bubble agent-bubble loading-bubble">
              <span className="typing-indicator">
                <span /><span /><span />
              </span>
              <em>{station.name} sedang berpikir...</em>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts Chips */}
      <div className="chat-quick-prompts">
        {agentPrompts.map((promptText, i) => (
          <button
            key={i}
            type="button"
            className="prompt-chip"
            onClick={() => handleSend(promptText)}
            disabled={loading}
          >
            {promptText}
          </button>
        ))}
      </div>

      {/* Input Form */}
      <form
        className="chat-input-bar"
        onSubmit={(e) => {
          e.preventDefault()
          handleSend()
        }}
      >
        <textarea
          rows={1}
          placeholder={`Kirim pesan ke ${station.name}... (Enter untuk kirim, Shift+Enter untuk baris baru)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          disabled={loading}
        />
        <button type="submit" className="chat-send-btn" disabled={loading || !input.trim()}>
          {loading ? '...' : 'Kirim ➔'}
        </button>
      </form>
    </div>
  )
}
