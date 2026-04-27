import { useMemo, useState } from 'react'
import { Plus, Search, Briefcase, ChevronRight } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Badge, Button, Input, PageHeader, Empty, Skeleton } from '../components/ui'
import { currency, date, monthlyMRR } from '../lib/format'
import type { Deal } from '../lib/types'
import { cn } from '../lib/cn'
import { DealEditor } from '../components/editors/DealEditor'

const PIPELINE_STAGES = ['Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won']

export function Deals() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('all')
  const [editing, setEditing] = useState<Deal | null>(null)
  const [creating, setCreating] = useState(false)

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
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New deal
          </Button>
        }
      />

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
