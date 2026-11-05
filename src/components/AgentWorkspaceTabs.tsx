import { useEffect, useRef, useState } from 'react'
import { officeRequest, TASK_STATUS_LABELS, type OfficeTask, type OfficeAssets, type AssetItem, type AssetPreview } from '../office-api.ts'
import { formatDateTime } from '../format.ts'
import { downloadText } from '../download.ts'
import { assetLabel, fileName } from '../folder-filters.ts'
import { FileCard } from './FileGallery.tsx'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'
import { AgentNotes } from './AgentNotes.tsx'
import { ChatMemoryPanel } from './ChatWorkspace.tsx'
import { ManagerProgress } from './ManagerProgress.tsx'

export function AgentTaskList({ tasks, busy, perform, base }: { tasks: OfficeTask[]; busy: boolean; perform: (work: () => Promise<unknown>) => Promise<void>; base: string }) {
  const [filter,setFilter] = useState('active')
  const [query,setQuery] = useState('')
  const work = tasks.filter(t=>t.kind!=='konten.chat')
  const active = (t: OfficeTask)=>!['done','approved','cancelled'].includes(t.status)
  const shown = work.filter(t=>(filter==='all' || (filter==='active' ? active(t) : !active(t))) && `${t.title} ${t.brief}`.toLowerCase().includes(query.toLowerCase()))
  return <section className="agent-task-list" aria-label="Daftar pekerjaan">
    <div className="agent-section-heading"><div><h3>Pekerjaan agent</h3><p>{work.filter(active).length} aktif dari {work.length} tugas. Percakapan tersedia di tab Chat.</p></div></div>
    <div className="agent-filter-bar"><label>Cari tugas<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Judul atau brief…"/></label><label>Tampilkan<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="active">Tugas aktif</option><option value="finished">Riwayat selesai</option><option value="all">Semua tugas</option></select></label></div>
    {shown.length===0 && <div className="agent-empty"><h4>{work.length ? 'Tidak ada tugas yang sesuai' : 'Belum ada pekerjaan'}</h4><p>{work.length ? 'Coba ubah pencarian atau filter status.' : 'Buka Beri tugas baru untuk memulai. Chat tidak dihitung sebagai tugas kerja.'}</p></div>}
    {shown.map(t=><details className="agent-work-item" key={t.id}><summary><span><strong>{t.title}</strong><small>Diperbarui {formatDateTime(t.updatedAt)}</small></span><span className={`badge office-status st-${t.status}`}>{TASK_STATUS_LABELS[t.status]}</span></summary><div className="agent-work-detail">{t.kind==='konten.orchestrasi' && <ManagerProgress task={t}/>}<h4>Brief</h4><p className="agent-preserve">{t.brief}</p>{t.error && <p role="alert">{t.error}</p>}<h4>Hasil kerja</h4>{t.result ? <ReadOnlyMarkdown text={t.result}/> : <p>Hasil akan tersedia setelah pekerjaan diselesaikan.</p>}<div className="agent-inline-actions">{t.status==='failed' && <button disabled={busy} onClick={()=>void perform(()=>officeRequest('POST',`${base}/tasks/${t.id}/retry`))}>Coba ulang</button>}{['queued','waiting_quota','paused','failed'].includes(t.status) && <button disabled={busy} onClick={()=>void perform(()=>officeRequest('POST',`${base}/tasks/${t.id}/cancel`,{reason:'Dibatalkan dari panel agent'}))}>Batalkan tugas</button>}</div></div></details>)}
  </section>
}

