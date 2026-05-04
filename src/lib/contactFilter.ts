// Contact filter — robust but simple. A "facet" model: multiple filter
// chips that AND together. Each multi-select facet (tags / states / etc.)
// is OR within itself. Saved views are stored in localStorage.

import type { Contact, Deal, EmailSend, ActivityLog, Company } from './types'
import { isActiveMRR } from './format'

const DAY = 24 * 60 * 60 * 1000

// ============================================================
// State shape
// ============================================================

export type ActivityWindow =
  | 'any'
  | 'never'         // no email/log/touch ever
  | 'last-7d'       // touched in last 7 days
  | 'last-30d'      // touched in last 30 days
  | 'stale-30d'     // not touched in 30+ days
  | 'stale-60d'     // not touched in 60+ days
  | 'stale-90d'     // not touched in 90+ days

export type Tristate = boolean | null  // null = don't filter; true/false = required

export interface ContactFilterState {
  query: string
  tags: string[]
  states: string[]
  statuses: string[]
  roles: string[]
  /** Title substring filter — OR within the array. Each entry is a
   *  case-insensitive substring; a contact matches if ANY entry is
   *  contained in their title. Examples: ["VP", "Director", "Head of"]. */
  titlesContain: string[]
  companyIds: string[]
  /** Filter contacts by their company's vertical. OR semantics — a contact
   *  matches if their company.vertical is in this list. Empty array = no
   *  filter. Use to build "all contacts at cultivators + vertical operators". */
  companyVerticals: string[]
  hasEmail: Tristate
  hasPhone: Tristate
  hasLinkedin: Tristate
  /** True/false/null tristate. True = first AND last name populated. */
  hasName: Tristate
  hasOpenDeal: Tristate
  isCustomer: Tristate    // active MRR deal
  activity: ActivityWindow
}

export const EMPTY_FILTER: ContactFilterState = {
  query: '',
  tags: [],
  states: [],
  statuses: [],
  roles: [],
  titlesContain: [],
  companyIds: [],
  companyVerticals: [],
  hasEmail: null,
  hasPhone: null,
  hasLinkedin: null,
  hasName: null,
  hasOpenDeal: null,
  isCustomer: null,
  activity: 'any',
}

// ============================================================
// Apply filter to a list of contacts
// ============================================================

export interface FilterContext {
  contacts: Contact[]
  deals: Deal[]
  companies: Company[]
  emailSends: EmailSend[]
  activityLogs: ActivityLog[]
}

