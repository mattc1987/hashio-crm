// LLM helpers for the BDR — calls the Apps Script proxy which holds the
// Anthropic API key server-side. The browser never sees the key.
//
// Operations:
//   draftMessage(proposal, data)        → { subject?, body }
//   narrativeReason(proposal, data)     → { narrative }
//   suggestNextMove(entity, ctx)        → AI-strategist next-move plan

import type { Contact, Deal, Lead, Proposal, SheetData, Task } from './types'
import { scoreLead } from './leadScoring'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

async function call<T>(action: string, params: Record<string, unknown>): Promise<T> {
  if (!APPS_SCRIPT_URL) throw new Error('Backend not configured')

  // POST so the payload (which can include rich CRM context — sometimes 5-10 KB)
  // doesn't hit Apps Script's URL length limit (~16 KB total). Apps Script
  // doPost reads the same `action`, `key`, `payload` form fields.
  const body = new URLSearchParams()
  body.set('action', action)
  body.set('key', APPS_SCRIPT_KEY)
  body.set('payload', JSON.stringify(params))

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body,
    redirect: 'follow',
    // Apps Script needs Content-Type: application/x-www-form-urlencoded; URLSearchParams sets this.
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json().catch(() => ({ ok: false, error: 'Non-JSON response from Apps Script (likely an unhandled error or stale deploy).' }))
  if (!json.ok) throw new Error(json.error || 'Failed')
  if (json.data === undefined || json.data === null) {
    throw new Error('Apps Script returned ok=true but no data — likely a transient error on the AI call. Try again.')
  }
  return json.data as T
}

export interface DraftResult {
  subject: string
  body: string
  model: string
}

export async function draftMessage(
  proposal: Proposal,
  data: SheetData,
  instruction = '',
): Promise<DraftResult> {
  const kind = proposal.actionKind === 'send-sms' ? 'sms' : 'email'
  const context = buildContext(proposal, data)
  return call<DraftResult>('draftMessage', { kind, context, instruction })
}

export async function narrativeReason(
  proposal: Proposal,
  data: SheetData,
): Promise<{ narrative: string }> {
  const context = buildContext(proposal, data)
  return call<{ narrative: string }>('narrativeReason', {
    proposalSummary: proposal.title + ' — ' + proposal.reason,
    context,
  })
}

function buildContext(p: Proposal, data: SheetData) {
  const ctx: Record<string, unknown> = {}

  // Always pass real booking links so Claude doesn't invent Calendly URLs.
  ctx.bookingLinks = buildBookingLinksContext(data)

  // Contact
  const contactId = (p.contactIds || '').split(',').map((s) => s.trim()).filter(Boolean)[0]
  if (contactId) {
    const c = data.contacts.find((x) => x.id === contactId)
    if (c) {
      const co = c.companyId ? data.companies.find((x) => x.id === c.companyId) : null
      ctx.contact = {
        firstName: c.firstName,
        lastName: c.lastName,
        title: c.title,
        email: c.email,
        linkedinUrl: c.linkedinUrl,
        companyName: co?.name || '',
      }
    }
  }

  // Deal
  if (p.dealId) {
    const d = data.deals.find((x) => x.id === p.dealId)
    if (d) {
      ctx.deal = {
        title: d.title,
        stage: d.stage,
        value: d.value,
        mrr: d.mrr,
        notes: d.notes,
      }
    }
  }

  // Triggering signal — extract from action payload + reason
  ctx.signal = p.reason

  // Recent activity for the contact
  if (contactId) {
    const recent: string[] = []
    const sends = data.emailSends
      .filter((s) => s.contactId === contactId)
      .sort((a, b) => (b.sentAt || '').localeCompare(a.sentAt || ''))
      .slice(0, 3)
    for (const s of sends) {
      const opens = s.openedAt ? ' · opened' : ''
      const clicks = s.clickedAt ? ' · clicked' : ''
      const replies = s.repliedAt ? ' · REPLIED' : ''
      recent.push(`Email "${s.subject}" sent ${s.sentAt?.slice(0, 10)}${opens}${clicks}${replies}`)
    }
    const logs = data.activityLogs
      .filter((l) => l.entityType === 'contact' && l.entityId === contactId)
      .sort((a, b) => (b.occurredAt || '').localeCompare(a.occurredAt || ''))
      .slice(0, 3)
    for (const l of logs) {
      recent.push(`${l.kind} on ${l.occurredAt?.slice(0, 10)}: ${(l.body || '').slice(0, 100)}`)
    }
    ctx.recentActivity = recent
  }

  // Prior email — for follow-ups, pull the last send to this contact
  try {
    const payload = JSON.parse(p.actionPayload || '{}') as Record<string, unknown>
    if (payload.replyToSendId) {
      const send = data.emailSends.find((s) => s.id === payload.replyToSendId)
      if (send) {
        ctx.priorEmail = {
          subject: send.subject,
          body: send.bodyPreview,
        }
      }
    }
    if (payload.templateHint) {
      ctx.goal = inferGoal(payload.templateHint as string)
    }
  } catch {
    /* ignore */
  }

  if (!ctx.goal) ctx.goal = 'Continue the conversation in a way that earns a reply.'
  return ctx
}

