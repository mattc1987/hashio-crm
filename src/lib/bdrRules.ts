// Agentic BDR — Rules
// =====================
//
// Each rule is a pure function that reads SheetData and returns zero or more
// ProposalDrafts. Rules are intentionally explainable: every draft includes
// a `reason` string that names the data points that fired the rule.
//
// Rules MUST:
//   - Be idempotent: running them twice in a row should produce the same
//     drafts. Dedup is handled centrally in the engine, but rules should
//     supply a stable `dedupeKey` when possible.
//   - Be cheap: O(n) over the input data. No fetches, no LLM calls.
//   - Be safe: never return drafts for opt-out contacts. (Engine double-checks.)
//
// Add new rules here, then register at the bottom. The Briefing page picks
// them up automatically.

import { registerRule, type ProposalDraft, type RuleContext } from './bdrEngine'
import { scoreLead } from './leadScoring'
import type { Contact, Deal, Lead, SheetData } from './types'

const DAY = 24 * 60 * 60 * 1000

// ============================================================
// CATEGORY: OUTREACH (start new conversations)
// ============================================================

/**
 * R-001: Hot lead — enroll in default outbound sequence.
 *
 * Fires when a Lead has temperature ≥ hot AND has not been converted to a
 * Contact yet. Picks the first active "outbound" sequence (or the first
 * active sequence if there's no naming hint).
 */
function ruleHotLeadEnrollment(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const sequence = pickDefaultOutboundSequence(data)
  if (!sequence) return [] // no sequence available — silent skip

  const drafts: ProposalDraft[] = []
  for (const lead of data.leads) {
    if (lead.status === 'archived' || lead.status === 'converted') continue
    if (lead.convertedContactId) continue
    const score = scoreLead(lead, now)
    if (score.temperature !== 'hot' && score.temperature !== 'molten') continue

    // Lead has no Contact id yet — propose creating one + enrolling.
    // For Phase 1 we ask Matt to convert manually, then enroll. To keep
    // things actionable, we propose CREATING a contact + ENROLLING in one shot.
    drafts.push({
      ruleId: 'R-001',
      category: 'outreach',
      priority: score.temperature === 'molten' ? 'critical' : 'high',
      confidence: Math.min(95, 60 + score.score / 4),
      risk: 'sensitive', // enrolling triggers external sends
      title: `Enroll ${lead.firstName} ${lead.lastName} in "${sequence.name}"`,
      reason:
        `Lead is ${score.temperature.toUpperCase()} (score ${score.score}/100). ` +
        `Top signals: ${score.reasons.join(', ') || 'recent engagement'}.`,
      expectedOutcome: `Drip sequence will start within an hour. First touch is the intro email.`,
      actionKind: 'enroll-in-sequence',
      action: {
        sequenceId: sequence.id,
        leadId: lead.id, // executor will create Contact from lead first
        leadSnapshot: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          companyName: lead.companyName,
          title: lead.title || lead.headline,
          linkedinUrl: lead.linkedinUrl,
        },
      },
      dedupeKey: `R-001:lead:${lead.id}`,
    })
  }
  return drafts
}

/**
 * R-002: New-lead-of-the-day — for warm leads, propose a soft LinkedIn
 * connection request as a low-risk first touch (logged as activity).
 */
function ruleNewLeadOfTheDay(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const cutoff = now.getTime() - 1 * DAY
  const drafts: ProposalDraft[] = []
  for (const lead of data.leads) {
    if (lead.status !== 'new') continue
    if (!lead.createdAt) continue
    if (new Date(lead.createdAt).getTime() < cutoff) continue
    if (!lead.linkedinUrl) continue
    const score = scoreLead(lead, now)
    if (score.temperature === 'cold') continue // skip ice-cold

    drafts.push({
      ruleId: 'R-002',
      category: 'outreach',
      priority: 'medium',
      confidence: 75,
      risk: 'safe',
      title: `Send LinkedIn connection request to ${lead.firstName} ${lead.lastName}`,
      reason:
        `New ${score.temperature} lead from ${lead.source || 'webhook'} ` +
        `at ${lead.companyName || 'unknown company'}.`,
      expectedOutcome: `Activity log entry created. You'll send the connection from LinkedIn.`,
      actionKind: 'log-activity',
      action: {
        entityType: 'contact',
        // Lead has no contact yet — executor will create-or-find by email, then attach.
        leadId: lead.id,
        kind: 'linkedin-message',
        outcome: 'completed',
        body: `Send LinkedIn connection request — referenced ${score.reasons[0] || 'their profile'}.`,
        occurredAt: now.toISOString(),
      },
      dedupeKey: `R-002:lead:${lead.id}`,
    })
  }
  return drafts.slice(0, 5) // cap to avoid spam
}

