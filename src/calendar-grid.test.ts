import { describe, expect, it } from 'vitest'
import { monthGrid, monthOf } from './calendar-grid.ts'

describe('calendar grid', () => {
  it('starts weeks on Monday and pads the month to whole weeks', () => {
    const grid = monthGrid(2026, 11) // Desember 2026 starts on a Tuesday
    expect(grid).toHaveLength(35)
    expect(grid.slice(0, 3)).toEqual([null, '2026-12-01', '2026-12-02'])
    expect(grid.filter(Boolean)).toHaveLength(31)
    expect(grid[grid.length - 1]).toBeNull()
  })

  it('handles a leap February and a month that starts on Monday', () => {
    expect(monthGrid(2028, 1).filter(Boolean)).toHaveLength(29)
    expect(monthGrid(2026, 5)[0]).toBe('2026-06-01') // Juni 2026 starts on a Monday
  })

  it('reads the month of a date and rejects other text', () => {
    expect(monthOf('2026-12-12')).toEqual({ year: 2026, month: 11 })
    expect(monthOf('Sabtu')).toBeUndefined()
  })
})
