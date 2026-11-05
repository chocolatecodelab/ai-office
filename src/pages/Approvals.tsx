import { useCallback, useEffect, useRef, useState } from 'react'
import { ApprovalCard } from '../components/OfficeApprovalCard.tsx'
import { officeRequest, useOfficeLive, type OfficeApproval, type OfficeBrand } from '../office-api.ts'
import { EmptyState, PageTitle } from '../ui.tsx'

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
      const batches=await Promise.all(list.map(b=>officeRequest<OfficeApproval[]>('GET',`/brands/${encodeURIComponent(b.id)}/approvals?open=1`)))
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
    <PageTitle eyebrow="PERSETUJUAN" title="Persetujuan">Tinjau hasil kerja semua brand. Hasil tetap menunggu keputusan sesuai alur persetujuan.</PageTitle>
    {brands.map(b=><BrandUpdates key={b.id} brand={b.id} reload={()=>void load()}/>)}
    <div className="management-toolbar" role="group" aria-label="Filter persetujuan"><label>Brand<select value={brand} onChange={e=>setBrand(e.target.value)}><option value="all">Semua brand</option>{brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label><span role="status">{approvals ? `${visible?.length ?? 0} menunggu keputusan` : 'Memuat persetujuan…'}</span><button className="refresh-button" disabled={loading} onClick={()=>void load()}>Segarkan persetujuan</button></div>
    {loading && !approvals && <p role="status" aria-busy="true">Memuat hasil dari semua brand…</p>}
    {error && <section className="notice" role="alert"><strong>Persetujuan belum dapat diperbarui.</strong><p>{approvals?'Menampilkan data terakhir. ':''}{error}</p><button className="refresh-button" onClick={()=>void load()}>Coba lagi</button></section>}
    {!loading && !error && visible?.length===0 && <EmptyState title="Tidak ada yang menunggu">{brand==='all'?'Tidak ada persetujuan terbuka di seluruh brand.':'Tidak ada persetujuan terbuka untuk brand yang dipilih.'}</EmptyState>}
    <div className="approval-list">{visible?.map(a=><section key={a.id} aria-label={`Persetujuan ${brands.find(b=>b.id===a.brandId)?.name ?? a.brandId}`}><p className="approval-brand-label">{brands.find(b=>b.id===a.brandId)?.name ?? a.brandId}</p><ApprovalCard approval={a} onDecided={load}/></section>)}</div>
  </div>
}
