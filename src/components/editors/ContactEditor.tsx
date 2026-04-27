import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Drawer, Field } from '../Drawer'
import { Button, Input, Select } from '../ui'
import { api } from '../../lib/api'
import type { Company, Contact } from '../../lib/types'

export type ContactDraft = Partial<Contact>

export function ContactEditor({
  open,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  open: boolean
  initial?: Contact | null
  companies: Company[]
  onClose: () => void
  onSaved?: (saved: Contact) => void
}) {
  const isEdit = !!initial?.id
  const [draft, setDraft] = useState<ContactDraft>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(
      initial
        ? { ...initial }
        : {
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            title: '',
            companyId: '',
            status: 'Customer',
            state: '',
            linkedinUrl: '',
            tags: '',
          },
    )
  }, [open, initial])

  const set = <K extends keyof Contact>(k: K, v: Contact[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { ...draft }
    if (isEdit && initial?.id) payload.id = initial.id
    const res = isEdit ? await api.contact.update(payload) : await api.contact.create(payload)
    setSaving(false)
    if (res.ok && res.row) onSaved?.(res.row as unknown as Contact)
    else if (res.ok) onSaved?.(draft as Contact)
    onClose()
  }

  const remove = async () => {
    if (!isEdit || !initial?.id) return
    if (!confirm(`Delete ${initial.firstName || ''} ${initial.lastName || ''}?`)) return
    setSaving(true)
    await api.contact.remove(initial.id)
    setSaving(false)
    onClose()
  }

  const canSave = (draft.firstName || '').trim() && (draft.lastName || '').trim() && (draft.email || '').trim()

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.firstName || 'contact'}` : 'New contact'}
      subtitle={isEdit ? 'Changes save back to your Sheet.' : 'A new contact in your CRM.'}
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
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create contact'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required>
          <Input value={draft.firstName || ''} onChange={(e) => set('firstName', e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <Input value={draft.lastName || ''} onChange={(e) => set('lastName', e.target.value)} />
        </Field>
      </div>

      <Field label="Email" required>
        <Input
          type="email"
          value={draft.email || ''}
          onChange={(e) => set('email', e.target.value)}
          placeholder="jane@acme.com"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone">
          <Input value={draft.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Title / Job role">
          <Input value={draft.title || ''} onChange={(e) => set('title', e.target.value)} placeholder="Ops Director" />
        </Field>
      </div>

      <Field label="Company">
        <Select value={draft.companyId || ''} onChange={(e) => set('companyId', e.target.value)}>
          <option value="">— none —</option>
          {companies
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </Select>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={draft.status || ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">— none —</option>
            <option value="Lead">Lead</option>
            <option value="Prospect">Prospect</option>
            <option value="Customer">Customer</option>
            <option value="Partner">Partner</option>
            <option value="Churned">Churned</option>
            <option value="Unsubscribed">Unsubscribed</option>
          </Select>
        </Field>
        <Field label="State / region">
          <Input value={draft.state || ''} onChange={(e) => set('state', e.target.value)} placeholder="CO, KY, OR..." />
        </Field>
      </div>

      <Field label="LinkedIn URL">
        <Input
          value={draft.linkedinUrl || ''}
          onChange={(e) => set('linkedinUrl', e.target.value)}
          placeholder="https://linkedin.com/in/…"
        />
      </Field>

      <Field label="Tags" hint="Comma-separated: vip, q3-demo, partner-prospect">
        <Input
          value={draft.tags || ''}
          onChange={(e) => set('tags', e.target.value)}
          placeholder="vip, partner-prospect"
        />
      </Field>
    </Drawer>
  )
}
