import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { renderPdf } from './pdf.js'
import { documentHtml, markdownToHtml, pageTemplates, type BrandStyle } from './pdf-html.js'

// Prints the branded page with a Chromium that is already on the machine: Chrome or Edge on a developer's
// Windows, chromium on a Linux server (set RENDER_CHROME_PATH to use another). Each candidate is tried in turn,
// since a browser can be installed yet unable to start headless (Edge here exits without printing). The browser
// runs with JavaScript off and every request except data: URLs refused, so a document cannot reach the network
// or run anything, and renders go one at a time (blueprint: render workers never crowd the agents). If no
// browser works, the plain pdfkit renderer (pdf.ts) still produces a PDF.

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
}

/** Every installed browser to try, the one named by RENDER_CHROME_PATH first. */
export function findBrowsers(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.RENDER_CHROME_PATH ?? '', ...(CANDIDATES[process.platform] ?? [])].filter((path) => path !== '' && existsSync(path))
}

export const findBrowser = (env: NodeJS.ProcessEnv = process.env): string | undefined => findBrowsers(env)[0]

let queue: Promise<unknown> = Promise.resolve()

async function printWith(browserPath: string, html: string, templates: { header: string; footer: string }): Promise<Buffer> {
  // A profile of its own, so a browser the person already has open does not swallow the launch and exit.
  const profile = await mkdtemp(join(tmpdir(), 'office-render-'))
  try {
    const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, userDataDir: profile, args: ['--disable-gpu', '--no-first-run', ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])] })
    try {
      const page = await browser.newPage()
      await page.setJavaScriptEnabled(false)
      await page.setRequestInterception(true)
      page.on('request', (request) => { if (request.url().startsWith('data:') || request.url() === 'about:blank') void request.continue(); else void request.abort() })
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 })
      const pdf = await page.pdf({
        format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: templates.header, footerTemplate: templates.footer,
        margin: { top: '24mm', bottom: '20mm', left: '18mm', right: '18mm' }, timeout: 30_000,
      })
      return Buffer.from(pdf)
    } finally {
      await browser.close()
    }
  } finally {
    await rm(profile, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Prints an HTML page to an A4 PDF with the given page header and footer. With no browser path it tries every
 * installed browser; with one it uses only that. Rejects when none can print.
 */
export function htmlToPdf(html: string, templates: { header: string; footer: string }, browserPath?: string): Promise<Buffer> {
  const paths = browserPath === undefined ? findBrowsers() : browserPath ? [browserPath] : []
  if (paths.length === 0) return Promise.reject(new Error('Chromium atau Chrome tidak ditemukan; setel RENDER_CHROME_PATH.'))
  const run = queue.then(async () => {
    let failure: unknown
    for (const path of paths) {
      try { return await printWith(path, html, templates) } catch (error) { failure = error }
    }
    throw failure
  })
  queue = run.catch(() => undefined)
  return run
}

/** A branded PDF of the Markdown; falls back to the plain renderer if Chromium cannot be used. */
export async function renderDocumentPdf(source: string, options: { name: string; brand: BrandStyle; browserPath?: string }): Promise<Buffer> {
  const { title, body } = markdownToHtml(source)
  const documentTitle = title ?? options.name.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')
  try {
    return await htmlToPdf(documentHtml({ title: documentTitle, body, brand: options.brand }), pageTemplates(documentTitle, options.brand), options.browserPath)
  } catch (error) {
    console.warn('PDF lewat Chromium gagal, memakai pembuat sederhana:', error instanceof Error ? error.message : error)
    return renderPdf(source, { title: documentTitle })
  }
}
