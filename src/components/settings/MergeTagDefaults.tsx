// Configure global fallback values for merge tags. When a contact is missing
// a field used in an email body / subject (e.g. firstName), the engine
// substitutes the fallback configured here — so emails never go out as
// "Hi ," or "I noticed at  recently you posted...".
//
// Resolution order (Apps Script `resolveMergeTags_`):
//   1. The actual CRM value (highest priority)
//   2. Inline fallback in the tag itself: {{firstName||there}}
//   3. Global default configured here
//   4. Hardcoded sensible default ("there" / "your team" / etc.)
//   5. Literal "{{tag}}" left in place if the tag name is unknown

import { useEffect, useState } from 'react'
import { Tag, Save, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardHeader, Button, Input, Badge } from '../ui'
import { invokeAction, hasWriteBackend } from '../../lib/api'

interface FieldMeta {
  key: string
  label: string
  hardcoded: string
  example: string
}

const FIELDS: FieldMeta[] = [
  { key: 'firstName',   label: 'First name',   hardcoded: 'there',     example: 'Hi {{firstName||there}},' },
  { key: 'lastName',    label: 'Last name',    hardcoded: '',          example: '({{lastName}} usually omitted)' },
  { key: 'fullName',    label: 'Full name',    hardcoded: 'there',     example: '{{fullName||there}}' },
  { key: 'company',     label: 'Company',      hardcoded: 'your team', example: 'About {{company||your team}}…' },
  { key: 'title',       label: 'Title',        hardcoded: '',          example: '{{title||your role}}' },
  { key: 'role',        label: 'Role',         hardcoded: '',          example: '{{role||your team}}' },
  { key: 'state',       label: 'State',        hardcoded: '',          example: '{{state||your state}}' },
]

export function MergeTagDefaults() {
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await invokeAction('getMergeTagDefaults', {})
      if (!res.ok) throw new Error(res.error || 'Failed to load')
      setDefaults((res as { data?: Record<string, string> }).data || {})
      setDirty(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const updateField = (key: string, value: string) => {
    setDefaults({ ...defaults, [key]: value })
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await invokeAction('setMergeTagDefaults', { defaults })
      if (!res.ok) throw new Error(res.error || 'Failed to save')
      setDefaults((res as { data?: Record<string, string> }).data || defaults)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (!hasWriteBackend()) {
    return (
      <Card>
        <CardHeader title="Merge tag fallbacks" subtitle="Apps Script not configured." />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Tag size={16} className="text-[var(--color-brand-600)]" />
            Merge tag fallbacks
          </span>
        }
        subtitle="What to substitute when a contact is missing the field. Prevents broken emails like 'Hi ,'."
        action={
          <Button variant="ghost" onClick={refresh} disabled={loading}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="mb-3 p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] border border-[var(--color-danger)]/20 text-[12px] text-[var(--color-danger)]">
          {error}
        </div>
      )}

      <div className="mb-4 p-3 rounded-[var(--radius-md)] surface-2 text-[12px]">
        <strong className="text-body">Three ways a fallback gets used (highest wins):</strong>
        <ol className="list-decimal pl-5 mt-1 text-muted space-y-0.5">
          <li>
            <strong>Inline in the email</strong>: <code className="font-mono text-[11px]">{'{{firstName||there}}'}</code> — recommended for one-off cases
          </li>
          <li>
            <strong>Global default below</strong> — applied to every email when the field is missing
          </li>
          <li>
            <strong>Hardcoded built-in</strong> (last resort, shown as a placeholder if you don't override)
          </li>
        </ol>
      </div>

      {loading ? (
        <div className="text-[13px] text-muted py-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading current settings…
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {FIELDS.map((f) => (
              <div key={f.key} className="grid grid-cols-[140px_1fr_auto] gap-3 items-center">
                <div>
                  <div className="text-[13px] font-medium text-body">{f.label}</div>
                  <div className="text-[11px] text-[var(--text-faint)] font-mono">{`{{${f.key}}}`}</div>
                </div>
                <Input
                  value={defaults[f.key] || ''}
                  onChange={(e) => updateField(f.key, e.target.value)}
                  placeholder={f.hardcoded ? `default: "${f.hardcoded}"` : '(leave blank for empty)'}
                />
                <span className="text-[11px] text-muted font-mono whitespace-nowrap">
                  {f.example}
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border)]">
            <Button onClick={save} variant="primary" disabled={saving || !dirty}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : <><Save size={14} /> Save defaults</>}
            </Button>
            {saved && <Badge tone="success">Saved</Badge>}
            {dirty && !saving && !saved && <span className="text-[12px] text-muted">Unsaved changes</span>}
          </div>
        </>
      )}
    </Card>
  )
}
