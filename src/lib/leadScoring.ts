// Lead temperature + score from engagement signals.
//
// The scoring is intentionally simple and explainable — not an LLM call.
// Each signal type has a base weight; recency multiplies up; we cap at 100
// and bucket into cold/warm/hot/molten. Easy to tune.

import type { Lead, LeadEngagementSignal, LeadTemperature } from './types'

// Base weights for known signal types. Anything unknown gets weight 5.
const SIGNAL_WEIGHTS: Record<string, number> = {
  // LinkedIn engagement (Teamfluence)
  'company-follow':         15,
  'company-page-visit':     8,
  'post-like':              10,
  'post-comment':           25,
  'post-share':             30,
  'profile-view':           5,
  'connection-accept':      20,
  'inmail-reply':           35,
  'website-visit':          12,
  'pricing-page-visit':     25,
  'demo-page-visit':        20,
  'newsletter-signup':      18,
  'webinar-attend':         28,
  'content-download':       22,
  'event-rsvp':             30,
  'replied-to-cold-email':  40,
}

const DEFAULT_WEIGHT = 5
const DAY = 24 * 60 * 60 * 1000

/** Decay multiplier based on how recent the signal is. */
function recencyMultiplier(ts: string, now: Date): number {
  const ageMs = now.getTime() - new Date(ts).getTime()
  if (!Number.isFinite(ageMs) || ageMs < 0) return 1
  const ageDays = ageMs / DAY
  if (ageDays <= 3)  return 1.5   // Last 3 days — very fresh
  if (ageDays <= 14) return 1.0
  if (ageDays <= 30) return 0.6
  if (ageDays <= 90) return 0.3
  return 0.1                       // Older than 90 days — barely counts
}

export interface ScoreResult {
  score: number          // 0-100
  temperature: LeadTemperature
  reasons: string[]      // Top contributing signals (for tooltip)
  signalCount: number
  lastSignalAt: string
}

/** Parse the JSON-encoded signals string. Robust against malformed input. */
export function parseSignals(json: string): LeadEngagementSignal[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as LeadEngagementSignal[]
    return []
  } catch {
    return []
  }
}

export function scoreLead(lead: Lead, now: Date = new Date()): ScoreResult {
  const signals = parseSignals(lead.engagementSignals)
  let total = 0
  const contributions: Array<{ signal: LeadEngagementSignal; pts: number }> = []

  for (const sig of signals) {
    const base = SIGNAL_WEIGHTS[sig.kind] ?? DEFAULT_WEIGHT
    const weight = (sig.weight ?? 1) * base
    const recency = recencyMultiplier(sig.ts, now)
    const pts = weight * recency
    total += pts
    contributions.push({ signal: sig, pts })
  }

  // Cap at 100, then bucket
  const score = Math.min(100, Math.round(total))

  let temperature: LeadTemperature
  if (score >= 80)      temperature = 'molten'
  else if (score >= 50) temperature = 'hot'
  else if (score >= 25) temperature = 'warm'
  else                  temperature = 'cold'

  // Top 3 contributing signals
  contributions.sort((a, b) => b.pts - a.pts)
  const reasons = contributions
    .slice(0, 3)
    .map((c) => `${c.signal.kind.replace(/-/g, ' ')} (+${Math.round(c.pts)})`)

  const lastSignalAt = signals
    .map((s) => s.ts)
    .filter(Boolean)
    .sort()
    .pop() || ''

  return {
    score,
    temperature,
    reasons,
    signalCount: signals.length,
    lastSignalAt,
  }
}

export function temperatureColor(t: LeadTemperature): string {
  switch (t) {
    case 'cold':   return '#5b9cf6'
    case 'warm':   return '#f5a524'
    case 'hot':    return '#e07a5b'
    case 'molten': return '#ef4c4c'
  }
}

export function temperatureLabel(t: LeadTemperature): string {
  return { cold: 'Cold', warm: 'Warm', hot: 'Hot', molten: 'Molten' }[t]
}

export function temperatureEmoji(t: LeadTemperature): string {
  return { cold: '🧊', warm: '☕', hot: '🔥', molten: '🌋' }[t]
}
