import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Avatar, Card, CardHeader, Button, Textarea } from './ui'
import { api } from '../lib/api'
import { relativeDate } from '../lib/format'
import { cn } from '../lib/cn'
import type { NoteEntityType } from '../lib/types'

export function NotesSection({
  entityType,
  entityId,
  className,
}: {
  entityType: NoteEntityType
  entityId: string
  className?: string
}) {
  const { state, refresh } = useSheetData()
  const data = 'data' in state ? state.data : undefined
  const allNotes = data?.notes ?? []

  const notes = allNotes
    .filter((n) => n.entityType === entityType && n.entityId === entityId)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))

  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const add = async () => {
    if (!draft.trim()) return
    setSaving(true)
    await api.note.create({
      entityType,
      entityId,
      body: draft.trim(),
      author: 'Matt Campbell',
    })
    setDraft('')
    setSaving(false)
    refresh()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this note?')) return
    await api.note.remove(id)
    refresh()
  }

  return (
    <Card padded={false} className={className}>
      <div className="px-5 py-4 border-soft-b">
        <CardHeader title="Notes" subtitle={`${notes.length} note${notes.length === 1 ? '' : 's'}`} />
      </div>

      <div className="p-4 border-soft-b">
        <div className="flex items-start gap-3">
          <Avatar firstName="Matt" lastName="C" size={32} />
          <div className="flex-1 min-w-0">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Quick note — what just happened with this account?"
              rows={2}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add()
              }}
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-[11px] text-[var(--text-faint)]">
                ⌘+Enter to save
              </span>
              <Button
                size="sm"
                variant="primary"
                icon={<Plus size={12} />}
                onClick={add}
                disabled={!draft.trim() || saving}
              >
                {saving ? 'Adding…' : 'Add note'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {notes.length > 0 ? (
        <ul className="divide-y divide-[color:var(--border)]">
          {notes.map((n) => (
            <li key={n.id} className={cn('px-5 py-3 flex items-start gap-3 group')}>
              <Avatar name={n.author} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-body">{n.author || 'Anonymous'}</span>
                  <span className="text-[11px] text-[var(--text-faint)]">{relativeDate(n.createdAt)}</span>
                </div>
                <p className="text-[13px] text-body mt-0.5 whitespace-pre-wrap leading-relaxed">{n.body}</p>
              </div>
              <button
                onClick={() => remove(n.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-faint)] hover:text-[var(--color-danger)]"
                title="Delete note"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-6 text-center text-[12px] text-muted">
          No notes yet — add one above.
        </div>
      )}
    </Card>
  )
}
