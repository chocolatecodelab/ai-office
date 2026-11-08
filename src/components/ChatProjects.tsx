import { useEffect, useRef, useState } from 'react'
import { officeRequest } from '../office-api.ts'
import './chat-projects.css'

type Version={taskId:string;version:number;ready:boolean;stage?:string}
type Project={id:string;title:string;createdAt?:string;versions:Version[]}
type ComparedFile={name:string;left:string|null;right:string|null;changed:boolean;kind?:string;leftText?:string;rightText?:string}
type Comparison={left?:Version;right?:Version;slides:ComparedFile[];files?:ComparedFile[];captionChanged:boolean;summary?:{changed:number;unchanged:number;added:number;removed:number}}
const stageLabel=(stage?:string)=>stage==='revision-preview'?'Preview video':stage==='thumbnail-review'?'Thumbnail':stage==='video-review'?'Video MP4':stage==='narrative-plan'?'Rencana':''

export function ProductionSourceChip({base,value,onChoose,onClear,disabled}:{base:string;value:string;onChoose:()=>void;onClear:()=>void;disabled:boolean}){
  const [source,setSource]=useState<{taskId:string;title:string;version:number}>()
  useEffect(()=>{let active=true;if(value)void officeRequest<{taskId:string;title:string;version:number}>('GET',`${base}/production/versions/${encodeURIComponent(value)}`).then(data=>{if(active)setSource(data)}).catch(()=>{if(active)setSource(undefined)});return()=>{active=false}},[base,value])
  if(!value)return null
  const label=source?.taskId===value?`v${source.version} · ${source.title}`:'Pilih ulang sumber revisi'
  return <div className="chat-production-source"><button type="button" disabled={disabled} title={label} onClick={onChoose}><span>Sumber revisi</span><strong>{label}</strong></button><button type="button" disabled={disabled} onClick={onClear} aria-label="Lepas sumber revisi">×</button></div>
}

