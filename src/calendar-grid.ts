// Month grid for the Calendar page: weeks start on Monday, days outside the month are null.
// Works in UTC so the grid never shifts with the viewer's time zone.

export const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
export const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** Dates (YYYY-MM-DD) of one month in weeks of seven cells; `month` is 0-11. */
export function monthGrid(year: number, month: number): Array<string | null> {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({ length: lead }, () => null)
  for (let day = 1; day <= days; day += 1) cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

/** The month a date string belongs to, or undefined when it is not YYYY-MM-DD. */
export function monthOf(date: string): { year: number; month: number } | undefined {
  const match = date.match(/^(\d{4})-(\d{2})-\d{2}$/)
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : undefined
}
