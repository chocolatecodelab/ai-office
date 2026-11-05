export interface MemoryChoices {excludedMemoryIds:string[];useSummary:boolean}

/** Only optional memory can be excluded; note ownership/kind is checked against the agent's scope. */
export function validateMemoryChoices(input:Record<string,unknown>):MemoryChoices {
  const ids=input.excludedMemoryIds??[]
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))throw new Error('Pilihan memori tidak valid. Atur ulang pilihan pesan ini.')
  const normalized=(ids as string[]).map(id=>id.toLowerCase())
  if(new Set(normalized).size!==normalized.length)throw new Error('Pilih setiap memori satu kali.')
  if(input.useSummary!==undefined && typeof input.useSummary!=='boolean')throw new Error('Pilihan ringkasan tidak valid.')
  return {excludedMemoryIds:normalized,useSummary:input.useSummary!==false}
}
