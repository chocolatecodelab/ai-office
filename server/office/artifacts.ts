// Files an agent writes inside a chat reply. Agents have no file tools (they only think and draft), so
// a file is a fenced block in the reply:
//
//   ~~~file:rencana-konten.md
//   ...content...
//   ~~~
//
// Tilde fences let the content carry ordinary ``` code fences. The api reads the blocks, keeps only what is
// safe to store (a plain name, a text extension, a bounded size, a bounded count), and leaves anything else
// in the reply as plain text. Nothing here touches the disk.

export interface Artifact { name: string; content: string }

// A *.pdf block carries Markdown, which the api renders into the PDF (pdf.ts); the others are stored as written.
export const ARTIFACT_EXTENSIONS = ['md', 'txt', 'csv', 'json', 'html', 'srt', 'vtt', 'pdf']
export const MAX_ARTIFACTS = 5
export const MAX_ARTIFACT_BYTES = 200_000

/** A plain file name with an allowed extension, or undefined. Directories and leading dots are dropped. */
export function safeArtifactName(raw: string): string | undefined {
  const base = raw.trim().split(/[\\/]/).pop() ?? ''
  const name = base.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[.-]+/, '').replace(/-+$/, '').slice(0, 80)
  const extension = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return name && ARTIFACT_EXTENSIONS.includes(extension) ? name : undefined
}

/** The reply without its file blocks (each becomes "[Berkas: nama]") and the files it carried. */
export function extractArtifacts(reply: string): { text: string; artifacts: Artifact[] } {
  const artifacts: Artifact[] = []
  const text = reply.replace(/^~~~file:([^\n]*)\n([\s\S]*?)\n~~~[ \t]*$/gm, (block: string, rawName: string, content: string) => {
    const name = safeArtifactName(rawName)
    if (!name || artifacts.length >= MAX_ARTIFACTS || Buffer.byteLength(content) > MAX_ARTIFACT_BYTES) return block
    let unique = name
    for (let copy = 2; artifacts.some((item) => item.name === unique); copy += 1) unique = name.replace(/(\.[^.]+)$/, `-${copy}$1`)
    artifacts.push({ name: unique, content })
    return `[Berkas: ${unique}]`
  })
  return { text: text.trim(), artifacts }
}
