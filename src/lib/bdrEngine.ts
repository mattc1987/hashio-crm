// Agentic BDR Engine
// ===================
//
// Orchestrates a registry of pure rule functions. Each rule reads the full
// SheetData and returns zero or more `ProposalDraft`s. The engine then:
//   1. Applies SAFETY RAILS (DNC, frequency caps, daily cap, dedupe)
//   2. Ranks the surviving proposals (priority, confidence, risk)
//   3. Returns a stable ordered list ready for the Briefing UI.
//
// The engine is intentionally LLM-free in Phase 1 — every "reason" is
// generated from data. When we add a model later, we just register one more
// rule that calls Claude/Gemini and returns ProposalDrafts in the same shape.
//
// SAFETY: The engine NEVER auto-executes. Approval happens in the UI; the
// execution layer (lib/bdrExecutor.ts) runs only after Matt clicks "Approve".

import type {
  ProposalActionKind,
  ProposalCategory,
  ProposalRisk,
  ProposalStatus,
  SheetData,
} from './types'

// ---------- Draft (in-memory rule output, before persistence) ----------

export interface ProposalDraft {
  ruleId: string
  category: ProposalCategory
  priority: 'critical' | 'high' | 'medium' | 'low'
  confidence: number // 0–100
  risk: ProposalRisk
  title: string
  reason: string
  expectedOutcome: string
  actionKind: ProposalActionKind
  /** Action-specific structured payload — engine will JSON.stringify on persist. */
  action: Record<string, unknown>
  /** Subjects — for dedupe + safety rails. */
  contactIds?: string[]
  dealId?: string
  companyId?: string
  /** Optional dedupe key — if two rules return drafts with the same dedupeKey, only the highest-confidence wins. */
  dedupeKey?: string
}

export interface RuleContext {
  data: SheetData
  now: Date
  /** Existing proposals — used to avoid re-proposing the same thing. */
  existingProposals: ExistingProposalLite[]
}

export interface ExistingProposalLite {
  id: string
  ruleId: string
  status: ProposalStatus
  createdAt: string
  contactIds: string
  dealId: string
  companyId: string
  actionKind: ProposalActionKind
  dedupeKey?: string
}

export type RuleFn = (ctx: RuleContext) => ProposalDraft[]

export interface RegisteredRule {
  id: string
  description: string
  category: ProposalCategory
  fn: RuleFn
}

// ---------- Rule registry ----------
// Rules register themselves below (see bdrRules.ts which imports + adds).

const REGISTRY: RegisteredRule[] = []

export function registerRule(rule: RegisteredRule): void {
  if (REGISTRY.find((r) => r.id === rule.id)) {
    // Hot-reload safety: replace existing.
    const idx = REGISTRY.findIndex((r) => r.id === rule.id)
    REGISTRY[idx] = rule
    return
  }
  REGISTRY.push(rule)
}

export function listRules(): RegisteredRule[] {
  return [...REGISTRY]
}

// ---------- Safety rails (HARD-CODED) ----------

/** Max 1 outreach proposal per contact in this window. */
const OUTREACH_FREQUENCY_DAYS = 5
/** Max proposals surfaced per run. */
const DAILY_PROPOSAL_CAP = 50
/** Statuses that mean "this contact opted out". */
const OPT_OUT_CONTACT_STATUSES = new Set(['Unsubscribed', 'unsubscribed', 'DNC', 'dnc', 'Opted Out'])

const DAY = 24 * 60 * 60 * 1000

function isOutreachActionKind(k: ProposalActionKind): boolean {
  return k === 'send-email' || k === 'send-sms' || k === 'enroll-in-sequence'
}

function isSensitiveAction(k: ProposalActionKind): boolean {
  return k === 'send-email' || k === 'send-sms'
}

/**
 * Filters drafts that would violate safety rails. Returns the surviving drafts
 * along with a list of dropped proposals + reasons (for transparency / debug).
 */
export interface SafetyResult {
  surviving: ProposalDraft[]
  dropped: Array<{ draft: ProposalDraft; reason: string }>
}

