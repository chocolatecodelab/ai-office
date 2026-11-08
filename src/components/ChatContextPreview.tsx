import { ChatIcon } from './ChatIcon.tsx'
import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { officeRequest } from '../office-api.ts'
import type { ChatSelection } from './ChatWorkspace.tsx'

interface Preview {
  official:{core:string[];references:string[];available:number;characters:number}
  notes:Array<{id:string;title:string;body:string;kind:string;scope:string;reason:string}>
  omitted:Array<{id:string;title:string;kind:string}>
  unmatchedMemories:number;characters:number;budget:number;memoryEnabled:boolean
  summary:{text:string;revision:number}|null
  summaryAvailable?:boolean;excludedNotes?:Array<{id:string;title:string}>
  skills:Array<{id:string;name:string;execution:'tool'|'instruction'}>
}

/** Explicit, read-only preflight. Changed drafts never display an earlier preview as current. */
export function ChatContextPreview({base,message,selection,delegate,disabled,onManage,onChange}:{base:string;message:string;selection:ChatSelection;delegate:boolean;disabled:boolean;onManage:()=>void;onChange:Dispatch<SetStateAction<ChatSelection>>}) {
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [result,setResult]=useState<{key:string;data:Preview}>()
  const generation=useRef(0),trigger=useRef<HTMLButtonElement>(null),id=useId()
  const panel=useRef<HTMLElement>(null),restore=useRef<{scroll:number;focus:string}|undefined>(undefined)
  const contextKey=(value:ChatSelection)=>JSON.stringify([base,message,value.useMemory,value.skills,delegate,value.excludedMemoryIds??[],value.useSummary!==false])
  const key=contextKey(selection)
  const current=result?.key===key?result.data:undefined
  useEffect(()=>()=>{generation.current++},[])
  useLayoutEffect(()=>{
    if(busy||!current||!restore.current||!panel.current)return
    panel.current.scrollTop=restore.current.scroll
    const target=restore.current.focus==='summary'?panel.current.querySelector<HTMLInputElement>('.chat-summary-choice input'):restore.current.focus==='refresh'?panel.current.querySelector<HTMLButtonElement>('[data-context-refresh]'):[...panel.current.querySelectorAll<HTMLButtonElement>('[data-memory-choice]')].find(button=>button.dataset.memoryChoice===restore.current!.focus)
    target?.focus({preventScroll:true});restore.current=undefined
  },[current,busy])
  const load=async(value=selection)=>{
    const request=++generation.current
    setBusy(true);setError('')
    try {
      const data=await officeRequest<Preview>('POST',`${base}/context-preview`,{message,useMemory:value.useMemory,skills:value.skills,delegate,excludedMemoryIds:value.excludedMemoryIds??[],useSummary:value.useSummary!==false})
      if(generation.current===request)setResult({key:contextKey(value),data})
    }catch(e){if(generation.current===request)setError(e instanceof Error?e.message:String(e))}
    finally{if(generation.current===request)setBusy(false)}
  }
  const change=(patch:Partial<ChatSelection>,focus='refresh')=>{restore.current={scroll:panel.current?.scrollTop??0,focus};const next={...selection,...patch};onChange(next);void load(next)}
  const close=()=>{setOpen(false);trigger.current?.focus()}
  return <div className="chat-context-preview" onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();close()}}}>
    <button ref={trigger} type="button" className="chat-preview-trigger chat-icon-button" title="Tinjau konteks" aria-label="Tinjau konteks" aria-expanded={open} aria-controls={id} disabled={disabled||!message.trim()} onClick={()=>{setOpen(!open);if(!open)void load()}}><ChatIcon name="context"/><span className="chat-visually-hidden">Tinjau konteks</span></button>
    {(!!selection.excludedMemoryIds?.length || selection.useSummary===false) && <small className="chat-memory-choice-status">{[selection.excludedMemoryIds?.length?`${selection.excludedMemoryIds.length} memori dikecualikan`:'',selection.useSummary===false?'Tanpa ringkasan':''].filter(Boolean).join(' · ')}</small>}
    {open && <section ref={panel} id={id} className="chat-context-drawer chat-preview-drawer" aria-label="Tinjauan konteks pesan" aria-busy={busy}>
      <div className="chat-drawer-heading"><h3>Konteks untuk pesan ini</h3><button type="button" aria-label="Tutup tinjauan konteks" onClick={close}>×</button></div>
      <p className="chat-preview-intro">Tinjauan ini tidak memanggil model. Isi dapat berubah saat antrean dijalankan; jejak pada jawaban mencatat penggunaan akhirnya.</p>
      {busy && <p role="status">Memeriksa konteks…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !current && !error && <p role="status">Pesan atau pilihan berubah. Perbarui tinjauan sebelum melanjutkan.</p>}
      {!busy && current && <>
        <div className="chat-preview-section"><h4>Dokumen resmi</h4><p>{current.official.core.length} inti dan {current.official.references.length} referensi terpilih dari {current.official.available} dokumen. Aturan inti tetap berlaku.</p><details><summary>Lihat sumber resmi</summary><ul>{[...current.official.core,...current.official.references].map(path=><li key={path}>{path}</li>)}</ul></details></div>
        <div className="chat-preview-section"><h4>Aturan & memori</h4><p>{current.characters.toLocaleString('id-ID')} / {current.budget.toLocaleString('id-ID')} karakter catatan. {current.memoryEnabled?'Memori relevan diaktifkan.':'Memori tambahan dan ringkasan tidak disertakan.'}</p>
          {!current.notes.length && <p>Tidak ada catatan yang terpilih untuk pesan ini.</p>}
          <ul className="chat-preview-notes">{current.notes.map(note=><li key={note.id}><details><summary><strong>{note.title}</strong><span>{note.kind==='rule'?'Aturan':'Memori'} · {note.scope==='brand'?'Semua agent brand':'Agent ini'}</span></summary><p className="chat-preview-body">{note.body}</p></details><small>{note.reason}</small>{note.kind==='memory' && <button type="button" disabled={disabled||busy} data-memory-choice={note.id} onClick={()=>change({excludedMemoryIds:[...(selection.excludedMemoryIds??[]),note.id]},note.id)}>Abaikan untuk pesan ini</button>}</li>)}</ul>
          {!!current.excludedNotes?.length && <div className="chat-excluded-memories"><h4>Dikecualikan dari pesan ini</h4><ul>{current.excludedNotes.map(note=><li key={note.id}><span>{note.title}</span><button type="button" disabled={disabled||busy} aria-label={`Gunakan kembali ${note.title}`} data-memory-choice={note.id} onClick={()=>change({excludedMemoryIds:(selection.excludedMemoryIds??[]).filter(id=>id!==note.id)},note.id)}>Gunakan kembali</button></li>)}</ul></div>}
          {current.unmatchedMemories>0 && <p>{current.unmatchedMemories} memori lain tidak dipilih{current.memoryEnabled?' karena tidak masuk hasil relevansi.':' karena memori dinonaktifkan.'}</p>}
          {!!current.omitted.length && <div className="chat-preview-warning" role="status"><strong>{current.omitted.length} catatan melewati batas ukuran</strong><ul>{current.omitted.map(n=><li key={n.id}>{n.kind==='rule'?'Aturan':'Memori'}: {n.title}</li>)}</ul><p>Ringkas catatan di Memori & Rules agar dapat disertakan.</p></div>}
          <label className="chat-summary-choice"><input type="checkbox" checked={selection.useSummary!==false} disabled={disabled||busy||!current.memoryEnabled} onChange={e=>change({useSummary:e.target.checked},'summary')}/> Sertakan ringkasan percakapan</label>
          {current.summary?<details><summary>Ringkasan percakapan · versi {current.summary.revision}</summary><p className="chat-preview-body">{current.summary.text}</p></details>:<p>{current.summaryAvailable?'Ringkasan tersimpan tidak disertakan pada pesan ini.':'Tanpa ringkasan percakapan tersimpan.'}</p>}
          <p>Pilihan ini berlaku untuk pesan ini. Riwayat chat dan aturan tetap tersedia; catatan tersimpan tidak dihapus.</p>
          {delegate && <p>Spesialis mewarisi pilihan ringkasan dan pengecualian memori bersama brand. Pilihan memori pribadi Manager berlaku pada Manager.</p>}
        </div>
        {!!current.skills.length && <div className="chat-preview-section"><h4>Kemampuan yang dipilih</h4><ul>{current.skills.map(s=><li key={s.id}>{s.name}<small>{s.execution==='tool'?'Tool aplikasi · dijalankan saat pesan diproses':'Panduan kerja · mengarahkan jawaban agent'}</small></li>)}</ul></div>}
        <p className="chat-tools-note">Lampiran dan riwayat chat disiapkan saat eksekusi. Ukuran di atas hanya catatan tim, bukan estimasi total token atau biaya.</p>
      </>}
      <div className="chat-drawer-actions"><button type="button" data-context-refresh disabled={busy||!message.trim()} onClick={()=>void load()}>Perbarui tinjauan</button>{(!!selection.excludedMemoryIds?.length||selection.useSummary===false) && <button type="button" disabled={busy||disabled} onClick={()=>change({excludedMemoryIds:[],useSummary:true})}>Atur ulang pilihan pesan</button>}<button type="button" onClick={()=>{setOpen(false);onManage()}}>Kelola memori & rules</button></div>
    </section>}
  </div>
}
