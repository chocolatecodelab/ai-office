import { ChatIcon } from './ChatIcon.tsx'
import { ChatContextPreview } from './ChatContextPreview.tsx'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AGENT_NAMES, AGENT_STATUS_LABELS, TASK_STATUS_LABELS, officeRequest, useOfficeLive, type OfficeAgent, type OfficeBrand, type OfficeTask, type OfficeApproval } from '../office-api.ts'
import { useAgentDraft } from '../agent-drafts.ts'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import { AgentTaskList, AgentFolder, AgentMemoryWorkspace } from './AgentWorkspaceTabs.tsx'
import { OfficeTaskForm } from './OfficeTaskForm.tsx'
import { downloadText, sizeLabel } from '../download.ts'
import { ChatWorkspaceTools, ChatDocumentProgress, ChatEvidenceView, RememberChatReply, type ChatSelection, type ChatEvidence } from './ChatWorkspace.tsx'
import { PixelCharacter } from '../pages/OfficeDetails.tsx'

const TABS = ['Chat', 'Tugas', 'Approval', 'Folder', 'Memori & Rules'] as const
type Tab = typeof TABS[number]

export function OfficeAgentPanel({ brand, agent, onClose, embedded = false, initialTab = 'Chat' }: { brand: OfficeBrand; agent: OfficeAgent; onClose: () => void; embedded?: boolean; initialTab?: Tab }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const composer=useRef<HTMLFormElement>(null)
  const messageField=useRef<HTMLTextAreaElement>(null)
  const [composerHeight,setComposerHeight]=useState(160)
  const followLatest=useRef(true)
  const [tab,setTab] = useState<Tab>(initialTab)
  useEffect(()=>{if(!composer.current || typeof ResizeObserver==='undefined')return;const node=composer.current;const observer=new ResizeObserver(()=>setComposerHeight(node.getBoundingClientRect().height));observer.observe(node);return()=>observer.disconnect()},[tab])
  const [tasks,setTasks] = useState<OfficeTask[]>([])
  const [approvals,setApprovals] = useState<OfficeApproval[]>([])
  const [input,setInput] = useAgentDraft<string>(brand.id+'/'+agent.agentType+'/chat','')
  useLayoutEffect(()=>{const field=messageField.current;if(!field)return;field.style.height='auto';field.style.height=`${Math.min(132,Math.max(48,field.scrollHeight))}px`},[input,tab])
  const [error,setError] = useState('')
  const [loadError,setLoadError] = useState('')
  const [busy,setBusy] = useState(false)
  const [delegate,setDelegate] = useState(false)
  const [selection,setSelection]=useState<ChatSelection>({attachments:[],skills:[],useMemory:true})
  const [uploading,setUploading]=useState(false)
  const [evidence,setEvidence]=useState<ChatEvidence[]>([])
  const [ready,setReady] = useState(false)
  const [importing,setImporting] = useState(false)
  const [openFile,setOpenFile] = useState<string>()
  const actionLock=useRef(false)
  const active = useRef(true)
  const generation = useRef(0)
  const base = `/brands/${encodeURIComponent(brand.id)}`
  const agentBase = `${base}/agents/${encodeURIComponent(agent.agentType)}`
  const name = AGENT_NAMES[agent.agentType] ?? agent.agentType
  const reload = useCallback(async () => {
    const request = ++generation.current
    try {
      const [all, reviews, evidence] = await Promise.all([officeRequest<OfficeTask[]>('GET',`${base}/tasks`),officeRequest<OfficeApproval[]>('GET',`${base}/approvals?open=1`),officeRequest<ChatEvidence[]>('GET',`${agentBase}/chat-evidence`)])
      if (!active.current || request !== generation.current) return
      setEvidence(evidence)
      setTasks(all.filter(t => t.agentType === agent.agentType))
      setApprovals(reviews.filter(a => a.task?.agentType === agent.agentType))
      setReady(true)
      setLoadError('')
    } catch(e) { if (active.current) setLoadError(String(e)) }
  },[base,agent.agentType,agentBase])
  useOfficeLive(brand.id,() => void reload())
  useEffect(() => {
    active.current = true
    const previous = document.activeElement as HTMLElement | null
    if(!embedded) dialog.current?.showModal()
    void reload()
    const timer=setInterval(() => { if (!document.hidden) void reload() },5000)
    return () => { active.current=false; clearInterval(timer); previous?.focus() }
  },[reload,embedded])
  const latestReply = tasks.filter(t => t.kind === 'konten.chat').map(t => `${t.id}:${t.status}:${t.result?.length ?? 0}`).join('|')
  useEffect(() => { if (tab === 'Chat' && followLatest.current && end.current?.parentElement) {const area=end.current.parentElement;area.scrollTop=area.scrollHeight} },[latestReply,tab])
  const perform = async (work: () => Promise<unknown>) => {
    if(actionLock.current) return
    actionLock.current=true
    setBusy(true); setError('')
    try { await work(); if(active.current) await reload() } catch(e) { if(active.current) { setError(String(e)); await reload() } }
    finally { actionLock.current=false; if(active.current) setBusy(false) }
  }
  const send = () => {
    const message=input.trim()
    if (!message || busy || uploading || pending || !ready) return
    if(delegate && agent.agentType==='manager') {
      void perform(async()=>{await officeRequest('POST',`${base}/tasks`,{agentType:'manager',kind:'konten.orchestrasi',title:message.slice(0,200),brief:message,attachmentIds:selection.attachments.map(f=>f.id),skills:selection.skills,useMemory:selection.useMemory,pageRanges:selection.pageRanges,excludedMemoryIds:selection.excludedMemoryIds,useSummary:selection.useSummary});setSelection(old=>({...old,attachments:[],skills:[],pageRanges:{},excludedMemoryIds:[],useSummary:true}));setInput(previous=>previous.trim()===message?'':previous);setTab('Tugas')});return
    }
    followLatest.current=true
    void perform(async () => { await officeRequest('POST',`${agentBase}/chat`,{message,attachmentIds:selection.attachments.map(f=>f.id),skills:selection.skills,useMemory:selection.useMemory,pageRanges:selection.pageRanges,excludedMemoryIds:selection.excludedMemoryIds,useSummary:selection.useSummary}); setInput(previous=>previous.trim()===message?'':previous);setSelection(old=>({...old,attachments:[],skills:[],pageRanges:{},excludedMemoryIds:[],useSummary:true})) })
  }
  const chats=tasks.filter(t => t.kind === 'konten.chat').slice().reverse()
  const pending=chats.some(t => ['queued','running','waiting_quota','revision'].includes(t.status))
  const exportChat = () => {
    const data=chats.flatMap(t => [{role:'user',content:t.brief,timestamp:t.createdAt},...(t.result ? [{role:'assistant',content:t.result,timestamp:t.updatedAt}] : [])])
    const url=URL.createObjectURL(new Blob([JSON.stringify({brand:brand.id,agent:agent.agentType,messages:data},null,2)],{type:'application/json'}))
    const link=document.createElement('a');link.href=url;link.download=`chat-${brand.id}-${agent.agentType}.json`;link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  return <dialog open={embedded || undefined} onKeyDown={e=>{if(e.key==='Escape')onClose()}} ref={dialog} aria-label={`${name} · ${brand.name}`} className={`office-agent-panel${tab==='Chat' ? ' is-chat' : ''}${embedded ? ' embedded' : ''}`} onCancel={e=>{if(e.target!==e.currentTarget)return;e.preventDefault();onClose()}} onClick={e => { if(e.target===e.currentTarget) onClose() }}>
    <header className="office-panel-heading"><PixelCharacter agent={`${brand.id}/${agent.agentType}`}/><div><small>{brand.name}</small><h2>{name}</h2><span>{AGENT_STATUS_LABELS[agent.status]}</span></div><button autoFocus onClick={onClose} aria-label="Tutup panel agent"><ChatIcon name="close"/></button></header>
    <nav className="office-panel-tabs" aria-label="Detail agent">{TABS.map(t => <button key={t} aria-pressed={tab===t} onClick={() => setTab(t)}>{t}{t==='Approval' && approvals.length>0 ? ` (${approvals.length})` : ''}</button>)}</nav>
    {(error || loadError) && <p role="alert">{error || loadError} <button onClick={() => {setError('');void reload()}}>Coba lagi</button></p>}
    <div className="office-panel-content"><ChatDocumentProgress base={agentBase} active={tasks.some(t=>['running','queued','revision'].includes(t.status))}/>
      {!ready && <p>Memuat riwayat agent…</p>}
      {tab==='Chat' && <div className="office-conversation" style={{'--chat-composer-height':`${composerHeight}px`} as CSSProperties}><div className="office-chat-utilities"><div className="office-chat-tools"><small>Riwayat tersimpan</small><button className="chat-icon-button" title="Impor konteks" aria-label="Impor konteks" aria-pressed={importing} onClick={() => setImporting(!importing)}><ChatIcon name="import"/></button><button className="chat-icon-button" title="Ekspor chat" aria-label="Ekspor chat" disabled={!chats.length} onClick={exportChat}><ChatIcon name="export"/></button>{agent.agentType==='manager' && <label className="manager-chat-mode"><input type="checkbox" checked={delegate} onChange={e=>setDelegate(e.target.checked)}/> Delegasi tim <span className="chat-visually-hidden">Membuat tugas spesialis; progres tersedia di tab Tugas.</span></label>}</div>{importing && <p>Tempel riwayat percakapan ke kolom pesan (maksimal 12.000 karakter), lalu tinjau sebelum mengirim. Riwayat akan dibaca sebagai konteks pengguna.</p>}</div><div className="chat-messages-area" onScroll={e=>{const area=e.currentTarget;followLatest.current=area.scrollHeight-area.scrollTop-area.clientHeight<80}}>
        {ready && chats.length===0 && <div className="chat-empty-hint"><h3>Halo, saya {name}.</h3><p>Diskusikan kebutuhan {brand.name} atau berikan brief. Hasil kerja tetap melalui approval.</p><button onClick={() => setInput('Apa yang bisa kamu bantu sesuai peran dan aturan brand ini?')}>Kenali peran agent</button></div>}
        {chats.map(t => <div key={t.id}>
          <div className="chat-bubble-row user-row"><div className="chat-bubble user-bubble"><div className="bubble-header">Anda · {new Date(t.createdAt).toLocaleString('id-ID')}</div><div className="bubble-content">{t.brief}</div></div></div>
          <div className="chat-bubble-row agent-row"><div className="chat-bubble agent-bubble"><div className="bubble-header">{name} · {TASK_STATUS_LABELS[t.status]}</div><div className="bubble-content">{(t.text ?? t.result) ? <ReadOnlyMarkdown text={(t.text ?? t.result)!}/> : t.error || (t.status==='running' ? 'Sedang menyusun jawaban…' : t.status==='waiting_quota' ? 'Menunggu kuota tersedia.' : 'Pesan masuk antrean.')}</div>{(t.artifacts ?? []).map(file => <div className="chat-file" key={file.name}>
            <div className="chat-file-head"><strong>{file.name}</strong><small>{file.assetId ? 'Sumber: ' : ''}{sizeLabel(new Blob([file.content]).size)}</small>
              <button type="button" aria-expanded={openFile===`${t.id}:${file.name}`} onClick={() => setOpenFile(openFile===`${t.id}:${file.name}` ? undefined : `${t.id}:${file.name}`)}>{openFile===`${t.id}:${file.name}` ? 'Tutup' : file.assetId ? 'Lihat sumber' : 'Lihat'}</button>
              {file.assetId ? <a className="chat-file-link" href={`/api/office${base}/assets/${file.assetId}/file`} download={file.name}>Unduh PDF</a> : <button type="button" onClick={() => downloadText(file.name,file.content)}>Unduh</button>}</div>
            {openFile===`${t.id}:${file.name}` && <pre className="chat-file-body">{file.content}</pre>}
          </div>)}<ChatEvidenceView base={agentBase} evidence={evidence.find(e=>e.taskId===t.id)}/>{t.status==='done' && t.result && <RememberChatReply task={t} base={base} agent={agent.agentType}/>} {t.status==='failed' && <button disabled={busy} onClick={() => void perform(() => officeRequest('POST',`${base}/tasks/${t.id}/retry`))}>Coba ulang</button>}</div></div>
        </div>)}<div ref={end}/>
      </div><form ref={composer} className="chat-input-bar" onSubmit={e => {e.preventDefault();send()}}><textarea ref={messageField} rows={1} aria-label="Pesan untuk agent" placeholder={`Pesan untuk ${name}…`} maxLength={12000} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => {if(e.key==='Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); if(!pending) send()} }}/><ChatWorkspaceTools base={agentBase} value={selection} onChange={setSelection} disabled={busy||pending} onUploading={setUploading}/><ChatContextPreview base={agentBase} message={input} selection={selection} onChange={setSelection} delegate={delegate} disabled={busy||pending||uploading} onManage={()=>setTab('Memori & Rules')}/><button className="chat-send-button" aria-label={busy ? 'Mengirim…' : pending ? 'Menunggu jawaban' : delegate ? 'Delegasikan' : 'Kirim pesan'} title={pending ? 'Menunggu jawaban' : delegate ? 'Delegasikan ke tim' : 'Kirim pesan (Enter)'} disabled={busy || uploading || pending || !ready || !input.trim()}><ChatIcon name="send"/></button></form></div>}
      {tab==='Tugas' && <div className="agent-workspace-tab"><OfficeTaskForm expanded={initialTab==='Tugas'} brand={brand.id} agent={agent.agentType} disabled={busy || !ready} submit={perform}/>{ready && <AgentTaskList tasks={tasks} busy={busy} perform={perform} base={base}/>}</div>}
      {tab==='Approval' && <div className="agent-approval-tab"><div className="agent-section-heading"><div><h3>Perlu persetujuan ({approvals.length})</h3><p>Tinjau hasil dan pemeriksaan teks sebelum mengambil keputusan untuk {brand.name}. Penolakan wajib disertai arahan revisi.</p></div></div>{ready && approvals.length===0 && <div className="agent-empty"><h4>Semua sudah ditinjau</h4><p>Tidak ada approval terbuka untuk agent ini. Hasil baru yang memerlukan persetujuan akan muncul di sini.</p></div>}{approvals.map(a => <ApprovalCard key={a.id} approval={a} onDecided={reload}/>)}</div>}
      {tab==='Folder' && <AgentFolder brand={brand.id} agent={agent.agentType}/>}
      {tab==='Memori & Rules' && <AgentMemoryWorkspace brand={brand.id} agent={agent.agentType} name={name} base={agentBase}/>}

    </div>
  </dialog>
}