/**
 * R-003: Stale-relationship revival — contacts that haven't been touched in
 * 60+ days and have an open or won deal. Propose a short check-in email.
 */
function ruleStaleRelationshipRevival(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const sixty = now.getTime() - 60 * DAY
  const drafts: ProposalDraft[] = []

  // Build lastTouch lookup per contact
  const lastTouch = lastTouchByContact(data)

  for (const c of data.contacts) {
    const ts = lastTouch.get(c.id)
    if (!ts) continue // never touched — different rule
    if (ts > sixty) continue
    if (!c.email) continue
    // Must have an active deal or recently won deal
    const deal = data.deals.find(
      (d) => d.contactId === c.id && (d.stage === 'Closed Won' || !d.stage.startsWith('Closed')),
    )
    if (!deal) continue

    const days = Math.floor((now.getTime() - ts) / DAY)
    drafts.push({
      ruleId: 'R-003',
      category: 'outreach',
      priority: 'medium',
      confidence: 70,
      risk: 'sensitive',
      title: `Check in with ${c.firstName} ${c.lastName} (${days}d quiet)`,
      reason: `Last touch ${days} days ago. Active deal: "${deal.title}" — ${deal.stage}.`,
      expectedOutcome: 'Sends a 1-paragraph check-in email — pick from "Check-in" template.',
      actionKind: 'send-email',
      action: {
        contactId: c.id,
        dealId: deal.id,
        templateHint: 'check-in',
      },
      contactIds: [c.id],
      dealId: deal.id,
      dedupeKey: `R-003:contact:${c.id}`,
    })
  }
  return drafts
}

/**
 * R-005: Lead → Contact + Deal conversion bundle.
 *
 * Fires when a Lead has temperature ≥ warm AND has an email AND is unconverted.
 * Proposes a single bundled action: convert to Contact + create Deal in Lead
 * stage. Lower priority than direct outreach but ensures every warm lead
 * lands in the pipeline so it doesn't get lost.
 */
function ruleLeadToDealConversion(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const lead of data.leads) {
    if (lead.status === 'archived' || lead.status === 'converted') continue
    if (lead.convertedContactId) continue
    if (!lead.email) continue
    const score = scoreLead(lead, now)
    if (score.temperature !== 'warm' && score.temperature !== 'hot' && score.temperature !== 'molten') continue

    // Skip if a contact with same email already exists (avoid double-convert).
    const existing = data.contacts.find(
      (c) => c.email && c.email.toLowerCase() === lead.email.toLowerCase(),
    )
    if (existing) continue

    drafts.push({
      ruleId: 'R-005',
      category: 'outreach',
      priority: score.temperature === 'molten' ? 'high' : 'medium',
      confidence: 80,
      risk: 'safe', // doesn't send anything externally
      title: `Convert ${lead.firstName} ${lead.lastName} → contact + deal`,
      reason:
        `${score.temperature.toUpperCase()} lead at ${lead.companyName || 'unknown company'} ` +
        `(score ${score.score}). Land them in the pipeline so they don't get lost.`,
      expectedOutcome: 'Creates a Contact + a Deal in Lead stage. Sequence enrollment is a separate proposal (R-001).',
      actionKind: 'update-contact', // we'll handle the bundle in the executor
      action: {
        bundle: 'lead-conversion',
        leadId: lead.id,
        leadSnapshot: {
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: lead.email,
          title: lead.title || lead.headline,
          linkedinUrl: lead.linkedinUrl,
          companyName: lead.companyName,
          location: lead.location,
        },
      },
      dedupeKey: `R-005:lead:${lead.id}`,
    })
  }
  return drafts.slice(0, 5)
}

/**
 * R-004: Customer expansion — closed-won customers without a follow-on
 * upsell deal in pipeline. Propose creating a "renewal/expansion" task.
 */
