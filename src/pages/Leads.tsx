import { useMemo, useState } from 'react'
import {
  Search, Flame, Snowflake, Coffee, Mountain,
  Users as UsersIcon, Building2, Link2, ExternalLink, ChevronRight,
  ArrowDownUp, ArrowDown, ArrowUp, Zap, UserPlus, Archive, X, Sparkles, Plus,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import {
  Card, Button, Input, PageHeader, Empty, Avatar, Badge, Stat,
} from '../components/ui'
import {
  parseSignals, temperatureColor, temperatureEmoji, temperatureLabel, scoreLead,
} from '../lib/leadScoring'
import { relativeDate } from '../lib/format'
import { api, hasWriteBackend } from '../lib/api'
import type { Lead, LeadStatus, LeadTemperature } from '../lib/types'
import { cn } from '../lib/cn'
import { AIBdrDrawer } from '../components/AIBdrDrawer'
import { LeadGenerationDrawer } from '../components/dashboard/LeadGenerationDrawer'

type LeadView = 'contacts' | 'companies'
type SortKey = 'score' | 'lastSignal' | 'created' | 'name'

const TEMPERATURES: LeadTemperature[] = ['molten', 'hot', 'warm', 'cold']
const STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'archived']

export function Leads() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [view, setView] = useState<LeadView>('contacts')
  const [tempFilter, setTempFilter] = useState<LeadTemperature | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'open'>('open')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [aiLead, setAiLead] = useState<Lead | null>(null)
  const [findLeadsOpen, setFindLeadsOpen] = useState(false)

  const data = 'data' in state ? state.data : undefined
  const leads = data?.leads ?? []
  const sequences = (data?.sequences ?? []).filter((s) => s.status !== 'archived')

  // Re-score in case data changed since last persist
  const scoredLeads = useMemo(() => {
    const now = new Date()
    return leads.map((l) => {
      const result = scoreLead(l, now)
      return {
        ...l,
        score: result.score,
        temperature: result.temperature,
      }
    })
  }, [leads])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    let result = scoredLeads.filter((l) => {
      if (tempFilter !== 'all' && l.temperature !== tempFilter) return false
      if (statusFilter === 'open') {
        if (l.status === 'archived' || l.status === 'converted') return false
      } else if (l.status !== statusFilter) return false
      if (!q) return true
      return (
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.email.toLowerCase().includes(q) ||
        l.companyName.toLowerCase().includes(q) ||
        l.headline.toLowerCase().includes(q) ||
        l.title.toLowerCase().includes(q)
      )
    })

    // Sort
    result = result.slice().sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'score':      cmp = a.score - b.score; break
        case 'lastSignal': cmp = (a.lastSignalAt || '').localeCompare(b.lastSignalAt || ''); break
        case 'created':    cmp = (a.createdAt || '').localeCompare(b.createdAt || ''); break
        case 'name':       cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return result
  }, [scoredLeads, query, tempFilter, statusFilter, sortKey, sortDir])

  // Group by company for the company view
  const groupedByCompany = useMemo(() => {
    const groups = new Map<string, { companyName: string; leads: typeof filtered; topScore: number; signalCount: number }>()
    for (const l of filtered) {
      const key = (l.companyName || '(no company)').trim().toLowerCase()
      if (!groups.has(key)) groups.set(key, { companyName: l.companyName || '(no company)', leads: [], topScore: 0, signalCount: 0 })
      const g = groups.get(key)!
      g.leads.push(l)
      g.topScore = Math.max(g.topScore, l.score)
      g.signalCount += parseSignals(l.engagementSignals).length
    }
    return Array.from(groups.values()).sort((a, b) => b.topScore - a.topScore)
  }, [filtered])

  // Counts for filter chips
  const counts = useMemo(() => {
    const c: Record<LeadTemperature | 'all', number> = { all: 0, cold: 0, warm: 0, hot: 0, molten: 0 }
    for (const l of scoredLeads) {
      if (l.status === 'archived' || l.status === 'converted') continue
      c.all++
      c[l.temperature]++
    }
    return c
  }, [scoredLeads])

  const total = scoredLeads.length
  const avgScore = total > 0 ? Math.round(scoredLeads.reduce((s, l) => s + l.score, 0) / total) : 0
  const moltenCount = scoredLeads.filter((l) => l.temperature === 'molten' && l.status !== 'archived').length

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  if (!data) return <PageHeader title="Leads" />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Leads"
        subtitle="Prospects from LinkedIn / Teamfluence / webhook sources, ranked by engagement temperature."
        action={
          <div className="flex items-center gap-2">
            {hasWriteBackend() && (
              <Button
                variant="primary"
                icon={<Plus size={13} />}
                onClick={() => setFindLeadsOpen(true)}
              >
                Find more leads
              </Button>
            )}
            <Button variant="secondary" onClick={() => alert('Webhook URL is in Settings → Lead ingest webhook.\n\nWire it into Teamfluence (or Zapier) to start populating this tab.')}>
              How to feed leads
            </Button>
          </div>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total leads" value={total.toLocaleString()} />
        <Stat label="🌋 Molten" value={moltenCount.toString()} deltaTone="danger" />
        <Stat label="Avg engagement score" value={avgScore.toString()} hint="0–100" />
        <Stat label="Active sequences" value={sequences.length.toString()} hint="ready to enroll into" />
      </div>

      {/* View toggle + filters */}
      <Card padded={false}>
        <div className="p-3 border-soft-b flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="surface-2 border-soft rounded-[var(--radius-md)] p-0.5 flex items-center">
              <button
                onClick={() => setView('contacts')}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                  view === 'contacts' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
                )}
              >
                <UsersIcon size={13} /> Contacts
              </button>
              <button
                onClick={() => setView('companies')}
                className={cn(
                  'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] inline-flex items-center gap-1.5 transition-colors',
                  view === 'companies' ? 'surface text-body shadow-soft-xs' : 'text-muted hover:text-body',
                )}
              >
                <Building2 size={13} /> Companies
              </button>
            </div>

            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <Input
                placeholder="Search name, email, company, headline…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Temperature + status chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <FilterChip active={tempFilter === 'all'} onClick={() => setTempFilter('all')}>
              All ({counts.all})
            </FilterChip>
            {TEMPERATURES.map((t) => (
              <FilterChip
                key={t}
                active={tempFilter === t}
                onClick={() => setTempFilter(t)}
                color={temperatureColor(t)}
              >
                {temperatureEmoji(t)} {temperatureLabel(t)} ({counts[t]})
              </FilterChip>
            ))}
            <span className="w-px h-5 bg-[var(--border)] mx-1" />
            {(['open', ...STATUSES] as Array<LeadStatus | 'open'>).map((s) => (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </FilterChip>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={total === 0 ? <Mountain size={22} /> : <Snowflake size={22} />}
            title={total === 0 ? 'No leads yet' : 'No matches'}
            description={
              total === 0
                ? "Wire Teamfluence (or any tool) to your lead-ingest webhook (in Settings) and prospects will start flowing in here, ranked by engagement."
                : "Try a different temperature or status filter."
            }
          />
        ) : view === 'contacts' ? (
          <ContactView
            leads={filtered}
            onSelect={setSelected}
            onAi={hasWriteBackend() ? setAiLead : undefined}
            sortKey={sortKey}
            sortDir={sortDir}
            toggleSort={toggleSort}
          />
        ) : (
          <CompanyView groups={groupedByCompany} onSelectLead={setSelected} />
        )}
      </Card>

      {/* Detail drawer */}
      {selected && (
        <LeadDrawer
          lead={selected}
          sequences={sequences}
          onClose={() => setSelected(null)}
          onSaved={() => { refresh() }}
        />
      )}

      {/* AI BDR drawer */}
      <AIBdrDrawer
        open={!!aiLead}
        onClose={() => setAiLead(null)}
        entity={aiLead ? { kind: 'lead', lead: aiLead } : null}
        data={data}
        goal="What's the single best next move on this lead? Look at their engagement signals + temperature. Recommend qualification, conversion to contact+deal, outreach, or pause based on what's most actionable."
        onApplied={() => { setAiLead(null); refresh() }}
      />

      {/* Find more leads drawer */}
      <LeadGenerationDrawer
        open={findLeadsOpen}
        onClose={() => setFindLeadsOpen(false)}
        data={data}
      />
    </div>
  )
}

