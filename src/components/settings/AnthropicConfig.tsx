import { useEffect, useState } from 'react'
import { Sparkles, CheckCircle2, AlertCircle, Eye, EyeOff, RefreshCw, ExternalLink } from 'lucide-react'
import { Card, CardHeader, Button, Input, Badge } from '../ui'
import { hasWriteBackend } from '../../lib/api'
import { cn } from '../../lib/cn'

interface AnthropicStatus {
  configured: boolean
  keyMasked: string
  model: string
  connectionOk: boolean
  connectionError: string
  sampleResponse: string
}

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929'
const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

class BackendOutOfDateError extends Error {
  constructor(action: string) {
    super(
      `The deployed Apps Script doesn't know the "${action}" action yet — ` +
      `redeploy apps-script/Code.gs (Deploy → Manage deployments → Edit → New version → Deploy) ` +
      `to enable the Anthropic integration.`,
    )
    this.name = 'BackendOutOfDateError'
  }
}

async function call<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(APPS_SCRIPT_URL)
  url.searchParams.set('action', action)
  url.searchParams.set('key', APPS_SCRIPT_KEY)
  url.searchParams.set('payload', JSON.stringify(params))
  const res = await fetch(url.toString(), { method: 'GET' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.ok) {
    if (typeof json.error === 'string' && /unknown action/i.test(json.error)) {
      throw new BackendOutOfDateError(action)
    }
    throw new Error(json.error || 'Failed')
  }
  return json.data as T
}

export function AnthropicConfig() {
  const [status, setStatus] = useState<AnthropicStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ apiKey: '', model: '' })
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const s = await call<AnthropicStatus>('getAnthropicStatus')
      setStatus(s)
      setDraft({ apiKey: '', model: s.model || DEFAULT_MODEL })
    } catch (err) {
      setStatus(null)
      setTestResult({ ok: false, message: (err as Error).message })
      setEditing(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (hasWriteBackend()) refresh()
    else setLoading(false)
  }, [])

  const save = async () => {
    if (!draft.apiKey.trim() && !status?.configured) {
      setTestResult({ ok: false, message: 'API key is required.' })
      return
    }
    setSaving(true)
    setTestResult(null)
    try {
      const s = await call<AnthropicStatus>('setAnthropicConfig', {
        apiKey: draft.apiKey.trim() || undefined,
        model: draft.model.trim() || undefined,
      })
      setStatus(s)
      setEditing(false)
      setShowKey(false)
      if (s.connectionOk) {
        setTestResult({ ok: true, message: `Connected to Claude (${s.model}). Sample reply: "${s.sampleResponse}"` })
      } else {
        setTestResult({ ok: false, message: s.connectionError || 'Saved, but Claude rejected the key.' })
      }
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message })
    } finally {
      setSaving(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Sparkles size={14} className="text-[var(--color-brand-600)]" /> AI · Claude (Anthropic)</span>}
          subtitle="Backend not configured — deploy Apps Script first to enable AI settings."
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Sparkles size={14} className="text-[var(--color-brand-600)]" /> AI · Claude (Anthropic)</span>}
        subtitle="Powers BDR message drafting + narrative reasoning. Key lives server-side — never sent to the browser."
        action={
          status?.configured && status.connectionOk ? (
            <Badge tone="success">Connected</Badge>
          ) : status?.configured ? (
            <Badge tone="warning">Auth failed</Badge>
          ) : testResult && !testResult.ok && /redeploy|unknown action/i.test(testResult.message) ? (
            <Badge tone="danger">Backend out of date</Badge>
          ) : (
            <Badge tone="neutral">Not configured</Badge>
          )
        }
      />

      {/* Backend-out-of-date warning is the most important state when it fires */}
      {testResult && !testResult.ok && /redeploy|unknown action/i.test(testResult.message) && (
        <div className="mb-3 p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] border border-[color:rgba(239,76,76,0.2)] text-[12px]">
          <div className="font-semibold text-[var(--color-danger)] mb-1">Apps Script needs to be redeployed</div>
          <div className="text-muted leading-relaxed">{testResult.message}</div>
        </div>
      )}

      {loading ? (
        <div className="text-[12px] text-muted py-3">Checking status…</div>
      ) : !editing && status?.configured ? (
        <div className="flex flex-col gap-3">
          <dl className="text-[13px] space-y-2">
            <div className="flex justify-between py-1.5 border-soft-b">
              <dt className="text-muted">API key</dt>
              <dd className="font-mono text-[12px]">{status.keyMasked}</dd>
            </div>
            <div className="flex justify-between py-1.5 border-soft-b">
              <dt className="text-muted">Model</dt>
              <dd className="font-mono text-[12px]">{status.model}</dd>
            </div>
            <div className="flex justify-between py-1.5">
              <dt className="text-muted">Connection</dt>
              <dd>
                {status.connectionOk ? (
                  <Badge tone="success">OK</Badge>
                ) : (
                  <Badge tone="danger">Failed</Badge>
                )}
              </dd>
            </div>
          </dl>

          {!status.connectionOk && status.connectionError && (
            <ResultBanner result={{ ok: false, message: status.connectionError }} />
          )}

          <div className="flex items-center gap-2 mt-1">
            <Button onClick={() => setEditing(true)}>Edit credentials</Button>
            <Button icon={<RefreshCw size={13} />} onClick={refresh}>Refresh</Button>
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 ml-auto"
            >
              Anthropic Console <ExternalLink size={11} />
            </a>
          </div>

          {testResult && <ResultBanner result={testResult} />}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {!status?.configured && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-muted">
              <div className="font-medium text-body mb-1">Get your API key:</div>
              <ol className="list-decimal pl-4 space-y-0.5">
                <li>Open <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]">console.anthropic.com/settings/keys</a></li>
                <li>Click <strong>Create Key</strong>, give it a name like "Hashio CRM".</li>
                <li>Copy the key (starts with <code className="font-mono">sk-ant-...</code>).</li>
                <li>Paste below + hit Save.</li>
              </ol>
            </div>
          )}

          <Field label="API key" hint={status?.configured ? 'Leave blank to keep the existing key.' : 'Starts with sk-ant-... never shown again after saving.'}>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder={status?.configured ? '(unchanged)' : 'sk-ant-api03-...'}
                className="font-mono text-[12px] pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center text-muted hover:text-body"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </Field>

          <details className="text-[12px]">
            <summary className="cursor-pointer text-muted hover:text-body select-none">
              Advanced — model override
            </summary>
            <div className="mt-2">
              <Field label="Model" hint="Leave blank to use claude-sonnet-4-5 (recommended). Anthropic doesn't give you the model when you create the key — it's just a string passed in API calls.">
                <Input
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder={DEFAULT_MODEL}
                  className="font-mono text-[12px]"
                />
              </Field>
            </div>
          </details>

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
