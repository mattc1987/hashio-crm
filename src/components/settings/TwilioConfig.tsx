import { useEffect, useState } from 'react'
import { MessageSquare, CheckCircle2, AlertCircle, Eye, EyeOff, Send, RefreshCw, ExternalLink } from 'lucide-react'
import { Card, CardHeader, Button, Input, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'
import { cn } from '../../lib/cn'

interface TwilioStatus {
  configured: boolean
  sidMasked: string
  sidFull: string
  from: string
  balance: string
  accountFriendlyName: string
  connectionOk: boolean
  connectionError: string
}

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(APPS_SCRIPT_URL)
  url.searchParams.set('action', action)
  url.searchParams.set('key', APPS_SCRIPT_KEY)
  url.searchParams.set('payload', JSON.stringify(params))
  const res = await fetch(url.toString(), { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) throw new Error(json.error || 'Failed')
  return json.data as T
}

export function TwilioConfig() {
  const [status, setStatus] = useState<TwilioStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ sid: '', token: '', from: '' })
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testNumber, setTestNumber] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Initial fetch
  const refresh = async () => {
    setLoading(true)
    try {
      const s = await call<TwilioStatus>('getTwilioStatus')
      setStatus(s)
      if (s.configured) {
        setDraft({ sid: s.sidFull, token: '', from: s.from })
      }
    } catch (err) {
      setStatus(null)
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasWriteBackend()) refresh()
    else setLoading(false)
  }, [])

  const save = async () => {
    if (!draft.sid.trim() || !draft.from.trim()) {
      setTestResult({ ok: false, message: 'Account SID and From-number are required.' })
      return
    }
    setSaving(true)
    setTestResult(null)
    try {
      const s = await call<TwilioStatus>('setTwilioConfig', {
        sid: draft.sid.trim(),
        token: draft.token.trim() || undefined, // don't overwrite token if blank (allows partial edits)
        from: draft.from.trim(),
      })
      setStatus(s)
      setEditing(false)
      setShowToken(false)
      if (s.connectionOk) {
        setTestResult({ ok: true, message: `Connected to "${s.accountFriendlyName || 'Twilio'}" — balance ${s.balance || 'unknown'}` })
      } else {
        setTestResult({ ok: false, message: s.connectionError || 'Saved, but Twilio rejected the credentials.' })
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    if (!testNumber.trim()) return
    setTesting(true)
    setTestResult(null)
    try {
      await invokeAction('sendTestSms', { to: testNumber.trim() })
      setTestResult({ ok: true, message: `Test SMS sent to ${testNumber}. Check your phone.` })
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><MessageSquare size={14} className="text-[var(--color-success)]" /> SMS · Twilio</span>}
          subtitle="Backend not configured — deploy Apps Script first to enable SMS settings."
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><MessageSquare size={14} className="text-[var(--color-success)]" /> SMS · Twilio</span>}
        subtitle="Configure once. SMS steps in sequences will fire automatically."
        action={
          status?.configured && status.connectionOk ? (
            <Badge tone="success">Connected</Badge>
          ) : status?.configured ? (
            <Badge tone="warning">Auth failed</Badge>
          ) : (
            <Badge tone="neutral">Not configured</Badge>
          )
        }
      />

      {loading ? (
        <div className="text-[12px] text-muted py-3">Checking status…</div>
      ) : !editing && status?.configured ? (
        // Read-only status view
        <div className="flex flex-col gap-3">
          <dl className="text-[13px] space-y-2">
            <div className="flex justify-between py-1.5 border-soft-b">
              <dt className="text-muted">Account</dt>
              <dd className="text-body font-medium">{status.accountFriendlyName || '—'}</dd>
            </div>
            <div className="flex justify-between py-1.5 border-soft-b">
              <dt className="text-muted">Account SID</dt>
              <dd className="font-mono text-[12px]">{status.sidMasked}</dd>
            </div>
            <div className="flex justify-between py-1.5 border-soft-b">
              <dt className="text-muted">From number</dt>
              <dd className="font-mono text-[12px]">{status.from}</dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-muted">Balance</dt>
              <dd className="font-display font-semibold tabular">{status.balance || '—'}</dd>
            </div>
          </dl>

          {/* Test SMS */}
          <div className="surface-2 rounded-[var(--radius-md)] p-3 mt-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              Send a test SMS
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                placeholder="+15125551234"
                className="flex-1"
              />
              <Button
                variant="primary"
                icon={<Send size={13} />}
                onClick={sendTest}
                disabled={!testNumber.trim() || testing}
              >
                {testing ? 'Sending…' : 'Test'}
              </Button>
            </div>
            <div className="text-[11px] text-muted mt-2">
              Costs ~$0.008. Use your own number for testing.
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <Button onClick={() => setEditing(true)}>Edit credentials</Button>
            <Button icon={<RefreshCw size={13} />} onClick={refresh}>Refresh</Button>
            <a
              href="https://console.twilio.com"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 ml-auto"
            >
              Twilio console <ExternalLink size={11} />
            </a>
          </div>

          {testResult && <ResultBanner result={testResult} />}
        </div>
      ) : (
        // Edit form
        <div className="flex flex-col gap-3">
          {!status?.configured && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-muted">
              <div className="font-medium text-body mb-1">Get these values from your Twilio console:</div>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Sign up at <a href="https://twilio.com/try-twilio" target="_blank" rel="noreferrer" className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]">twilio.com/try-twilio</a> (free $15 trial credit).</li>
                <li>From the dashboard, copy your <strong>Account SID</strong> and <strong>Auth Token</strong>.</li>
                <li>Buy a phone number under <strong>Phone Numbers → Buy a number</strong> ($1/mo).</li>
                <li>Paste all three below and hit Save.</li>
              </ol>
            </div>
          )}

          <Field label="Account SID" hint="Starts with AC… 34 chars.">
            <Input
              value={draft.sid}
              onChange={(e) => setDraft({ ...draft, sid: e.target.value })}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-[12px]"
            />
          </Field>

          <Field label="Auth token" hint={status?.configured ? 'Leave blank to keep the existing token.' : 'Find this next to your SID.'}>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={draft.token}
                onChange={(e) => setDraft({ ...draft, token: e.target.value })}
                placeholder={status?.configured ? '(unchanged)' : 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
                className="font-mono text-[12px] pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center text-muted hover:text-body"
                aria-label={showToken ? 'Hide token' : 'Show token'}
              >
                {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>

          <Field label="From number" hint="Your verified Twilio number, with country code (e.g. +15125551234).">
            <Input
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              placeholder="+15125551234"
              className="font-mono text-[12px]"
            />
          </Field>

          <div className="flex items-center gap-2 mt-1">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving + testing…' : 'Save & test connection'}
            </Button>
            {status?.configured && (
              <Button onClick={() => { setEditing(false); refresh() }} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>

          {testResult && <ResultBanner result={testResult} />}
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

function ResultBanner({ result }: { result: { ok: boolean; message: string } }) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 p-3 rounded-[var(--radius-md)] text-[12px] mt-1',
        result.ok ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]' : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
      )}
    >
      {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
      <span>{result.message}</span>
    </div>
  )
}
