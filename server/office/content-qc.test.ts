import {expect,it} from 'vitest'
import {screenContent} from './content-qc.js'
it('flags unresolved data and promises without pretending manual checks passed',()=>{
 const report=screenContent('Dijamin lulus. [KONFIRMASI: tanggal]\nCTA: Daftar','- [ ] Logo resmi\n- [ ] Izin testimoni')
 expect(report.scope).toBe('text-only')
 expect(report.checks.filter(c=>c.status==='warning').map(c=>c.label)).toEqual(['Data belum dikonfirmasi','Bahasa jaminan hasil'])
 expect(report.checks.filter(c=>c.status==='manual').map(c=>c.label)).toEqual(['Logo resmi','Izin testimoni'])
})
it('reports a missing checklist and does not equate plain text with a verified design',()=>{
 const report=screenContent('Headline: Belajar bahasa','')
 expect(report.checks.find(c=>c.label==='Bagian CTA')?.status).toBe('warning')
 expect(report.checks.find(c=>c.label==='Checklist brand')?.status).toBe('manual')
})
