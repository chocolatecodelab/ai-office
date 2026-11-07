import { useEffect, useId, useState } from 'react'
import { officeRequest } from '../office-api.ts'
import { MetaDelivery } from './MetaDelivery.tsx'

interface Schedule {id:string;task_id:string;platform:string;scheduled_at:string;status:string;post_url?:string|null;delivery_state?:string;delivery_error?:string;provider_id?:string}

export function PublicationPlan({brand,taskId,caption=''}:{brand:string;taskId:string;caption?:string}) {
  const [platform,setPlatform]=useState('instagram'),[scheduledAt,setScheduledAt]=useState('')
  const [items,setItems]=useState<Schedule[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [postUrl,setPostUrl]=useState(''),[publishedAt,setPublishedAt]=useState(''),[recording,setRecording]=useState<string>()
  const id=useId()
  const load=async()=>{
    const data=await officeRequest<{items:Schedule[]}>('GET',`/brands/${brand}/social-schedule`)
    setItems(data.items.filter(item=>item.task_id===taskId))
  }
  useEffect(()=>{
    let active=true
    const poll=()=>officeRequest<{items:Schedule[]}>('GET',`/brands/${brand}/social-schedule`).then(data=>{if(active)setItems(data.items.filter(item=>item.task_id===taskId))}).catch(error=>{if(active)setError(String(error))})
    void poll();const timer=setInterval(()=>void poll(),15000)
    return()=>{active=false;clearInterval(timer)}
  },[brand,taskId])
  return <section className="publication-plan" aria-label="Persiapan publikasi">
    <h3>Jadwal publikasi</h3>
    <p>Simpan waktu tayang, lalu pilih pengiriman melalui Meta atau catat hasil penerbitan dari akun platform.</p>
    <form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setError('')
      try{
        await officeRequest('POST',`/brands/${brand}/tasks/${taskId}/social-schedule`,{platform,scheduledAt:new Date(scheduledAt).toISOString()})
        await load()
      }catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
    }}>
      <label htmlFor={`${id}-platform`}>Kanal</label>
      <select id={`${id}-platform`} value={platform} onChange={event=>setPlatform(event.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select>
      <label htmlFor={`${id}-time`}>Waktu tayang · zona waktu perangkat</label>
      <input id={`${id}-time`} type="datetime-local" required value={scheduledAt} onChange={event=>setScheduledAt(event.target.value)}/>
      <button disabled={busy}>{busy?'Menyimpan…':'Simpan jadwal'}</button>
    </form>
    {items.map(item=><div key={item.id} className="publication-entry">
      <strong>{item.platform==='instagram'?'Instagram':'Facebook'}</strong>
      <span>{new Date(item.scheduled_at).toLocaleString('id-ID')} · {item.status==='published'?'Publikasi dicatat':item.status==='cancelled'?'Dibatalkan':'Direncanakan'}</span>
      {item.post_url&&<a href={item.post_url} target="_blank" rel="noreferrer">Lihat posting ↗</a>}
      {item.status==='planned'&&<MetaDelivery brand={brand} scheduleId={item.id} platform={item.platform} state={item.delivery_state} error={item.delivery_error} caption={caption} scheduledAt={item.scheduled_at} onChanged={load}/>}
      {item.status==='planned'&&item.delivery_state!=='preparing'&&(item.delivery_state!=='publishing'||item.provider_id)&&<button disabled={busy} onClick={()=>{setRecording(item.id);setPostUrl('');setPublishedAt('')}}>Catat posting terbit</button>}
      {recording===item.id&&<form onSubmit={async event=>{
        event.preventDefault();setBusy(true);setError('')
        try{
          await officeRequest('POST',`/brands/${brand}/social-schedule/${item.id}/publication`,{postUrl,publishedAt:new Date(publishedAt).toISOString()})
          setRecording(undefined);await load()
        }catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
      }}>
        <label htmlFor={`${id}-url`}>Tautan posting yang sudah terbit</label>
        <input id={`${id}-url`} type="url" required value={postUrl} onChange={event=>setPostUrl(event.target.value)} placeholder="https://www.instagram.com/p/…"/>
        <label htmlFor={`${id}-published`}>Waktu terbit · zona waktu perangkat</label>
        <input id={`${id}-published`} type="datetime-local" required value={publishedAt} onChange={event=>setPublishedAt(event.target.value)}/>
        <button disabled={busy}>{busy?'Mencatat…':'Simpan publikasi'}</button>
        <button type="button" disabled={busy} onClick={()=>setRecording(undefined)}>Batal</button>
      </form>}
    </div>)}
    {error&&<p role="alert">{error}</p>}
  </section>
}