export function applySafetyRails(
  drafts: ProposalDraft[],
  ctx: RuleContext,
): SafetyResult {
  const dropped: Array<{ draft: ProposalDraft; reason: string }> = []
  const surviving: ProposalDraft[] = []

  // Pre-build per-contact opt-out lookup.
  const optOut = new Set<string>()
  for (const c of ctx.data.contacts) {
    if (OPT_OUT_CONTACT_STATUSES.has((c.status || '').trim())) optOut.add(c.id)
  }
  // Enrollments stopped due to reply or unsubscribe count toward DNC for outreach.
  const stoppedContacts = new Set<string>()
  for (const e of ctx.data.enrollments) {
    if (e.status === 'unsubscribed') stoppedContacts.add(e.contactId)
  }

  // Track per-contact recent outreach (existing proposals with outreach action
  // approved/executed in the last N days OR sent emails / SMS in that window).
  const recentOutreachByContact = new Map<string, number>() // contactId -> count
  const cutoff = ctx.now.getTime() - OUTREACH_FREQUENCY_DAYS * DAY

  for (const send of ctx.data.emailSends) {
    if (!send.sentAt) continue
    if (new Date(send.sentAt).getTime() < cutoff) continue
    bump(recentOutreachByContact, send.contactId)
  }
  for (const sms of ctx.data.smsSends) {
    if (!sms.sentAt) continue
    if (new Date(sms.sentAt).getTime() < cutoff) continue
    bump(recentOutreachByContact, sms.contactId)
  }
  for (const p of ctx.existingProposals) {
    if (!p.createdAt) continue
    if (new Date(p.createdAt).getTime() < cutoff) continue
    if (!isOutreachActionKind(p.actionKind)) continue
    if (p.status !== 'approved' && p.status !== 'executed' && p.status !== 'proposed') continue
    for (const cid of (p.contactIds || '').split(',').map((s) => s.trim()).filter(Boolean)) {
      bump(recentOutreachByContact, cid)
    }
  }

  for (const d of drafts) {
    const cids = d.contactIds || []

    // ---- Hard rule: NEVER touch opt-outs for outreach ----
    if (isOutreachActionKind(d.actionKind)) {
      const blocked = cids.find((c) => optOut.has(c) || stoppedContacts.has(c))
      if (blocked) {
        dropped.push({ draft: d, reason: `Contact ${blocked} is opted-out / DNC` })
        continue
      }
    }

    // ---- Frequency cap: 1 outreach per contact per N days ----
    if (isOutreachActionKind(d.actionKind)) {
      const overcap = cids.find((c) => (recentOutreachByContact.get(c) || 0) >= 1)
      if (overcap) {
        dropped.push({
          draft: d,
          reason: `Contact ${overcap} already received outreach in last ${OUTREACH_FREQUENCY_DAYS} days`,
        })
        continue
      }
    }

    // ---- No double enrollment in same sequence ----
    if (d.actionKind === 'enroll-in-sequence') {
      const seqId = d.action.sequenceId as string | undefined
      if (seqId) {
        const dup = cids.find((c) =>
          ctx.data.enrollments.some(
            (e) =>
              e.contactId === c &&
              e.sequenceId === seqId &&
              (e.status === 'active' || e.status === 'paused'),
          ),
        )
        if (dup) {
          dropped.push({ draft: d, reason: `Contact ${dup} already enrolled in sequence ${seqId}` })
          continue
        }
      }
    }

    // ---- Sensitive actions are tagged but not auto-blocked here.
    // (UI will require explicit approval and won't bulk-approve sensitive items.)
    if (isSensitiveAction(d.actionKind)) {
      d.risk = 'sensitive'
    }

    // ---- Don't re-propose if there's any existing proposal for the same
    // logical thing — INCLUDING skipped / cancelled / executed. If Matt
    // already decided on this once, respect his decision until the data
    // changes enough to break the dedupe key.
    // (Phase 2: time-window unsnooze for stale-deal nudges etc.)
    const dupExisting = ctx.existingProposals.find((p) => {
      if (p.ruleId !== d.ruleId) return false
      if (d.dedupeKey && p.dedupeKey === d.dedupeKey) return true
      // Fallback: same rule + same first contact + same action kind
      const firstC = (cids[0] || '')
      const pFirstC = (p.contactIds || '').split(',')[0] || ''
      if (firstC && firstC === pFirstC && p.actionKind === d.actionKind) return true
      // Same deal + same action kind
      if (d.dealId && p.dealId === d.dealId && p.actionKind === d.actionKind) return true
      return false
    })
    if (dupExisting) {
      dropped.push({ draft: d, reason: `Already proposed (id=${dupExisting.id}, status=${dupExisting.status})` })
      continue
    }

    // Bump count so the next draft for the same contact in this run is also capped.
    if (isOutreachActionKind(d.actionKind)) {
      for (const c of cids) bump(recentOutreachByContact, c)
    }

    surviving.push(d)
  }

  return { surviving, dropped }
}

