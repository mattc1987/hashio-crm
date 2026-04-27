// Helpers for working with sequences.

import type {
  BranchCondition,
  Company,
  Contact,
  Deal,
  Enrollment,
  EmailSend,
  Sequence,
  SequenceStep,
  StepConfig,
  StepConfigAction,
  StepConfigBranch,
  StepConfigEmail,
  StepConfigWait,
  StepType,
} from './types'

export function parseStepConfig(step: SequenceStep): StepConfig {
  try {
    return JSON.parse(step.config || '{}') as StepConfig
  } catch {
    return {} as StepConfig
  }
}

export function serializeStepConfig(config: StepConfig): string {
  return JSON.stringify(config)
}

/** Default config for a newly-created step of a given type. */
export function defaultStepConfig(type: StepType): StepConfig {
  switch (type) {
    case 'email':
      return {
        subject: '',
        body: '',
        trackOpens: true,
        replyBehavior: 'exit',
      } satisfies StepConfigEmail
    case 'wait':
      return { amount: 2, unit: 'days' } satisfies StepConfigWait
    case 'branch':
      return {
        condition: { kind: 'opened-last', withinHours: 48 },
        trueNext: -1,
        falseNext: -1,
      } satisfies StepConfigBranch
    case 'action':
      return { kind: 'create-task', payload: { title: '' } } satisfies StepConfigAction
  }
}

/** Replace merge tags in a string using the given contact/deal/company. */
export function resolveMergeTags(
  text: string,
  ctx: { contact?: Contact; deal?: Deal; company?: Company },
): string {
  if (!text) return ''
  const { contact, deal, company } = ctx
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, raw) => {
    const key = String(raw).trim()
    switch (key) {
      case 'firstName':
        return contact?.firstName || ''
      case 'lastName':
        return contact?.lastName || ''
      case 'fullName':
        return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ')
      case 'email':
        return contact?.email || ''
      case 'title':
        return contact?.title || ''
      case 'company':
      case 'companyName':
        return company?.name || ''
      case 'dealTitle':
        return deal?.title || ''
      case 'dealValue':
        return deal ? String(deal.value) : ''
      case 'dealStage':
        return deal?.stage || ''
      default:
        return `{{${key}}}`
    }
  })
}

/** One-line human description of a branch condition (for the editor UI). */
export function describeBranch(condition: BranchCondition): string {
  switch (condition.kind) {
    case 'opened-last':
      return `opened last email${condition.withinHours ? ` within ${condition.withinHours}h` : ''}`
    case 'clicked-last':
      return `clicked last email${condition.withinHours ? ` within ${condition.withinHours}h` : ''}`
    case 'replied':
      return `replied${condition.withinHours ? ` within ${condition.withinHours}h` : ''}`
    case 'contact-field':
      return `contact.${condition.field} = "${condition.equals}"`
    case 'deal-stage':
      return `deal stage = "${condition.equals}"`
  }
}

/** Convert `amount + unit` into milliseconds (approximate — business days treated as 24h for scheduling). */
export function waitToMs(w: StepConfigWait): number {
  const H = 60 * 60 * 1000
  switch (w.unit) {
    case 'hours':
      return w.amount * H
    case 'days':
    case 'businessDays':
      return w.amount * 24 * H
    case 'weeks':
      return w.amount * 7 * 24 * H
  }
}

/** Group steps by sequence id, sorted by order. */
export function groupStepsBySequence(steps: SequenceStep[]): Record<string, SequenceStep[]> {
  const out: Record<string, SequenceStep[]> = {}
  for (const s of steps) {
    if (!out[s.sequenceId]) out[s.sequenceId] = []
    out[s.sequenceId].push(s)
  }
  Object.keys(out).forEach((k) => out[k].sort((a, b) => a.order - b.order))
  return out
}

/** Active enrollments for a given sequence. */
export function enrollmentStats(sequence: Sequence, enrollments: Enrollment[]) {
  const mine = enrollments.filter((e) => e.sequenceId === sequence.id)
  return {
    total: mine.length,
    active: mine.filter((e) => e.status === 'active').length,
    completed: mine.filter((e) => e.status === 'completed').length,
    stopped: mine.filter((e) => e.status.startsWith('stopped')).length,
    paused: mine.filter((e) => e.status === 'paused').length,
  }
}

/** Latest send for an enrollment (used in list row to show progress). */
export function latestSend(enrollment: Enrollment, sends: EmailSend[]): EmailSend | undefined {
  const mine = sends.filter((s) => s.enrollmentId === enrollment.id)
  if (!mine.length) return undefined
  return mine.reduce((a, b) => (a.sentAt > b.sentAt ? a : b))
}
