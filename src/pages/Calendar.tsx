import { useState } from 'react'
import { MONTH_NAMES, WEEKDAYS, monthGrid, monthOf } from '../calendar-grid.ts'
import type { CalendarEntry, OfficeCalendar } from '../office-api.ts'
import { usePolling } from '../polling.ts'
import { EmptyState, LoadingState, PageTitle } from '../ui.tsx'

/** Event dates of every brand, read from the events' free-text date. Google Calendar is not connected yet (mock). */
export function Calendar() {
  const calendar = usePolling<OfficeCalendar>('/api/office/calendar', 30_000)
  const [cursor, setCursor] = useState<{ year: number; month: number }>()
  const [selected, setSelected] = useState<string>()

  if (calendar.status === 'pending') return <><PageTitle eyebrow="CALENDAR" title="Calendar"/><LoadingState message="Memuat kalender..."/></>
  if (calendar.status === 'failed') return <><PageTitle eyebrow="CALENDAR" title="Calendar"/><EmptyState title="Tidak tersedia">Kalender belum dapat dimuat. {calendar.message}</EmptyState></>

  const { entries, googleCalendar } = calendar.data
  const dated = entries.filter((entry): entry is CalendarEntry & { date: string } => Boolean(entry.date))
  const undated = entries.filter((entry) => !entry.date)
  const today = new Date().toISOString().slice(0, 10)
  // Open on the month of the next event, or the current month when none is ahead.
  const next = dated.filter((entry) => entry.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
  const shown = cursor ?? monthOf(next?.date ?? today)!
  const move = (step: number) => setCursor({ year: shown.year + Math.floor((shown.month + step) / 12), month: (shown.month + step + 12) % 12 })
  const byDate = new Map<string, Array<CalendarEntry & { date: string }>>()
  for (const entry of dated) byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry])
  const chosen = selected ? byDate.get(selected) ?? [] : []

  return <>
    <PageTitle eyebrow="CALENDAR" title="Calendar">Tanggal event semua brand, dibaca dari kolom tanggal event. Mockup: Google Calendar belum disambungkan{googleCalendar ? ` (mode ${googleCalendar.mode})` : ''}.</PageTitle>
    <section className="month-view">
      <div className="month-head">
        <button type="button" className="refresh-button" aria-label="Bulan sebelumnya" onClick={() => move(-1)}>‹</button>
        <h2>{MONTH_NAMES[shown.month]} {shown.year}</h2>
        <button type="button" className="refresh-button" aria-label="Bulan berikutnya" onClick={() => move(1)}>›</button>
        <button type="button" className="refresh-button" onClick={() => setCursor(undefined)}>Event berikutnya</button>
      </div>
      <div className="month-grid">
        {WEEKDAYS.map((day) => <span className="month-weekday" key={day}>{day}</span>)}
        {monthGrid(shown.year, shown.month).map((date, index) => {
          if (!date) return <span className="month-cell empty" key={`blank-${index}`}/>
          const items = byDate.get(date) ?? []
          return <button type="button" key={date} className={`month-cell${date === today ? ' today' : ''}${date === selected ? ' selected' : ''}`} onClick={() => setSelected(date)} aria-label={`${Number(date.slice(8))} ${MONTH_NAMES[shown.month]}, ${items.length} event`}>
            <span className="month-day">{Number(date.slice(8))}</span>
            {items.map((entry) => <span className="month-entry kind-run" key={entry.id} title={`${entry.brandName}: ${entry.title}`}>{entry.time ? `${entry.time} ` : ''}<b>{entry.brandName}</b> {entry.title}</span>)}
          </button>
        })}
      </div>
    </section>
    {selected && <section className="card" aria-live="polite">
      <p className="eyebrow">{selected}</p>
      {chosen.length === 0 ? <p className="muted">Tidak ada event di tanggal ini.</p> : chosen.map((entry) => <p key={entry.id}><strong>{entry.title}</strong> · {entry.brandName}{entry.tanggal ? ` · ${entry.tanggal}` : ''}</p>)}
    </section>}
    <section className="card">
      <p className="eyebrow">TANGGAL BELUM TERBACA</p>
      {undated.length === 0 ? <p className="muted">Semua event punya tanggal yang terbaca.</p> : <>
        <p className="small-note">Tulis tanggal sebagai "12 Desember 2026" di data event agar muncul di kalender.</p>
        {undated.map((entry) => <p key={entry.id}><strong>{entry.title}</strong> · {entry.brandName} · {entry.tanggal ?? 'tanggal kosong'}</p>)}
      </>}
    </section>
  </>
}
