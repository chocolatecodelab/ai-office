import { useState } from 'react'
import { officeRequest } from '../office-api.ts'

const KINDS: Record<string, string[]> = {
  manager: ['konten.brief'], 'event-specialist': ['event.brief'], 'content-creator': ['konten.carousel','konten.caption','konten.script'],
  'video-editor': ['video.storyboard','video.edit-plan'], 'social-media-manager': ['publikasi.kalender','publikasi.caption'],
  'digital-marketing': ['iklan.brief','iklan.copy'],
}
export function OfficeTaskForm({ brand, agent, disabled, submit }: { brand: string; agent: string; disabled: boolean; submit: (work: () => Promise<unknown>) => Promise<void> }) {
  const [title,setTitle] = useState('')
  const [brief,setBrief] = useState('')
  const kinds=KINDS[agent] ?? ['konten.brief']
  const [kind,setKind] = useState(kinds[0])
  const [priority,setPriority] = useState(2)
  const [urgent,setUrgent] = useState(false)
  const [complex,setComplex] = useState(false)
  return <details className="office-new-task"><summary>Beri tugas baru</summary><form onSubmit={e => {
    e.preventDefault()
    if(disabled || !title.trim() || !brief.trim()) return
    void submit(async () => {
      await officeRequest('POST',`/brands/${encodeURIComponent(brand)}/tasks`,{agentType:agent,kind,title:title.trim(),brief:brief.trim(),priority,urgent,complex})
      setTitle('');setBrief('')
    })
  }}>
    <label>Judul tugas<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Brief<textarea required maxLength={12000} rows={4} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Tujuan, target audiens, hasil yang dibutuhkan, dan batasan"/></label>
    <div className="office-task-options"><label>Jenis hasil<select value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>
    <label>Prioritas<select value={priority} onChange={e=>setPriority(Number(e.target.value))}><option value={1}>Tinggi</option><option value={2}>Normal</option><option value={3}>Rendah</option></select></label></div>
    <label><input type="checkbox" checked={complex} onChange={e=>setComplex(e.target.checked)}/> Memerlukan analisis mendalam</label>
    <label><input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/> Mendesak — gunakan pool Claude berbayar</label>
    <p>Hasil dikirim ke approval sesuai jenis pekerjaan.</p><button disabled={disabled || !title.trim() || !brief.trim()}>Kirim tugas</button>
  </form></details>
}
