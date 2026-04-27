import { format, formatDistanceToNow, parseISO, isValid } from 'date-fns'
import type { Deal } from './types'

export function currency(n: number | string | undefined | null, opts: { compact?: boolean } = {}): string {
  const num = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  if (!Number.isFinite(num)) return '—'
  if (opts.compact && Math.abs(num) >= 1000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(num)
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: num % 1 === 0 ? 0 : 2,
  }).format(num)
}

export function num(n: number | string | undefined | null): string {
  const x = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  if (!Number.isFinite(x)) return '0'
  return new Intl.NumberFormat('en-US').format(x)
}

export function date(s: string | undefined | null, fmt = 'MMM d, yyyy'): string {
  if (!s) return '—'
  const d = tryParse(s)
  return d ? format(d, fmt) : s
}

export function relativeDate(s: string | undefined | null): string {
  if (!s) return '—'
  const d = tryParse(s)
  if (!d) return s
  return formatDistanceToNow(d, { addSuffix: true })
}

export function tryParse(s: string): Date | null {
  if (!s) return null
  try {
    const d = parseISO(s)
    if (isValid(d)) return d
  } catch {/* ignore */}
  const d2 = new Date(s)
  return isValid(d2) ? d2 : null
}

export function initials(first?: string, last?: string, fallback?: string): string {
  const f = (first || '').trim()[0] || ''
  const l = (last || '').trim()[0] || ''
  const combined = (f + l).toUpperCase()
  if (combined) return combined
  if (fallback) {
    const parts = fallback.trim().split(/\s+/)
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '')
  }
  return '?'
}

// Period helpers (ExecUpdates / Cashflow use "YYYY_MM")
export function parsePeriod(p: string): Date | null {
  if (!p) return null
  const m = p.match(/^(\d{4})[_-](\d{1,2})$/)
  if (!m) return tryParse(p)
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, 1)
}

export function formatPeriod(p: string, fmt = 'MMMM yyyy'): string {
  const d = parsePeriod(p)
  return d ? format(d, fmt) : p
}

// ---------- MRR math ----------

// Monthly run-rate MRR for a deal.
// In the current Sheet schema, the `mrr` column is stored as the monthly rate
// regardless of billing cadence. `billingCycle` only describes how often
// invoices are generated (monthly / quarterly / annual), not the unit of mrr.
// We verified this against real deals: BeLeaf value=$48,600 (annual) and
// mrr=$4,050 — which matches 48600/12, confirming mrr is already monthly.
export function monthlyMRR(d: Deal): number {
  const m = Number(d.mrr) || 0
  return Number.isFinite(m) ? m : 0
}

// Human label for the billing cadence (for inline display next to MRR).
export function billingCycleLabel(cycle: Deal['billingCycle']): string {
  switch (cycle) {
    case 'monthly':   return 'billed monthly'
    case 'quarterly': return 'billed quarterly'
    case 'annual':    return 'billed annually'
    default:          return ''
  }
}

// Is this deal actively generating MRR right now?
export function isActiveMRR(d: Deal): boolean {
  const stage = (d.stage || '').toLowerCase()
  const mrrStatus = (d.mrrStatus || '').toLowerCase()
  if (stage !== 'closed won') return false
  if (mrrStatus && mrrStatus !== 'active') return false
  return monthlyMRR(d) > 0
}

export function totalActiveMRR(deals: Deal[]): number {
  return deals.filter(isActiveMRR).reduce((sum, d) => sum + monthlyMRR(d), 0)
}

export function activeMRRByCompany(deals: Deal[], companyId: string): number {
  return deals
    .filter((d) => d.companyId === companyId && isActiveMRR(d))
    .reduce((sum, d) => sum + monthlyMRR(d), 0)
}
