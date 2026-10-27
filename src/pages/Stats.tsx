import { formatDateTime, formatNumber, orderedStatuses, statusTone } from '../format.ts'
import type { DashboardSnapshot } from '../types.ts'
import { EmptyState, LoadingState } from '../ui.tsx'
import { TokenUsage } from './TokenUsage.tsx'
import type { Page } from '../routes.ts'

function availableCount(source: { availability: string; total: number }, unit?: string) {
  return source.availability === 'available' ? `${formatNumber(source.total)}${unit ? ` ${unit}` : ''}` : 'Not Available'
}

function StatTile({ label, value, detail, onClick }: { label: string; value: string; detail?: string; onClick?: () => void }) {
  return <button type="button" className="stat-tile" onClick={onClick} disabled={!onClick}><span>{label}</span><strong className={value === 'Not Available' ? 'na' : undefined}>{value}</strong>{detail && <small>{detail}</small>}</button>
}

/** The operations overview (formerly the Dashboard page), shown in the Office panel's Stats tab. */
export function Stats({ dashboard, pending = false, onNavigate }: { dashboard: DashboardSnapshot | null; pending?: boolean; onNavigate?: (page: Page) => void }) {
  if (pending) return <LoadingState message="Reading runtime signals..."/>
  if (!dashboard) return <EmptyState title="Not Available">The Ruang API could not be reached. Start it with <code>npm run dev</code>.</EmptyState>
  const { runtime, tasks, calendar, activity, knowledge, channels, office, commands } = dashboard
  const go = (page: Page) => onNavigate ? () => onNavigate(page) : undefined
  const openTasks = Object.entries(tasks.byStatus).filter(([status]) => !['done', 'archived'].includes(status)).reduce((sum, [, count]) => sum + count, 0)
  const statuses = orderedStatuses(Object.keys(tasks.byStatus))
  const hermesMissing = /not installed/i.test(runtime.profiles.error?.message ?? '')

  return <div className="stats-view">
    {hermesMissing && <section className="notice" role="status"><strong>Hermes CLI not found.</strong> Ruang reads everything through the <code>hermes</code> command. Install Hermes Agent and make sure <code>hermes</code> is on the PATH of the shell that runs <code>npm run dev</code>, then press Refresh all.</section>}
    <section className="stat-grid" aria-label="Key statistics">
      <StatTile label="Gateways running" value={`${office.gatewaysReachable} / ${office.gatewaysDeclared}`} detail="Claude agents" onClick={go('Agents')}/>
      <StatTile label="Crew active" value={`${office.active} / ${office.declared}`} detail={`${office.idle} idle · ${office.offline} offline · ${office.unknown} unknown`} />
      <StatTile label="Open tasks" value={tasks.availability === 'available' ? formatNumber(openTasks) : 'Not Available'} detail={tasks.availability === 'available' ? `${formatNumber(tasks.total)} total · ${tasks.byStatus.running ?? 0} running` : undefined} onClick={go('Task Board')}/>
      <StatTile label="Scheduled jobs" value={availableCount(calendar)} detail={calendar.availability === 'available' ? `${calendar.active} active · ${calendar.paused} paused` : undefined} onClick={go('Calendar')}/>
      <StatTile label="Recent sessions" value={availableCount(activity)} detail={channels.activeSessions !== undefined ? `${channels.activeSessions} active now` : 'Last 20 listed'} onClick={go('Activity')}/>
      <StatTile label="Enabled skills" value={availableCount(knowledge)} detail={knowledge.availability === 'available' ? `${Object.keys(knowledge.byCategory).length} categories` : undefined} onClick={go('Folders')}/>
      <StatTile label="Channels" value={availableCount(channels, 'configured')} detail={channels.availability === 'available' ? `${channels.connected} connected` : undefined} />
      <StatTile label="CLI reads" value={formatNumber(commands.total)} detail={`${commands.failed} failed · ${commands.averageMs} ms avg`} onClick={go('Logs')}/>
    </section>

    <TokenUsage/>

    <section className="dash-grid">
      <article className="card">
        <p className="eyebrow">KANBAN BY STATUS</p>
        {tasks.availability === 'unavailable' ? <p className="muted">Not Available</p> : tasks.total === 0 ? <p className="muted">No tasks on the board.</p> : <>
          <div className="stack-bar" role="img" aria-label={statuses.map((status) => `${status} ${tasks.byStatus[status]}`).join(', ')}>{statuses.map((status) => <i key={status} className={`tone-${statusTone(status)}`} style={{ flexGrow: tasks.byStatus[status] }} title={`${status}: ${tasks.byStatus[status]}`}/>)}</div>
          <ul className="legend">{statuses.map((status) => <li key={status}><i className={`tone-${statusTone(status)}`}/>{status}<b>{tasks.byStatus[status]}</b></li>)}</ul>
          <p className="card-note">{tasks.assigned} of {tasks.total} tasks have an assignee.</p>
        </>}
      </article>

      <article className="card">
        <p className="eyebrow">RUNTIME</p>
        <dl className="runtime-list">
          <div><dt>Claude agents</dt><dd>{runtime.profiles.availability === 'available' ? runtime.profiles.data.length : 'Not Available'}</dd></div>
          <div><dt>Gateways running</dt><dd>{runtime.profiles.availability === 'available' ? `${runtime.profiles.data.filter((profile) => profile.gateway === 'Running').length} of ${runtime.profiles.data.length}` : 'Not Available'}</dd></div>
          <div><dt>Models in use</dt><dd>{runtime.profiles.availability === 'available' ? [...new Set(runtime.profiles.data.map((profile) => profile.model).filter((model) => model !== 'Not configured'))].join(', ') || '—' : 'Not Available'}</dd></div>
          <div><dt>OpenCode</dt><dd>{runtime.openCode.availability === 'available' ? runtime.openCode.data : 'Not installed'}</dd></div>
        </dl>
      </article>

      <article className="card">
        <p className="eyebrow">UP NEXT</p>
        <dl className="runtime-list">
          <div><dt>Next cron run</dt><dd>{calendar.availability === 'unavailable' ? 'Not Available' : formatDateTime(calendar.nextRun)}</dd></div>
          <div><dt>Latest session</dt><dd>{activity.availability === 'unavailable' ? 'Not Available' : activity.latest ? `${activity.latest.title} · ${activity.latest.lastActive}` : '—'}</dd></div>
          <div><dt>Skill categories</dt><dd>{knowledge.availability === 'unavailable' ? 'Not Available' : Object.entries(knowledge.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => `${category} (${count})`).join(', ') || '—'}</dd></div>
        </dl>
      </article>
    </section>
    <p className="card-note">Live reads dari layanan agen Claude AI Office, diperbarui otomatis.</p>
  </div>
}
