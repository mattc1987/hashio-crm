// Heuristic AI-BDR briefing generator. Reads the full SheetData, computes
// priority signals, and returns a structured briefing.
//
// Designed to run client-side with no LLM call. The shape mirrors what an
// LLM would produce, so we can swap in Claude/OpenAI later without changing
// the UI.

import type { Deal, Lead, SheetData } from './types'
import { scoreLead, type ScoreResult } from './leadScoring'

export interface BriefingItem {
  id: string
  /** What to do, plain language. */
  headline: string
  /** Why we surfaced this — the reason. */
  reason: string
  /** Optional follow-up explanation / data. */
  detail?: string
  /** A tag for visual grouping in the UI. */
  kind: 'lead' | 'deal' | 'contact' | 'task' | 'sequence' | 'booking' | 'reply'
  /** Severity / priority hint. */
  priority: 'critical' | 'high' | 'medium' | 'low'
  /** Where to navigate when the user clicks. */
  href?: string
  /** Optional secondary actions the UI may render. */
  actions?: Array<{ label: string; href: string }>
}

export interface BriefingSection {
  id: string
  title: string
  subtitle?: string
  items: BriefingItem[]
  emoji?: string
}

export interface Briefing {
  generatedAt: string
  /** Punchy 1-2 line summary of the day. */
  summary: string
  /** Counts for quick stat strip. */
  stats: {
    hotLeads: number
    stalePipeline: number
    dueToday: number
    recentReplies: number
    todaysBookings: number
  }
  sections: BriefingSection[]
}

const DAY = 24 * 60 * 60 * 1000