export function AgentFolder({ brand, agent }: { brand: string; agent: string }) {
  const [files,setFiles] = useState<AssetItem[]>()
  const [error,setError] = useState('')
  const [query,setQuery] = useState('')
  const [allVersions,setAllVersions] = useState(false)
  const [includeReplies,setIncludeReplies] = useState(false)
  const [selected,setSelected] = useState<AssetItem>()
  const [attempt,setAttempt] = useState(0)
  useEffect(()=>{let valid=true;setError('');officeRequest<OfficeAssets>('GET','/assets').then(data=>{if(valid)setFiles(data.assets.filter(a=>a.brandId===brand && a.agentType===agent))}).catch(e=>{if(valid)setError(String(e))});return()=>{valid=false}},[brand,agent,attempt])
  const latest = (a: AssetItem)=>!files?.some(b=>b.taskId===a.taskId && b.kind===a.kind && b.name===a.name && b.version>a.version)
  const shown = files?.filter(a=>(includeReplies || a.kind==='artifact') && (allVersions || latest(a)) && `${assetLabel(a)} ${a.title}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  if(selected) return <AgentFileReader key={selected.id} file={selected} onBack={()=>setSelected(undefined)}/>
  return <section className="agent-folder"><div className="agent-section-heading"><div><h3>Berkas hasil kerja</h3><p>Pratinjau, baca, dan unduh hasil agent ini. Versi terbaru ditampilkan lebih dulu.</p></div></div>
    <div className="agent-filter-bar"><label>Cari berkas<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nama berkas atau tugas…"/></label><label>Versi<select value={String(allVersions)} onChange={e=>setAllVersions(e.target.value==='true')}><option value="false">Terbaru saja</option><option value="true">Semua versi</option></select></label></div>
    <label className="agent-context-confirm"><input type="checkbox" checked={includeReplies} onChange={e=>setIncludeReplies(e.target.checked)}/> Sertakan teks balasan agent</label>
    {error ? <p role="alert">Berkas belum dapat dimuat. <button onClick={()=>setAttempt(n=>n+1)}>Coba lagi</button></p> : !files ? <p role="status">Memuat berkas…</p> : <><p className="agent-count">{shown?.length} berkas</p>{!shown?.length ? <div className="agent-empty"><h4>{files.length ? 'Berkas tidak ditemukan' : 'Folder masih kosong'}</h4><p>{files.length ? 'Gunakan nama lain, tampilkan semua versi, atau sertakan teks balasan agent.' : 'Hasil yang disimpan dari tugas dan chat akan muncul di sini.'}</p></div> : <div className="fb-grid agent-file-grid">{shown.map(a=><FileCard key={a.id} asset={a} showBrand={false} latest={latest(a)} selected={false} onOpen={()=>setSelected(a)}/>)}</div>}</>}
  </section>
}

function AgentFileReader({ file, onBack }: { file: AssetItem; onBack: () => void }) {
  const [loaded,setLoaded] = useState<{content:string;preview:AssetPreview}>()
  const [error,setError] = useState('')
  const [attempt,setAttempt] = useState(0)
  const base=`/brands/${encodeURIComponent(file.brandId)}/assets/${encodeURIComponent(file.id)}`
  useEffect(()=>{let valid=true;setError('');Promise.all([officeRequest<{content:string}>('GET',base),officeRequest<AssetPreview>('GET',`${base}/preview`)]).then(([full,preview])=>{if(valid)setLoaded({...full,preview})}).catch(e=>{if(valid)setError(String(e))});return()=>{valid=false}},[base,attempt])
  return <section className="agent-file-reader"><button onClick={onBack}>Kembali ke berkas</button><h3>{assetLabel(file)}</h3><p>Versi {file.version} · {formatDateTime(file.createdAt)}</p><div className="agent-inline-actions">{file.downloadable ? <a className="chat-file-link" href={`/api/office${base}/file`} download={fileName(file)}>Unduh PDF</a> : <button disabled={!loaded} onClick={()=>loaded && downloadText(fileName(file),loaded.content)}>Unduh berkas</button>}</div>{error ? <p role="alert">{error} <button onClick={()=>setAttempt(n=>n+1)}>Coba lagi</button></p> : !loaded ? <p role="status">Memuat pratinjau…</p> : loaded.preview.type==='text' ? <ReadOnlyMarkdown text={loaded.content}/> : <iframe title={`Pratinjau ${assetLabel(file)}`} sandbox="" referrerPolicy="no-referrer" srcDoc={loaded.preview.html}/>}</section>
}

export interface AgentContextFile { path: string; content: string }
export function AgentMemoryWorkspace({ brand, agent, name, base }: { brand: string; agent: string; name: string; base: string }) {
  const [section,setSection]=useState('notes')
  return <div className="agent-memory-workspace"><div className="agent-memory-switch" aria-label="Sumber pengetahuan"><button aria-pressed={section==='notes'} onClick={()=>setSection('notes')}>Catatan tim</button><button aria-pressed={section==='official'} onClick={()=>setSection('official')}>Konteks resmi</button></div><p className="agent-memory-hint">Catatan tim menyimpan preferensi dan pelajaran. Konteks resmi mengatur peran dan aturan dasar agent.</p><div hidden={section!=='notes'}><ChatMemoryPanel base={base}/><AgentNotes brandId={brand} agentType={agent} agentName={name}/></div><div hidden={section!=='official'}><AgentContextLibrary base={base}/></div></div>
}
export function AgentContextLibrary({ base }: { base: string }) {
  const [files,setFiles] = useState<AgentContextFile[]>()
  const [path,setPath] = useState('')
  const [draft,setDraft] = useState<string>()
  const [accepted,setAccepted] = useState(false)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [attempt,setAttempt] = useState(0)
  const saving=useRef(false)
  useEffect(()=>{let valid=true;setError('');officeRequest<AgentContextFile[]>('GET',`${base}/context`).then(data=>{if(valid){setFiles(data);setPath(p=>data.some(f=>f.path===p)?p:data[0]?.path ?? '')}}).catch(e=>{if(valid)setError(String(e))});return()=>{valid=false}},[base,attempt])
  const file=files?.find(f=>f.path===path)
  const scope=path.startsWith('/brand/') ? 'Semua agent di brand ini' : path.includes('/agents/') ? 'Agent dengan peran ini di semua brand' : 'Semua agent di semua brand'
  const save=async()=>{
    if(!file || draft===undefined || saving.current || !accepted || !draft.trim())return
    saving.current=true
    setBusy(true);setError('');setNotice('')
    try {const saved=await officeRequest<AgentContextFile>('PUT',`${base}/context`,{path:file.path,previousContent:file.content,content:draft});setFiles(old=>old?.map(f=>f.path===saved.path?saved:f));setDraft(undefined);setNotice('Konteks disimpan. Berlaku pada tugas berikutnya; tugas yang sedang berjalan tetap memakai konteks sebelumnya.')}
    catch(e){setError(String(e))}finally{saving.current=false;setBusy(false)}
  }
  return <section className="agent-context-library" aria-label="Konteks resmi"><div className="agent-section-heading"><div><h3>Konteks resmi</h3><p>Dokumen dasar peran, identitas brand, dan aturan kerja. Periksa cakupannya sebelum mengubah.</p></div></div>
    {error && <p role="alert">{error} <button disabled={draft!==undefined || busy} onClick={()=>setAttempt(n=>n+1)}>Muat ulang dokumen</button></p>}{notice && <p role="status">{notice}</p>}
    {!files ? !error && <p role="status">Memuat konteks…</p> : !files.length ? <p>Belum ada dokumen konteks.</p> : <><label className="agent-document-select">Dokumen<select disabled={draft!==undefined} value={path} onChange={e=>{setPath(e.target.value);setNotice('');setError('')}}>{files.map(f=><option key={f.path} value={f.path}>{contextTitle(f.path)}</option>)}</select></label>{file && <article className="agent-context-document"><div className="agent-document-heading"><div><h4>{contextTitle(path)}</h4><small>{path}</small></div>{draft===undefined && !path.endsWith('/agents.json') && <button onClick={()=>{setDraft(file.content);setAccepted(false);setNotice('')}}>Edit konteks</button>}</div><p className="agent-context-scope">Berlaku untuk: <strong>{scope}</strong></p>{draft!==undefined ? <form onSubmit={e=>{e.preventDefault();void save()}}><label className="agent-editor-label">Isi dokumen ({path.endsWith('.json')?'JSON':'Markdown'})<textarea autoFocus disabled={busy} rows={16} maxLength={100000} value={draft} onChange={e=>setDraft(e.target.value)}/></label><label className="agent-context-confirm"><input type="checkbox" checked={accepted} disabled={busy} onChange={e=>setAccepted(e.target.checked)}/> Saya memahami perubahan berlaku untuk {scope.toLowerCase()}. Salinan sebelumnya akan disimpan.</label><div className="agent-inline-actions"><button className="primary-button" disabled={busy || !accepted || !draft.trim() || draft===file.content}>{busy?'Menyimpan…':'Simpan konteks'}</button><button type="button" disabled={busy} onClick={()=>setDraft(undefined)}>Batal</button></div><p>Jika dokumen telah diubah orang lain, simpan akan ditolak. Salin draft Anda, batalkan edit, lalu muat ulang dokumen.</p></form> : path.endsWith('.json') ? <pre>{file.content}</pre> : <ReadOnlyMarkdown text={file.content}/>}</article>}</>}
  </section>
}
function contextTitle(path: string) { const file=path.split('/').pop() ?? path;return ({'brand.md':'Profil brand','visual.json':'Panduan visual','agents.json':'Susunan agent (konfigurasi)','aturan-umum.md':'Aturan umum','approval-matrix.md':'Alur persetujuan','raci.md':'Pembagian tanggung jawab','batas-tanggung-jawab.md':'Batas tanggung jawab','checklist-publikasi.md':'Checklist publikasi'} as Record<string,string>)[file] ?? 'Peran '+file.replace('.md','').replaceAll('-',' ') }
