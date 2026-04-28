import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Building2, Briefcase, Phone, Pencil, ExternalLink,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Avatar, Badge, PageHeader, Empty, Button } from '../components/ui'
import { ActivityFeed } from '../components/ActivityFeed'
import { NotesSection } from '../components/NotesSection'
import { DealEditor } from '../components/editors/DealEditor'
import { LogActivityDrawer } from '../components/editors/LogActivityDrawer'
import { date, currency, monthlyMRR, billingCycleLabel } from '../lib/format'

const STAGE_COLORS: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  Lead: 'neutral',
  Qualified: 'info',
  Demo: 'info',
  Proposal: 'warning',
  Negotiation: 'warning',
  'Closed Won': 'success',
  'Closed Lost': 'danger',
}

export function DealDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, refresh } = useSheetData()
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)

  const data = 'data' in state ? state.data : undefined
  if (!data) return <PageHeader title="Deal" />

  const deal = data.deals.find((d) => d.id === id)
  if (!deal) {
    return (
      <div>
        <Link to="/deals" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All deals
        </Link>
        <Empty title="Deal not found" />
      </div>
    )
  }

  const company = data.companies.find((c) => c.id === deal.companyId)
  const contact = data.contacts.find((c) => c.id === deal.contactId)
  const tasks = data.tasks.filter((t) => t.dealId === deal.id)

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/deals"
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> All deals
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <div className="w-16 h-16 rounded-[var(--radius-lg)] grid place-items-center bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
          <Briefcase size={26} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="font-display text-[22px] font-semibold text-body tracking-tight">
              {deal.title}
            </h1>
            <Badge tone={STAGE_COLORS[deal.stage] || 'neutral'}>{deal.stage}</Badge>
          </div>
          <div className="text-[13px] text-muted flex items-center flex-wrap gap-x-3 gap-y-1">
            {company && (
              <Link to={`/companies/${company.id}`} className="hover:text-body inline-flex items-center gap-1">
                <Building2 size={12} />
                {company.name}
              </Link>
            )}
            {contact && (
              <Link to={`/contacts/${contact.id}`} className="hover:text-body inline-flex items-center gap-1">
                <Avatar firstName={contact.firstName} lastName={contact.lastName} size={16} />
                {contact.firstName} {contact.lastName}
              </Link>
            )}
            {deal.closeDate && (
              <span>Close target {date(deal.closeDate, 'MMM d, yyyy')}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button icon={<Phone size={13} />} onClick={() => setLogging(true)}>Log activity</Button>
          <Button variant="primary" icon={<Pencil size={13} />} onClick={() => setEditing(true)}>Edit</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="ACV" value={currency(deal.value, { compact: true })} />
        <StatCard
          label="MRR"
          value={monthlyMRR(deal) > 0 ? currency(monthlyMRR(deal)) : '—'}
          hint={deal.billingCycle ? billingCycleLabel(deal.billingCycle) : undefined}
        />
        <StatCard label="Probability" value={`${deal.probability || 0}%`} />
        <StatCard label="Expected close" value={deal.closeDate ? date(deal.closeDate, 'MMM yyyy') : '—'} />
      </div>

      {/* Notes */}
      {deal.notes && (
        <Card>
          <CardHeader title="Notes (deal-level)" />
          <p className="text-[13px] text-body whitespace-pre-wrap leading-relaxed">{deal.notes}</p>
        </Card>
      )}

      {/* Tasks */}
      {tasks.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b">
            <CardHeader title="Tasks" subtitle={`${tasks.length} linked`} />
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {tasks.map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  t.priority === 'high' ? 'bg-[var(--color-warning)]' :
                  t.status === 'completed' ? 'bg-[var(--color-success)]' :
                  'bg-[var(--text-faint)]'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted">
                    {t.status} {t.dueDate && <>· due {date(t.dueDate, 'MMM d')}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Notes feed + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NotesSection entityType="deal" entityId={deal.id} />
        <ActivityFeed entityType="deal" entityId={deal.id} />
      </div>

      <DealEditor
        open={editing}
        initial={deal}
        companies={data.companies}
        contacts={data.contacts}
        onClose={() => setEditing(false)}
        onSaved={() => refresh()}
      />
      <LogActivityDrawer
        open={logging}
        entityType="deal"
        entityId={deal.id}
        entityLabel={deal.title}
        onClose={() => setLogging(false)}
        onSaved={() => refresh()}
      />
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div className="font-display text-[20px] font-semibold tabular text-body mt-1">{value}</div>
      {hint && <div className="text-[11px] text-muted mt-0.5">{hint}</div>}
    </Card>
  )
}

void ExternalLink
