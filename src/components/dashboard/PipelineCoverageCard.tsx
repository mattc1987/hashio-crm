// Pipeline coverage — math-y view of how much pipeline you have vs how much
// MRR you'd need to add. Helps Matt see "Do I have enough deals to hit
// next quarter's number?"
//
// Math is local + transparent (no LLM call) — but the AI BDR briefing card
// above can call this out as a priority when coverage is thin.

import { useMemo } from 'react'
import { Target, TrendingUp, AlertCircle } from 'lucide-react'
import { Card, CardHeader, Badge } from '../ui'
import type { Deal } from '../../lib/types'
import { totalActiveMRR, currency } from '../../lib/format'
import { cn } from '../../lib/cn'

interface Props {
  deals: Deal[]
  /** Target MRR to hit (defaults to a reasonable next-step from current MRR). */
  targetMRR?: number
}

export function PipelineCoverageCard({ deals, targetMRR }: Props) {
  const stats = useMemo(() => {
    const currentMRR = totalActiveMRR(deals)
    const target = targetMRR ?? Math.max(currentMRR * 1.5, 25000) // default: 50% growth or $25K floor
    const gap = Math.max(0, target - currentMRR)

    const open = deals.filter((d) => !d.stage.startsWith('Closed'))
    const openMRR = open.reduce((s, d) => s + (d.mrr || 0), 0)
    const weightedMRR = open.reduce((s, d) => s + (d.mrr || 0) * ((d.probability || 0) / 100), 0)

    // Coverage ratio: how many times over does pipeline cover the gap?
    const coverage = gap > 0 ? (weightedMRR / gap) : Infinity

    // SaaS rule of thumb: you want ~3x weighted pipeline coverage of your gap
    let status: 'healthy' | 'thin' | 'critical' = 'healthy'
    let comment = ''
    if (gap === 0) {
      status = 'healthy'
      comment = 'You\'re at target. Time to set a higher one.'
    } else if (coverage >= 3) {
      status = 'healthy'
      comment = `${coverage.toFixed(1)}x weighted coverage of the gap. You\'re in good shape.`
    } else if (coverage >= 1.5) {
      status = 'thin'
      comment = `${coverage.toFixed(1)}x weighted coverage. Healthy is 3x — close some deals or add pipeline.`
    } else {
      status = 'critical'
      comment = `Only ${coverage.toFixed(1)}x coverage. Need to add ~${currency(gap * 3 - weightedMRR, { compact: true })} of pipeline to be safe.`
    }

    return {
      currentMRR,
      target,
      gap,
      openCount: open.length,
      openMRR,
      weightedMRR,
      coverage,
      status,
      comment,
    }
  }, [deals, targetMRR])

  return (
    <Card>
      <CardHeader
        title="Pipeline coverage"
        subtitle="MRR target vs pipeline coverage. SaaS rule: 3x weighted is healthy."
        action={<CoverageBadge status={stats.status} />}
      />

      <div className="grid grid-cols-2 gap-4">
        <Metric label="Current MRR" value={currency(stats.currentMRR, { compact: true })} />
        <Metric label="Target MRR" value={currency(stats.target, { compact: true })} hint="50% above current" />
        <Metric label="Gap to target" value={currency(stats.gap, { compact: true })} tone={stats.gap > 0 ? 'warning' : 'success'} />
        <Metric
          label="Weighted pipeline"
          value={currency(stats.weightedMRR, { compact: true })}
          hint={`${stats.openCount} open deal${stats.openCount === 1 ? '' : 's'}`}
        />
      </div>

      <div className="mt-4 surface-2 rounded-[var(--radius-md)] p-3 text-[12px] flex items-start gap-2">
        <span className={cn(
          'shrink-0 mt-0.5',
          stats.status === 'critical' ? 'text-[var(--color-danger)]' :
          stats.status === 'thin' ? 'text-[var(--color-warning)]' :
          'text-[var(--color-success)]',
        )}>
          {stats.status === 'critical' ? <AlertCircle size={14} /> :
           stats.status === 'thin' ? <Target size={14} /> :
           <TrendingUp size={14} />}
        </span>
        <span className="text-body">{stats.comment}</span>
      </div>
    </Card>
  )
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warning' | 'success' }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">{label}</div>
      <div className={cn(
        'font-display text-[20px] font-semibold tabular',
        tone === 'warning' && 'text-[var(--color-warning)]',
        tone === 'success' && 'text-[var(--color-success)]',
        !tone && 'text-body',
      )}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted mt-0.5">{hint}</div>}
    </div>
  )
}

function CoverageBadge({ status }: { status: 'healthy' | 'thin' | 'critical' }) {
  if (status === 'critical') return <Badge tone="danger">Critical</Badge>
  if (status === 'thin') return <Badge tone="warning">Thin</Badge>
  return <Badge tone="success">Healthy</Badge>
}
