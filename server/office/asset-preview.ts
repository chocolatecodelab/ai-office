import { brandStyle, documentHtml, markdownToHtml } from './pdf-html.js'

// What the Folders preview shows for a saved result. Markdown (a reply, a .md file, or the source of a PDF) is shown
// laid out like the document it becomes; an HTML file is shown in a sandboxed frame; anything else is plain text.
// The page is meant for an <iframe sandbox> without scripts, and carries its own policy: no network, no script.

export type AssetPreview = { type: 'document' | 'html'; html: string } | { type: 'text'; text: string }

const HTML_POLICY = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`

export function buildPreview(
  asset: { name: string | null; kind: string; title: string; content: string },
  brand: { id: string; name: string; color: string },
  date?: Date,
): AssetPreview {
  const extension = asset.name?.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'html') return { type: 'html', html: `<!doctype html><meta charset="utf-8">${HTML_POLICY}${asset.content}` }
  if (asset.kind !== 'artifact' || extension === 'md' || extension === 'pdf') {
    const { title, body } = markdownToHtml(asset.content)
    const documentTitle = title ?? (asset.name ? asset.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') : asset.title)
    return { type: 'document', html: documentHtml({ title: documentTitle, body, brand: brandStyle(brand.id, brand.name, brand.color), date }) }
  }
  return { type: 'text', text: asset.content }
}
