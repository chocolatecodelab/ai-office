import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Queryable } from '../db/index.js'

// Brands and their crews come from context/brands/<slug>/ (FR-01): agents.json lists the active
// agents, visual.json gives the floor colour. The database mirrors them so tasks can reference them.

export interface BrandDefinition { id: string; name: string; color: string; agents: string[]; briefToOtca: string[] }

interface VisualJson { colors?: Record<string, string | string[]>; color_roles?: Record<string, string> }

/** The brand's signature colour: the one its guideline uses for headlines, else its accent. */
export function floorColor(visual: VisualJson): string {
  const roles = Object.entries(visual.color_roles ?? {}).filter(([color]) => color.startsWith('#'))
  const pick = roles.find(([, role]) => /headline/i.test(role)) ?? roles.find(([, role]) => /aksen/i.test(role)) ?? roles[0]
  return pick?.[0] ?? '#888888'
}

export function readBrands(contextDir: string): BrandDefinition[] {
  const brandsDir = join(contextDir, 'brands')
  if (!existsSync(brandsDir)) return []
  return readdirSync(brandsDir).filter((slug) => existsSync(join(brandsDir, slug, 'agents.json'))).map((slug) => {
    const crew = JSON.parse(readFileSync(join(brandsDir, slug, 'agents.json'), 'utf8')) as { brand: string; active_agents: string[]; brief_to_otca?: string[] }
    const visualFile = join(brandsDir, slug, 'visual.json')
    const visual = existsSync(visualFile) ? JSON.parse(readFileSync(visualFile, 'utf8')) as VisualJson : {}
    return { id: slug, name: crew.brand, color: floorColor(visual), agents: crew.active_agents, briefToOtca: crew.brief_to_otca ?? [] }
  })
}

/** Upserts brands and agents; agents no longer listed in agents.json stay, marked inactive. */
export async function syncBrands(db: Queryable, brands: BrandDefinition[]): Promise<void> {
  for (const brand of brands) {
    await db.query(
      `INSERT INTO brands (id, name, color) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, updated_at = now()`,
      [brand.id, brand.name, brand.color])
    await db.query('UPDATE agents SET active = false WHERE brand_id = $1 AND NOT (agent_type = ANY($2))', [brand.id, brand.agents])
    for (const agent of brand.agents) {
      await db.query(
        `INSERT INTO agents (brand_id, agent_type) VALUES ($1, $2)
         ON CONFLICT (brand_id, agent_type) DO UPDATE SET active = true`,
        [brand.id, agent])
    }
  }
}
