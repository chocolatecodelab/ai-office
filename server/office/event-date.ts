// Event dates are typed by staff as free Indonesian text, for example "Sabtu, 12 Desember 2026, 19.00 WIB".
// The calendar needs a real date, so this reads "<day> <month name> <year>" and an optional "HH.MM" time.
// Anything else (relative words, abbreviations, impossible dates) is left unread, not guessed.

const MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember']

export interface EventDate { date: string; time?: string }

export function parseEventDate(text: string | undefined): EventDate | undefined {
  const match = text?.toLowerCase().match(new RegExp(`(\\d{1,2})\\s+(${MONTHS.join('|')})\\s+(\\d{4})`))
  if (!text || !match) return undefined
  const day = Number(match[1])
  const month = MONTHS.indexOf(match[2])
  const year = Number(match[3])
  const probe = new Date(Date.UTC(year, month, day))
  if (probe.getUTCMonth() !== month || probe.getUTCDate() !== day) return undefined
  const time = text.slice((match.index ?? 0) + match[0].length).match(/\b([01]?\d|2[0-3])[.:]([0-5]\d)\b/)
  return {
    date: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    ...(time ? { time: `${time[1].padStart(2, '0')}:${time[2]}` } : {}),
  }
}
