import { useAgentDraft } from '../agent-drafts.ts'
import { officeRequest, type OfficeTask } from '../office-api.ts'

const KINDS: Record<string, string[]> = {
  manager: ['konten.orchestrasi','konten.brief'], 'event-specialist': ['event.brief'], 'content-creator': ['konten.carousel','konten.caption','konten.script','konten.riset'],
  'video-editor': ['video.storyboard','video.edit-plan'], 'social-media-manager': ['publikasi.kalender','publikasi.caption'],
  'digital-marketing': ['iklan.brief','iklan.copy'],
}
const KIND_LABELS: Record<string,string> = {'konten.riset':'Riset audiens (identitas disaring)','konten.orchestrasi':'Delegasikan ke tim','konten.brief':'Brief konten','event.brief':'Brief event','konten.carousel':'Carousel','konten.caption':'Caption','konten.script':'Naskah video','video.storyboard':'Storyboard','video.edit-plan':'Rencana editing','publikasi.kalender':'Kalender publikasi','publikasi.caption':'Caption publikasi','iklan.brief':'Brief iklan','iklan.copy':'Teks iklan'}
export function OfficeTaskForm({ brand, agent, disabled, submit, expanded = false, onCreated }: { brand: string; agent: string; disabled: boolean; submit: (work: () => Promise<unknown>) => Promise<void>; expanded?: boolean; onCreated?: (task: OfficeTask) => void }) {
  const draftKey = brand+'/'+agent+'/task'
  const [title,setTitle] = useAgentDraft<string>(draftKey+'/title','')
  const [brief,setBrief] = useAgentDraft<string>(draftKey+'/brief','')
  const kinds=KINDS[agent] ?? ['konten.brief']
  const [kind,setKind] = useAgentDraft<string>(draftKey+'/kind',kinds[0])
  const [priority,setPriority] = useAgentDraft<number>(draftKey+'/priority',2)
  const [urgent,setUrgent] = useAgentDraft<boolean>(draftKey+'/urgent',false)
  const [complex,setComplex] = useAgentDraft<boolean>(draftKey+'/complex',false)
  return <details className="office-new-task" open={expanded || undefined}><summary>Beri tugas baru</summary><form onSubmit={e => {
    e.preventDefault()
    if(disabled || !title.trim() || !brief.trim()) return
    void submit(async () => {
      const created = await officeRequest<OfficeTask>('POST',`/brands/${encodeURIComponent(brand)}/tasks`,{agentType:agent,kind,title:title.trim(),brief:brief.trim(),priority,urgent,complex})
      setTitle(previous=>previous.trim()===title.trim()?'':previous);setBrief(previous=>previous.trim()===brief.trim()?'':previous)
      onCreated?.(created)
    })
  }}>
    {(title || brief) && <p>Draft tetap tersedia saat panel ditutup. Memuat ulang halaman akan menghapusnya. <button type="button" disabled={disabled} onClick={()=>{setTitle('');setBrief('');setKind(kinds[0]);setPriority(2);setUrgent(false);setComplex(false)}}>Hapus draft</button></p>}
    <label>Judul tugas<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>Brief<textarea required maxLength={12000} rows={4} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Tujuan, target audiens, hasil yang dibutuhkan, dan batasan"/></label>
    <div className="office-task-options"><label>Jenis hasil<select value={kind} onChange={e=>setKind(e.target.value)}>{kinds.map(k=><option value={k} key={k}>{KIND_LABELS[k] ?? k}</option>)}</select></label>
    <label>Prioritas<select value={priority} onChange={e=>setPriority(Number(e.target.value))}><option value={1}>Tinggi</option><option value={2}>Normal</option><option value={3}>Rendah</option></select></label></div>
    <label><input type="checkbox" checked={complex} onChange={e=>setComplex(e.target.checked)}/> Memerlukan analisis mendalam</label>
    <label><input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/> Mendesak — gunakan pool Claude berbayar</label>
    {kind==='konten.riset' && <p>Gunakan kutipan teks yang sudah disamarkan. Email, nomor HP Indonesia, NIK dan identitas berlabel disaring sebelum model. Nama bebas dan konteks sensitif tetap perlu diperiksa manusia. Gambar/scan mentah tidak dikirim dalam tugas riset.</p>}
    <p>Hasil dikirim ke approval sesuai jenis pekerjaan.</p><button disabled={disabled || !title.trim() || !brief.trim()}>Kirim tugas</button>
  </form></details>
}