function ruleCustomerExpansion(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const won of data.deals) {
    if (won.stage !== 'Closed Won') continue
    if (!won.contactId) continue
    // Already has another open deal? Skip.
    const existingOpen = data.deals.find(
      (d) =>
        d.id !== won.id &&
        d.contactId === won.contactId &&
        !d.stage.startsWith('Closed'),
    )
    if (existingOpen) continue
    const c = data.contacts.find((x) => x.id === won.contactId)
    if (!c) continue

    // Only propose if the closed deal is older than 30 days (give time for onboarding).
    if (won.updatedAt && now.getTime() - new Date(won.updatedAt).getTime() < 30 * DAY) continue

    drafts.push({
      ruleId: 'R-004',
      category: 'outreach',
      priority: 'medium',
      confidence: 65,
      risk: 'safe',
      title: `Open expansion conversation with ${c.firstName} ${c.lastName}`,
      reason: `${c.firstName} closed "${won.title}" — no follow-on deal in pipeline. Time to talk expansion.`,
      expectedOutcome: 'Creates a high-priority task to set up an expansion call.',
      actionKind: 'create-task',
      action: {
        title: `Expansion call: ${c.firstName} ${c.lastName} (${won.title})`,
        contactId: c.id,
        priority: 'high',
        notes: `Original deal closed-won; explore upsell to additional sites / modules.`,
        dueDate: addDays(now, 3).toISOString(),
      },
      contactIds: [c.id],
      dedupeKey: `R-004:contact:${c.id}`,
    })
  }
  return drafts
}

// ============================================================
// CATEGORY: FOLLOW-UP (continue existing conversations)
// ============================================================

/**
 * R-101: Email opener follow-up — contact opened a recent email but didn't
 * reply. Propose a 2nd-touch follow-up.
 */
function ruleEmailOpenerFollowUp(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  const cutoffOpen = now.getTime() - 5 * DAY
  const cutoffMin = now.getTime() - 1 * DAY // wait at least a day

  for (const send of data.emailSends) {
    if (!send.openedAt) continue
    if (send.repliedAt) continue
    const openedAt = new Date(send.openedAt).getTime()
    if (openedAt < cutoffOpen) continue
    if (openedAt > cutoffMin) continue
    if (!send.contactId) continue
    const c = data.contacts.find((x) => x.id === send.contactId)
    if (!c) continue

    drafts.push({
      ruleId: 'R-101',
      category: 'follow-up',
      priority: 'high',
      confidence: 80,
      risk: 'sensitive',
      title: `Follow up with ${c.firstName} ${c.lastName} — opened your email`,
      reason: `Opened "${send.subject}" but didn't reply. Opens without replies often need a nudge.`,
      expectedOutcome: 'Sends a short bump reply on the same thread.',
      actionKind: 'send-email',
      action: {
        contactId: c.id,
        replyToSendId: send.id,
        threadId: send.threadId,
        templateHint: 'soft-bump',
      },
      contactIds: [c.id],
      dedupeKey: `R-101:send:${send.id}`,
    })
  }
  return drafts
}

/**
 * R-102: Click follow-up — contact clicked a tracked link. Propose a more
 * pointed follow-up that references what they clicked.
 */
function ruleClickFollowUp(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  const cutoff = now.getTime() - 7 * DAY

  for (const send of data.emailSends) {
    if (!send.clickedAt) continue
    if (send.repliedAt) continue
    const clickedAt = new Date(send.clickedAt).getTime()
    if (clickedAt < cutoff) continue
    if (!send.contactId) continue
    const c = data.contacts.find((x) => x.id === send.contactId)
    if (!c) continue

    drafts.push({
      ruleId: 'R-102',
      category: 'follow-up',
      priority: 'high',
      confidence: 88,
      risk: 'sensitive',
      title: `Reach out to ${c.firstName} ${c.lastName} — clicked your link`,
      reason:
        `Clicked a link in "${send.subject}" — strong intent signal. ` +
        `Clicks indicate active research, ideal time to engage.`,
      expectedOutcome: 'Sends a personalized message referencing the resource they clicked.',
      actionKind: 'send-email',
      action: {
        contactId: c.id,
        replyToSendId: send.id,
        threadId: send.threadId,
        templateHint: 'click-followup',
      },
      contactIds: [c.id],
      dedupeKey: `R-102:send:${send.id}`,
    })
  }
  return drafts
}

/**
 * R-103: Reply needs response — emails replied but no outbound activity in
 * 24h+ from us. Critical — these are the highest-intent signals.
 */