export function generateBriefing(data: SheetData, now: Date = new Date()): Briefing {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const tomorrowStart = todayStart + DAY

  // ---------- Section: Hot leads ----------
  const scoredLeads: Array<Lead & { _score: ScoreResult }> = data.leads
    .filter((l) => l.status !== 'archived' && l.status !== 'converted')
    .map((l) => ({ ...l, _score: scoreLead(l, now) }))

  const hotLeads = scoredLeads
    .filter((l) => l._score.temperature === 'molten' || l._score.temperature === 'hot')
    .sort((a, b) => b._score.score - a._score.score)
    .slice(0, 5)

  // ---------- Section: Replies (very-recent — needs immediate response) ----------
  const recentReplyMs = 3 * DAY
  const recentReplies = data.emailSends
    .filter((s) => s.repliedAt && now.getTime() - new Date(s.repliedAt).getTime() < recentReplyMs)
    .sort((a, b) => (b.repliedAt || '').localeCompare(a.repliedAt || ''))
    .slice(0, 5)

  // ---------- Section: Stale high-value deals ----------
  const stalePipeline = data.deals
    .filter((d) => d.value > 0 && !d.stage.toLowerCase().startsWith('closed'))
    .map((d) => ({
      deal: d,
      lastActivity: lastActivityForDeal(d, data),
    }))
    .filter((x) => !x.lastActivity || now.getTime() - x.lastActivity > 14 * DAY)
    .sort((a, b) => b.deal.value - a.deal.value)
    .slice(0, 5)

  // ---------- Section: Bookings today ----------
  const todaysBookings = data.bookings
    .filter((b) => {
      if (b.status !== 'confirmed') return false
      const t = new Date(b.slotStart).getTime()
      return t >= todayStart && t < tomorrowStart
    })
    .sort((a, b) => a.slotStart.localeCompare(b.slotStart))

  // ---------- Section: Tasks due today / overdue ----------
  const dueTasks = data.tasks
    .filter((t) => {
      if (t.status === 'completed' || t.status === 'cancelled') return false
      if (!t.dueDate) return false
      return new Date(t.dueDate).getTime() < tomorrowStart
    })
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 7)

  // ---------- Section: Sequence health ----------
  const sequenceHealth = data.sequences
    .filter((s) => s.status === 'active')
    .map((s) => {
      const enrollmentsForSeq = data.enrollments.filter((e) => e.sequenceId === s.id)
      const activeEnrollments = enrollmentsForSeq.filter((e) => e.status === 'active')
      const sendsForSeq = data.emailSends.filter((es) => es.sequenceId === s.id)
      const opened = sendsForSeq.filter((es) => es.openedAt).length
      const replied = sendsForSeq.filter((es) => es.repliedAt).length
      const openRate = sendsForSeq.length > 0 ? opened / sendsForSeq.length : 0
      return {
        sequence: s,
        activeEnrollments: activeEnrollments.length,
        totalSends: sendsForSeq.length,
        openRate,
        replied,
      }
    })

  // Sequences underperforming
  const underperformingSequences = sequenceHealth
    .filter((sh) => sh.totalSends >= 5 && sh.openRate < 0.2)
    .sort((a, b) => a.openRate - b.openRate)
    .slice(0, 3)

  // ---------- Build sections ----------
  const sections: BriefingSection[] = []

  if (recentReplies.length > 0) {
    sections.push({
      id: 'replies',
      title: 'Replies waiting on you',
      subtitle: 'These contacts replied to a sequence email — respond personally.',
      emoji: '💬',
      items: recentReplies.map((s) => {
        const c = data.contacts.find((x) => x.id === s.contactId)
        return {
          id: 'reply-' + s.id,
          headline: `${c ? `${c.firstName} ${c.lastName}` : s.to} replied`,
          reason: `Replied to "${s.subject}" ${relativeAgoRough(s.repliedAt, now)}`,
          detail: s.bodyPreview,
          kind: 'reply',
          priority: 'critical',
          href: c ? `/contacts/${c.id}` : '/engagement',
          actions: [{ label: 'Open contact', href: c ? `/contacts/${c.id}` : '/engagement' }],
        }
      }),
    })
  }

  if (hotLeads.length > 0) {
    sections.push({
      id: 'hot-leads',
      title: 'Hot leads to reach today',
      subtitle: 'High-engagement prospects from your lead-ingest webhook.',
      emoji: '🔥',
      items: hotLeads.map((l) => ({
        id: 'lead-' + l.id,
        headline: `${l.firstName} ${l.lastName} at ${l.companyName || 'unknown company'}`,
        reason: l._score.reasons.length > 0 ? l._score.reasons.join(', ') : 'High engagement signals',
        detail: l._score.signalCount > 0 ? `${l._score.signalCount} signals · score ${l._score.score}` : undefined,
        kind: 'lead',
        priority: l._score.temperature === 'molten' ? 'critical' : 'high',
        href: '/leads',
        actions: [{ label: 'Open in Leads', href: '/leads' }],
      })),
    })
  }

  if (todaysBookings.length > 0) {
    sections.push({
      id: 'bookings',
      title: "Today's meetings",
      subtitle: 'Prep notes for who you\'re talking to today.',
      emoji: '📅',
      items: todaysBookings.map((b) => ({
        id: 'book-' + b.id,
        headline: `${b.attendeeName || b.attendeeEmail} at ${formatTime(b.slotStart)}`,
        reason: b.attendeeNotes || 'Booked through scheduling page.',
        kind: 'booking',
        priority: 'high',
        href: '/scheduling',
      })),
    })
  }

  if (dueTasks.length > 0) {
    sections.push({
      id: 'tasks',
      title: 'Tasks on your plate',
      subtitle: 'Due today or earlier.',
      emoji: '✅',
      items: dueTasks.map((t) => {
        const overdue = t.dueDate && new Date(t.dueDate).getTime() < todayStart
        return {
          id: 'task-' + t.id,
          headline: t.title,
          reason: overdue ? `Overdue (was due ${t.dueDate?.slice(0, 10)})` : `Due today`,
          kind: 'task',
          priority: overdue ? 'high' : t.priority === 'high' ? 'high' : 'medium',
          href: '/tasks',
        }
      }),
    })
  }

  if (stalePipeline.length > 0) {
    sections.push({
      id: 'stale-pipeline',
      title: 'Pipeline at risk',
      subtitle: 'High-value open deals with no recent activity.',
      emoji: '⏰',
      items: stalePipeline.map((s) => {
        const co = data.companies.find((c) => c.id === s.deal.companyId)
        const days = s.lastActivity ? Math.floor((now.getTime() - s.lastActivity) / DAY) : null
        return {
          id: 'deal-' + s.deal.id,
          headline: `${s.deal.title} — ${formatCurrencyShort(s.deal.value)}`,
          reason: days !== null ? `No activity in ${days} days` : 'No recorded activity',
          detail: co ? `${co.name} · ${s.deal.stage}` : s.deal.stage,
          kind: 'deal',
          priority: s.deal.value >= 25000 ? 'high' : 'medium',
          href: `/deals/${s.deal.id}`,
        }
      }),
    })
  }

  if (underperformingSequences.length > 0) {
    sections.push({
      id: 'seq-health',
      title: 'Sequences worth tuning',
      subtitle: 'Low open rates suggest the subject line or list isn\'t landing.',
      emoji: '⚠️',
      items: underperformingSequences.map((sh) => ({
        id: 'seq-' + sh.sequence.id,
        headline: sh.sequence.name,
        reason: `${(sh.openRate * 100).toFixed(0)}% open rate across ${sh.totalSends} sends`,
        detail: sh.activeEnrollments > 0 ? `${sh.activeEnrollments} contacts still enrolled` : 'No active enrollments',
        kind: 'sequence',
        priority: 'medium',
        href: `/sequences/${sh.sequence.id}`,
      })),
    })
  }

  // ---------- Generate top-line summary ----------
  const summary = buildSummary({
    hotLeads: hotLeads.length,
    replies: recentReplies.length,
    bookings: todaysBookings.length,
    tasks: dueTasks.length,
    stale: stalePipeline.length,
  })

  return {
    generatedAt: now.toISOString(),
    summary,
    stats: {
      hotLeads: hotLeads.length,
      stalePipeline: stalePipeline.length,
      dueToday: dueTasks.length,
      recentReplies: recentReplies.length,
      todaysBookings: todaysBookings.length,
    },
    sections,
  }
}

