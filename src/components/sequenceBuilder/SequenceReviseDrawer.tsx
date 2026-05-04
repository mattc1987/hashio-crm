// "Ask AI to fix" drawer — opens from the flow visualizer when the user
// clicks the AI button on a node or asks for sequence-wide changes.
//
// Flow:
//   1. User selects a target step (or none for sequence-wide).
//   2. Types feedback like "this branch fires a breakup after one
//      unopened email, that makes no sense — make it try a different
//      subject line instead".
//   3. We send the full step list + feedback to aiReviseSequence.
//   4. Claude returns an ordered change list: patch/insert/delete.
//   5. We render a diff preview — user reviews, then clicks Apply.
//   6. Changes applied via api.sequenceStep CRUD with index-shift
//      tracking so inserts/deletes stay aligned.

import { useState } from 'react'
import {
  Sparkles, Loader2, X, Check, Plus, Pencil, Trash2, ArrowRight, AlertCircle,
} from 'lucide-react'
import { Button, Textarea, Badge } from '../ui'
import { invokeAction, api } from '../../lib/api'
import type { SequenceStep } from '../../lib/types'

interface ParsedStep {
  id: string
  index: number
  type: string
  label: string
  config: Record<string, unknown>
}

type Change =
  | { action: 'patch';  stepIdx: number; label?: string; config?: Record<string, unknown> }
  | { action: 'insert'; afterStepIdx: number; step: { type: string; label: string; config: Record<string, unknown> } }
  | { action: 'delete'; stepIdx: number }

interface RevisionResponse {
  rationale: string
  summary: string
  changes: Change[]
  model: string
}