function ruleReplyNeedsResponse(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  const cutoffMs = 24 * 60 * 60 * 1000

  // Build lastTouch lookup so we know when WE last reached out
  const lastTouch = lastTouchByContact(data)

  for (const send of data.emailSends) {
    if (!send.repliedAt) continue
    const repliedAt = new Date(send.repliedAt).getTime()
    if (now.getTime() - repliedAt < cutoffMs) continue // less than 24h, not yet stale
    if (now.getTime() - repliedAt > 7 * DAY) continue // too old to chase

    if (!send.contactId) continue
    const c = data.contacts.find((x) => x.id === send.contactId)
    if (!c) continue

    // Have WE responded since they replied? Compare last touch to repliedAt.
    const ourLast = lastTouch.get(c.id)
    if (ourLast && ourLast > repliedAt) continue // already handled

    const hours = Math.floor((now.getTime() - repliedAt) / (60 * 60 * 1000))
    drafts.push({
      ruleId: 'R-103',
      category: 'follow-up',
      priority: 'critical',
      confidence: 95,
      risk: 'safe', // creating a task is safe; the actual reply is human
      title: `${c.firstName} ${c.lastName} replied ${hours}h ago — respond`,
      reason: `Replied to "${send.subject}" but you haven't responded. Replies are the hottest signal in the pipeline.`,
      expectedOutcome: 'Creates a critical task on your queue. You write the personal reply.',
      actionKind: 'create-task',
      action: {
        title: `Reply to ${c.firstName} ${c.lastName}: "${send.subject}"`,
        contactId: c.id,
        priority: 'high',
        notes: `Reply preview: "${(send.bodyPreview || '').slice(0, 200)}"`,
        dueDate: now.toISOString(),
      },
      contactIds: [c.id],
      dedupeKey: `R-103:send:${send.id}`,
    })
  }
  return drafts
}

/**
 * R-104: Demo no-show recovery — booking exists but no activity log around
 * the slot time. Propose a "you missed me, here's a new link" follow-up.
 */
function ruleDemoNoShowRecovery(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  const cutoffMs = 4 * 60 * 60 * 1000 // booking ended at least 4h ago

  for (const b of data.bookings) {
    if (b.status !== 'confirmed') continue
    if (!b.slotEnd) continue
    const slotEnd = new Date(b.slotEnd).getTime()
    if (now.getTime() - slotEnd < cutoffMs) continue
    if (now.getTime() - slotEnd > 3 * DAY) continue // too old

    // Did Matt log a meeting around this slot? If yes, the meeting happened.
    const hadMeeting = data.activityLogs.some((log) => {
      if (log.kind !== 'meeting' && log.kind !== 'call-outbound' && log.kind !== 'call-inbound') return false
      if (!log.occurredAt) return false
      const t = new Date(log.occurredAt).getTime()
      const slotStart = new Date(b.slotStart).getTime()
      return Math.abs(t - slotStart) < 4 * 60 * 60 * 1000
    })
    if (hadMeeting) continue

    // Find the contact (by email)
    const contact = data.contacts.find((c) => c.email && c.email.toLowerCase() === (b.attendeeEmail || '').toLowerCase())

    drafts.push({
      ruleId: 'R-104',
      category: 'follow-up',
      priority: 'high',
      confidence: 70,
      risk: 'sensitive',
      title: `No-show recovery: ${b.attendeeName || b.attendeeEmail}`,
      reason: `Confirmed booking ${formatRel(slotEnd, now)}, no meeting logged. Likely no-show.`,
      expectedOutcome: 'Sends a friendly "missed you, here\'s a new time" email.',
      actionKind: 'send-email',
      action: {
        contactEmail: b.attendeeEmail,
        contactId: contact?.id,
        bookingId: b.id,
        templateHint: 'no-show-recovery',
      },
      contactIds: contact ? [contact.id] : [],
      dedupeKey: `R-104:booking:${b.id}`,
    })
  }
  return drafts
}

// ============================================================
// CATEGORY: DEAL (pipeline updates / nudges)
// ============================================================

/**
 * R-201: Stale deal nudge — open high-value deal with 14d+ no activity.
 * Propose creating a follow-up task on the deal.
 */
