import { expect,it } from 'vitest'
import { memoryCommand } from './chat-memory-command.js'
it('accepts explicit memory text only, not quotations or indirect requests',()=>{
 expect(memoryCommand('Simpan sebagai memori: Gunakan sapaan Anda')).toEqual({body:'Gunakan sapaan Anda',title:'Gunakan sapaan Anda'})
 expect(memoryCommand('/ingat Hindari emoji')?.body).toBe('Hindari emoji')
 for(const input of ['Apa itu memori?','Tolong simpan jawaban tadi','> Simpan sebagai memori: contoh','Dokumen menyebut: /ingat x'])expect(memoryCommand(input)).toBeNull()
 expect(()=>memoryCommand('Simpan sebagai memori: ')).toThrow()
 expect(()=>memoryCommand('/ingat '+ 'x'.repeat(2001))).toThrow()
})
