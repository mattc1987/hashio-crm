import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Mail, Phone, MapPin, Building2, Link2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Badge, Avatar, PageHeader, Empty } from '../components/ui'
import { currency, date, monthlyMRR, activeMRRByCompany } from '../lib/format'

export function CompanyDetail() {
  const { id } = useParams()
  const { state } = useSheetData()
  const data = 'data' in state ? state.data : undefined
  if (!data) return <PageHeader title="Company" />

  const { companies, contacts, deals, tasks } = data
  const company = companies.find((c) => c.id === id)
  if (!company) {
    return (
      <div>
        <Link to="/companies" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All companies
        </Link>
        <Empty icon={<Building2 size={22} />} title="Company not found" description={`No company with id ${id}.`} />
      </div>
    )
  }

  const companyContacts = contacts.filter((c) => c.companyId === company.id)
  const companyDeals = deals.filter((d) => d.companyId === company.id)
  const companyTasks = tasks.filter((t) => {
    if (t.dealId && companyDeals.some((d) => d.id === t.dealId)) return true
    if (t.contactId && companyContacts.some((c) => c.id === t.contactId)) return true
    return false
  })
  const mrr = activeMRRByCompany(deals, company.id)
  const lifetimeValue = companyDeals
    .filter((d) => d.stage === 'Closed Won')
    .reduce((s, d) => s + (d.value || 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/companies"
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> All companies
      </Link>

      <div className="flex items-start gap-4">
        <Avatar name={company.name} size={56} className="text-[18px]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-[22px] font-semibold text-body tracking-tight">
              {company.name}
            </h1>
            {mrr > 0 && <Badge tone="success">Active</Badge>}
          </div>
          <div className="text-[13px] text-muted flex items-center flex-wrap gap-x-3 gap-y-1">
            {company.industry && <span>{company.industry}</span>}
            {company.licenseCount && (
              <span>
                {company.licenseCount} license{company.licenseCount === '1' ? '' : 's'}
              </span>
            )}
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-body"
              >
                {company.website.replace(/^https?:\/\//, '')}
                <ExternalLink size={11} />
              </a>
            )}
            {company.address && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} />
                {company.address}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBlock label="Current MRR" value={currency(mrr)} tone={mrr > 0 ? 'success' : undefined} />
        <StatBlock label="Lifetime value" value={currency(lifetimeValue, { compact: true })} />
        <StatBlock label="Contacts" value={companyContacts.length.toString()} />
        <StatBlock label="Deals" value={companyDeals.length.toString()} />
      </div>

      {company.notes && (
        <Card>
          <CardHeader title="Notes" />
          <p className="text-[13px] text-body leading-relaxed whitespace-pre-wrap">{company.notes}</p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b">
            <CardHeader title="Contacts" subtitle={`${companyContacts.length} at ${company.name}`} />
          </div>
          {companyContacts.length === 0 ? (
            <div className="p-8 text-center text-muted text-[13px]">No contacts yet.</div>
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {companyContacts.map((c) => {
                const tags = (c.tags || '').split(/[,|]+/).map((t) => t.trim()).filter(Boolean)
                return (
                  <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar firstName={c.firstName} lastName={c.lastName} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[13px] font-medium text-body truncate">
                          {c.firstName} {c.lastName}
                        </div>
                        {tags.slice(0, 2).map((t) => (
                          <span
                            key={t}
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]"
                          >
                            #{t}
                          </span>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {c.title || <em>No title</em>}
                        {c.status && <> · {c.status}</>}
                        {c.state && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-[var(--text-faint)]">
                            <MapPin size={10} />
                            {c.state}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted">
                      {c.linkedinUrl && (
                        <a
                          href={c.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:text-[#0a66c2]"
                          title="LinkedIn"
                        >
                          <Link2 size={12} />
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1 hover:text-body">
                          <Mail size={11} /> {c.email}
                        </a>
                      )}
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1 hover:text-body">
                          <Phone size={11} /> {c.phone}
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b">
            <CardHeader title="Deals" subtitle={`${companyDeals.length} total`} />
          </div>
          {companyDeals.length === 0 ? (
            <div className="p-8 text-center text-muted text-[13px]">No deals yet.</div>
          ) : (
            <div className="divide-y divide-[color:var(--border)]">
              {companyDeals.map((d) => (
                <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge tone={stageTone(d.stage)}>{d.stage}</Badge>
                      <div className="text-[13px] font-medium text-body truncate">{d.title}</div>
                    </div>
                    <div className="text-[11px] text-muted">
                      {currency(d.value)} · {d.billingCycle || 'monthly'}
                      {d.closeDate && <> · {date(d.closeDate)}</>}
                    </div>
                  </div>
                  {monthlyMRR(d) > 0 && (
                    <div className="text-right">
                      <div className="text-[13px] font-semibold tabular text-body">{currency(monthlyMRR(d))}</div>
                      <div className="text-[10px] uppercase text-muted tracking-wider">/ mo</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {companyTasks.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b">
            <CardHeader title="Tasks" subtitle={`${companyTasks.length} linked`} />
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {companyTasks.map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-body truncate">{t.title}</div>
                  <div className="text-[11px] text-muted">
                    {t.status} · {t.priority}
                    {t.dueDate && <> · due {date(t.dueDate)}</>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function StatBlock({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div
        className={`font-display text-[22px] font-semibold mt-1 tabular ${tone === 'success' ? 'text-[var(--color-success)]' : 'text-body'}`}
      >
        {value}
      </div>
    </Card>
  )
}

function stageTone(stage: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const s = (stage || '').toLowerCase()
  if (s === 'closed won') return 'success'
  if (s === 'closed lost') return 'danger'
  if (s === 'negotiation' || s === 'proposal') return 'warning'
  if (s === 'demo' || s === 'qualified') return 'info'
  return 'neutral'
}