function ruleStaleDealNudge(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  const cutoff = 14 * DAY

  for (const d of data.deals) {
    if (d.stage.startsWith('Closed')) continue
    if (d.value < 5000) continue
    const lastTs = lastActivityForDeal(d, data)
    if (lastTs && now.getTime() - lastTs < cutoff) continue
    const c = data.contacts.find((x) => x.id === d.contactId)
    const days = lastTs ? Math.floor((now.getTime() - lastTs) / DAY) : null

    drafts.push({
      ruleId: 'R-201',
      category: 'deal',
      priority: d.value >= 25000 ? 'high' : 'medium',
      confidence: 75,
      risk: 'safe',
      title: `Move deal "${d.title}" forward`,
      reason: days !== null
        ? `${formatCurrencyShort(d.value)} deal in ${d.stage}, ${days}d quiet.`
        : `${formatCurrencyShort(d.value)} deal in ${d.stage}, no activity recorded.`,
      expectedOutcome: 'Creates a follow-up task on the deal.',
      actionKind: 'create-task',
      action: {
        title: `Follow up: ${d.title}`,
        contactId: d.contactId,
        dealId: d.id,
        priority: d.value >= 25000 ? 'high' : 'medium',
        notes: `Stage: ${d.stage}. Value: ${formatCurrencyShort(d.value)}.${c ? ` Contact: ${c.firstName} ${c.lastName}.` : ''}`,
        dueDate: addDays(now, 1).toISOString(),
      },
      dealId: d.id,
      contactIds: c ? [c.id] : [],
      dedupeKey: `R-201:deal:${d.id}`,
    })
  }
  return drafts
}

/**
 * R-202: Deal stage advance — Demo stage with confirmed booking in the past
 * → propose advancing to Proposal.
 */
function ruleDealStageAdvance(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []

  for (const d of data.deals) {
    if (d.stage !== 'Demo') continue
    if (!d.contactId) continue
    const c = data.contacts.find((x) => x.id === d.contactId)
    if (!c) continue

    // Find a completed booking + meeting log for this contact
    const recentMeeting = data.activityLogs.find(
      (log) =>
        log.kind === 'meeting' &&
        log.entityType === 'contact' &&
        log.entityId === c.id &&
        log.occurredAt &&
        now.getTime() - new Date(log.occurredAt).getTime() < 7 * DAY,
    )
    if (!recentMeeting) continue

    drafts.push({
      ruleId: 'R-202',
      category: 'deal',
      priority: 'high',
      confidence: 82,
      risk: 'safe',
      title: `Advance "${d.title}" to Proposal stage`,
      reason: `Demo meeting was logged with ${c.firstName}. Time to send the proposal.`,
      expectedOutcome: 'Updates deal stage from Demo → Proposal.',
      actionKind: 'update-deal',
      action: {
        dealId: d.id,
        patch: { stage: 'Proposal' },
      },
      dealId: d.id,
      contactIds: [c.id],
      dedupeKey: `R-202:deal:${d.id}`,
    })
  }
  return drafts
}

/**
 * R-203: At-risk deal — close date in past, still open. Either re-date or close-lost.
 */
function ruleAtRiskDeal(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const d of data.deals) {
    if (d.stage.startsWith('Closed')) continue
    if (!d.closeDate) continue
    const closeT = new Date(d.closeDate).getTime()
    if (closeT > now.getTime()) continue
    const daysOver = Math.floor((now.getTime() - closeT) / DAY)
    if (daysOver < 7) continue // give a week of grace

    drafts.push({
      ruleId: 'R-203',
      category: 'deal',
      priority: d.value >= 10000 ? 'high' : 'medium',
      confidence: 90,
      risk: 'safe',
      title: `Re-date or close: "${d.title}" (${daysOver}d past close date)`,
      reason: `Close date was ${d.closeDate.slice(0, 10)} — ${daysOver}d ago. Stage: ${d.stage}. Pipeline hygiene needs this resolved.`,
      expectedOutcome: 'Creates a hygiene task to either push the close date or mark Closed Lost.',
      actionKind: 'create-task',
      action: {
        title: `Re-date or close-lost: ${d.title}`,
        dealId: d.id,
        priority: 'high',
        notes: `Close date passed ${daysOver}d ago. Decide: push out OR mark closed-lost.`,
        dueDate: addDays(now, 1).toISOString(),
      },
      dealId: d.id,
      contactIds: d.contactId ? [d.contactId] : [],
      dedupeKey: `R-203:deal:${d.id}`,
    })
  }
  return drafts
}

/**
 * R-204: Renewal coming up — closed-won deal with contractEnd in next 60d.
 */
