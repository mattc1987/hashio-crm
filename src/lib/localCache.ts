// Local optimistic cache — so creates/updates/deletes show up in the UI
// immediately, even when the Apps Script backend isn't deployed yet.
//
// Design:
//   - Creates: stored as full rows under a per-entity dictionary.
//     They get ID prefix `local-` until the Sheet confirms them.
//   - Updates: stored as partial patches keyed by the real row id.
//     Merged on top of the Sheet's value when loaded.
//   - Deletes: stored as a set of ids to hide from the merged view.
//
// When the Sheet refresh returns a row that matches a pending create
// (by name + timestamp heuristic, or once we wire the backend to echo
// back the provisional id), we could clear it automatically. For now
// we just let pending entries live locally until the user clicks
// "Clear pending" in Settings, or the backend is configured and a
// manual resync runs.

export type Entity =
  | 'companies'
  | 'contacts'
  | 'deals'
  | 'tasks'
  | 'invoices'
  | 'cashflow'
  | 'execUpdates'
  | 'sequences'
  | 'sequenceSteps'
  | 'emailTemplates'
  | 'enrollments'
  | 'emailSends'
  | 'bookingLinks'
  | 'bookings'
  | 'notes'
  | 'activityLogs'

type Row = Record<string, unknown> & { id: string }

interface LocalState {
  creates: Partial<Record<Entity, Row[]>>
  updates: Partial<Record<Entity, Record<string, Partial<Row>>>>
  deletes: Partial<Record<Entity, string[]>>
}

const KEY = 'hashio-local-cache-v1'

function read(): LocalState {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as LocalState || { creates: {}, updates: {}, deletes: {} }
  } catch {
    return { creates: {}, updates: {}, deletes: {} }
  }
}

function write(s: LocalState) {
  localStorage.setItem(KEY, JSON.stringify(s))
  // Notify any listeners (useSheet hook subscribes below).
  window.dispatchEvent(new CustomEvent('hashio-local-cache-change'))
}

export function onLocalChange(cb: () => void): () => void {
  const handler = () => cb()
  window.addEventListener('hashio-local-cache-change', handler)
  return () => window.removeEventListener('hashio-local-cache-change', handler)
}

/** ID generator for provisional creates. */
export function localId(entity: Entity): string {
  const prefix = {
    companies: 'co', contacts: 'ct', deals: 'dl', tasks: 'tk',
    invoices: 'in', cashflow: 'cf', execUpdates: 'ex',
    sequences: 'sq', sequenceSteps: 'ss', emailTemplates: 'tp',
    enrollments: 'en', emailSends: 'em',
    bookingLinks: 'bk', bookings: 'bg', notes: 'nt', activityLogs: 'al',
  }[entity]
  const rand = Math.random().toString(36).slice(2, 10)
  return `local-${prefix}-${Date.now().toString(36)}-${rand}`
}

export function isLocalId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('local-')
}

/** Record a create in the local cache. Returns the row with its id. */
export function recordCreate(entity: Entity, payload: Record<string, unknown>): Row {
  const s = read()
  const row: Row = {
    id: (payload.id as string) || localId(entity),
    createdAt: (payload.createdAt as string) || new Date().toISOString(),
    ...payload,
  }
  row.id = row.id as string // ensure string
  s.creates = s.creates || {}
  s.creates[entity] = [...(s.creates[entity] || []), row]
  write(s)
  return row
}

/** Record an update (partial patch) against an id. */
export function recordUpdate(entity: Entity, id: string, patch: Record<string, unknown>) {
  const s = read()
  // If this id is a local-created row, merge the patch straight into the
  // create record. No need to track it separately — the create always
  // reflects the latest state of rows that don't yet exist in the Sheet.
  if (isLocalId(id) && s.creates?.[entity]) {
    s.creates[entity] = s.creates[entity]!.map((r) =>
      r.id === id ? ({ ...r, ...patch, updatedAt: new Date().toISOString() } as Row) : r
    )
  } else {
    s.updates = s.updates || {}
    const forEntity = s.updates[entity] || {}
    forEntity[id] = { ...(forEntity[id] || {}), ...patch, updatedAt: new Date().toISOString() }
    s.updates[entity] = forEntity
  }
  write(s)
}

/** Record a delete. If the id is a local-create, we actually remove it from creates. */
export function recordDelete(entity: Entity, id: string) {
  const s = read()
  if (isLocalId(id)) {
    s.creates = s.creates || {}
    s.creates[entity] = (s.creates[entity] || []).filter((r) => r.id !== id)
  } else {
    s.deletes = s.deletes || {}
    s.deletes[entity] = Array.from(new Set([...(s.deletes[entity] || []), id]))
  }
  // Any pending updates against this id can go.
  if (s.updates?.[entity]) {
    const copy = { ...s.updates[entity] }
    delete copy[id]
    s.updates[entity] = copy
  }
  write(s)
}

/** Merge the local cache on top of a Sheet-fetched array of rows. */
export function mergeLocal<T extends { id: string }>(entity: Entity, rows: T[]): T[] {
  const s = read()
  const deletes = new Set(s.deletes?.[entity] || [])
  const updates = s.updates?.[entity] || {}
  const creates = (s.creates?.[entity] || []) as unknown as T[]

  const byId = new Map<string, T>()
  for (const r of rows) {
    if (deletes.has(r.id)) continue
    const patched = { ...r, ...(updates[r.id] as Partial<T> || {}) } as T
    byId.set(r.id, patched)
  }
  // Add creates (with any patches applied defensively — recordUpdate folds
  // patches into the create itself for local-created ids, but belt-and-braces
  // protects against stale caches from older builds).
  for (const c of creates) {
    if (deletes.has(c.id)) continue
    if (byId.has(c.id)) continue
    const patched = { ...c, ...(updates[c.id] as Partial<T> || {}) } as T
    byId.set(c.id, patched)
  }
  return Array.from(byId.values())
}

export function pendingCount(): { creates: number; updates: number; deletes: number; total: number } {
  const s = read()
  let creates = 0, updates = 0, deletes = 0
  for (const arr of Object.values(s.creates || {})) creates += arr?.length || 0
  for (const byId of Object.values(s.updates || {})) updates += Object.keys(byId || {}).length
  for (const arr of Object.values(s.deletes || {})) deletes += arr?.length || 0
  return { creates, updates, deletes, total: creates + updates + deletes }
}

export function clearPendingLocal() {
  localStorage.removeItem(KEY)
  window.dispatchEvent(new CustomEvent('hashio-local-cache-change'))
}

export function snapshot(): LocalState {
  return read()
}