function inferGoal(hint: string): string {
  switch (hint) {
    case 'check-in': return 'Re-open the conversation after a long quiet stretch. Reference the deal we already have. Keep it warm, not salesy.'
    case 'soft-bump': return 'They opened your email but didn\'t reply. Send a short bump on the same thread. 2-3 sentences max.'
    case 'click-followup': return 'They clicked a link in your email. Reference the resource they engaged with and offer to discuss it.'
    case 'no-show-recovery': return 'They missed a confirmed booking. Be friendly — assume good faith. Offer a fresh booking link.'
    default: return hint
  }
}

// ============================================================
// AI BDR — Suggest next move
// ============================================================

export type NextMoveAction =
  | 'send-email'
  | 'send-sms'
  | 'create-task'
  | 'log-activity'
  | 'update-deal'
  | 'create-deal'
  | 'convert-lead'
  | 'wait'
  | 'pause'

export interface NextMoveSuggestion {
  narrative: string
  recommendedAction: NextMoveAction
  reasoning: string
  draftedSubject: string
  draftedBody: string
  taskTitle: string
  taskNotes: string
  alternativeActions: string[]
  confidence: number
  model: string
}

export type SuggestEntity =
  | { kind: 'task'; task: Task }
  | { kind: 'contact'; contact: Contact }
  | { kind: 'deal'; deal: Deal }
  | { kind: 'lead'; lead: Lead }

/**
 * Ask the AI BDR what to do next on a given entity. The client builds a rich
 * context (entity + relations + recent activity) and the BDR strategist prompt
 * on the server returns a concrete next-move plan.
 */
export async function suggestNextMove(
  entity: SuggestEntity,
  data: SheetData,
  options: { goal?: string; instruction?: string } = {},
): Promise<NextMoveSuggestion> {
  const context = buildSuggestionContext(entity, data)
  return call<NextMoveSuggestion>('aiSuggestNextMove', {
    entityType: entity.kind,
    context,
    goal: options.goal || '',
    instruction: options.instruction || '',
  })
}

