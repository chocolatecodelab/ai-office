import { useEffect, useRef, useState } from 'react'
import { AGENT_NAMES, TASK_STATUS_LABELS, useOfficeLive, type OfficeTask, type OfficeApproval, type OfficeAssets, type AssetItem } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { Dialog } from '../ui.tsx'
import { formatDateTime } from '../format.ts'
import { FileCard, PreviewDialog } from './FileGallery.tsx'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'
import { ApprovalCard } from './OfficeApprovalCard.tsx'
import { ManagerProgress } from './ManagerProgress.tsx'

interface DependencySource {taskId:string;assetId:string;version:number;agentType:string;title:string;summarized:boolean;cacheHit:boolean}
interface TaskDetail { task: OfficeTask; approvals: OfficeApproval[];history?:Array<{type:string;payload:{sources?:DependencySource[];counts?:Record<string,number>}}> }

export function TaskDetailDialog({ task, brandName, onClose, onChanged }: { task: OfficeTask; brandName: string; onClose: () => void; onChanged?: () => void }) {
  const base = `/brands/${encodeURIComponent(task.brandId)}`
  const detail = usePolling<TaskDetail>(`/api/office${base}/tasks/${encodeURIComponent(task.id)}`,10000)
  const files = usePolling<OfficeAssets>('/api/office/assets',30000)
  const [preview,setPreview] = useState<AssetItem>()
  const previous = useRef(document.activeElement as HTMLElement|null)
  useEffect(()=>()=>previous.current?.focus(),[])
  useOfficeLive(task.brandId,()=>{detail.refresh();files.refresh()})
  const current = detail.status==='ready' ? detail.data.task : task
  const assets = files.status==='ready' ? files.data.assets.filter(a=>a.taskId===task.id && a.brandId===task.brandId) : []
  const resultPreview = assets.find(a=>a.downloadable) ?? assets.find(a=>a.kind!=='artifact') ?? assets[0]
  const resultText = (current.text ?? current.result)?.replace(/^~~~file:([^\n]*)\n[\s\S]*?\n~~~[ \t]*$/gm,'[Berkas: $1]')
  const dependencySources=detail.status==='ready'?detail.data.history?.filter(event=>event.type==='dependency_context').at(-1)?.payload.sources??[]:[]
  const privacy=detail.status==='ready'?detail.data.history?.filter(event=>event.type==='research_privacy').at(-1):undefined
  const refresh = () => {detail.refresh();files.refresh();onChanged?.()}
  return <>{!preview && <Dialog labelledBy="task-detail-title" closeLabel="Kembali ke daftar tugas" onClose={onClose} className="task-detail-dialog">
    <header><p>{brandName} · {AGENT_NAMES[current.agentType] ?? current.agentType}</p><h2 id="task-detail-title">{current.title}</h2><span className={`badge office-status st-${current.status}`}>{TASK_STATUS_LABELS[current.status]}</span><p>Diperbarui {formatDateTime(current.updatedAt)}</p></header>
    {detail.status==='pending' && <p role="status">Memuat detail tugas…</p>}
    {detail.status==='failed' && <p role="alert">Detail terbaru belum tersedia. <button onClick={detail.refresh}>Coba lagi</button></p>}
    <section><h3>Brief</h3><p className="task-detail-text">{current.brief || 'Tidak ada brief tambahan.'}</p></section>
    {dependencySources.length>0 && <section className="task-dependency-sources"><h3>Masukan dari tahap sebelumnya</h3><p>Hanya hasil yang sudah disetujui dari workflow brand ini.</p><ul>{dependencySources.map(source=><li key={source.assetId}><strong>{source.title}</strong><small>{AGENT_NAMES[source.agentType]??source.agentType} · Versi {source.version} · {source.summarized?'Dirangkum dari seluruh hasil':'Teks lengkap'}{source.cacheHit?' · konteks dipakai ulang':''}</small></li>)}</ul></section>}
    {privacy && <section><h3>Penyaringan identitas riset</h3><p>Identitas langsung dalam teks disaring sebelum model. {Object.entries(privacy.payload.counts??{}).map(([kind,count])=>`${kind}: ${count}`).join(' · ') || 'Tidak ada pola identitas langsung terdeteksi.'}</p><p>Pemeriksaan terbatas pada pola teks. Nama dalam narasi, konteks sensitif, fakta dan izin penggunaan tetap perlu ditinjau manusia.</p></section>}
    {current.error && <p role="alert">{current.error}</p>}
    {current.kind==='konten.orchestrasi' && <ManagerProgress task={current}/>}
    <section><h3>Hasil kerja</h3>{resultPreview && <button className="refresh-button" onClick={()=>setPreview(resultPreview)}>Buka pratinjau hasil</button>}{current.result ? <div className="task-detail-text"><ReadOnlyMarkdown text={resultText ?? ''}/></div> : <p>{['queued','running','waiting_quota','revision'].includes(current.status) ? 'Hasil akan muncul setelah agent menyelesaikan pekerjaan.' : 'Belum ada hasil tersimpan untuk tugas ini.'}</p>}</section>
    <section><h3>Berkas tugas</h3>{files.status==='pending' ? <p role="status">Memuat berkas…</p> : files.status==='failed' ? <p role="alert">Berkas belum dapat dimuat. <button onClick={files.refresh}>Coba lagi</button></p> : assets.length===0 ? <p>Tugas ini belum memiliki berkas.</p> : <div className="fb-grid">{assets.map(a=><FileCard key={a.id} asset={a} showBrand={false} latest={!assets.some(other=>other.kind===a.kind && other.name===a.name && other.version>a.version)} selected={false} onOpen={()=>setPreview(a)}/>)}</div>}</section>
    {detail.status==='ready' && detail.data.approvals.length>0 && <section><h3>Persetujuan</h3>{detail.data.approvals.map(a=>a.decision ? <p key={a.id}>{a.decision==='approved' ? 'Disetujui' : 'Diminta revisi'} oleh {a.approver}{a.note ? `: ${a.note}` : ''}</p> : <ApprovalCard key={a.id} approval={{...a,task:current}} onDecided={refresh}/>)}</section>}
  </Dialog>}{preview && <PreviewDialog key={preview.id} asset={preview} onClose={()=>setPreview(undefined)} onChanged={refresh}/>}</>
}
