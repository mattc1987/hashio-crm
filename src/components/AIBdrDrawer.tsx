// AI BDR Drawer — opens from any entity (task, contact, deal, lead) and asks
// Claude what the next move should be. Shows a narrative + drafted actions
// the user can apply with one click.

import { useEffect, useState } from 'react'
import {
  Sparkles, Mail, MessageSquare, CheckSquare, Briefcase, UserPlus,
  Pause, Clock, AlertCircle, Send, Loader2, Wand2,
} from 'lucide-react'
import { Drawer } from './Drawer'
import { Button, Badge, Input, Textarea } from './ui'
import { suggestNextMove, type NextMoveSuggestion, type SuggestEntity, type NextMoveAction } from '../lib/bdrAi'
import { api, invokeAction } from '../lib/api'
import type { SheetData } from '../lib/types'
import { cn } from '../lib/cn'

interface Props {
  open: boolean
  onClose: () => void
  entity: SuggestEntity | null
  data: SheetData
  goal?: string
  onApplied?: () => void
}

export function AIBdrDrawer({ open, onClose, entity, data, goal, onApplied }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<NextMoveSuggestion | null>(null)
  const [editedSubject, setEditedSubject] = useState('')
  const [editedBody, setEditedBody] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [instruction, setInstruction] = useState('')

  // Fetch on open. Reset instruction when entity changes.
  useEffect(() => {
    if (!open || !entity) return
    setLoading(true)
    setError(null)
    setSuggestion(null)
    setApplyResult(null)
    setInstruction('')
    suggestNextMove(entity, data, { goal })
      .then((s) => {
        setSuggestion(s)
        setEditedSubject(s.draftedSubject || '')
        setEditedBody(s.draftedBody || '')
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }, [open, entity, data, goal])

  // Generic regenerate — optionally accepts an extra instruction (used by both
  // the manual "Regenerate" button and the clickable alternatives).
  const regenerateWith = async (extra?: string) => {
    if (!entity) return
    setLoading(true)
    setError(null)
    setApplyResult(null)
    try {
      const s = await suggestNextMove(entity, data, {
        goal,
        instruction: extra || instruction || '',
      })
      setSuggestion(s)
      setEditedSubject(s.draftedSubject || '')
      setEditedBody(s.draftedBody || '')
      // Don't clear `instruction` — Matt may want to refine further.
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const regenerate = () => regenerateWith()

  const apply = async () => {
    if (!suggestion || !entity) return
    setApplying(true)
    setApplyResult(null)
    try {
      const out = await applyAction(entity, suggestion, editedSubject, editedBody, data)
      setApplyResult({ ok: true, message: out })
      onApplied?.()
    } catch (err) {
      setApplyResult({ ok: false, message: (err as Error).message })
    } finally {
      setApplying(false)
    }
  }

  const isEmail = suggestion?.recommendedAction === 'send-email'
  const isSms = suggestion?.recommendedAction === 'send-sms'
  const isTask = suggestion?.recommendedAction === 'create-task'

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--color-brand-600)]" />
          AI BDR — next move
        </span>
      }
      subtitle={
        suggestion
          ? `${actionLabel(suggestion.recommendedAction)} · confidence ${suggestion.confidence}/100`
          : 'Reading the context + asking Claude…'
      }
      footer={
        suggestion ? (
          <>
            <Button variant="ghost" onClick={onClose}>Dismiss</Button>
            <Button variant="secondary" onClick={regenerate} disabled={loading}>
              Regenerate
            </Button>
            <Button
              variant="primary"
              onClick={apply}
              disabled={applying || loading || suggestion.recommendedAction === 'wait' || suggestion.recommendedAction === 'pause'}
              icon={applying ? <Loader2 size={13} className="animate-spin" /> : actionIcon(suggestion.recommendedAction)}
            >
              {applying ? 'Applying…' : applyButtonLabel(suggestion.recommendedAction)}
            </Button>
          </>
        ) : null
      }
    >
      {loading && (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Loader2 size={14} className="animate-spin" />
          Claude is reading the data + drafting…
        </div>
      )}

      {error && (
        <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px] text-[var(--color-danger)] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {suggestion && (
        <div className="flex flex-col gap-4">
          {/* Narrative */}
          <div className="bg-gradient-to-br from-[color:rgba(122,94,255,0.08)] to-transparent border border-[color:rgba(122,94,255,0.2)] rounded-[var(--radius-md)] p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={13} className="text-[var(--color-brand-600)]" />
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
                BDR read
              </span>
              <Badge tone="brand">{suggestion.model}</Badge>
            </div>
            <div className="text-[13px] text-body leading-relaxed">{suggestion.narrative}</div>
          </div>

          {/* Recommendation */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">
              Recommendation
            </div>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-7 h-7 rounded-full grid place-items-center bg-[color:rgba(122,94,255,0.14)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
                {actionIcon(suggestion.recommendedAction)}
              </span>
              <span className="font-medium text-[13px] text-body">{actionLabel(suggestion.recommendedAction)}</span>
              <Badge tone={confidenceTone(suggestion.confidence)}>{suggestion.confidence}/100 confidence</Badge>
            </div>
            <div className="text-[12px] text-muted leading-relaxed">{suggestion.reasoning}</div>
          </div>

          {/* Drafted email */}
          {isEmail && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Wand2 size={12} className="text-[var(--color-brand-600)]" />
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)] font-semibold">
                  Email draft — edit before sending
                </span>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Subject</div>
                <Input value={editedSubject} onChange={(e) => setEditedSubject(e.target.value)} className="text-[12px]" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Body</div>
                <Textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={9} className="text-[12px]" />
              </div>
            </div>
          )}

          {/* Drafted SMS */}
          {isSms && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 flex flex-col gap-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">SMS draft</div>
              <Textarea value={editedBody} onChange={(e) => setEditedBody(e.target.value)} rows={4} className="text-[12px]" />
              <div className="text-[10px] text-muted text-right">{editedBody.length}/320 chars · {Math.ceil(editedBody.length / 160) || 1} segment(s)</div>
            </div>
          )}

          {/* Drafted task */}
          {isTask && suggestion.taskTitle && (
            <div className="surface-2 rounded-[var(--radius-md)] p-3 text-[12px]">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">Task to create</div>
              <div className="font-medium text-body mb-1">{suggestion.taskTitle}</div>
              {suggestion.taskNotes && <div className="text-muted whitespace-pre-wrap">{suggestion.taskNotes}</div>}
            </div>
          )}

          {/* Alternatives — clickable to switch to that approach */}
          {suggestion.alternativeActions && suggestion.alternativeActions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1">
                Alternatives — click to regenerate with this approach
              </div>
              <div className="flex flex-col gap-1.5">
                {suggestion.alternativeActions.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => regenerateWith(`Switch to this approach instead: ${a}`)}
                    disabled={loading}
                    className="text-left text-[12px] text-muted hover:text-body hover:surface-2 surface border-soft rounded-[var(--radius-md)] px-3 py-2 transition-colors disabled:opacity-50"
                  >
                    <span className="text-[var(--color-brand-600)] font-medium mr-1">→</span>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Extra instruction input — refine the draft with custom guidance */}
          <div className="surface-2 rounded-[var(--radius-md)] p-3">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-semibold mb-1.5">
              Add context for Claude (optional)
            </div>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder='e.g. "Be more direct" · "Mention we just shipped automated batch tracking" · "Reference their LinkedIn post about cost-per-pound"'
              rows={2}
              className="text-[12px]"
            />
            <div className="text-[10px] text-muted mt-1">
              Hit <strong>Regenerate</strong> below to apply.
            </div>
          </div>

          {/* Apply result */}
          {applyResult && (
            <div
              className={cn(
                'p-3 rounded-[var(--radius-md)] text-[12px]',
                applyResult.ok
                  ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]'
                  : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
              )}
            >
              {applyResult.message}
            </div>
          )}
        </div>
      )}
    </Drawer>
  )
}

