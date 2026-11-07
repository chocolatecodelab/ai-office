import { useEffect, useRef, useState } from 'react'
import { officeRequest } from '../office-api.ts'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'

/** Isolated reader: HTML cannot execute scripts or access the parent application. */
export function ChatArtifactReader({name,content,base,assetId,onClose}:{name:string;content:string;base:string;assetId?:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null)
  const [text,setText]=useState(content)
  const [error,setError]=useState('')
  const [mode,setMode]=useState<'preview'|'source'>('preview')
  const [copied,setCopied]=useState(false)
  useEffect(()=>{const node=dialog.current;const previous=document.activeElement as HTMLElement|null;node?.showModal();return()=>{node?.close();previous?.focus()}},[])
  useEffect(()=>{if(!assetId)return;let active=true;officeRequest<{content:string}>('GET',`${base}/assets/${assetId}`).then(r=>{if(active)setText(r.content)}).catch(e=>{if(active)setError(String(e))});return()=>{active=false}},[base,assetId])
  const video=/\.mp4$/i.test(name)
  const html=/\.html?$/i.test(name), markdown=/\.md$/i.test(name)
  let source=text
  if(/\.json$/i.test(name)){try{source=JSON.stringify(JSON.parse(text),null,2)}catch{/* Preserve invalid JSON verbatim. */}}
  return <dialog ref={dialog} className="artifact-reader" onCancel={e=>{e.preventDefault();e.stopPropagation();onClose()}} onKeyDown={e=>e.stopPropagation()}>
    <header><div><h2>{name}</h2><small>Pratinjau berkas</small></div><button type="button" onClick={onClose} aria-label="Tutup berkas">×</button></header>
    <nav aria-label="Tampilan berkas">{(html||markdown)&&<><button aria-pressed={mode==='preview'} onClick={()=>setMode('preview')}>Pratinjau</button><button aria-pressed={mode==='source'} onClick={()=>setMode('source')}>Kode sumber</button></>}<button hidden={video} onClick={()=>{navigator.clipboard.writeText(text).then(()=>setCopied(true)).catch(()=>setError('Tidak dapat menyalin. Pilih teks pada kode sumber.'))}}>{copied?'Tersalin':'Salin isi'}</button>{assetId&&<a href={`/api/office${base}/assets/${assetId}/file`} download={name}>Unduh</a>}</nav>
    {error&&<p role="alert">{error}</p>}
    <div className="artifact-reader-body">{video&&assetId?<video controls playsInline preload="metadata" aria-label={name} style={{width:'100%',height:'100%',background:'#000'}} src={`/api/office${base}/assets/${assetId}/file?inline=1`}/>:mode==='preview'&&html?<iframe title={name} sandbox="" referrerPolicy="no-referrer" srcDoc={text}/>:mode==='preview'&&markdown?<ReadOnlyMarkdown text={text}/>:<pre tabIndex={0}><code>{source}</code></pre>}</div>
  </dialog>
}
