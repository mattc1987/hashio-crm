// Unified activity timeline for a contact / deal / company.
// Aggregates: notes, email sends + opens/clicks/replies, tasks, bookings,
// sequence enrollments. Sorted by timestamp desc.

import { useMemo } from 'react'
import {
  StickyNote, Mail, MailOpen, MousePointerClick, Reply,
  CheckSquare, Calendar, Zap, AlertCircle, FileText,
  Phone, MessageSquare, Users as UsersIcon, Voicemail, Link2,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader } from './ui'
import { relativeDate, date as fmtDate } from '../lib/format'
import { cn } from '../lib/cn'

interface ActivityEvent {
  id: string
  type: 'note' | 'email-sent' | 'email-opened' | 'email-clicked' | 'email-replied'
        | 'email-inbound' | 'email-outbound-manual'
        | 'task-created' | 'task-completed' | 'booking' | 'enrollment'
        | 'log-call-out' | 'log-call-in' | 'log-voicemail'
        | 'log-text-out' | 'log-text-in'
        | 'log-meeting' | 'log-linkedin' | 'log-other'
  ts: string
  title: string
  description?: string
}

export function ActivityFeed({
  entityType,
  entityId,
  className,
  limit = 30,
}: {
  entityType: 'contact' | 'deal' | 'company'
  entityId: string
  className?: string
  limit?: number
}) {
  const { state } = useSheetData()
  const data = 'data' in state ? state.data : undefined

  const events: ActivityEvent[] = useMemo(() => {
    if (!data) return []
    const out: ActivityEvent[] = []

    // Resolve which contacts/deals are "in scope" for this entity
    const contactIds = new Set<string>()
    const dealIds = new Set<string>()
    if (entityType === 'contact') {
      contactIds.add(entityId)
    } else if (entityType === 'deal') {
      dealIds.add(entityId)
      const deal = data.deals.find((d) => d.id === entityId)
      if (deal?.contactId) contactIds.add(deal.contactId)
    } else if (entityType === 'company') {
      data.contacts.filter((c) => c.companyId === entityId).forEach((c) => contactIds.add(c.id))
      data.deals.filter((d) => d.companyId === entityId).forEach((d) => dealIds.add(d.id))
    }

    // Notes (direct on this entity)
    for (const n of data.notes) {
      if (n.entityType === entityType && n.entityId === entityId) {
        out.push({
          id: 'note-' + n.id, type: 'note', ts: n.createdAt,
          title: n.author ? `${n.author} added a note` : 'Note added',
          description: n.body,
        })
      }
    }

    // Email sends + opens/clicks/replies
    for (const s of data.emailSends) {
      if (!contactIds.has(s.contactId)) continue
      if (s.sentAt) {
        out.push({
          id: 'send-' + s.id, type: 'email-sent', ts: s.sentAt,
          title: 'Sent: ' + s.subject,
          description: s.bodyPreview,
        })
      }
      if (s.openedAt) {
        out.push({
          id: 'open-' + s.id, type: 'email-opened', ts: s.openedAt,
          title: 'Opened: ' + s.subject,
        })
      }
      if (s.clickedAt) {
        out.push({
          id: 'click-' + s.id, type: 'email-clicked', ts: s.clickedAt,
          title: 'Clicked link in: ' + s.subject,
        })
      }
      if (s.repliedAt) {
        out.push({
          id: 'reply-' + s.id, type: 'email-replied', ts: s.repliedAt,
          title: 'Replied to: ' + s.subject,
        })
      }
    }

    // Tasks
    for (const t of data.tasks) {
      if (!contactIds.has(t.contactId) && !dealIds.has(t.dealId)) continue
      if (t.createdAt) {
        out.push({
          id: 'task-c-' + t.id, type: 'task-created', ts: t.createdAt,
          title: 'Task created: ' + t.title,
          description: t.dueDate ? `Due ${fmtDate(t.dueDate, 'MMM d')}` : undefined,
        })
      }
      if (t.status === 'completed' && t.updatedAt) {
        out.push({
          id: 'task-d-' + t.id, type: 'task-completed', ts: t.updatedAt,
          title: 'Task completed: ' + t.title,
        })
      }
    }

    // Bookings (match by contact email)
    const contacts = data.contacts.filter((c) => contactIds.has(c.id))
    const emails = new Set(contacts.map((c) => (c.email || '').toLowerCase()).filter(Boolean))
    for (const b of data.bookings) {
      if (b.attendeeEmail && emails.has(b.attendeeEmail.toLowerCase())) {
        out.push({
          id: 'book-' + b.id, type: 'booking', ts: b.createdAt || b.slotStart,
          title: 'Booked a meeting',
          description: `${fmtDate(b.slotStart, "EEE MMM d 'at' h:mm a")}`,
        })
      }
    }

    // Sequence enrollments
    for (const e of data.enrollments) {
      if (!contactIds.has(e.contactId)) continue
      const seq = data.sequences.find((s) => s.id === e.sequenceId)
      out.push({
        id: 'enroll-' + e.id, type: 'enrollment', ts: e.enrolledAt,
        title: `Enrolled in "${seq?.name || 'sequence'}"`,
        description: e.status !== 'active' ? `Status: ${e.status}` : undefined,
      })
    }

    // Manually-logged activity (calls, texts, meetings, etc.)
    for (const log of data.activityLogs) {
      const matches =
        (log.entityType === entityType && log.entityId === entityId) ||
        // For company-level views, also include logs against contacts/deals of this company
        (entityType === 'company' && log.entityType === 'contact' && contactIds.has(log.entityId)) ||
        (entityType === 'company' && log.entityType === 'deal' && dealIds.has(log.entityId))
      if (!matches) continue
      out.push({
        id: 'log-' + log.id,
        type: logKindToEventType(log.kind),
        ts: log.occurredAt || log.createdAt,
        title: logTitle(log),
        description: log.body || undefined,
      })
    }

    return out
      .filter((ev) => ev.ts)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, limit)
  }, [data, entityType, entityId, limit])

  return (
    <Card padded={false} className={className}>
      <div className="px-5 py-4 border-soft-b">
        <CardHeader
          title="Activity"
          subtitle={`Last ${events.length} event${events.length === 1 ? '' : 's'} — emails, tasks, notes, bookings`}
        />
      </div>
      {events.length === 0 ? (
        <div className="p-8 text-center text-[12px] text-muted">
          Nothing's happened yet on this {entityType}.
        </div>
      ) : (
        <ol className="px-5 py-4 relative">
          {/* Vertical line */}
          <div
            className="absolute left-[26px] top-4 bottom-4 w-px bg-[color:var(--border)]"
            aria-hidden
          />
          {events.map((ev) => (
            <li key={ev.id} className="relative flex items-start gap-3 py-2.5">
              <ActivityIcon type={ev.type} />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-[13px] text-body leading-tight">
                  {ev.title}
                </div>
                {ev.description && (
                  <div className="text-[12px] text-muted mt-1 line-clamp-2">{ev.description}</div>
                )}
                <div className="text-[11px] text-[var(--text-faint)] mt-1 tabular">
                  {relativeDate(ev.ts)} · {fmtDate(ev.ts, "MMM d 'at' h:mm a")}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

function ActivityIcon({ type }: { type: ActivityEvent['type'] }) {
  const map: Record<ActivityEvent['type'], { icon: React.ReactNode; bg: string; fg: string }> = {
    'note':           { icon: <StickyNote size={11} />,        bg: 'bg-[color:rgba(245,165,36,0.14)]', fg: 'text-[var(--color-warning)]' },
    'email-sent':     { icon: <Mail size={11} />,              bg: 'bg-[color:rgba(122,94,255,0.12)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'email-opened':   { icon: <MailOpen size={11} />,          bg: 'bg-[color:rgba(48,179,107,0.12)]', fg: 'text-[var(--color-success)]' },
    'email-clicked':  { icon: <MousePointerClick size={11} />, bg: 'bg-[color:rgba(59,130,246,0.12)]', fg: 'text-[var(--color-info)]' },
    'email-replied':  { icon: <Reply size={11} />,             bg: 'bg-[color:rgba(122,94,255,0.14)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'email-inbound':  { icon: <Mail size={11} />,              bg: 'bg-[color:rgba(48,179,107,0.14)]', fg: 'text-[var(--color-success)]' },
    'email-outbound-manual': { icon: <Mail size={11} />,       bg: 'bg-[color:rgba(122,94,255,0.10)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'task-created':   { icon: <CheckSquare size={11} />,       bg: 'bg-[var(--surface-3)]',           fg: 'text-muted' },
    'task-completed': { icon: <CheckSquare size={11} />,       bg: 'bg-[color:rgba(48,179,107,0.12)]', fg: 'text-[var(--color-success)]' },
    'booking':        { icon: <Calendar size={11} />,          bg: 'bg-[color:rgba(59,130,246,0.12)]', fg: 'text-[var(--color-info)]' },
    'enrollment':     { icon: <Zap size={11} />,               bg: 'bg-[color:rgba(122,94,255,0.12)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'log-call-out':   { icon: <Phone size={11} />,             bg: 'bg-[color:rgba(122,94,255,0.12)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'log-call-in':    { icon: <Phone size={11} />,             bg: 'bg-[color:rgba(48,179,107,0.12)]', fg: 'text-[var(--color-success)]' },
    'log-voicemail':  { icon: <Voicemail size={11} />,         bg: 'bg-[color:rgba(245,165,36,0.14)]', fg: 'text-[var(--color-warning)]' },
    'log-text-out':   { icon: <MessageSquare size={11} />,     bg: 'bg-[color:rgba(122,94,255,0.12)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    'log-text-in':    { icon: <MessageSquare size={11} />,     bg: 'bg-[color:rgba(48,179,107,0.12)]', fg: 'text-[var(--color-success)]' },
    'log-meeting':    { icon: <UsersIcon size={11} />,         bg: 'bg-[color:rgba(59,130,246,0.12)]', fg: 'text-[var(--color-info)]' },
    'log-linkedin':   { icon: <Link2 size={11} />,             bg: 'bg-[color:rgba(10,102,194,0.14)]', fg: 'text-[#0a66c2]' },
    'log-other':      { icon: <FileText size={11} />,          bg: 'bg-[var(--surface-3)]',           fg: 'text-muted' },
  }
  const m = map[type]
  return (
    <span
      className={cn(
        'w-[26px] h-[26px] rounded-full grid place-items-center shrink-0 relative z-10 border-2 border-[var(--bg-elev)]',
        m.bg, m.fg,
      )}
    >
      {m.icon}
    </span>
  )
}

void AlertCircle  // reserved for future

import type { ActivityLog as TActivityLog } from '../lib/types'

function logKindToEventType(kind: TActivityLog['kind']): ActivityEvent['type'] {
  switch (kind) {
    case 'call-outbound':    return 'log-call-out'
    case 'call-inbound':     return 'log-call-in'
    case 'voicemail':        return 'log-voicemail'
    case 'text-outbound':    return 'log-text-out'
    case 'text-inbound':     return 'log-text-in'
    case 'email-inbound':    return 'email-inbound'
    case 'email-outbound':   return 'email-outbound-manual'
    case 'meeting':          return 'log-meeting'
    case 'linkedin-message': return 'log-linkedin'
    case 'other':
    default:                 return 'log-other'
  }
}

function logTitle(log: TActivityLog): string {
  const labels: Record<TActivityLog['kind'], string> = {
    'call-outbound':    'Outbound call',
    'call-inbound':     'Inbound call',
    'voicemail':        'Voicemail',
    'text-outbound':    'Sent text',
    'text-inbound':     'Received text',
    'email-inbound':    'Inbound email',
    'email-outbound':   'Outbound email (manual)',
    'meeting':          'Meeting',
    'linkedin-message': 'LinkedIn message',
    'other':            'Logged activity',
  }
  let s = labels[log.kind] || 'Activity'
  if (log.outcome) {
    const oLabel: Record<string, string> = {
      'connected': 'connected',
      'no-answer': 'no answer',
      'left-voicemail': 'left voicemail',
      'replied': 'replied',
      'no-reply': 'no reply',
      'completed': 'completed',
    }
    if (oLabel[log.outcome]) s += ` — ${oLabel[log.outcome]}`
  }
  if (log.durationMinutes) s += ` (${log.durationMinutes} min)`
  return s
}
