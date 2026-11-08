import { describe, expect, it } from 'vitest'
import { compileNotes, NOTE_LIMITS, notesPrompt, validateNote, type AgentNote } from './agent-notes.js'

const note = (patch: Partial<AgentNote>): AgentNote => ({ id: 'n', brandId: 'otca', agentType: null, kind: 'rule', title: 'Judul', body: 'Isi', active: true, createdBy: 'a', updatedBy: 'a', createdAt: '2026-11-04T01:00:00Z', updatedAt: '2026-11-04T01:00:00Z', ...patch })

describe('validateNote', () => {
  it('tidies a note and treats "all" as every agent', () => {
    expect(validateNote({ kind: 'memory', title: '  Nada   suara ', body: 'a\r\nb ', agentType: 'all' })).toEqual({ kind: 'memory', title: 'Nada suara', body: 'a\nb', agentType: null, active: true })
  })
  it('rejects empty, oversized and unknown input', () => {
    expect(() => validateNote({ kind: 'x', title: 't', body: 'b' })).toThrow('Jenis')
    expect(() => validateNote({ kind: 'rule', title: ' ', body: 'b' })).toThrow('Judul wajib')
    expect(() => validateNote({ kind: 'rule', title: 't', body: '' })).toThrow('Isi wajib')
    expect(() => validateNote({ kind: 'rule', title: 't'.repeat(NOTE_LIMITS.title + 1), body: 'b' })).toThrow('Judul maksimal')
    expect(() => validateNote({ kind: 'rule', title: 't', body: 'b'.repeat(NOTE_LIMITS.body + 1) })).toThrow('Isi maksimal')
    expect(() => validateNote({ kind: 'rule', title: 't', body: 'b', agentType: 5 })).toThrow('Agent')
  })
  it('keeps the fields of the note being edited when a change leaves them out', () => {
    const current = { kind: 'rule' as const, title: 'T', body: 'B', agentType: 'manager', active: true }
    expect(validateNote({ active: false }, current)).toEqual({ ...current, active: false })
  })
})

describe('notesPrompt', () => {
  it('reports exactly which notes fit and preserves memory relevance over recency', () => {
    const ranked=[note({id:'best',kind:'memory',body:'a'.repeat(700),updatedAt:'2025-01-01'}),note({id:'recent',kind:'memory',body:'b'.repeat(700)}),note({id:'rule',body:'Review wajib'}),note({id:'inactive',active:false})]
    const result=compileNotes(ranked,1200)
    expect(result.included.map(n=>n.id)).toEqual(['rule','best'])
    expect(result.omitted.map(n=>n.id)).toEqual(['recent'])
    expect(result.text.length).toBeLessThanOrEqual(1200)
    expect(result.text).not.toContain('b'.repeat(700))
    expect(compileNotes(ranked,10).included).toEqual([])
    expect(compileNotes(ranked,10).text).toBe('')
  })
  it('is empty without active notes', () => {
    expect(notesPrompt([])).toBe('')
    expect(notesPrompt([note({ active: false })])).toBe('')
  })
  it('puts rules before memory, says the official context wins, and skips inactive notes', () => {
    const text = notesPrompt([note({ kind: 'memory', title: 'M', body: 'ingat' }), note({ title: 'R', body: 'patuhi' }), note({ title: 'X', body: 'mati', active: false })])
    expect(text).toContain('Konteks resmi di atas selalu menang')
    expect(text.indexOf('## Aturan tambahan')).toBeLessThan(text.indexOf('## Memori'))
    expect(text).toContain('- R: patuhi')
    expect(text).not.toContain('mati')
  })
  it('stays inside the character budget and says what was left out', () => {
    const many = Array.from({ length: 10 }, (_, index) => note({ id: String(index), title: `T${index}`, body: 'x'.repeat(300), updatedAt: `2026-11-04T0${index}:00:00Z` }))
    const text = notesPrompt(many, 1400)
    expect(text.length).toBeLessThan(1600)
    expect(text).toMatch(/\d+ catatan lain tidak dimuat/)
    expect(text).toContain('- T9:')
  })
})
