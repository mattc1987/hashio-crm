import { useMemo, useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Mail,
  MessageSquare,
  Clock,
  GitBranch,
  Bolt,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
  Pause,
  Archive,
  Zap,
  Info,
  Trash,
  Check,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Button, Input, Textarea, Select, PageHeader, Badge, Empty } from '../components/ui'
import { SavedIndicator } from '../components/SavedIndicator'
import { api } from '../lib/api'
import {
  defaultStepConfig,
  describeBranch,
  groupStepsBySequence,
  parseStepConfig,
  resolveMergeTags,
  serializeStepConfig,
} from '../lib/sequences'
import type {
  BranchCondition,
  Sequence,
  SequenceStep,
  StepConfig,
  StepConfigAction,
  StepConfigBranch,
  StepConfigEmail,
  StepConfigSms,
  StepConfigWait,
  StepType,
} from '../lib/types'
import { cn } from '../lib/cn'

const STEP_TYPES: Array<{ type: StepType; label: string; icon: React.ReactNode; desc: string }> = [
  { type: 'email',  label: 'Send email',    icon: <Mail size={14} />,   desc: 'Sends from your Gmail via Apps Script' },
  { type: 'sms',    label: 'Send SMS',      icon: <MessageSquare size={14} />, desc: 'Sends a text via Twilio (requires config)' },
  { type: 'wait',   label: 'Wait',          icon: <Clock size={14} />,  desc: 'Pause before the next step' },
  { type: 'branch', label: 'If / then',     icon: <GitBranch size={14} />, desc: 'Take a different path based on a signal' },
  { type: 'action', label: 'Take action',   icon: <Bolt size={14} />,   desc: 'Create a task, stop the sequence, etc.' },
]

