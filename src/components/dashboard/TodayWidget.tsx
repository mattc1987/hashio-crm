import { Link } from 'react-router-dom'
import { CalendarClock, CheckSquare, MailOpen, ArrowRight } from 'lucide-react'
import type { Booking, Contact, EmailSend, Task } from '../../lib/types'
import { date as fmtDate, relativeDate } from '../../lib/format'
import { Card, CardHeader, Avatar, Badge } from '../ui'
import { cn } from '../../lib/cn'

export function TodayWidget({
  bookings,
  tasks,
  emailSends,
  contacts,
}: {
  bookings: Booking[]
  tasks: Task[]
  emailSends: EmailSend[]
  contacts: Contact[]
}) {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000
  const dayMs = 24 * 60 * 60 * 1000

  const todaysBookings = bookings
    .filter((b) => {
      if (b.status !== 'confirmed') return false
      const t = new Date(b.slotStart).getTime()
      return t >= todayStart && t < tomorrowStart
    })
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart))
    .slice(0, 4)

  const upcomingTasks = tasks
    .filter((t) => {
      if (t.status === 'completed' || t.status === 'cancelled') return false
      if (!t.dueDate) return false
      return new Date(t.dueDate).getTime() < tomorrowStart
    })
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 5)

  const recentEngagement = emailSends
    .filter((s) => {
      if (!s.openedAt && !s.clickedAt && !s.repliedAt) return false
      const t = Math.max(
        s.openedAt ? new Date(s.openedAt).getTime() : 0,
        s.clickedAt ? new Date(s.clickedAt).getTime() : 0,
        s.repliedAt ? new Date(s.repliedAt).getTime() : 0,
      )
      return now.getTime() - t < dayMs
    })
    .sort((a, b) => {
      const ta = Math.max(
        a.openedAt ? new Date(a.openedAt).getTime() : 0,
        a.clickedAt ? new Date(a.clickedAt).getTime() : 0,
        a.repliedAt ? new Date(a.repliedAt).getTime() : 0,
      )
      const tb = Math.max(
        b.openedAt ? new Date(b.openedAt).getTime() : 0,
        b.clickedAt ? new Date(b.clickedAt).getTime() : 0,
        b.repliedAt ? new Date(b.repliedAt).getTime() : 0,
      )
      return tb - ta
    })
    .slice(0, 4)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* ----- Today's bookings ----- */}
      <Card padded={false}>
        <div className="px-5 py-4 border-soft-b">
          <CardHeader
            title={<span className="flex items-center gap-2"><CalendarClock size={14} className="text-[var(--color-info)]" /> Today's bookings</span>}
            subtitle={`${todaysBookings.length} scheduled`}
            action={
              <Link to="/scheduling" className="text-[12px] text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1">
                All <ArrowRight size={11} />
              </Link>
            }
          />
        </div>
        {todaysBookings.length === 0 ? (
          <div className="p-6 text-center text-muted text-[12px]">Nothing on the calendar today.</div>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {todaysBookings.map((b) => (
              <li key={b.id} className="px-5 py-3 flex items-center gap-3">
                <div className="text-right min-w-[58px]">
                  <div className="text-[13px] font-semibold tabular text-body">
                    {new Date(b.slotStart).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-body truncate">{b.attendeeName || '(no name)'}</div>
                  <div className="text-[11px] text-muted truncate">{b.attendeeEmail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ----- Tasks ----- */}
      <Card padded={false}>
        <div className="px-5 py-4 border-soft-b">
          <CardHeader
            title={<span className="flex items-center gap-2"><CheckSquare size={14} className="text-[var(--color-warning)]" /> Due today / overdue</span>}
            subtitle={`${upcomingTasks.length} on your plate`}
            action={
              <Link to="/tasks" className="text-[12px] text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1">
                All <ArrowRight size={11} />
              </Link>
            }
          />
        </div>
        {upcomingTasks.length === 0 ? (
          <div className="p-6 text-center text-muted text-[12px]">All caught up. 🎯</div>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {upcomingTasks.map((t) => {
              const overdue = t.dueDate && new Date(t.dueDate).getTime() < todayStart
              return (
                <li key={t.id} className="px-5 py-3 flex items-center gap-3">
                  <div className={cn(
                    'w-2 h-2 rounded-full shrink-0',
                    overdue ? 'bg-[var(--color-danger)]' :
                    t.priority === 'high' ? 'bg-[var(--color-warning)]' :
                    'bg-[var(--text-faint)]',
                  )} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-body truncate">{t.title}</div>
                    <div className="text-[11px] text-muted truncate">
                      {overdue ? <span className="text-[var(--color-danger)] font-medium">Overdue</span> : 'Due'}{' '}
                      {fmtDate(t.dueDate, 'MMM d')}
                    </div>
                  </div>
                  {t.priority === 'high' && <Badge tone="danger">high</Badge>}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* ----- Recent engagement ----- */}
      <Card padded={false}>
        <div className="px-5 py-4 border-soft-b">
          <CardHeader
            title={<span className="flex items-center gap-2"><MailOpen size={14} className="text-[var(--color-success)]" /> Engagement (24h)</span>}
            subtitle={`${recentEngagement.length} signal${recentEngagement.length === 1 ? '' : 's'}`}
            action={
              <Link to="/engagement" className="text-[12px] text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1">
                All <ArrowRight size={11} />
              </Link>
            }
          />
        </div>
        {recentEngagement.length === 0 ? (
          <div className="p-6 text-center text-muted text-[12px]">No opens / clicks / replies yet today.</div>
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {recentEngagement.map((s) => {
              const c = contacts.find((x) => x.id === s.contactId)
              const name = c ? `${c.firstName} ${c.lastName}`.trim() : s.to
              const signal =
                s.repliedAt ? { kind: 'replied', when: s.repliedAt, tone: 'brand' as const } :
                s.clickedAt ? { kind: 'clicked', when: s.clickedAt, tone: 'info' as const } :
                                { kind: 'opened', when: s.openedAt, tone: 'success' as const }
              return (
                <li key={s.id} className="px-5 py-3 flex items-center gap-3">
                  <Avatar name={name} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-body truncate">{name}</div>
                    <div className="text-[11px] text-muted truncate">{s.subject}</div>
                  </div>
                  <Badge tone={signal.tone}>{signal.kind}</Badge>
                  <span className="text-[10px] text-[var(--text-faint)] tabular shrink-0">
                    {relativeDate(signal.when)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
