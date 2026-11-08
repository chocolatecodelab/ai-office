import { describe, expect, it } from 'vitest'
import { parseEventDate } from './event-date.js'

describe('event date', () => {
  it('reads the date and the time from the wording staff use', () => {
    expect(parseEventDate('Sabtu, 12 Desember 2026, 19.00 WIB')).toEqual({ date: '2026-12-12', time: '19:00' })
    expect(parseEventDate('[uji] Sabtu, 12 Desember 2026')).toEqual({ date: '2026-12-12' })
    expect(parseEventDate('14 desember 2026 pukul 9:30')).toEqual({ date: '2026-12-14', time: '09:30' })
    expect(parseEventDate('1 MARET 2027')).toEqual({ date: '2027-03-01' })
  })

  it('leaves unreadable and impossible dates unread instead of guessing', () => {
    expect(parseEventDate(undefined)).toBeUndefined()
    expect(parseEventDate('minggu depan')).toBeUndefined()
    expect(parseEventDate('12 Des 2026')).toBeUndefined()
    expect(parseEventDate('31 Februari 2026')).toBeUndefined()
  })
})
