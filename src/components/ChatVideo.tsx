import { useState } from 'react'
import { sizeLabel } from '../download.ts'

export function ChatVideo({base,file}:{base:string;file:{assetId:string;name:string;size?:number;posterId?:string;subtitleId?:string;srtId?:string}}){
  const [failed,setFailed]=useState(false)
  const url=`/api/office${base}/assets/${encodeURIComponent(file.assetId)}/file`
  return <figure className="chat-inline-video">
    <video controls playsInline preload="metadata" aria-label={`Video ${file.name}`} poster={file.posterId?`/api/office${base}/assets/${file.posterId}/file?inline=1`:undefined} src={`${url}?inline=1`} onError={()=>setFailed(true)}>
      {file.subtitleId&&<track kind="subtitles" srcLang="id" label="Bahasa Indonesia" src={`/api/office${base}/assets/${file.subtitleId}/file?inline=1`}/>}
      Browser Anda tidak mendukung pemutaran video. Gunakan tautan unduh di bawah.
    </video>
    {failed&&<p role="status">Video ini tidak dapat diputar di browser. Unduh untuk membukanya di pemutar video.</p>}
    <figcaption><span><strong>{file.name}</strong>{file.size!==undefined&&<small>{sizeLabel(file.size)}</small>}</span><a href={url} download={file.name}>Unduh video</a>{file.srtId&&<a href={`/api/office${base}/assets/${file.srtId}/file`} download="subtitle.srt">Subtitle</a>}</figcaption>
  </figure>
}
