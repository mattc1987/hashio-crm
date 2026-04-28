import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, RefreshCw, Brain, CheckCircle2, X,
  ShieldAlert, ShieldCheck, Shield, ChevronDown, ChevronRight,
  Undo2, Zap, Send, CheckSquare, Briefcase, MessageSquare,
  Mail, UserPlus, FileText, Settings as SettingsIcon, Filter,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, PageHeader, Stat, Badge, Button, Empty } from '../components/ui'
import { generateBriefing } from '../lib/briefing'
import { runEngine, makeProposalId, type ProposalDraft } from '../lib/bdrEngine'
import { executeProposal } from '../lib/bdrExecutor'
import '../lib/bdrRules' // registers rules as a side effect
import { api } from '../lib/api'
import type { Proposal, ProposalActionKind, ProposalCategory, ProposalRisk, SheetData } from '../lib/types'
import { cn } from '../lib/cn'

const UNDO_WINDOW_MS = 5 * 60 * 1000

// Map proposed -> Proposal-ish object for execution.
function draftToProposal(draft: ProposalDraft, id: string): Proposal {
  return {
    id,
    ruleId: draft.ruleId,
    category: draft.category,
    priority: draft.priority,
    confidence: draft.confidence,
    risk: draft.risk,
    title: draft.title,
    reason: draft.reason,
    expectedOutcome: draft.expectedOutcome,
    actionKind: draft.actionKind,
    actionPayload: JSON.stringify(draft.action),
    status: 'proposed',
    createdAt: new Date().toISOString(),
    resolvedAt: '',
    resolvedBy: '',
    executedAt: '',
    executionResult: '',
    contactIds: (draft.contactIds || []).join(','),
    dealId: draft.dealId || '',
    companyId: draft.companyId || '',
  }
}

// ============================================================
// Component
// ============================================================

type Filter = 'all' | ProposalCategory | 'safe-only'

