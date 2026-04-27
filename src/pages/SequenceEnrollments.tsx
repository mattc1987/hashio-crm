import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, UserPlus, Square, Pause, Play, Mail, Check, Clock, XCircle, Trash2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Button, PageHeader, Empty, Avatar, Badge, Select } from '../components/ui'
import { api } from '../lib/api'
import { groupStepsBySequence, latestSend } from '../lib/sequences'
import { relativeDate } from '../lib/format'
import type { Enrollment } from '../lib/types'
import { cn } from '../lib/cn'

const STATUS_LABELS: Record<Enrollment['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  active:           { label: 'Active',        tone: 'success' },
  paused:           { label: 'Paused',        tone: 'warning' },
  completed:        { label: 'Completed',     tone: 'info' },
  'stopped-reply':  { label: 'Stopped: reply',tone: 'neutral' },
  'stopped-manual': { label: 'Stopped',       tone: 'neutral' },
  'stopped-error':  { label: 'Error',         tone: 'danger' },
  unsubscribed:     { label: 'Unsubscribed',  tone: 'danger' },
}

export function SequenceEnrollments() {
  const { id } = useParams<{ id: string }>()
  const { state, refresh } = useSheetData()
  const [enrolling, setEnrolling] = useState(false)
  const [pickContact, setPickContact] = useState('')

  const data = 'data' in state ? state.data : undefined
  const sequence = data?.sequences.find((s) => s.id === id)
  const enrollments = data?.enrollments.filter((e) => e.sequenceId === id) ?? []

  const alreadyEnrolled = useMemo(
    () => new Set(enrollments.map((e) => e.contactId)),
    [enrollments],
  )

  if (!data) return <PageHeader title="Enrollments" />
  if (!sequence) {
    return (
      <div>
        <Link to="/sequences" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All sequences
        </Link>
        <Empty title="Sequence not found" />
      </div>
    )
  }

  const steps = groupStepsBySequence(data.sequenceSteps)[sequence.id] || []

  const contactById = (cid: string) => data.contacts.find((c) => c.id === cid)
  const companyById = (cid: string) => data.companies.find((c) => c.id === cid)

  const enroll = async () => {
    if (!pickContact) return
    await api.enrollment.create({
      sequenceId: sequence.id,
      contactId: pickContact,
      dealId: '',
      currentStepIndex: 0,
      status: 'active',
      enrolledAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(), // fires on next scheduler tick
    })
    setPickContact('')
    setEnrolling(false)
    refresh()
  }

  const setStatus = async (e: Enrollment, status: Enrollment['status']) => {
    await api.enrollment.update({ id: e.id, status })
    refresh()
  }

  const removeEnrollment = async (e: Enrollment) => {
    const contact = contactById(e.contactId)
    const name = contact ? `${contact.firstName} ${contact.lastName}`.trim() : 'this enrollment'
    if (!confirm(`Remove ${name} from this sequence? Their email history stays in Engagement.`)) return
    await api.enrollment.remove(e.id)
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to={`/sequences/${sequence.id}`}
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> Back to editor
      </Link>

      <PageHeader
        title={sequence.name}
        subtitle={`${enrollments.length} total enrollment${enrollments.length === 1 ? '' : 's'}`}
        action={
          <Button variant="primary" icon={<UserPlus size={14} />} onClick={() => setEnrolling(true)}>
            Enroll contact
          </Button>
        }
      />

      {enrolling && (
        <Card>
          <div className="flex items-center gap-2">
            <Select
              value={pickContact}
              onChange={(e) => setPickContact(e.target.value)}
              className="flex-1 max-w-md"
            >
              <option value="">Pick a contact…</option>
              {data.contacts
                .filter((c) => !alreadyEnrolled.has(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName} — {c.email || '(no email)'}
                  </option>
                ))}
            </Select>
            <Button variant="primary" onClick={enroll} disabled={!pickContact}>Enroll</Button>
            <Button onClick={() => { setEnrolling(false); setPickContact('') }}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <CardHeader title="Enrollments" />
        {enrollments.length === 0 ? (
          <Empty
            icon={<UserPlus size={22} />}
            title="No one enrolled yet"
            description="Enroll a contact to start the sequence for them."
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {enrollments.map((e) => {
              const contact = contactById(e.contactId)
              const company = contact ? companyById(contact.companyId) : undefined
              const send = latestSend(e, data.emailSends)
              const currentStep = steps[e.currentStepIndex]
              const statusInfo = STATUS_LABELS[e.status] || STATUS_LABELS.active
              return (
                <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                  <Avatar firstName={contact?.firstName} lastName={contact?.lastName} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="text-[13px] font-medium text-body truncate">
                        {contact ? `${contact.firstName} ${contact.lastName}` : '(deleted contact)'}
                      </div>
                      <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                    </div>
                    <div className="text-[11px] text-muted mt-0.5 truncate">
                      {company?.name || '—'}
                      {contact?.email && <> · {contact.email}</>}
                    </div>
                    <div className="text-[11px] text-muted mt-1 flex items-center gap-3 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Square size={10} className="text-[var(--text-faint)]" />
                        Step {e.currentStepIndex + 1}
                        {currentStep && <span className="text-[var(--text-faint)]"> — {currentStep.label}</span>}
                      </span>
                      {e.nextFireAt && e.status === 'active' && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={10} className="text-[var(--text-faint)]" />
                          Next: {relativeDate(e.nextFireAt)}
                        </span>
                      )}
                      {send && (
                        <span className="inline-flex items-center gap-1">
                          <Mail size={10} className={cn(send.openedAt && 'text-[var(--color-success)]')} />
                          Last email {relativeDate(send.sentAt)}
                          {send.openedAt && <Check size={10} className="text-[var(--color-success)]" />}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {e.status === 'active' && (
                      <Button size="sm" icon={<Pause size={12} />} onClick={() => setStatus(e, 'paused')}>Pause</Button>
                    )}
                    {e.status === 'paused' && (
                      <Button size="sm" icon={<Play size={12} />} onClick={() => setStatus(e, 'active')}>Resume</Button>
                    )}
                    {(e.status === 'active' || e.status === 'paused') && (
                      <Button size="sm" icon={<XCircle size={12} />} onClick={() => setStatus(e, 'stopped-manual')}>Stop</Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={12} />}
                      onClick={() => removeEnrollment(e)}
                      title="Remove this enrollment"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Clock size={13} />
          <span>
            The Apps Script scheduler runs every 5 minutes. Ensure the time-based trigger is installed — see{' '}
            <Link to="/settings" className="text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)] font-medium">
              Settings
            </Link>{' '}
            or <code className="font-mono bg-[var(--surface-3)] px-1 rounded">SETUP.md</code>.
          </span>
        </div>
      </Card>
    </div>
  )
}
