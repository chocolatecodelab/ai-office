import { useCallback, useEffect, useRef, useState } from 'react'
import { approvalPending } from '../approval-review.ts'
import { ApprovalWorkspace } from '../components/ApprovalWorkspace.tsx'
import { officeRequest, useOfficeLive, type OfficeApproval, type OfficeBrand } from '../office-api.ts'
import { PageTitle } from '../ui.tsx'

function BrandUpdates({brand,reload}:{brand:string;reload:()=>void}) {
  useOfficeLive(brand,reload)
  return null
}

export function Approvals() {
  const [brands,setBrands]=useState<OfficeBrand[]>([])
  const [brand,setBrand]=useState('all')
  const [approvals,setApprovals]=useState<OfficeApproval[]>()
  const [error,setError]=useState<string>()
  const [loading,setLoading]=useState(true)
  const generation=useRef(0)
  const load=useCallback(async()=>{
    const request=++generation.current
    setLoading(true)
    try {
      const list=await officeRequest<OfficeBrand[]>('GET','/brands')
      if(request!==generation.current)return
      setBrands(list)
      const batches=await Promise.all(list.map(b=>officeRequest<OfficeApproval[]>('GET',`/brands/${encodeURIComponent(b.id)}/approvals`)))
      if(request!==generation.current)return
      setApprovals(batches.flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))
      setError(undefined)
    } catch(failure) {
      if(request===generation.current)setError(failure instanceof Error?failure.message:'Persetujuan belum dapat dimuat.')
    } finally {if(request===generation.current)setLoading(false)}
  },[])
  const invalidate=useCallback(()=>{generation.current+=1},[])
  useEffect(()=>{void load();return invalidate},[load,invalidate])
  const visible=approvals?.filter(a=>brand==='all'||a.brandId===brand)
  return <div className="management-page approvals-page">
    <PageTitle eyebrow="HASIL KERJA" title="Review hasil">Pilih hasil, periksa isi dan catatan kualitasnya, lalu ambil keputusan untuk brand terkait.</PageTitle>
    {brands.map(b=><BrandUpdates key={b.id} brand={b.id} reload={()=>void load()}/>)}
    <div className="management-toolbar" role="group" aria-label="Filter persetujuan"><label>Brand<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="all">Semua brand</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><span role="status">{approvals ? `${visible?.filter(approvalPending).length ?? 0} menunggu keputusan` : 'Memuat persetujuan…'}</span><button className="refresh-button" disabled={loading} onClick={()=>void load()}>Segarkan persetujuan</button></div>
    {loading && !approvals && <p role="status" aria-busy="true">Memuat hasil dari semua brand…</p>}
    {error && <section className="notice" role="alert"><strong>Persetujuan belum dapat diperbarui.</strong><p>{approvals?'Menampilkan data terakhir. ':''}{error}</p><button className="refresh-button" onClick={()=>void load()}>Coba lagi</button></section>}
    {visible&&<div className="approval-list"><ApprovalWorkspace approvals={visible} onReload={load} brandNames={Object.fromEntries(brands.map(b=>[b.id,b.name]))}/></div>}
  </div>
}