// ============================================================
// Apply the suggested action via the existing API
// ============================================================

async function applyAction(
  entity: SuggestEntity,
  s: NextMoveSuggestion,
  subject: string,
  body: string,
  data: SheetData,
): Promise<string> {
  const contactId = resolveContactId(entity)
  const dealId = resolveDealId(entity)

  switch (s.recommendedAction) {
    case 'send-email': {
      const contact = contactId ? data.contacts.find((c) => c.id === contactId) : null
      const to = contact?.email || resolveEmail(entity)
      if (!to) throw new Error('No email address found for this contact.')
      const res = await invokeAction('sendBdrEmail', {
        to,
        subject: subject || s.draftedSubject,
        body: body || s.draftedBody,
        contactId: contactId || '',
        trackOpens: true,
      })
      if (!res.ok) throw new Error(res.error || 'Send failed')
      return `Email sent to ${to}.`
    }

    case 'send-sms': {
      // Phase 1: SMS goes through handoff task until toll-free verified.
      const taskRes = await api.task.create({
        title: 'Send SMS: ' + (s.taskTitle || s.draftedBody.slice(0, 50)),
        dueDate: new Date().toISOString(),
        priority: 'high',
        contactId: contactId || '',
        dealId: dealId || '',
        notes: '--- AI-DRAFTED SMS ---\n' + (body || s.draftedBody) + '\n--- END ---\n\n' + s.reasoning,
        status: 'open',
        createdAt: new Date().toISOString(),
      })
      if (!taskRes.ok) throw new Error(taskRes.error || 'Task create failed')
      return 'SMS handoff task created (pending Twilio toll-free verification).'
    }

    case 'create-task': {
      const res = await api.task.create({
        title: s.taskTitle || 'AI suggestion',
        dueDate: new Date().toISOString(),
        priority: 'medium',
        contactId: contactId || '',
        dealId: dealId || '',
        notes: s.taskNotes || s.reasoning,
        status: 'open',
        createdAt: new Date().toISOString(),
      })
      if (!res.ok) throw new Error(res.error || 'Task create failed')
      return `Task created: "${s.taskTitle || 'AI suggestion'}"`
    }

    case 'log-activity': {
      if (!contactId) throw new Error('No contact to log against.')
      const res = await api.activityLog.create({
        entityType: 'contact',
        entityId: contactId,
        kind: 'other',
        outcome: '',
        body: s.taskNotes || s.reasoning,
        durationMinutes: 0,
        occurredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        author: 'AI BDR',
      })
      if (!res.ok) throw new Error(res.error || 'Activity log failed')
      return 'Activity logged.'
    }

    case 'update-deal': {
      const did = dealId || (entity.kind === 'deal' ? entity.deal.id : '')
      if (!did) throw new Error('No deal to update.')
      // The AI's narrative tells us what to update — for now create a task to do it
      // (full deal-update from natural language is Phase 3).
      const res = await api.task.create({
        title: 'Update deal: ' + (s.taskTitle || s.narrative.slice(0, 50)),
        dueDate: new Date().toISOString(),
        priority: 'high',
        dealId: did,
        contactId: contactId || '',
        notes: 'AI BDR recommended update:\n' + s.reasoning + '\n\n' + (s.taskNotes || ''),
        status: 'open',
        createdAt: new Date().toISOString(),
      })
      if (!res.ok) throw new Error(res.error || 'Task create failed')
      return 'Deal-update task created.'
    }

    case 'create-deal': {
      if (!contactId) throw new Error('Need a contact to create a deal.')
      const contact = data.contacts.find((c) => c.id === contactId)
      const res = await api.deal.create({
        title: s.taskTitle || `${contact?.firstName} ${contact?.lastName} — opportunity`,
        contactId,
        companyId: contact?.companyId || '',
        value: 0,
        stage: 'Lead',
        probability: 10,
        notes: 'Created by AI BDR. Reasoning: ' + s.reasoning,
        createdAt: new Date().toISOString(),
      })
      if (!res.ok) throw new Error(res.error || 'Deal create failed')
      return 'New deal created in Lead stage. Refine value + close date when you have them.'
    }

    case 'convert-lead': {
      if (entity.kind !== 'lead') throw new Error('convert-lead only valid on a lead.')
      const lead = entity.lead
      // 1. Create contact from lead
      const create = await api.contact.create({
        firstName: lead.firstName,
        lastName: lead.lastName,
        email: lead.email,
        phone: '',
        title: lead.title || lead.headline || '',
        companyId: '',
        status: 'new',
        state: lead.location || '',
        linkedinUrl: lead.linkedinUrl || '',
        tags: 'ai-bdr-converted',
        createdAt: new Date().toISOString(),
      })
      if (!create.ok || !create.row) throw new Error(create.error || 'Contact create failed')
      const newContactId = create.row.id as string

      // 2. Create deal
      const dealRes = await api.deal.create({
        title: s.taskTitle || `${lead.firstName} ${lead.lastName} (${lead.companyName})`,
        contactId: newContactId,
        companyId: '',
        value: 0,
        stage: 'Lead',
        probability: 10,
        notes: 'Converted from lead via AI BDR. Reasoning: ' + s.reasoning,
        createdAt: new Date().toISOString(),
      })
      if (!dealRes.ok) throw new Error(dealRes.error || 'Deal create failed')

      // 3. Mark lead converted
      await api.lead.update({ id: lead.id, status: 'converted', convertedContactId: newContactId })
      return 'Lead converted: contact + deal created in Lead stage.'
    }

    case 'wait':
    case 'pause':
      return 'Noted — no action taken right now.'

    default:
      throw new Error(`Unknown action: ${s.recommendedAction}`)
  }
}

