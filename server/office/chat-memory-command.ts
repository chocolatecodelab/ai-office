import { NOTE_LIMITS } from './agent-notes.js'

/** Only an explicit top-level request; never infer instructions from a quoted reply or attachment. */
export function memoryCommand(message:string) {
 const match=message.trim().match(/^(?:\/ingat\s+|(?:tolong\s+)?simpan\s+(?:sebagai|ke)\s+memori\s*:\s*)([\s\S]*)$/i)
 if(!match)return null
 const body=match[1].trim()
 if(!body || body.length>NOTE_LIMITS.body)throw new Error(`Tuliskan isi memori langsung setelah perintah, maksimal ${NOTE_LIMITS.body} karakter.`)
 return {body,title:body.replace(/\s+/g,' ').slice(0,NOTE_LIMITS.title)}
}
