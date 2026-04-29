// Agentic BDR — Executor
// =======================
//
// Takes an APPROVED proposal (already persisted with status='approved') and
// runs the underlying action through the existing `api` namespace. On success
// updates the proposal to 'executed', on failure to 'failed' with the error
// message captured in executionResult.
//
// Designed to be called from the Briefing UI when the 5-minute undo window
// elapses, OR immediately on "Approve & run now". Either way, NEVER runs
// before status is 'approved'.

import { api, invokeAction } from './api'
import type { Proposal, SheetData } from './types'

export interface ExecutionResult {
  ok: boolean
  output?: string
  error?: string
}

export async function executeProposal(
  p: Proposal,
  data: SheetData,
): Promise<ExecutionResult> {
  if (p.status !== 'approved' && p.status !== 'edited') {
    return { ok: false, error: `Proposal status is ${p.status}, not approvable` }
  }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(p.actionPayload || '{}')
  } catch {
    return { ok: false, error: 'Invalid action payload (not JSON)' }
  }

  try {
    switch (p.actionKind) {
      case 'create-task': {
        const res = await api.task.create({
          title: payload.title || p.title,
          dueDate: payload.dueDate || '',
          priority: payload.priority || 'medium',
          contactId: payload.contactId || '',
          dealId: payload.dealId || p.dealId || '',
          notes: payload.notes || p.reason,
          status: 'open',
          createdAt: new Date().toISOString(),
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Task ${res.row?.id} created` }
      }

      case 'update-deal': {
        const dealId = (payload.dealId as string) || p.dealId
        if (!dealId) return { ok: false, error: 'No dealId on update-deal proposal' }
        const patch = (payload.patch as Record<string, unknown>) || {}
        const res = await api.deal.update({ id: dealId, ...patch })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Deal ${dealId} updated: ${Object.keys(patch).join(', ')}` }
      }

      case 'update-contact': {
        // Special bundle: R-005 lead → contact + deal conversion
        if (payload.bundle === 'lead-conversion') {
          const snap = (payload.leadSnapshot as Record<string, string>) || {}
          // 1. Create contact
          const cRes = await api.contact.create({
            firstName: snap.firstName || '',
            lastName: snap.lastName || '',
            email: snap.email || '',
            phone: '',
            title: snap.title || '',
            companyId: '',
            status: 'new',
            state: snap.location || '',
            linkedinUrl: snap.linkedinUrl || '',
            tags: 'bdr-converted',
            createdAt: new Date().toISOString(),
          })
          if (!cRes.ok || !cRes.row) return { ok: false, error: cRes.error || 'Contact create failed' }
          const newContactId = cRes.row.id as string

          // 2. Create deal
          const dRes = await api.deal.create({
            title: `${snap.firstName} ${snap.lastName} — ${snap.companyName || 'opportunity'}`,
            contactId: newContactId,
            companyId: '',
            value: 0,
            stage: 'Lead',
            probability: 10,
            notes: `Auto-converted from lead by R-005. ${p.reason}`,
            createdAt: new Date().toISOString(),
          })
          if (!dRes.ok) return { ok: false, error: dRes.error || 'Deal create failed' }

          // 3. Mark lead as converted
          if (payload.leadId) {
            await api.lead.update({ id: payload.leadId as string, status: 'converted', convertedContactId: newContactId })
          }

          return { ok: true, output: `Lead converted: contact ${newContactId} + deal in Lead stage.` }
        }

        // Default update-contact path
        const contactId = (payload.contactId as string) || (p.contactIds || '').split(',')[0]
        if (!contactId) return { ok: false, error: 'No contactId on update-contact proposal' }
        const patch = (payload.patch as Record<string, unknown>) || {}
        const res = await api.contact.update({ id: contactId, ...patch })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Contact ${contactId} updated` }
      }

      case 'log-activity': {
        // Resolve contact id (from leadId if needed)
        let entityType = (payload.entityType as string) || 'contact'
        let entityId = (payload.entityId as string) || ''
        if (!entityId && payload.leadId) {
          // Try to find an existing contact by lead's email
          const lead = data.leads.find((l) => l.id === payload.leadId)
          if (lead && lead.email) {
            const existing = data.contacts.find(
              (c) => c.email && c.email.toLowerCase() === lead.email.toLowerCase(),
            )
            if (existing) {
              entityId = existing.id
            } else {
              // Create the contact from lead, then attach the log
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
                tags: '',
                createdAt: new Date().toISOString(),
              })
              if (!create.ok || !create.row) return { ok: false, error: create.error || 'Contact create failed' }
              entityId = create.row.id as string
            }
          } else if (lead) {
            // No email — fall back to contact-less log keyed on the lead
            entityType = 'contact'
            entityId = `lead-${lead.id}`
          }
        }
        if (!entityId) return { ok: false, error: 'No subject for activity log' }
        const res = await api.activityLog.create({
          entityType,
          entityId,
          kind: payload.kind || 'other',
          outcome: payload.outcome || '',
          body: payload.body || p.reason,
          durationMinutes: payload.durationMinutes || 0,
          occurredAt: payload.occurredAt || new Date().toISOString(),
          createdAt: new Date().toISOString(),
          author: 'BDR',
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Activity log ${res.row?.id} created` }
      }

      case 'create-note': {
        const res = await api.note.create({
          entityType: payload.entityType || 'deal',
          entityId: payload.entityId || '',
          body: payload.body || p.reason,
          author: 'BDR',
          createdAt: new Date().toISOString(),
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Note ${res.row?.id} created` }
      }

      case 'enroll-in-sequence': {
        const sequenceId = payload.sequenceId as string
        if (!sequenceId) return { ok: false, error: 'No sequenceId' }
        let contactId = (payload.contactId as string) || ''
        // From a lead snapshot? Create the contact first.
        if (!contactId && payload.leadSnapshot) {
          const snap = payload.leadSnapshot as Record<string, string>
          const existing = data.contacts.find(
            (c) => c.email && snap.email && c.email.toLowerCase() === snap.email.toLowerCase(),
          )
          if (existing) {
            contactId = existing.id
          } else {
            const create = await api.contact.create({
              firstName: snap.firstName || '',
              lastName: snap.lastName || '',
              email: snap.email || '',
              phone: '',
              title: snap.title || '',
              companyId: '',
              status: 'new',
              state: '',
              linkedinUrl: snap.linkedinUrl || '',
              tags: 'bdr-enrolled',
              createdAt: new Date().toISOString(),
            })
            if (!create.ok || !create.row) return { ok: false, error: create.error || 'Contact create failed' }
            contactId = create.row.id as string

            // Mark the lead as converted
            if (payload.leadId) {
              await api.lead.update({ id: payload.leadId, status: 'converted', convertedContactId: contactId })
            }
          }
        }
        if (!contactId) return { ok: false, error: 'No contactId for enrollment' }
        const res = await api.enrollment.create({
          sequenceId,
          contactId,
          dealId: payload.dealId || '',
          currentStepIndex: 0,
          status: 'active',
          enrolledAt: new Date().toISOString(),
          lastFiredAt: '',
          nextFireAt: new Date().toISOString(), // immediate first fire
          notes: `Enrolled by BDR rule ${p.ruleId}`,
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Enrolled contact ${contactId} in sequence ${sequenceId}` }
      }

      case 'send-email': {
        // If we have an AI-drafted (or hand-edited) subject + body, send it
        // for real via Gmail. Otherwise fall back to a handoff task so Matt
        // can write the message himself.
        const draftedSubject = (payload.draftedSubject as string) || ''
        const draftedBody = (payload.draftedBody as string) || ''
        const draftedBy = (payload.draftedBy as string) || ''

        if (draftedSubject && draftedBody) {
          // Resolve the recipient. Prefer payload.contactId → contact.email,
          // fall back to payload.contactEmail (R-104 no-show recovery uses this).
          const contactId = (payload.contactId as string) || (p.contactIds || '').split(',')[0] || ''
          const contact = contactId ? data.contacts.find((c) => c.id === contactId) : undefined
          const to = contact?.email || (payload.contactEmail as string) || ''
          if (!to) return { ok: false, error: 'No recipient email — contact has no email on file.' }

          const res = await invokeAction('sendBdrEmail', {
            to,
            subject: draftedSubject,
            body: draftedBody,
            contactId,
            trackOpens: true,
          })
          if (!res.ok) return { ok: false, error: res.error || 'Send failed' }
          const sentData = (res as { data?: { sendId?: string } }).data
          return {
            ok: true,
            output: `Email sent to ${to}${sentData?.sendId ? ` (id ${sentData.sendId})` : ''}${draftedBy ? ` · drafted by ${draftedBy}` : ''}`,
          }
        }

        // No draft → handoff task
        const taskNotesParts: string[] = []
        taskNotesParts.push(`[BDR proposal ${p.id}] ${p.reason}`)
        taskNotesParts.push(`Expected: ${p.expectedOutcome}`)
        if (payload.templateHint) taskNotesParts.push(`Template hint: ${payload.templateHint}`)
        taskNotesParts.push('')
        taskNotesParts.push('Click "Draft with AI" on the BDR proposal to generate a message — or write your own.')

        const taskRes = await api.task.create({
          title: p.title,
          dueDate: new Date().toISOString(),
          priority: 'high',
          contactId: (payload.contactId as string) || (p.contactIds || '').split(',')[0] || '',
          dealId: (payload.dealId as string) || p.dealId || '',
          notes: taskNotesParts.join('\n'),
          status: 'open',
          createdAt: new Date().toISOString(),
        })
        if (!taskRes.ok) return { ok: false, error: taskRes.error }
        return { ok: true, output: 'Outreach handoff task created — draft a message and send manually.' }
      }

      case 'send-sms': {
        // SMS still flows through handoff task (Twilio toll-free pending).
        // Once verification is approved, swap this branch to invokeAction('sendBdrSms').
        const draftedBody = (payload.draftedBody as string) || ''
        const draftedBy = (payload.draftedBy as string) || ''

        const taskNotesParts: string[] = []
        if (draftedBody) {
          taskNotesParts.push('--- DRAFTED SMS (review + edit before sending) ---')
          taskNotesParts.push(draftedBody)
          taskNotesParts.push('--- END DRAFT ---')
          if (draftedBy) taskNotesParts.push(`(Drafted by ${draftedBy})`)
          taskNotesParts.push('')
        }
        taskNotesParts.push(`[BDR proposal ${p.id}] ${p.reason}`)
        taskNotesParts.push(`Expected: ${p.expectedOutcome}`)

        const res = await api.task.create({
          title: p.title,
          dueDate: new Date().toISOString(),
          priority: 'high',
          contactId: (payload.contactId as string) || (p.contactIds || '').split(',')[0] || '',
          dealId: (payload.dealId as string) || p.dealId || '',
          notes: taskNotesParts.join('\n'),
          status: 'open',
          createdAt: new Date().toISOString(),
        })
        if (!res.ok) return { ok: false, error: res.error }
        return {
          ok: true,
          output: draftedBody
            ? 'SMS handoff task created with AI draft — review + send via Twilio (pending toll-free verification).'
            : 'SMS handoff task created — review & send.',
        }
      }

      case 'pause-enrollment': {
        const enrollmentId = payload.enrollmentId as string
        if (!enrollmentId) return { ok: false, error: 'No enrollmentId' }
        const res = await api.enrollment.update({ id: enrollmentId, status: 'paused' })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: `Enrollment paused` }
      }

      case 'merge-records': {
        // Phase 1: just create a task to do it manually.
        const res = await api.task.create({
          title: p.title,
          dueDate: new Date().toISOString(),
          priority: 'low',
          notes: p.reason,
          status: 'open',
          createdAt: new Date().toISOString(),
        })
        if (!res.ok) return { ok: false, error: res.error }
        return { ok: true, output: 'Merge handoff task created' }
      }

      default:
        return { ok: false, error: `Unsupported actionKind: ${p.actionKind}` }
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
