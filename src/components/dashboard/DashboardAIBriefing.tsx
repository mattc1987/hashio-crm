// Dashboard AI Briefing — top-of-page strategist read.
// Auto-runs on mount, narrates the day, returns 3-7 prioritized actions
// each clickable to drill into the relevant entity.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, RefreshCw, Brain, AlertCircle, ArrowRight,
  MessageCircle, Flame, Briefcase, Calendar, CheckSquare, Search,
  TrendingUp, TrendingDown, Activity,
} from 'lucide-react'
import { Card, Badge } from '../ui'
import { dashboardBriefing, type DashboardBriefing, type DashboardPriority, type SuggestEntity } from '../../lib/bdrAi'
import { hasWriteBackend } from '../../lib/api'
import { AIBdrDrawer } from '../AIBdrDrawer'
import { LeadGenerationDrawer } from './LeadGenerationDrawer'
import type { Contact, Deal, Lead, Task, SheetData } from '../../lib/types'
import { cn } from '../../lib/cn'

interface Props {
  data: SheetData
}

// Cache the briefing across page navigations so we don't re-spam Claude.
// Cleared on manual refresh or when CRM data hash changes meaningfully.
let CACHED_BRIEFING: { briefing: DashboardBriefing; cachedAt: number } | null = null
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min