/* -------------------------------------------------------------------- */
/*  Helpers                                                              */
/* -------------------------------------------------------------------- */

function FilterChip({
  active, onClick, children, color,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  color?: string
}) {
  return (
    <button
      onClick={onClick}
      style={active && color ? { backgroundColor: color, color: 'white' } : undefined}
      className={cn(
        'h-8 px-3 text-[12px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap',
        active && !color ? 'bg-[var(--color-brand-600)] text-white' :
        !active ? 'surface-2 text-muted hover:text-body' : '',
      )}
    >
      {children}
    </button>
  )
}

function ContactView({
  leads, onSelect, onAi, sortKey, sortDir, toggleSort,
}: {
  leads: Array<Lead & { score: number; temperature: LeadTemperature }>
  onSelect: (lead: Lead) => void
  onAi?: (lead: Lead) => void
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  toggleSort: (k: SortKey) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="surface-2 text-muted text-left">
          <tr>
            <th className="px-4 py-2.5 font-medium w-[50px]">Temp</th>
            <Th label="Score" k="score" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
            <Th label="Name" k="name" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
            <th className="px-4 py-2.5 font-medium">Company / headline</th>
            <th className="px-4 py-2.5 font-medium">Source</th>
            <Th label="Last signal" k="lastSignal" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} />
            <th className="px-4 py-2.5 font-medium w-[60px]"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {leads.map((l) => {
            const fullName = `${l.firstName} ${l.lastName}`.trim() || l.email
            const signalCount = parseSignals(l.engagementSignals).length
            return (
              <tr
                key={l.id}
                onClick={() => onSelect(l)}
                className="hover:surface-2 transition-colors cursor-pointer group"
              >
                <td className="px-4 py-3">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: temperatureColor(l.temperature) }}
                    title={`${temperatureLabel(l.temperature)} — ${signalCount} signal${signalCount === 1 ? '' : 's'}`}
                  />
                </td>
                <td className="px-4 py-3 font-display tabular text-[13px] font-semibold text-body">{l.score}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar firstName={l.firstName} lastName={l.lastName} size={28} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-body truncate">{fullName}</div>
                      {l.email && <div className="text-[11px] text-muted truncate max-w-[200px]">{l.email}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted">
                  <div className="font-medium text-body truncate max-w-[220px]">{l.companyName || '—'}</div>
                  <div className="truncate max-w-[220px]">{l.headline || l.title || ''}</div>
                </td>
                <td className="px-4 py-3 text-[11px]">
                  <Badge tone="neutral">{l.source}</Badge>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted whitespace-nowrap">
                  {l.lastSignalAt ? relativeDate(l.lastSignalAt) : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5 justify-end">
                    {onAi && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAi(l) }}
                        className="inline-flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded-full bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] hover:bg-[color:rgba(122,94,255,0.2)] transition-colors"
                        title="Ask AI BDR for the next move"
                      >
                        <Sparkles size={10} /> AI
                      </button>
                    )}
                    <ChevronRight size={14} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CompanyView({
  groups, onSelectLead,
}: {
  groups: Array<{ companyName: string; leads: Array<Lead & { score: number; temperature: LeadTemperature }>; topScore: number; signalCount: number }>
  onSelectLead: (lead: Lead) => void
}) {
  return (
    <div className="divide-y divide-[color:var(--border)]">
      {groups.map((g) => (
        <div key={g.companyName} className="px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <Avatar name={g.companyName} size={32} />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[14px] font-semibold text-body truncate">{g.companyName}</div>
              <div className="text-[11px] text-muted">
                {g.leads.length} contact{g.leads.length === 1 ? '' : 's'} · {g.signalCount} signals · top score {g.topScore}
              </div>
            </div>
            <span
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: temperatureColor(g.leads[0].temperature) }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5 ml-11">
            {g.leads.map((l) => (
              <button
                key={l.id}
                onClick={() => onSelectLead(l)}
                className="inline-flex items-center gap-1.5 surface-2 hover:surface-3 transition-colors rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: temperatureColor(l.temperature) }}
                />
                <span className="text-body">{l.firstName} {l.lastName}</span>
                <span className="text-[var(--text-faint)] tabular">{l.score}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Th({
  label, k, sortKey, sortDir, toggleSort,
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  toggleSort: (k: SortKey) => void
}) {
  const Icon = sortKey === k ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowDownUp
  return (
    <th className="px-4 py-2.5 font-medium whitespace-nowrap">
      <button
        onClick={() => toggleSort(k)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-body transition-colors',
          sortKey === k && 'text-body',
        )}
      >
        {label}
        <Icon size={11} className={cn(sortKey !== k && 'opacity-50')} />
      </button>
    </th>
  )
}

/* -------------------------------------------------------------------- */
/*  Lead detail drawer                                                  */
/* -------------------------------------------------------------------- */

function LeadDrawer({
  lead, sequences, onClose, onSaved,
}: {
  lead: Lead
  sequences: Array<{ id: string; name: string; status: string }>
  onClose: () => void
  onSaved: () => void
}) {
  const signals = parseSignals(lead.engagementSignals)
  const [enrolling, setEnrolling] = useState(false)
  const fullName = `${lead.firstName} ${lead.lastName}`.trim() || lead.email

  const setStatus = async (status: LeadStatus) => {
    await api.lead.update({ id: lead.id, status })
    onSaved()
    if (status === 'archived' || status === 'converted') onClose()
  }

  const convertToContact = async () => {
    if (!confirm(`Convert ${fullName} to a real Contact?`)) return
    const res = await api.contact.create({
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      title: lead.title || lead.headline,
      linkedinUrl: lead.linkedinUrl,
      state: lead.location,
      status: 'Lead',
    })
    if (res.row?.id) {
      await api.lead.update({ id: lead.id, status: 'converted', convertedContactId: res.row.id })
    }
    onSaved()
    onClose()
  }

  const enroll = async (sequenceId: string) => {
    let contactId = lead.convertedContactId
    if (!contactId) {
      const res = await api.contact.create({
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        title: lead.title || lead.headline,
        linkedinUrl: lead.linkedinUrl,
        status: 'Lead',
      })
      if (res.row?.id) {
        contactId = res.row.id as string
        await api.lead.update({ id: lead.id, status: 'contacted', convertedContactId: contactId })
      }
    }
    if (contactId) {
      await api.enrollment.create({
        sequenceId,
        contactId,
        dealId: '',
        currentStepIndex: 0,
        status: 'active',
        enrolledAt: new Date().toISOString(),
        nextFireAt: new Date().toISOString(),
      })
    }
    onSaved()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        className="relative h-full bg-[var(--bg-elev)] border-soft-l shadow-soft-xl flex flex-col animate-fade-in w-full max-w-[520px]"
        role="dialog"
      >
        {/* Header */}
        <header className="px-5 py-4 border-soft-b">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <Avatar firstName={lead.firstName} lastName={lead.lastName} size={48} className="text-[16px]" />
              <div className="min-w-0">
                <div className="font-display text-[17px] font-semibold text-body truncate">{fullName}</div>
                <div className="text-[12px] text-muted truncate">{lead.headline || lead.title}</div>
                <div className="text-[12px] text-muted truncate">{lead.companyName}</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2 shrink-0"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Score + temperature */}
          <div className="flex items-center gap-3 mt-4">
            <div
              className="rounded-full px-3 py-1.5 text-[12px] font-medium text-white inline-flex items-center gap-1.5"
              style={{ backgroundColor: temperatureColor(lead.temperature) }}
            >
              {temperatureEmoji(lead.temperature)} {temperatureLabel(lead.temperature)}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-muted">Engagement score</span>
                <span className="font-display font-semibold text-body tabular">{lead.score} / 100</span>
              </div>
              <div className="h-1.5 surface-3 rounded-full overflow-hidden">
                <div
                  className="h-full transition-all"
                  style={{ width: `${lead.score}%`, backgroundColor: temperatureColor(lead.temperature) }}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Quick links */}
          <div className="flex flex-wrap gap-2 text-[12px]">
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 surface-2 px-2 py-1 rounded-[var(--radius-sm)] text-muted hover:text-body">
                <ExternalLink size={11} /> {lead.email}
              </a>
            )}
            {lead.linkedinUrl && (
              <a href={lead.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 surface-2 px-2 py-1 rounded-[var(--radius-sm)] text-muted hover:text-[#0a66c2]">
                <Link2 size={11} /> LinkedIn
              </a>
            )}
            {lead.companyLinkedinUrl && (
              <a href={lead.companyLinkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 surface-2 px-2 py-1 rounded-[var(--radius-sm)] text-muted hover:text-[#0a66c2]">
                <Building2 size={11} /> Company page
              </a>
            )}
          </div>

          {/* Engagement signals */}
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
              Engagement signals ({signals.length})
            </div>
            {signals.length === 0 ? (
              <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-muted">
                No signals yet. Engagement signals come from your data sources (Teamfluence webhooks, etc.).
              </div>
            ) : (
              <ul className="space-y-1.5 max-h-72 overflow-y-auto">
                {signals
                  .slice()
                  .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
                  .map((s, i) => (
                    <li key={i} className="flex items-center gap-2 surface-2 rounded-[var(--radius-sm)] px-2.5 py-1.5">
                      <Flame size={11} className="text-[var(--color-warning)] shrink-0" />
                      <div className="min-w-0 flex-1 text-[12px]">
                        <span className="text-body font-medium">{s.kind.replace(/-/g, ' ')}</span>
                        {s.target && <span className="text-muted truncate"> · {s.target}</span>}
                      </div>
                      <span className="text-[10px] text-[var(--text-faint)] shrink-0 tabular">
                        {s.ts ? relativeDate(s.ts) : ''}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {/* Notes */}
          {lead.notes && (
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">Notes</div>
              <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[13px] text-body whitespace-pre-wrap">{lead.notes}</div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <footer className="px-5 py-3 border-soft-t bg-[var(--surface)] flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Button
              variant="primary"
              icon={<Zap size={13} />}
              onClick={() => setEnrolling((v) => !v)}
            >
              Enroll in sequence
            </Button>
            {enrolling && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEnrolling(false)} />
                <div className="absolute bottom-full left-0 mb-2 z-20 w-72 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1">
                  {sequences.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-muted">No sequences yet.</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto">
                      {sequences.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => enroll(s.id)}
                          className="w-full text-left px-3 py-2 text-[13px] hover:surface-2 rounded-[var(--radius-sm)] transition-colors"
                        >
                          <div className="text-body font-medium truncate">{s.name}</div>
                          <div className="text-[11px] text-[var(--text-faint)]">{s.status}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <Button icon={<UserPlus size={13} />} onClick={convertToContact}>Convert to contact</Button>
          <div className="flex-1" />
          <Button icon={<Archive size={13} />} onClick={() => setStatus('archived')}>Archive</Button>
        </footer>
      </div>
    </div>
  )
}

/* Re-exports kept for the icons that don't exist elsewhere */
void Coffee
