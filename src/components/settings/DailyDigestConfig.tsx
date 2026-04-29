// Daily digest configuration — proactive 8am AI BDR email.
// Apps Script time-trigger fires every morning, builds a digest, calls
// Claude, emails Matt the priorities with one-click links.

import { useEffect, useState } from 'react'
import { Mail, CheckCircle2, AlertCircle, Send, Power, RefreshCw, Clock } from 'lucide-react'
import { Card, CardHeader, Button, Input, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'
import { cn } from '../../lib/cn'

interface Status {
  installed: boolean
  recipient: string
  hour: number
  lastRun: string
  defaultRecipient: string
}

export function DailyDigestConfig() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [recipient, setRecipient] = useState('')
  const [hour, setHour] = useState(8)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await invokeAction('getDailyDigestStatus', {})
      if (!res.ok) throw new Error(res.error || 'Failed')
      const d = (res as { data?: Status }).data!
      setStatus(d)
      setRecipient(d.recipient || d.defaultRecipient || '')
      setHour(d.hour || 8)
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasWriteBackend()) refresh()
    else setLoading(false)
  }, [])

  if (!hasWriteBackend()) return null

  const install = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await invokeAction('installDailyDigestTrigger', { hour, recipient: recipient.trim() })
      if (!res.ok) throw new Error(res.error || 'Failed')
      setResult({ ok: true, message: `Daily digest scheduled — fires every day at ${hour}:00 to ${recipient || '(your Gmail)'}.` })
      await refresh()
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const uninstall = async () => {
    setSaving(true)
    setResult(null)
    try {
      const res = await invokeAction('uninstallDailyDigestTrigger', {})
      if (!res.ok) throw new Error(res.error || 'Failed')
      setResult({ ok: true, message: 'Daily digest disabled.' })
      await refresh()
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const sendNow = async () => {
    setTesting(true)
    setResult(null)
    try {
      const res = await invokeAction('sendDailyDigest', { recipient: recipient.trim() })
      if (!res.ok) throw new Error(res.error || 'Failed')
      const d = (res as { data?: { recipient?: string; priorityCount?: number } }).data
      setResult({ ok: true, message: `Test digest sent to ${d?.recipient}. Check your inbox (${d?.priorityCount || 0} priorities).` })
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Mail size={14} className="text-[var(--color-brand-600)]" />
            Daily AI digest email
          </span>
        }
        subtitle="Proactive — your AI BDR emails you every morning with the day's priorities. Push, not pull."
        action={
          status?.installed ? (
            <Badge tone="success">Active · {status.hour}:00 daily</Badge>
          ) : (
            <Badge tone="neutral">Not scheduled</Badge>
          )
        }
      />

      {loading ? (
        <div className="text-[12px] text-muted py-3">Checking status…</div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Recipient email" hint={`Defaults to your Gmail (${status?.defaultRecipient}). Override if you want a different address.`}>
            <Input
              type="email"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={status?.defaultRecipient || 'matt@gohashio.com'}
            />
          </Field>

          <Field label="Send time" hint="When to fire the digest each day. Times are in the script's timezone (Apps Script default).">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className="w-20"
              />
              <span className="text-[12px] text-muted">:00 (24-hour)</span>
            </div>
          </Field>

          <div className="flex items-center gap-2 flex-wrap">
            {status?.installed ? (
              <>
                <Button
                  icon={<RefreshCw size={13} />}
                  onClick={install}
                  disabled={saving}
                  variant="secondary"
                >
                  Update schedule
                </Button>
                <Button
                  icon={<Power size={13} />}
                  onClick={uninstall}
                  disabled={saving}
                  variant="ghost"
                >
                  Disable
                </Button>
              </>
            ) : (
              <Button
                variant="primary"
                icon={<Clock size={13} />}
                onClick={install}
                disabled={saving}
              >
                {saving ? 'Scheduling…' : 'Schedule daily digest'}
              </Button>
            )}
            <Button
              icon={<Send size={13} />}
              onClick={sendNow}
              disabled={testing}
              className="ml-auto"
            >
              {testing ? 'Sending…' : 'Send test now'}
            </Button>
          </div>

          {status?.lastRun && (
            <div className="text-[11px] text-muted">
              Last sent: {new Date(status.lastRun).toLocaleString()}
            </div>
          )}

          {result && (
            <div className={cn(
              'flex items-start gap-2 p-3 rounded-[var(--radius-md)] text-[12px]',
              result.ok ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]' : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
            )}>
              {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
              <span>{result.message}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}
