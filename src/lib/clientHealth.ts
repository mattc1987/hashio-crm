// Per-client health score based on activity recency, MRR status, and tasks.
// Pure derived — no backend, no state.

import type { Activity, Booking, Company, Deal, EmailSend, Task } from './types'
import { isActiveMRR } from './format'

export type HealthTier = 'green' | 'yellow' | 'red' | 'inactive'

export interface ClientHealth {
  tier: HealthTier
  score: number // 0..100
  reason: string
  daysSinceLastTouch: number | null
  activeMRR: number
  openTasks: number
  bookingsLast30: number
}

const DAY = 24 * 60 * 60 * 1000

export function computeClientHealth(
  company: Company,
  ctx: {
    deals: Deal[]
    tasks: Task[]
    activity: Activity[]
    emailSends: EmailSend[]
    bookings: Booking[]
    contacts: Array<{ id: string; companyId: string }>
  },
  now: Date = new Date(),
): ClientHealth {
  const companyDeals = ctx.deals.filter((d) => d.companyId === company.id)
  const companyContacts = ctx.contacts.filter((c) => c.companyId === company.id)
  const contactIds = new Set(companyContacts.map((c) => c.id))
  const dealIds = new Set(companyDeals.map((d) => d.id))

  const activeMRR = companyDeals.filter(isActiveMRR).reduce((s, d) => s + (d.mrr || 0), 0)

  // Last touch — most recent timestamp from sends, bookings, or tasks
  const touchTimes: number[] = []
  for (const e of ctx.emailSends) {
    if (contactIds.has(e.contactId) && e.sentAt) touchTimes.push(new Date(e.sentAt).getTime())
  }
  for (const b of ctx.bookings) {
    if (b.attendeeEmail && companyContacts.some((c) => 'email' in c && (c as { email?: string }).email === b.attendeeEmail)) {
      if (b.createdAt) touchTimes.push(new Date(b.createdAt).getTime())
    }
  }
  for (const t of ctx.tasks) {
    if (
      (t.contactId && contactIds.has(t.contactId)) ||
      (t.dealId && dealIds.has(t.dealId))
    ) {
      if (t.updatedAt) touchTimes.push(new Date(t.updatedAt).getTime())
      else if (t.createdAt) touchTimes.push(new Date(t.createdAt).getTime())
    }
  }

  const lastTouchMs = touchTimes.length ? Math.max(...touchTimes) : null
  const daysSinceLastTouch =
    lastTouchMs === null ? null : Math.floor((now.getTime() - lastTouchMs) / DAY)

  const openTasks = ctx.tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'cancelled' &&
      ((t.contactId && contactIds.has(t.contactId)) || (t.dealId && dealIds.has(t.dealId))),
  ).length

  const bookingsLast30 = ctx.bookings.filter((b) => {
    if (!b.createdAt) return false
    return now.getTime() - new Date(b.createdAt).getTime() < 30 * DAY
  }).length

  // ---- Score ----
  // Inactive clients (no MRR) just get 'inactive' badge
  if (activeMRR <= 0) {
    return {
      tier: 'inactive',
      score: 0,
      reason: 'No active MRR',
      daysSinceLastTouch,
      activeMRR,
      openTasks,
      bookingsLast30,
    }
  }

  let score = 100
  let reasonParts: string[] = []

  if (daysSinceLastTouch === null) {
    score -= 30
    reasonParts.push('Never contacted')
  } else if (daysSinceLastTouch > 90) {
    score -= 50
    reasonParts.push(`Last touch ${daysSinceLastTouch}d ago`)
  } else if (daysSinceLastTouch > 30) {
    score -= 25
    reasonParts.push(`Last touch ${daysSinceLastTouch}d ago`)
  } else {
    reasonParts.push(`Touched ${daysSinceLastTouch}d ago`)
  }

  if (openTasks > 3) {
    score -= 10
    reasonParts.push(`${openTasks} open tasks`)
  }

  // Translate to tier
  let tier: HealthTier
  if (score >= 75) tier = 'green'
  else if (score >= 45) tier = 'yellow'
  else tier = 'red'

  return {
    tier,
    score: Math.max(0, score),
    reason: reasonParts.join(' · '),
    daysSinceLastTouch,
    activeMRR,
    openTasks,
    bookingsLast30,
  }
}
