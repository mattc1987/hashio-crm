import { useEffect, useState } from 'react'
import { Phone, MessageSquare, Voicemail, Users as UsersIcon, Link2, FileText } from 'lucide-react'
import { Drawer, Field } from '../Drawer'
import { Button, Input, Textarea, Select } from '../ui'
import { api } from '../../lib/api'
import type { ActivityLog, ActivityLogKind } from '../../lib/types'
import { cn } from '../../lib/cn'

const KIND_OPTIONS: Array<{ value: ActivityLogKind; label: string; icon: React.ReactNode }> = [
  { value: 'call-outbound',    label: 'Outbound call',    icon: <Phone size={13} /> },
  { value: 'call-inbound',     label: 'Inbound call',     icon: <Phone size={13} /> },
  { value: 'voicemail',        label: 'Voicemail',        icon: <Voicemail size={13} /> },
  { value: 'text-outbound',    label: 'Sent text',        icon: <MessageSquare size={13} /> },
  { value: 'text-inbound',     label: 'Received text',    icon: <MessageSquare size={13} /> },
  { value: 'meeting',          label: 'Meeting',          icon: <UsersIcon size={13} /> },
  { value: 'linkedin-message', label: 'LinkedIn message', icon: <Link2 size={13} /> },
  { value: 'other',            label: 'Other',            icon: <FileText size={13} /> },
]

export function LogActivityDrawer({
  open,
  entityType,
  entityId,
  entityLabel,
  onClose,
  onSaved,
}: {
  open: boolean
  entityType: 'contact' | 'company' | 'deal'
  entityId: string
  entityLabel?: string
  onClose: () => void
  onSaved?: () => void
}) {
  const [draft, setDraft] = useState<Partial<ActivityLog>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft({
      kind: 'call-outbound',
      outcome: '',
      body: '',
      durationMinutes: 0,
      occurredAt: new Date().toISOString().slice(0, 16), // for datetime-local input
      author: 'Matt Campbell',
    })
  }, [open])

  const set = <K extends keyof ActivityLog>(k: K, v: ActivityLog[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    await api.activityLog.create({
      entityType,
      entityId,
      kind: draft.kind || 'other',
      outcome: draft.outcome || '',
      body: draft.body || '',
      durationMinutes: draft.durationMinutes || 0,
      occurredAt: draft.occurredAt
        ? new Date(draft.occurredAt).toISOString()
        : new Date().toISOString(),
      author: draft.author || '',
    })
    setSaving(false)
    onSaved?.()
    onClose()
  }

  const showDuration = draft.kind === 'call-outbound' || draft.kind === 'call-inbound' || draft.kind === 'meeting'
  const showOutcome = draft.kind?.startsWith('call') || draft.kind === 'text-outbound' || draft.kind === 'meeting'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Log activity"
      subtitle={entityLabel ? `for ${entityLabel}` : undefined}
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Log it'}
          </Button>
        </>
      }
    >
      <Field label="Type" required>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {KIND_OPTIONS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => set('kind', k.value)}
              className={cn(
                'flex flex-col items-center gap-1 p-2 rounded-[var(--radius-md)] text-[11px] font-medium transition-colors border',
                draft.kind === k.value
                  ? 'bg-[var(--color-brand-600)] text-white border-[var(--color-brand-600)]'
                  : 'surface-2 border-[var(--border)] text-muted hover:text-body',
              )}
            >
              {k.icon}
              <span>{k.label}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="When did this happen?" required>
        <Input
          type="datetime-local"
          value={(draft.occurredAt || '').slice(0, 16)}
          onChange={(e) => set('occurredAt', e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        {showOutcome && (
          <Field label="Outcome">
            <Select
              value={draft.outcome || ''}
              onChange={(e) => set('outcome', e.target.value as ActivityLog['outcome'])}
            >
              <option value="">—</option>
              {draft.kind?.startsWith('call') && (
                <>
                  <option value="connected">Connected</option>
                  <option value="no-answer">No answer</option>
                  <option value="left-voicemail">Left voicemail</option>
                </>
              )}
              {draft.kind === 'text-outbound' && (
                <>
                  <option value="replied">Replied</option>
                  <option value="no-reply">No reply</option>
                </>
              )}
              {draft.kind === 'meeting' && (
                <>
                  <option value="completed">Completed</option>
                  <option value="no-answer">No-show</option>
                </>
              )}
            </Select>
          </Field>
        )}
        {showDuration && (
          <Field label="Duration (min)">
            <Input
              type="number"
              min={0}
              value={draft.durationMinutes ?? 0}
              onChange={(e) => set('durationMinutes', Number(e.target.value) || 0)}
              placeholder="15"
            />
          </Field>
        )}
      </div>

      <Field label="Notes / what happened" hint="What was discussed, key follow-ups, who said what.">
        <Textarea
          value={draft.body || ''}
          onChange={(e) => set('body', e.target.value)}
          rows={5}
          placeholder="Walked through pricing options. They want to talk to their COO and circle back next week."
          autoFocus
        />
      </Field>
    </Drawer>
  )
}