function ruleRenewalUpcoming(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const d of data.deals) {
    if (d.stage !== 'Closed Won') continue
    if (!d.contractEnd) continue
    const endT = new Date(d.contractEnd).getTime()
    const daysOut = Math.floor((endT - now.getTime()) / DAY)
    if (daysOut < 0 || daysOut > 60) continue
    const c = data.contacts.find((x) => x.id === d.contactId)

    drafts.push({
      ruleId: 'R-204',
      category: 'deal',
      priority: daysOut <= 30 ? 'high' : 'medium',
      confidence: 92,
      risk: 'safe',
      title: `Renewal in ${daysOut}d: ${c ? `${c.firstName} ${c.lastName}` : d.title}`,
      reason: `Contract ends ${d.contractEnd.slice(0, 10)}. ${formatCurrencyShort(d.mrr * 12 || d.value)} ARR at risk.`,
      expectedOutcome: 'Creates a renewal task and starts the renewal conversation.',
      actionKind: 'create-task',
      action: {
        title: `Renewal call: ${d.title}`,
        dealId: d.id,
        contactId: d.contactId,
        priority: daysOut <= 30 ? 'high' : 'medium',
        notes: `Contract ends ${d.contractEnd.slice(0, 10)}. Confirm renewal terms + check for expansion.`,
        dueDate: addDays(now, daysOut <= 30 ? 1 : 7).toISOString(),
      },
      dealId: d.id,
      contactIds: c ? [c.id] : [],
      dedupeKey: `R-204:deal:${d.id}`,
    })
  }
  return drafts
}

// ============================================================
// CATEGORY: HYGIENE (data quality)
// ============================================================

/**
 * R-301: Missing email — high-temp lead without an email address.
 */
function ruleHygieneMissingEmail(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const lead of data.leads) {
    if (lead.email) continue
    if (!lead.linkedinUrl && !lead.companyName) continue
    const score = scoreLead(lead, now)
    if (score.score < 30) continue
    drafts.push({
      ruleId: 'R-301',
      category: 'hygiene',
      priority: 'low',
      confidence: 85,
      risk: 'safe',
      title: `Find email for ${lead.firstName} ${lead.lastName}`,
      reason: `Engaged lead (score ${score.score}/100) at ${lead.companyName || 'unknown company'} but no email on file.`,
      expectedOutcome: 'Creates a task to enrich via Hunter / Apollo / LinkedIn.',
      actionKind: 'create-task',
      action: {
        title: `Find email: ${lead.firstName} ${lead.lastName} (${lead.companyName})`,
        priority: 'low',
        notes: `LinkedIn: ${lead.linkedinUrl || '(none)'}. Company: ${lead.companyName || '(none)'}. Score: ${score.score}.`,
        dueDate: addDays(now, 3).toISOString(),
      },
      dedupeKey: `R-301:lead:${lead.id}`,
    })
  }
  return drafts.slice(0, 5)
}

/**
 * R-302: Possible duplicate contact — same email or same name+company.
 */
function ruleHygieneDuplicateContact(ctx: RuleContext): ProposalDraft[] {
  const { data } = ctx
  const drafts: ProposalDraft[] = []
  const byEmail = new Map<string, Contact[]>()
  for (const c of data.contacts) {
    const key = (c.email || '').trim().toLowerCase()
    if (!key) continue
    if (!byEmail.has(key)) byEmail.set(key, [])
    byEmail.get(key)!.push(c)
  }
  for (const [email, group] of byEmail.entries()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
    const keep = sorted[0]
    for (const dup of sorted.slice(1)) {
      drafts.push({
        ruleId: 'R-302',
        category: 'hygiene',
        priority: 'low',
        confidence: 90,
        risk: 'safe',
        title: `Possible duplicate: ${dup.firstName} ${dup.lastName} (${email})`,
        reason: `Two contacts share email "${email}". Older record id ${keep.id} created ${keep.createdAt?.slice(0, 10) || 'unknown'}.`,
        expectedOutcome: 'Logs a hygiene task to manually merge or archive the duplicate.',
        actionKind: 'create-task',
        action: {
          title: `Merge duplicate contacts: ${email}`,
          priority: 'low',
          notes: `Records: ${keep.id} (keep) + ${dup.id} (dup).`,
        },
        contactIds: [keep.id, dup.id],
        dedupeKey: `R-302:dup:${keep.id}:${dup.id}`,
      })
    }
  }
  return drafts.slice(0, 5)
}

// ============================================================
// CATEGORY: MEETING (pre/post meeting actions)
// ============================================================

/**
 * R-401: Pre-meeting prep — booking in next 4h, no prep notes.
 */
