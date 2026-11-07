import { ChatArtifactReader } from './ChatArtifactReader.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'
import { approvalPending,approvalTitle,reviewDate as formatDateTime } from '../approval-review.ts'
import { AGENT_NAMES, officeRequest, type OfficeApproval } from '../office-api.ts'
import { useAgentDraft } from '../agent-drafts.ts'
import { sizeLabel } from '../download.ts'
import { ApprovedDelivery } from './ApprovedDelivery.tsx'
import { PublicationPlan } from './PublicationPlan.tsx'
import { VideoPlanReview,type VideoNarrativePlan } from './VideoPlanReview.tsx'

interface ReviewData {
  videoPlan?:VideoNarrativePlan|null
  summary?:{title:string;kind:string;slides:number}
  files:Array<{id:string;name:string;mime:string;size:number}>
  caption:string|null;content:string|null;brief:string
  visual?:{summary:string;passed:boolean;issues:Array<{slide:number;severity:string;message:string}>}|null
  qa:{critical:number;warnings:number;issues:Array<{slide:number;level:string;message:string}>}|null
}
const decisionCopy:Record<string,{button:string;effect:string}>={
  konten:{button:'Setujui hasil',effect:'Hasil ditandai disetujui. Konten tidak otomatis dipublikasikan.'},
  publikasi:{button:'Setujui untuk publikasi',effect:'Memberikan persetujuan publikasi sesuai alur brand ini.'},
  iklan:{button:'Setujui materi iklan',effect:'Persetujuan materi tidak mengaktifkan iklan atau mengubah budget.'},
  budget:{button:'Setujui budget',effect:'Mencatat persetujuan budget pada pekerjaan ini sesuai kewenangan peninjau.'},
  event:{button:'Setujui usulan',effect:'Usulan disetujui untuk melanjutkan alur pekerjaan terkait.'},
  consent:{button:'Catat persetujuan izin',effect:'Mencatat persetujuan penggunaan sesuai bukti izin yang Anda tinjau.'},
}