export function applyContactFilter(
  ctx: FilterContext,
  state: ContactFilterState,
  now: Date = new Date(),
): Contact[] {
  const q = state.query.toLowerCase().trim()
  const tagSet = new Set(state.tags.map((t) => t.toLowerCase()))
  const stateSet = new Set(state.states.map((s) => s.toLowerCase()))
  const statusSet = new Set(state.statuses.map((s) => s.toLowerCase()))
  const roleSet = new Set(state.roles.map((s) => s.toLowerCase()))
  const companySet = new Set(state.companyIds)

  // Pre-compute deal info per contact so we don't re-walk for each one
  const dealsByContact = new Map<string, Deal[]>()
  for (const d of ctx.deals) {
    if (!d.contactId) continue
    if (!dealsByContact.has(d.contactId)) dealsByContact.set(d.contactId, [])
    dealsByContact.get(d.contactId)!.push(d)
  }

  // Pre-compute last-touch timestamp per contact
  const lastTouch = new Map<string, number>()
  const upd = (id: string, ts: string) => {
    if (!id || !ts) return
    const t = new Date(ts).getTime()
    if (!Number.isFinite(t)) return
    const cur = lastTouch.get(id) || 0
    if (t > cur) lastTouch.set(id, t)
  }
  for (const e of ctx.emailSends) upd(e.contactId, e.sentAt)
  for (const log of ctx.activityLogs) {
    if (log.entityType === 'contact') upd(log.entityId, log.occurredAt || log.createdAt)
  }

  return ctx.contacts.filter((c) => {
    // Text search — case-insensitive substring across all human-meaningful fields.
    // Includes role + phone (added later than original filter), normalizes
    // phone digits so "5551234567" matches "(555) 123-4567" etc.
    if (q) {
      const company = c.companyId ? ctx.companies.find((x) => x.id === c.companyId)?.name || '' : ''
      const phoneDigits = (c.phone || '').replace(/\D/g, '')
      const qDigits = q.replace(/\D/g, '')
      const haystack = [
        c.firstName, c.lastName, c.email, c.title, c.role, c.state, c.tags, c.phone, company,
      ].filter(Boolean).join(' ').toLowerCase()
      const textMatch = haystack.includes(q)
      const phoneMatch = qDigits.length >= 3 && phoneDigits.includes(qDigits)
      if (!textMatch && !phoneMatch) return false
    }

    // Tags (OR within tags)
    if (tagSet.size > 0) {
      const ct = parseTags(c.tags).map((t) => t.toLowerCase())
      if (!ct.some((t) => tagSet.has(t))) return false
    }

    // States (OR)
    if (stateSet.size > 0) {
      if (!stateSet.has((c.state || '').toLowerCase())) return false
    }

    // Statuses (OR)
    if (statusSet.size > 0) {
      if (!statusSet.has((c.status || '').toLowerCase())) return false
    }

    // Roles (OR)
    if (roleSet.size > 0) {
      if (!roleSet.has((c.role || '').toLowerCase())) return false
    }

    // Title substring (OR within the list — match if title contains ANY pattern)
    if (state.titlesContain && state.titlesContain.length > 0) {
      const lowerTitle = (c.title || '').toLowerCase()
      const anyMatch = state.titlesContain.some((p) => lowerTitle.includes(p.toLowerCase().trim()))
      if (!anyMatch) return false
    }

    // Companies (OR)
    if (companySet.size > 0) {
      if (!companySet.has(c.companyId || '')) return false
    }

    // Company vertical (OR) — join through companyId
    if (state.companyVerticals && state.companyVerticals.length > 0) {
      const co = c.companyId ? ctx.companies.find((x) => x.id === c.companyId) : null
      const v = (co?.vertical || 'unknown') as string
      if (!state.companyVerticals.includes(v)) return false
    }

    // Has email / phone / LinkedIn / name
    if (state.hasEmail !== null && !!c.email !== state.hasEmail) return false
    if (state.hasPhone !== null && !!c.phone !== state.hasPhone) return false
    if (state.hasLinkedin !== null && !!c.linkedinUrl !== state.hasLinkedin) return false
    if (state.hasName !== null) {
      const hasFullName = !!(c.firstName || '').trim() && !!(c.lastName || '').trim()
      if (hasFullName !== state.hasName) return false
    }

    // Has open deal
    const dealsForContact = dealsByContact.get(c.id) || []
    if (state.hasOpenDeal !== null) {
      const hasOpen = dealsForContact.some((d) => !d.stage.startsWith('Closed'))
      if (hasOpen !== state.hasOpenDeal) return false
    }

    // Is customer (active MRR)
    if (state.isCustomer !== null) {
      const isCustomer = dealsForContact.some(isActiveMRR)
      if (isCustomer !== state.isCustomer) return false
    }

    // Activity window
    if (state.activity !== 'any') {
      const t = lastTouch.get(c.id) || 0
      const age = t > 0 ? (now.getTime() - t) : Infinity
      switch (state.activity) {
        case 'never':       if (t > 0) return false; break
        case 'last-7d':     if (age > 7 * DAY) return false; break
        case 'last-30d':    if (age > 30 * DAY) return false; break
        case 'stale-30d':   if (age <= 30 * DAY) return false; break
        case 'stale-60d':   if (age <= 60 * DAY) return false; break
        case 'stale-90d':   if (age <= 90 * DAY) return false; break
      }
    }

    return true
  })
}

