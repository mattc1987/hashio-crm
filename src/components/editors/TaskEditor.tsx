import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Drawer, Field } from '../Drawer'
import { Button, Input, Textarea, Select } from '../ui'
import { api } from '../../lib/api'
import type { Contact, Deal, Task } from '../../lib/types'

export function TaskEditor({
  open,
  initial,
  contacts,
  deals,
  onClose,
  onSaved,
}: {
  open: boolean
  initial?: Task | null
  contacts: Contact[]
  deals: Deal[]
  onClose: () => void
  onSaved?: (saved: Task) => void
}) {
  const isEdit = !!initial?.id
  const [draft, setDraft] = useState<Partial<Task>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(
      initial
        ? { ...initial }
        : {
            title: '',
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            priority: 'medium',
            contactId: '',
            dealId: '',
            notes: '',
            status: 'open',
          },
    )
  }, [open, initial])

  const set = <K extends keyof Task>(k: K, v: Task[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const save = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = { ...draft }
    if (isEdit && initial?.id) payload.id = initial.id
    const res = isEdit ? await api.task.update(payload) : await api.task.create(payload)
    setSaving(false)
    if (res.ok && res.row) onSaved?.(res.row as unknown as Task)
    else if (res.ok) onSaved?.(draft as Task)
    onClose()
  }

  const remove = async () => {
    if (!isEdit || !initial?.id) return
    if (!confirm(`Delete "${initial.title}"?`)) return
    setSaving(true)
    await api.task.remove(initial.id)
    setSaving(false)
    onClose()
  }

  const canSave = (draft.title || '').trim().length > 0

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit task' : 'New task'}
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
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create task'}
          </Button>
        </>
      }
    >
      <Field label="Title" required>
        <Input
          value={draft.title || ''}
          onChange={(e) => set('title', e.target.value)}
          placeholder="Follow up with Jane"
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Due date">
          <Input
            type="date"
            value={(draft.dueDate || '').slice(0, 10)}
            onChange={(e) => set('dueDate', e.target.value)}
          />
        </Field>
        <Field label="Priority">
          <Select value={draft.priority || 'medium'} onChange={(e) => set('priority', e.target.value as Task['priority'])}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Linked deal">
          <Select value={draft.dealId || ''} onChange={(e) => set('dealId', e.target.value)}>
            <option value="">— none —</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Linked contact">
          <Select value={draft.contactId || ''} onChange={(e) => set('contactId', e.target.value)}>
            <option value="">— none —</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Status">
        <Select value={draft.status || 'open'} onChange={(e) => set('status', e.target.value as Task['status'])}>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </Field>

      <Field label="Notes">
        <Textarea value={draft.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={3} />
      </Field>
    </Drawer>
  )
}
