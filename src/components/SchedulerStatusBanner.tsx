// Scheduler trigger detector. The Apps Script `runScheduler` time-trigger has
// to be installed once before any sequence emails will actually send. Without
// it, enrollments queue but never fire — and the user has no way to know
// (the UI optimistically shows enrollments as "active and scheduled").
//
// This banner pings the backend on mount, and shows a one-click installer if
// the trigger is missing AND there are active enrollments waiting to send.
// Mounted at the AppShell level so it's visible from any page.

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'
import { invokeAction, hasWriteBackend } from '../lib/api'
import { useSheetData } from '../lib/sheet-context'

export function SchedulerStatusBanner() {
  const { state } = useSheetData()
  const [status, setStatus] = useState<{ installed: boolean } | null>(null)
  const [checking, setChecking] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Are there active enrollments that should be firing?
  const data = state.status === 'ready' ? state.data : undefined
  const activeEnrollments = (data?.enrollments || []).filter((e) => e.status === 'active').length

  useEffect(() => {
    if (!hasWriteBackend()) { setChecking(false); return }
    let alive = true
    ;(async () => {
      try {
        const res = await invokeAction('getSchedulerStatus', {})
        if (!alive) return
        if (res.ok) {
          setStatus((res as { data?: { installed: boolean } }).data || { installed: false })
        }
      } catch {
        // Backend out of date (no getSchedulerStatus action) — assume installed
        // so we don't block UI on older deployments. User will know if their
        // emails aren't sending.
        if (alive) setStatus({ installed: true })
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const install = async () => {
    setInstalling(true)
    setInstallResult(null)
    try {
      const res = await invokeAction('installSchedulerTrigger', {})
      if (!res.ok) throw new Error(res.error || 'Failed to install')
      setStatus({ installed: true })
      setInstallResult({ ok: true, message: 'Scheduler installed. Sequence emails will start sending within 5 minutes.' })
    } catch (err) {
      setInstallResult({ ok: false, message: (err as Error).message })
    } finally {
      setInstalling(false)
    }
  }

  // Don't render: still checking, or no backend, or trigger is healthy and no errors to show
  if (checking) return null
  if (!hasWriteBackend()) return null
  if (status?.installed && !installResult) return null
  if (dismissed) return null

  // If the trigger is missing but there are zero active enrollments, soften the
  // tone — show a small heads-up instead of the full red banner.
  const isUrgent = !status?.installed && activeEnrollments > 0

  if (status?.installed && installResult?.ok) {
    return (
      <div className="px-4 lg:px-8 py-2 text-[12px] flex items-center gap-2 bg-[color:rgba(48,179,107,0.1)] border-soft-b">
        <CheckCircle2 size={13} className="text-[var(--color-success)] shrink-0" />
        <div className="flex-1 min-w-0 text-body">
          {installResult.message}
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--text-faint)] hover:text-body text-[11px] font-medium"
        >
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div
      className={
        'px-4 lg:px-8 py-2.5 text-[12px] flex items-center gap-3 border-soft-b ' +
        (isUrgent
          ? 'bg-[color:rgba(239,76,76,0.1)]'
          : 'bg-[color:rgba(245,165,36,0.1)]')
      }
    >
      <AlertTriangle
        size={14}
        className={isUrgent ? 'text-[var(--color-danger)] shrink-0' : 'text-[var(--color-warning)] shrink-0'}
      />
      <div className="flex-1 min-w-0">
        <span className="text-body font-medium">
          {isUrgent
            ? `Sequence scheduler is OFF — ${activeEnrollments} enrollment${activeEnrollments === 1 ? '' : 's'} queued but not sending.`
            : 'Sequence scheduler not installed.'}
        </span>{' '}
        <span className="text-muted">
          {isUrgent
            ? 'One-click fix to start sending: '
            : "It's free; no downside. "}
        </span>
        <button
          onClick={install}
          disabled={installing}
          className="font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] dark:text-[var(--color-brand-300)] disabled:opacity-50"
        >
          {installing ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Installing…
            </span>
          ) : 'Install scheduler trigger →'}
        </button>
        {installResult && !installResult.ok && (
          <span className="ml-2 text-[var(--color-danger)]">{installResult.message}</span>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-[var(--text-faint)] hover:text-body text-[11px] font-medium shrink-0"
      >
        Dismiss
      </button>
    </div>
  )
}