function rulePreMeetingPrep(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const b of data.bookings) {
    if (b.status !== 'confirmed') continue
    const start = new Date(b.slotStart).getTime()
    const minsOut = (start - now.getTime()) / (60 * 1000)
    if (minsOut < 30 || minsOut > 240) continue
    // Find associated contact
    const c = data.contacts.find((x) => x.email && x.email.toLowerCase() === (b.attendeeEmail || '').toLowerCase())

    drafts.push({
      ruleId: 'R-401',
      category: 'meeting',
      priority: 'high',
      confidence: 100,
      risk: 'safe',
      title: `Prep for ${b.attendeeName || b.attendeeEmail} in ${Math.round(minsOut)} min`,
      reason: `Confirmed booking at ${formatTime(b.slotStart)}. Notes: "${b.attendeeNotes || '(none)'}".`,
      expectedOutcome: 'Creates a prep checklist task.',
      actionKind: 'create-task',
      action: {
        title: `Prep call: ${b.attendeeName || b.attendeeEmail}`,
        priority: 'high',
        notes: `At ${formatTime(b.slotStart)}. Their notes: ${b.attendeeNotes || '(none)'}.`,
        dueDate: new Date(start - 15 * 60 * 1000).toISOString(),
        contactId: c?.id,
      },
      contactIds: c ? [c.id] : [],
      dedupeKey: `R-401:booking:${b.id}`,
    })
  }
  return drafts
}

/**
 * R-402: Post-meeting note — meeting logged 1+ days ago without a note attached.
 */
function rulePostMeetingNote(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const drafts: ProposalDraft[] = []
  for (const log of data.activityLogs) {
    if (log.kind !== 'meeting') continue
    if (!log.occurredAt) continue
    const ageMs = now.getTime() - new Date(log.occurredAt).getTime()
    if (ageMs < 1 * DAY || ageMs > 3 * DAY) continue
    if (log.body && log.body.length > 50) continue // already has notes

    drafts.push({
      ruleId: 'R-402',
      category: 'meeting',
      priority: 'medium',
      confidence: 70,
      risk: 'safe',
      title: `Add post-meeting notes (${log.entityType} ${log.entityId})`,
      reason: `Meeting logged ${Math.floor(ageMs / DAY)}d ago without detailed notes.`,
      expectedOutcome: 'Creates a task to backfill the meeting notes.',
      actionKind: 'create-task',
      action: {
        title: `Add notes for meeting on ${log.occurredAt.slice(0, 10)}`,
        priority: 'medium',
        notes: `Activity log id ${log.id}.`,
      },
      dedupeKey: `R-402:log:${log.id}`,
    })
  }
  return drafts.slice(0, 3)
}

// ============================================================
// CATEGORY: REPORT (informational summaries)
// ============================================================

/**
 * R-501: Daily pipeline summary — informational, low priority. Surfaces totals.
 */
function ruleDailyPipelineSummary(ctx: RuleContext): ProposalDraft[] {
  const { data, now } = ctx
  const open = data.deals.filter((d) => !d.stage.startsWith('Closed'))
  const totalOpen = open.reduce((s, d) => s + (d.value || 0), 0)
  const weightedOpen = open.reduce((s, d) => s + (d.value || 0) * ((d.probability || 0) / 100), 0)
  if (open.length === 0) return []

  return [{
    ruleId: 'R-501',
    category: 'report',
    priority: 'low',
    confidence: 100,
    risk: 'safe',
    title: `Pipeline today: ${open.length} open deals · ${formatCurrencyShort(totalOpen)} total · ${formatCurrencyShort(weightedOpen)} weighted`,
    reason: 'Daily pipeline snapshot.',
    expectedOutcome: 'Logs a daily snapshot note (no external action).',
    actionKind: 'create-note',
    action: {
      entityType: 'deal',
      body: `Pipeline ${now.toISOString().slice(0, 10)}: ${open.length} open · ${formatCurrencyShort(totalOpen)} total · ${formatCurrencyShort(weightedOpen)} weighted.`,
    },
    dedupeKey: `R-501:${now.toISOString().slice(0, 10)}`,
  }]
}

// ============================================================
// REGISTER
// ============================================================

registerRule({ id: 'R-001', description: 'Hot lead → enroll in default sequence', category: 'outreach', fn: ruleHotLeadEnrollment })
registerRule({ id: 'R-002', description: 'New-lead-of-the-day → LinkedIn connect', category: 'outreach', fn: ruleNewLeadOfTheDay })
registerRule({ id: 'R-003', description: 'Stale relationship revival', category: 'outreach', fn: ruleStaleRelationshipRevival })
registerRule({ id: 'R-004', description: 'Customer expansion task', category: 'outreach', fn: ruleCustomerExpansion })
registerRule({ id: 'R-005', description: 'Lead → contact + deal conversion bundle', category: 'outreach', fn: ruleLeadToDealConversion })

