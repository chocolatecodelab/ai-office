import { readFileSync,existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const catalog:Record<string,string>={otca:'specs/khusus/otca/jalur-sesuai-profil-anak.json','info-jerman':'specs/khusus/info-jerman/b1-b2-ausbildung.json','ciao-manda':'specs/khusus/ciao-manda/cek-5-hal-kursus.json','jepang-koey':'specs/khusus/jepang-koey/kelas-malam-platinum.json'}
export function curatedDesign(root:string,brand:string){
 const path=catalog[brand]
 if(!path||!existsSync(join(root,path)))throw new Error(`Referensi desain kurasi ${brand} belum tersedia. Produksi dihentikan; tidak memakai contoh lama secara otomatis.`)
 const text=readFileSync(join(root,path),'utf8'),spec=JSON.parse(text)
 if(spec.brand!==brand||!Array.isArray(spec.slides)||spec.slides.length<3)throw new Error('Referensi kurasi tidak valid untuk brand ini.')
 let commit='unavailable',referenceTracked=false
 try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true}).trim();execFileSync('git',['ls-files','--error-unmatch',path],{cwd:root,stdio:'ignore',windowsHide:true});referenceTracked=true}catch{/* local curated references remain explicitly marked */}
 return {spec,provenance:{referencePath:path,referenceSha256:createHash('sha256').update(text).digest('hex'),engineCommit:commit,referenceTracked,mode:'curated-composition-v1'}}
}
