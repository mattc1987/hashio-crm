// AI Sequence Builder — multi-step wizard that walks Matt through:
//   1. What's the goal of this sequence?
//   2. Who's it for? (audience / ICP)
//   3. (Optional) Paste prior emails so AI matches voice
//   4. Channels + cadence
//   5. AI generates → preview with editable steps
//   6. Save as a real Sequence + SequenceSteps
//
// The output preview is a vertical flow chart of every step (email body
// editable inline, branch logic visualized).

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Sparkles, Mail, MessageSquare, Phone, Link2, Wand2,
  Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronRight,
  Clock, GitBranch, Zap, Edit3, ArrowRight,
} from 'lucide-react'
import { Drawer } from '../Drawer'
import { Button, Input, Textarea, Badge } from '../ui'
import {
  buildSequence,
  GOAL_OPTIONS, CADENCE_OPTIONS, CHANNEL_OPTIONS,
  type SequenceBuildInput, type SequenceGoal, type SequenceCadence,
  type SequenceChannel, type BuiltSequence, type BuiltStep,
  type BuiltEmailConfig, type BuiltSmsConfig, type BuiltWaitConfig,
  type BuiltBranchConfig, type BuiltActionConfig,
} from '../../lib/sequenceBuilderAi'
import { api } from '../../lib/api'
import { cn } from '../../lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  onCreated?: (sequenceId: string) => void
}

type Phase = 'configure' | 'generating' | 'preview' | 'saving'

export function SequenceBuilderDrawer({ open, onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('configure')
  const [error, setError] = useState<string | null>(null)
  const [built, setBuilt] = useState<BuiltSequence | null>(null)

  // Wizard form state
  const [goal, setGoal] = useState<SequenceGoal>('cold-outreach')
  const [goalDetail, setGoalDetail] = useState('')
  const [audience, setAudience] = useState('')
  const [voiceSamples, setVoiceSamples] = useState('')
  const [channels, setChannels] = useState<SequenceChannel[]>(['email', 'linkedin'])
  const [cadence, setCadence] = useState<SequenceCadence>('standard')
  const [enableBranches, setEnableBranches] = useState(true)

  const reset = () => {
    setPhase('configure')
    setError(null)
    setBuilt(null)
    setGoal('cold-outreach')
    setGoalDetail('')
    setAudience('')
    setVoiceSamples('')
    setChannels(['email', 'linkedin'])
    setCadence('standard')
    setEnableBranches(true)
  }

  const handleClose = () => {
    onClose()
    setTimeout(reset, 300)
  }

  const handleGenerate = async () => {
    setPhase('generating')
    setError(null)
    try {
      const input: SequenceBuildInput = {
        goal,
        goalDetail: goalDetail.trim() || undefined,
        audience: audience.trim() || undefined,
        voiceSamples: voiceSamples.trim() || undefined,
        channels,
        cadence,
        enableBranches,
      }
      const result = await buildSequence(input)
      setBuilt(result)
      setPhase('preview')
    } catch (err) {
      setError((err as Error).message)
      setPhase('configure')
    }
  }

  const handleSave = async () => {
    if (!built) return
    setPhase('saving')
    setError(null)
    try {
      // 1. Create the Sequence record
      const seqRes = await api.sequence.create({
        name: built.name,
        description: built.description,
        status: 'draft',
        createdAt: new Date().toISOString(),
      })
      if (!seqRes.ok || !seqRes.row) throw new Error(seqRes.error || 'Failed to create sequence')
      const sequenceId = seqRes.row.id as string

      // 2. Create each step
      for (let i = 0; i < built.steps.length; i++) {
        const step = built.steps[i]
        await api.sequenceStep.create({
          sequenceId,
          order: i,
          type: step.type,
          config: JSON.stringify(step.config),
          label: step.label,
        })
      }

      onCreated?.(sequenceId)
      handleClose()
      navigate(`/sequences/${sequenceId}`)
    } catch (err) {
      setError((err as Error).message)
      setPhase('preview')
    }
  }

  const updateStep = (idx: number, updater: (s: BuiltStep) => BuiltStep) => {
    if (!built) return
    setBuilt({
      ...built,
      steps: built.steps.map((s, i) => (i === idx ? updater(s) : s)),
    })
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      width={780}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--color-brand-600)]" />
          AI Sequence Builder
        </span>
      }
      subtitle={
        phase === 'configure' ? 'Tell the AI about your goal — it builds a multi-touch sequence with branching response logic' :
        phase === 'generating' ? 'Claude is designing your sequence — researching cadence, drafting every email, building the response tree…' :
        phase === 'preview' ? 'Review every step. Edit inline. Save when it\'s right.' :
        'Saving sequence + steps…'
      }
      footer={
        phase === 'configure' ? (
          <>
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Wand2 size={13} />}
              onClick={handleGenerate}
              disabled={!isFormValid({ goal, goalDetail, audience, channels })}
            >
              Generate sequence
            </Button>
          </>
        ) : phase === 'preview' && built ? (
          <>
            <Button variant="ghost" onClick={() => setPhase('configure')}>← Back</Button>
            <Button variant="secondary" onClick={handleGenerate}>Regenerate</Button>
            <Button
              variant="primary"
              icon={<CheckCircle2 size={13} />}
              onClick={handleSave}
              disabled={!built.steps.length}
            >
              Save as sequence
            </Button>
          </>
        ) : null
      }
    >
      {error && (
        <div className="mb-4 surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-[var(--color-danger)] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {phase === 'configure' && (
        <ConfigureStep
          goal={goal} setGoal={setGoal}
          goalDetail={goalDetail} setGoalDetail={setGoalDetail}
          audience={audience} setAudience={setAudience}
          voiceSamples={voiceSamples} setVoiceSamples={setVoiceSamples}
          channels={channels} setChannels={setChannels}
          cadence={cadence} setCadence={setCadence}
          enableBranches={enableBranches} setEnableBranches={setEnableBranches}
        />
      )}

      {phase === 'generating' && <GeneratingState />}

      {phase === 'preview' && built && (
        <PreviewStep built={built} updateStep={updateStep} />
      )}

      {phase === 'saving' && (
        <div className="flex items-center gap-2 text-[12px] text-muted py-8 justify-center">
          <Loader2 size={14} className="animate-spin" />
          Creating sequence + {built?.steps.length || 0} steps…
        </div>
      )}
    </Drawer>
  )
}