/* ---------- Helpers ---------- */

function lastActivityForDeal(deal: Deal, data: SheetData): number | null {
  const ts: number[] = []
  // Email sends to the deal's contact
  data.emailSends.forEach((es) => {
    if (es.contactId === deal.contactId && es.sentAt) ts.push(new Date(es.sentAt).getTime())
  })
  // Activity logs
  data.activityLogs.forEach((log) => {
    const matches =
      (log.entityType === 'deal' && log.entityId === deal.id) ||
      (log.entityType === 'contact' && log.entityId === deal.contactId)
    if (matches && log.occurredAt) ts.push(new Date(log.occurredAt).getTime())
  })
  // Tasks
  data.tasks.forEach((t) => {
    if (t.dealId === deal.id && t.updatedAt) ts.push(new Date(t.updatedAt).getTime())
  })
  // Notes
  data.notes.forEach((n) => {
    if (n.entityType === 'deal' && n.entityId === deal.id && n.createdAt) {
      ts.push(new Date(n.createdAt).getTime())
    }
  })
  if (ts.length === 0) return null
  return Math.max(...ts)
}

function relativeAgoRough(ts: string | undefined, now: Date): string {
  if (!ts) return 'recently'
  const diff = now.getTime() - new Date(ts).getTime()
  if (diff < 60 * 60 * 1000) return 'just now'
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / DAY)}d ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatCurrencyShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function buildSummary(s: { hotLeads: number; replies: number; bookings: number; tasks: number; stale: number }): string {
  const parts: string[] = []
  if (s.replies > 0) {
    parts.push(`${s.replies} repl${s.replies === 1 ? 'y' : 'ies'} need a personal response`)
  }
  if (s.hotLeads > 0) {
    parts.push(`${s.hotLeads} hot lead${s.hotLeads === 1 ? '' : 's'} ready to outreach`)
  }
  if (s.bookings > 0) {
    parts.push(`${s.bookings} meeting${s.bookings === 1 ? '' : 's'} on your calendar today`)
  }
  if (s.tasks > 0) {
    parts.push(`${s.tasks} task${s.tasks === 1 ? '' : 's'} on your plate`)
  }
  if (s.stale > 0) {
    parts.push(`${s.stale} stale deal${s.stale === 1 ? '' : 's'} worth a check-in`)
  }
  if (parts.length === 0) return "All clear today — nothing urgent on the board. Great time to prospect."
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase() + parts[0].slice(1) + '.'
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1] + '.'
}

