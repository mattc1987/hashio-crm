import { useMemo, useState } from 'react'
import { Plus, Search, Briefcase, ChevronRight, List, LayoutGrid } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Badge, Button, Input, PageHeader, Empty, Skeleton } from '../components/ui'
import { currency, date, monthlyMRR } from '../lib/format'
import type { Deal } from '../lib/types'
import { cn } from '../lib/cn'
import { DealEditor } from '../components/editors/DealEditor'
import { api } from '../lib/api'

const PIPELINE_STAGES = ['Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won']

type DealView = 'list' | 'kanban'

export function Deals() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Deal | null>(null)
  const [creating, setCreating] = useState(false)
  const [view, setView] = useState<DealView>(() => {
    return (localStorage.getItem('hashio-deals-view') as DealView) || 'list'
  })

  const setViewPersistent = (v: DealView) => {
    setView(v)
    localStorage.setItem('hashio-deals-view', v)
  }

  const data = 'data' in state ? state.data : undefined
  const deals = data?.deals ?? []
  const companies = data?.companies ?? []
  const contacts = data?.contacts ?? []
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || '—'
  const contactName = (id: string) => {
    const c = contacts.find((x) => x.id === id)
    return c ? `${c.firstName} ${c.lastName}`.trim() : ''
  }

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return deals.filter((d) => {
      if (stageFilter !== 'all' && d.stage !== stageFilter) return false
      if (!q) return true
      return (
        d.title.toLowerCase().includes(q) ||
        companyName(d.companyId).toLowerCase().includes(q) ||
        contactName(d.contactId).toLowerCase().includes(q)
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, query, stageFilter, companies, contacts])

  if (!data && state.status === 'loading') {
    return (
      <div>
        <PageHeader title="Deals" />
        <Card>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 my-2" />
          ))}
        </Card>
      </div>
    )
  }
  if (!data) return <PageHeader title="Deals" />

  const totalOpen = deals.filter((d) => !d.stage.toLowerCase().startsWith('closed')).reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Deals"
        subtitle={`${deals.length} total · ${currency(totalOpen, { compact: true })} in open pipeline`}
        action={
          <div className="flex items-center gap-1.5">
            <div className="surface-2 border-soft rounded-[var(--radius-md)] p-0.5 flex items-center">
              <button
                onClick={() => setViewPersistent('list')}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                  view === 'list' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
                )}
              >
                <List size={13} /> List
              </button>
              <button
                onClick={() => setViewPersistent('kanban')}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                  view === 'kanban' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
                )}
              >
                <LayoutGrid size={13} /> Kanban
              </button>
            </div>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              New deal
            </Button>
          </div>
        }
      />

      {view === 'list' ? (
        <Card padded={false}>
          <div className="flex items-center gap-2 p-3 border-soft-b">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Search deals, companies, contacts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <FilterChip active={stageFilter === 'all'} onClick={() => setStageFilter('all')}>
                All
              </FilterChip>
              {PIPELINE_STAGES.map((s) => (
                <FilterChip key={s} active={stageFilter === s} onClick={() => setStageFilter(s)}>
                  {s}
                </FilterChip>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <Empty
              icon={<Briefcase size={22} />}
              title="No deals match"
              description={query ? `No results for "${query}".` : 'Try a different stage filter.'}
            />
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {filtered.map((d) => (
                <DealRow
                  key={d.id}
                  deal={d}
                  companyName={companyName(d.companyId)}
                  contactName={contactName(d.contactId)}
                  onClick={() => setEditing(d)}
                />
              ))}
            </div>
          )}
        </Card>
      ) : (
        <KanbanBoard
          deals={deals}
          companyName={companyName}
          onEdit={setEditing}
          onMove={(dealId, newStage) => {
            api.deal.update({ id: dealId, stage: newStage })
            // Local cache reactivity handles re-render; refresh syncs Sheet
            void refresh
          }}
        />
      )}

      <DealEditor
        open={creating || !!editing}
        initial={editing}
        companies={companies}
        contacts={contacts}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={() => refresh()}
      />
    </div>
  )
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] whitespace-nowrap transition-colors',
        active
          ? 'bg-[var(--color-brand-600)] text-white'
          : 'surface-2 text-muted hover:text-body',
      )}
    >
      {children}
    </button>
  )
}