// ============================================================
// Helpers
// ============================================================

function resolveContactId(e: SuggestEntity): string {
  if (e.kind === 'contact') return e.contact.id
  if (e.kind === 'task') return e.task.contactId || ''
  if (e.kind === 'deal') return e.deal.contactId || ''
  return ''
}
function resolveDealId(e: SuggestEntity): string {
  if (e.kind === 'deal') return e.deal.id
  if (e.kind === 'task') return e.task.dealId || ''
  return ''
}
function resolveEmail(e: SuggestEntity): string {
  if (e.kind === 'contact') return e.contact.email
  if (e.kind === 'lead') return e.lead.email
  return ''
}

function actionIcon(a: NextMoveAction) {
  const props = { size: 13 }
  switch (a) {
    case 'send-email': return <Mail {...props} />
    case 'send-sms': return <MessageSquare {...props} />
    case 'create-task': return <CheckSquare {...props} />
    case 'log-activity': return <Send {...props} />
    case 'update-deal': return <Briefcase {...props} />
    case 'create-deal': return <Briefcase {...props} />
    case 'convert-lead': return <UserPlus {...props} />
    case 'wait': return <Clock {...props} />
    case 'pause': return <Pause {...props} />
  }
}

function actionLabel(a: NextMoveAction): string {
  switch (a) {
    case 'send-email': return 'Send email'
    case 'send-sms': return 'Send SMS'
    case 'create-task': return 'Create task'
    case 'log-activity': return 'Log activity'
    case 'update-deal': return 'Update deal'
    case 'create-deal': return 'Create deal'
    case 'convert-lead': return 'Convert lead → contact + deal'
    case 'wait': return 'Wait — no action right now'
    case 'pause': return 'Pause this prospect'
  }
}

function applyButtonLabel(a: NextMoveAction): string {
  switch (a) {
    case 'send-email': return 'Send email'
    case 'send-sms': return 'Create SMS task'
    case 'create-task': return 'Create task'
    case 'log-activity': return 'Log it'
    case 'update-deal': return 'Create update task'
    case 'create-deal': return 'Create deal'
    case 'convert-lead': return 'Convert lead'
    case 'wait': return 'OK'
    case 'pause': return 'OK'
  }
}

function confidenceTone(c: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (c >= 80) return 'success'
  if (c >= 50) return 'warning'
  if (c >= 25) return 'neutral'
  return 'danger'
}