export function DashboardAIBriefing({ data }: Props) {
  const navigate = useNavigate()
  const [briefing, setBriefing] = useState<DashboardBriefing | null>(CACHED_BRIEFING?.briefing || null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiDrawerEntity, setAiDrawerEntity] = useState<SuggestEntity | null>(null)
  const [findLeadsOpen, setFindLeadsOpen] = useState(false)

  const load = async (force = false) => {
    if (!force && CACHED_BRIEFING && (Date.now() - CACHED_BRIEFING.cachedAt) < CACHE_TTL_MS) {
      setBriefing(CACHED_BRIEFING.briefing)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const b = await dashboardBriefing(data)
      if (b) {
        CACHED_BRIEFING = { briefing: b, cachedAt: Date.now() }
        setBriefing(b)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!hasWriteBackend()) return
    if (!CACHED_BRIEFING) load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!hasWriteBackend()) return null

  const handlePriorityClick = (p: DashboardPriority) => {
    if (p.entityType === 'find-leads') {
      setFindLeadsOpen(true)
      return
    }
    if (p.entityType === 'contact' && p.entityId) {
      const c = data.contacts.find((x: Contact) => x.id === p.entityId)
      if (c) {
        setAiDrawerEntity({ kind: 'contact', contact: c })
        return
      }
    }
    if (p.entityType === 'deal' && p.entityId) {
      const d = data.deals.find((x: Deal) => x.id === p.entityId)
      if (d) {
        setAiDrawerEntity({ kind: 'deal', deal: d })
        return
      }
    }
    if (p.entityType === 'lead' && p.entityId) {
      const l = data.leads.find((x: Lead) => x.id === p.entityId)
      if (l) {
        setAiDrawerEntity({ kind: 'lead', lead: l })
        return
      }
    }
    if (p.entityType === 'task' && p.entityId) {
      const t = data.tasks.find((x: Task) => x.id === p.entityId)
      if (t) {
        setAiDrawerEntity({ kind: 'task', task: t })
        return
      }
    }
    if (p.entityType === 'booking') {
      navigate('/scheduling')
      return
    }
  }

  return (
    <>
      <Card className="bg-gradient-to-br from-[color:rgba(122,94,255,0.08)] to-transparent border-[color:rgba(122,94,255,0.18)]">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full grid place-items-center bg-[var(--color-brand-600)] text-white shrink-0">
            <Brain size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={13} className="text-[var(--color-brand-600)]" />
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
                AI BDR · Daily briefing
              </span>
              {briefing?.generatedAt && (
                <span className="text-[10px] text-muted ml-auto">
                  generated {relativeTime(briefing.generatedAt)}
                </span>
              )}
              <button
                onClick={() => load(true)}
                disabled={loading}
                className="text-muted hover:text-body p-1 rounded-[var(--radius-sm)] hover:surface-2 disabled:opacity-50"
                title="Regenerate"
              >
                <RefreshCw size={12} className={cn(loading && 'animate-spin')} />
              </button>
            </div>

            {loading && !briefing && (
              <div className="text-[12px] text-muted">Reading the room… your AI BDR is reviewing replies, leads, and pipeline.</div>
            )}

            {error && (
              <div className="text-[12px] text-[var(--color-danger)] flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <div>
                  <div>{error}</div>
                  <button onClick={() => load(true)} className="underline mt-1">Retry</button>
                </div>
              </div>
            )}

            {briefing && (
              <>
                <div className="font-display font-semibold text-[15px] text-body mb-1">
                  {briefing.greeting}
                </div>
                <p className="text-[13px] text-body leading-relaxed">{briefing.narrative}</p>

                {briefing.pipelineHealth && (
                  <div className="mt-2 inline-flex items-center gap-1.5">
                    <PipelineHealthBadge health={briefing.pipelineHealth} />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {briefing && briefing.priorities.length > 0 && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {briefing.priorities.map((p, i) => (
              <PriorityCard key={i} p={p} onClick={() => handlePriorityClick(p)} />
            ))}
          </div>
        )}
      </Card>

      <AIBdrDrawer
        open={!!aiDrawerEntity}
        onClose={() => setAiDrawerEntity(null)}
        entity={aiDrawerEntity}
        data={data}
        goal="What's the single best next move on this entity right now? Look at recent activity + signals + draft any message that should go out."
        onApplied={() => setAiDrawerEntity(null)}
      />

      <LeadGenerationDrawer
        open={findLeadsOpen}
        onClose={() => setFindLeadsOpen(false)}
        data={data}
      />
    </>
  )
}

function PriorityCard({ p, onClick }: { p: DashboardPriority; onClick: () => void }) {
  const Icon = priorityIcon(p)
  const tone = urgencyTone(p.urgency)
  return (
    <button
      onClick={onClick}
      className={cn(
        'group text-left surface border-soft rounded-[var(--radius-md)] p-3 transition-all',
        'hover:border-[var(--color-brand-500)] hover:shadow-soft-sm',
      )}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <div className={cn('w-6 h-6 rounded-full grid place-items-center shrink-0 mt-0.5', tone.bg, tone.fg)}>
          <Icon size={11} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-body leading-snug">{p.title}</div>
        </div>
        <ArrowRight size={11} className="text-[var(--text-faint)] group-hover:text-body transition-colors mt-1.5 shrink-0" />
      </div>
      <div className="text-[11px] text-muted line-clamp-2 ml-8">{p.reason}</div>
      {p.urgency === 'critical' && (
        <Badge tone="danger" className="ml-8 mt-1.5">urgent</Badge>
      )}
    </button>
  )
}

function PipelineHealthBadge({ health }: { health: { status: string; comment: string } }) {
  if (health.status === 'critical') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-danger)]">
        <TrendingDown size={11} /> Pipeline critical · {health.comment}
      </span>
    )
  }
  if (health.status === 'thin') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-warning)]">
        <Activity size={11} /> Pipeline thin · {health.comment}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-success)]">
      <TrendingUp size={11} /> Pipeline healthy · {health.comment}
    </span>
  )
}

function priorityIcon(p: DashboardPriority) {
  if (p.entityType === 'lead' || p.actionHint === 'find-leads') return Flame
  if (p.entityType === 'find-leads') return Search
  if (p.entityType === 'deal' || p.actionHint === 'advance-deal') return Briefcase
  if (p.entityType === 'booking') return Calendar
  if (p.entityType === 'task') return CheckSquare
  if (p.actionHint === 'respond' || p.actionHint === 'send-email') return MessageCircle
  return Sparkles
}

function urgencyTone(u: 'critical' | 'high' | 'medium'): { bg: string; fg: string } {
  if (u === 'critical') return { bg: 'bg-[color:rgba(239,76,76,0.12)]', fg: 'text-[var(--color-danger)]' }
  if (u === 'high') return { bg: 'bg-[color:rgba(245,165,36,0.14)]', fg: 'text-[var(--color-warning)]' }
  return { bg: 'bg-[color:rgba(122,94,255,0.14)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`
  return `${Math.floor(diff / 86_400_000)} days ago`
}
