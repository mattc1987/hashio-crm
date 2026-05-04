// Pre-flight health check for sending a sequence campaign. Runs every
// validation we can do client-side (sequence structure, content, contact
// readiness) plus the backend trigger checks. Shows green/yellow/red per
// check so the user can see exactly what to fix before firing 30 emails.
//
// Usage: /sequences/health-check  — list all sequences with quick health
//        /sequences/:id/health-check — deep audit of one sequence

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  CheckCircle2, AlertTriangle, AlertCircle, Loader2, ArrowLeft,
  ShieldCheck, Send, Clock, Users, Tag, Link2, RefreshCw,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Button, PageHeader, Badge } from '../components/ui'
import { invokeAction, hasWriteBackend } from '../lib/api'
import type { Sequence, SequenceStep, Contact, Enrollment } from '../lib/types'
import { cn } from '../lib/cn'

type Severity = 'pass' | 'warn' | 'fail' | 'info'
interface CheckResult {
  id: string
  severity: Severity
  title: string
  detail?: string
  fix?: { label: string; href?: string; onClick?: () => void }
}

interface AutomationStatus {
  runScheduler: boolean
  checkReplies: boolean
  scanInboundEmailsCron: boolean
  allCriticalInstalled: boolean
}

export function SequenceHealthCheck() {
  const { state } = useSheetData()
  const navigate = useNavigate()
  const { id: routeId } = useParams<{ id?: string }>()

  const data = state.status === 'ready' ? state.data : undefined
  const sequences = data?.sequences || []
  const steps = data?.sequenceSteps || []
  const contacts = data?.contacts || []
  const enrollments = data?.enrollments || []
  const bookingLinks = data?.bookingLinks || []
  const knowledge = data?.knowledge || []

  const sequenceId = routeId || ''

  // Backend health (server-side)
  const [automation, setAutomation] = useState<AutomationStatus | null>(null)
  const [signature, setSignature] = useState<{ source: string; plain: string; html: string } | null>(null)
  const [serverChecksDone, setServerChecksDone] = useState(false)

  const runServerChecks = async () => {
    setServerChecksDone(false)
    if (!hasWriteBackend()) { setServerChecksDone(true); return }
    try {
      const [a, s] = await Promise.all([
        invokeAction('getAllAutomationStatus', {}),
        invokeAction('getEmailSignature', {}),
      ])
      if (a.ok) setAutomation((a as { data?: AutomationStatus }).data || null)
      if (s.ok) setSignature((s as { data?: { source: string; plain: string; html: string } }).data || null)
    } catch {
      /* leave nulls */
    } finally {
      setServerChecksDone(true)
    }
  }
  useEffect(() => { void runServerChecks() }, [])

  // ---- Render the picker if no specific sequence is selected ----
  if (!sequenceId) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Sequence health check"
          subtitle="Pre-flight verification before sending a campaign. Pick a sequence below."
        />
        <BackendHealthCard automation={automation} signature={signature} loading={!serverChecksDone} onRefresh={runServerChecks} />
        <Card>
          <CardHeader title="Pick a sequence to audit" />
          {sequences.length === 0 ? (
            <div className="text-[13px] text-muted py-4">No sequences yet.</div>
          ) : (
            <div className="space-y-1">
              {sequences.map((seq) => {
                const seqSteps = steps.filter((s) => s.sequenceId === seq.id)
                const seqEnrollments = enrollments.filter((e) => e.sequenceId === seq.id)
                return (
                  <Link
                    key={seq.id}
                    to={`/sequences/${seq.id}/health-check`}
                    className="flex items-center justify-between gap-3 p-3 rounded-[var(--radius-md)] hover:surface-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-[14px] text-body truncate">{seq.name}</div>
                      <div className="text-[12px] text-muted">
                        {seqSteps.length} steps · {seqEnrollments.filter((e) => e.status === 'active').length} active enrolled
                      </div>
                    </div>
                    <Badge tone={seq.status === 'active' ? 'success' : seq.status === 'paused' ? 'warning' : 'neutral'}>
                      {seq.status}
                    </Badge>
                  </Link>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    )
  }

  // ---- Detail view: audit a specific sequence ----
  const seq = sequences.find((s) => s.id === sequenceId)
  if (!seq) {
    return (
      <Card className="text-center py-12">
        <div className="font-display font-semibold text-[15px]">Sequence not found</div>
        <Button onClick={() => navigate('/sequences')} className="mt-3">Back to sequences</Button>
      </Card>
    )
  }
  const seqSteps = steps.filter((s) => s.sequenceId === sequenceId).sort((a, b) => Number(a.order) - Number(b.order))
  const seqEnrollments = enrollments.filter((e) => e.sequenceId === sequenceId)
  const enrolledContactIds = new Set(seqEnrollments.map((e) => e.contactId))
  const enrolledContacts = contacts.filter((c) => enrolledContactIds.has(c.id))

  return (
    <SequenceHealthDetail
      sequence={seq}
      steps={seqSteps}
      enrollments={seqEnrollments}
      enrolledContacts={enrolledContacts}
      bookingLinks={bookingLinks}
      knowledgeCount={knowledge.filter((k) => k.enabled).length}
      automation={automation}
      signature={signature}
      onBack={() => navigate('/sequences/health-check')}
      onRefresh={runServerChecks}
      loading={!serverChecksDone}
    />
  )
}

// ============================================================
// Backend (Apps Script) health card — same on both pages
// ============================================================

function BackendHealthCard({
  automation, signature, loading, onRefresh,
}: {
  automation: AutomationStatus | null
  signature: { source: string; plain: string; html: string } | null
  loading: boolean
  onRefresh: () => void
}) {
  const checks: CheckResult[] = []

  if (!hasWriteBackend()) {
    checks.push({ id: 'backend', severity: 'fail', title: 'Apps Script not configured', detail: 'No write backend — sequences won\'t send.' })
  } else {
    checks.push({ id: 'backend', severity: 'pass', title: 'Apps Script connected' })
  }

  if (automation) {
    checks.push({
      id: 'scheduler',
      severity: automation.runScheduler ? 'pass' : 'fail',
      title: 'runScheduler trigger',
      detail: automation.runScheduler ? 'Fires every 5 min — sends queued sequence emails.' : 'NOT INSTALLED — sequences will queue but never fire. Click "Fix now" in the global banner.',
    })
    checks.push({
      id: 'replies',
      severity: automation.checkReplies ? 'pass' : 'fail',
      title: 'checkReplies trigger',
      detail: automation.checkReplies ? 'Fires every 5 min — detects replies + stops sequences.' : 'NOT INSTALLED — replies won\'t stop the sequence (= prospects keep getting emails after they reply).',
    })
    checks.push({
      id: 'inbound',
      severity: automation.scanInboundEmailsCron ? 'pass' : 'warn',
      title: 'scanInboundEmailsCron trigger',
      detail: automation.scanInboundEmailsCron ? 'Fires every hour — logs inbound emails on contact pages.' : 'NOT INSTALLED — inbound emails won\'t appear on contact activity feeds.',
    })
  } else if (!loading) {
    checks.push({ id: 'auto-status', severity: 'warn', title: 'Could not check trigger status', detail: 'Backend may need redeploy.' })
  }

  if (signature) {
    checks.push({
      id: 'signature',
      severity: signature.source === 'none' ? 'warn' : 'pass',
      title: 'Email signature',
      detail: signature.source === 'custom'
        ? 'Custom signature configured — appended to every sent email.'
        : signature.source === 'gmail'
        ? 'Auto-pulled from Gmail account.'
        : 'No signature set — emails will only be signed "— Matt". Set one in Settings.',
    })
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-[var(--color-brand-600)]" />
            Backend health
          </span>
        }
        subtitle="Apps Script triggers + signature — required for sequences to fire correctly."
        action={<Button variant="ghost" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Re-check
        </Button>}
      />
      {loading ? (
        <div className="text-[13px] text-muted py-3 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Running backend checks…
        </div>
      ) : (
        <CheckList checks={checks} />
      )}
    </Card>
  )
}

// ============================================================
// Per-sequence detail view
// ============================================================

function SequenceHealthDetail({
  sequence, steps, enrollments, enrolledContacts, bookingLinks, knowledgeCount,
  automation, signature, onBack, onRefresh, loading,
}: {
  sequence: Sequence
  steps: SequenceStep[]
  enrollments: Enrollment[]
  enrolledContacts: Contact[]
  bookingLinks: { id: string; name: string; slug: string; status: string }[]
  knowledgeCount: number
  automation: AutomationStatus | null
  signature: { source: string; plain: string; html: string } | null
  onBack: () => void
  onRefresh: () => void
  loading: boolean
}) {
  // ---- Structure checks ----
  const structureChecks = useMemo<CheckResult[]>(() => {
    const out: CheckResult[] = []
    if (steps.length === 0) {
      out.push({ id: 'no-steps', severity: 'fail', title: 'Sequence has no steps' })
      return out
    }
    out.push({ id: 'step-count', severity: 'info', title: `${steps.length} steps total`, detail: `${steps.filter((s) => s.type === 'email').length} email · ${steps.filter((s) => s.type === 'sms').length} sms · ${steps.filter((s) => s.type === 'wait').length} wait · ${steps.filter((s) => s.type === 'branch').length} branch · ${steps.filter((s) => s.type === 'action').length} action` })

    // Branch → email/sms WITHOUT a wait gate is the hot bug
    const branchHazards: number[] = []
    steps.forEach((s, i) => {
      if (s.type !== 'branch') return
      const cfg = safeJson(s.config)
      const trueIdx = (cfg.trueNext === undefined || cfg.trueNext === -1) ? i + 1 : Number(cfg.trueNext)
      const falseIdx = (cfg.falseNext === undefined || cfg.falseNext === -1) ? i + 1 : Number(cfg.falseNext)
      const trueDelay = Number(cfg.trueDelayMinutes || cfg.delayMinutes || 0)
      const falseDelay = Number(cfg.falseDelayMinutes || cfg.delayMinutes || 0)
      ;[{ idx: trueIdx, delay: trueDelay, arm: 'TRUE' }, { idx: falseIdx, delay: falseDelay, arm: 'FALSE' }].forEach((arm) => {
        if (arm.idx < 0 || arm.idx >= steps.length) return // exit/end
        const next = steps[arm.idx]
        if ((next.type === 'email' || next.type === 'sms') && arm.delay === 0) {
          branchHazards.push(i)
        }
      })
    })
    if (branchHazards.length === 0) {
      out.push({ id: 'branches-gated', severity: 'pass', title: 'All branches route through wait gates' })
    } else {
      out.push({
        id: 'branches-ungated',
        severity: 'warn',
        title: `${branchHazards.length} branch step(s) route directly to send`,
        detail: 'The engine inserts a 60-min safety gap automatically — but you should consider adding explicit wait steps for clarity. Affected step indexes: ' + branchHazards.map((i) => i + 1).join(', ') + '.',
      })
    }

    // Long sequences with no breakup-style final touch are a hint, not a fail
    if (steps.length >= 5) {
      const last = steps[steps.length - 1]
      const lastBody = String(safeJson(last.config).body || '').toLowerCase()
      const looksLikeBreakup = /close (your|this) file|last (one|message|email)|moving on|stop hearing from me|won't bother/i.test(lastBody)
      if (last.type === 'email' && !looksLikeBreakup) {
        out.push({ id: 'no-breakup', severity: 'info', title: 'Final email is not a "breakup"', detail: 'Optional but recommended — "permission to close your file" emails get the highest reply rate of the sequence.' })
      }
    }

    return out
  }, [steps])

  // ---- Content checks (per email/sms step) ----
  const contentChecks = useMemo<CheckResult[]>(() => {
    const out: CheckResult[] = []

    // Active booking link slugs we know are real
    const realSlugs = new Set(
      bookingLinks
        .filter((b) => b.status === 'active' || !b.status)
        .map((b) => b.slug.toLowerCase()),
    )
    const realUrlPattern = /https:\/\/mattc1987\.github\.io\/hashio-crm\/#?\/?book\/([\w-]+)/i
    const fakeUrlPattern = /(calendly\.com|hubspot\.com|savvycal\.com|cal\.com|calendar\.google\.com|chilipiper\.com)/i
    const placeholderPattern = /(\[booking\s*link\]|\[link\]|\[url\]|<link[^>]*>|\{\{link\}\})/i
    const bannedPhrases = /\b(synergy|leverage|circle back|touch base|just checking in|moving forward|reach out|low-hanging fruit|paradigm shift|game-changer|deep dive)\b/i

    steps.forEach((s, idx) => {
      if (s.type !== 'email' && s.type !== 'sms') return
      const cfg = safeJson(s.config)
      const subject = String(cfg.subject || '')
      const body = String(cfg.body || '')
      const stepLabel = `Step ${idx + 1} (${s.type})${s.label ? ': ' + s.label : ''}`

      if (!body) {
        out.push({ id: `body-empty-${s.id}`, severity: 'fail', title: `${stepLabel} — body is empty` })
        return
      }
      if (s.type === 'email' && !subject) {
        out.push({ id: `subject-empty-${s.id}`, severity: 'fail', title: `${stepLabel} — subject is empty` })
      }

      // Booking link sanity
      if (fakeUrlPattern.test(body) || fakeUrlPattern.test(subject)) {
        out.push({ id: `fake-url-${s.id}`, severity: 'fail', title: `${stepLabel} — contains a fake calendar URL`, detail: 'Calendly/HubSpot/SavvyCal aren\'t Matt\'s. Replace with the real /book/<slug> URL.' })
      }
      if (placeholderPattern.test(body) || placeholderPattern.test(subject)) {
        out.push({ id: `placeholder-${s.id}`, severity: 'fail', title: `${stepLabel} — contains a [link] placeholder`, detail: 'Email goes out as-is. Replace with a real URL.' })
      }
      const realMatches = Array.from(body.matchAll(new RegExp(realUrlPattern, 'gi')))
      realMatches.forEach((m) => {
        const slug = (m[1] || '').toLowerCase()
        if (!realSlugs.has(slug)) {
          out.push({ id: `unknown-slug-${s.id}-${slug}`, severity: 'warn', title: `${stepLabel} — booking link slug "${slug}" doesn't match any active link`, detail: 'Either the slug is wrong or that booking link is disabled.' })
        }
      })

      // Merge tags without fallback are safe with our defaults, but let user know
      // we'll be using the global default
      const tagPattern = /\{\{\s*(\w+)\s*(?:\|\|?\s*[^}]*)?\}\}/g
      const tagsSeen = new Set<string>()
      let tm
      while ((tm = tagPattern.exec(body))) tagsSeen.add(tm[1])
      while ((tm = tagPattern.exec(subject))) tagsSeen.add(tm[1])
      const fragileTags = ['firstName', 'lastName', 'fullName', 'company', 'companyName', 'title', 'role', 'state']
      const usedFragile = Array.from(tagsSeen).filter((t) => fragileTags.includes(t))
      if (usedFragile.length) {
        // Check if any usages have an inline fallback. The global Settings UI
        // also covers them, but we surface the list anyway.
        out.push({
          id: `tags-${s.id}`,
          severity: 'info',
          title: `${stepLabel} — uses ${usedFragile.length} merge tag(s): ${usedFragile.join(', ')}`,
          detail: 'Empty values fall back to your global defaults (Settings → Merge tag fallbacks). Use {{firstName||there}} for per-tag overrides.',
        })
      }

      // Voice: banned phrases
      const banMatch = body.match(bannedPhrases)
      if (banMatch) {
        out.push({ id: `voice-${s.id}`, severity: 'warn', title: `${stepLabel} — uses banned phrase "${banMatch[0]}"` })
      }

      // SMS length sanity
      if (s.type === 'sms' && body.length > 320) {
        out.push({ id: `sms-long-${s.id}`, severity: 'warn', title: `${stepLabel} — SMS body is ${body.length} chars`, detail: 'Twilio splits at ~160 chars. Keep under 320 to be safe.' })
      }

      // Subject length
      if (s.type === 'email' && subject.length > 80) {
        out.push({ id: `subj-long-${s.id}`, severity: 'info', title: `${stepLabel} — subject is ${subject.length} chars`, detail: 'Mobile inboxes truncate at ~50-60 chars.' })
      }
    })

    return out
  }, [steps, bookingLinks])

  // ---- Enrolled contact readiness ----
  const contactChecks = useMemo<CheckResult[]>(() => {
    const out: CheckResult[] = []
    const total = enrollments.length
    const active = enrollments.filter((e) => e.status === 'active').length

    if (total === 0) {
      out.push({ id: 'no-enrollments', severity: 'info', title: 'No one is enrolled yet', detail: 'Enroll contacts before launching.' })
      return out
    }
    out.push({ id: 'enrollment-count', severity: 'info', title: `${total} total enrolled · ${active} active` })

    const noEmail = enrolledContacts.filter((c) => !c.email).length
    if (noEmail > 0) {
      out.push({ id: 'no-email', severity: 'fail', title: `${noEmail} enrolled contact(s) have no email`, detail: 'Email steps will throw on those — sequence will halt for them.' })
    } else {
      out.push({ id: 'all-have-email', severity: 'pass', title: 'All enrolled contacts have an email' })
    }

    const noFirstName = enrolledContacts.filter((c) => !c.firstName).length
    if (noFirstName > 0) {
      out.push({ id: 'no-firstname', severity: 'warn', title: `${noFirstName} enrolled contact(s) have no first name`, detail: 'Will use your "firstName" fallback (default "there"). Set in Settings → Merge tag fallbacks.' })
    }

    const noCompany = enrolledContacts.filter((c) => !c.companyId).length
    if (noCompany > 0) {
      out.push({ id: 'no-company', severity: 'info', title: `${noCompany} enrolled contact(s) have no company`, detail: 'Will use your "company" fallback (default "your team").' })
    }

    return out
  }, [enrollments, enrolledContacts])

  // ---- Context checks (knowledge bank, signature, etc.) ----
  const contextChecks = useMemo<CheckResult[]>(() => {
    const out: CheckResult[] = []
    if (knowledgeCount === 0) {
      out.push({ id: 'no-knowledge', severity: 'warn', title: 'Knowledge bank is empty', detail: 'AI features (drafting replies, suggestions) won\'t have your company context. Run the interview at /knowledge.' })
    } else {
      out.push({ id: 'knowledge', severity: 'pass', title: `Knowledge bank has ${knowledgeCount} active item(s)` })
    }

    const realLinks = bookingLinks.filter((b) => b.status === 'active' || !b.status)
    if (realLinks.length === 0) {
      out.push({ id: 'no-booking', severity: 'warn', title: 'No active booking links', detail: 'AI-drafted replies that suggest meetings will fall back to "I\'ll send a few times that work." Add one at /scheduling.' })
    } else {
      out.push({ id: 'booking', severity: 'pass', title: `${realLinks.length} active booking link(s) configured` })
    }

    return out
  }, [knowledgeCount, bookingLinks])

  // ---- Quota estimate ----
  const quotaCheck = useMemo<CheckResult>(() => {
    const emailSteps = steps.filter((s) => s.type === 'email').length
    const totalEnrolled = enrollments.filter((e) => e.status === 'active').length
    const estTotalSends = emailSteps * totalEnrolled
    if (estTotalSends > 100) {
      return {
        id: 'quota',
        severity: 'warn',
        title: `Estimated ~${estTotalSends} total sends across the campaign`,
        detail: 'Free Gmail (100/day) will hit cap. If your sender is @gohashio.com on Workspace (1,500/day), you\'re fine. To stay safe: enroll in batches of 25 over multiple days.',
      }
    }
    return {
      id: 'quota',
      severity: 'pass',
      title: `Estimated ~${estTotalSends} total sends across the campaign`,
      detail: emailSteps > 0 ? `${emailSteps} email steps × ${totalEnrolled} active enrolled.` : 'No email steps enrolled.',
    }
  }, [steps, enrollments])

  // ---- Roll up overall verdict ----
  const allChecks = [
    ...structureChecks, ...contentChecks, ...contactChecks, ...contextChecks, quotaCheck,
  ]
  const failCount = allChecks.filter((c) => c.severity === 'fail').length
  const warnCount = allChecks.filter((c) => c.severity === 'warn').length
  const overall: Severity = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Button variant="ghost" onClick={onBack}><ArrowLeft size={14} /> All sequences</Button>
        </div>
      </div>

      <PageHeader
        title={`Health check — ${sequence.name}`}
        subtitle={`Pre-flight verification before sending. ${enrollments.filter((e) => e.status === 'active').length} active enrolled.`}
        action={
          <Badge tone={overall === 'pass' ? 'success' : overall === 'warn' ? 'warning' : 'danger'}>
            {overall === 'pass' && '✓ Ready to send'}
            {overall === 'warn' && `${warnCount} warning${warnCount === 1 ? '' : 's'}`}
            {overall === 'fail' && `${failCount} blocker${failCount === 1 ? '' : 's'}`}
          </Badge>
        }
      />

      <BackendHealthCard automation={automation} signature={signature} loading={loading} onRefresh={onRefresh} />

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Send size={16} /> Sequence structure</span>} />
        <CheckList checks={structureChecks} />
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Tag size={16} /> Email + SMS content</span>} />
        <CheckList checks={contentChecks} />
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Users size={16} /> Enrolled contacts</span>} />
        <CheckList checks={contactChecks} />
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Link2 size={16} /> Context (knowledge + links)</span>} />
        <CheckList checks={contextChecks} />
      </Card>

      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Clock size={16} /> Quota</span>} />
        <CheckList checks={[quotaCheck]} />
      </Card>
    </div>
  )
}

