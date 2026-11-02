import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The OTCA context package (context/README.md): shared rules, agent definitions and brand files that Brain
// maintains. Agent prompts are built from it, so a reviewed change to those files changes how agents work
// without touching code. Read once at startup; restart the server after editing context/.

const SHARED_FILES = ['aturan-umum.md', 'approval-matrix.md', 'raci.md', 'batas-tanggung-jawab.md']
const BRAND_FILES = ['brand.md', 'visual.json', 'checklist-publikasi.md']

export interface ContextFile { path: string; content: string }

/** The context/ folder: RUANG_CONTEXT_DIR, else next to the server in a checkout (server/) or a build (build/server/). */
export function findContextDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const candidates = env.RUANG_CONTEXT_DIR
    ? [env.RUANG_CONTEXT_DIR]
    : [new URL('../context', import.meta.url), new URL('../../context', import.meta.url)].map((url) => fileURLToPath(url))
  return candidates.find((dir) => existsSync(join(dir, '_shared')))
}

function read(dir: string, relative: string): string | undefined {
  const file = join(dir, relative)
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined
}

/**
 * The files one agent of one brand must read, labelled with the paths the files use to refer to each other
 * (/context/... and /brand/...). Undefined when the agent has no definition in context/agents/.
 */
export function agentContextFiles(dir: string, agentId: string, brand: string): ContextFile[] | undefined {
  const definition = read(dir, join('agents', `${agentId}.md`))
  if (!definition) return undefined
  const brandFiles = agentId === 'manager' ? [...BRAND_FILES, 'agents.json'] : BRAND_FILES
  const files: Array<ContextFile | undefined> = [
    { path: `/context/agents/${agentId}.md`, content: definition },
    ...SHARED_FILES.map((name) => ({ path: `/context/_shared/${name}`, content: read(dir, join('_shared', name)) })),
    ...brandFiles.map((name) => ({ path: `/brand/${name}`, content: read(dir, join('brands', brand, name)) })),
  ].map((file) => (file.content ? { path: file.path, content: file.content } : undefined))
  return files.filter((file): file is ContextFile => file !== undefined)
}

/** The context block that goes into an agent's system prompt. */
export function contextPrompt(files: ContextFile[]): string {
  return `KONTEKS RESMI OTCA (paket context/). Ikuti file-file ini; jika ada aturan yang bertentangan, ikuti yang lebih ketat.
- [RESMI]: dari dokumen resmi OTCA, wajib diikuti.
- [DRAFT]: usulan yang belum disetujui; boleh dipakai sebagai arahan, tapi sebutkan bila hasil Anda bergantung padanya.
- [KONFIRMASI]: informasi yang belum diketahui. Jangan mengarang isinya; tulis bahwa hal itu perlu dikonfirmasi.

${files.map((file) => `=== ${file.path} ===\n${file.content}`).join('\n\n')}`
}
