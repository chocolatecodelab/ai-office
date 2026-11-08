import { renderToStaticMarkup } from 'react-dom/server'
import { expect,it } from 'vitest'
import { ReadOnlyMarkdown } from './ReadOnlyMarkdown.tsx'

it('formats official guidance without running HTML, loading remote images, or enabling script links',()=>{
  const html=renderToStaticMarkup(<ReadOnlyMarkdown text={'# Panduan\n\n**Wajib review**\n\n| Peran | Aksi |\n|---|---|\n| Manager | Review |\n\n<script>alert(1)</script>\n\n[tautan](javascript:alert(1))\n\n![Logo](https://example.com/image.png)'}/>)
  expect(html).toMatch(/<strong>.*Wajib review.*<\/strong>/)
  expect(html).toContain('<table>')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('href="javascript:')
  expect(html).not.toContain('<img')
})
