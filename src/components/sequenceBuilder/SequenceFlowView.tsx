// Visual flow view for a sequence — layered tree with type-coded nodes
// and curved SVG edges. Used to spot:
//   • Orphaned steps (unreachable from start) → dotted red border
//   • Branches with bad arms → red border + issue chip
//   • Linear flow (gray edges)
//   • Branch TRUE arm (green edge)
//   • Branch FALSE arm (amber edge)
//   • Exit edges (dashed, gray)
//
// Layout: layered (column = depth from start, row = lane within column).
// All positions computed by analyzeSequence() in lib/sequenceFlow.ts.
//
// No external dep — just SVG. ~250 lines of view + ~200 of layout
// math elsewhere = full custom node graph for this app's needs.

import { useMemo } from 'react'
import {
  Mail, MessageSquare, Clock, GitBranch, Zap,
  AlertTriangle, AlertCircle, CheckCircle2, X, Info,
} from 'lucide-react'
import type { SequenceStep } from '../../lib/types'
import { analyzeSequence, type FlowEdge, type FlowIssue, type ParsedStep } from '../../lib/sequenceFlow'
import { cn } from '../../lib/cn'

// Layout constants
const NODE_W = 220
const NODE_H = 80
const COL_GAP = 80
const ROW_GAP = 28

const TYPE_META: Record<string, { icon: React.ComponentType<{ size?: number; className?: string }>; color: string; bg: string; label: string }> = {
  email:  { icon: Mail,          color: 'text-[var(--color-brand-700)]',                 bg: 'bg-[color:rgba(122,94,255,0.10)] border-[color:rgba(122,94,255,0.30)]', label: 'Email' },
  sms:    { icon: MessageSquare, color: 'text-[var(--color-success)]',                   bg: 'bg-[color:rgba(48,179,107,0.08)] border-[color:rgba(48,179,107,0.30)]',  label: 'SMS' },
  wait:   { icon: Clock,         color: 'text-muted',                                    bg: 'surface-2 border-[var(--border)]',                                       label: 'Wait' },
  branch: { icon: GitBranch,     color: 'text-[var(--color-warning)]',                   bg: 'bg-[color:rgba(245,165,36,0.10)] border-[color:rgba(245,165,36,0.30)]',  label: 'Branch' },
  action: { icon: Zap,           color: 'text-[var(--color-info)]',                      bg: 'bg-[color:rgba(59,130,246,0.10)] border-[color:rgba(59,130,246,0.30)]',  label: 'Action' },
}