function buildSuggestionContext(entity: SuggestEntity, data: SheetData): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}

  // ALWAYS include Matt's active booking links + their REAL public URLs so
  // Claude doesn't invent Calendly URLs that 404. The AI is instructed in
  // the system prompt to use these verbatim when proposing a meeting.
  ctx.bookingLinks = buildBookingLinksContext(data)

  if (entity.kind === 'task') {
    const t = entity.task
    ctx.task = {
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueDate: t.dueDate,
      notes: t.notes,
    }
    if (t.contactId) {
      const c = data.contacts.find((x) => x.id === t.contactId)
      if (c) ctx.contact = serializeContact(c, data)
    }
    if (t.dealId) {
      const d = data.deals.find((x) => x.id === t.dealId)
      if (d) ctx.deal = serializeDeal(d)
    }
    if (t.contactId) ctx.recentActivity = recentActivityFor(t.contactId, data)
  }

  if (entity.kind === 'contact') {
    ctx.contact = serializeContact(entity.contact, data)
    ctx.recentActivity = recentActivityFor(entity.contact.id, data)
    const openDeal = data.deals.find(
      (d) => d.contactId === entity.contact.id && !d.stage.startsWith('Closed'),
    )
    if (openDeal) ctx.deal = serializeDeal(openDeal)
  }

  if (entity.kind === 'deal') {
    ctx.deal = serializeDeal(entity.deal)
    if (entity.deal.contactId) {
      const c = data.contacts.find((x) => x.id === entity.deal.contactId)
      if (c) ctx.contact = serializeContact(c, data)
      ctx.recentActivity = recentActivityFor(entity.deal.contactId, data)
    }
  }

  if (entity.kind === 'lead') {
    const l = entity.lead
    ctx.lead = {
      name: `${l.firstName} ${l.lastName}`.trim(),
      email: l.email,
      title: l.title || l.headline,
      company: l.companyName,
      linkedinUrl: l.linkedinUrl,
      location: l.location,
      score: l.score,
      temperature: l.temperature,
      status: l.status,
      source: l.source,
    }
    // Parse and surface their engagement signals
    try {
      const sigs = JSON.parse(l.engagementSignals || '[]') as Array<{ kind: string; ts: string; target?: string }>
      ctx.signals = sigs.slice(-10).map((s) => `${s.kind} on ${(s.ts || '').slice(0, 10)}${s.target ? ` (${s.target})` : ''}`)
    } catch {
      ctx.signals = []
    }
  }

  return ctx
}

function serializeContact(c: Contact, data: SheetData) {
  const company = c.companyId ? data.companies.find((co) => co.id === c.companyId) : null
  return {
    name: `${c.firstName} ${c.lastName}`.trim(),
    title: c.title,
    email: c.email,
    phone: c.phone,
    linkedinUrl: c.linkedinUrl,
    state: c.state,
    status: c.status,
    tags: c.tags,
    company: company?.name || '',
    companyIndustry: company?.industry || '',
    companySize: company?.size || '',
  }
}

function serializeDeal(d: Deal) {
  return {
    title: d.title,
    stage: d.stage,
    value: d.value,
    mrr: d.mrr,
    probability: d.probability,
    closeDate: d.closeDate,
    contractEnd: d.contractEnd,
    notes: d.notes,
  }
}

function recentActivityFor(contactId: string, data: SheetData): string[] {
  const out: Array<{ ts: string; line: string }> = []

  for (const s of data.emailSends) {
    if (s.contactId !== contactId) continue
    if (s.sentAt) out.push({ ts: s.sentAt, line: `Sent email "${s.subject}" on ${s.sentAt.slice(0, 10)}${s.openedAt ? ' · OPENED' : ''}${s.clickedAt ? ' · CLICKED' : ''}${s.repliedAt ? ' · REPLIED' : ''}` })
  }
  for (const sms of data.smsSends) {
    if (sms.contactId !== contactId) continue
    if (sms.sentAt) out.push({ ts: sms.sentAt, line: `Sent SMS on ${sms.sentAt.slice(0, 10)}${sms.repliedAt ? ' · REPLIED' : ''}` })
  }
  for (const log of data.activityLogs) {
    if (log.entityType === 'contact' && log.entityId === contactId) {
      out.push({ ts: log.occurredAt || log.createdAt, line: `${log.kind}${log.outcome ? ` (${log.outcome})` : ''}: ${(log.body || '').slice(0, 120)}` })
    }
  }
  for (const n of data.notes) {
    if (n.entityType === 'contact' && n.entityId === contactId) {
      out.push({ ts: n.createdAt, line: `Note: ${(n.body || '').slice(0, 150)}` })
    }
  }

  return out
    .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
    .slice(0, 10)
    .map((x) => x.line)
}

// ============================================================
// AI Dashboard Briefing — daily strategist read
// ============================================================

