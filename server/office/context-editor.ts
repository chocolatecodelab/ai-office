import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentContextFiles } from '../otca-context.js'

/** Only files already visible to this agent can be edited; no client supplied filesystem paths. */
export function updateContext(dir: string, brand: string, agent: string, input: Record<string, unknown>, actor: string) {
  if (![brand, agent].every(value=>/^[a-z0-9-]+$/.test(value))) throw new Error('Brand atau agent tidak valid.')
  const files = agentContextFiles(dir, agent, brand) ?? []
  const current = files.find(file => file.path === input.path)
  if (!current || current.path.endsWith('/agents.json')) throw new Error('Dokumen ini tidak dapat diedit dari panel agent.')
  if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 100000) throw new Error('Isi dokumen wajib diisi, maksimal 100.000 karakter.')
  if (input.previousContent !== current.content) throw new Error('Dokumen sudah berubah. Muat ulang dokumen sebelum menyimpan agar perubahan lain tidak tertimpa.')
  if (current.path.endsWith('.json')) { try { JSON.parse(input.content) } catch { throw new Error('Format JSON belum valid. Periksa kembali sebelum menyimpan.') } }
  const rel = current.path.startsWith('/brand/') ? join('brands', brand, current.path.slice(7)) : current.path.slice('/context/'.length)
  const root = realpathSync(dir), target = realpathSync(join(root, rel)), resolved = relative(root, target)
  if (resolved.startsWith('..') || isAbsolute(resolved)) throw new Error('Lokasi dokumen tidak valid.')
  const id = randomUUID(), history = join(root, '.history')
  mkdirSync(history, { recursive: true })
  // The recoverable original plus scope/actor are stored before replacing the file.
  writeFileSync(join(history, `${id}.json`), JSON.stringify({ path: current.path, brand, agent, actor, at: new Date().toISOString(), content: readFileSync(target, 'utf8') }, null, 2), { flag: 'wx' })
  const temporary = join(dirname(target), `.${id}.tmp`)
  writeFileSync(temporary, input.content.trim() + '\n', { flag: 'wx' })
  renameSync(temporary, target)
  return { path: current.path, content: input.content.trim(), revision: id }
}
