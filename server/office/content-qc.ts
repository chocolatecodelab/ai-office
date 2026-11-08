export interface ContentQc {
  scope: 'text-only'
  checks: Array<{ label: string; status: 'pass' | 'warning' | 'manual'; note: string }>
}

/** Deterministic text screening; never claims to verify facts, consent, links, or visual output. */
export function screenContent(content: string, checklist: string): ContentQc {
  const checks: ContentQc['checks'] = [
    {label:'Isi draft',status:content.trim() ? 'pass' : 'warning',note:content.trim() ? 'Draft berisi teks.' : 'Draft kosong.'},
    {label:'Data belum dikonfirmasi',status:/\[(?:KONFIRMASI|TODO|TBD)\b/i.test(content) ? 'warning' : 'pass',note:'Pencarian penanda KONFIRMASI/TODO/TBD; ketiadaan penanda tidak membuktikan kebenaran data.'},
    {label:'Bahasa jaminan hasil',status:/\b(?:pasti|dijamin|jaminan)\s+(?:lulus|berhasil|diterima|visa|sukses)|100\s*%\s*(?:lulus|berhasil|diterima)/i.test(content) ? 'warning' : 'pass',note:'Penyaringan frasa terbatas; reviewer tetap memeriksa klaim dalam konteks.'},
    {label:'Bagian CTA',status:/\bCTA\b|ajakan\s+bertindak/i.test(content) ? 'pass' : 'warning',note:'Memeriksa keberadaan label CTA, bukan jumlah ajakan atau validitas tautan.'},
  ]
  const official=checklist.split(/\r?\n/).map(line=>line.match(/^\s*-\s*\[[ xX]\]\s*(.+)/)?.[1]).filter((line):line is string=>Boolean(line))
  for(const label of official) checks.push({label,status:'manual',note:'Perlu diperiksa reviewer menggunakan brief, aset final, dan bukti pendukung.'})
  if(!official.length) checks.push({label:'Checklist brand',status:'manual',note:'Checklist resmi tidak tersedia; lengkapi sebelum penilaian final.'})
  return {scope:'text-only',checks}
}
