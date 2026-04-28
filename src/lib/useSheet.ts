import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadAll } from './sheets'
import type { SheetData } from './types'
import { mergeLocal, onLocalChange } from './localCache'

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; data?: SheetData }
  | { status: 'ready'; data: SheetData }
  | { status: 'error'; error: string; data?: SheetData }

/** Merge the local cache on top of the fetched SheetData. */
function applyLocalCache(data: SheetData): SheetData {
  return {
    ...data,
    companies:      mergeLocal('companies',      data.companies),
    contacts:       mergeLocal('contacts',       data.contacts),
    deals:          mergeLocal('deals',          data.deals),
    tasks:          mergeLocal('tasks',          data.tasks),
    invoices:       mergeLocal('invoices',       data.invoices),
    cashflow:       mergeLocal('cashflow',       data.cashflow),
    execUpdates:    mergeLocal('execUpdates',    data.execUpdates),
    sequences:      mergeLocal('sequences',      data.sequences),
    sequenceSteps:  mergeLocal('sequenceSteps',  data.sequenceSteps),
    emailTemplates: mergeLocal('emailTemplates', data.emailTemplates),
    enrollments:    mergeLocal('enrollments',    data.enrollments),
    emailSends:     mergeLocal('emailSends',     data.emailSends),
    bookingLinks:   mergeLocal('bookingLinks',   data.bookingLinks),
    bookings:       mergeLocal('bookings',       data.bookings),
    notes:          mergeLocal('notes',          data.notes),
    activityLogs:   mergeLocal('activityLogs',   data.activityLogs),
    leads:          mergeLocal('leads',          data.leads),
    smsSends:       mergeLocal('smsSends',       data.smsSends),
    proposals:      mergeLocal('proposals',      data.proposals),
  }
}

export function useSheet() {
  const [rawState, setRawState] = useState<LoadState>({ status: 'idle' })
  const [localVersion, setLocalVersion] = useState(0)

  const refresh = useCallback(async () => {
    setRawState((s) => ({ status: 'loading', data: 'data' in s ? s.data : undefined }))
    try {
      const data = await loadAll()
      setRawState({ status: 'ready', data })
    } catch (err) {
      setRawState({ status: 'error', error: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [refresh])

  // Subscribe to local cache changes so optimistic writes re-render immediately.
  useEffect(() => {
    return onLocalChange(() => setLocalVersion((v) => v + 1))
  }, [])

  // Apply the local cache to whatever raw state we have.
  const state = useMemo<LoadState>(() => {
    void localVersion // trigger recompute on local-cache change
    if (rawState.status === 'ready') {
      return { status: 'ready', data: applyLocalCache(rawState.data) }
    }
    if ('data' in rawState && rawState.data) {
      return { ...rawState, data: applyLocalCache(rawState.data) } as LoadState
    }
    return rawState
  }, [rawState, localVersion])

  return { state, refresh }
}
