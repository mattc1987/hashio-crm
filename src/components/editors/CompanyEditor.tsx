import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Drawer, Field } from '../Drawer'
import { Button, Input, Textarea } from '../ui'
import { api } from '../../lib/api'
import type { Company } from '../../lib/types'

export function CompanyEditor({
  open,
  initial,
  onClose,
  onSaved,
}: {
  open: boolean
  initial?: Company | null
  onClose: () => void
  onSaved?: (saved: Company) => void
}) {
  const isEdit = !!initial?.id
  const [draft, setDraft] = useState<Partial<Company>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(initial ? { ...initial } : { name: '', industry: 'Cultivation', website: '', address: '', size: '', licenseCount: '', notes: '' })
  }, [open, initial])

  const set = <K extends keyof Company>(k: K, v: Company[K]) =>
    setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { ...draft }
    if (isEdit && initial?.id) payload.id = initial.id
    const res = isEdit ? await api.company.update(payload) : await api.company.create(payload)
    setSaving(false)
    if (res.ok && res.row) onSaved?.(res.row as unknown as Company)
    else if (res.ok) onSaved?.(draft as Company)
    onClose()
  }

  const remove = async () => {
    if (!isEdit || !initial?.id) return
    if (!confirm(`Delete ${initial.name}?`)) return
    setSaving(true)
    await api.company.remove(initial.id)
    setSaving(false)
    onClose()
  }

  const canSave = (draft.name || '').trim().length > 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${initial?.name || 'company'}` : 'New company'}
      subtitle={isEdit ? 'Changes save back to your Sheet.' : 'Add a new account to your CRM.'}
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
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create company'}
          </Button>
        </>
      }
    >
      <Field label="Name" required>
        <Input value={draft.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="Acme Cultivation, LLC" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Industry / Vertical">
          <Input value={draft.industry || ''} onChange={(e) => set('industry', e.target.value)} placeholder="Cultivation" />
        </Field>
        <Field label="License count">
          <Input value={draft.licenseCount || ''} onChange={(e) => set('licenseCount', e.target.value)} placeholder="1" />
        </Field>
      </div>
      <Field label="Website">
        <Input value={draft.website || ''} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Address">
        <Input value={draft.address || ''} onChange={(e) => set('address', e.target.value)} placeholder="Denver, CO" />
      </Field>
      <Field label="Size">
        <Input value={draft.size || ''} onChange={(e) => set('size', e.target.value)} placeholder="SMB / Mid-market / Enterprise" />
      </Field>
      <Field label="Notes">
        <Textarea value={draft.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={4} />
      </Field>
    </Drawer>
  )
}
