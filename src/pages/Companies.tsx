import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Building2, ChevronRight, ExternalLink, Sparkles } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Avatar, Badge } from '../components/ui'
import { currency, activeMRRByCompany, billingCycleLabel, isActiveMRR } from '../lib/format'
import type { Company, Deal } from '../lib/types'
import { CompanyEditor } from '../components/editors/CompanyEditor'
import { computeClientHealth, type ClientHealth } from '../lib/clientHealth'
import { HealthDot } from '../components/HealthDot'
import { hasWriteBackend } from '../lib/api'
import { LeadGenerationDrawer } from '../components/dashboard/LeadGenerationDrawer'

export function Companies() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [findLeadsOpen, setFindLeadsOpen] = useState(false)

  const data = 'data' in state ? state.data : undefined
  const companies = data?.companies ?? []
  const contacts = data?.contacts ?? []
  const deals = data?.deals ?? []
  const tasks = data?.tasks ?? []
  const activity = data?.activity ?? []
  const emailSends = data?.emailSends ?? []
  const bookings = data?.bookings ?? []

  const withMRR = useMemo(
    () =>
      companies.map((c) => {
        const companyDeals = deals.filter((d) => d.companyId === c.id)
        const activeDeals = companyDeals.filter(isActiveMRR)
        // Pick the dominant billing cycle for display (if there's only one,
        // we surface it; if mixed, we say "mixed").
        const cycles = Array.from(new Set(activeDeals.map((d) => d.billingCycle).filter(Boolean)))
        const billingCycle =
          cycles.length === 0 ? '' :
          cycles.length === 1 ? cycles[0] :
          'mixed'
        const health = computeClientHealth(c, { deals, tasks, activity, emailSends, bookings, contacts })
        return {
          company: c,
          mrr: activeMRRByCompany(deals, c.id),
          contactCount: contacts.filter((ct) => ct.companyId === c.id).length,
          dealCount: companyDeals.length,
          billingCycle,
          health,
        }
      }),
    [companies, contacts, deals, tasks, activity, emailSends, bookings],
  )

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return withMRR
      .filter((r) => !activeOnly || r.mrr > 0)
      .filter((r) => {
        if (!q) return true
        return (
          r.company.name.toLowerCase().includes(q) ||
          r.company.industry.toLowerCase().includes(q) ||
          r.company.notes.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => b.mrr - a.mrr || a.company.name.localeCompare(b.company.name))
  }, [withMRR, query, activeOnly])

  if (!data) return <PageHeader title="Companies" />

  const totalMRR = withMRR.reduce((s, r) => s + r.mrr, 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Companies"
        subtitle={`${companies.length} companies · ${currency(totalMRR)}/mo total MRR`}
        action={
          <div className="flex items-center gap-2">
            {hasWriteBackend() && (
              <Button
                variant="secondary"
                icon={<Sparkles size={13} />}
                onClick={() => setFindLeadsOpen(true)}
              >
                Find leads
              </Button>
            )}
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              New company
            </Button>
          </div>
        }
      />

      <Card padded={false}>
        <div className="flex items-center gap-3 p-3 border-soft-b">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              placeholder="Search companies…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <label className="flex items-center gap-2 text-[12px] text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e) => setActiveOnly(e.target.checked)}
              className="accent-[var(--color-brand-600)]"
            />
            Active MRR only
          </label>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Building2 size={22} />}
            title="No companies found"
            description={query ? `No matches for "${query}".` : 'Add your first company to get started.'}
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map(({ company, mrr, contactCount, dealCount, billingCycle, health }) => (
              <CompanyRow
                key={company.id}
                company={company}
                mrr={mrr}
                contactCount={contactCount}
                dealCount={dealCount}
                billingCycle={billingCycle}
                health={health}
              />
            ))}
          </div>
        )}
      </Card>

      <CompanyEditor
        open={creating}
        initial={null}
        onClose={() => setCreating(false)}
        onSaved={() => refresh()}
      />

      {data && (
        <LeadGenerationDrawer
          open={findLeadsOpen}
          onClose={() => setFindLeadsOpen(false)}
          data={data}
        />
      )}
    </div>
  )
}

function CompanyRow({
  company,
  mrr,
  contactCount,
  dealCount,
  billingCycle,
  health,
}: {
  company: Company
  mrr: number
  contactCount: number
  dealCount: number
  billingCycle: string
  health: ClientHealth
}) {
  const cycleLabel =
    billingCycle === 'mixed'
      ? 'mixed billing'
      : billingCycle
      ? billingCycleLabel(billingCycle as Deal['billingCycle'])
      : ''
  return (
    <Link
      to={`/companies/${company.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:surface-2 transition-colors group"
    >
      <HealthDot tier={health.tier} reason={health.reason} size={9} />
      <Avatar name={company.name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[13px] font-medium text-body truncate">{company.name}</div>
          {mrr > 0 && <Badge tone="success">Active</Badge>}
        </div>
        <div className="text-[11px] text-muted truncate mt-0.5">
          {company.industry || '—'}
          {company.licenseCount && <> · {company.licenseCount} license{company.licenseCount === '1' ? '' : 's'}</>}
          {' · '}
          {contactCount} contact{contactCount === 1 ? '' : 's'}
          {' · '}
          {dealCount} deal{dealCount === 1 ? '' : 's'}
          {health.daysSinceLastTouch !== null && health.tier !== 'inactive' && (
            <span className="text-[var(--text-faint)]"> · last touch {health.daysSinceLastTouch}d</span>
          )}
        </div>
      </div>
      {company.website && (
        <a
          href={company.website}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="hidden md:inline-flex items-center gap-1 text-[11px] text-muted hover:text-body"
        >
          <ExternalLink size={12} />
        </a>
      )}
      <div className="text-right shrink-0 w-32">
        {mrr > 0 ? (
          <>
            <div className="font-display text-[13px] font-semibold tabular text-body">{currency(mrr)}</div>
            <div className="text-[10px] text-muted uppercase tracking-wider">/ mo</div>
            {cycleLabel && (
              <div className="text-[10px] text-[var(--text-faint)] mt-0.5 truncate">{cycleLabel}</div>
            )}
          </>
        ) : (
          <div className="text-[11px] text-[var(--text-faint)]">—</div>
        )}
      </div>
      <ChevronRight size={15} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
    </Link>
  )
}
