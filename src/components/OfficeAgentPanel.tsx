import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, TASK_STATUS_LABELS, officeRequest, useOfficeLive, type OfficeAgent, type OfficeBrand, type OfficeTask, type OfficeApproval } from '../office-api.ts'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import { AgentNotes } from './AgentNotes.tsx'
import { OfficeTaskForm } from './OfficeTaskForm.tsx'
import { downloadText, sizeLabel } from '../download.ts'
import { PixelCharacter } from '../pages/OfficeDetails.tsx'

const TABS = ['Chat', 'Tugas', 'Approval', 'Folder', 'Memori & Rules'] as const
type Tab = typeof TABS[number]
interface ContextFile { path: string; content: string }
interface Asset { id: string; kind: string; version: number; content: string }

export function OfficeAgentPanel({ brand, agent, onClose }: { brand: OfficeBrand; agent: OfficeAgent; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const [tab,setTab] = useState<Tab>('Chat')
  const [tasks,setTasks] = useState<OfficeTask[]>([])
  const [approvals,setApprovals] = useState<OfficeApproval[]>([])
  const [context,setContext] = useState<ContextFile[]>([])
  const [assets,setAssets] = useState<Asset[]>([])
  const [input,setInput] = useState('')
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [ready,setReady] = useState(false)
  const [importing,setImporting] = useState(false)
  const [openFile,setOpenFile] = useState<string>()
  const assetGeneration=useRef(0)
  const actionLock=useRef(false)
  const active = useRef(true)
  const generation = useRef(0)
  const base = `/brands/${encodeURIComponent(brand.id)}`
  const agentBase = `${base}/agents/${encodeURIComponent(agent.agentType)}`
  const name = AGENT_NAMES[agent.agentType] ?? agent.agentType
  const reload = useCallback(async () => {
    const request = ++generation.current
    try {
      const [all, reviews] = await Promise.all([officeRequest<OfficeTask[]>('GET',`${base}/tasks`),officeRequest<OfficeApproval[]>('GET',`${base}/approvals?open=1`)])
      if (!active.current || request !== generation.current) return
      setTasks(all.filter(t => t.agentType === agent.agentType))
      setApprovals(reviews.filter(a => a.task?.agentType === agent.agentType))
      setReady(true)
    } catch(e) { if (active.current) setError(String(e)) }
  },[base,agent.agentType])
  useOfficeLive(brand.id,() => void reload())
  useEffect(() => {
    active.current = true
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    void reload()
    const timer=setInterval(() => { if (!document.hidden) void reload() },5000)
    return () => { active.current=false; clearInterval(timer); previous?.focus() }
  },[reload])
  const latestReply = tasks.filter(t => t.kind === 'konten.chat').map(t => `${t.id}:${t.status}:${t.result?.length ?? 0}`).join('|')
  useEffect(() => { if (tab === 'Chat') end.current?.scrollIntoView?.({block:'nearest'}) },[latestReply,tab])
  useEffect(() => {
    if (tab !== 'Memori & Rules') return
    let valid=true
    officeRequest<ContextFile[]>('GET',`${agentBase}/context`).then(data => { if(valid) setContext(data) }).catch(e => { if(valid) setError(String(e)) })
    return () => {valid=false}
  },[tab,agentBase])
  const perform = async (work: () => Promise<unknown>) => {
    if(actionLock.current) return
    actionLock.current=true
    setBusy(true); setError('')
    try { await work(); if(active.current) await reload() } catch(e) { if(active.current) { setError(String(e)); await reload() } }
    finally { actionLock.current=false; if(active.current) setBusy(false) }
  }
  const send = () => {
    const message=input.trim()
    if (!message || busy || pending || !ready) return
    void perform(async () => { await officeRequest('POST',`${agentBase}/chat`,{message}); if(active.current) setInput('') })
  }
  const chats=tasks.filter(t => t.kind === 'konten.chat').slice().reverse()
  const pending=chats.some(t => ['queued','running','waiting_quota','revision'].includes(t.status))
  const exportChat = () => {
    const data=chats.flatMap(t => [{role:'user',content:t.brief,timestamp:t.createdAt},...(t.result ? [{role:'assistant',content:t.result,timestamp:t.updatedAt}] : [])])
    const url=URL.createObjectURL(new Blob([JSON.stringify({brand:brand.id,agent:agent.agentType,messages:data},null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download=`chat-${brand.id}-${agent.agentType}.json`;link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <dialog ref={dialog} aria-label={`${name} · ${brand.name}`} className="office-agent-panel" onCancel={onClose} onClick={e => { if(e.target===e.currentTarget) onClose() }}>
    <header className="office-panel-heading"><PixelCharacter agent={`${brand.id}/${agent.agentType}`}/><div><small>{brand.name}</small><h2>{name}</h2><span>{AGENT_STATUS_LABELS[agent.status]}</span></div><button autoFocus onClick={onClose} aria-label="Tutup panel agent">✕</button></header>
    <nav className="office-panel-tabs" aria-label="Detail agent">{TABS.map(t => <button key={t} aria-pressed={tab===t} onClick={() => setTab(t)}>{t}{t==='Approval' && approvals.length>0 ? ` (${approvals.length})` : ''}</button>)}</nav>
    {error && <p role="alert">{error} <button onClick={() => void reload()}>Coba lagi</button></p>}
    <div className="office-panel-content">
      {!ready && <p>Memuat riwayat agent…</p>}
      {tab==='Chat' && <div className="office-conversation"><div className="office-chat-tools"><button onClick={() => setImporting(!importing)}>Impor konteks</button><button disabled={!chats.length} onClick={exportChat}>Ekspor chat</button><small>Riwayat tersimpan · respons melalui antrean</small></div>{importing && <p>Tempel riwayat percakapan ke kolom pesan (maksimal 12.000 karakter), lalu tinjau sebelum mengirim. Riwayat akan dibaca sebagai konteks pengguna.</p>}<div className="chat-messages-area">
        {ready && chats.length===0 && <div className="chat-empty-hint"><h3>Halo, saya {name}.</h3><p>Diskusikan kebutuhan {brand.name} atau berikan brief. Hasil kerja tetap melalui approval.</p><button onClick={() => setInput('Apa yang bisa kamu bantu sesuai peran dan aturan brand ini?')}>Kenali peran agent</button></div>}
        {chats.map(t => <div key={t.id}>
          <div className="chat-bubble-row user-row"><div className="chat-bubble user-bubble"><div className="bubble-header">Anda · {new Date(t.createdAt).toLocaleString('id-ID')}</div><div className="bubble-content">{t.brief}</div></div></div>
          <div className="chat-bubble-row agent-row"><div className="chat-bubble agent-bubble"><div className="bubble-header">{name} · {TASK_STATUS_LABELS[t.status]}</div><div className="bubble-content">{(t.text ?? t.result) || t.error || (t.status==='running' ? 'Sedang menyusun jawaban…' : t.status==='waiting_quota' ? 'Menunggu kuota tersedia.' : 'Pesan masuk antrean.')}</div>{(t.artifacts ?? []).map(file => <div className="chat-file" key={file.name}>
            <div className="chat-file-head"><strong>{file.name}</strong><small>{sizeLabel(new Blob([file.content]).size)}</small>
              <button type="button" aria-expanded={openFile===`${t.id}:${file.name}`} onClick={() => setOpenFile(openFile===`${t.id}:${file.name}` ? undefined : `${t.id}:${file.name}`)}>{openFile===`${t.id}:${file.name}` ? 'Tutup' : file.assetId ? 'Lihat sumber' : 'Lihat'}</button>
              {file.assetId ? <a className="chat-file-link" href={`/api/office${base}/assets/${file.assetId}/file`} download={file.name}>Unduh PDF</a> : <button type="button" onClick={() => downloadText(file.name,file.content)}>Unduh</button>}</div>
            {openFile===`${t.id}:${file.name}` && <pre className="chat-file-body">{file.content}</pre>}
          </div>)}{t.status==='failed' && <button disabled={busy} onClick={() => void perform(() => officeRequest('POST',`${base}/tasks/${t.id}/retry`))}>Coba ulang</button>}</div></div>
        </div>)}<div ref={end}/>
      </div><form className="chat-input-bar" onSubmit={e => {e.preventDefault();send()}}><textarea aria-label="Pesan untuk agent" placeholder={`Pesan untuk ${name}…`} maxLength={12000} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); if(!pending) send()} }}/><button disabled={busy || pending || !ready || !input.trim()}>{busy ? 'Mengirim…' : pending ? 'Menunggu jawaban' : 'Kirim'}</button></form></div>}
      {tab==='Tugas' && <div><OfficeTaskForm brand={brand.id} agent={agent.agentType} disabled={busy || !ready} submit={perform}/>{tasks.length===0 && <p>Belum ada tugas.</p>}{tasks.map(t => <article className="office-task-row" key={t.id}><strong>{t.title}</strong><small>{TASK_STATUS_LABELS[t.status]}</small><p>{t.brief}</p>{t.error && <p role="alert">{t.error}</p>}{t.result && <details><summary>Lihat hasil lengkap</summary><pre>{t.result}</pre></details>}{t.status==='failed' && <button disabled={busy} onClick={() => void perform(() => officeRequest('POST',`${base}/tasks/${t.id}/retry`))}>Coba ulang tugas</button>}{['queued','waiting_quota','paused','failed'].includes(t.status) && <button disabled={busy} onClick={() => void perform(() => officeRequest('POST',`${base}/tasks/${t.id}/cancel`,{reason:'Dibatalkan dari panel agent'}))}>Batalkan tugas</button>}</article>)}</div>}
      {tab==='Approval' && <div><p>Keputusan dicatat untuk {brand.name}.</p>{ready && approvals.length===0 && <p>Tidak ada approval terbuka untuk agent ini.</p>}{approvals.map(a => <ApprovalCard key={a.id} approval={a} onDecided={reload}/>)}</div>}
      {tab==='Folder' && <div><p>Hasil kerja tersimpan per brand dan tugas. Pilih tugas untuk membaca versi aset.</p><select aria-label="Pilih hasil tugas" defaultValue="" onChange={e => {const request=++assetGeneration.current;setAssets([]); if(e.target.value) void perform(async () => {const result=await officeRequest<{assets:Asset[]}>('GET',`${base}/tasks/${e.target.value}`);if(active.current && request===assetGeneration.current)setAssets(result.assets)})}}><option value="">Pilih tugas…</option>{tasks.map(t => <option value={t.id} key={t.id}>{t.title}</option>)}</select>{assets.map(a => <details key={a.id} open><summary>{a.kind} · versi {a.version}</summary><pre>{a.content}</pre><button onClick={() => {const url=URL.createObjectURL(new Blob([a.content],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`${brand.id}-${agent.agentType}-${a.id}-v${a.version}.md`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}>Unduh hasil .md</button></details>)}</div>}
      {tab==='Memori & Rules' && <div><AgentNotes brandId={brand.id} agentType={agent.agentType} agentName={name}/><h3 className="notes-official">Konteks resmi <small>hanya dibaca · diubah lewat PR ke folder context/</small></h3>{context.map(f => <details key={f.path}><summary>{f.path}</summary><pre>{f.content}</pre></details>)}</div>}
    </div>
  </dialog>
}
