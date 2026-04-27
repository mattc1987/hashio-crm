import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Drawer, Field } from '../Drawer'
import { Button, Input, Textarea, Select } from '../ui'
import { api } from '../../lib/api'
import type { Company, Contact, Deal } from '../../lib/types'

const STAGES = ['Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost']

export function DealEditor({
  open,
  initial,
  companies,
  contacts,
  onClose,
  onSaved,
}: {
  open: boolean
  initial?: Deal | null
  companies: Company[]
  contacts: Contact[]
  onClose: () => void
  onSaved?: (saved: Deal) => void
}) {
  const isEdit = !!initial?.id
  const [draft, setDraft] = useState<Partial<Deal>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(
      initial
        ? { ...initial }
        : {
            title: '',
            companyId: '',
            contactId: '',
            value: 0,
            stage: 'Lead',
            mrr: 0,
            billingCycle: 'monthly',
            probability: 10,
            closeDate: '',
            notes: '',
          },
    )
  }, [open, initial])

  const set = <K extends keyof Deal>(k: K, v: Deal[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { ...draft }
    if (isEdit && initial?.id) payload.id = initial.id
    const res = isEdit ? await api.deal.update(payload) : await api.deal.create(payload)
    setSaving(false)
    if (res.ok && res.row) onSaved?.(res.row as unknown as Deal)
    else if (res.ok) onSaved?.(draft as Deal)
    onClose()
  }

  const remove = async () => {
    if (!isEdit || !initial?.id) return
    if (!confirm(`Delete "${initial.title}"?`)) return
    setSaving(true)
    await api.deal.remove(initial.id)
    setSaving(false)
    onClose()
  }

  const canSave = (draft.title || '').trim().length > 0

  // Contacts filtered by the selected company
  const relevantContacts = draft.companyId
    ? contacts.filter((c) => c.companyId === draft.companyId)
    : contacts

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.title || 'deal'}` : 'New deal'}
      subtitle={isEdit ? 'Changes save back to your Sheet.' : 'Start a new sales opportunity.'}
      footer={
        <>
          {isEdit && (
            <Button variant="danger" icon={<Trash2 size={13} />} onClick={remove} disabled={saving}>
              Delete
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!canSave || saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create deal'}
          </Button>
        </>
      }
    >
      <Field label="Title" required>
        <Input
          value={draft.title || ''}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Acme — HashIO License"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Company">
          <Select value={draft.companyId || ''} onChange={(e) => set('companyId', e.target.value)}>
            <option value="">— none —</option>
            {companies.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Primary contact">
          <Select value={draft.contactId || ''} onChange={(e) => set('contactId', e.target.value)}>
            <option value="">— none —</option>
            {relevantContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Stage">
          <Select value={draft.stage || ''} onChange={(e) => set('stage', e.target.value)}>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Probability %">
          <Input
            type="number"
            min={0}
            max={100}
            value={draft.probability ?? 0}
            onChange={(e) => set('probability', Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Value (annual $)">
          <Input
            type="number"
            min={0}
            value={draft.value ?? 0}
            onChange={(e) => set('value', Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="MRR ($/mo)">
          <Input
            type="number"
            min={0}
            value={draft.mrr ?? 0}
            onChange={(e) => set('mrr', Number(e.target.value) || 0)}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Billing cycle">
          <Select
            value={draft.billingCycle || 'monthly'}
            onChange={(e) => set('billingCycle', e.target.value as Deal['billingCycle'])}
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </Select>
        </Field>
        <Field label="Expected close date">
          <Input
            type="date"
            value={(draft.closeDate || '').slice(0, 10)}
            onChange={(e) => set('closeDate', e.target.value ? new Date(e.target.value).toISOString() : '')}
          />
        </Field>
      </div>

      <Field label="Notes">
        <Textarea value={draft.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={3} />
      </Field>
    </Drawer>
  )
}
