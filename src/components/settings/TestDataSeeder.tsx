// Dev / QA tool — seeds a test scenario for the BDR so you can preview a
// proposal end-to-end without waiting for real engagement signals.
//
// Creates:
//   - Contact: Matt Test (matt@bisoninfused.com)
//   - EmailSend with openedAt = 2 days ago, no reply  → triggers R-101
//     (email-opener follow-up) which is a sensitive-risk send-email proposal.
//
// Both writes go through the local cache. If Apps Script isn't deployed yet,
// they queue locally and survive page reloads. If it IS deployed, they sync.

import { useState } from 'react'
import { Beaker, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react'
import { Card, CardHeader, Button, Badge } from '../ui'
import { api } from '../../lib/api'
import { useSheetData } from '../../lib/sheet-context'
import { recordDelete } from '../../lib/localCache'
import { cn } from '../../lib/cn'

const TEST_EMAIL = 'matt@bisoninfused.com'
const DAY = 24 * 60 * 60 * 1000

export function TestDataSeeder() {
  const { state, refresh } = useSheetData()
  const data = 'data' in state ? state.data : undefined
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const matchingContacts = data?.contacts.filter(
    (c) => c.email && c.email.toLowerCase() === TEST_EMAIL.toLowerCase(),
  ) || []
  const matchingContactIds = new Set(matchingContacts.map((c) => c.id))
  const matchingSends = data?.emailSends.filter((s) => matchingContactIds.has(s.contactId)) || []
  const goodSend = matchingSends.find(
    (s) =>
      s.openedAt &&
      !s.repliedAt &&
      (Date.now() - new Date(s.openedAt).getTime()) > DAY &&
      (Date.now() - new Date(s.openedAt).getTime()) < 5 * DAY,
  )
  const seeded = !!(matchingContacts.length > 0 && goodSend)

  const nuke = async () => {
    // Remove every contact + email send that touches the test email, from
    // local cache + remote (best-effort). This makes seed truly idempotent.
    for (const c of matchingContacts) {
      if (c.id.startsWith('local-')) {
        recordDelete('contacts', c.id)
      } else {
        try { await api.contact.remove(c.id) } catch { /* ignore */ }
      }
    }
    for (const s of matchingSends) {
      if (s.id.startsWith('local-')) {
        recordDelete('emailSends', s.id)
      } else {
        try { await api.emailSend.remove(s.id) } catch { /* ignore */ }
      }
    }
  }

  const seed = async () => {
    setWorking(true)
    setResult(null)
    try {
      // Always nuke first so re-seed gives a fully predictable starting state.
      await nuke()

      const created = await api.contact.create({
        firstName: 'Matt',
        lastName: 'Test',
        email: TEST_EMAIL,
        phone: '',
        title: 'Test target',
        companyId: '',
        status: 'new',
        state: '',
        linkedinUrl: '',
        tags: 'bdr-test',
        createdAt: new Date().toISOString(),
      })
      if (!created.ok || !created.row) throw new Error(created.error || 'Contact create failed')
      const contactId = created.row.id as string

      // openedAt 2 days ago = inside R-101's 1-5 day window.
      // sentAt 30 days ago = WAY outside the 5-day frequency cap so R-101 survives.
      const openedAt = new Date(Date.now() - 2 * DAY).toISOString()
      const sentAt = new Date(Date.now() - 30 * DAY).toISOString()
      const sendRes = await api.emailSend.create({
        enrollmentId: '',
        sequenceId: '',
        stepId: '',
        contactId,
        to: TEST_EMAIL,
        subject: 'Quick question about your cultivation ops',
        bodyPreview: 'Saw your team on LinkedIn — wanted to ask about how you currently track cost-per-pound across batches…',
        threadId: 'test-thread-' + Date.now(),
        messageId: 'test-msg-' + Date.now(),
        sentAt,
        openedAt,
        repliedAt: '',
        clickedAt: '',
        status: 'sent',
        errorMessage: '',
      })
      if (!sendRes.ok || !sendRes.row) throw new Error(sendRes.error || 'EmailSend create failed')

      setResult({
        ok: true,
        message: `Cleaned up old data + seeded fresh test. Open /briefing — a sensitive proposal for "Matt Test" should appear under Need approval.`,
      })
      refresh()
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setWorking(false)
    }
  }

  const clear = async () => {
    setWorking(true)
    setResult(null)
    try {
      await nuke()
      setResult({
        ok: true,
        message: `Cleared ${matchingContacts.length} contact(s) + ${matchingSends.length} email send(s) for ${TEST_EMAIL}.`,
      })
      refresh()
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Beaker size={14} className="text-[var(--color-warning)]" />
            Developer · BDR test scenario
          </span>
        }
        subtitle={`Seeds a contact (${TEST_EMAIL}) + a fake "opened your email 2 days ago" signal so R-101 fires and you can preview the BDR end-to-end.`}
        action={seeded ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Not seeded</Badge>}
      />

      <div className="flex flex-col gap-3">
        <div className="text-[12px] text-muted leading-relaxed">
          <p>
            R-101 (email-opener follow-up) is sensitive-risk, so the resulting proposal will
            show up on <strong>/briefing</strong> with a "Draft with AI" button. Click it to
            test the Claude round-trip <em>after</em> you deploy the Apps Script update.
          </p>
          <p className="mt-2">
            Until then, the "Draft with AI" button will fail with the same
            "Apps Script needs redeploy" error you saw on the Anthropic config — that's how
            you'll know everything's wired right.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            icon={<Beaker size={13} />}
            onClick={seed}
            disabled={working}
          >
            {working
              ? 'Working…'
              : seeded
                ? 'Re-seed (data already exists)'
                : `Seed test scenario for ${TEST_EMAIL}`}
          </Button>
          {seeded && (
            <Button
              variant="secondary"
              icon={<Trash2 size={13} />}
              onClick={clear}
              disabled={working}
            >
              Clear test data
            </Button>
          )}
        </div>

        {result && (
          <div
            className={cn(
              'flex items-start gap-2 p-3 rounded-[var(--radius-md)] text-[12px]',
              result.ok
                ? 'bg-[color:rgba(48,179,107,0.1)] text-[var(--color-success)]'
                : 'bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]',
            )}
          >
            {result.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
            <span>{result.message}</span>
          </div>
        )}
      </div>
    </Card>
  )
}