// Helper used by both Contacts page tags + this module
export function parseTags(raw: string): string[] {
  if (!raw) return []
  return raw.split(/[,|]+/).map((t) => t.trim()).filter(Boolean)
}

// ============================================================
// Active-chips description (for rendering removable chips in the UI)
// ============================================================

export interface ActiveChip {
  key: string                      // unique id for React + remove handler
  label: string                    // human display
  onRemove: (s: ContactFilterState) => ContactFilterState  // returns new state
}

export function describeActiveChips(state: ContactFilterState): ActiveChip[] {
  const chips: ActiveChip[] = []
  for (const t of state.tags) {
    chips.push({
      key: `tag:${t}`, label: `Tag: ${t}`,
      onRemove: (s) => ({ ...s, tags: s.tags.filter((x) => x !== t) }),
    })
  }
  for (const st of state.states) {
    chips.push({
      key: `state:${st}`, label: `State: ${st}`,
      onRemove: (s) => ({ ...s, states: s.states.filter((x) => x !== st) }),
    })
  }
  for (const status of state.statuses) {
    chips.push({
      key: `status:${status}`, label: `Status: ${status}`,
      onRemove: (s) => ({ ...s, statuses: s.statuses.filter((x) => x !== status) }),
    })
  }
  for (const role of state.roles) {
    chips.push({
      key: `role:${role}`, label: `Role: ${role}`,
      onRemove: (s) => ({ ...s, roles: s.roles.filter((x) => x !== role) }),
    })
  }
  for (const t of state.titlesContain) {
    chips.push({
      key: `title:${t}`, label: `Title contains: ${t}`,
      onRemove: (s) => ({ ...s, titlesContain: s.titlesContain.filter((x) => x !== t) }),
    })
  }
  for (const c of state.companyIds) {
    chips.push({
      key: `company:${c}`, label: `Company set`,
      onRemove: (s) => ({ ...s, companyIds: s.companyIds.filter((x) => x !== c) }),
    })
  }
  for (const v of state.companyVerticals || []) {
    chips.push({
      key: `cvertical:${v}`,
      label: `Co. vertical: ${v.charAt(0).toUpperCase()}${v.slice(1)}`,
      onRemove: (s) => ({ ...s, companyVerticals: s.companyVerticals.filter((x) => x !== v) }),
    })
  }
  if (state.hasName !== null) {
    chips.push({
      key: 'hasName', label: state.hasName ? 'Has full name' : 'Missing name',
      onRemove: (s) => ({ ...s, hasName: null }),
    })
  }
  if (state.hasEmail !== null) {
    chips.push({
      key: 'hasEmail', label: state.hasEmail ? 'Has email' : 'No email',
      onRemove: (s) => ({ ...s, hasEmail: null }),
    })
  }
  if (state.hasPhone !== null) {
    chips.push({
      key: 'hasPhone', label: state.hasPhone ? 'Has phone' : 'No phone',
      onRemove: (s) => ({ ...s, hasPhone: null }),
    })
  }
  if (state.hasLinkedin !== null) {
    chips.push({
      key: 'hasLinkedin', label: state.hasLinkedin ? 'Has LinkedIn' : 'No LinkedIn',
      onRemove: (s) => ({ ...s, hasLinkedin: null }),
    })
  }
  if (state.hasOpenDeal !== null) {
    chips.push({
      key: 'hasOpenDeal', label: state.hasOpenDeal ? 'Open deal' : 'No open deal',
      onRemove: (s) => ({ ...s, hasOpenDeal: null }),
    })
  }
  if (state.isCustomer !== null) {
    chips.push({
      key: 'isCustomer', label: state.isCustomer ? 'Customer (MRR)' : 'Not a customer',
      onRemove: (s) => ({ ...s, isCustomer: null }),
    })
  }
  if (state.activity !== 'any') {
    chips.push({
      key: 'activity',
      label: ACTIVITY_LABELS[state.activity],
      onRemove: (s) => ({ ...s, activity: 'any' }),
    })
  }
  return chips
}

