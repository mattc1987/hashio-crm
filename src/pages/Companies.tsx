import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Building2, ChevronRight, ExternalLink, Sparkles, Tag, Loader2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Avatar, Badge } from '../components/ui'
import { currency, activeMRRByCompany, billingCycleLabel, isActiveMRR } from '../lib/format'
import type { Company, Deal, CompanyVertical } from '../lib/types'
import { COMPANY_VERTICALS } from '../lib/types'
import { CompanyEditor } from '../components/editors/CompanyEditor'
import { computeClientHealth, type ClientHealth } from '../lib/clientHealth'
import { HealthDot } from '../components/HealthDot'
import { hasWriteBackend, invokeAction, bulkUpdate } from '../lib/api'
import { LeadGenerationDrawer } from '../components/dashboard/LeadGenerationDrawer'
import { detectVerticalFromName } from '../lib/verticalDetector'
import { cn } from '../lib/cn'

export function Companies() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [findLeadsOpen, setFindLeadsOpen] = useState(false)
  // Vertical filter — null means "show all"; otherwise restrict to the picked vertical
  const [verticalFilter, setVerticalFilter] = useState<CompanyVertical | null>(null)
  // Bulk-detect state
  const [detectStatus, setDetectStatus] = useState<{ phase: 'idle' | 'detecting' | 'done'; message: string }>({
    phase: 'idle', message: '',
  })

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
        if (verticalFilter === null) return true
        return (r.company.vertical || 'unknown') === verticalFilter
      })
      .filter((r) => {
        if (!q) return true
        return (
          r.company.name.toLowerCase().includes(q) ||
          r.company.industry.toLowerCase().includes(q) ||
          r.company.notes.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => b.mrr - a.mrr || a.company.name.localeCompare(b.company.name))
  }, [withMRR, query, activeOnly, verticalFilter])

  // Counts per vertical for the filter pills
  const verticalCounts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of companies) {
      const v = c.vertical || 'unknown'
      out[v] = (out[v] || 0) + 1
    }
    return out
  }, [companies])

  /**
   * Detect verticals across companies that don't have one yet (or have low
   * confidence). Pass 1 is regex-only on the company name (free). Pass 2
   * sends the still-unknown ones to Claude in batches of 30, using the
   * company name + state + website. Saves only when the detector returns a
   * confident answer.
   */
  const detectVerticals = async () => {
    if (!hasWriteBackend()) {
      setDetectStatus({ phase: 'done', message: 'Apps Script not configured.' })
      return
    }
    setDetectStatus({ phase: 'detecting', message: 'Pass 1 — name pattern matching…' })

    // Targets: companies with empty/unknown vertical OR low confidence (<70).
    // Don't overwrite manual classifications.
    const targets = companies.filter((c) => {
      if (c.verticalSource === 'manual') return false
      const v = c.vertical as string
      if (!v || v === 'unknown' || v === '') return true
      const conf = Number(c.verticalConfidence) || 0
      return conf < 70
    })
    if (targets.length === 0) {
      setDetectStatus({ phase: 'done', message: 'No companies need detection — all set.' })
      return
    }

    // Pass 1: regex by name
    const regexHits: Array<{ id: string; vertical: string; confidence: number; source: string }> = []
    const stillUnknown: typeof targets = []
    for (const c of targets) {
      const det = detectVerticalFromName(c.name)
      if (det.vertical !== 'unknown' && det.confidence >= 70) {
        regexHits.push({ id: c.id, vertical: det.vertical, confidence: det.confidence, source: 'name-match' })
      } else {
        stillUnknown.push(c)
      }
    }

    // Find the dominant US state from the contact list of each company (best
    // signal for AI lookup). Falls back to address parse if no contacts.
    const stateForCompany = (c: Company): string => {
      const cContacts = contacts.filter((x) => x.companyId === c.id && x.state)
      if (cContacts.length > 0) return cContacts[0].state
      const addr = (c.address || '').match(/,\s*([A-Z]{2})\b/)
      return addr ? addr[1] : ''
    }

    let aiHits: Array<{ id: string; vertical: string; confidence: number; source: string; reasoning?: string }> = []
    let aiErrors = 0
    let lastAiError = ''
    if (stillUnknown.length > 0) {
      setDetectStatus({ phase: 'detecting', message: `Pass 2 — AI lookup for ${stillUnknown.length} ambiguous compan${stillUnknown.length === 1 ? 'y' : 'ies'}…` })
      // Batch in chunks of 15 (smaller than 25 — keeps payload well under
      // request limits and reduces blast radius if one batch fails).
      for (let i = 0; i < stillUnknown.length; i += 15) {
        const chunk = stillUnknown.slice(i, i + 15)
        try {
          const res = await invokeAction('aiInferVerticalsBulk', {
            companies: chunk.map((c) => ({ id: c.id, name: c.name, state: stateForCompany(c), website: c.website })),
          })
          if (!res.ok) {
            aiErrors++
            lastAiError = res.error || 'Unknown error'
            continue
          }
          const rows = (res as { data?: { results?: Array<{ id: string; vertical: string; confidence: number; reasoning?: string }> } }).data?.results || []
          for (const r of rows) {
            if (!r.id || !r.vertical) continue
            if (r.vertical === 'unknown') continue
            const c = Number(r.confidence) || 0
            if (c < 60) continue // threshold to commit
            aiHits.push({ id: r.id, vertical: r.vertical, confidence: c, source: 'ai', reasoning: r.reasoning })
          }
        } catch (err) {
          aiErrors++
          lastAiError = (err as Error).message
          console.error('Vertical AI batch failed:', err)
        }
      }
    }

    const allHits = [...regexHits, ...aiHits]
    if (allHits.length === 0) {
      const aiNote = aiErrors > 0
        ? ` AI failed on ${aiErrors} batch${aiErrors === 1 ? '' : 'es'} — ${lastAiError}. (Likely cause: redeploy Apps Script with the latest Code.gs to pick up the new aiInferVerticalsBulk action.)`
        : ''
      setDetectStatus({
        phase: 'done',
        message: `Detection ran — nothing confident enough to apply automatically.${aiNote}`,
      })
      return
    }

    setDetectStatus({ phase: 'detecting', message: `Saving ${allHits.length} compan${allHits.length === 1 ? 'y' : 'ies'}…` })
    const now = new Date().toISOString()
    const writeRows = allHits.map((h) => ({
      id: h.id,
      vertical: h.vertical,
      verticalConfidence: String(h.confidence),
      verticalSource: h.source,
      updatedAt: now,
    }))
    try {
      const res = await bulkUpdate('companies', writeRows)
      if (!res.ok) throw new Error(res.error || 'Bulk update failed')
    } catch (err) {
      setDetectStatus({ phase: 'done', message: 'Save failed: ' + (err as Error).message })
      return
    }

    await refresh()
    const errSuffix = aiErrors > 0
      ? ` (AI failed on ${aiErrors} batch${aiErrors === 1 ? '' : 'es'} — ${lastAiError})`
      : ''
    setDetectStatus({
      phase: 'done',
      message: `Done — ${regexHits.length} from name, ${aiHits.length} from AI. ${stillUnknown.length - aiHits.length} still unknown.${errSuffix}`,
    })
  }

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
                icon={detectStatus.phase === 'detecting' ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} />}
                onClick={detectVerticals}
                disabled={detectStatus.phase === 'detecting'}
                title="Auto-detect cultivator / processor / vertical / retail using name patterns + AI"
              >
                {detectStatus.phase === 'detecting' ? 'Detecting…' : 'Detect verticals'}
              </Button>
            )}
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

      {detectStatus.phase !== 'idle' && detectStatus.message && (
        <div className={cn(
          'p-3 rounded-[var(--radius-md)] text-[12px] flex items-center gap-2',
          detectStatus.phase === 'detecting'
            ? 'bg-[color:rgba(122,94,255,0.08)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]'
            : 'bg-[color:rgba(48,179,107,0.08)] text-[var(--color-success)]',
        )}>
          {detectStatus.phase === 'detecting' && <Loader2 size={13} className="animate-spin" />}
          {detectStatus.message}
        </div>
      )}

      {/* Vertical filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-[var(--text-faint)] font-semibold mr-1">Vertical:</span>
        <button
          onClick={() => setVerticalFilter(null)}
          className={cn(
            'px-2.5 py-0.5 text-[12px] rounded-full transition-colors',
            verticalFilter === null
              ? 'bg-[var(--color-brand-600)] text-white'
              : 'surface-2 text-muted hover:text-body',
          )}
        >
          All ({companies.length})
        </button>
        {COMPANY_VERTICALS.map((v) => {
          const count = verticalCounts[v.value] || 0
          return (
            <button
              key={v.value}
              onClick={() => setVerticalFilter(verticalFilter === v.value ? null : v.value)}
              className={cn(
                'px-2.5 py-0.5 text-[12px] rounded-full transition-colors',
                verticalFilter === v.value
                  ? 'bg-[var(--color-brand-600)] text-white'
                  : 'surface-2 text-muted hover:text-body',
                count === 0 && 'opacity-50',
              )}
              title={v.description}
            >
              {v.label} ({count})
            </button>
          )
        })}
      </div>

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
          {company.vertical && (company.vertical as string) !== 'unknown' && (company.vertical as string) !== '' && (
            <Badge
              tone={
                company.vertical === 'vertical' ? 'brand' :
                company.vertical === 'cultivator' ? 'success' :
                company.vertical === 'processor' ? 'info' :
                company.vertical === 'retail' ? 'danger' :
                'neutral'
              }
              className={company.vertical === 'retail' ? 'opacity-80' : ''}
            >
              {company.vertical === 'cultivator' ? 'Cultivator' :
               company.vertical === 'processor' ? 'Processor' :
               company.vertical === 'vertical' ? 'Vertical' :
               company.vertical === 'retail' ? 'Retail' : ''}
            </Badge>
          )}
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