registerRule({ id: 'R-101', description: 'Email opener follow-up', category: 'follow-up', fn: ruleEmailOpenerFollowUp })
registerRule({ id: 'R-102', description: 'Click follow-up', category: 'follow-up', fn: ruleClickFollowUp })
registerRule({ id: 'R-103', description: 'Reply needs response', category: 'follow-up', fn: ruleReplyNeedsResponse })
registerRule({ id: 'R-104', description: 'Demo no-show recovery', category: 'follow-up', fn: ruleDemoNoShowRecovery })

registerRule({ id: 'R-201', description: 'Stale deal nudge', category: 'deal', fn: ruleStaleDealNudge })
registerRule({ id: 'R-202', description: 'Deal stage advance', category: 'deal', fn: ruleDealStageAdvance })
registerRule({ id: 'R-203', description: 'At-risk deal (past close date)', category: 'deal', fn: ruleAtRiskDeal })
registerRule({ id: 'R-204', description: 'Renewal upcoming', category: 'deal', fn: ruleRenewalUpcoming })

registerRule({ id: 'R-301', description: 'Missing email enrichment', category: 'hygiene', fn: ruleHygieneMissingEmail })
registerRule({ id: 'R-302', description: 'Possible duplicate contact', category: 'hygiene', fn: ruleHygieneDuplicateContact })

registerRule({ id: 'R-401', description: 'Pre-meeting prep', category: 'meeting', fn: rulePreMeetingPrep })
registerRule({ id: 'R-402', description: 'Post-meeting note backfill', category: 'meeting', fn: rulePostMeetingNote })

registerRule({ id: 'R-501', description: 'Daily pipeline summary', category: 'report', fn: ruleDailyPipelineSummary })

// ============================================================
// HELPERS
// ============================================================

function pickDefaultOutboundSequence(data: SheetData) {
  const active = data.sequences.filter((s) => s.status === 'active')
  if (active.length === 0) return null
  // Prefer one whose name contains "outbound", "outreach", "intro", "cold"
  const hint = active.find((s) =>
    /outbound|outreach|intro|cold/i.test(s.name),
  )
  return hint || active[0]
}

function lastTouchByContact(data: SheetData): Map<string, number> {
  const m = new Map<string, number>()
  const upd = (id: string, ts: string) => {
    if (!id || !ts) return
    const t = new Date(ts).getTime()
    if (!Number.isFinite(t)) return
    const cur = m.get(id) || 0
    if (t > cur) m.set(id, t)
  }
  for (const e of data.emailSends) upd(e.contactId, e.sentAt)
  for (const s of data.smsSends) upd(s.contactId, s.sentAt)
  for (const log of data.activityLogs) {
    if (log.entityType === 'contact') upd(log.entityId, log.occurredAt || log.createdAt)
  }
  return m
}

function lastActivityForDeal(deal: Deal, data: SheetData): number | null {
  const ts: number[] = []
  data.emailSends.forEach((es) => {
    if (es.contactId === deal.contactId && es.sentAt) ts.push(new Date(es.sentAt).getTime())
  })
  data.activityLogs.forEach((log) => {
    const matches =
      (log.entityType === 'deal' && log.entityId === deal.id) ||
      (log.entityType === 'contact' && log.entityId === deal.contactId)
    if (matches && log.occurredAt) ts.push(new Date(log.occurredAt).getTime())
  })
  data.tasks.forEach((t) => {
    if (t.dealId === deal.id && t.updatedAt) ts.push(new Date(t.updatedAt).getTime())
  })
  data.notes.forEach((n) => {
    if (n.entityType === 'deal' && n.entityId === deal.id && n.createdAt) {
      ts.push(new Date(n.createdAt).getTime())
    }
  })
  if (ts.length === 0) return null
  return Math.max(...ts)
}

function addDays(now: Date, n: number): Date {
  return new Date(now.getTime() + n * DAY)
}

function formatRel(t: number, now: Date): string {
  const diff = Math.abs(now.getTime() - t)
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} min ago`
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / DAY)}d ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatCurrencyShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`
  return `$${(n || 0).toLocaleString()}`
}

// Re-export Lead unused to keep TypeScript happy if tree-shaken.
export type { Lead as _Lead }