export function SequenceFlowView({
  steps,
  selectedStepId,
  onStepClick,
}: {
  steps: SequenceStep[]
  selectedStepId?: string | null
  onStepClick?: (stepId: string) => void
}) {
  const flow = useMemo(() => analyzeSequence(steps), [steps])

  // Compute pixel coordinates from (col, row) grid
  const nodeXY = useMemo(() => {
    const xy = new Map<number, { x: number; y: number }>()
    flow.positions.forEach((pos, idx) => {
      xy.set(idx, {
        x: pos.col * (NODE_W + COL_GAP),
        y: pos.row * (NODE_H + ROW_GAP),
      })
    })
    return xy
  }, [flow])

  // Canvas size — find max x and y so SVG is sized correctly
  const { canvasW, canvasH } = useMemo(() => {
    let maxX = 0, maxY = 0
    nodeXY.forEach(({ x, y }) => {
      maxX = Math.max(maxX, x + NODE_W)
      maxY = Math.max(maxY, y + NODE_H)
    })
    return { canvasW: maxX + 60, canvasH: Math.max(maxY + 60, 200) }
  }, [nodeXY])

  // Issues by step idx for quick lookup in the node renderer
  const issuesByStep = useMemo(() => {
    const m = new Map<number, FlowIssue[]>()
    for (const i of flow.issues) {
      if (i.stepIdx === null) continue
      if (!m.has(i.stepIdx)) m.set(i.stepIdx, [])
      m.get(i.stepIdx)!.push(i)
    }
    return m
  }, [flow])

  if (flow.steps.length === 0) {
    return (
      <div className="text-center py-16 text-muted text-[13px]">
        No steps yet. Add steps to see the flow.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Health summary banner */}
      <HealthBanner issues={flow.issues} healthy={flow.healthy} totalSteps={flow.steps.length} reachableCount={flow.reachable.size} />

      {/* The graph itself */}
      <div className="surface-2 rounded-[var(--radius-md)] p-4 overflow-auto">
        <svg
          width={canvasW}
          height={canvasH}
          style={{ minWidth: '100%', display: 'block' }}
        >
          {/* Draw edges first (behind nodes) */}
          {flow.edges.map((edge, i) => (
            <FlowEdgeView
              key={`edge-${edge.fromIdx}-${edge.toIdx}-${edge.kind}-${i}`}
              edge={edge}
              from={nodeXY.get(edge.fromIdx)}
              to={edge.toIdx >= 0 ? nodeXY.get(edge.toIdx) : null}
              canvasH={canvasH}
            />
          ))}

          {/* Then nodes on top */}
          {flow.steps.map((step) => {
            const xy = nodeXY.get(step.index)
            if (!xy) return null
            const stepIssues = issuesByStep.get(step.index) || []
            const isReachable = flow.reachable.has(step.index)
            const isSelected = selectedStepId === step.id
            return (
              <foreignObject
                key={step.id}
                x={xy.x}
                y={xy.y}
                width={NODE_W}
                height={NODE_H}
                style={{ overflow: 'visible' }}
              >
                <NodeCard
                  step={step}
                  issues={stepIssues}
                  reachable={isReachable}
                  selected={isSelected}
                  onClick={() => onStepClick?.(step.id)}
                />
              </foreignObject>
            )
          })}
        </svg>
      </div>

      {/* Detailed issue list */}
      {flow.issues.length > 0 && (
        <IssueList issues={flow.issues} steps={flow.steps} onStepClick={onStepClick} />
      )}

      {/* Legend */}
      <Legend />
    </div>
  )
}

// ============================================================
// Node card — rendered inside an SVG <foreignObject> so we can use
// regular HTML/CSS for the rich node UI while SVG handles edges.
// ============================================================

function NodeCard({
  step, issues, reachable, selected, onClick,
}: {
  step: ParsedStep
  issues: FlowIssue[]
  reachable: boolean
  selected: boolean
  onClick: () => void
}) {
  const meta = TYPE_META[step.type] || TYPE_META['action']
  const Icon = meta.icon
  const hasError = issues.some((i) => i.severity === 'error')
  const hasWarn = issues.some((i) => i.severity === 'warning')

  // Sub-text per type
  const subtext = useMemo(() => {
    const cfg = step.config as Record<string, unknown>
    if (step.type === 'email')  return String(cfg.subject || '(no subject)').slice(0, 40)
    if (step.type === 'sms')    return String(cfg.body || '').slice(0, 40)
    if (step.type === 'wait')   return `Wait ${cfg.amount || 0} ${cfg.unit || 'days'}`
    if (step.type === 'branch') {
      const cond = cfg.condition as { kind?: string; withinHours?: number } | undefined
      return cond ? `if ${cond.kind || '?'}` : 'branch'
    }
    if (step.type === 'action') return `kind: ${(cfg.kind as string) || '?'}`
    return ''
  }, [step])

  return (
    <div
      onClick={onClick}
      className={cn(
        'h-full rounded-[var(--radius-md)] border-2 cursor-pointer transition-all',
        'p-2.5 flex flex-col gap-1',
        meta.bg,
        !reachable && 'opacity-60 border-dashed',
        hasError && 'border-[var(--color-danger)] ring-2 ring-[color:rgba(239,76,76,0.20)]',
        hasWarn && !hasError && 'border-[var(--color-warning)]',
        selected && 'ring-2 ring-[var(--color-brand-500)] ring-offset-2',
      )}
      title={step.label}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} className={cn('shrink-0', meta.color)} />
        <span className={cn('text-[10px] font-semibold uppercase tracking-wide truncate', meta.color)}>
          {meta.label}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-faint)] font-mono shrink-0">
          #{step.index + 1}
        </span>
        {(hasError || hasWarn) && (
          <AlertTriangle
            size={11}
            className={cn('shrink-0', hasError ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]')}
          />
        )}
      </div>
      <div className="text-[12px] font-medium text-body line-clamp-1 leading-tight">
        {step.label}
      </div>
      {subtext && (
        <div className="text-[10px] text-muted line-clamp-1 font-mono">{subtext}</div>
      )}
      {!reachable && (
        <div className="text-[10px] text-[var(--color-warning)] font-medium">
          ⚠ unreachable
        </div>
      )}
    </div>
  )
}

