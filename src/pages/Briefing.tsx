import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Sparkles, RefreshCw, Brain, ArrowRight, MessageCircle,
  Flame, Calendar, CheckSquare, Clock, AlertTriangle, Briefcase, Send,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, PageHeader, Stat, Badge, Button, Empty } from '../components/ui'
import { generateBriefing, type BriefingItem } from '../lib/briefing'
import { cn } from '../lib/cn'

export function Briefing() {
  const { state, refresh } = useSheetData()
  const [refreshTick, setRefreshTick] = useState(0)
  const data = 'data' in state ? state.data : undefined

  const briefing = useMemo(() => {
    if (!data) return null
    void refreshTick
    return generateBriefing(data)
  }, [data, refreshTick])

  if (!data) return <PageHeader title="AI BDR" />
  if (!briefing) return null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--color-brand-600)]" />
            AI BDR
          </span>
        }
        subtitle="Your daily briefing — what to focus on, who to reach, what's at risk."
        action={
          <div className="flex items-center gap-2">
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
            <p className="text-[15px] text-body leading-relaxed">{briefing.summary}</p>
          </div>
        </div>
      </Card>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat
          label="Replies waiting"
          value={briefing.stats.recentReplies.toString()}
          deltaTone={briefing.stats.recentReplies > 0 ? 'success' : undefined}
        />
        <Stat
          label="Hot leads"
          value={briefing.stats.hotLeads.toString()}
          deltaTone={briefing.stats.hotLeads > 0 ? 'success' : undefined}
        />
        <Stat label="Meetings today" value={briefing.stats.todaysBookings.toString()} />
        <Stat label="Tasks due" value={briefing.stats.dueToday.toString()} />
        <Stat
          label="Stale pipeline"
          value={briefing.stats.stalePipeline.toString()}
          deltaTone={briefing.stats.stalePipeline > 0 ? 'danger' : undefined}
        />
      </div>

      {briefing.sections.length === 0 ? (
        <Empty
          icon={<Sparkles size={22} />}
          title="Quiet day — nothing urgent"
          description="No replies, hot leads, due tasks, or stale deals. Great time for some prospecting."
        />
      ) : (
        <div className="flex flex-col gap-5">
          {briefing.sections.map((section) => (
            <Card key={section.id} padded={false}>
              <div className="px-5 py-4 border-soft-b">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-[18px]">{section.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-[15px] font-semibold text-body">{section.title}</h3>
                    {section.subtitle && (
                      <p className="text-[12px] text-muted mt-0.5">{section.subtitle}</p>
                    )}
                  </div>
                  <Badge tone="neutral">{section.items.length}</Badge>
                </div>
              </div>
              <ul className="divide-y divide-[color:var(--border)]">
                {section.items.map((item) => (
                  <BriefingRow key={item.id} item={item} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {/* Footer note */}
      <Card>
        <div className="flex items-start gap-3 text-[12px]">
          <Brain size={14} className="text-[var(--text-faint)] mt-0.5 shrink-0" />
          <div className="text-muted">
            <strong className="text-body">Heuristic mode.</strong> Priorities are computed
            locally from your CRM data — no LLM calls, runs instantly. To get
            narrative reasoning ("why this lead matters") and personalized
            outreach drafts, add an Anthropic or OpenAI API key in Settings.
          </div>
        </div>
      </Card>
    </div>
  )
}

function BriefingRow({ item }: { item: BriefingItem }) {
  return (
    <li>
      <Link
        to={item.href || '#'}
        className={cn(
          'flex items-start gap-3 px-5 py-3 hover:surface-2 transition-colors group',
          item.priority === 'critical' && 'bg-[color:rgba(239,76,76,0.04)]',
        )}
      >
        <KindIcon kind={item.kind} priority={item.priority} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium text-body truncate">{item.headline}</span>
            {item.priority === 'critical' && <Badge tone="danger">urgent</Badge>}
            {item.priority === 'high' && <Badge tone="warning">priority</Badge>}
          </div>
          <div className="text-[12px] text-muted mt-0.5">{item.reason}</div>
          {item.detail && (
            <div className="text-[11px] text-[var(--text-faint)] mt-1 line-clamp-2">{item.detail}</div>
          )}
        </div>
        <ArrowRight size={14} className="text-[var(--text-faint)] group-hover:text-body transition-colors mt-1.5 shrink-0" />
      </Link>
    </li>
  )
}

function KindIcon({ kind, priority }: { kind: BriefingItem['kind']; priority: BriefingItem['priority'] }) {
  const cfg: Record<BriefingItem['kind'], { icon: React.ReactNode; bg: string; fg: string }> = {
    reply:    { icon: <MessageCircle size={13} />, bg: 'bg-[color:rgba(122,94,255,0.14)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' },
    lead:     { icon: <Flame size={13} />,         bg: 'bg-[color:rgba(245,165,36,0.14)]', fg: 'text-[var(--color-warning)]' },
    booking:  { icon: <Calendar size={13} />,      bg: 'bg-[color:rgba(59,130,246,0.12)]', fg: 'text-[var(--color-info)]' },
    task:     { icon: <CheckSquare size={13} />,   bg: 'bg-[var(--surface-3)]',           fg: 'text-muted' },
    deal:     { icon: <Briefcase size={13} />,     bg: 'bg-[color:rgba(239,76,76,0.10)]',  fg: 'text-[var(--color-danger)]' },
    sequence: { icon: <Send size={13} />,          bg: 'bg-[color:rgba(245,165,36,0.14)]', fg: 'text-[var(--color-warning)]' },
    contact:  { icon: <Clock size={13} />,         bg: 'bg-[var(--surface-3)]',           fg: 'text-muted' },
  }
  const c = cfg[kind] || cfg.task
  return (
    <span
      className={cn(
        'w-7 h-7 rounded-full grid place-items-center shrink-0 mt-0.5',
        c.bg, c.fg,
        priority === 'critical' && 'ring-2 ring-[color:rgba(239,76,76,0.25)]',
      )}
    >
      {c.icon}
    </span>
  )
}

void AlertTriangle
