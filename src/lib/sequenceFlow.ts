// Sequence flow analyzer + layered-tree layout. Given a list of SequenceStep
// rows, produces:
//   • Reachability map (which steps the scheduler can actually fire from
//     step 0 forward).
//   • Edges (typed: 'linear' | 'true' | 'false' | 'action-branch') between
//     steps so a graph view can draw connections.
//   • Health issues — the "contacts get stuck" cases Matt wants to spot:
//       - Orphaned steps (unreachable from start)
//       - Branches with arms pointing at invalid indices
//       - Branches with arms that loop back to earlier steps (potential
//         infinite loops if the condition keeps re-evaluating)
//       - Final email/sms steps that aren't breakup-style ("dead-end
//         content")
//   • Layout: each step assigned a (column, row) coordinate via a
//     simple longest-path-from-start algorithm. Used by the visualizer.
//
// All pure functions — no side effects, no I/O. Easy to unit test.

import type { SequenceStep, StepType } from './types'

export interface ParsedStep {
  id: string
  index: number     // 0-based position in the ordered step list
  type: StepType
  label: string
  /** Parsed JSON config (best-effort; empty object if malformed). */
  config: Record<string, unknown>
}

export type FlowEdgeKind = 'linear' | 'true' | 'false' | 'exit'

export interface FlowEdge {
  fromIdx: number
  toIdx: number          // -1 = exits the sequence
  kind: FlowEdgeKind
  label?: string
}

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface FlowIssue {
  id: string
  severity: IssueSeverity
  stepIdx: number | null  // null for sequence-level issues
  title: string
  detail: string
}

export interface FlowLayout {
  steps: ParsedStep[]
  edges: FlowEdge[]
  /** Position per step idx — column = depth (0 = start), row = vertical lane */
  positions: Map<number, { col: number; row: number }>
  reachable: Set<number>
  issues: FlowIssue[]
  /** True if every step is reachable AND no errors. Used as the green/red gate. */
  healthy: boolean
}

// ============================================================
// Public API
// ============================================================

export function analyzeSequence(rawSteps: SequenceStep[]): FlowLayout {
  const steps = parseSteps(rawSteps)
  const edges = buildEdges(steps)
  const reachable = computeReachable(steps, edges)
  const positions = layoutLayered(steps, edges)
  const issues = computeIssues(steps, edges, reachable)
  const healthy = issues.every((i) => i.severity !== 'error') && reachable.size === steps.length
  return { steps, edges, positions, reachable, issues, healthy }
}

// ============================================================
// Parsing — turn raw rows into structured ParsedStep[]
// ============================================================

function parseSteps(rawSteps: SequenceStep[]): ParsedStep[] {
  return [...rawSteps]
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((s, i) => ({
      id: s.id,
      index: i,
      type: s.type,
      label: s.label || stepDefaultLabel(s.type, i),
      config: safeJson(s.config),
    }))
}

function stepDefaultLabel(type: string, i: number): string {
  return `Step ${i + 1} · ${type}`
}

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {}
  try { return JSON.parse(s) || {} } catch { return {} }
}

// ============================================================
// Edge building — what step does each step's outflow point at?
// ============================================================

function buildEdges(steps: ParsedStep[]): FlowEdge[] {
  const edges: FlowEdge[] = []
  for (const s of steps) {
    if (s.type === 'branch') {
      // Branch produces two outflows. Each can route to a specific step
      // (config.trueNext / falseNext, 0-based index) or fall through to
      // the next step (-1 default → next index) or exit (-2).
      const cfg = s.config
      const trueNext = resolveBranchTarget(cfg.trueNext, s.index, steps.length)
      const falseNext = resolveBranchTarget(cfg.falseNext, s.index, steps.length)
      edges.push({ fromIdx: s.index, toIdx: trueNext, kind: 'true', label: 'TRUE' })
      edges.push({ fromIdx: s.index, toIdx: falseNext, kind: 'false', label: 'FALSE' })
      continue
    }
    // Action steps with kind="end-sequence" exit explicitly.
    if (s.type === 'action') {
      const kind = String((s.config as { kind?: string }).kind || '')
      if (kind === 'end-sequence' || kind === 'unsubscribe-contact') {
        edges.push({ fromIdx: s.index, toIdx: -1, kind: 'exit', label: 'exit' })
        continue
      }
    }
    // Email/sms with replyBehavior:"exit" still flows to the next step
    // (the "exit" only fires if a reply is detected mid-flight; the
    // scheduler's normal advance doesn't honor that flag — checkReplies
    // does). So treat them as linear.
    // Linear advance: step N → step N+1
    const next = s.index + 1
    if (next >= steps.length) {
      edges.push({ fromIdx: s.index, toIdx: -1, kind: 'exit', label: 'end' })
    } else {
      edges.push({ fromIdx: s.index, toIdx: next, kind: 'linear' })
    }
  }
  return edges
}