export function ChatProjects({base,brand,value,onChange,refresh,disabled,onClose}:{base:string;brand:string;value:string;onChange:(id:string)=>void;refresh:string;disabled:boolean;onClose?:()=>void}){
  const [open,setOpen]=useState(!!onClose),[projects,setProjects]=useState<Project[]>([]),[error,setError]=useState(''),[other,setOther]=useState(''),[comparison,setComparison]=useState<Comparison>(),[loading,setLoading]=useState(false),[confirmRestore,setConfirmRestore]=useState(false),[notice,setNotice]=useState('')
  const identity=useRef(''),mounted=useRef(true)
  identity.current=base+'|'+value+'|'+other
  const project=projects.find(p=>p.versions.some(v=>v.taskId===value)),selected=project?.versions.find(v=>v.taskId===value)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{if(!open&&!value)return;let active=true;officeRequest<Project[]>('GET',`${base}/production/projects`).then(data=>{if(active){setProjects(data);setError('')}}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[base,open,value,refresh])
  useEffect(()=>{setComparison(undefined);setOther('');setConfirmRestore(false)},[base,value])
  const asset=(id:string,inline=true)=>`/api/office/brands/${encodeURIComponent(brand)}/assets/${id}/file${inline?'?inline=1':''}`
  const compare=async()=>{
    const request=identity.current
    setLoading(true);setError('')
    try{const data=await officeRequest<Comparison>('GET',`${base}/production/compare?left=${encodeURIComponent(other)}&right=${encodeURIComponent(value)}`);if(mounted.current&&identity.current===request)setComparison(data)}catch(e){if(mounted.current&&identity.current===request)setError(String(e))}finally{if(mounted.current)setLoading(false)}
  }
  const restore=async()=>{
    setLoading(true);setError('')
    try{
      const data=await officeRequest<Version>('POST',`${base}/production/versions/${encodeURIComponent(value)}/restore`,{})
      if(mounted.current){onChange(data.taskId);setNotice(`Dipulihkan sebagai versi ${data.version}. Menunggu persetujuan baru.`);setConfirmRestore(false)}
    }catch(e){if(mounted.current)setError(String(e))}finally{if(mounted.current)setLoading(false)}
  }
  const media=(file:ComparedFile,id:string|null,side:string)=>!id?<div className="chat-compare-missing">Tidak tersedia di versi ini</div>:file.kind==='video'?<video controls preload="metadata" playsInline src={asset(id)} aria-label={`${file.name}, ${side}`}/>:<img src={asset(id)} alt={`${file.name}, ${side}`} loading="lazy"/>
  const visual=comparison?.files?.filter(f=>f.kind==='image'||f.kind==='video')??comparison?.slides??[]
  const documents=comparison?.files?.filter(f=>f.kind!=='image'&&f.kind!=='video')??[]
  return <section className={onClose?'chat-projects is-project-sheet':'chat-projects'} aria-label="Proyek dan versi" onKeyDown={e=>{if(onClose&&e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}}}>
    {onClose&&<header><h3>Proyek dan versi</h3><button type="button" autoFocus aria-label="Kembali ke chat" onClick={onClose}>×</button></header>}
    <div className="chat-projects-trigger"><button hidden={!!onClose} type="button" aria-expanded={open} onClick={()=>setOpen(v=>!v)} disabled={disabled}>▧ {project?`${project.title} · v${selected?.version}`:'Hasil produksi'}</button>{value&&<button type="button" aria-label="Lepas versi sumber" disabled={disabled||loading} onClick={()=>onChange('')}>×</button>}</div>
    {open&&<div className="chat-projects-body">
      <p>Pilih hasil yang akan direvisi. Versi lama tetap tersimpan.</p>
      <label>Versi sumber<select value={value} disabled={disabled||loading} onChange={e=>{setNotice('');onChange(e.target.value)}}><option value="">Tanpa sumber revisi</option>{projects.map(p=><optgroup label={p.title+(p.createdAt?' · '+new Date(p.createdAt).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'')} key={p.id}>{p.versions.map(v=><option key={v.taskId} value={v.taskId} disabled={!v.ready}>v{v.version} · {p.title}{stageLabel(v.stage)?' · '+stageLabel(v.stage):''}{!v.ready?' (belum tersedia)':''}</option>)}</optgroup>)}</select></label>
      {!projects.length&&!error&&<p>Belum ada hasil produksi. Buat hasil pertama melalui chat.</p>}
      {value&&!project&&projects.length>0&&<p role="alert">Sumber tidak ditemukan dalam daftar. Pilih ulang hasil yang ingin direvisi.</p>}
      {selected&&<div className="chat-projects-selected"><span>Revisi berikutnya memakai versi {selected.version}.</span>{onClose&&<button type="button" disabled={disabled||loading} onClick={onClose}>Gunakan untuk revisi</button>}</div>}
      {project&&project.versions.filter(v=>v.ready).length>1&&<div className="chat-projects-compare"><label>Versi pembanding<select disabled={loading} value={other} onChange={e=>{setOther(e.target.value);setComparison(undefined)}}><option value="">Pilih versi</option>{project.versions.filter(v=>v.ready&&v.taskId!==value).map(v=><option key={v.taskId} value={v.taskId}>Versi {v.version}{stageLabel(v.stage)?' · '+stageLabel(v.stage):''}</option>)}</select></label><button type="button" disabled={!other||loading} onClick={()=>void compare()}>{loading?'Memuat…':'Bandingkan'}</button></div>}
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {comparison&&<div className="chat-projects-results">
        <h4>Ringkasan perubahan</h4>
        {comparison.summary&&<p>{comparison.summary.changed} berkas berubah, {comparison.summary.unchanged} tetap. {comparison.summary.added} ditambahkan, {comparison.summary.removed} tidak ada di versi sumber.</p>}
        <div className="chat-compare-headings"><strong>Pembanding{comparison.left?` · v${comparison.left.version}`:''}</strong><strong>Sumber revisi{comparison.right?` · v${comparison.right.version}`:''}</strong></div>
        {visual.map(file=><figure key={file.name}><figcaption>{file.name} <span>{file.changed?'Berubah':'Sama'}</span></figcaption><div>{media(file,file.left,'versi pembanding')}{media(file,file.right,'versi sumber')}</div></figure>)}
        <p>Caption {comparison.captionChanged?'berubah':'sama'}.</p>
        {documents.length>0&&<details className="chat-compare-documents"><summary>Berkas pendukung ({documents.length})</summary>{documents.map(file=><details key={file.name}><summary>{file.name} · {file.changed?'Berubah':'Sama'}</summary><div className="chat-compare-text">{[file.left,file.right].map((id,i)=><div key={i}><strong>{i?'Sumber revisi':'Pembanding'}</strong>{id?<><a href={asset(id,false)} download>Unduh</a>{(i?file.rightText:file.leftText)!==undefined&&<pre>{i?file.rightText:file.leftText}</pre>}</>:<p>Tidak tersedia di versi ini</p>}</div>)}</div></details>)}</details>}
      </div>}
      {selected&&<div className="chat-projects-restore">{confirmRestore?<><p>Salin versi {selected.version} sebagai versi baru? Hasilnya perlu ditinjau dan disetujui kembali.</p><div><button type="button" disabled={disabled||loading} onClick={()=>void restore()}>{loading?'Memulihkan…':'Pulihkan sebagai versi baru'}</button><button type="button" disabled={loading} onClick={()=>setConfirmRestore(false)}>Batal</button></div></>:<button type="button" disabled={disabled||loading} onClick={()=>setConfirmRestore(true)}>Pulihkan versi {selected.version} sebagai versi baru</button>}</div>}
    </div>}
  </section>
}
