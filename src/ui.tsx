import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { formatTime } from './format.ts'
import type { Polled } from './polling.ts'
import type { GatewayState, Source } from './types.ts'

export function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return <section className="page-title"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{children && <p>{children}</p>}</section>
}

export function RuntimeBadge({ source }: { source?: Source<GatewayState> }) {
  const state = source?.availability === 'available' ? source.data : 'Not Available'
  const tone = state === 'Running' ? 'good' : state === 'Stopped' ? 'bad' : state === 'Not Available' ? 'muted' : 'unknown'
  return <span className={`badge ${tone}`}>{state}</span>
}

export function LoadingState({ message }: { message: string }) {
  return <section className="empty-state loading-state" aria-busy="true"><h2>Loading</h2><p>{message}</p></section>
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <section className="empty-state"><h2>{title}</h2><p>{children}</p></section>
}

/** Source freshness plus a manual refresh control shared by every data page. */
export function SourceStatus({ source, fetchedAt, request }: { source?: Source<unknown>; fetchedAt?: string; request: Polled<unknown> }) {
  const status = request.status === 'pending' ? 'Connecting' : request.status === 'failed' || !source || source.availability === 'unavailable' ? 'Not Available' : request.status === 'ready' && request.stale ? 'Stale (refresh failed)' : 'Live source'
  const live = source?.availability === 'available' && !(request.status === 'ready' && request.stale)
  return <div className="source-status">
    <span className={live ? 'dot' : 'dot muted-dot'}/><span>{status}</span>
    <span>{fetchedAt ? `REFRESHED ${formatTime(fetchedAt)}` : 'AWAITING REFRESH'}</span>
    <button type="button" className="refresh-button" onClick={request.refresh} disabled={request.refreshing} aria-label="Refresh this source">{request.refreshing ? 'REFRESHING…' : '↻ REFRESH'}</button>
  </div>
}

export function Unavailable({ source, request }: { source?: Source<unknown>; request: Polled<unknown> }) {
  if (request.status === 'failed') return <section className="empty-state" role="alert"><h2>Not Available</h2><p>{request.message ?? 'This read-only source could not be reached. Is the OTCA API running?'}</p></section>
  return source?.availability === 'unavailable' ? <section className="empty-state"><h2>Not Available</h2><p>{source.error?.message ?? 'This read-only source could not be read.'}</p></section> : null
}

export function SearchInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <input className="search-input" type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label}/>
}

/** Modal dialog: focus moves in, Tab is contained, Escape or a backdrop click closes it. */
export function Dialog({ labelledBy, onClose, closeLabel, className = '', children }: { labelledBy: string; onClose: () => void; closeLabel: string; className?: string; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => { closeRef.current?.focus() }, [])
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) { event.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }
  return <div className="office-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`office-detail ${className}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      <button className="office-close" ref={closeRef} onClick={onClose} aria-label={closeLabel}>Close</button>
      {children}
    </section>
  </div>
}
