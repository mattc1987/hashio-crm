import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Sparkles, RefreshCw, Brain, CheckCircle2, X,
  ShieldAlert, ShieldCheck, Shield, ChevronDown, ChevronRight,
  Undo2, Zap, Send, CheckSquare, Briefcase, MessageSquare,
  Mail, UserPlus, FileText, Settings as SettingsIcon, Filter, Wand2,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, PageHeader, Stat, Badge, Button, Empty, Input, Textarea } from '../components/ui'
import { generateBriefing } from '../lib/briefing'
import { runEngine, makeProposalId, type ProposalDraft } from '../lib/bdrEngine'
import { executeProposal } from '../lib/bdrExecutor'
import { draftMessage as aiDraftMessage, strategistProposals, type DraftResult, type StrategistProposal } from '../lib/bdrAi'
import '../lib/bdrRules' // registers rules as a side effect
import { api, invokeAction } from '../lib/api'
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
  const [undoingAll, setUndoingAll] = useState(false)
  const [strategistDrafts, setStrategistDrafts] = useState<StrategistProposal[]>([])
  const [strategistLoading, setStrategistLoading] = useState(false)
  const [strategistError, setStrategistError] = useState<string | null>(null)
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
    // Filter out drafts whose dedupeKey matches a persisted proposal — INCLUDING
    // skipped / cancelled / executed / failed. If Matt skipped this once, the
    // rule shouldn't re-propose it on the next render. (Phase 2: time-window
    // unsnooze so stale-deal nudges can re-fire after 14 days.)
    const existingKeys = new Set(
      persistedProposals.map(
        (p) => `${p.ruleId}:${p.contactIds.split(',')[0] || ''}:${p.actionKind}`,
      ),
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

  const handleApprove = async (p: Proposal, runImmediately = false, draft?: DraftResult) => {
    if (!data) return
    // Sensitive proposals never auto-execute via the timer (safety rail). So
    // for sensitive, "Approve" IS the explicit consent — run the executor
    // immediately. Non-sensitive can still queue with the 5-min undo window.
    if (p.risk === 'sensitive') runImmediately = true
    setRunning((s) => new Set([...s, p.id]))
    try {
      // If we have an AI draft, merge subject+body into the action payload so
      // the executor can pick it up.
      let actionPayload = p.actionPayload
      if (draft) {
        try {
          const existing = JSON.parse(p.actionPayload || '{}') as Record<string, unknown>
          actionPayload = JSON.stringify({
            ...existing,
            draftedSubject: draft.subject,
            draftedBody: draft.body,
            draftedBy: draft.model,
          })
        } catch {
          actionPayload = JSON.stringify({
            draftedSubject: draft.subject,
            draftedBody: draft.body,
            draftedBy: draft.model,
          })
        }
      }
      const finalProposal: Proposal = { ...p, actionPayload }

      // Persist as approved immediately. If it's already persisted, update.
      const existing = data.proposals.find((x) => x.id === p.id)
      const approvedAt = new Date().toISOString()

      if (existing) {
        await api.proposal.update({
          id: p.id,
          status: 'approved',
          resolvedAt: approvedAt,
          resolvedBy: 'matt',
          actionPayload,
        })
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
          actionPayload,
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
        await runProposal(finalProposal)
      } else {
        // Schedule auto-execution after the undo window (sensitive risks NEVER auto-run).
        if (p.risk !== 'sensitive') {
          const t = window.setTimeout(() => {
            runProposal(finalProposal)
          }, UNDO_WINDOW_MS)
          undoTimers.current.set(p.id, t)
        }
      }
    } finally {
      setRunning((s) => { const next = new Set(s); next.delete(p.id); return next })
    }
  }

  const runProposal = async (p: Proposal) => {
    if (!data) return
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
    if (!data) return
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

  // Recently-approved (within undo window) so we can show the undo bar.
  // Sensitive proposals run immediately on approve, so they never appear here —
  // only safe/moderate ones queued behind the 5-min auto-execute timer.
  const undoableProposals = useMemo(() => {
    const cutoff = Date.now() - UNDO_WINDOW_MS
    return persistedProposals.filter(
      (p) =>
        p.status === 'approved' &&
        p.risk !== 'sensitive' &&
        p.resolvedAt &&
        new Date(p.resolvedAt).getTime() > cutoff,
    )
  }, [persistedProposals])

  // Early return AFTER all hooks (rules of hooks).
  if (!data) return <PageHeader title="AI BDR" />

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
              variant="secondary"
              icon={strategistLoading ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
              disabled={strategistLoading}
              onClick={async () => {
                setStrategistLoading(true)
                setStrategistError(null)
                try {
                  const r = await strategistProposals(data)
                  setStrategistDrafts(r.proposals || [])
                } catch (err) {
                  setStrategistError((err as Error).message)
                } finally {
                  setStrategistLoading(false)
                }
              }}
            >
              {strategistLoading ? 'Thinking…' : 'Run AI strategist'}
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-[12px]">
              <Undo2 size={14} className="text-[var(--color-warning)]" />
              <span>
                <strong>{undoableProposals.length}</strong> approval{undoableProposals.length === 1 ? '' : 's'} queued — auto-running in 5 min unless undone.
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={undoingAll}
                onClick={async () => {
                  setUndoingAll(true)
                  try {
                    // Parallel undo — local cache writes are sync, so all 8
                    // flip to "cancelled" instantly. Network calls are
                    // best-effort and run in parallel.
                    await Promise.all(undoableProposals.map((p) => handleUndo(p)))
                  } finally {
                    setUndoingAll(false)
                  }
                }}
                className="ml-auto"
              >
                {undoingAll ? 'Undoing…' : `Undo all (${undoableProposals.length})`}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {undoableProposals.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="secondary"
                  onClick={() => handleUndo(p)}
                >
                  Undo: {p.title.slice(0, 40)}{p.title.length > 40 ? '…' : ''}
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

      {/* AI Strategist proposals — free-form, beyond rules */}
      {(strategistDrafts.length > 0 || strategistError) && (
        <Card padded={false}>
          <div className="px-5 py-3 border-soft-b flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--color-brand-600)]" />
            <span className="text-[13px] font-semibold text-body">AI Strategist proposals</span>
            <Badge tone="brand">{strategistDrafts.length}</Badge>
            <button
              onClick={() => { setStrategistDrafts([]); setStrategistError(null) }}
              className="ml-auto text-[11px] text-muted hover:text-body"
            >
              Dismiss all
            </button>
          </div>
          {strategistError && (
            <div className="px-5 py-3 text-[12px] text-[var(--color-danger)] bg-[color:rgba(239,76,76,0.06)]">
              {strategistError}
            </div>
          )}
          <div className="divide-y divide-[color:var(--border)]">
            {strategistDrafts.map((p, i) => (
              <StrategistRow
                key={i}
                proposal={p}
                onDismiss={() => setStrategistDrafts((arr) => arr.filter((_, idx) => idx !== i))}
                onApply={async () => {
                  // Apply: create the appropriate entity based on actionKind
                  await applyStrategistProposal(p, data)
                  setStrategistDrafts((arr) => arr.filter((_, idx) => idx !== i))
                  setRefreshTick((t) => t + 1)
                }}
              />
            ))}
          </div>
        </Card>
      )}

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
              onApprove={(draft) => handleApprove(p, false, draft)}
              onApproveNow={(draft) => handleApprove(p, true, draft)}
              onSkip={() => handleSkip(p)}
              onRunNow={() => runProposal(p)}
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

      {/* Diagnostic panel — shows what got dropped + why */}
      {engineResult && (
        <Card padded={false}>
          <details>
            <summary className="px-5 py-3 cursor-pointer text-[12px] font-medium text-muted hover:text-body select-none">
              Diagnostics — {engineResult.rawDraftCount} drafts generated, {engineResult.proposals.length} surfaced, {engineResult.dropped.length} dropped by safety rails
            </summary>
            <div className="px-5 pb-4 text-[11px] space-y-2.5">
              <div className="font-mono text-[10px] surface-2 rounded p-2">
                Rules ran: {engineResult.rulesRun} · Drafts: {engineResult.rawDraftCount} · Surfaced: {engineResult.proposals.length} · Dropped: {engineResult.dropped.length} · Cap: {engineResult.cappedAt}
              </div>
              {engineResult.dropped.length > 0 ? (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">
                    Dropped drafts (first 20)
                  </div>
                  <ul className="space-y-1.5">
                    {engineResult.dropped.slice(0, 20).map((d, i) => (
                      <li key={i} className="surface-2 rounded p-2">
                        <div className="font-medium text-body">{d.draft.title}</div>
                        <div className="text-muted">
                          <span className="font-mono">{d.draft.ruleId}</span> · {d.draft.actionKind} · {d.draft.risk}
                        </div>
                        <div className="text-[var(--color-warning)] mt-0.5">→ {d.reason}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-muted">No drafts were dropped by safety rails.</div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1 mt-3">
                  Test contact lookup
                </div>
                <DiagnosticTestContact data={data} />
              </div>
            </div>
          </details>
        </Card>
      )}
    </div>
  )
}

function DiagnosticTestContact({ data }: { data: SheetData }) {
  const TEST_EMAIL = 'matt@bisoninfused.com'
  const contact = data.contacts.find(
    (c) => c.email && c.email.toLowerCase() === TEST_EMAIL,
  )
  if (!contact) {
    return (
      <div className="surface-2 rounded p-2 text-muted">
        No contact found with email <span className="font-mono">{TEST_EMAIL}</span>. Click "Seed test scenario" on /settings.
      </div>
    )
  }
  const sends = data.emailSends.filter((s) => s.contactId === contact.id)
  const matchingSend = sends.find(
    (s) =>
      s.openedAt &&
      !s.repliedAt &&
      Date.now() - new Date(s.openedAt).getTime() > 24 * 60 * 60 * 1000 &&
      Date.now() - new Date(s.openedAt).getTime() < 5 * 24 * 60 * 60 * 1000,
  )
  return (
    <div className="surface-2 rounded p-2 space-y-1">
      <div>Contact found: <strong className="text-body">{contact.firstName} {contact.lastName}</strong> · status="{contact.status}" · id=<span className="font-mono">{contact.id}</span></div>
      <div>Email sends to this contact: {sends.length}</div>
      {sends.map((s) => (
        <div key={s.id} className="font-mono text-[10px] pl-2 border-l-2 border-[var(--border)]">
          id={s.id} · sentAt={s.sentAt?.slice(0, 10)} · openedAt={s.openedAt?.slice(0, 10) || '—'} · repliedAt={s.repliedAt?.slice(0, 10) || '—'}
        </div>
      ))}
      <div className="mt-1">
        Matches R-101 window (openedAt 1-5 days ago, no reply): {matchingSend ? <span className="text-[var(--color-success)]">YES</span> : <span className="text-[var(--color-danger)]">NO</span>}
      </div>
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
  onRunNow,
}: {
  proposal: Proposal
  data: SheetData
  loading: boolean
  onApprove: (draft?: DraftResult) => void
  onApproveNow: (draft?: DraftResult) => void
  onSkip: () => void
  onRunNow: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draft, setDraft] = useState<DraftResult | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState(false)
  const isExecuted = proposal.status === 'executed'
  const isFailed = proposal.status === 'failed'
  const isSendable = proposal.actionKind === 'send-email' || proposal.actionKind === 'send-sms'

  const subjectChips = useMemo(() => buildSubjectChips(proposal, data), [proposal, data])
  const actionDetails = useMemo(() => describeAction(proposal), [proposal])

  const handleDraft = async () => {
    setDrafting(true)
    setDraftError(null)
    try {
      const result = await aiDraftMessage(proposal, data)
      setDraft(result)
      setEditingDraft(true)
      setExpanded(true)
    } catch (err) {
      setDraftError((err as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  return (
    <Card padded={false} className={cn(
      'transition-all',
      proposal.priority === 'critical' && 'border-[var(--color-danger)]/30',
      isExecuted && 'opacity-70',
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
            {/* AI draft (sendable proposals) */}
            {draft && editingDraft && (
              <div className="surface-2 rounded-[var(--radius-md)] p-3 flex flex-col gap-2 border border-[color:rgba(122,94,255,0.2)]">
                <div className="flex items-center gap-1.5">
                  <Wand2 size={12} className="text-[var(--color-brand-600)]" />
                  <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
                    Claude draft — edit before approving
                  </span>
                  <button
                    onClick={handleDraft}
                    className="ml-auto text-[10px] text-muted hover:text-body inline-flex items-center gap-1"
                    disabled={drafting}
                  >
                    <RefreshCw size={10} /> Regenerate
                  </button>
                </div>
                {proposal.actionKind === 'send-email' && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Subject</div>
                    <Input
                      value={draft.subject}
                      onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                      className="text-[12px]"
                    />
                  </div>
                )}
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Body</div>
                  <Textarea
                    value={draft.body}
                    onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                    rows={proposal.actionKind === 'send-sms' ? 3 : 8}
                    className="text-[12px]"
                  />
                  {proposal.actionKind === 'send-sms' && (
                    <div className="text-[10px] text-muted mt-1 text-right">
                      {draft.body.length}/320 chars · {Math.ceil(draft.body.length / 160) || 1} segment(s)
                    </div>
                  )}
                </div>
                <div className="text-[10px] text-[var(--text-faint)] flex items-center justify-between">
                  <span>Model: {draft.model}</span>
                  <span>Approve to save the draft into a handoff task — you send manually until auto-send is enabled.</span>
                </div>
              </div>
            )}
            {draftError && (
              <div className="text-[11px] text-[var(--color-danger)] surface-2 rounded p-2">
                Draft failed: {draftError}. Make sure your Anthropic key is set in Settings.
              </div>
            )}

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
            {proposal.status === 'approved' ? (
              <>
                <Badge tone="warning">Approved · awaiting run</Badge>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Zap size={12} />}
                  onClick={onRunNow}
                  disabled={loading}
                >
                  Run now
                </Button>
              </>
            ) : proposal.status === 'executed' ? (
              <Badge tone="success">Executed</Badge>
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
                {isSendable && !draft && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Wand2 size={12} />}
                    onClick={handleDraft}
                    disabled={drafting || loading}
                  >
                    {drafting ? 'Drafting…' : 'Draft with AI'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<CheckCircle2 size={12} />}
                  onClick={() => onApprove(draft || undefined)}
                  disabled={loading}
                >
                  Approve
                </Button>
                {proposal.risk !== 'sensitive' && (
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<Zap size={12} />}
                    onClick={() => onApproveNow(draft || undefined)}
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

// ============================================================
// Strategist row (renders ad-hoc Claude-generated proposals)
// ============================================================

function StrategistRow({
  proposal,
  onApply,
  onDismiss,
}: {
  proposal: StrategistProposal
  onApply: () => Promise<void> | void
  onDismiss: () => void
}) {
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  return (
    <div className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-body">{proposal.title}</span>
            <Badge tone={proposal.priority === 'critical' ? 'danger' : proposal.priority === 'high' ? 'warning' : proposal.priority === 'medium' ? 'info' : 'neutral'}>
              {proposal.priority}
            </Badge>
            <Badge tone={proposal.risk === 'sensitive' ? 'danger' : proposal.risk === 'moderate' ? 'warning' : 'success'}>
              {proposal.risk}
            </Badge>
            <Badge tone="brand">{proposal.confidence}/100</Badge>
          </div>
          <div className="text-[12px] text-muted mt-1 leading-relaxed">{proposal.reason}</div>
          {proposal.expectedOutcome && (
            <div className="text-[11px] text-[var(--text-faint)] mt-1">→ {proposal.expectedOutcome}</div>
          )}
          {proposal.actionKind === 'send-email' && proposal.draftedBody && (
            <details className="mt-2">
              <summary className="text-[11px] text-muted cursor-pointer hover:text-body">View drafted email</summary>
              <div className="mt-1.5 surface-2 rounded-[var(--radius-sm)] p-2 text-[11px] font-mono whitespace-pre-wrap">
                {proposal.draftedSubject && <div className="font-semibold mb-1">{proposal.draftedSubject}</div>}
                {proposal.draftedBody}
              </div>
            </details>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="ghost" icon={<X size={11} />} onClick={onDismiss}>Skip</Button>
          <Button
            size="sm"
            variant="primary"
            icon={applying ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
            disabled={applying}
            onClick={async () => {
              setApplying(true)
              try {
                await onApply()
                setResult({ ok: true, message: 'Applied.' })
              } catch (err) {
                setResult({ ok: false, message: (err as Error).message })
              } finally {
                setApplying(false)
              }
            }}
          >
            {applying ? 'Applying…' : 'Apply'}
          </Button>
        </div>
      </div>
      {result && (
        <div className={cn(
          'mt-2 text-[11px]',
          result.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
        )}>
          {result.message}
        </div>
      )}
    </div>
  )
}

// Apply a strategist proposal — translate into the appropriate api.* call
async function applyStrategistProposal(p: StrategistProposal, data: SheetData): Promise<void> {
  const now = new Date().toISOString()

  if (p.actionKind === 'send-email' && p.draftedSubject && p.draftedBody) {
    // Resolve recipient
    let to = ''
    if (p.contactRef) {
      const c = data.contacts.find((x) => x.id === p.contactRef)
      to = c?.email || ''
    }
    if (!to) throw new Error('No recipient email — strategist proposal needs a contactRef with a valid email.')
    const res = await invokeAction('sendBdrEmail', {
      to,
      subject: p.draftedSubject,
      body: p.draftedBody,
      contactId: p.contactRef || '',
      trackOpens: true,
    })
    if (!res.ok) throw new Error(res.error || 'Send failed')
    return
  }

  if (p.actionKind === 'create-task' || p.actionKind === 'research') {
    const res = await api.task.create({
      title: p.taskTitle || p.title,
      dueDate: now,
      priority: p.priority === 'critical' ? 'high' : p.priority === 'high' ? 'high' : 'medium',
      contactId: p.contactRef || '',
      dealId: p.dealRef || '',
      notes: p.taskNotes || `[AI Strategist] ${p.reason}\n\nExpected: ${p.expectedOutcome}`,
      status: 'open',
      createdAt: now,
    })
    if (!res.ok) throw new Error(res.error || 'Task create failed')
    return
  }

  if (p.actionKind === 'log-activity' && p.contactRef) {
    const res = await api.activityLog.create({
      entityType: 'contact',
      entityId: p.contactRef,
      kind: 'other',
      outcome: '',
      body: p.taskNotes || p.reason,
      durationMinutes: 0,
      occurredAt: now,
      createdAt: now,
      author: 'AI Strategist',
    })
    if (!res.ok) throw new Error(res.error || 'Log failed')
    return
  }

  if (p.actionKind === 'create-note' && p.contactRef) {
    const res = await api.note.create({
      entityType: 'contact',
      entityId: p.contactRef,
      body: p.reason + (p.expectedOutcome ? `\n\nExpected: ${p.expectedOutcome}` : ''),
      author: 'AI Strategist',
      createdAt: now,
    })
    if (!res.ok) throw new Error(res.error || 'Note failed')
    return
  }

  if (p.actionKind === 'update-deal' && p.dealRef) {
    // Create a task to do the update — full natural-language deal updates
    // are Phase 3.
    const res = await api.task.create({
      title: 'Deal update: ' + p.title,
      dueDate: now,
      priority: 'medium',
      dealId: p.dealRef,
      contactId: p.contactRef || '',
      notes: `[AI Strategist] ${p.reason}\n\n${p.taskNotes || p.expectedOutcome}`,
      status: 'open',
      createdAt: now,
    })
    if (!res.ok) throw new Error(res.error || 'Task create failed')
    return
  }

  if (p.actionKind === 'create-deal' && p.contactRef) {
    const c = data.contacts.find((x) => x.id === p.contactRef)
    const res = await api.deal.create({
      title: p.taskTitle || p.title,
      contactId: p.contactRef,
      companyId: c?.companyId || '',
      value: 0,
      stage: 'Lead',
      probability: 10,
      notes: `[AI Strategist] ${p.reason}`,
      createdAt: now,
    })
    if (!res.ok) throw new Error(res.error || 'Deal create failed')
    return
  }

  // Fallback: log as a task so nothing's lost
  const res = await api.task.create({
    title: p.title,
    dueDate: now,
    priority: 'medium',
    contactId: p.contactRef || '',
    dealId: p.dealRef || '',
    notes: `[AI Strategist · ${p.actionKind}] ${p.reason}\n\n${p.taskNotes || ''}`,
    status: 'open',
    createdAt: now,
  })
  if (!res.ok) throw new Error(res.error || 'Task create failed')
}
