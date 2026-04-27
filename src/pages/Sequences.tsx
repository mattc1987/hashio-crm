import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Zap, ChevronRight, Mail, Clock, GitBranch, Bolt } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Badge } from '../components/ui'
import { api } from '../lib/api'
import { enrollmentStats, groupStepsBySequence } from '../lib/sequences'
import type { Sequence } from '../lib/types'
import { cn } from '../lib/cn'

const STATUS_TONES: Record<Sequence['status'], 'success' | 'warning' | 'neutral' | 'info'> = {
  active: 'success',
  paused: 'warning',
  archived: 'neutral',
  draft: 'info',
}

type StatusFilter = 'active' | 'all' | 'archived' | 'draft' | 'paused'

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'active',   label: 'Active' },
  { id: 'draft',    label: 'Drafts' },
  { id: 'paused',   label: 'Paused' },
  { id: 'all',      label: 'All' },
  { id: 'archived', label: 'Archived' },
]

export function Sequences() {
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')

  const data = 'data' in state ? state.data : undefined
  const sequences = data?.sequences ?? []
  const sequenceSteps = data?.sequenceSteps ?? []
  const enrollments = data?.enrollments ?? []
  const stepsBySeq = groupStepsBySequence(sequenceSteps)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return sequences.filter((s) => {
      // Status filter:
      //  'all'      → show everything (including archived)
      //  'active'   → default, hides archived + drafts
      //  'archived' → only archived
      //  others     → exact status match
      if (statusFilter === 'all') {
        // nothing to exclude
      } else if (statusFilter === 'active') {
        if (s.status === 'archived' || s.status === 'draft') return false
      } else {
        if (s.status !== statusFilter) return false
      }
      if (!q) return true
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    })
  }, [sequences, query, statusFilter])

  // Counts per bucket so we can show them in the filter chips.
  const counts = useMemo(() => {
    const c = { active: 0, draft: 0, paused: 0, archived: 0, all: sequences.length }
    for (const s of sequences) {
      if (s.status === 'active')   c.active++
      if (s.status === 'draft')    c.draft++
      if (s.status === 'paused')   c.paused++
      if (s.status === 'archived') c.archived++
    }
    return c
  }, [sequences])

  if (!data) {
    return (
      <div>
        <PageHeader title="Sequences" />
        {state.status === 'error' && 'error' in state && (
          <Card>
            <div className="text-[13px] text-muted">
              Couldn't reach the Sheet: <span className="font-mono text-[12px]">{state.error}</span>
            </div>
          </Card>
        )}
      </div>
    )
  }

  const create = async () => {
    if (!newName.trim()) return
    const res = await api.sequence.create({ name: newName.trim(), description: '', status: 'draft' })
    setNewName('')
    setCreating(false)
    // Navigate straight into the editor for the new sequence.
    if (res.row?.id) navigate(`/sequences/${res.row.id}`)
    else refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sequences"
        subtitle={`${sequences.length} total · ${enrollments.filter((e) => e.status === 'active').length} active enrollments`}
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New sequence
          </Button>
        }
      />

      {creating && (
        <Card>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Sequence name, e.g. ‘New lead — 5-day intro’"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') create()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              className="flex-1"
            />
            <Button variant="primary" onClick={create} disabled={!newName.trim()}>Create</Button>
            <Button onClick={() => { setCreating(false); setNewName('') }}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-3 border-soft-b flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Search sequences…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {STATUS_FILTERS.map((f) => {
                const count = counts[f.id]
                const isActive = statusFilter === f.id
                return (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={cn(
                      'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap inline-flex items-center gap-1.5',
                      isActive ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
                    )}
                  >
                    {f.label}
                    <span
                      className={cn(
                        'text-[10px] tabular',
                        isActive ? 'text-white/80' : 'text-[var(--text-faint)]',
                      )}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Zap size={22} />}
            title={
              sequences.length === 0
                ? 'No sequences yet'
                : statusFilter !== 'all' && statusFilter !== 'active'
                ? `No ${statusFilter} sequences`
                : statusFilter === 'active'
                ? 'No active sequences'
                : 'No matches'
            }
            description={
              sequences.length === 0
                ? 'Create your first drip campaign. Sequences send emails over time with logic gates (opened, replied, waited N days).'
                : statusFilter !== 'all'
                ? `Switch to "All" to see your ${sequences.length} other sequence${sequences.length === 1 ? '' : 's'}.`
                : `No sequence matches "${query}".`
            }
            action={
              sequences.length === 0 ? (
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  New sequence
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map((s) => {
              const steps = stepsBySeq[s.id] || []
              const stats = enrollmentStats(s, enrollments)
              return (
                <Link
                  key={s.id}
                  to={`/sequences/${s.id}`}
                  className="flex items-center gap-4 px-4 py-3 hover:surface-2 transition-colors group"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge tone={STATUS_TONES[s.status]}>{s.status}</Badge>
                      <div className="text-[13px] font-medium text-body truncate">{s.name}</div>
                    </div>
                    <div className="text-[11px] text-muted truncate">
                      {steps.length} step{steps.length === 1 ? '' : 's'}
                      {' · '}
                      <StepSummary steps={steps} />
                    </div>
                  </div>
                  <div className="hidden md:flex items-center gap-4 text-[11px] text-muted shrink-0">
                    <Metric label="Active" value={stats.active} tone={stats.active > 0 ? 'success' : undefined} />
                    <Metric label="Completed" value={stats.completed} />
                    <Metric label="Stopped" value={stats.stopped} tone={stats.stopped > 0 ? 'warning' : undefined} />
                  </div>
                  <ChevronRight size={15} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
                </Link>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' }) {
  return (
    <div className="text-center min-w-[44px]">
      <div
        className={cn(
          'font-display text-[13px] font-semibold tabular',
          tone === 'success' && 'text-[var(--color-success)]',
          tone === 'warning' && 'text-[var(--color-warning)]',
        )}
      >
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
    </div>
  )
}

function StepSummary({ steps }: { steps: Array<{ type: string }> }) {
  if (!steps.length) return <span className="italic">empty</span>
  const icons: Record<string, React.ReactNode> = {
    email: <Mail size={10} />,
    wait: <Clock size={10} />,
    branch: <GitBranch size={10} />,
    action: <Bolt size={10} />,
  }
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {steps.slice(0, 8).map((s, i) => (
        <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--text-muted)]">
          {icons[s.type] || '·'}
        </span>
      ))}
      {steps.length > 8 && <span>+{steps.length - 8}</span>}
    </span>
  )
}
