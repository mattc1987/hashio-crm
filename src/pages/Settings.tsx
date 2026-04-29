import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor, AlertCircle, CheckCircle2, ExternalLink, Flame, Copy } from 'lucide-react'
import { TwilioConfig } from '../components/settings/TwilioConfig'
import { AnthropicConfig } from '../components/settings/AnthropicConfig'
import { TestDataSeeder } from '../components/settings/TestDataSeeder'
import { Card, CardHeader, PageHeader, Badge } from '../components/ui'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme'
import { hasWriteBackend } from '../lib/api'
import { clearPendingLocal, pendingCount, onLocalChange } from '../lib/localCache'
import { SHEET_ID } from '../lib/sheets'
import { cn } from '../lib/cn'

export function Settings() {
  const [pref, setPref] = useState<ThemePref>('system')
  const [pending, setPending] = useState<number>(0)
  const [writeReady, setWriteReady] = useState(false)

  useEffect(() => {
    setPref(getThemePref())
    setPending(pendingCount().total)
    setWriteReady(hasWriteBackend())
    return onLocalChange(() => setPending(pendingCount().total))
  }, [])

  const choose = (p: ThemePref) => {
    setPref(p)
    setThemePref(p)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" subtitle="Preferences and integration status." />

      <Card>
        <CardHeader title="Appearance" subtitle="Match your Mac's system, or lock it." />
        <div className="flex flex-wrap gap-2">
          <ThemeChip active={pref === 'system'} onClick={() => choose('system')} icon={<Monitor size={14} />} label="System" />
          <ThemeChip active={pref === 'light'} onClick={() => choose('light')} icon={<Sun size={14} />} label="Light" />
          <ThemeChip active={pref === 'dark'} onClick={() => choose('dark')} icon={<Moon size={14} />} label="Dark" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Google Sheet backend"
          subtitle="Data source for read operations."
          action={
            <a
              href={`https://docs.google.com/spreadsheets/d/${SHEET_ID}`}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] flex items-center gap-1"
            >
              Open sheet <ExternalLink size={12} />
            </a>
          }
        />
        <dl className="text-[13px] space-y-2">
          <div className="flex justify-between py-1.5 border-soft-b">
            <dt className="text-muted">Sheet ID</dt>
            <dd className="font-mono text-[11px] truncate max-w-[260px]">{SHEET_ID}</dd>
          </div>
          <div className="flex justify-between py-1.5 border-soft-b">
            <dt className="text-muted">Read access</dt>
            <dd><Badge tone="success">Connected</Badge></dd>
          </div>
          <div className="flex justify-between py-1.5">
            <dt className="text-muted">Write access (Apps Script)</dt>
            <dd>
              {writeReady ? (
                <Badge tone="success">Ready</Badge>
              ) : (
                <Badge tone="warning">Not configured</Badge>
              )}
            </dd>
          </div>
        </dl>
        {!writeReady && (
          <div className="mt-4 flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[color:rgba(245,165,36,0.1)] text-[13px]">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--color-warning)]" />
            <div>
              <div className="font-medium text-body">Writes are queued locally until backend is deployed.</div>
              <div className="text-muted text-[12px] mt-0.5">
                See <span className="font-mono">SETUP.md</span> for the 5-minute Apps Script deploy. Your changes save to this browser and will sync once the backend is live.
              </div>
            </div>
          </div>
        )}
      </Card>

      {pending > 0 && (
        <Card>
          <CardHeader
            title="Pending local changes"
            subtitle={`${pending} write${pending === 1 ? '' : 's'} waiting for the Apps Script backend.`}
            action={
              <button
                onClick={() => { clearPendingLocal(); setPending(0) }}
                className="text-[12px] text-muted hover:text-[var(--color-danger)]"
              >
                Clear queue
              </button>
            }
          />
        </Card>
      )}

      <Card>
        <CardHeader title="Team" subtitle="Who can sign in." />
        <div className="text-[13px] text-muted">
          Google sign-in is planned for the next drop. Today the app reads directly from the Sheet — deploy SETUP.md to add sign-in.
        </div>
      </Card>

      <AnthropicConfig />

      <TestDataSeeder />

      <TwilioConfig />

      <Card>
        <CardHeader
          title={<span className="flex items-center gap-2"><Flame size={14} className="text-[var(--color-warning)]" /> Lead ingest webhook</span>}
          subtitle="Point Teamfluence (or Zapier / n8n / Apollo / any tool) at this URL to start populating Leads automatically."
        />
        <LeadIngestWebhookConfig />
      </Card>

      <Card>
        <CardHeader title="About" />
        <div className="text-[12px] text-muted font-mono">Hashio CRM · v0.1 · Apple-style build</div>
      </Card>
    </div>
  )
}

