import { useEffect, useId, useState } from 'react'
import { officeRequest } from '../office-api.ts'

interface Package {
  id:string;source_task_id:string;smm_task_id:string;drive_status:string;drive_error:string|null;drive_folder_id:string|null;drive_location:string
}
interface Library {folderId:string|null;packages:Package[]}

export function DriveLibrarySettings({brand}:{brand:string}) {
  const [folder,setFolder]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
  const id=useId()
  useEffect(()=>{
    let active=true
    officeRequest<Library>('GET',`/brands/${brand}/approved-library`).then(data=>{if(active)setFolder(data.folderId??'')}).catch(error=>{if(active)setMessage(String(error))})
    return()=>{active=false}
  },[brand])
  return <form className="delivery-config" onSubmit={async event=>{
    event.preventDefault();setBusy(true);setMessage('')
    try{
      const value=folder.trim()
      const folderId=value.includes('/folders/')?new URL(value).pathname.split('/folders/')[1]?.split('/')[0]:value
      await officeRequest('PUT',`/brands/${brand}/approved-library`,{folderId})
      setMessage('Folder pustaka tersimpan.')
    }catch(error){setMessage(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
  }}>
    <label htmlFor={id}>Folder pustaka brand</label>
    <div><input id={id} required value={folder} onChange={event=>setFolder(event.target.value)} placeholder="Tautan folder brand di Google Drive"/><button disabled={busy}>{busy?'Menyimpan…':'Simpan folder'}</button></div>
    <small>Paket yang disetujui disimpan ke Approved. Hubungkan ulang Google Drive untuk memberikan izin upload.</small>
    {message&&<p role="status">{message}</p>}
  </form>
}

export function ApprovedDelivery({brand,taskId,canPrepare=false}:{brand:string;taskId:string;canPrepare?:boolean}) {
  const [pack,setPack]=useState<Package>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    let active=true
    const load=()=>officeRequest<Library>('GET',`/brands/${brand}/approved-library`).then(data=>{
      if(active){setPack(data.packages.find(item=>item.source_task_id===taskId||item.smm_task_id===taskId));setError('')}
    }).catch(error=>{if(active)setError(String(error))})
    void load();const timer=setInterval(()=>void load(),15000)
    return()=>{active=false;clearInterval(timer)}
  },[brand,taskId])
  if(!pack)return <>
    {canPrepare&&<button disabled={busy} onClick={async()=>{
      setBusy(true);setError('')
      try{
        await officeRequest('POST',`/brands/${brand}/tasks/${taskId}/prepare-publication`,{})
        const updated=await officeRequest<Library>('GET',`/brands/${brand}/approved-library`)
        setPack(updated.packages.find(item=>item.source_task_id===taskId))
      }catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
    }}>{busy?'Menyiapkan…':'Teruskan ke persiapan publikasi'}</button>}
    {error&&<p role="alert">{error}</p>}
  </>
  return <section className="delivery-status" aria-label="Paket publikasi">
    <div><strong>{pack.drive_location==='published'?'Arsip publikasi':'Paket Approved'}</strong><span>{pack.drive_status==='synced'?'Tersimpan di Drive':pack.drive_status==='failed'?'Perlu sinkronisasi ulang':'Menunggu sinkronisasi Drive'}</span></div>
    {pack.drive_folder_id&&pack.drive_status==='synced'&&<a href={`https://drive.google.com/drive/folders/${pack.drive_folder_id}`} target="_blank" rel="noreferrer">Buka paket di Drive ↗</a>}
    <small>Persiapan publikasi diteruskan ke Social Media Manager brand ini.</small>
    {pack.drive_error&&<p role="alert">{pack.drive_error}</p>}
    {pack.drive_status!=='synced'&&<button disabled={busy} onClick={async()=>{
      setBusy(true);setError('')
      try{
        await officeRequest('POST',`/brands/${brand}/tasks/${pack.source_task_id}/sync-library`,{})
        const updated=await officeRequest<Library>('GET',`/brands/${brand}/approved-library`)
        setPack(updated.packages.find(item=>item.id===pack.id))
      }catch(error){setError(error instanceof Error?error.message:String(error))}finally{setBusy(false)}
    }}>{busy?'Menyinkronkan…':'Coba sinkronkan'}</button>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
