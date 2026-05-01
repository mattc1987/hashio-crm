// Automation triggers detector. Apps Script time-based triggers must be
// installed once before they ever run — and there are THREE that matter:
//
//   runScheduler           — fires queued sequence emails (every 5 min)
//   checkReplies           — marks enrollments stopped-reply when prospect
//                            responds (every 5 min) — without this,
//                            sequences keep firing after replies
//   scanInboundEmailsCron  — logs inbound emails on contact activity
//                            feeds (every 60 min)
//
// If any are missing, sequences either don't send, ignore replies, or hide
// inbound emails. This banner detects ALL THREE and offers a one-click
// install-everything button. Mounted globally in AppShell.

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'
import { invokeAction, hasWriteBackend } from '../lib/api'
import { useSheetData } from '../lib/sheet-context'

interface AutomationStatus {
  runScheduler: boolean
  checkReplies: boolean
  scanInboundEmailsCron: boolean
  dailyDigestCron: boolean
  allCriticalInstalled: boolean
}

export function SchedulerStatusBanner() {
  const { state } = useSheetData()
  const [status, setStatus] = useState<AutomationStatus | null>(null)
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
        const res = await invokeAction('getAllAutomationStatus', {})
        if (!alive) return
        if (res.ok) {
          setStatus((res as { data?: AutomationStatus }).data || null)
        }
      } catch {
        // Backend out of date — assume installed so we don't block the UI on
        // older deployments. Once user pastes the latest Code.gs we'll detect.
        if (alive) setStatus({
          runScheduler: true, checkReplies: true, scanInboundEmailsCron: true,
          dailyDigestCron: false, allCriticalInstalled: true,
        })
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const installAll = async () => {
    setInstalling(true)
    setInstallResult(null)
    try {
      const res = await invokeAction('installAllAutomationTriggers', {})
      if (!res.ok) throw new Error(res.error || 'Failed to install')
      const d = (res as { data?: { status?: AutomationStatus } }).data
      if (d?.status) setStatus(d.status)
      setInstallResult({
        ok: true,
        message: 'Automation triggers installed. Sequences will fire, replies will be detected, and inbound emails will land on contact pages — all within 5 minutes.',
      })
    } catch (err) {
      setInstallResult({ ok: false, message: (err as Error).message })
    } finally {
      setInstalling(false)
    }
  }

  // Don't render: still checking, no backend, or all good and nothing to confirm
  if (checking) return null
  if (!hasWriteBackend()) return null
  if (status?.allCriticalInstalled && !installResult) return null
  if (dismissed) return null

  if (status?.allCriticalInstalled && installResult?.ok) {
    return (
      <div className="px-4 lg:px-8 py-2 text-[12px] flex items-center gap-2 bg-[color:rgba(48,179,107,0.1)] border-soft-b">
        <CheckCircle2 size={13} className="text-[var(--color-success)] shrink-0" />
        <div className="flex-1 min-w-0 text-body">{installResult.message}</div>
        <button
          onClick={() => setDismissed(true)}
          className="text-[var(--text-faint)] hover:text-body text-[11px] font-medium"
        >
          Dismiss
        </button>
      </div>
    )
  }

  // Build a list of what's missing for the message
  const missing: string[] = []
  if (status && !status.runScheduler)          missing.push('sending sequence emails')
  if (status && !status.checkReplies)          missing.push('detecting replies')
  if (status && !status.scanInboundEmailsCron) missing.push('logging inbound emails on contact pages')

  // Severity: if there are active enrollments AND any critical trigger is
  // missing, this is URGENT (red). Otherwise just amber heads-up.
  const isUrgent = (status && !status.allCriticalInstalled) && activeEnrollments > 0

  return (
    <div
      className={
        'px-4 lg:px-8 py-2.5 text-[12px] flex items-center gap-3 border-soft-b ' +
        (isUrgent ? 'bg-[color:rgba(239,76,76,0.1)]' : 'bg-[color:rgba(245,165,36,0.1)]')
      }
    >
      <AlertTriangle
        size={14}
        className={isUrgent ? 'text-[var(--color-danger)] shrink-0' : 'text-[var(--color-warning)] shrink-0'}
      />
      <div className="flex-1 min-w-0">
        <span className="text-body font-medium">
          {isUrgent
            ? `Hashio automation is OFF — ${activeEnrollments} active enrollment${activeEnrollments === 1 ? '' : 's'} affected.`
            : 'Hashio automation needs setup.'}
        </span>{' '}
        <span className="text-muted">
          Missing: {missing.join(', ') || 'one or more triggers'}.{' '}
        </span>
        <button
          onClick={installAll}
          disabled={installing}
          className="font-medium text-[var(--color-brand-700)] hover:text-[var(--color-brand-800)] dark:text-[var(--color-brand-300)] disabled:opacity-50"
        >
          {installing ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> Installing…
            </span>
          ) : 'Fix now (one click) →'}
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
