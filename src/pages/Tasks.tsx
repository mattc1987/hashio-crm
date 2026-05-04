import { useMemo, useState } from 'react'
import { Plus, Search, CheckSquare, Sparkles } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Badge } from '../components/ui'
import { date } from '../lib/format'
import { cn } from '../lib/cn'
import type { Task } from '../lib/types'
import { api } from '../lib/api'
import { TaskEditor } from '../components/editors/TaskEditor'
import { AIBdrDrawer } from '../components/AIBdrDrawer'
import { hasWriteBackend } from '../lib/api'

export function Tasks() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'open' | 'all' | 'done'>('open')
  const [locallyDone, setLocallyDone] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)

  const data = 'data' in state ? state.data : undefined
  const tasks = data?.tasks ?? []
  const deals = data?.deals ?? []
  const contacts = data?.contacts ?? []

  const dealTitle = (id: string) => deals.find((d) => d.id === id)?.title || ''
  const contactName = (id: string) => {
    const c = contacts.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName}`.trim() : ''
  }

  const toggle = async (task: Task) => {
    const nextDone = !isDone(task, locallyDone)
    setLocallyDone((cur) => {
      const next = new Set(cur)
      if (nextDone) next.add(task.id)
      else next.delete(task.id)
      return next
    })
    await api.task.update({ id: task.id, status: nextDone ? 'completed' : 'open' })
    refresh()
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return tasks
      .filter((t) => {
        const done = isDone(t, locallyDone)
        if (filter === 'open' && done) return false
        if (filter === 'done' && !done) return false
        if (!q) return true
        return (
          t.title.toLowerCase().includes(q) ||
          dealTitle(t.dealId).toLowerCase().includes(q) ||
          contactName(t.contactId).toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, query, filter, locallyDone, deals, contacts])

  if (!data) return <PageHeader title="Tasks" />

  const openCount = tasks.filter((t) => !isDone(t, locallyDone)).length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tasks"
        subtitle={`${openCount} open · ${tasks.length} total`}
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New task
          </Button>
        }
      />

      <Card padded={false}>
        <div className="flex items-center gap-3 p-3 border-soft-b">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              placeholder="Search tasks…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {(['open', 'all', 'done'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] transition-colors',
                  filter === f ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
                )}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<CheckSquare size={22} />}
            title="Nothing here"
            description={filter === 'open' ? 'No open tasks. You\'re all caught up.' : 'No matching tasks.'}
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map((t) => {
              const done = isDone(t, locallyDone)
              return (
                <div
                  key={t.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3 hover:surface-2 transition-colors',
                    done && 'opacity-55',
                  )}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggle(t) }}
                    className={cn(
                      'w-5 h-5 mt-0.5 rounded-full border-2 shrink-0 transition-all grid place-items-center',
                      done
                        ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]'
                        : 'border-[var(--border-strong)] hover:border-[var(--color-brand-500)]',
                    )}
                    aria-label={done ? 'Mark open' : 'Mark complete'}
                  >
                    {done && (
                      <svg viewBox="0 0 12 12" className="w-3 h-3 text-white">
                        <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => setEditing(t)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={cn('text-[13px] font-medium text-body', done && 'line-through')}>
                        {t.title}
                      </div>
                      {t.priority && (
                        <Badge tone={t.priority === 'high' ? 'danger' : t.priority === 'low' ? 'neutral' : 'warning'}>
                          {t.priority}
                        </Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 truncate">
                      {t.dueDate ? `Due ${date(t.dueDate)}` : 'No due date'}
                      {t.dealId && <> · {dealTitle(t.dealId)}</>}
                      {t.contactId && <> · {contactName(t.contactId)}</>}
                    </div>
                    {t.notes && (
                      <div className="text-[11px] text-muted mt-1 line-clamp-2 leading-relaxed whitespace-pre-wrap">
                        {t.notes}
                      </div>
                    )}
                  </button>
                  {hasWriteBackend() && !done && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setAiTask(t) }}
                      className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-full bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] hover:bg-[color:rgba(122,94,255,0.2)] transition-colors"
                      title="Ask AI BDR for the next move"
                    >
                      <Sparkles size={11} /> AI BDR
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <TaskEditor
        open={creating || !!editing}
        initial={editing}
        contacts={contacts}
        deals={deals}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={() => refresh()}
      />

      <AIBdrDrawer
        open={!!aiTask}
        onClose={() => setAiTask(null)}
        entity={aiTask ? { kind: 'task', task: aiTask } : null}
        data={data}
        goal="Look at this task in context. What's the single best next move? Consider whether the task is still relevant, whether to email/call/wait, and draft any message you'd send."
        onApplied={() => { setAiTask(null); refresh() }}
      />
    </div>
  )
}

function isDone(t: Task, locallyDone: Set<string>): boolean {
  if (locallyDone.has(t.id)) return true
  return t.status === 'completed' || t.status === 'cancelled'
}
