import { useEffect,useState } from 'react'
import { officeRequest } from '../office-api.ts'
export type AssetBinding={assetId:string;path:string}
export function ProductionAssetPicker({base,spec,value,onChange,disabled}:{base:string;spec:Record<string,unknown>;value:AssetBinding[];onChange:(v:AssetBinding[])=>void;disabled:boolean}){
 const [assets,setAssets]=useState<{id:string;name:string;mime:string;status:string}[]>([]),[error,setError]=useState('')
 useEffect(()=>{let active=true;officeRequest<typeof assets>('GET',base+'/production/asset-library').then(a=>{if(active)setAssets(a)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[base])
 const slots:string[]=[]
 const visit=(v:unknown,p:string)=>{if(Array.isArray(v))v.forEach((x,i)=>visit(x,`${p}.${i}`));else if(v&&typeof v==='object')for(const[k,x]of Object.entries(v)){const path=p?`${p}.${k}`:k;if(k==='src'&&typeof x==='string'&&(path.startsWith('slides.')||path==='background.src'))slots.push(path);else visit(x,path)}};visit(spec,'')
 return <fieldset disabled={disabled}><legend>Bahan desain</legend><p>Pilih pengganti pada slot gambar yang tersedia. Kosongkan untuk memakai aset bawaan desain. Hanya bahan brand ini yang izinnya aktif ditampilkan.</p>{error&&<p role="alert">{error}</p>}{!slots.length&&<p>Desain ini belum memiliki slot foto yang dapat diganti.</p>}{slots.map(path=><label key={path}>{path==='background.src'?'Latar seluruh carousel':`Slide ${Number(path.split('.')[1])+1} — ${path.split('.').slice(2,-1).join(' ')}`}<select value={value.find(b=>b.path===path)?.assetId??''} onChange={e=>onChange([...value.filter(b=>b.path!==path),...(e.target.value?[{path,assetId:e.target.value}]:[])])}><option value="">Aset bawaan desain</option>{assets.filter(a=>a.status==='cleared'&&['image/png','image/jpeg','image/webp'].includes(a.mime)).map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>)}</fieldset>
}