// ============================================================
// Generic CheckList renderer
// ============================================================

function CheckList({ checks }: { checks: CheckResult[] }) {
  if (checks.length === 0) {
    return <div className="text-[13px] text-muted">No checks ran.</div>
  }
  return (
    <div className="space-y-2">
      {checks.map((c) => (
        <div key={c.id} className="flex items-start gap-3 p-2 rounded-[var(--radius-md)] hover:surface-2">
          <div className="shrink-0 mt-0.5">
            {c.severity === 'pass' && <CheckCircle2 size={15} className="text-[var(--color-success)]" />}
            {c.severity === 'warn' && <AlertTriangle size={15} className="text-[var(--color-warning)]" />}
            {c.severity === 'fail' && <AlertCircle size={15} className="text-[var(--color-danger)]" />}
            {c.severity === 'info' && <span className="block w-[15px] h-[15px] rounded-full surface-3" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className={cn(
              'text-[13px] font-medium',
              c.severity === 'fail' ? 'text-[var(--color-danger)]' :
              c.severity === 'warn' ? 'text-body' :
              c.severity === 'pass' ? 'text-body' :
              'text-muted',
            )}>{c.title}</div>
            {c.detail && <div className="text-[12px] text-muted mt-0.5 leading-relaxed">{c.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

function safeJson(s: string): Record<string, unknown> {
  if (!s) return {}
  try { return JSON.parse(s) || {} } catch { return {} }
}