function LeadIngestWebhookConfig() {
  const url = import.meta.env.VITE_APPS_SCRIPT_URL || ''
  const fullUrl = url ? `${url}?action=ingestLead` : '(deploy backend first)'
  const samplePayload = JSON.stringify({
    source: 'teamfluence',
    externalId: 'jane-doe-acme',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@acme.com',
    linkedinUrl: 'https://linkedin.com/in/janedoe',
    headline: 'VP of Cultivation at Acme',
    companyName: 'Acme Cultivation, LLC',
    companyLinkedinUrl: 'https://linkedin.com/company/acme-cultivation',
    location: 'Denver, CO',
    signals: [
      { kind: 'company-follow', ts: new Date().toISOString() },
      { kind: 'post-like', ts: new Date().toISOString(), target: 'https://linkedin.com/posts/...' },
    ],
  }, null, 2)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">
          Webhook URL (POST or GET)
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 surface-2 border-soft rounded-[var(--radius-md)] px-3 py-2 text-[11px] font-mono truncate">
            {fullUrl}
          </code>
          <button
            onClick={() => navigator.clipboard?.writeText(fullUrl)}
            className="surface border-soft rounded-[var(--radius-md)] h-9 px-3 text-[12px] font-medium text-body hover:surface-2 inline-flex items-center gap-1.5"
          >
            <Copy size={12} /> Copy
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">
          No API key required for this endpoint — it accepts public webhooks. Sources should
          send <code className="font-mono surface-2 px-1 rounded">source</code> + a unique{' '}
          <code className="font-mono surface-2 px-1 rounded">externalId</code> per lead.
          Repeated webhooks for the same lead will append engagement signals (not duplicate the row).
        </p>
      </div>

      <details>
        <summary className="text-[12px] text-muted cursor-pointer hover:text-body">
          Show example payload
        </summary>
        <pre className="mt-2 surface-2 p-3 rounded-[var(--radius-md)] text-[10px] font-mono text-muted overflow-x-auto whitespace-pre">
{samplePayload}
        </pre>
      </details>

      <details>
        <summary className="text-[12px] text-muted cursor-pointer hover:text-body">
          Wire it into Teamfluence (via Zapier — easiest path)
        </summary>
        <ol className="mt-2 text-[12px] text-body space-y-2 list-decimal pl-5">
          <li>In <strong>Zapier</strong>, create a new Zap.</li>
          <li><strong>Trigger:</strong> Teamfluence → "New engagement" (or similar).</li>
          <li><strong>Action:</strong> Webhooks by Zapier → POST.</li>
          <li><strong>URL:</strong> paste the URL above.</li>
          <li>Map fields: <code className="font-mono">source</code> = "teamfluence", <code className="font-mono">externalId</code> = LinkedIn URN, <code className="font-mono">firstName</code>, <code className="font-mono">lastName</code>, <code className="font-mono">email</code>, <code className="font-mono">linkedinUrl</code>, <code className="font-mono">companyName</code>. For each engagement event, include a <code className="font-mono">signals</code> array with the engagement type (e.g. <code className="font-mono">post-like</code>, <code className="font-mono">company-follow</code>).</li>
          <li>Test the Zap. Check the Leads tab — your lead should appear.</li>
        </ol>
      </details>
    </div>
  )
}

function ThemeChip({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 h-10 px-4 text-[13px] font-medium rounded-[var(--radius-md)] transition-colors',
        active
          ? 'bg-[var(--color-brand-600)] text-white'
          : 'surface-2 border-soft text-muted hover:text-body',
      )}
    >
      {icon}
      {label}
      {active && <CheckCircle2 size={14} className="ml-1" />}
    </button>
  )
}