export function ApprovalCard({ approval, onDecided }: { approval: OfficeApproval; onDecided: (decision?:'approved'|'rejected') => void | Promise<void> }) {
  const [note,setNote]=useAgentDraft<string>(`review:${approval.id}:note`,'')
  const [revising,setRevising]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState<string>(),[loadError,setLoadError]=useState<string>()
  const [review,setReview]=useState<ReviewData>(),[retry,setRetry]=useState(0)
  const [slide,setSlide]=useState(0),[view,setView]=useState('visual')
  const [storyboardOpen,setStoryboardOpen]=useState(false)
  const submitting=useRef(false),noteId=useId()
  const task=approval.task,open=approvalPending(approval)
  const base=`/brands/${encodeURIComponent(approval.brandId)}`
  useEffect(()=>{let active=true;setLoadError(undefined);officeRequest<ReviewData>('GET',`${base}/approvals/${approval.id}/review`).then(data=>{if(active)setReview(data)}).catch(e=>{if(active)setLoadError(e instanceof Error?e.message:String(e))});return()=>{active=false}},[base,approval.id,retry,task?.updatedAt])
  const images=(review?.files??[]).filter(f=>f.mime==='image/png'&&/^slide-\d+\.png$/.test(f.name))
  const image=images[Math.min(slide,Math.max(images.length-1,0))]
  const storyboard=review?.files.find(f=>f.name==='storyboard-visual.html')
  const copy=storyboard?{button:'Setujui tinjauan visual',effect:'Keputusan visual dicatat di AI Office. Persetujuan native dan render final tidak dijalankan otomatis.'}:review?.videoPlan?{button:'Setujui rencana produksi',effect:'Naskah dan rencana adegan disetujui. Storyboard visual tetap perlu ditinjau sebelum render penuh.'}:decisionCopy[approval.approvalType]??decisionCopy.konten,qa=review?.qa
  const title=review?.summary?.title||approvalTitle(approval)
  const decide=async(decision:'approved'|'rejected')=>{
    if(submitting.current||!open||!task?.result||!review||loadError||(decision==='rejected'&&!note.trim())||(decision==='approved'&&!!qa?.critical))return
    submitting.current=true;setBusy(true);setError(undefined)
    try{await officeRequest('POST',`${base}/approvals/${approval.id}`,{decision,note});setNote('');await onDecided(decision)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{submitting.current=false;setBusy(false)}
  }
  return <article className="approval-card review-detail" aria-label={`Review ${title}`}>
    <header className="review-heading"><div><p>{AGENT_NAMES[task?.agentType??'']??'Agent'} · {images.length?`${images.length} slide carousel`:approval.review?.kind==='video-plan'?'Rencana produksi video':approval.review?.kind==='video-project'?'Draf proyek video':'Hasil pekerjaan'}</p><h2>{title}</h2><small>Diajukan {formatDateTime(approval.createdAt)}</small></div><span className={`review-state ${open?'pending':''}`}>{open?'Menunggu review':approval.review?.status==='superseded'?'Digantikan revisi':approval.decision==='approved'?'Disetujui':approval.decision==='rejected'?'Diminta revisi':'Ditutup'}</span></header>
    {loadError&&<div role="alert"><p>Hasil belum dapat dimuat. Keputusan belum dapat dikirim.</p><small>{loadError}</small><button onClick={()=>setRetry(n=>n+1)}>Muat ulang hasil</button></div>}
    {!review&&!loadError&&<p role="status">Memuat hasil untuk ditinjau…</p>}
    {review&&<>
      {storyboard&&<section className="review-text-result"><h3>Storyboard visual</h3><p>Tinjau komposisi per adegan dan contoh urutan aksi. Still belum membuktikan kelancaran gerak atau hasil audio.</p><button onClick={()=>setStoryboardOpen(true)}>Buka storyboard visual</button>{storyboardOpen&&<ChatArtifactReader name={storyboard.name} content="" base={base} assetId={storyboard.id} onClose={()=>setStoryboardOpen(false)}/>}</section>}{review.videoPlan?<VideoPlanReview plan={review.videoPlan}/>:images.length>0?<section className="review-preview" aria-label="Hasil yang ditinjau"><div className="review-view-switch"><button aria-pressed={view==='visual'} onClick={()=>setView('visual')}>Gambar ({images.length})</button>{review.caption&&<button aria-pressed={view==='caption'} onClick={()=>setView('caption')}>Caption</button>}</div>{view==='visual'&&image?<><div className="review-image-stage"><img src={`/api/office${base}/assets/${image.id}/file?inline=1`} alt={`Slide ${slide+1} dari ${images.length}: ${title}`}/></div><div className="review-image-nav"><button aria-label="Slide sebelumnya" disabled={slide===0} onClick={()=>setSlide(n=>n-1)}>←</button><span>Slide {slide+1} dari {images.length}</span><button aria-label="Slide berikutnya" disabled={slide>=images.length-1} onClick={()=>setSlide(n=>n+1)}>→</button><a href={`/api/office${base}/assets/${image.id}/file`} download={image.name}>Unduh slide</a></div><div className="review-thumbnails" aria-label="Pilih slide">{images.map((file,index)=><button key={file.id} aria-label={`Lihat slide ${index+1}`} aria-pressed={slide===index} onClick={()=>setSlide(index)}><img loading="lazy" src={`/api/office${base}/assets/${file.id}/file?inline=1`} alt=""/><span>{index+1}</span></button>)}</div></>:<div className="review-caption"><ReadOnlyMarkdown text={review.caption??''}/></div>}</section>:<section className="review-text-result"><h3>{approval.review?.kind==='video-project'?'Rencana proyek':'Hasil untuk ditinjau'}</h3>{approval.review?.kind==='video-project'?<p>Proyek video sudah disiapkan. Beat-sheet masih draf; persetujuan ini belum menyetujui storyboard atau menjalankan render video penuh.</p>:<ReadOnlyMarkdown text={review.content??task?.result??'Hasil tidak tersedia.'}/>}</section>}
      {review.visual&&<section className="review-quality" aria-label="Tinjauan visual AI"><h3>Tinjauan visual AI</h3><p>{review.visual.passed?'Tidak ada masalah visual utama menurut penilaian AI.':'Masih ada masalah visual yang perlu ditinjau.'}</p><p>{review.visual.summary}</p>{review.visual.issues.length>0&&<ul>{review.visual.issues.map((i,index)=><li key={index}>Slide {i.slide}: {i.message}</li>)}</ul>}<small>Penilaian AI setelah membaca gambar hasil render; keputusan akhir tetap milik reviewer.</small></section>}<section className="review-quality" aria-label="Catatan pemeriksaan"><h3>Yang perlu diperiksa</h3>{qa?<><p className={qa.critical?'text-bad':''}><strong>{qa.critical} masalah utama</strong> · {qa.warnings} catatan desain</p>{qa.issues.length>0&&<ul>{qa.issues.map((issue,index)=><li key={index}><span>Slide {issue.slide}</span>{issue.message}</li>)}</ul>}<small>Pemeriksaan otomatis mencakup desain. Pastikan isi, sumber, dan pesan sudah sesuai kebutuhan brand.</small></>:approval.qc?<><p>Pemeriksaan teks: {approval.qc.checks.filter(c=>c.status==='warning').length} catatan.</p><details><summary>Lihat pemeriksaan teks</summary><ul>{approval.qc.checks.map((check,index)=><li key={index}><strong>{check.label}</strong>{check.note}</li>)}</ul></details><small>Fakta, izin, dan visual tetap perlu diperiksa manusia.</small></>:<p>Belum ada laporan pemeriksaan otomatis. Tinjau isi dan sumbernya secara manual.</p>}</section>
      <details className="review-supporting"><summary>Brief dan berkas pendukung</summary><h3>Permintaan awal</h3><p className="review-brief">{review.brief||task?.brief}</p>{review.files?.length>0&&<><h3>Berkas hasil</h3><ul>{review.files.filter(f=>!/^slide-\d+\.png$/.test(f.name)).map(file=><li key={file.id}><a href={`/api/office${base}/assets/${file.id}/file`} download={file.name}>{file.name}</a><small>{sizeLabel(file.size)}</small></li>)}</ul></>}</details>
      {approval.usage&&<details className="review-supporting"><summary>Detail pemrosesan AI</summary><p>{approval.usage.model} · {approval.usage.runs} proses · {(approval.usage.inputTokens+approval.usage.outputTokens).toLocaleString('id-ID')} token</p></details>}
    </>}
    {approval.decision==='approved'&&task&&['konten.produksi','publikasi.caption'].includes(task.kind)&&<ApprovedDelivery brand={approval.brandId} taskId={task.id} canPrepare={task.kind==='konten.produksi'}/>}
    {approval.decision==='approved'&&task?.agentType==='social-media-manager'&&task.kind==='publikasi.caption'&&<PublicationPlan brand={approval.brandId} taskId={task.id} caption={task.result??''}/>}
    {!open&&approval.note&&<section><h3>{approval.decision==='rejected'?'Arahan revisi':'Catatan keputusan'}</h3><p>{approval.note}</p></section>}
    {error&&<p className="text-bad" role="alert">{error}</p>}
    {open&&<footer className="review-decision"><p><strong>{revising?'Minta revisi':'Keputusan Anda'}</strong><span>{revising?'Arahan dikirim ke agent. Hasil yang ditinjau tetap tersimpan dalam riwayat.':copy.effect}</span></p>{revising?<form onSubmit={e=>{e.preventDefault();void decide('rejected')}}><label htmlFor={noteId}>Apa yang perlu diperbaiki?</label><textarea id={noteId} autoFocus required maxLength={4000} rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder="Sebutkan bagian dan perubahan yang diinginkan, misalnya: slide 2, ringkas kalimat kedua."/><small>{approval.review?.kind==='video-project'?'Arahan dicatat pada brief proyek baru. Pengeditan dan render video penuh belum berjalan.':'Arahan dikirim ke agent untuk membuat hasil revisi.'}</small><div><button className="primary-button" disabled={busy||!review||!!loadError||!note.trim()}>{busy?'Mengirim…':'Kirim arahan revisi'}</button><button type="button" disabled={busy} onClick={()=>setRevising(false)}>Batal</button></div></form>:<div className="review-decision-actions"><button className="primary-button" disabled={busy||!review||!!loadError||!task?.result||!!qa?.critical} onClick={()=>void decide('approved')}>{busy?'Menyimpan…':copy.button}</button><button disabled={busy||!review||!!loadError||!task?.result} onClick={()=>setRevising(true)}>Minta revisi</button></div>}<small>Peninjau: {approval.approver}</small>{!!qa?.critical&&<p className="text-bad">Masalah utama perlu diperbaiki sebelum hasil dapat disetujui.</p>}</footer>}
  </article>
}
