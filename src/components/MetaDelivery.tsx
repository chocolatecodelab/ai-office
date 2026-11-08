import { useEffect, useId, useState } from 'react'
import { officeRequest } from '../office-api.ts'

interface Readiness {ready:boolean;configured:boolean;mode:string}
const STATES:Record<string,string>={queued:'Pengiriman otomatis aktif',preparing:'Menyiapkan gambar di Meta',publishing:'Menunggu konfirmasi Meta',published:'Diterbitkan',failed:'Pengiriman perlu diperiksa',uncertain:'Hasil pengiriman perlu dikonfirmasi',cancelled:'Pengiriman otomatis dibatalkan'}

export function MetaDelivery({brand,scheduleId,platform,state,error,caption:approvedCaption,scheduledAt,onChanged}:{brand:string;scheduleId:string;platform:string;state?:string;error?:string;caption:string;scheduledAt:string;onChanged:()=>Promise<void>}) {
  const [ready,setReady]=useState<Readiness>(),[caption,setCaption]=useState(approvedCaption)
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const id=useId()
  useEffect(()=>{
    let active=true
    officeRequest<Readiness>('GET',`/brands/${brand}/meta-publishing?platform=${platform}`).then(data=>{if(active)setReady(data)}).catch(error=>{if(active)setMessage(String(error))})
    return()=>{active=false}
  },[brand,platform])
  const run=async(work:()=>Promise<void>)=>{
    setBusy(true);setMessage('')
    try{await work();await onChanged()}catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }
  const editable=!state||['failed','cancelled'].includes(state)
  return <details className="meta-delivery">
    <summary>{state?STATES[state]:'Pengiriman otomatis melalui Meta'}</summary>
    {!ready&&<p role="status">Memeriksa kesiapan koneksi…</p>}
    {ready&&!ready.ready&&<p>Lengkapi koneksi Meta per brand dan alamat server publik di <a href="#/settings">Pengaturan</a>.</p>}
    {ready?.ready&&editable&&<>
      <p>Gambar diambil dari paket Approved. Meta mengakses salinan JPEG melalui tautan sementara saat pengiriman.</p>
      <label htmlFor={id}>Caption yang akan dipublikasikan</label>
      <textarea id={id} rows={5} value={caption} onChange={event=>setCaption(event.target.value)}/>
      <small>{caption.length.toLocaleString('id-ID')} / 2.200 karakter. Pilih teks dari caption yang disetujui. Perubahan isi memerlukan review baru.</small>
      <div className="review-decision-actions">
        <button disabled={busy} onClick={()=>void run(async()=>{
          const account=await officeRequest<{name?:string}>('POST',`/brands/${brand}/meta-publishing/test`,{platform})
          setMessage(`Akun terverifikasi${account.name?`: ${account.name}`:''}.`)
        })}>Uji akun</button>
        <button className="primary-button" disabled={busy||!caption.trim()||caption.length>2200} onClick={()=>void run(async()=>{
          await officeRequest('POST',`/brands/${brand}/social-schedule/${scheduleId}/dispatch`,{caption})
        })}>{busy?'Memproses…':new Date(scheduledAt).getTime()>Date.now()?'Aktifkan pengiriman terjadwal':'Kirim ke Meta sekarang'}</button>
      </div>
    </>}
    {state==='queued'&&<button disabled={busy} onClick={()=>void run(async()=>{
      await officeRequest('DELETE',`/brands/${brand}/social-schedule/${scheduleId}/dispatch`)
    })}>Batalkan pengiriman otomatis</button>}
    {state==='uncertain'&&<p>Periksa akun platform. Jika posting sudah terbit, gunakan Catat posting terbit untuk menyimpan tautannya.</p>}
    {error&&<p role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
  </details>
}