export function SequenceEditor() {
  const { id } = useParams<{ id: string }>()
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)

  const data = 'data' in state ? state.data : undefined
  const sequence = data?.sequences.find((s) => s.id === id)
  const steps = useMemo(() => {
    if (!data) return []
    return groupStepsBySequence(data.sequenceSteps)[id!] || []
  }, [data, id])

  const [editing, setEditing] = useState<string | null>(steps[0]?.id ?? null)
  useEffect(() => {
    if (!editing && steps.length) setEditing(steps[0].id)
  }, [steps, editing])

  if (!data) return <PageHeader title="Sequence" />
  if (!sequence) {
    return (
      <div>
        <Link to="/sequences" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All sequences
        </Link>
        <Empty icon={<Zap size={22} />} title="Sequence not found" />
      </div>
    )
  }

  const addStep = async (type: StepType) => {
    const config = defaultStepConfig(type)
    const label = defaultLabel(type, steps.length)
    const payload = {
      sequenceId: sequence.id,
      order: steps.length,
      type,
      config: serializeStepConfig(config),
      label,
    }
    const res = await api.sequenceStep.create(payload)
    if (res.row?.id) setEditing(res.row.id)
  }

  const deleteStep = (stepId: string) => {
    if (!confirm('Delete this step?')) return
    api.sequenceStep.remove(stepId)
    if (editing === stepId) setEditing(null)
  }

  const moveStep = (stepId: string, direction: -1 | 1) => {
    const idx = steps.findIndex((s) => s.id === stepId)
    const swapWith = steps[idx + direction]
    if (!swapWith) return
    api.sequenceStep.update({ id: stepId, order: swapWith.order })
    api.sequenceStep.update({ id: swapWith.id, order: steps[idx].order })
  }

  // Inline edits go straight to the local cache — which is reactive. We do
  // NOT call refresh() here because that re-fetches the whole Sheet, which
  // re-renders the form mid-keystroke and eats user input. The local cache
  // emits a change event that re-renders just what's needed.
  const patchSequence = (patch: Partial<Sequence>) => {
    api.sequence.update({ id: sequence.id, ...patch })
  }

  const deleteSequence = async () => {
    if (!confirm(`Permanently delete "${sequence.name}" and its ${steps.length} step${steps.length === 1 ? '' : 's'}? This can't be undone.`)) return
    // Delete steps first, then the sequence
    await Promise.all(steps.map((s) => api.sequenceStep.remove(s.id)))
    await api.sequence.remove(sequence.id)
    navigate('/sequences')
  }

  const saveAndConfirm = async () => {
    await refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const patchStep = (step: SequenceStep, patch: Partial<SequenceStep> & { configObj?: StepConfig }) => {
    const { configObj, ...rest } = patch
    const nextConfig = configObj ? serializeStepConfig(configObj) : (rest.config ?? step.config)
    api.sequenceStep.update({
      id: step.id,
      ...rest,
      config: nextConfig,
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/sequences"
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> All sequences
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge tone={sequence.status === 'active' ? 'success' : sequence.status === 'paused' ? 'warning' : sequence.status === 'archived' ? 'neutral' : 'info'}>
              {sequence.status}
            </Badge>
            <SavedIndicator value={JSON.stringify({ s: sequence, st: steps })} />
          </div>
          <input
            value={sequence.name}
            onChange={(e) => patchSequence({ name: e.target.value })}
            className="bg-transparent border-none outline-none font-display text-[22px] font-semibold text-body w-full"
          />
          <input
            value={sequence.description}
            onChange={(e) => patchSequence({ description: e.target.value })}
            placeholder="Describe when this sequence fires (e.g. ‘Enrolled when a new lead fills the demo form’)"
            className="bg-transparent border-none outline-none text-[13px] text-muted w-full mt-1"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="primary"
            icon={saved ? <Check size={14} /> : undefined}
            onClick={saveAndConfirm}
          >
            {saved ? 'Saved' : 'Save changes'}
          </Button>
          {sequence.status !== 'active' && (
            <Button icon={<Play size={13} />} onClick={() => patchSequence({ status: 'active' })}>
              Activate
            </Button>
          )}
          {sequence.status === 'active' && (
            <Button icon={<Pause size={13} />} onClick={() => patchSequence({ status: 'paused' })}>
              Pause
            </Button>
          )}
          {sequence.status !== 'archived' && (
            <Button icon={<Archive size={13} />} onClick={() => patchSequence({ status: 'archived' })}>
              Archive
            </Button>
          )}
          {(sequence.status === 'archived' || sequence.status === 'draft') && (
            <Button variant="danger" icon={<Trash size={13} />} onClick={deleteSequence}>
              Delete
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => { navigate('/sequences/' + sequence.id + '/health-check') }}
          >
            Health check →
          </Button>
          <Button
            variant="ghost"
            onClick={() => { navigate('/sequences/' + sequence.id + '/enrollments') }}
          >
            Enrollments →
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.4fr] gap-6">
        {/* ---------------- Step list ---------------- */}
        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b flex items-center justify-between">
            <CardHeader title="Steps" subtitle={`${steps.length} in this sequence`} />
          </div>

          <div className="flex flex-col">
            {steps.length === 0 ? (
              <Empty
                icon={<Zap size={22} />}
                title="No steps yet"
                description="Add the first step below — typically a ‘Send email’."
              />
            ) : (
              steps.map((step, i) => {
                const isEditing = editing === step.id
                return (
                  <button
                    key={step.id}
                    onClick={() => setEditing(step.id)}
                    className={cn(
                      'flex items-start gap-3 text-left px-4 py-3 border-soft-b last:border-b-0',
                      'transition-colors',
                      isEditing ? 'surface-2' : 'hover:surface-2',
                    )}
                  >
                    <StepIcon type={step.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-[var(--text-faint)]">{String(i + 1).padStart(2, '0')}</span>
                        <span className="text-[13px] font-medium text-body truncate">{step.label || defaultLabel(step.type, i)}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 truncate">
                        <StepSubtitle step={step} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                         style={{ opacity: isEditing ? 1 : undefined }}>
                      <IconButton disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveStep(step.id, -1) }} aria-label="Move up">
                        <ArrowUp size={12} />
                      </IconButton>
                      <IconButton disabled={i === steps.length - 1} onClick={(e) => { e.stopPropagation(); moveStep(step.id, 1) }} aria-label="Move down">
                        <ArrowDown size={12} />
                      </IconButton>
                      <IconButton onClick={(e) => { e.stopPropagation(); deleteStep(step.id) }} aria-label="Delete">
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  </button>
                )
              })
            )}

            <div className="p-3 border-soft-t">
              <AddStepMenu onPick={addStep} />
            </div>
          </div>
        </Card>

        {/* ---------------- Step editor ---------------- */}
        <div>
          {editing && steps.find((s) => s.id === editing) ? (
            <StepEditor
              step={steps.find((s) => s.id === editing)!}
              allSteps={steps}
              onPatch={(p) => patchStep(steps.find((s) => s.id === editing)!, p)}
            />
          ) : (
            <Card>
              <Empty
                icon={<Mail size={22} />}
                title="Pick a step to edit"
                description="Or add a new step on the left to get started."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Step editor
   ========================================================================== */

function StepEditor({
  step,
  allSteps,
  onPatch,
}: {
  step: SequenceStep
  allSteps: SequenceStep[]
  onPatch: (patch: Partial<SequenceStep> & { configObj?: StepConfig }) => Promise<void> | void
}) {
  const config = parseStepConfig(step)

  return (
    <Card padded={false}>
      <div className="px-5 py-4 border-soft-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StepIcon type={step.type} />
          <input
            value={step.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="bg-transparent border-none outline-none font-display text-[15px] font-semibold text-body"
          />
        </div>
        <Badge tone="neutral">{step.type}</Badge>
      </div>
      <div className="p-5">
        {step.type === 'email' && (
          <EmailStepEditor config={config as StepConfigEmail} onChange={(c) => onPatch({ configObj: c })} />
        )}
        {step.type === 'sms' && (
          <SmsStepEditor config={config as StepConfigSms} onChange={(c) => onPatch({ configObj: c })} />
        )}
        {step.type === 'wait' && (
          <WaitStepEditor config={config as StepConfigWait} onChange={(c) => onPatch({ configObj: c })} />
        )}
        {step.type === 'branch' && (
          <BranchStepEditor
            config={config as StepConfigBranch}
            allSteps={allSteps}
            currentIdx={step.order}
            onChange={(c) => onPatch({ configObj: c })}
          />
        )}
        {step.type === 'action' && (
          <ActionStepEditor config={config as StepConfigAction} onChange={(c) => onPatch({ configObj: c })} />
        )}
      </div>
    </Card>
  )
}

/* ---------- Email step ---------- */

function EmailStepEditor({ config, onChange }: { config: StepConfigEmail; onChange: (c: StepConfigEmail) => void }) {
  const [showPreview, setShowPreview] = useState(false)
  const preview = useMemo(
    () => ({
      subject: resolveMergeTags(config.subject, { contact: DEMO_CONTACT, deal: DEMO_DEAL, company: DEMO_COMPANY }),
      body: resolveMergeTags(config.body, { contact: DEMO_CONTACT, deal: DEMO_DEAL, company: DEMO_COMPANY }),
    }),
    [config.subject, config.body],
  )

  return (
    <div className="flex flex-col gap-4">
      <Field label="Subject line">
        <Input
          value={config.subject}
          onChange={(e) => onChange({ ...config, subject: e.target.value })}
          placeholder="e.g. Quick question about {{company}}"
        />
      </Field>

      <Field label="Body" hint="Markdown-ish plain text. Use merge tags like {{firstName}} or {{company}}.">
        <Textarea
          value={config.body}
          onChange={(e) => onChange({ ...config, body: e.target.value })}
          placeholder={"Hi {{firstName}},\n\n…"}
          rows={10}
        />
      </Field>

      <div className="flex items-center justify-between gap-3 text-[12px]">
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            checked={config.trackOpens ?? true}
            onChange={(e) => onChange({ ...config, trackOpens: e.target.checked })}
            className="accent-[var(--color-brand-600)]"
          />
          Track opens (inserts 1px tracking pixel)
        </label>
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <span>On reply:</span>
          <select
            value={config.replyBehavior ?? 'exit'}
            onChange={(e) => onChange({ ...config, replyBehavior: e.target.value as 'exit' | 'continue' })}
            className="surface border-soft rounded-[var(--radius-sm)] px-2 py-1 text-[12px]"
          >
            <option value="exit">Stop the sequence</option>
            <option value="continue">Continue</option>
          </select>
        </label>
      </div>

      <div className="border-soft-t pt-4">
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-[12px] font-medium text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
        >
          {showPreview ? 'Hide preview' : 'Preview with sample contact'}
        </button>
        {showPreview && (
          <div className="surface-2 rounded-[var(--radius-md)] p-4 mt-3 text-[13px]">
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">To</div>
            <div className="text-body">Jane Doe &lt;jane@acme.com&gt;</div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mt-3 mb-1">Subject</div>
            <div className="text-body font-medium">{preview.subject || <em className="text-muted">(empty)</em>}</div>
            <div className="text-[11px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mt-3 mb-1">Body</div>
            <div className="text-body whitespace-pre-wrap">{preview.body || <em className="text-muted">(empty)</em>}</div>
          </div>
        )}
      </div>

      <MergeTagPalette />
    </div>
  )
}

/* ---------- SMS step ---------- */

function SmsStepEditor({ config, onChange }: { config: StepConfigSms; onChange: (c: StepConfigSms) => void }) {
  const charCount = (config.body || '').length
  const isLong = charCount > 160
  const segments = Math.ceil(charCount / (isLong ? 153 : 160))

  return (
    <div className="flex flex-col gap-4">
      <Callout>
        <strong>SMS step</strong> sends a text via Twilio to the contact's phone number.
        First-time setup: in Apps Script, set Script Properties{' '}
        <code className="font-mono">TWILIO_SID</code>,{' '}
        <code className="font-mono">TWILIO_TOKEN</code>, and{' '}
        <code className="font-mono">TWILIO_FROM</code> (your verified Twilio number, e.g. <code className="font-mono">+15125551234</code>).
        Cost ≈ $0.008 per message.
      </Callout>

      <Field label="Message body" hint={`${charCount}/${isLong ? '1600' : '160'} chars · ${segments} SMS segment${segments === 1 ? '' : 's'}`}>
        <Textarea
          value={config.body}
          onChange={(e) => onChange({ ...config, body: e.target.value })}
          placeholder={"Hi {{firstName}}, quick follow-up — got 15 min this week? - Matt"}
          rows={5}
        />
      </Field>

      <div className="flex items-center justify-between text-[12px]">
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <span>On reply:</span>
          <select
            value={config.replyBehavior ?? 'exit'}
            onChange={(e) => onChange({ ...config, replyBehavior: e.target.value as 'exit' | 'continue' })}
            className="surface border-soft rounded-[var(--radius-sm)] px-2 py-1 text-[12px]"
          >
            <option value="exit">Stop the sequence</option>
            <option value="continue">Continue</option>
          </select>
        </label>
        <span className="text-[var(--text-faint)]">SMS replies arrive in your Twilio inbox</span>
      </div>

      <MergeTagPalette />

      {/* Live phone preview */}
      <div className="flex justify-center pt-2">
        <div className="w-[280px] surface-2 rounded-[28px] border-soft p-4 shadow-soft-sm">
          <div className="text-[10px] text-center text-[var(--text-faint)] mb-2">Preview</div>
          <div className="flex flex-col gap-1.5">
            <div className="self-start max-w-[85%] bg-[var(--surface-3)] text-body text-[12px] px-3 py-2 rounded-2xl rounded-bl-md">
              {config.body || <em className="text-muted">Type your message above…</em>}
            </div>
            <div className="text-[9px] text-center text-[var(--text-faint)] mt-1">
              {segments} segment{segments === 1 ? '' : 's'} · {charCount} chars
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Wait step ---------- */

function WaitStepEditor({ config, onChange }: { config: StepConfigWait; onChange: (c: StepConfigWait) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Wait duration">
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={0}
            value={config.amount}
            onChange={(e) => onChange({ ...config, amount: Math.max(0, Number(e.target.value) || 0) })}
            className="max-w-[120px]"
          />
          <Select
            value={config.unit}
            onChange={(e) => onChange({ ...config, unit: e.target.value as StepConfigWait['unit'] })}
            className="max-w-[200px]"
          >
            <option value="hours">hours</option>
            <option value="days">days</option>
            <option value="businessDays">business days</option>
            <option value="weeks">weeks</option>
          </Select>
        </div>
      </Field>
      <Callout>
        Scheduler runs every 5 minutes, so the effective delay may be up to 5 min longer than the exact duration.
        Business days skip Saturday & Sunday based on the recipient's timezone (defaults to your Sheet's time zone).
      </Callout>
    </div>
  )
}

/* ---------- Branch step ---------- */

function BranchStepEditor({
  config,
  allSteps,
  currentIdx,
  onChange,
}: {
  config: StepConfigBranch
  allSteps: SequenceStep[]
  currentIdx: number
  onChange: (c: StepConfigBranch) => void
}) {
  const stepOptions = allSteps
    .filter((s) => s.order !== currentIdx)
    .map((s) => ({ value: s.order, label: `Step ${s.order + 1} — ${s.label}` }))

  const setCondKind = (kind: BranchCondition['kind']) => {
    const base: Record<string, unknown> = { kind }
    if (kind === 'opened-last' || kind === 'clicked-last' || kind === 'replied') {
      base.withinHours = 48
    } else if (kind === 'contact-field') {
      base.field = 'status'
      base.equals = 'Customer'
    } else if (kind === 'deal-stage') {
      base.equals = 'Closed Won'
    }
    onChange({ ...config, condition: base as BranchCondition })
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Condition" hint="If this is true, the true branch fires — otherwise the false branch.">
        <Select
          value={config.condition.kind}
          onChange={(e) => setCondKind(e.target.value as BranchCondition['kind'])}
        >
          <option value="opened-last">Contact opened the last email</option>
          <option value="clicked-last">Contact clicked a link in the last email</option>
          <option value="replied">Contact replied to the last email</option>
          <option value="contact-field">Contact field matches a value</option>
          <option value="deal-stage">Deal stage equals</option>
        </Select>
      </Field>

      {(config.condition.kind === 'opened-last' ||
        config.condition.kind === 'clicked-last' ||
        config.condition.kind === 'replied') && (
        <Field label="Within (hours)">
          <Input
            type="number"
            min={1}
            value={config.condition.withinHours ?? 48}
            onChange={(e) =>
              onChange({
                ...config,
                condition: {
                  kind: config.condition.kind,
                  withinHours: Math.max(1, Number(e.target.value) || 1),
                } as BranchCondition,
              })
            }
            className="max-w-[120px]"
          />
        </Field>
      )}

      {config.condition.kind === 'contact-field' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Contact field">
            <Select
              value={config.condition.field}
              onChange={(e) =>
                onChange({
                  ...config,
                  condition: {
                    kind: 'contact-field',
                    field: e.target.value as 'status' | 'title' | 'companyId',
                    equals: config.condition.kind === 'contact-field' ? config.condition.equals : '',
                  } as BranchCondition,
                })
              }
            >
              <option value="status">status</option>
              <option value="title">title</option>
              <option value="companyId">companyId</option>
            </Select>
          </Field>
          <Field label="Equals">
            <Input
              value={config.condition.equals}
              onChange={(e) =>
                onChange({
                  ...config,
                  condition: {
                    kind: 'contact-field',
                    field: config.condition.kind === 'contact-field' ? config.condition.field : 'status',
                    equals: e.target.value,
                  } as BranchCondition,
                })
              }
            />
          </Field>
        </div>
      )}

      {config.condition.kind === 'deal-stage' && (
        <Field label="Equals">
          <Select
            value={config.condition.equals}
            onChange={(e) =>
              onChange({
                ...config,
                condition: { kind: 'deal-stage', equals: e.target.value } as BranchCondition,
              })
            }
          >
            <option value="Lead">Lead</option>
            <option value="Qualified">Qualified</option>
            <option value="Demo">Demo</option>
            <option value="Proposal">Proposal</option>
            <option value="Negotiation">Negotiation</option>
            <option value="Closed Won">Closed Won</option>
            <option value="Closed Lost">Closed Lost</option>
          </Select>
        </Field>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-soft-t">
        <Field label="If TRUE → go to step">
          <Select
            value={config.trueNext}
            onChange={(e) => onChange({ ...config, trueNext: Number(e.target.value) })}
          >
            <option value={-1}>(next step in order)</option>
            {stepOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            <option value={-2}>(end sequence)</option>
          </Select>
        </Field>
        <Field label="If FALSE → go to step">
          <Select
            value={config.falseNext}
            onChange={(e) => onChange({ ...config, falseNext: Number(e.target.value) })}
          >
            <option value={-1}>(next step in order)</option>
            {stepOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            <option value={-2}>(end sequence)</option>
          </Select>
        </Field>
      </div>

      <Callout>
        <strong>Preview:</strong> When this step fires, we'll check: {describeBranch(config.condition)}.
      </Callout>
    </div>
  )
}

/* ---------- Action step ---------- */

function ActionStepEditor({ config, onChange }: { config: StepConfigAction; onChange: (c: StepConfigAction) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="Action">
        <Select
          value={config.kind}
          onChange={(e) => onChange({ kind: e.target.value as StepConfigAction['kind'], payload: config.payload })}
        >
          <option value="create-task">Create a task</option>
          <option value="update-contact">Update a contact field</option>
          <option value="update-deal-stage">Update the deal stage</option>
          <option value="notify-owner">Notify owner (emails you)</option>
          <option value="end-sequence">End the sequence</option>
          <option value="unsubscribe-contact">Mark contact as unsubscribed</option>
        </Select>
      </Field>

      {config.kind === 'create-task' && (
        <Field label="Task title">
          <Input
            value={(config.payload?.title as string) || ''}
            onChange={(e) => onChange({ ...config, payload: { ...config.payload, title: e.target.value } })}
            placeholder="e.g. Follow up with {{firstName}}"
          />
        </Field>
      )}
      {config.kind === 'update-contact' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Field name">
            <Input
              value={(config.payload?.field as string) || ''}
              onChange={(e) => onChange({ ...config, payload: { ...config.payload, field: e.target.value } })}
              placeholder="status"
            />
          </Field>
          <Field label="New value">
            <Input
              value={(config.payload?.value as string) || ''}
              onChange={(e) => onChange({ ...config, payload: { ...config.payload, value: e.target.value } })}
              placeholder="Customer"
            />
          </Field>
        </div>
      )}
      {config.kind === 'update-deal-stage' && (
        <Field label="New stage">
          <Select
            value={(config.payload?.stage as string) || 'Qualified'}
            onChange={(e) => onChange({ ...config, payload: { ...config.payload, stage: e.target.value } })}
          >
            <option value="Lead">Lead</option>
            <option value="Qualified">Qualified</option>
            <option value="Demo">Demo</option>
            <option value="Proposal">Proposal</option>
            <option value="Negotiation">Negotiation</option>
            <option value="Closed Won">Closed Won</option>
            <option value="Closed Lost">Closed Lost</option>
          </Select>
        </Field>
      )}
      {config.kind === 'notify-owner' && (
        <Field label="Subject">
          <Input
            value={(config.payload?.subject as string) || ''}
            onChange={(e) => onChange({ ...config, payload: { ...config.payload, subject: e.target.value } })}
            placeholder="e.g. {{firstName}} hit the negotiation stage"
          />
        </Field>
      )}
    </div>
  )
}

/* ==========================================================================
   Bits & pieces
   ========================================================================== */

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[color:rgba(59,130,246,0.08)] text-[12px] text-body">
      <Info size={13} className="mt-0.5 shrink-0 text-[var(--color-info)]" />
      <div>{children}</div>
    </div>
  )
}

function StepIcon({ type }: { type: StepType }) {
  const icon =
    type === 'email'  ? <Mail size={14} /> :
    type === 'sms'    ? <MessageSquare size={14} /> :
    type === 'wait'   ? <Clock size={14} /> :
    type === 'branch' ? <GitBranch size={14} /> :
                        <Bolt size={14} />
  const color =
    type === 'email'  ? 'bg-[color:rgba(122,94,255,0.14)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' :
    type === 'sms'    ? 'bg-[color:rgba(48,179,107,0.14)] text-[var(--color-success)]' :
    type === 'wait'   ? 'bg-[color:rgba(245,165,36,0.12)] text-[var(--color-warning)]' :
    type === 'branch' ? 'bg-[color:rgba(59,130,246,0.12)] text-[var(--color-info)]' :
                        'bg-[color:rgba(48,179,107,0.12)] text-[var(--color-success)]'
  return <span className={cn('w-6 h-6 rounded-[var(--radius-sm)] grid place-items-center shrink-0', color)}>{icon}</span>
}

function StepSubtitle({ step }: { step: SequenceStep }) {
  const config = parseStepConfig(step)
  if (step.type === 'email') {
    const c = config as StepConfigEmail
    return <>{c.subject || <em>No subject</em>}</>
  }
  if (step.type === 'sms') {
    const c = config as StepConfigSms
    return <>{c.body ? c.body.slice(0, 60) + (c.body.length > 60 ? '…' : '') : <em>Empty SMS</em>}</>
  }
  if (step.type === 'wait') {
    const c = config as StepConfigWait
    return <>Wait {c.amount} {c.unit}</>
  }
  if (step.type === 'branch') {
    const c = config as StepConfigBranch
    return <>If {describeBranch(c.condition)}</>
  }
  const c = config as StepConfigAction
  return <>{c.kind.replace(/-/g, ' ')}</>
}

function AddStepMenu({ onPick }: { onPick: (type: StepType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        variant="secondary"
        icon={<Plus size={13} />}
        onClick={() => setOpen((v) => !v)}
        className="w-full"
      >
        Add step
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-2 z-20 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1">
            {STEP_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => { onPick(t.type); setOpen(false) }}
                className="flex items-start gap-3 w-full text-left p-3 rounded-[var(--radius-sm)] hover:surface-2 transition-colors"
              >
                <StepIcon type={t.type} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-body">{t.label}</div>
                  <div className="text-[11px] text-muted mt-0.5">{t.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function IconButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        'w-7 h-7 rounded-[var(--radius-sm)] grid place-items-center text-[var(--text-faint)] hover:text-body hover:surface-3',
        'disabled:opacity-30 disabled:pointer-events-none',
        rest.className,
      )}
    >
      {children}
    </button>
  )
}

const MERGE_TAGS = [
  '{{firstName}}', '{{lastName}}', '{{fullName}}', '{{email}}', '{{title}}',
  '{{company}}', '{{dealTitle}}', '{{dealValue}}', '{{dealStage}}',
]

function MergeTagPalette() {
  return (
    <div className="surface-2 rounded-[var(--radius-md)] p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-2">
        Merge tags
      </div>
      <div className="flex flex-wrap gap-1.5">
        {MERGE_TAGS.map((t) => (
          <code
            key={t}
            className="text-[11px] px-2 py-0.5 rounded bg-[var(--surface-3)] font-mono text-body cursor-pointer hover:bg-[var(--border-strong)]"
            onClick={() => navigator.clipboard?.writeText(t)}
            title="Click to copy"
          >
            {t}
          </code>
        ))}
      </div>
    </div>
  )
}

function defaultLabel(type: StepType, idx: number): string {
  const n = idx + 1
  switch (type) {
    case 'email':
      return `Step ${n} — Email`
    case 'sms':
      return `Step ${n} — SMS`
    case 'wait':
      return `Wait`
    case 'branch':
      return `Branch`
    case 'action':
      return `Action`
  }
}

// Demo data for the email preview pane
const DEMO_CONTACT = {
  id: '',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@acme.com',
  phone: '',
  title: 'Ops Director',
  role: 'Operations',
  companyId: '',
  status: 'Customer',
  state: 'CO',
  linkedinUrl: '',
  tags: '',
  createdAt: '',
}
const DEMO_COMPANY = {
  id: '', name: 'Acme Cultivation', industry: 'Cultivation',
  licenseCount: '', size: '', website: '', address: '', notes: '',
  createdAt: '', updatedAt: '',
}
const DEMO_DEAL = {
  id: '', title: 'Acme — HashIO License', contactId: '', companyId: '',
  value: 12000, stage: 'Qualified', probability: 50, closeDate: '',
  mrr: 1000, billingCycle: 'monthly' as const, billingMonth: '', contractStart: '',
  contractEnd: '', mrrStatus: '', notes: '', createdAt: '', updatedAt: '',
}