export const ACTIVITY_LABELS: Record<ActivityWindow, string> = {
  'any': 'Activity: any',
  'never': 'Never contacted',
  'last-7d': 'Touched in 7d',
  'last-30d': 'Touched in 30d',
  'stale-30d': 'Quiet 30d+',
  'stale-60d': 'Quiet 60d+',
  'stale-90d': 'Quiet 90d+',
}

export function isFilterEmpty(s: ContactFilterState): boolean {
  return (
    !s.query &&
    s.tags.length === 0 &&
    s.states.length === 0 &&
    s.statuses.length === 0 &&
    s.roles.length === 0 &&
    (!s.titlesContain || s.titlesContain.length === 0) &&
    s.companyIds.length === 0 &&
    (!s.companyVerticals || s.companyVerticals.length === 0) &&
    s.hasEmail === null &&
    s.hasPhone === null &&
    s.hasLinkedin === null &&
    s.hasName === null &&
    s.hasOpenDeal === null &&
    s.isCustomer === null &&
    s.activity === 'any'
  )
}

// ============================================================
// Saved views (localStorage)
// ============================================================

const VIEWS_KEY = 'hashio-contact-views-v1'

export interface SavedView {
  id: string
  name: string
  state: ContactFilterState
  createdAt: string
}

export function loadSavedViews(): SavedView[] {
  // Always start with the latest presets so new ones surface even for users
  // who already had saved-views in localStorage. Then append user customs
  // (filtering out any preset duplicates or stale presets from prior versions).
  let custom: SavedView[] = []
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedView[]
      if (Array.isArray(parsed)) {
        custom = parsed.filter((v) => !v.id.startsWith('preset-'))
      }
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_VIEWS, ...custom]
}

export function saveSavedViews(views: SavedView[]): void {
  // Persist only user customs — presets are always pulled fresh in loadSavedViews
  const customsOnly = views.filter((v) => !v.id.startsWith('preset-'))
  localStorage.setItem(VIEWS_KEY, JSON.stringify(customsOnly))
  window.dispatchEvent(new CustomEvent('hashio-contact-views-change'))
}

export function addSavedView(name: string, state: ContactFilterState): SavedView {
  const views = loadSavedViews()
  const newView: SavedView = {
    id: 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    name,
    state,
    createdAt: new Date().toISOString(),
  }
  saveSavedViews([newView, ...views])
  return newView
}

export function removeSavedView(id: string): void {
  if (id.startsWith('preset-')) return // can't delete presets
  saveSavedViews(loadSavedViews().filter((v) => v.id !== id))
}

// Useful starter views
const DEFAULT_VIEWS: SavedView[] = [
  {
    id: 'preset-flagged',
    name: '🚩 AI flagged for review',
    state: { ...EMPTY_FILTER, tags: ['ai-flag-mismatch'] },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preset-rec-delete',
    name: '🗑 AI: recommend delete',
    state: { ...EMPTY_FILTER, tags: ['ai-rec-delete'] },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preset-customers',
    name: 'Customers (MRR)',
    state: { ...EMPTY_FILTER, isCustomer: true },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preset-stale-60',
    name: 'Quiet 60d+',
    state: { ...EMPTY_FILTER, activity: 'stale-60d' },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preset-no-email',
    name: 'Missing email',
    state: { ...EMPTY_FILTER, hasEmail: false },
    createdAt: new Date().toISOString(),
  },
  {
    id: 'preset-open-deals',
    name: 'Has open deal',
    state: { ...EMPTY_FILTER, hasOpenDeal: true },
    createdAt: new Date().toISOString(),
  },
]
