import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { agentLook } from '../agents.ts'
import { officeStateBadge } from '../office-state.ts'
import { usePolling } from '../polling.ts'
import { formatCompact, formatNumber } from '../format.ts'
import type { OfficeStation, UsageSnapshot } from '../types.ts'
import { AgentFolder } from './LegacyFolders.tsx'
import { AgentMemoryView } from './Memory.tsx'
import { formatCost } from '../usage.ts'
import { RelockBar } from '../ProfileLock.tsx'
/** A pixel character dressed in the colours derived from the agent id. */
export function PixelCharacter({ agent }: { agent: string }) {
  const look = agentLook(agent)
  const style = { '--hair': look.hair, '--skin': look.skin, '--shirt': look.shirt, '--pants': look.pants } as CSSProperties
  return <span className="pixel-character" style={style} aria-hidden="true"><span className="character-hair"/><span className="character-head"><i/><b/></span><span className="character-torso"/><span className="character-arm left"/><span className="character-arm right"/><span className="character-leg left"/><span className="character-leg right"/></span>
}

function officeStateLabel(station: OfficeStation): string {
  return station.state === 'Idle' ? 'Idle · managed placement' : station.state
}

/** This agent's tokens over the last 7 days and its rank in the crew (Hermes profiles only). */
function AgentTokens({ agent }: { agent: string }) {
  const usage = usePolling<UsageSnapshot>('/api/usage?days=7', 0)
  if (usage.status !== 'ready' || !Array.isArray(usage.data.agents)) return <div><dt>Tokens (7 days)</dt><dd>{usage.status === 'pending' ? 'Loading…' : 'Not Available'}</dd></div>
  const ranked = usage.data.agents.filter((item) => item.usage)
  const index = ranked.findIndex((item) => item.agent === agent)
  const mine = ranked[index]?.usage
  return <div><dt>Tokens (7 days)</dt><dd>{mine ? `${formatNumber(mine.totalTokens)} · #${index + 1} of ${ranked.length}${mine.costUsd !== undefined ? ` · est. ${formatCost(mine.costUsd)}` : ''}${mine.topSession ? ` · biggest session ${formatCompact(mine.topSession.tokens)}` : ''}` : 'Not Available'}</dd></div>
}

import { AgentChat } from '../components/AgentChat.tsx'

type DetailTab = 'Chat' | 'Overview' | 'Folder' | 'Memory'
const DETAIL_TABS: DetailTab[] = ['Chat', 'Overview', 'Folder', 'Memory']

export function OfficeDetail({ station, onClose, initialTab = 'Chat' }: { station: OfficeStation; onClose: () => void; initialTab?: DetailTab }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const [tab, setTab] = useState<DetailTab>(initialTab)
  useEffect(() => { closeRef.current?.focus() }, [])
  const badge = officeStateBadge(station.state)
  const profile = station.id
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) { event.preventDefault(); return }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target.focus()
    }
  }
  return <div className="office-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className={`office-detail${tab === 'Overview' ? '' : ' wide'}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="office-detail-title" onKeyDown={onKeyDown}>
      <button className="office-close" ref={closeRef} onClick={onClose} aria-label={`Close ${station.name} details`}>Close</button>
      <div className="detail-head"><div className="detail-avatar"><PixelCharacter agent={station.id}/></div><div><p className="eyebrow">CLAUDE AI AGENT</p><h2 id="office-detail-title">{station.name}</h2><span className={`badge ${badge.tone}`}>{officeStateLabel(station)}</span>{station.privacy === 'locked' && <span className="badge muted">🔒 Locked</span>}</div></div>
      {profile && <div className="detail-tabs" role="tablist" aria-label={`${station.name} details`}>{DETAIL_TABS.map((item) => <button type="button" role="tab" key={item} aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>}
      <div role="tabpanel" aria-label={tab} className="detail-body">
        {tab === 'Chat' && <AgentChat station={station} onSwitchTab={setTab}/>}
        {tab === 'Overview' && <>{station.privacy === 'locked' && <p className="file-notice">🔒 {station.name} is locked: its task, activity, memory and files are private. Open the Folder or Memory tab to enter the PIN.</p>}
          {station.privacy === 'unlocked' && <RelockBar agent={station.id} minutes={15}/>}
          {station.activity && <p className="detail-activity">{station.activity}</p>}
          <dl className="office-detail-grid"><div><dt>Agent role</dt><dd>{station.role}</dd></div>{station.role !== 'OpenCode' && <AgentTokens agent={station.id}/>}<div><dt>Current room</dt><dd>{station.room} / {station.roomPosition}</dd></div><div><dt>Current task</dt><dd>{station.currentTask}</dd></div><div><dt>Recent activity</dt><dd>{station.recentActivity}</dd></div><div><dt>Source / provenance</dt><dd>{station.provenance}</dd></div><div><dt>Freshness</dt><dd>{station.freshness}</dd></div></dl></>}
        {tab === 'Folder' && profile && <AgentFolder profile={profile}/>}
        {tab === 'Memory' && profile && <AgentMemoryView profile={profile}/>}
      </div>
    </section>
  </div>
}