// ============================================================
// Edge — curved SVG path between two nodes, color-coded by kind
// ============================================================

function FlowEdgeView({
  edge, from, to, canvasH,
}: {
  edge: FlowEdge
  from: { x: number; y: number } | undefined
  to: { x: number; y: number } | null | undefined
  canvasH: number
}) {
  if (!from) return null

  // Edge starts at the right-middle of the source node.
  const x1 = from.x + NODE_W
  const y1 = from.y + NODE_H / 2

  // Exit edges drift off-canvas to a "stub" terminator
  const isExit = edge.toIdx === -1 || !to
  const x2 = isExit ? x1 + 60 : to!.x
  const y2 = isExit ? y1 : to!.y + NODE_H / 2

  // Curved path — control points pulled out horizontally for a
  // consistent flowing look that doesn't tangle on tight rows.
  const dx = Math.max(40, (x2 - x1) / 2)
  const path = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

  const strokeColor =
    edge.kind === 'true'   ? '#1f7c43' :   // green
    edge.kind === 'false'  ? '#946400' :   // amber
    edge.kind === 'exit'   ? '#9a9aa3' :   // light gray
    '#5e5e66'                              // medium gray (linear)

  const strokeDash = edge.kind === 'exit' ? '4 3' : edge.kind === 'linear' ? undefined : undefined

  void canvasH
  return (
    <g>
      <path
        d={path}
        stroke={strokeColor}
        strokeWidth={1.5}
        fill="none"
        strokeDasharray={strokeDash}
        opacity={0.7}
      />
      {/* Arrowhead via small triangle at the end */}
      {!isExit && (
        <polygon
          points={`${x2 - 6},${y2 - 4} ${x2},${y2} ${x2 - 6},${y2 + 4}`}
          fill={strokeColor}
          opacity={0.7}
        />
      )}
      {/* Exit terminator */}
      {isExit && (
        <text
          x={x2}
          y={y2 + 4}
          fontSize={10}
          fontFamily="monospace"
          fill={strokeColor}
        >
          → end
        </text>
      )}
      {/* Label for branch arms (TRUE/FALSE) */}
      {(edge.kind === 'true' || edge.kind === 'false') && (
        <text
          x={x1 + dx * 0.6}
          y={(y1 + y2) / 2 - 4}
          fontSize={10}
          fontWeight={600}
          fontFamily="-apple-system, system-ui, sans-serif"
          fill={strokeColor}
        >
          {edge.label}
        </text>
      )}
    </g>
  )
}

// ============================================================
// Health banner — top-of-view summary
// ============================================================

