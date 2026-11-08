import { PaginatedItems } from './PaginatedItems.tsx'
import { useState } from 'react'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import { approvalPending,approvalTitle,reviewDate as formatDateTime } from '../approval-review.ts'
import { AGENT_NAMES,type OfficeApproval } from '../office-api.ts'

export function ApprovalWorkspace({approvals,onReload,brandNames={}}:{approvals:OfficeApproval[];onReload:()=>void|Promise<void>;brandNames?:Record<string,string>}){
  const [mode,setMode]=useState('pending'),[selection,setSelection]=useState(''),[notice,setNotice]=useState('')
  const pending=approvals.filter(approvalPending),history=approvals.filter(a=>!approvalPending(a))
  const list=(mode==='pending'?pending:history).slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  const label=(a:OfficeApproval)=>`${a.review?.revision?'Revisi · ':''}${approvalTitle(a)}${brandNames[a.brandId]?` · ${brandNames[a.brandId]}`:''}`
  return <section className="review-workspace-shell" aria-label="Review hasil agent"><div className="review-inbox-tabs"><button aria-pressed={mode==='pending'} onClick={()=>setMode('pending')}>Menunggu ({pending.length})</button><button aria-pressed={mode==='history'} onClick={()=>setMode('history')}>Riwayat ({history.length})</button></div>{notice&&<p className="review-notice" role="status">{notice}</p>}
    {!list.length?<div className="agent-empty"><h3>{mode==='pending'?'Tidak ada yang menunggu':'Belum ada riwayat keputusan'}</h3><p>{mode==='pending'?'Hasil baru yang perlu Anda periksa akan muncul di sini.':'Hasil yang sudah ditinjau atau ditutup akan tersimpan di sini.'}</p></div>:<PaginatedItems items={list} scope={mode} label="hasil">{rows=>{const selected=rows.find(a=>a.id===selection)??rows[0];return <div className="review-workspace"><div className="review-inbox"><label className="review-result-picker">{mode==='pending'?'Pilih hasil untuk ditinjau':'Pilih riwayat hasil'}<select value={selected?.id??''} onChange={e=>setSelection(e.target.value)}>{rows.map(a=><option value={a.id} key={a.id}>{label(a)} · {formatDateTime(a.createdAt)}</option>)}</select></label><div className="review-inbox-list" aria-label="Daftar hasil">{rows.map(a=><button key={a.id} aria-pressed={selected?.id===a.id} onClick={()=>setSelection(a.id)}><strong>{approvalTitle(a)}</strong><span>{brandNames[a.brandId]??AGENT_NAMES[a.task?.agentType??'']??'Agent'} · {a.review?.slides?`${a.review.slides} slide`:a.approvalType}</span><small>{formatDateTime(a.createdAt)}{a.task?.title.startsWith('[QA]')?' · Pengujian':''}{/^Revisi\b/i.test(a.task?.brief??'')?' · Revisi':''}</small></button>)}</div></div>{selected&&<ApprovalCard key={selected.id} approval={selected} onDecided={async decision=>{setNotice(decision==='rejected'?'Arahan revisi dikirim. Hasil perbaikan akan muncul sebagai review baru.':'Keputusan disimpan. Hasil ini dipindahkan ke Riwayat.');await onReload()}}/>}</div>}}</PaginatedItems>}
  </section>
}
