import { useEffect, useState } from 'react'
import { Sun, Moon, Monitor, AlertCircle, CheckCircle2, ExternalLink } from 'lucide-react'
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

      <Card>
        <CardHeader title="About" />
        <div className="text-[12px] text-muted font-mono">Hashio CRM · v0.1 · Apple-style build</div>
      </Card>
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
