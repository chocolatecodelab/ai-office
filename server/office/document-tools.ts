export function searchDocuments(files:Array<{name:string;text:string}>,query:string) {
  const terms=[...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)??[])]
  return files.flatMap(file=>file.text.match(/[^]{1,1600}/g)?.map((text,index)=>({source:file.name,section:index+1,text,score:terms.reduce((sum,term)=>sum+(text.toLowerCase().includes(term)?1:0),0)}))??[]).sort((a,b)=>b.score-a.score).slice(0,8)
}
export function profileCsv(text:string) {
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){row.push(cell);cell=''}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c}
  if(quoted)throw new Error('CSV memiliki kutip yang belum ditutup.')
  if(cell||row.length){row.push(cell);rows.push(row)}
  const header=rows.shift()??[],data=rows.filter(r=>r.some(c=>c.trim()))
  return {rows:data.length,columns:header.length,inconsistentRows:data.filter(r=>r.length!==header.length).length,fields:header.map((name,i)=>{const values=data.map(r=>r[i]?.trim()??'');const numbers=values.filter(v=>v!==''&&Number.isFinite(Number(v))).map(Number);return {name,empty:values.filter(v=>!v).length,numeric:numbers.length,min:numbers.length?Math.min(...numbers):null,max:numbers.length?Math.max(...numbers):null}})}
}