export interface DashboardPriority {
  title: string
  reason: string
  urgency: 'critical' | 'high' | 'medium'
  entityType: 'contact' | 'deal' | 'lead' | 'task' | 'booking' | 'find-leads' | 'none'
  entityId: string
  actionHint: 'send-email' | 'respond' | 'call' | 'research' | 'find-leads' | 'advance-deal' | 'qualify' | 'review'
}

export interface DashboardBriefing {
  greeting: string
  narrative: string
  priorities: DashboardPriority[]
  pipelineHealth: { status: 'healthy' | 'thin' | 'critical'; comment: string }
  model: string
  generatedAt: string
}

export async function dashboardBriefing(data: SheetData): Promise<DashboardBriefing> {
  const digest = buildDashboardDigest(data)
  return call<DashboardBriefing>('aiDashboardBriefing', { digest })
}

/** Compact CRM digest for Claude — only what's needed for daily prioritization. */
function buildDashboardDigest(data: SheetData): Record<string, unknown> {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000

  // Replies waiting (highest priority)
  const repliesWaiting = data.emailSends
    .filter((s) => s.repliedAt && (now - new Date(s.repliedAt).getTime()) < 7 * DAY)
    .map((s) => {
      const c = data.contacts.find((x) => x.id === s.contactId)
      return {
        sendId: s.id,
        contactId: s.contactId,
        contactName: c ? `${c.firstName} ${c.lastName}` : s.to,
        company: c?.companyId ? data.companies.find((co) => co.id === c.companyId)?.name : '',
        subject: s.subject,
        repliedAt: s.repliedAt,
        hoursAgo: Math.floor((now - new Date(s.repliedAt).getTime()) / 3600_000),
      }
    })
    .sort((a, b) => a.hoursAgo - b.hoursAgo)
    .slice(0, 5)

  // Hot leads (>= warm, unconverted)
  const hotLeads = data.leads
    .filter((l) => l.status !== 'archived' && l.status !== 'converted')
    .map((l) => ({ ...l, _score: scoreLeadCompat(l) }))
    .filter((l) => l._score.temperature === 'hot' || l._score.temperature === 'molten')
    .sort((a, b) => b._score.score - a._score.score)
    .slice(0, 5)
    .map((l) => ({
      leadId: l.id,
      name: `${l.firstName} ${l.lastName}`,
      company: l.companyName,
      title: l.title || l.headline,
      score: l._score.score,
      temperature: l._score.temperature,
      lastSignal: l.lastSignalAt,
    }))

  // Today's bookings
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = todayStart.getTime() + DAY
  const todaysBookings = data.bookings
    .filter((b) => {
      if (b.status !== 'confirmed') return false
      const t = new Date(b.slotStart).getTime()
      return t >= todayStart.getTime() && t < todayEnd
    })
    .map((b) => ({
      bookingId: b.id,
      attendee: b.attendeeName || b.attendeeEmail,
      slotStart: b.slotStart,
      notes: (b.attendeeNotes || '').slice(0, 100),
    }))

  // Stale high-value deals
  const staleDeals = data.deals
    .filter((d) => !d.stage.startsWith('Closed') && d.value >= 5000)
    .map((d) => {
      // Compute last activity
      const lastEmail = data.emailSends
        .filter((s) => s.contactId === d.contactId && s.sentAt)
        .map((s) => new Date(s.sentAt).getTime())
        .reduce((max, t) => Math.max(max, t), 0)
      const lastLog = data.activityLogs
        .filter((l) => l.entityType === 'deal' && l.entityId === d.id && l.occurredAt)
        .map((l) => new Date(l.occurredAt).getTime())
        .reduce((max, t) => Math.max(max, t), 0)
      const lastActivity = Math.max(lastEmail, lastLog, new Date(d.updatedAt || d.createdAt || 0).getTime())
      const daysQuiet = Math.floor((now - lastActivity) / DAY)
      const c = d.contactId ? data.contacts.find((x) => x.id === d.contactId) : null
      return {
        dealId: d.id,
        title: d.title,
        stage: d.stage,
        value: d.value,
        contactName: c ? `${c.firstName} ${c.lastName}` : '',
        daysQuiet,
      }
    })
    .filter((d) => d.daysQuiet >= 14)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  // Open deal counts by stage
  const openDeals = data.deals.filter((d) => !d.stage.startsWith('Closed'))
  const dealsByStage = openDeals.reduce((acc, d) => {
    acc[d.stage] = (acc[d.stage] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  // Active MRR + pipeline value
  const activeMRR = data.deals
    .filter((d) => d.stage === 'Closed Won' && d.mrrStatus === 'active')
    .reduce((s, d) => s + (d.mrr || 0), 0)
  const pipelineValue = openDeals.reduce((s, d) => s + (d.value || 0), 0)
  const weightedPipeline = openDeals.reduce((s, d) => s + (d.value || 0) * ((d.probability || 0) / 100), 0)

  // Tasks due
  const dueTasks = data.tasks
    .filter((t) => {
      if (t.status === 'completed' || t.status === 'cancelled') return false
      if (!t.dueDate) return false
      return new Date(t.dueDate).getTime() < todayEnd
    })
    .slice(0, 10)
    .map((t) => ({
      taskId: t.id,
      title: t.title,
      dueDate: t.dueDate,
      priority: t.priority,
    }))

  return {
    today: new Date().toISOString().slice(0, 10),
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    repliesWaiting,
    hotLeads,
    todaysBookings,
    staleDeals,
    dealsByStage,
    pipeline: {
      openCount: openDeals.length,
      totalValue: pipelineValue,
      weightedValue: weightedPipeline,
      activeMRR,
    },
    leadCounts: {
      total: data.leads.filter((l) => l.status !== 'archived' && l.status !== 'converted').length,
      hot: hotLeads.length,
    },
    dueTasks,
  }
}

// Local re-export of scoreLead so consumers don't need to import leadScoring directly
function scoreLeadCompat(lead: Lead) {
  return scoreLead(lead, new Date())
}

// ============================================================
// AI Lead generation — suggest target accounts
// ============================================================

export interface SuggestedTarget {
  companyName: string
  state: string
  size: string
  licenseType: string
  targetRoles: string[]
  whyFit: string
  confidence: number
  linkedinHint: string
}

export interface SuggestTargetsResult {
  targets: SuggestedTarget[]
  researchSteps: string[]
  model: string
}

export async function suggestTargets(
  data: SheetData,
  options: { criteria?: string; count?: number } = {},
): Promise<SuggestTargetsResult> {
  // Build a compact summary of existing customers (Closed Won)
  const wonDeals = data.deals.filter((d) => d.stage === 'Closed Won')
  const existingCustomers = wonDeals.map((d) => {
    const co = d.companyId ? data.companies.find((x) => x.id === d.companyId) : null
    return {
      companyName: co?.name || d.title,
      industry: co?.industry || '',
      size: co?.size || '',
      licenseCount: co?.licenseCount || '',
      mrr: d.mrr,
    }
  }).slice(0, 20)

  return call<SuggestTargetsResult>('aiSuggestTargets', {
    existingCustomers,
    criteria: options.criteria || '',
    count: options.count || 10,
  })
}

/** Build the active booking-link list with REAL public URLs so Claude can
 *  drop them verbatim into drafted emails instead of inventing Calendly URLs. */
function buildBookingLinksContext(data: SheetData): Array<Record<string, unknown>> {
  // The public URL pattern matches what BookingLinks.tsx generates:
  //   {origin}{BASE_URL}book/{slug}
  // For the deployed site that's https://mattc1987.github.io/hashio-crm/book/{slug}.
  // For local dev that's http://localhost:5174/book/{slug}.
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://mattc1987.github.io'
  const baseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'
  return data.bookingLinks
    .filter((l) => l.status === 'active')
    .map((l) => ({
      slug: l.slug,
      name: l.name,
      durationMinutes: l.durationMinutes,
      description: l.description,
      url: `${origin}${baseUrl}book/${l.slug}`,
    }))
}
