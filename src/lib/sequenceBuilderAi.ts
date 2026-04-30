// AI Sequence Builder — calls the Apps Script aiBuildSequence action.
// The server-side prompt is the heart; this lib is just the type-safe wrapper
// + the post-processor that turns Claude's output into the records that
// will be persisted as Sequence + SequenceStep rows.

import type { StepType, BranchCondition, ActionKind } from './types'

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

// ============================================================
// Input
// ============================================================

export type SequenceGoal =
  | 'cold-outreach'
  | 'warm-followup'
  | 'demo-followup'
  | 'customer-expansion'
  | 're-engagement'
  | 'event-invite'
  | 'custom'

export type SequenceCadence = 'light' | 'standard' | 'aggressive'

export type SequenceChannel = 'email' | 'linkedin' | 'sms' | 'phone'

export interface SequenceBuildInput {
  goal: SequenceGoal
  goalDetail?: string         // freetext when goal === 'custom' or to add nuance
  audience?: string           // ICP description
  voiceSamples?: string       // pasted prior emails — Claude clones tone
  channels: SequenceChannel[]
  cadence: SequenceCadence
  enableBranches?: boolean    // default true
}

// ============================================================
// Output
// ============================================================

/** Each step's `config` shape varies by type — Claude returns the right
 *  shape for the type. Stored as JSON-serialized when we persist. */
export interface BuiltStep {
  type: StepType
  label: string
  config: BuiltEmailConfig | BuiltSmsConfig | BuiltWaitConfig | BuiltBranchConfig | BuiltActionConfig
}

export interface BuiltEmailConfig {
  subject: string
  body: string
  trackOpens?: boolean
  replyBehavior?: 'exit' | 'continue'
}
export interface BuiltSmsConfig {
  body: string
  replyBehavior?: 'exit' | 'continue'
}
export interface BuiltWaitConfig {
  amount: number
  unit: 'hours' | 'days' | 'weeks' | 'businessDays'
}
export interface BuiltBranchConfig {
  condition: BranchCondition
  trueNext: number
  falseNext: number
}
export interface BuiltActionConfig {
  kind: ActionKind
  payload?: Record<string, unknown>
}

export interface BuiltSequence {
  name: string
  description: string
  rationale: string
  steps: BuiltStep[]
  model: string
  generatedAt: string
}

// ============================================================
// Call
// ============================================================

export async function buildSequence(input: SequenceBuildInput): Promise<BuiltSequence> {
  if (!APPS_SCRIPT_URL) throw new Error('Backend not configured')

  const body = new URLSearchParams()
  body.set('action', 'aiBuildSequence')
  body.set('key', APPS_SCRIPT_KEY)
  body.set('payload', JSON.stringify({
    ...input,
    enableBranches: input.enableBranches !== false,
  }))

  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    body,
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json().catch(() => ({ ok: false, error: 'Non-JSON response' }))
  if (!json.ok) throw new Error(json.error || 'Failed')
  if (!json.data) throw new Error('Empty response from Claude')
  return json.data as BuiltSequence
}

// ============================================================
// UI helpers
// ============================================================

export const GOAL_OPTIONS: Array<{ value: SequenceGoal; label: string; hint: string }> = [
  { value: 'cold-outreach',     label: 'Cold outreach',         hint: 'New prospects who don\'t know you yet' },
  { value: 'warm-followup',     label: 'Warm follow-up',        hint: 'Engaged but haven\'t replied' },
  { value: 'demo-followup',     label: 'Demo follow-up',        hint: 'Post-demo nurture toward next step' },
  { value: 'customer-expansion', label: 'Customer expansion',   hint: 'Existing customers — upsell/cross-sell' },
  { value: 're-engagement',     label: 'Re-engagement',         hint: 'Cold/dormant contacts (60d+)' },
  { value: 'event-invite',      label: 'Event invite',          hint: 'Webinar / office hours / conference' },
  { value: 'custom',            label: 'Custom',                hint: 'Describe your own scenario' },
]

export const CADENCE_OPTIONS: Array<{ value: SequenceCadence; label: string; hint: string }> = [
  { value: 'light',      label: 'Light',      hint: '5-6 touches over 2-3 weeks' },
  { value: 'standard',   label: 'Standard',   hint: '7-9 touches over 3-4 weeks (recommended)' },
  { value: 'aggressive', label: 'Aggressive', hint: '10-12 touches over 5-6 weeks' },
]

export const CHANNEL_OPTIONS: Array<{ value: SequenceChannel; label: string; hint: string }> = [
  { value: 'email',    label: 'Email',    hint: 'Auto-sent via your Gmail with tracking' },
  { value: 'linkedin', label: 'LinkedIn', hint: 'Manual task with AI-drafted message' },
  { value: 'sms',      label: 'SMS',      hint: 'Auto-sent via Twilio (toll-free verified required)' },
  { value: 'phone',    label: 'Phone',    hint: 'Manual task with AI-drafted phone script' },
]
