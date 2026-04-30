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
  companyIds: string[]
  hasEmail: Tristate
  hasPhone: Tristate
  hasLinkedin: Tristate
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
  companyIds: [],
  hasEmail: null,
  hasPhone: null,
  hasLinkedin: null,
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
    // Text search
    if (q) {
      const company = c.companyId ? ctx.companies.find((x) => x.id === c.companyId)?.name || '' : ''
      const haystack = [
        c.firstName, c.lastName, c.email, c.title, c.state, c.tags, company,
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
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

    // Companies (OR)
    if (companySet.size > 0) {
      if (!companySet.has(c.companyId || '')) return false
    }

    // Has email / phone / LinkedIn
    if (state.hasEmail !== null && !!c.email !== state.hasEmail) return false
    if (state.hasPhone !== null && !!c.phone !== state.hasPhone) return false
    if (state.hasLinkedin !== null && !!c.linkedinUrl !== state.hasLinkedin) return false

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
  for (const c of state.companyIds) {
    chips.push({
      key: `company:${c}`, label: `Company set`,
      onRemove: (s) => ({ ...s, companyIds: s.companyIds.filter((x) => x !== c) }),
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
    s.companyIds.length === 0 &&
    s.hasEmail === null &&
    s.hasPhone === null &&
    s.hasLinkedin === null &&
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
  try {
    const raw = localStorage.getItem(VIEWS_KEY)
    if (!raw) return DEFAULT_VIEWS
    const parsed = JSON.parse(raw) as SavedView[]
    return Array.isArray(parsed) ? parsed : DEFAULT_VIEWS
  } catch {
    return DEFAULT_VIEWS
  }
}

export function saveSavedViews(views: SavedView[]): void {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(views))
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
  saveSavedViews(loadSavedViews().filter((v) => v.id !== id))
}

// Useful starter views
const DEFAULT_VIEWS: SavedView[] = [
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