export function Briefing() {
  const { state, refresh } = useSheetData()
  const [refreshTick, setRefreshTick] = useState(0)
  const [filter, setFilter] = useState<Filter>('all')
  const [showHeuristic, setShowHeuristic] = useState(false)
  const [running, setRunning] = useState<Set<string>>(new Set())
  const data = 'data' in state ? state.data : undefined

  const engineResult = useMemo(() => {
    if (!data) return null
    void refreshTick
    return runEngine(data)
  }, [data, refreshTick])

  const briefing = useMemo(() => {
    if (!data) return null
    return generateBriefing(data)
  }, [data])

  // Build local view of "all proposals" — already-persisted ones from data plus
  // newly-generated drafts that aren't yet persisted.
  const persistedProposals = data?.proposals || []
  const newDrafts = useMemo(() => {
    if (!engineResult) return []
    // Filter out drafts whose dedupeKey already matches a persisted proposal.
    const existingKeys = new Set(
      persistedProposals
        .filter((p) => p.status === 'proposed')
        .map((p) => `${p.ruleId}:${p.contactIds.split(',')[0] || ''}:${p.actionKind}`),
    )
    return engineResult.proposals.filter((d) => {
      const k = `${d.ruleId}:${(d.contactIds || [])[0] || ''}:${d.actionKind}`
      return !existingKeys.has(k)
    })
  }, [engineResult, persistedProposals])

  const visibleProposed = useMemo(() => {
    const all: Proposal[] = [
      ...persistedProposals.filter((p) => p.status === 'proposed' || p.status === 'approved'),
      ...newDrafts.map((d) => draftToProposal(d, makeProposalId())),
    ]
    if (filter === 'all') return all
    if (filter === 'safe-only') return all.filter((p) => p.risk === 'safe' || p.risk === 'moderate')
    return all.filter((p) => p.category === filter)
  }, [persistedProposals, newDrafts, filter])

  const stats = useMemo(() => {
    const safe = visibleProposed.filter((p) => p.risk === 'safe').length
    const sensitive = visibleProposed.filter((p) => p.risk === 'sensitive').length
    const critical = visibleProposed.filter((p) => p.priority === 'critical').length
    return { total: visibleProposed.length, safe, sensitive, critical }
  }, [visibleProposed])

  // Track approved proposals within the undo window.
  const undoTimers = useRef(new Map<string, number>())
  useEffect(() => {
    return () => {
      for (const id of undoTimers.current.values()) clearTimeout(id)
    }
  }, [])

  if (!data) return <PageHeader title="AI BDR" />

  const handleApprove = async (p: Proposal, runImmediately = false) => {
    setRunning((s) => new Set([...s, p.id]))
    try {
      // Persist as approved immediately. If it's already persisted, update.
      const existing = data.proposals.find((x) => x.id === p.id)
      const approvedAt = new Date().toISOString()

      if (existing) {
        await api.proposal.update({ id: p.id, status: 'approved', resolvedAt: approvedAt, resolvedBy: 'matt' })
      } else {
        await api.proposal.create({
          id: p.id,
          ruleId: p.ruleId,
          category: p.category,
          priority: p.priority,
          confidence: p.confidence,
          risk: p.risk,
          title: p.title,
          reason: p.reason,
          expectedOutcome: p.expectedOutcome,
          actionKind: p.actionKind,
          actionPayload: p.actionPayload,
          status: 'approved',
          createdAt: p.createdAt || approvedAt,
          resolvedAt: approvedAt,
          resolvedBy: 'matt',
          executedAt: '',
          executionResult: '',
          contactIds: p.contactIds,
          dealId: p.dealId,
          companyId: p.companyId,
        })
      }

      if (runImmediately) {
        await runProposal(p)
      } else {
        // Schedule auto-execution after the undo window (sensitive risks NEVER auto-run).
        if (p.risk !== 'sensitive') {
          const t = window.setTimeout(() => {
            runProposal(p)
          }, UNDO_WINDOW_MS)
          undoTimers.current.set(p.id, t)
        }
      }
    } finally {
      setRunning((s) => { const next = new Set(s); next.delete(p.id); return next })
    }
  }

  const runProposal = async (p: Proposal) => {
    const approvedProposal: Proposal = { ...p, status: 'approved' }
    const result = await executeProposal(approvedProposal, data)
    const ts = new Date().toISOString()
    await api.proposal.update({
      id: p.id,
      status: result.ok ? 'executed' : 'failed',
      executedAt: ts,
      executionResult: result.ok ? (result.output || 'OK') : (result.error || 'Failed'),
    })
    setRefreshTick((t) => t + 1)
  }

  const handleSkip = async (p: Proposal) => {
    setRunning((s) => new Set([...s, p.id]))
    try {
      const existing = data.proposals.find((x) => x.id === p.id)
      const ts = new Date().toISOString()
      if (existing) {
        await api.proposal.update({ id: p.id, status: 'skipped', resolvedAt: ts, resolvedBy: 'matt' })
      } else {
        // Persist it as already-skipped so we don't re-propose
        await api.proposal.create({
          id: p.id,
          ruleId: p.ruleId,
          category: p.category,
          priority: p.priority,
          confidence: p.confidence,
          risk: p.risk,
          title: p.title,
          reason: p.reason,
          expectedOutcome: p.expectedOutcome,
          actionKind: p.actionKind,
          actionPayload: p.actionPayload,
          status: 'skipped',
          createdAt: p.createdAt || ts,
          resolvedAt: ts,
          resolvedBy: 'matt',
          executedAt: '',
          executionResult: '',
          contactIds: p.contactIds,
          dealId: p.dealId,
          companyId: p.companyId,
        })
      }
      setRefreshTick((t) => t + 1)
    } finally {
      setRunning((s) => { const next = new Set(s); next.delete(p.id); return next })
    }
  }

  const handleUndo = async (p: Proposal) => {
    const t = undoTimers.current.get(p.id)
    if (t) {
      clearTimeout(t)
      undoTimers.current.delete(p.id)
    }
    await api.proposal.update({ id: p.id, status: 'cancelled', resolvedAt: new Date().toISOString() })
    setRefreshTick((t) => t + 1)
  }

  const handleApproveAllSafe = async () => {
    const safe = visibleProposed.filter((p) => p.risk === 'safe' && p.status === 'proposed')
    for (const p of safe) {
      await handleApprove(p, false)
    }
  }

  // Recently-approved (within undo window) so we can show the undo bar
  const undoableProposals = useMemo(() => {
    const cutoff = Date.now() - UNDO_WINDOW_MS
    return persistedProposals.filter(
      (p) => p.status === 'approved' && p.resolvedAt && new Date(p.resolvedAt).getTime() > cutoff,
    )
  }, [persistedProposals])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-brand-600)]" />
            Agentic BDR
          </span>
        }
        subtitle="Daily proposals from a rule-based BDR. You approve, it executes — never the other way around."
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowHeuristic((s) => !s)}
              icon={showHeuristic ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            >
              Briefing
            </Button>
            <Button
              icon={<RefreshCw size={13} />}
              onClick={async () => {
                await refresh()
                setRefreshTick((t) => t + 1)
              }}
            >
              Refresh
            </Button>
          </div>
        }
      />

      {/* Hero summary */}
      <Card className="bg-gradient-to-br from-[color:rgba(122,94,255,0.08)] to-transparent border-[color:rgba(122,94,255,0.18)]">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full grid place-items-center bg-[var(--color-brand-600)] text-white shrink-0">
            <Brain size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-1">
              Today, {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <p className="text-[15px] text-body leading-relaxed">
              {stats.total === 0 ? (
                <>All clear — no proposals to review. The BDR will surface new actions as your data changes.</>
              ) : (
                <>
                  {stats.total} proposal{stats.total === 1 ? '' : 's'} queued
                  {stats.critical > 0 && <> · <strong className="text-[var(--color-danger)]">{stats.critical} critical</strong></>}
                  {' — '}{stats.safe} safe to bulk-approve, {stats.sensitive} need your eyes (external sends).
                </>
              )}
            </p>
          </div>
        </div>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Proposals queued" value={stats.total.toString()} deltaTone={stats.total > 0 ? 'success' : undefined} />
        <Stat label="Critical" value={stats.critical.toString()} deltaTone={stats.critical > 0 ? 'danger' : undefined} />
        <Stat label="Safe to auto-run" value={stats.safe.toString()} />
        <Stat label="Need approval" value={stats.sensitive.toString()} deltaTone={stats.sensitive > 0 ? 'danger' : undefined} />
      </div>

      {/* Undo bar */}
      {undoableProposals.length > 0 && (
        <Card className="border-[var(--color-warning)]/30 bg-[color:rgba(245,165,36,0.06)]">
          <div className="flex items-center gap-3">
            <Undo2 size={14} className="text-[var(--color-warning)]" />
            <div className="text-[12px] flex-1">
              <strong>{undoableProposals.length}</strong> approval{undoableProposals.length === 1 ? '' : 's'} pending — 5 min to undo before auto-execute.
            </div>
            <div className="flex flex-wrap gap-1.5">
              {undoableProposals.map((p) => (
                <Button key={p.id} size="sm" variant="ghost" onClick={() => handleUndo(p)}>
                  Undo: {p.title.slice(0, 30)}{p.title.length > 30 ? '…' : ''}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Filter bar */}
      <Card padded={false}>
        <div className="flex items-center gap-2 px-4 py-3 flex-wrap">
          <Filter size={13} className="text-muted" />
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All ({stats.total})</FilterChip>
          <FilterChip active={filter === 'safe-only'} onClick={() => setFilter('safe-only')}>
            <ShieldCheck size={11} /> Safe-only
          </FilterChip>
          <FilterChip active={filter === 'outreach'} onClick={() => setFilter('outreach')}>Outreach</FilterChip>
          <FilterChip active={filter === 'follow-up'} onClick={() => setFilter('follow-up')}>Follow-ups</FilterChip>
          <FilterChip active={filter === 'deal'} onClick={() => setFilter('deal')}>Deal</FilterChip>
          <FilterChip active={filter === 'meeting'} onClick={() => setFilter('meeting')}>Meeting</FilterChip>
          <FilterChip active={filter === 'hygiene'} onClick={() => setFilter('hygiene')}>Hygiene</FilterChip>
          <FilterChip active={filter === 'report'} onClick={() => setFilter('report')}>Report</FilterChip>
          <div className="ml-auto">
            {stats.safe > 0 && (
              <Button size="sm" variant="primary" icon={<Zap size={13} />} onClick={handleApproveAllSafe}>
                Approve all safe ({stats.safe})
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Proposal queue */}
      {visibleProposed.length === 0 ? (
        <Empty
          icon={<Sparkles size={22} />}
          title="No proposals match this filter"
          description="Either everything's been resolved, or no rules fired for this category. Try the All filter."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleProposed.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              data={data}
              loading={running.has(p.id)}
              onApprove={() => handleApprove(p, false)}
              onApproveNow={() => handleApprove(p, true)}
              onSkip={() => handleSkip(p)}
            />
          ))}
        </div>
      )}

      {/* Heuristic Briefing (collapsible classic view) */}
      {showHeuristic && briefing && (
        <Card padded={false}>
          <CardHeader
            title="Classic briefing"
            subtitle="The original heuristic dashboard view — kept here as a sanity check."
            className="px-5 py-4"
          />
          <div className="px-5 pb-5 flex flex-col gap-3">
            {briefing.sections.map((section) => (
              <details key={section.id} className="surface-2 rounded-[var(--radius-md)] p-3">
                <summary className="cursor-pointer text-[13px] font-medium text-body flex items-center gap-2">
                  <span>{section.emoji}</span> {section.title}
                  <Badge tone="neutral">{section.items.length}</Badge>
                </summary>
                <ul className="mt-2 text-[12px] text-muted space-y-1.5">
                  {section.items.map((it) => (
                    <li key={it.id}>
                      <strong className="text-body">{it.headline}</strong> — {it.reason}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>
      )}

      {/* Footer note */}
      <Card>
        <div className="flex items-start gap-3 text-[12px]">
          <Brain size={14} className="text-[var(--text-faint)] mt-0.5 shrink-0" />
          <div className="text-muted">
            <strong className="text-body">Rule-based mode.</strong> {engineResult?.rulesRun || 0} rules fire over your CRM.
            All actions require your approval. Sensitive items (external sends) are
            never bulk-approved or auto-executed. Add an Anthropic / OpenAI key in
            Settings to upgrade to LLM-drafted messages later.
          </div>
        </div>
      </Card>
    </div>
  )
}

// ============================================================
// ProposalCard
// ============================================================

function ProposalCard({
  proposal,
  data,
  loading,
  onApprove,
  onApproveNow,
  onSkip,
}: {
  proposal: Proposal
  data: SheetData
  loading: boolean
  onApprove: () => void
  onApproveNow: () => void
  onSkip: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isApproved = proposal.status === 'approved' || proposal.status === 'executed'
  const isFailed = proposal.status === 'failed'

  const subjectChips = useMemo(() => buildSubjectChips(proposal, data), [proposal, data])
  const actionDetails = useMemo(() => describeAction(proposal), [proposal])

  return (
    <Card padded={false} className={cn(
      'transition-all',
      proposal.priority === 'critical' && 'border-[var(--color-danger)]/30',
      isApproved && 'opacity-70',
    )}>
      <div className="flex flex-col">
        {/* Header row */}
        <div className="px-5 py-4 flex items-start gap-3">
          <ActionIcon kind={proposal.actionKind} risk={proposal.risk} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-[14px] font-semibold text-body leading-snug">{proposal.title}</h3>
              <PriorityBadge priority={proposal.priority} />
              <RiskBadge risk={proposal.risk} />
              <Badge tone="neutral" className="font-mono">{proposal.ruleId}</Badge>
            </div>
            <p className="text-[12px] text-muted mt-1.5">{proposal.reason}</p>
            {subjectChips.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {subjectChips.map((c, i) => (
                  <span key={i} className="text-[11px] surface-2 border-soft rounded-full px-2 py-0.5 text-muted">
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-1">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold">Confidence</div>
            <div className="text-[14px] font-mono font-semibold text-body">{Math.round(proposal.confidence)}</div>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="px-5 pb-3 -mt-2 text-[12px] flex flex-col gap-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Expected outcome</div>
              <div className="text-body">{proposal.expectedOutcome}</div>
            </div>
            {actionDetails && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Action</div>
                <div className="text-body font-mono text-[11px] surface-2 rounded p-2 whitespace-pre-wrap">{actionDetails}</div>
              </div>
            )}
            {proposal.executionResult && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Result</div>
                <div className={cn('text-[11px] font-mono', isFailed ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]')}>
                  {proposal.executionResult}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer / actions */}
        <div className="px-5 py-3 border-soft-t flex items-center justify-between gap-2">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-[11px] text-muted hover:text-body inline-flex items-center gap-1"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Hide details' : 'Details'}
          </button>
          <div className="flex items-center gap-2">
            {isApproved ? (
              <Badge tone="success">{proposal.status === 'executed' ? 'Executed' : 'Approved'}</Badge>
            ) : isFailed ? (
              <Badge tone="danger">Failed — see details</Badge>
            ) : proposal.status === 'skipped' || proposal.status === 'cancelled' ? (
              <Badge tone="neutral">{proposal.status}</Badge>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X size={12} />}
                  onClick={onSkip}
                  disabled={loading}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<CheckCircle2 size={12} />}
                  onClick={onApprove}
                  disabled={loading}
                >
                  Approve
                </Button>
                {proposal.risk !== 'sensitive' && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Zap size={12} />}
                    onClick={onApproveNow}
                    disabled={loading}
                  >
                    Approve & run
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}

// ============================================================
// Helpers / sub-components
// ============================================================

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded-full transition-colors',
        active
          ? 'bg-[var(--color-brand-600)] text-white'
          : 'surface-2 border-soft text-muted hover:text-body',
      )}
    >
      {children}
    </button>
  )
}

function ActionIcon({ kind, risk }: { kind: ProposalActionKind; risk: ProposalRisk }) {
  const map: Record<ProposalActionKind, React.ReactNode> = {
    'enroll-in-sequence': <Send size={14} />,
    'send-email': <Mail size={14} />,
    'send-sms': <MessageSquare size={14} />,
    'create-task': <CheckSquare size={14} />,
    'update-deal': <Briefcase size={14} />,
    'update-contact': <UserPlus size={14} />,
    'log-activity': <FileText size={14} />,
    'pause-enrollment': <SettingsIcon size={14} />,
    'merge-records': <SettingsIcon size={14} />,
    'create-note': <FileText size={14} />,
  }
  const tone = risk === 'sensitive' ? 'bg-[color:rgba(239,76,76,0.10)] text-[var(--color-danger)]'
    : risk === 'moderate' ? 'bg-[color:rgba(245,165,36,0.14)] text-[var(--color-warning)]'
    : 'bg-[color:rgba(122,94,255,0.14)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]'
  return (
    <span className={cn('w-9 h-9 rounded-full grid place-items-center shrink-0', tone)}>
      {map[kind] || <CheckSquare size={14} />}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: Proposal['priority'] }) {
  if (priority === 'critical') return <Badge tone="danger">critical</Badge>
  if (priority === 'high') return <Badge tone="warning">high</Badge>
  if (priority === 'medium') return <Badge tone="info">medium</Badge>
  return <Badge tone="neutral">low</Badge>
}

function RiskBadge({ risk }: { risk: ProposalRisk }) {
  if (risk === 'sensitive') return (
    <Badge tone="danger" className="inline-flex items-center gap-1">
      <ShieldAlert size={10} /> sensitive
    </Badge>
  )
  if (risk === 'moderate') return (
    <Badge tone="warning" className="inline-flex items-center gap-1">
      <Shield size={10} /> moderate
    </Badge>
  )
  return (
    <Badge tone="success" className="inline-flex items-center gap-1">
      <ShieldCheck size={10} /> safe
    </Badge>
  )
}

function buildSubjectChips(p: Proposal, data: SheetData): string[] {
  const chips: string[] = []
  for (const cid of (p.contactIds || '').split(',').filter(Boolean)) {
    const c = data.contacts.find((x) => x.id === cid)
    if (c) chips.push(`${c.firstName} ${c.lastName}`.trim())
  }
  if (p.dealId) {
    const d = data.deals.find((x) => x.id === p.dealId)
    if (d) chips.push(`Deal: ${d.title}`)
  }
  if (p.companyId) {
    const co = data.companies.find((x) => x.id === p.companyId)
    if (co) chips.push(co.name)
  }
  return chips.slice(0, 4)
}

function describeAction(p: Proposal): string {
  try {
    const payload = JSON.parse(p.actionPayload || '{}')
    return JSON.stringify(payload, null, 2)
  } catch {
    return p.actionPayload || ''
  }
}