function DealRow({
  deal,
  companyName,
  contactName,
  onClick,
}: {
  deal: Deal
  companyName: string
  contactName: string
  onClick: () => void
}) {
  const tone = stageTone(deal.stage)
  const mrr = monthlyMRR(deal)
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3 hover:surface-2 transition-colors group w-full text-left"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge tone={tone}>{deal.stage || '—'}</Badge>
          <div className="text-[13px] font-medium text-body truncate">{deal.title}</div>
        </div>
        <div className="text-[12px] text-muted truncate">
          {companyName}
          {contactName && <> · {contactName}</>}
          {deal.closeDate && <> · close {date(deal.closeDate, 'MMM d, yyyy')}</>}
        </div>
      </div>
      <div className="hidden sm:block text-right shrink-0 w-28">
        <div className="font-display text-[13px] font-semibold tabular text-body">
          {currency(deal.value, { compact: true })}
        </div>
        {mrr > 0 && <div className="text-[11px] text-muted tabular">{currency(mrr)}/mo</div>}
      </div>
      <ChevronRight size={15} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
    </button>
  )
}

function stageTone(stage: string): 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' {
  const s = (stage || '').toLowerCase()
  if (s === 'closed won') return 'success'
  if (s === 'closed lost') return 'danger'
  if (s === 'negotiation' || s === 'proposal') return 'warning'
  if (s === 'demo' || s === 'qualified') return 'info'
  return 'neutral'
}

/* ==========================================================================
   Kanban board
   ========================================================================== */

const KANBAN_STAGES = ['Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won']

function KanbanBoard({
  deals,
  companyName,
  onEdit,
  onMove,
}: {
  deals: Deal[]
  companyName: (id: string) => string
  onEdit: (deal: Deal) => void
  onMove: (dealId: string, newStage: string) => void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)

  const dealsByStage = useMemo(() => {
    const map = new Map<string, Deal[]>()
    KANBAN_STAGES.forEach((s) => map.set(s, []))
    for (const d of deals) {
      const stage = KANBAN_STAGES.includes(d.stage) ? d.stage : null
      if (stage) map.get(stage)!.push(d)
    }
    return map
  }, [deals])

  return (
    <div className="overflow-x-auto -mx-4 lg:-mx-8 px-4 lg:px-8 pb-4">
      <div className="flex gap-3 min-w-max">
        {KANBAN_STAGES.map((stage) => {
          const stageDeals = dealsByStage.get(stage) || []
          const totalValue = stageDeals.reduce((s, d) => s + (d.value || 0), 0)
          const isOver = overStage === stage
          return (
            <div
              key={stage}
              onDragOver={(e) => { e.preventDefault(); setOverStage(stage) }}
              onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
              onDrop={(e) => {
                e.preventDefault()
                if (draggedId) {
                  onMove(draggedId, stage)
                  setDraggedId(null)
                  setOverStage(null)
                }
              }}
              className={cn(
                'w-[280px] shrink-0 rounded-[var(--radius-lg)] flex flex-col transition-colors',
                isOver ? 'bg-[color:rgba(122,94,255,0.08)] outline outline-2 outline-[var(--color-brand-400)]' : 'surface-2',
              )}
            >
              {/* Column header */}
              <div className="px-4 py-3 border-soft-b flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge tone={stageTone(stage)}>{stage}</Badge>
                  <span className="text-[11px] text-muted">
                    {stageDeals.length} · {currency(totalValue, { compact: true })}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-[120px]">
                {stageDeals.length === 0 ? (
                  <div className="text-center text-[11px] text-[var(--text-faint)] py-6">
                    Drop deals here
                  </div>
                ) : (
                  stageDeals.map((d) => (
                    <KanbanCard
                      key={d.id}
                      deal={d}
                      companyName={companyName(d.companyId)}
                      onEdit={() => onEdit(d)}
                      onDragStart={() => setDraggedId(d.id)}
                      onDragEnd={() => { setDraggedId(null); setOverStage(null) }}
                      isDragging={draggedId === d.id}
                    />
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({
  deal,
  companyName,
  onEdit,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  deal: Deal
  companyName: string
  onEdit: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const mrr = monthlyMRR(deal)
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onEdit}
      className={cn(
        'surface border-soft rounded-[var(--radius-md)] p-3 cursor-pointer hover:shadow-soft-sm transition-all',
        isDragging && 'opacity-50',
      )}
    >
      <div className="text-[12px] font-medium text-body line-clamp-2 leading-snug">{deal.title}</div>
      <div className="text-[11px] text-muted mt-1.5 truncate">{companyName}</div>
      <div className="flex items-center justify-between mt-2">
        <div className="font-display text-[13px] font-semibold tabular text-body">
          {currency(deal.value, { compact: true })}
        </div>
        {mrr > 0 && (
          <div className="text-[10px] text-[var(--text-faint)] tabular">
            {currency(mrr)}/mo
          </div>
        )}
      </div>
      {deal.closeDate && (
        <div className="text-[10px] text-[var(--text-faint)] mt-1">
          Close {date(deal.closeDate, 'MMM d')}
        </div>
      )}
    </div>
  )
}
