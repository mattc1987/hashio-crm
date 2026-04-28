// Write-path API — calls a Google Apps Script web app that Matt will deploy
// (see apps-script/Code.gs + SETUP.md).
//
// Always records the intended write into the **local cache** first so the UI
// can reflect it immediately. Then (if the backend is configured) fires the
// actual Apps Script write. If the remote write fails, the local record stays
// — user sees the change locally and can retry later.

import {
  recordCreate,
  recordUpdate,
  recordDelete,
  pendingCount as localPendingCount,
  clearPendingLocal,
  type Entity,
} from './localCache'

type WriteOp = 'create' | 'update' | 'delete'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

export function hasWriteBackend(): boolean {
  return !!APPS_SCRIPT_URL && !!APPS_SCRIPT_KEY
}

async function callScript(action: string, params: Record<string, unknown>): Promise<unknown> {
  if (!APPS_SCRIPT_URL) throw new Error('No Apps Script URL configured')
  const url = new URL(APPS_SCRIPT_URL)
  url.searchParams.set('action', action)
  url.searchParams.set('key', APPS_SCRIPT_KEY)
  url.searchParams.set('payload', JSON.stringify(params))
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' })
  if (!res.ok) throw new Error(`Write failed: HTTP ${res.status}`)
  return res.json()
}

export interface WriteResult {
  ok: boolean
  queued?: boolean
  error?: string
  /** The optimistically-created row (with its provisional id) for `create` ops. */
  row?: Record<string, unknown> & { id: string }
}

export async function save(
  entity: Entity,
  op: WriteOp,
  payload: Record<string, unknown>,
): Promise<WriteResult> {
  // 1. Record in local cache first (optimistic UI).
  let provisional: (Record<string, unknown> & { id: string }) | undefined
  if (op === 'create') {
    provisional = recordCreate(entity, payload)
  } else if (op === 'update') {
    const id = payload.id as string
    if (!id) return { ok: false, error: 'Update requires an id' }
    recordUpdate(entity, id, payload)
  } else if (op === 'delete') {
    const id = payload.id as string
    if (!id) return { ok: false, error: 'Delete requires an id' }
    recordDelete(entity, id)
  }

  // 2. If no backend, we're done — caller sees optimistic state.
  if (!hasWriteBackend()) {
    return { ok: true, queued: true, row: provisional }
  }

  // 3. Best-effort remote write. If it fails, the local cache still reflects the change.
  try {
    await callScript('write', {
      entity,
      op,
      payload: provisional ? provisional : payload,
    })
    return { ok: true, row: provisional }
  } catch (err) {
    return { ok: true, queued: true, row: provisional, error: (err as Error).message }
  }
}

// ---------- Convenience ----------

export const api = {
  company: {
    create: (payload: Record<string, unknown>) => save('companies', 'create', payload),
    update: (payload: Record<string, unknown>) => save('companies', 'update', payload),
    remove: (id: string) => save('companies', 'delete', { id }),
  },
  contact: {
    create: (payload: Record<string, unknown>) => save('contacts', 'create', payload),
    update: (payload: Record<string, unknown>) => save('contacts', 'update', payload),
    remove: (id: string) => save('contacts', 'delete', { id }),
  },
  deal: {
    create: (payload: Record<string, unknown>) => save('deals', 'create', payload),
    update: (payload: Record<string, unknown>) => save('deals', 'update', payload),
    remove: (id: string) => save('deals', 'delete', { id }),
  },
  task: {
    create: (payload: Record<string, unknown>) => save('tasks', 'create', payload),
    update: (payload: Record<string, unknown>) => save('tasks', 'update', payload),
    remove: (id: string) => save('tasks', 'delete', { id }),
  },
  sequence: {
    create: (payload: Record<string, unknown>) => save('sequences', 'create', payload),
    update: (payload: Record<string, unknown>) => save('sequences', 'update', payload),
    remove: (id: string) => save('sequences', 'delete', { id }),
  },
  sequenceStep: {
    create: (payload: Record<string, unknown>) => save('sequenceSteps', 'create', payload),
    update: (payload: Record<string, unknown>) => save('sequenceSteps', 'update', payload),
    remove: (id: string) => save('sequenceSteps', 'delete', { id }),
  },
  emailTemplate: {
    create: (payload: Record<string, unknown>) => save('emailTemplates', 'create', payload),
    update: (payload: Record<string, unknown>) => save('emailTemplates', 'update', payload),
    remove: (id: string) => save('emailTemplates', 'delete', { id }),
  },
  enrollment: {
    create: (payload: Record<string, unknown>) => save('enrollments', 'create', payload),
    update: (payload: Record<string, unknown>) => save('enrollments', 'update', payload),
    remove: (id: string) => save('enrollments', 'delete', { id }),
  },
  bookingLink: {
    create: (payload: Record<string, unknown>) => save('bookingLinks', 'create', payload),
    update: (payload: Record<string, unknown>) => save('bookingLinks', 'update', payload),
    remove: (id: string) => save('bookingLinks', 'delete', { id }),
  },
  note: {
    create: (payload: Record<string, unknown>) => save('notes', 'create', payload),
    update: (payload: Record<string, unknown>) => save('notes', 'update', payload),
    remove: (id: string) => save('notes', 'delete', { id }),
  },
  activityLog: {
    create: (payload: Record<string, unknown>) => save('activityLogs', 'create', payload),
    update: (payload: Record<string, unknown>) => save('activityLogs', 'update', payload),
    remove: (id: string) => save('activityLogs', 'delete', { id }),
  },
}

export function invokeAction(action: string, params: Record<string, unknown>): Promise<WriteResult> {
  if (!hasWriteBackend()) return Promise.resolve({ ok: false, error: 'No backend configured' })
  return callScript(action, params).then(
    () => ({ ok: true } as WriteResult),
    (err: Error) => ({ ok: false, error: err.message } as WriteResult),
  )
}

// Back-compat — some older pages imported these names.
export function pendingWrites() {
  const counts = localPendingCount()
  return Array.from({ length: counts.total }, (_, i) => ({ i }))
}
export function clearPending() {
  clearPendingLocal()
}