function resolveBranchTarget(raw: unknown, fromIdx: number, total: number): number {
  if (raw === undefined || raw === null) return fromIdx + 1 < total ? fromIdx + 1 : -1
  const n = Number(raw)
  if (n === -1) return fromIdx + 1 < total ? fromIdx + 1 : -1
  if (n === -2) return -1 // exit
  if (Number.isFinite(n) && n >= 0 && n < total) return n
  // Invalid value — caller will flag it as an issue. Treat as exit so
  // the rest of layout doesn't try to walk to a nonexistent step.
  return -1
}

// ============================================================
// Reachability — BFS from step 0
// ============================================================

function computeReachable(steps: ParsedStep[], edges: FlowEdge[]): Set<number> {
  const reachable = new Set<number>()
  if (steps.length === 0) return reachable
  reachable.add(0)
  const stack = [0]
  // Group edges by fromIdx for O(1) lookup
  const out = new Map<number, FlowEdge[]>()
  for (const e of edges) {
    if (!out.has(e.fromIdx)) out.set(e.fromIdx, [])
    out.get(e.fromIdx)!.push(e)
  }
  while (stack.length) {
    const cur = stack.pop()!
    for (const e of out.get(cur) || []) {
      if (e.toIdx >= 0 && !reachable.has(e.toIdx)) {
        reachable.add(e.toIdx)
        stack.push(e.toIdx)
      }
    }
  }
  return reachable
}

// ============================================================
// Layout — assign (col, row) coordinates per step
// ============================================================
// Algorithm: BFS from step 0 to compute MIN-depth (column). Then for
// each column, distribute steps into rows top-to-bottom in order of
// their first-discovered position. Branches whose arms diverge get
// their child steps placed in adjacent columns automatically by virtue
// of having greater min-depth.

function layoutLayered(steps: ParsedStep[], edges: FlowEdge[]): Map<number, { col: number; row: number }> {
  const positions = new Map<number, { col: number; row: number }>()
  if (steps.length === 0) return positions

  // Min depth per step
  const depth = new Map<number, number>()
  depth.set(0, 0)
  const queue = [0]
  const out = new Map<number, FlowEdge[]>()
  for (const e of edges) {
    if (!out.has(e.fromIdx)) out.set(e.fromIdx, [])
    out.get(e.fromIdx)!.push(e)
  }
  while (queue.length) {
    const cur = queue.shift()!
    const curDepth = depth.get(cur)!
    for (const e of out.get(cur) || []) {
      if (e.toIdx < 0) continue
      const newDepth = curDepth + 1
      if (!depth.has(e.toIdx) || depth.get(e.toIdx)! > newDepth) {
        depth.set(e.toIdx, newDepth)
        queue.push(e.toIdx)
      }
    }
  }

  // Steps that aren't reachable get placed in their own "orphan" column
  // far right so they're visually isolated.
  let maxDepth = 0
  for (const d of depth.values()) maxDepth = Math.max(maxDepth, d)
  for (const s of steps) {
    if (!depth.has(s.index)) depth.set(s.index, maxDepth + 2)
  }

  // Bucket by column
  const byCol = new Map<number, number[]>()
  for (const s of steps) {
    const c = depth.get(s.index)!
    if (!byCol.has(c)) byCol.set(c, [])
    byCol.get(c)!.push(s.index)
  }
  // Within each column, sort by step index (so step order roughly maps to row order)
  for (const arr of byCol.values()) arr.sort((a, b) => a - b)

  for (const [col, idxs] of byCol.entries()) {
    idxs.forEach((idx, row) => {
      positions.set(idx, { col, row })
    })
  }

  return positions
}

// ============================================================
// Issue detection — what could trip up the scheduler?
// ============================================================

