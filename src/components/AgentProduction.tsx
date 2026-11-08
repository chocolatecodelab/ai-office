import { ProductionAssetPicker,type AssetBinding } from './ProductionAssetPicker.tsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { officeRequest, TASK_STATUS_LABELS, type TaskStatus } from '../office-api.ts'

interface ProductionState {
  engine?:{configured:boolean;ready:boolean;error?:string;checks:Array<{name:string;ready:boolean}>}
  context?:{version:string;files:string[]}
  presets:Array<{id:string;label:string}>
  jobs:Array<{taskId:string;title:string;status:TaskStatus;error?:string;report:{files?:string[]}}>
}
export function AgentProduction({base,agent,onCreated,onFiles,onChat}:{base:string;agent:string;onCreated:()=>void;onFiles:()=>void;onChat?:()=>void}){
  const [state,setState]=useState<ProductionState>()
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[title,setTitle]=useState(''),[brief,setBrief]=useState('')
  const [spec,setSpec]=useState<Record<string,unknown>>(),[fileName,setFileName]=useState(''),[preset,setPreset]=useState(''),[busy,setBusy]=useState(false)
  const [assetBindings,setAssetBindings]=useState<AssetBinding[]>([])
  const [technical,setTechnical]=useState(false)
  const lock=useRef(false)
  const content=agent==='content-creator'
  const endpoint=`${base}/production`
  const reload=useCallback(async()=>{try{const result=await officeRequest<ProductionState>('GET',endpoint);setState(result);setError('')}catch(e){setError(String(e))}},[endpoint])
  useEffect(()=>{void reload()},[reload])
  const running=state?.jobs.some(job=>['queued','running'].includes(job.status))
  useEffect(()=>{if(!running)return;const timer=setInterval(()=>void reload(),5000);return()=>clearInterval(timer)},[running,reload])
  async function submit(){
    if(lock.current)return
    lock.current=true;setBusy(true);setError('');setNotice('')
    try{
      if(!content){
        const style=preset?'\nGunakan preset '+preset:'\nPilih preset sesuai isi dan brand.'
        await officeRequest('POST',base+'/chat',{message:'Siapkan rencana produksi video. Judul: '+title+'\nBrief: '+brief+style})
        onCreated();onChat?.();return
      }
      if(content&&!technical){
        await officeRequest('POST',base+'/chat',{message:'Buatkan carousel untuk brand ini. Judul pekerjaan: '+title+'\nBrief: '+brief+'\nGunakan panduan dan desain brand yang tersedia. Hasilkan gambar carousel dan caption sebagai draf untuk review, bukan publikasi.'})
        onCreated();onChat?.();return
      }
      await officeRequest('POST',endpoint,{title,brief,spec,assetBindings})
      setNotice('Tugas render masuk antrean. Hasil akan muncul di Folder setelah QA.')
      await reload();onCreated()
    }catch(e){setError(String(e))}finally{lock.current=false;setBusy(false)}
  }
  return <details className="agent-production"><summary><span>Produksi {content?'carousel':'video'}</span><small>{!state?'Memeriksa mesin…':state.engine?.ready?'Mesin lokal siap':'Perlu konfigurasi'}</small></summary>
    <div className="agent-production-body">
      <p>{content?'Ceritakan konten yang Anda butuhkan. Agent menyusun copy dan desain sesuai brand, menjalankan QA, lalu mengirim gambar dan caption di Chat untuk ditinjau.':'Susun naskah dan rencana adegan dari brief. Lampirkan footage melalui Chat agar bahan terhubung ke proyek. Storyboard visual dan render mengikuti review tahap produksi.'}</p>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {state&&!state.engine?.ready&&<div className="agent-empty"><p>Mesin belum siap. Periksa lokasi proyek di konfigurasi server dan dependensi pipeline.</p>{state.engine?.checks.filter(c=>!c.ready).map(c=><small key={c.name}>{c.name}<br/></small>)}{state.engine?.error&&<p>{state.engine.error}</p>}<button type="button" onClick={()=>void reload()}>Periksa lagi</button></div>}
      <form onSubmit={e=>{e.preventDefault();void submit()}}>
        <label>Nama pekerjaan<input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder={content?'Carousel edukasi minggu ini':'Reels pengenalan program'}/></label>
        <label>Brief<textarea required rows={3} maxLength={12000} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Tujuan, audiens, pesan utama, dan arahan produksi…"/></label>
        {content?<><label className="agent-context-confirm"><input type="checkbox" checked={technical} onChange={e=>setTechnical(e.target.checked)}/> Pengaturan teknis untuk desainer</label>{technical&&<label>Spesifikasi carousel (.json)<input type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];setSpec(undefined);setAssetBindings([]);setFileName('');if(!file)return;try{if(file.size>80000)throw new Error('Maksimal 80 KB.');const data=JSON.parse(await file.text());if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('Pilih objek spesifikasi JSON.');setSpec(data);setFileName(file.name)}catch(error){setError(String(error))}}}/><small>{fileName||'Gunakan design-spec.json atau spesifikasi dari folder specs mesin Content Creator.'}</small></label>}</>:<label>Arah gaya (opsional)<select value={preset} onChange={e=>setPreset(e.target.value)}><option value="">Agent memilih sesuai brief</option>{state?.presets.map(p=><option value={p.id} key={p.id}>{p.label}</option>)}</select></label>}
        {content&&technical&&spec&&<ProductionAssetPicker key={fileName} base={base} spec={spec} value={assetBindings} onChange={setAssetBindings} disabled={busy}/>}
        <div className="agent-inline-actions"><button className="primary-button" disabled={busy||!state?.engine?.ready||!title.trim()||!brief.trim()||(content&&technical&&!spec)}>{busy?'Menyiapkan…':content?(technical?'Render spesifikasi':'Buat carousel'):'Susun rencana video'}</button><button type="button" onClick={onFiles}>Buka hasil di Folder</button></div>
      </form>
      {!!state?.context?.files.length&&<details><summary>Sumber mesin ({state.context.files.length})</summary><ul>{state.context.files.map(file=><li key={file}>{file}</li>)}</ul><small>Versi {state.context.version}</small></details>}
      {!!state?.jobs.length&&<div className="agent-production-jobs" aria-label="Produksi terbaru">{state.jobs.map(job=><article key={job.taskId}><strong>{job.title}</strong><span>{TASK_STATUS_LABELS[job.status]}</span>{job.error&&<p role="alert">{job.error}</p>}{!!job.report.files?.length&&<small>{job.report.files.length} berkas tersedia di Folder</small>}</article>)}</div>}
    </div>
  </details>
}