export function SequenceReviseDrawer({
  open,
  steps,
  targetStepIdx,
  sequenceId,
  goalContext,
  onClose,
  onApplied,
}: {
  open: boolean
  steps: SequenceStep[]
  /** 0-based index in the ordered step list, or null for sequence-wide */
  targetStepIdx: number | null
  sequenceId: string
  goalContext?: { goal?: string; audience?: string; channels?: string[] }
  onClose: () => void
  onApplied?: () => void
}) {
  const [feedback, setFeedback] = useState('')
  const [phase, setPhase] = useState<'input' | 'thinking' | 'preview' | 'applying' | 'done'>('input')
  const [response, setResponse] = useState<RevisionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<{ ok: number; failed: number } | null>(null)

  if (!open) return null

  // Parse step configs once for preview rendering
  const parsed: ParsedStep[] = [...steps]
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((s, i) => ({
      id: s.id,
      index: i,
      type: s.type,
      label: s.label || `Step ${i + 1}`,
      config: safeJson(s.config),
    }))
  const targetStep = targetStepIdx !== null && targetStepIdx >= 0 && targetStepIdx < parsed.length ? parsed[targetStepIdx] : null

  const handleAskAI = async () => {
    if (!feedback.trim()) return
    setPhase('thinking')
    setError(null)
    setResponse(null)
    try {
      const res = await invokeAction('aiReviseSequence', {
        steps: parsed.map((p) => ({ type: p.type, label: p.label, config: p.config })),
        targetStepIdx,
        feedback: feedback.trim(),
        goalContext: goalContext || {},
      })
      if (!res.ok) throw new Error(res.error || 'AI revision failed')
      const data = (res as { data?: RevisionResponse }).data
      if (!data || !Array.isArray(data.changes)) throw new Error('Empty or malformed AI response')
      setResponse(data)
      setPhase('preview')
    } catch (err) {
      setError((err as Error).message)
      setPhase('input')
    }
  }

  const handleApply = async () => {
    if (!response) return
    setPhase('applying')

    // Apply changes in order. The trick: stepIdx values reference the
    // ORIGINAL list, but as we apply inserts/deletes, real indices shift.
    // We track that via an indexShift map keyed by original index → current
    // index, BUT the simpler approach is to operate on the ID layer:
    //   • For patch: look up step.id by original index → call api.sequenceStep.update
    //   • For delete: same — look up id, call api.sequenceStep.remove
    //   • For insert: compute the real "after" id (which is stable across other
    //     ops EXCEPT when delete also targeted that id — handle separately).
    // Then renumber `order` at the end.
    let ok = 0, failed = 0
    const idByOriginalIdx = new Map<number, string>()
    parsed.forEach((p) => idByOriginalIdx.set(p.index, p.id))

    // Build the new step list mentally so we can compute final orders.
    // Track survivors + their new order, plus inserts.
    const surviving = new Set<string>(parsed.map((p) => p.id))
    const inserts: Array<{ afterId: string; step: Change & { action: 'insert' } }> = []
    const patches: Array<{ id: string; label?: string; config?: Record<string, unknown> }> = []

    for (const ch of response.changes) {
      if (ch.action === 'patch') {
        const id = idByOriginalIdx.get(ch.stepIdx)
        if (!id) { failed++; continue }
        patches.push({ id, label: ch.label, config: ch.config })
      } else if (ch.action === 'delete') {
        const id = idByOriginalIdx.get(ch.stepIdx)
        if (!id) { failed++; continue }
        surviving.delete(id)
      } else if (ch.action === 'insert') {
        const afterId = idByOriginalIdx.get(ch.afterStepIdx)
        if (!afterId) { failed++; continue }
        inserts.push({ afterId, step: ch })
      }
    }

    // Apply patches (parallel-safe; each updates one row)
    for (const p of patches) {
      try {
        const res = await api.sequenceStep.update({
          id: p.id,
          ...(p.label !== undefined ? { label: p.label } : {}),
          ...(p.config !== undefined ? { config: JSON.stringify(p.config) } : {}),
        })
        if (res.ok) ok++; else failed++
      } catch { failed++ }
    }

    // Apply deletes
    for (const p of parsed) {
      if (!surviving.has(p.id)) {
        try {
          const res = await api.sequenceStep.remove(p.id)
          if (res.ok) ok++; else failed++
        } catch { failed++ }
      }
    }

    // Apply inserts. Order doesn't really matter for the create call
    // itself; we'll renumber after.
    const insertedRecords: Array<{ tempId: string; afterId: string; step: Change & { action: 'insert' } }> = []
    for (const ins of inserts) {
      try {
        const res = await api.sequenceStep.create({
          sequenceId,
          // Order will be re-assigned in the final renumber pass below
          order: 9999,
          type: ins.step.step.type,
          label: ins.step.step.label,
          config: JSON.stringify(ins.step.step.config),
        })
        if (res.ok && res.row?.id) {
          ok++
          insertedRecords.push({ tempId: res.row.id as string, afterId: ins.afterId, step: ins.step })
        } else {
          failed++
        }
      } catch { failed++ }
    }

    // Renumber: build the final ordered list:
    //   Walk parsed in original order, skipping deleted, and after each
    //   step, slot in any inserts that point at it.
    const finalOrder: string[] = []
    for (const p of parsed) {
      if (!surviving.has(p.id)) continue
      finalOrder.push(p.id)
      const insertsHere = insertedRecords.filter((ir) => ir.afterId === p.id)
      for (const ins of insertsHere) finalOrder.push(ins.tempId)
    }

    for (let i = 0; i < finalOrder.length; i++) {
      try {
        await api.sequenceStep.update({ id: finalOrder[i], order: i })
      } catch { /* non-fatal — visible in flow view */ }
    }

    setApplyResult({ ok, failed })
    setPhase('done')
    onApplied?.()
    setTimeout(() => onClose(), 1500)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full max-w-[640px] h-full bg-[var(--surface)] border-l border-[var(--border)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[var(--radius-md)] bg-[color:rgba(122,94,255,0.12)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] grid place-items-center">
              <Sparkles size={16} />
            </div>
            <div>
              <div className="font-display font-semibold text-[15px] text-body">Ask AI to revise</div>
              <div className="text-[12px] text-muted">
                {targetStep
                  ? `Targeting step ${targetStep.index + 1}: ${targetStep.label}`
                  : 'Sequence-wide — describe what to change'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] border border-[var(--color-danger)]/20 text-[13px] text-[var(--color-danger)] flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {phase === 'input' && (
            <>
              {targetStep && (
                <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px]">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-faint)] mb-1 font-semibold">Current step</div>
                  <div className="font-medium text-body">{targetStep.label}</div>
                  <div className="text-muted mt-0.5">{describeStep(targetStep)}</div>
                </div>
              )}

              <label className="block">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)] mb-1">
                  What's wrong? What should it do instead?
                </div>
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={targetStep
                    ? "e.g. 'This sends a breakup after only one unopened email — that's way too soon. Replace it with a softer follow-up that tries a different subject line angle.'"
                    : "e.g. 'The whole sequence feels too aggressive — soften the early touches and add a wait before each follow-up.'"}
                  rows={6}
                  className="text-[13px]"
                  autoFocus
                />
                <div className="text-[11px] text-[var(--text-faint)] mt-1">
                  Tip: be specific. "Try a different angle" → AI guesses. "Try referencing METRC compliance instead of cost-per-pound" → AI delivers.
                </div>
              </label>

              <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
                <Button onClick={handleAskAI} variant="primary" disabled={!feedback.trim()}>
                  <Sparkles size={14} /> Suggest changes
                </Button>
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
              </div>
            </>
          )}

          {phase === 'thinking' && (
            <div className="flex items-center gap-3 text-muted text-[13px] py-12 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Thinking through your sequence and writing changes…
            </div>
          )}

          {phase === 'preview' && response && (
            <PreviewSection
              response={response}
              parsed={parsed}
              onApply={handleApply}
              onBack={() => { setPhase('input'); setResponse(null) }}
            />
          )}

          {phase === 'applying' && (
            <div className="flex items-center gap-3 text-muted text-[13px] py-12 justify-center">
              <Loader2 size={16} className="animate-spin" />
              Applying changes…
            </div>
          )}

          {phase === 'done' && applyResult && (
            <div className="flex flex-col items-center text-center py-8 gap-3">
              <div className="w-12 h-12 rounded-full bg-[color:rgba(48,179,107,0.12)] grid place-items-center text-[var(--color-success)]">
                <Check size={20} />
              </div>
              <div className="font-display font-semibold text-[15px] text-body">
                {applyResult.failed === 0
                  ? `${applyResult.ok} change${applyResult.ok === 1 ? '' : 's'} applied`
                  : `${applyResult.ok} applied · ${applyResult.failed} failed`}
              </div>
              <div className="text-muted text-[13px] max-w-xs">
                Refresh the flow view to see the updated structure.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Preview the change list before applying
// ============================================================

function PreviewSection({
  response, parsed, onApply, onBack,
}: {
  response: RevisionResponse
  parsed: ParsedStep[]
  onApply: () => void
  onBack: () => void
}) {
  const counts = {
    patch:  response.changes.filter((c) => c.action === 'patch').length,
    insert: response.changes.filter((c) => c.action === 'insert').length,
    delete: response.changes.filter((c) => c.action === 'delete').length,
  }

  if (response.changes.length === 0) {
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-[var(--radius-md)] surface-2 text-[13px]">
          <div className="font-medium text-body mb-1">No changes proposed</div>
          <div className="text-muted">{response.rationale}</div>
        </div>
        <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
          <Button variant="ghost" onClick={onBack}>Try different feedback</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* AI's summary + rationale */}
      <div className="p-3 rounded-[var(--radius-md)] surface-2">
        <div className="font-medium text-body text-[13px]">{response.summary}</div>
        <div className="text-muted text-[12px] mt-1 leading-relaxed">{response.rationale}</div>
      </div>

      {/* Counts strip */}
      <div className="flex items-center gap-2 text-[11px]">
        {counts.patch > 0  && <Badge tone="warning">{counts.patch} edit{counts.patch === 1 ? '' : 's'}</Badge>}
        {counts.insert > 0 && <Badge tone="success">{counts.insert} new step{counts.insert === 1 ? '' : 's'}</Badge>}
        {counts.delete > 0 && <Badge tone="danger">{counts.delete} delete{counts.delete === 1 ? '' : 's'}</Badge>}
      </div>

      {/* Per-change list */}
      <div className="space-y-2">
        {response.changes.map((ch, i) => (
          <ChangeCard key={i} change={ch} parsed={parsed} />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-[var(--border)]">
        <Button onClick={onApply} variant="primary">
          <Check size={14} /> Apply {response.changes.length} change{response.changes.length === 1 ? '' : 's'}
        </Button>
        <Button variant="ghost" onClick={onBack}>Back</Button>
      </div>
    </div>
  )
}

function ChangeCard({ change, parsed }: { change: Change; parsed: ParsedStep[] }) {
  if (change.action === 'patch') {
    const orig = parsed[change.stepIdx]
    if (!orig) return null
    const newLabel = change.label !== undefined ? change.label : orig.label
    const newCfg = change.config !== undefined ? change.config : orig.config
    return (
      <div className="p-3 rounded-[var(--radius-md)] border border-[color:rgba(245,165,36,0.30)] bg-[color:rgba(245,165,36,0.05)]">
        <div className="flex items-center gap-2 mb-2">
          <Pencil size={12} className="text-[var(--color-warning)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
            Edit step {change.stepIdx + 1}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-semibold mb-1">Before</div>
            <div className="text-muted line-through">{orig.label}</div>
            <div className="text-muted text-[11px] mt-1 line-clamp-3">{describeStep(orig)}</div>
          </div>
          <div>
            <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide font-semibold mb-1">After</div>
            <div className="text-body font-medium">{newLabel}</div>
            <div className="text-body text-[11px] mt-1 line-clamp-3">
              {describeStep({ ...orig, label: newLabel, config: newCfg })}
            </div>
          </div>
        </div>
      </div>
    )
  }
  if (change.action === 'insert') {
    const after = parsed[change.afterStepIdx]
    return (
      <div className="p-3 rounded-[var(--radius-md)] border border-[color:rgba(48,179,107,0.30)] bg-[color:rgba(48,179,107,0.05)]">
        <div className="flex items-center gap-2 mb-2">
          <Plus size={12} className="text-[var(--color-success)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-success)]">
            New step after {after ? `step ${change.afterStepIdx + 1}` : 'sequence start'}
          </span>
        </div>
        <div className="text-[13px] font-medium text-body">{change.step.label}</div>
        <div className="text-[11px] text-muted mt-1">
          Type: <span className="font-mono">{change.step.type}</span>
        </div>
        <div className="text-[11px] text-muted mt-1 line-clamp-4">
          {describeStep({ id: '', index: -1, type: change.step.type, label: change.step.label, config: change.step.config })}
        </div>
      </div>
    )
  }
  // delete
  const orig = parsed[change.stepIdx]
  return (
    <div className="p-3 rounded-[var(--radius-md)] border border-[color:rgba(239,76,76,0.30)] bg-[color:rgba(239,76,76,0.05)]">
      <div className="flex items-center gap-2 mb-2">
        <Trash2 size={12} className="text-[var(--color-danger)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
          Delete step {change.stepIdx + 1}
        </span>
      </div>
      {orig && (
        <>
          <div className="text-[13px] line-through text-muted">{orig.label}</div>
          <div className="text-[11px] text-muted mt-1 line-clamp-2">{describeStep(orig)}</div>
        </>
      )}
    </div>
  )
}

// ============================================================
// Step description (for diff preview)
// ============================================================

function describeStep(s: { type: string; config: Record<string, unknown>; label?: string; id?: string; index?: number }): string {
  const cfg = s.config as Record<string, unknown>
  switch (s.type) {
    case 'email':  return `Subject: ${cfg.subject || '(none)'} · ${truncate(String(cfg.body || ''), 200)}`
    case 'sms':    return truncate(String(cfg.body || ''), 200)
    case 'wait':   return `Wait ${cfg.amount || 0} ${cfg.unit || 'days'}`
    case 'branch': {
      const cond = cfg.condition as { kind?: string; withinHours?: number } | undefined
      return `If ${cond?.kind || '?'} (within ${cond?.withinHours || '?'}h) → step ${(Number(cfg.trueNext) || 0) + 1}, else → step ${(Number(cfg.falseNext) || 0) + 1}`
    }
    case 'action': return `kind: ${cfg.kind || '?'}`
    default: return ''
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {}
  try { return JSON.parse(s) || {} } catch { return {} }
}

// shut up linter — used in JSX
void ArrowRight