// ---------- Ranking ----------

const PRIORITY_WEIGHT: Record<ProposalDraft['priority'], number> = {
  critical: 1000,
  high: 100,
  medium: 10,
  low: 1,
}

const RISK_PENALTY: Record<ProposalRisk, number> = {
  safe: 0,
  moderate: 5,
  sensitive: 15,
}

export function rankDrafts(drafts: ProposalDraft[]): ProposalDraft[] {
  return [...drafts].sort((a, b) => {
    const scoreA = PRIORITY_WEIGHT[a.priority] + a.confidence - RISK_PENALTY[a.risk]
    const scoreB = PRIORITY_WEIGHT[b.priority] + b.confidence - RISK_PENALTY[b.risk]
    return scoreB - scoreA
  })
}

// ---------- Run engine ----------

export interface EngineResult {
  proposals: ProposalDraft[]
  dropped: Array<{ draft: ProposalDraft; reason: string }>
  rulesRun: number
  rawDraftCount: number
  cappedAt: number
}

/**
 * Run all registered rules over the SheetData and return ranked proposals.
 *
 * Pure function — does NOT persist anything. Persistence happens in the
 * Briefing page when Matt approves.
 */
export function runEngine(
  data: SheetData,
  options: { now?: Date; existingProposals?: ExistingProposalLite[]; cap?: number } = {},
): EngineResult {
  const now = options.now ?? new Date()
  const existingProposals =
    options.existingProposals ??
    data.proposals.map((p) => ({
      id: p.id,
      ruleId: p.ruleId,
      status: p.status,
      createdAt: p.createdAt,
      contactIds: p.contactIds,
      dealId: p.dealId,
      companyId: p.companyId,
      actionKind: p.actionKind,
    }))

  const ctx: RuleContext = { data, now, existingProposals }
  const allDrafts: ProposalDraft[] = []

  for (const rule of REGISTRY) {
    try {
      const drafts = rule.fn(ctx)
      for (const d of drafts) {
        // Backfill ruleId / category from rule registration if missing.
        d.ruleId = d.ruleId || rule.id
        d.category = d.category || rule.category
        allDrafts.push(d)
      }
    } catch (err) {
      // Rules must NEVER crash the engine — log and continue.
      // eslint-disable-next-line no-console
      console.error(`[bdrEngine] rule ${rule.id} threw:`, err)
    }
  }

  const safety = applySafetyRails(allDrafts, ctx)
  const ranked = rankDrafts(safety.surviving)
  const cap = options.cap ?? DAILY_PROPOSAL_CAP
  const capped = ranked.slice(0, cap)

  return {
    proposals: capped,
    dropped: safety.dropped,
    rulesRun: REGISTRY.length,
    rawDraftCount: allDrafts.length,
    cappedAt: cap,
  }
}

// ---------- Helpers ----------

function bump(m: Map<string, number>, k: string): void {
  if (!k) return
  m.set(k, (m.get(k) || 0) + 1)
}

/** Generate a stable client-side proposal id (will be replaced by Sheet id on persist). */
export function makeProposalId(): string {
  return `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
