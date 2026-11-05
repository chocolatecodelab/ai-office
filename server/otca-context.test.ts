import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { agentContextFiles, contextPrompt, findContextDir } from './otca-context.js'
import { readBrands } from './office/brands.js'

describe('OTCA context package', () => {
  let dir: string
  const write = (file: string, content: string) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), content) }
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'otca-context-'))
    write('_shared/aturan-umum.md', '# Aturan umum\n')
    write('_shared/raci.md', '# RACI\n')
    write('agents/content-creator.md', '# Content Creator\n')
    write('agents/manager.md', '# Manager\n')
    write('brands/otca/brand.md', '# OTCA\n')
    write('brands/otca/visual.json', '{"brand":"Official OTCA"}\n')
    write('brands/otca/agents.json', '{"slug":"otca"}\n')
    write('brands/infojerman/brand.md', '# Info Jerman\n')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('reads the agent definition, shared rules and only its own brand, skipping missing files', () => {
    const files = agentContextFiles(dir, 'content-creator', 'otca')
    expect(files?.map((file) => file.path)).toEqual([
      '/context/agents/content-creator.md',
      '/context/_shared/aturan-umum.md',
      '/context/_shared/raci.md',
      '/brand/brand.md',
      '/brand/visual.json',
    ])
    expect(files?.map((file) => file.content).join('\n')).not.toContain('Info Jerman')
  })

  it('gives the manager the brand crew list as well', () => {
    expect(agentContextFiles(dir, 'manager', 'otca')?.map((file) => file.path)).toContain('/brand/agents.json')
    expect(agentContextFiles(dir, 'content-creator', 'otca')?.map((file) => file.path)).not.toContain('/brand/agents.json')
  })

  it('has nothing for an agent without a definition', () => {
    expect(agentContextFiles(dir, 'unknown-agent', 'otca')).toBeUndefined()
  })

  it('labels every file in the prompt block', () => {
    const prompt = contextPrompt([{ path: '/brand/brand.md', content: '# OTCA' }])
    expect(prompt).toContain('=== /brand/brand.md ===\n# OTCA')
    expect(prompt).toContain('[KONFIRMASI]')
  })

  it('finds the folder from RUANG_CONTEXT_DIR, or none when it has no _shared folder', () => {
    expect(findContextDir({ RUANG_CONTEXT_DIR: dir })).toBe(dir)
    expect(findContextDir({ RUANG_CONTEXT_DIR: path.join(dir, 'agents') })).toBeUndefined()
  })

  it('builds every agent the repository context defines for every brand crew', () => {
    const repoContext = fileURLToPath(new URL('../context', import.meta.url))
    expect(findContextDir({})).toBe(repoContext)
    for (const agent of ['manager', 'content-creator', 'video-editor', 'social-media-manager', 'digital-marketing', 'event-specialist']) {
      const files = agentContextFiles(repoContext, agent, 'otca')
      expect(files?.length, agent).toBe(agent === 'manager' ? 9 : 8)
    }
  })
  it('keeps all four Manager contexts independent without a brief_to_otca obligation',()=>{
    const context=fileURLToPath(new URL('../context',import.meta.url))
    const brands=readBrands(context)
    expect(brands).toHaveLength(4)
    for(const brand of brands){
      const files=agentContextFiles(context,'manager',brand.id)!
      const prompt=contextPrompt(files)
      expect(prompt).toContain('Keempat brand independen')
      expect(prompt).not.toContain('brief_to_otca')
      const crew=JSON.parse(files.find(f=>f.path==='/brand/agents.json')!.content)
      expect(crew.slug).toBe(brand.id)
      expect(crew.active_agents).toEqual(brand.agents)
    }
  })
})
