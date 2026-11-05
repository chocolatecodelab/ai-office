import { HermesError, type HermesClient } from './hermes-client.js'

/** Limited direct-identifier screening, not a claim of full anonymization. */
export function screenResearchText(text:string) {
  const counts:Record<string,number>={}
  const replace=(kind:string,pattern:RegExp)=>{text=text.replace(pattern,()=>{counts[kind]=(counts[kind]??0)+1;return `[${kind.toUpperCase()} DIHAPUS]`})}
  replace('email',/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)
  replace('nik',/(?<!\d)\d{16}(?!\d)/g)
  replace('telepon',/(?<![\w\d])(?:\+62|0062|62|0)[\s.-]?8(?:[\s.-]?\d){8,11}(?!\d)/g)
  replace('tautan_kontak',/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s<>]+/gi)
  replace('identitas_berlabel',/(?:^|\n)[ \t]*(?:nama(?:\s+lengkap|\s+orang\s+tua|\s+anak)?|name|alamat(?:\s+rumah)?|address|tanggal\s+lahir|date\s+of\s+birth|no\.?\s*(?:rekening|paspor))\s*[:=][^\n]+/gi)
  return {text,counts}
}

/** Wrap every model call, including document summarization, before any transmission. */
export function privateResearchClient(client:HermesClient, record:(counts:Record<string,number>)=>Promise<void>):HermesClient {
  return {async run(endpoint,request,key){
    if(request.images?.length)throw new HermesError('Riset audiens tidak mengirim gambar/scan mentah ke model. Gunakan transkrip teks yang sudah diperiksa dan disamarkan, atau tugas analisis dokumen terpisah sesuai izin data.',false,true)
    const input=screenResearchText(request.input),instructions=screenResearchText(request.instructions)
    const counts={...input.counts}
    for(const [kind,count] of Object.entries(instructions.counts))counts[kind]=(counts[kind]??0)+count
    await record(counts)
    const result=await client.run(endpoint,{...request,input:input.text,instructions:instructions.text},key)
    return {...result,output:screenResearchText(result.output).text}
  }}
}