function computeIssues(steps: ParsedStep[], edges: FlowEdge[], reachable: Set<number>): FlowIssue[] {
  const issues: FlowIssue[] = []

  if (steps.length === 0) {
    issues.push({ id: 'no-steps', severity: 'error', stepIdx: null, title: 'Sequence has no steps', detail: 'Add at least one step before launching.' })
    return issues
  }

  // 1. Unreachable steps
  for (const s of steps) {
    if (!reachable.has(s.index)) {
      issues.push({
        id: `unreachable-${s.id}`,
        severity: 'warning',
        stepIdx: s.index,
        title: `Step ${s.index + 1} is unreachable`,
        detail: 'No path from the start of the sequence reaches this step. It will never fire — either delete it or wire a branch to point at it.',
      })
    }
  }

  // 2. Branch arms pointing at invalid indices
  for (const s of steps) {
    if (s.type !== 'branch') continue
    const cfg = s.config as { trueNext?: unknown; falseNext?: unknown }
    for (const arm of ['trueNext', 'falseNext'] as const) {
      const raw = cfg[arm]
      if (raw === undefined || raw === null) continue
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        issues.push({
          id: `branch-bad-${s.id}-${arm}`,
          severity: 'error',
          stepIdx: s.index,
          title: `Branch ${arm} is not a number`,
          detail: `Step ${s.index + 1}'s ${arm} = "${String(raw)}" — branches need integer step indexes (or -1 for "next" / -2 for "exit").`,
        })
        continue
      }
      if (n === -1 || n === -2) continue // sentinel values
      if (n < 0 || n >= steps.length) {
        issues.push({
          id: `branch-oob-${s.id}-${arm}`,
          severity: 'error',
          stepIdx: s.index,
          title: `Branch ${arm} points outside the sequence`,
          detail: `Step ${s.index + 1}'s ${arm} = ${n}, but the sequence only has steps 1-${steps.length}. Contact will get stuck.`,
        })
      }
      // Loop detection: arm points back to an earlier or equal index
      if (n >= 0 && n <= s.index) {
        issues.push({
          id: `branch-loop-${s.id}-${arm}`,
          severity: 'warning',
          stepIdx: s.index,
          title: `Branch ${arm} loops back to step ${n + 1}`,
          detail: 'Routing to an earlier step risks infinite loops if the branch condition keeps re-evaluating. If intentional, ignore — but most of the time this is a mistake.',
        })
      }
    }
  }

  // 3. Branches where both arms route to the same place — the branch is
  // a no-op. Usually a sign the AI generated a half-finished branch.
  for (const s of steps) {
    if (s.type !== 'branch') continue
    const armEdges = edges.filter((e) => e.fromIdx === s.index)
    if (armEdges.length === 2 && armEdges[0].toIdx === armEdges[1].toIdx) {
      issues.push({
        id: `branch-noop-${s.id}`,
        severity: 'info',
        stepIdx: s.index,
        title: `Branch step ${s.index + 1} routes both arms to the same step`,
        detail: 'Both TRUE and FALSE go to the same place — the branch isn\'t doing any routing. Either add different targets per arm or replace with a simple wait.',
      })
    }
  }

  // 4. Final non-breakup email — content dead end
  if (steps.length >= 4) {
    const last = steps[steps.length - 1]
    if (last.type === 'email') {
      const body = String((last.config as { body?: string }).body || '').toLowerCase()
      const looksLikeBreakup = /close (your|this) file|last (one|message|email)|moving on|stop hearing from me|won't bother|appreciate the time/i.test(body)
      if (!looksLikeBreakup) {
        issues.push({
          id: 'no-breakup',
          severity: 'info',
          stepIdx: last.index,
          title: `Final email isn't a "breakup"`,
          detail: 'Optional but recommended — "permission to close your file" emails get the highest reply rate of the sequence and gracefully exit prospects who never engage.',
        })
      }
    }
  }

  // 5. Branch arms that point to step indexes that are themselves
  // unreachable from the start — happens when AI references a step
  // that gets pruned later.
  for (const e of edges) {
    if (e.kind === 'true' || e.kind === 'false') {
      if (e.toIdx >= 0 && !reachable.has(e.toIdx)) {
        // The toIdx itself is unreachable — but since we're following an edge
        // to it, the unreachable analysis already covered it. Skip duplicate.
        continue
      }
    }
  }

  return issues
}
