import { useState,type ReactNode } from 'react'

/** Filter scope resets the page; polling and deletion clamp it to the remaining results. */
export function PaginatedItems<T>({items,scope='',label='hasil',children}:{items:readonly T[];scope?:string;label?:string;children:(rows:readonly T[],offset:number)=>ReactNode}){
  const [size,setSize]=useState(20)
  const [position,setPosition]=useState({scope,page:1})
  const pages=Math.max(1,Math.ceil(items.length/size))
  const page=position.scope===scope?Math.min(position.page,pages):1
  const offset=(page-1)*size
  const change=(next:number)=>setPosition({scope,page:next})
  return <>{children(items.slice(offset,offset+size),offset)}{items.length>10&&<nav className="data-pagination" aria-label={`Halaman ${label}`}><span role="status">{offset+1}–{Math.min(offset+size,items.length)} dari {items.length} {label}</span><label>Per halaman<select value={size} onChange={e=>{setSize(Number(e.target.value));change(1)}}>{[10,20,50].map(n=><option key={n} value={n}>{n}</option>)}</select></label><div><button type="button" className="refresh-button" disabled={page===1} onClick={()=>change(page-1)}>Sebelumnya</button><span aria-live="polite">{page} / {pages}</span><button type="button" className="refresh-button" disabled={page===pages} onClick={()=>change(page+1)}>Berikutnya</button></div></nav>}</>
}
