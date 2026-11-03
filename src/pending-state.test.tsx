import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Agents } from './pages/Agents.tsx'
import { Stats } from './pages/Stats.tsx'
import { Office } from './pages/Office.tsx'

describe('pending application views', () => {
  it('renders loading instead of runtime placeholders on Stats and Agents', () => {
    const dashboard = renderToStaticMarkup(<Stats dashboard={null} pending/>)
    const agents = renderToStaticMarkup(<Agents/>)

    for (const markup of [dashboard, agents]) {
      expect(markup).toContain('Loading')
      expect(markup).not.toContain('Not Available')
      expect(markup).not.toContain('Unknown')
    }
  })

  it('renders loading instead of an empty room or zero crew summary while Office is pending', () => {
    const markup = renderToStaticMarkup(<Office/>)

    expect(markup).toContain('Memuat kantor')
    expect(markup).not.toContain('0 active work')
    expect(markup).not.toContain('No declared idle presence')
  })
})
