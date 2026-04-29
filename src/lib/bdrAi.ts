// LLM helpers for the BDR — calls the Apps Script proxy which holds the
// Anthropic API key server-side. The browser never sees the key.
//
// Two operations:
//   draftMessage(proposal, data) → { subject?, body }
//   narrativeReason(proposal, data) → { narrative }

import type { Proposal, SheetData } from './types'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

async function call<T>(action: string, params: Record<string, unknown>): Promise<T> {
  if (!APPS_SCRIPT_URL) throw new Error('Backend not configured')
  const url = new URL(APPS_SCRIPT_URL)
  url.searchParams.set('action', action)
  url.searchParams.set('key', APPS_SCRIPT_KEY)
  url.searchParams.set('payload', JSON.stringify(params))
  const res = await fetch(url.toString(), { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'Failed')
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
