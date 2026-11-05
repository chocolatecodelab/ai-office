import { createHash } from 'node:crypto'
import type { ContextFile } from '../otca-context.js'

const hash=(text:string)=>createHash('sha256').update(text).digest('hex').slice(0,20)
/** Never retrieve away policy, role, approval, or brand facts. Optional reference files are request-specific. */
export function selectOfficialContext(files:ContextFile[],agent:string,query:string,conversation:boolean) {
  const optional=(file:ContextFile)=>/\/(raci\.md|visual\.json|checklist-publikasi\.md|agents\.json)$/.test(file.path)
  const core=files.filter(f=>!optional(f))
  const allOptional=files.filter(optional)
  const text=query.toLowerCase()
  const light=/^(halo|hai|hi|hello|terima kasih|makasih|thanks|oke|ok|siap|apa kabar)[\s!.?]*$/i.test(text.trim())
  const visual=/konten|caption|carousel|gambar|visual|warna|font|desain|video|naskah|reels|posting|publikasi|tulis|buat|draft|revisi|brand|gaya|tone/.test(text)
  const routing=/delegasi|pemilik|penanggung|tanggung jawab|raci|tim|spesialis|agent lain|handoff|orkestr/.test(text)
  const continuation=/^(lanjut|lanjutkan|perbaiki|ulang|revisi|itu|yang tadi)\b/.test(text.trim())
  const references=allOptional.filter(f=>{
    if(!conversation || continuation)return true
    if(light)return false
    if(f.path.endsWith('raci.md')||f.path.endsWith('agents.json'))return agent==='manager'||routing
    if(visual)return true
    // Questions about a role/model need no visual production checklist. Unknown intents fail open to more context.
    return !/peran|fungsi|model|kemampuan|status|bisa bantu|tugasmu/.test(text)
  })
  return {core,references,version:hash(files.map(f=>f.path+'\n'+f.content).join('\n')),coreVersion:hash(core.map(f=>f.path+'\n'+f.content).join('\n')),fullChars:files.reduce((n,f)=>n+f.content.length,0),selectedChars:[...core,...references].reduce((n,f)=>n+f.content.length,0)}
}

export interface HistoryTurn {id:string;brief:string;result:string|null;createdAt:string}
export function boundedHistory(turns:HistoryTurn[],budget=12000) {
  let remaining=budget;const selected:Array<{id:string;brief:string;result:string}>=[]
  for(const turn of turns){
    if(remaining<120)break
    const brief=turn.brief.slice(0,Math.min(2000,Math.floor(remaining*.4)))
    const result=(turn.result??'').replace(/^~~~file:[^\n]+\n[\s\S]*?\n~~~[ \t]*$/gm,'[Berkas tersedia pada riwayat; pilih lampiran untuk membacanya.]').slice(0,Math.min(4000,remaining-brief.length-60))
    const cost=brief.length+result.length+60
    if(cost>remaining)break
    selected.push({id:turn.id,brief,result});remaining-=cost
  }
  return {turns:selected.reverse(),characters:budget-remaining,omitted:turns.length-selected.length,budget}
}