function isFormValid({ goal, goalDetail, audience, channels }: { goal: SequenceGoal; goalDetail: string; audience: string; channels: SequenceChannel[] }): boolean {
  if (channels.length === 0) return false
  if (goal === 'custom' && !goalDetail.trim()) return false
  // Audience is recommended but not required
  void audience
  return true
}

// ============================================================
// Configure phase
// ============================================================

function ConfigureStep({
  goal, setGoal, goalDetail, setGoalDetail,
  audience, setAudience, voiceSamples, setVoiceSamples,
  channels, setChannels, cadence, setCadence,
  enableBranches, setEnableBranches,
}: {
  goal: SequenceGoal; setGoal: (g: SequenceGoal) => void
  goalDetail: string; setGoalDetail: (s: string) => void
  audience: string; setAudience: (s: string) => void
  voiceSamples: string; setVoiceSamples: (s: string) => void
  channels: SequenceChannel[]; setChannels: (c: SequenceChannel[]) => void
  cadence: SequenceCadence; setCadence: (c: SequenceCadence) => void
  enableBranches: boolean; setEnableBranches: (v: boolean) => void
}) {
  const toggleChannel = (c: SequenceChannel) => {
    if (channels.includes(c)) setChannels(channels.filter((x) => x !== c))
    else setChannels([...channels, c])
  }
  return (
    <div className="flex flex-col gap-6">
      {/* 1. Goal */}
      <Section number={1} title="What's the goal of this sequence?">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {GOAL_OPTIONS.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => setGoal(g.value)}
              className={cn(
                'relative text-left surface border-2 rounded-[var(--radius-md)] p-3 transition-all hover:border-[var(--color-brand-500)]',
                goal === g.value
                  ? 'border-[var(--color-brand-600)] bg-[color:rgba(122,94,255,0.10)] shadow-soft-sm'
                  : 'border-[var(--border)]',
              )}
            >
              <div className="flex items-start gap-2">
                <div className={cn(
                  'w-4 h-4 rounded-full border-2 grid place-items-center shrink-0 mt-0.5 transition-all',
                  goal === g.value
                    ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]'
                    : 'border-[var(--border-strong)]',
                )}>
                  {goal === g.value && (
                    <div className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={cn(
                    'font-medium text-[13px]',
                    goal === g.value ? 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' : 'text-body',
                  )}>
                    {g.label}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">{g.hint}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
        {goal === 'custom' && (
          <Textarea
            value={goalDetail}
            onChange={(e) => setGoalDetail(e.target.value)}
            placeholder="Describe the scenario — e.g. 'Re-engage customers who churned in 2024 with a new product launch'"
            rows={3}
            className="text-[12px] mt-2"
          />
        )}
      </Section>

      {/* 2. Audience */}
      <Section number={2} title="Who's the audience?" hint="Optional but highly recommended — the AI tailors every email.">
        <Textarea
          value={audience}
          onChange={(e) => setAudience(e.target.value)}
          placeholder='e.g. "Founders or Heads of Cultivation at multi-state cannabis cultivators with 50K+ sqft canopy in CO/CA/MA"'
          rows={2}
          className="text-[12px]"
        />
      </Section>

      {/* 3. Voice samples */}
      <Section number={3} title="Match my voice (optional)" hint="Paste 1-3 of your best prior emails. AI clones your tone, sentence patterns, and signoffs.">
        <Textarea
          value={voiceSamples}
          onChange={(e) => setVoiceSamples(e.target.value)}
          placeholder={`Paste a winning cold email or two here. e.g.\n\nSubject: Quick question about your ops\n\nHey {{firstName}},\n\nSaw you're scaling to multi-state — typically the ops side gets brutal around 3+ licenses. Curious how you're tracking cost-per-pound across sites today?\n\nIf interesting, here's 15 min: [link]\n\n— Matt`}
          rows={6}
          className="text-[11px] font-mono"
        />
      </Section>

      {/* 4. Channels */}
      <Section number={4} title="Channels">
        <div className="flex flex-col gap-2">
          {CHANNEL_OPTIONS.map((c) => {
            const checked = channels.includes(c.value)
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleChannel(c.value)}
                className={cn(
                  'flex items-center gap-3 surface border-2 rounded-[var(--radius-md)] p-2.5 text-left transition-all',
                  checked
                    ? 'border-[var(--color-brand-600)] bg-[color:rgba(122,94,255,0.08)]'
                    : 'border-[var(--border)] hover:border-[var(--color-brand-500)]',
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded border-2 grid place-items-center shrink-0 transition-all',
                  checked ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]' : 'border-[var(--border-strong)]',
                )}>
                  {checked && (
                    <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white">
                      <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-body">{c.label}</div>
                  <div className="text-[11px] text-muted">{c.hint}</div>
                </div>
                {channelIcon(c.value)}
              </button>
            )
          })}
        </div>
      </Section>

      {/* 5. Cadence */}
      <Section number={5} title="Cadence intensity">
        <div className="grid grid-cols-3 gap-2">
          {CADENCE_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCadence(c.value)}
              className={cn(
                'text-left surface border-2 rounded-[var(--radius-md)] p-3 transition-all hover:border-[var(--color-brand-500)]',
                cadence === c.value
                  ? 'border-[var(--color-brand-600)] bg-[color:rgba(122,94,255,0.10)] shadow-soft-sm'
                  : 'border-[var(--border)]',
              )}
            >
              <div className={cn(
                'font-medium text-[13px]',
                cadence === c.value ? 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]' : 'text-body',
              )}>
                {c.label}
              </div>
              <div className="text-[11px] text-muted mt-0.5">{c.hint}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* 6. Branching */}
      <Section number={6} title="Smart branching" hint="Generate different follow-ups based on opens, clicks, replies. Highly recommended.">
        <button
          onClick={() => setEnableBranches(!enableBranches)}
          className={cn(
            'w-full flex items-center gap-3 surface border-soft rounded-[var(--radius-md)] p-3 text-left transition-all',
            enableBranches && 'border-[var(--color-brand-500)] bg-[color:rgba(122,94,255,0.05)]',
          )}
        >
          <div className={cn(
            'w-9 h-5 rounded-full p-0.5 transition-colors',
            enableBranches ? 'bg-[var(--color-brand-600)]' : 'bg-[var(--surface-3)]',
          )}>
            <div className={cn(
              'w-4 h-4 rounded-full bg-white transition-transform',
              enableBranches && 'translate-x-4',
            )} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-body">
              {enableBranches ? 'Branching enabled' : 'Linear sequence'}
            </div>
            <div className="text-[11px] text-muted">
              {enableBranches
                ? 'AI will use IF/THEN logic — opened? clicked? replied? — different paths'
                : 'AI will build a straight-line sequence with no decision points'}
            </div>
          </div>
          <GitBranch size={16} className={enableBranches ? 'text-[var(--color-brand-600)]' : 'text-[var(--text-faint)]'} />
        </button>
      </Section>
    </div>
  )
}

