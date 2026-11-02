import { useCallback, useEffect, useRef, useState } from 'react'
import { ApprovalCard } from '../components/OfficeApprovalCard.tsx'
import { officeRequest, useOfficeLive, type OfficeApproval, type OfficeBrand } from '../office-api.ts'
import { EmptyState, PageTitle } from '../ui.tsx'

// The Approval box (FR-20–FR-22): every result waits here for the person the approval matrix names.
// Rejecting needs a note, which goes back to the agent as its revision brief.


export function Approvals() {
  const [brands, setBrands] = useState<OfficeBrand[]>([])
  const [brand, setBrand] = useState('otca')
  const [approvals, setApprovals] = useState<OfficeApproval[]>()
  const [error, setError] = useState<string>()
  const [loadedBrand,setLoadedBrand] = useState('')
  const generation=useRef(0)

  const load = useCallback(async () => {
    const request=++generation.current
    try {
      const [brandList, open] = await Promise.all([
        officeRequest<OfficeBrand[]>('GET', '/brands'),
        officeRequest<OfficeApproval[]>('GET', `/brands/${brand}/approvals?open=1`),
      ])
      if(request!==generation.current) return
      setLoadedBrand(brand)
      setBrands(brandList)
      setApprovals(open)
      setError(undefined)
    } catch (failure) {
      if(request!==generation.current) return
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }, [brand])

  useEffect(() => { void load() }, [load])
  useOfficeLive(brand, () => { void load() })

  return <>
    <PageTitle eyebrow="APPROVAL" title="Kotak Approval">Hasil kerja agen menunggu keputusan manusia sesuai matriks approval. Tidak ada yang dipublikasikan atau dipakai sebelum disetujui.</PageTitle>
    <div className="chip-row office-brands" role="tablist" aria-label="Brand">
      {brands.map((item) => <button key={item.id} type="button" role="tab" aria-selected={brand === item.id} className={`chip chip-button${brand === item.id ? ' active' : ''}`} onClick={() => setBrand(item.id)}>
        <span className="brand-swatch" style={{ background: item.color }}/>{item.name}
      </button>)}
    </div>
    {error && <section className="notice" role="alert"><strong>Office API belum siap.</strong> {error}</section>}
    {loadedBrand===brand && approvals && approvals.length === 0 && <EmptyState title="Tidak ada yang menunggu">Semua hasil kerja brand ini sudah diputuskan.</EmptyState>}
    <div className="approval-list">{loadedBrand===brand && approvals?.map((approval) => <ApprovalCard key={approval.id} approval={approval} onDecided={() => void load()}/>)}</div>
  </>
}