function HealthBanner({
  issues, healthy, totalSteps, reachableCount,
}: {
  issues: FlowIssue[]
  healthy: boolean
  totalSteps: number
  reachableCount: number
}) {
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.filter((i) => i.severity === 'warning').length

  if (healthy && issues.length === 0) {
    return (
      <div className="p-3 rounded-[var(--radius-md)] bg-[color:rgba(48,179,107,0.10)] border border-[color:rgba(48,179,107,0.20)] text-[13px] text-[var(--color-success)] flex items-center gap-2">
        <CheckCircle2 size={14} /> All {totalSteps} steps reachable, no structural issues.
      </div>
    )
  }
  return (
    <div className={cn(
      'p-3 rounded-[var(--radius-md)] border text-[13px] flex items-center gap-2 flex-wrap',
      errors > 0
        ? 'bg-[color:rgba(239,76,76,0.08)] border-[color:rgba(239,76,76,0.25)] text-[var(--color-danger)]'
        : 'bg-[color:rgba(245,165,36,0.08)] border-[color:rgba(245,165,36,0.25)] text-body',
    )}>
      {errors > 0
        ? <AlertCircle size={14} className="text-[var(--color-danger)]" />
        : <AlertTriangle size={14} className="text-[var(--color-warning)]" />}
      <span className="font-medium">
        {errors > 0 ? `${errors} error${errors === 1 ? '' : 's'}` : ''}
        {errors > 0 && warnings > 0 ? ' · ' : ''}
        {warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'}` : ''}
      </span>
      <span className="text-muted">
        · {reachableCount} of {totalSteps} steps reachable
      </span>
    </div>
  )
}

// ============================================================
// Issue list — fix-it details with click-to-jump
// ============================================================

function IssueList({
  issues, steps, onStepClick,
}: {
  issues: FlowIssue[]
  steps: ParsedStep[]
  onStepClick?: (id: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">
        Issues to review
      </div>
      {issues.map((iss) => {
        const step = iss.stepIdx !== null ? steps[iss.stepIdx] : null
        const SIcon = iss.severity === 'error' ? AlertCircle :
                      iss.severity === 'warning' ? AlertTriangle :
                      Info
        return (
          <div
            key={iss.id}
            onClick={() => step && onStepClick?.(step.id)}
            className={cn(
              'p-2.5 rounded-[var(--radius-md)] border flex items-start gap-2 text-[12px]',
              step && 'cursor-pointer hover:surface-2',
              iss.severity === 'error' && 'border-[color:rgba(239,76,76,0.25)] bg-[color:rgba(239,76,76,0.04)]',
              iss.severity === 'warning' && 'border-[color:rgba(245,165,36,0.25)] bg-[color:rgba(245,165,36,0.04)]',
              iss.severity === 'info' && 'border-[var(--border)]',
            )}
          >
            <SIcon
              size={14}
              className={cn(
                'mt-0.5 shrink-0',
                iss.severity === 'error' ? 'text-[var(--color-danger)]' :
                iss.severity === 'warning' ? 'text-[var(--color-warning)]' :
                'text-muted',
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-body">{iss.title}</div>
              <div className="text-muted mt-0.5 leading-relaxed">{iss.detail}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// Legend
// ============================================================

function Legend() {
  return (
    <div className="flex items-center gap-4 flex-wrap text-[10px] text-muted px-1">
      <LegendKey color="#5e5e66" label="Linear flow" />
      <LegendKey color="#1f7c43" label="Branch TRUE" />
      <LegendKey color="#946400" label="Branch FALSE" />
      <LegendKey color="#9a9aa3" label="Exit" dashed />
      <span className="text-[var(--text-faint)]">·</span>
      <span><X size={9} className="inline -mt-0.5 mr-0.5 text-[var(--color-danger)]" /> error</span>
      <span><AlertTriangle size={9} className="inline -mt-0.5 mr-0.5 text-[var(--color-warning)]" /> warning</span>
    </div>
  )
}

function LegendKey({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={20} height={2}>
        <line x1={0} y1={1} x2={20} y2={1} stroke={color} strokeWidth={1.5} strokeDasharray={dashed ? '3 2' : undefined} />
      </svg>
      <span>{label}</span>
    </span>
  )
}