function Section({ number, title, hint, children }: { number: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="w-5 h-5 rounded-full bg-[color:rgba(122,94,255,0.15)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] grid place-items-center text-[11px] font-semibold">
            {number}
          </span>
          <span className="font-display font-semibold text-[14px] text-body">{title}</span>
        </div>
        {hint && <div className="text-[11px] text-muted ml-7 mt-0.5">{hint}</div>}
      </div>
      <div className="ml-7">{children}</div>
    </div>
  )
}

function channelIcon(c: SequenceChannel) {
  const props = { size: 14, className: 'text-muted shrink-0' }
  switch (c) {
    case 'email': return <Mail {...props} />
    case 'linkedin': return <Link2 {...props} />
    case 'sms': return <MessageSquare {...props} />
    case 'phone': return <Phone {...props} />
  }
}

// ============================================================
// Generating state
// ============================================================

function GeneratingState() {
  const messages = [
    'Researching cadence patterns for this audience…',
    'Drafting subject lines (curiosity-first, under 60 chars)…',
    'Writing email bodies with specific value-props…',
    'Designing branching logic (opened-vs-not, clicked-vs-not)…',
    'Adding LinkedIn + phone task scripts…',
    'Composing the breakup email…',
    'Final pass — checking for jargon, generic phrases, weak CTAs…',
  ]
  return (
    <div className="py-8 flex flex-col items-center gap-4">
      <div className="w-12 h-12 rounded-full bg-[var(--color-brand-600)] grid place-items-center animate-pulse">
        <Sparkles size={20} className="text-white" />
      </div>
      <div className="text-[13px] font-medium text-body">Building your sequence…</div>
      <div className="text-[11px] text-muted text-center max-w-md leading-relaxed">
        Claude is doing a real BDR's job: thinking about cadence, drafting every touch with specific value-props,
        building branching logic that reacts to engagement, ending with a breakup email. ~30-60 sec.
      </div>
      <ul className="text-[11px] text-muted space-y-1 mt-2">
        {messages.map((m, i) => (
          <li key={i} className="flex items-center gap-2">
            <Loader2 size={11} className="animate-spin opacity-60" />
            {m}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ============================================================
// Preview phase — renders the full sequence with editable steps
// ============================================================

function PreviewStep({ built, updateStep }: { built: BuiltSequence; updateStep: (idx: number, u: (s: BuiltStep) => BuiltStep) => void }) {
  const emailCount = built.steps.filter((s) => s.type === 'email').length
  const smsCount = built.steps.filter((s) => s.type === 'sms').length
  const branchCount = built.steps.filter((s) => s.type === 'branch').length
  const actionCount = built.steps.filter((s) => s.type === 'action').length
  const waitCount = built.steps.filter((s) => s.type === 'wait').length

  return (
    <div className="flex flex-col gap-4">
      {/* Header summary */}
      <div className="bg-gradient-to-br from-[color:rgba(122,94,255,0.08)] to-transparent border border-[color:rgba(122,94,255,0.2)] rounded-[var(--radius-md)] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={13} className="text-[var(--color-brand-600)]" />
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
            Generated by {built.model}
          </span>
        </div>
        <div className="font-display font-semibold text-[16px] text-body mb-1">{built.name}</div>
        <div className="text-[12px] text-body leading-relaxed">{built.description}</div>
        {built.rationale && (
          <div className="text-[11px] text-muted mt-2 italic">→ {built.rationale}</div>
        )}
        <div className="flex items-center gap-3 mt-3 flex-wrap text-[11px] text-muted">
          <span><strong className="text-body">{built.steps.length}</strong> total steps</span>
          {emailCount > 0 && <span>· {emailCount} email{emailCount === 1 ? '' : 's'}</span>}
          {smsCount > 0 && <span>· {smsCount} SMS</span>}
          {actionCount > 0 && <span>· {actionCount} task{actionCount === 1 ? '' : 's'}</span>}
          {waitCount > 0 && <span>· {waitCount} wait{waitCount === 1 ? '' : 's'}</span>}
          {branchCount > 0 && <span>· {branchCount} branch{branchCount === 1 ? '' : 'es'}</span>}
        </div>
      </div>

      {/* Steps list */}
      <div className="flex flex-col gap-2">
        {built.steps.map((step, idx) => (
          <StepCard
            key={idx}
            step={step}
            idx={idx}
            allSteps={built.steps}
            onUpdate={(updater) => updateStep(idx, updater)}
          />
        ))}
      </div>
    </div>
  )
}

function StepCard({
  step, idx, allSteps, onUpdate,
}: {
  step: BuiltStep
  idx: number
  allSteps: BuiltStep[]
  onUpdate: (u: (s: BuiltStep) => BuiltStep) => void
}) {
  const [expanded, setExpanded] = useState(step.type === 'email' || step.type === 'sms')
  const Icon = stepTypeIcon(step.type)
  const tone = stepTypeTone(step.type)

  return (
    <div className="surface border-soft rounded-[var(--radius-md)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-3 p-3 text-left hover:surface-2"
      >
        <div className={cn('w-7 h-7 rounded-full grid place-items-center shrink-0', tone.bg, tone.fg)}>
          <Icon size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Step {idx}</span>
            <Badge tone={tone.badge}>{step.type}</Badge>
            <span className="text-[13px] font-medium text-body">{step.label}</span>
          </div>
          {step.type === 'email' && (
            <div className="text-[11px] text-muted mt-0.5 truncate">
              <strong>{(step.config as BuiltEmailConfig).subject}</strong>
            </div>
          )}
          {step.type === 'wait' && (
            <div className="text-[11px] text-muted mt-0.5">
              Wait {(step.config as BuiltWaitConfig).amount} {(step.config as BuiltWaitConfig).unit}
            </div>
          )}
          {step.type === 'branch' && (
            <div className="text-[11px] text-muted mt-0.5 inline-flex items-center gap-1">
              <GitBranch size={10} />
              if {(step.config as BuiltBranchConfig).condition?.kind || '?'} → step {(step.config as BuiltBranchConfig).trueNext}, else → step {(step.config as BuiltBranchConfig).falseNext}
            </div>
          )}
          {step.type === 'action' && (
            <div className="text-[11px] text-muted mt-0.5">
              {(step.config as BuiltActionConfig).kind}
            </div>
          )}
          {step.type === 'sms' && (
            <div className="text-[11px] text-muted mt-0.5 line-clamp-1">
              {(step.config as BuiltSmsConfig).body.slice(0, 80)}
            </div>
          )}
        </div>
        {expanded ? <ChevronDown size={14} className="text-muted shrink-0 mt-1" /> : <ChevronRight size={14} className="text-muted shrink-0 mt-1" />}
      </button>
      {expanded && (
        <div className="border-soft-t p-3 surface-2">
          {step.type === 'email' && <EmailEditor config={step.config as BuiltEmailConfig} onChange={(c) => onUpdate((s) => ({ ...s, config: c }))} />}
          {step.type === 'sms' && <SmsEditor config={step.config as BuiltSmsConfig} onChange={(c) => onUpdate((s) => ({ ...s, config: c }))} />}
          {step.type === 'wait' && <WaitEditor config={step.config as BuiltWaitConfig} onChange={(c) => onUpdate((s) => ({ ...s, config: c }))} />}
          {step.type === 'branch' && <BranchSummary config={step.config as BuiltBranchConfig} totalSteps={allSteps.length} />}
          {step.type === 'action' && <ActionSummary config={step.config as BuiltActionConfig} />}
        </div>
      )}
    </div>
  )
}

function EmailEditor({ config, onChange }: { config: BuiltEmailConfig; onChange: (c: BuiltEmailConfig) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Subject</div>
        <Input value={config.subject} onChange={(e) => onChange({ ...config, subject: e.target.value })} className="text-[12px]" />
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Body</div>
        <Textarea value={config.body} onChange={(e) => onChange({ ...config, body: e.target.value })} rows={8} className="text-[12px] font-mono" />
      </div>
      <div className="text-[10px] text-muted">
        Merge tags supported: <code>{'{{firstName}}'}</code> <code>{'{{lastName}}'}</code> <code>{'{{company}}'}</code> <code>{'{{title}}'}</code>
      </div>
    </div>
  )
}

function SmsEditor({ config, onChange }: { config: BuiltSmsConfig; onChange: (c: BuiltSmsConfig) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Textarea value={config.body} onChange={(e) => onChange({ ...config, body: e.target.value })} rows={3} className="text-[12px]" />
      <div className="text-[10px] text-muted text-right">{config.body.length}/320 chars</div>
    </div>
  )
}

function WaitEditor({ config, onChange }: { config: BuiltWaitConfig; onChange: (c: BuiltWaitConfig) => void }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-muted">Wait</span>
      <Input
        type="number"
        value={config.amount}
        onChange={(e) => onChange({ ...config, amount: Number(e.target.value) || 0 })}
        className="w-20 text-[12px]"
      />
      <select
        value={config.unit}
        onChange={(e) => onChange({ ...config, unit: e.target.value as BuiltWaitConfig['unit'] })}
        className="surface border-soft rounded h-9 px-2 text-[12px]"
      >
        <option value="hours">hours</option>
        <option value="days">days</option>
        <option value="businessDays">business days</option>
        <option value="weeks">weeks</option>
      </select>
    </div>
  )
}

function BranchSummary({ config, totalSteps }: { config: BuiltBranchConfig; totalSteps: number }) {
  const c = config.condition
  const condText = c.kind === 'opened-last' ? `Opened the last email${c.withinHours ? ` within ${c.withinHours}h` : ''}`
    : c.kind === 'clicked-last' ? `Clicked a link in the last email${c.withinHours ? ` within ${c.withinHours}h` : ''}`
    : c.kind === 'replied' ? `Replied${c.withinHours ? ` within ${c.withinHours}h` : ''}`
    : c.kind === 'contact-field' ? `Contact field "${(c as { field: string }).field}" equals "${(c as { equals: string }).equals}"`
    : c.kind === 'deal-stage' ? `Deal stage equals "${(c as { equals: string }).equals}"`
    : 'Unknown condition'
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <div className="surface rounded p-2 border-soft">
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">If</div>
        <div className="text-body">{condText}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="surface rounded p-2 border-soft">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-success)] font-semibold mb-1 flex items-center gap-1">
            <ArrowRight size={10} /> Yes
          </div>
          <div className="text-body">Go to step {config.trueNext}{config.trueNext >= totalSteps ? ' (end)' : ''}</div>
        </div>
        <div className="surface rounded p-2 border-soft">
          <div className="text-[10px] uppercase tracking-wider text-[var(--color-warning)] font-semibold mb-1 flex items-center gap-1">
            <ArrowRight size={10} /> No
          </div>
          <div className="text-body">Go to step {config.falseNext}{config.falseNext >= totalSteps ? ' (end)' : ''}</div>
        </div>
      </div>
      <div className="text-[10px] text-muted">Branch logic preserved as-is. Use the full sequence editor to retune after saving.</div>
    </div>
  )
}

function ActionSummary({ config }: { config: BuiltActionConfig }) {
  return (
    <div className="text-[12px] flex flex-col gap-2">
      <div>
        <span className="text-muted">Action: </span>
        <strong className="text-body">{config.kind}</strong>
      </div>
      {config.payload && (
        <div className="surface rounded p-2 border-soft">
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Payload</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap text-body">{JSON.stringify(config.payload, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

function stepTypeIcon(t: string) {
  switch (t) {
    case 'email': return Mail
    case 'sms': return MessageSquare
    case 'wait': return Clock
    case 'branch': return GitBranch
    case 'action': return Zap
    default: return Edit3
  }
}

function stepTypeTone(t: string): { bg: string; fg: string; badge: 'brand' | 'info' | 'warning' | 'success' | 'neutral' } {
  switch (t) {
    case 'email':  return { bg: 'bg-[color:rgba(122,94,255,0.14)]', fg: 'text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]', badge: 'brand' }
    case 'sms':    return { bg: 'bg-[color:rgba(48,179,107,0.12)]',  fg: 'text-[var(--color-success)]', badge: 'success' }
    case 'wait':   return { bg: 'bg-[var(--surface-3)]',             fg: 'text-muted', badge: 'neutral' }
    case 'branch': return { bg: 'bg-[color:rgba(245,165,36,0.14)]',  fg: 'text-[var(--color-warning)]', badge: 'warning' }
    case 'action': return { bg: 'bg-[color:rgba(59,130,246,0.12)]',  fg: 'text-[var(--color-info)]', badge: 'info' }
    default:       return { bg: 'bg-[var(--surface-3)]',             fg: 'text-muted', badge: 'neutral' }
  }
}
