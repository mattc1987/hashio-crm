import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Mail, Phone, MessageSquare, Users, ChevronRight, MapPin, Link2, Zap, X, Trash2, AlertTriangle } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, PageHeader, Empty, Avatar, Badge } from '../components/ui'
import { ContactEditor } from '../components/editors/ContactEditor'
import type { Contact, Company, Sequence } from '../lib/types'
import { cn } from '../lib/cn'
import { api } from '../lib/api'
import { ContactFilterBar } from '../components/ContactFilterBar'
import { applyContactFilter, EMPTY_FILTER, type ContactFilterState } from '../lib/contactFilter'
import { enrichContactsBulk } from '../lib/bdrAi'
import { Sparkles, ShieldCheck, UserPlus2 } from 'lucide-react'
import { backfillNamesBulk } from '../lib/nameFromEmail'
import { hasWriteBackend, bulkUpdate, bulkCreate } from '../lib/api'
import { AIBdrDrawer } from '../components/AIBdrDrawer'
import { telUrl, smsUrl, formatPhoneDisplay } from '../lib/phone'
import { checkAllContacts, tagsWithQualityFlags, flagsToNoteBody, summarizeFlags } from '../lib/qualityCheck'

export function Contacts() {
  const { state, refresh } = useSheetData()
  const [filterState, setFilterState] = useState<ContactFilterState>(EMPTY_FILTER)
  const [creating, setCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [enrollFor, setEnrollFor] = useState<string | null>(null) // contact id for single-enroll popover
  const [aiContact, setAiContact] = useState<Contact | null>(null) // contact for AI BDR drawer
  const [scanRunning, setScanRunning] = useState(false)
  const [scanProgress, setScanProgress] = useState('')
  const [backfillStatus, setBackfillStatus] = useState<{ phase: 'idle' | 'running' | 'done'; message: string }>({ phase: 'idle', message: '' })
  // Anchor index for shift-click range selection. null = no anchor yet.
  const [lastSelectedIdx, setLastSelectedIdx] = useState<number | null>(null)

  const data = 'data' in state ? state.data : undefined
  const contacts = data?.contacts ?? []
  const companies = data?.companies ?? []
  const sequences = (data?.sequences ?? []).filter((s) => s.status !== 'archived')
  const deals = data?.deals ?? []
  const emailSends = data?.emailSends ?? []
  const activityLogs = data?.activityLogs ?? []

  const companyById = (id: string) => companies.find((c) => c.id === id)

  const filtered = useMemo(() => {
    return applyContactFilter(
      { contacts, companies, deals, emailSends, activityLogs },
      filterState,
    ).sort((a, b) => {
      const an = `${a.lastName}${a.firstName}`.toLowerCase()
      const bn = `${b.lastName}${b.firstName}`.toLowerCase()
      return an.localeCompare(bn)
    })
  }, [contacts, companies, deals, emailSends, activityLogs, filterState])

  if (!data) return <PageHeader title="Contacts" />

  /** Toggle a single row OR range-select with shift-click (Gmail/Finder UX).
   *  - Plain click: toggle this row, set anchor.
   *  - Shift+click: select every row between anchor and this row in the
   *    currently-filtered list. Selection mode (set vs unset) follows the
   *    state of the anchor row — same as Finder/Gmail. */
  const toggleSelect = (id: string, idx: number, shiftKey: boolean) => {
    if (shiftKey && lastSelectedIdx !== null && lastSelectedIdx !== idx) {
      const lo = Math.min(lastSelectedIdx, idx)
      const hi = Math.max(lastSelectedIdx, idx)
      const rangeIds = filtered.slice(lo, hi + 1).map((c) => c.id)
      // Selection mode: if the anchor row is selected, ADD; if unselected, REMOVE.
      // (Matches Finder behavior.)
      const anchorContact = filtered[lastSelectedIdx]
      const addMode = anchorContact ? selectedIds.has(anchorContact.id) : true
      setSelectedIds((cur) => {
        const next = new Set(cur)
        for (const rid of rangeIds) {
          if (addMode) next.add(rid)
          else next.delete(rid)
        }
        return next
      })
      setLastSelectedIdx(idx)
      return
    }
    // Plain click: toggle + update anchor
    setSelectedIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setLastSelectedIdx(idx)
  }

  const selectAll = () => {
    setSelectedIds(new Set(filtered.map((c) => c.id)))
  }

  const clearSelection = () => setSelectedIds(new Set())

  const enrollMany = async (sequenceId: string) => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    await Promise.all(
      ids.map((cid) =>
        api.enrollment.create({
          sequenceId,
          contactId: cid,
          dealId: '',
          currentStepIndex: 0,
          status: 'active',
          enrolledAt: new Date().toISOString(),
          nextFireAt: new Date().toISOString(),
        }),
      ),
    )
    clearSelection()
    refresh()
  }

  const enrollOne = async (contactId: string, sequenceId: string) => {
    await api.enrollment.create({
      sequenceId,
      contactId,
      dealId: '',
      currentStepIndex: 0,
      status: 'active',
      enrolledAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(),
    })
    setEnrollFor(null)
    refresh()
  }

  const deleteMany = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} contact${ids.length === 1 ? '' : 's'}? This can't be undone.`)) return
    await Promise.all(ids.map((id) => api.contact.remove(id)))
    clearSelection()
    refresh()
  }

  const runQualityScan = async () => {
    if (!contacts.length) return
    if (scanRunning) return

    // If contacts are selected, scan only those. Otherwise scan all.
    const scanTargets = selectedIds.size > 0
      ? contacts.filter((c) => selectedIds.has(c.id))
      : contacts
    const targetLabel = selectedIds.size > 0
      ? `${scanTargets.length} selected contact${scanTargets.length === 1 ? '' : 's'}`
      : `all ${contacts.length} contacts`

    if (!confirm(
      `Run quality scan across ${targetLabel}?\n\n` +
      `This checks for: shared admin emails (info@, sales@, etc.) with executive titles, ` +
      `personal emails at corporate roles, test/placeholder data, invalid email format, ` +
      `fake phone numbers, duplicate emails, and more.\n\n` +
      `Flagged contacts will get tags so they show up in the "AI flagged for review" view. ` +
      `Notes will be added explaining each flag. Re-running is safe — it overwrites stale flags.`,
    )) return

    setScanRunning(true)
    setScanProgress('analyzing')
    try {
      // 1. Run all checks locally (fast — sub-second for 3K contacts).
      //    Note: dupe detection is still relative to ALL contacts (not just
      //    the selection), so a selected dupe is correctly flagged even if
      //    its sibling is unselected.
      const flagsMap = checkAllContacts(contacts)
      // If scanning a subset, narrow the flagsMap to the selection
      const filteredFlagsMap = selectedIds.size > 0
        ? new Map(Array.from(flagsMap.entries()).filter(([id]) => selectedIds.has(id)))
        : flagsMap
      const summary = summarizeFlags(filteredFlagsMap, scanTargets.length)

      if (filteredFlagsMap.size === 0) {
        alert(`Quality scan complete — no issues found across ${targetLabel}. 🎉`)
        return
      }

      // 2. Build the bulk-update patches (tags) + bulk-create note records
      setScanProgress(`flagged ${filteredFlagsMap.size}, applying…`)
      const tagPatches: Array<{ id: string; tags: string }> = []
      const noteCreates: Array<Record<string, unknown>> = []
      const ts = new Date().toISOString()
      for (const cf of filteredFlagsMap.values()) {
        const c = contacts.find((x) => x.id === cf.contactId)
        if (!c) continue
        tagPatches.push({
          id: c.id,
          tags: tagsWithQualityFlags(c.tags, cf),
        })
        noteCreates.push({
          entityType: 'contact',
          entityId: c.id,
          body: flagsToNoteBody(cf),
          author: 'Quality Scan',
          createdAt: ts,
        })
      }

      // 3. Apply via bulk endpoints — chunk to keep each call manageable
      const CHUNK = 200
      let tagsUpdated = 0
      for (let i = 0; i < tagPatches.length; i += CHUNK) {
        const chunk = tagPatches.slice(i, i + CHUNK)
        setScanProgress(`tags ${i}/${tagPatches.length}`)
        const res = await bulkUpdate('contacts', chunk)
        if (res.ok) tagsUpdated += res.updated
      }

      let notesCreated = 0
      for (let i = 0; i < noteCreates.length; i += CHUNK) {
        const chunk = noteCreates.slice(i, i + CHUNK)
        setScanProgress(`notes ${i}/${noteCreates.length}`)
        const res = await bulkCreate('notes', chunk)
        if (res.ok) notesCreated += res.written
      }

      // 4. Summary alert
      const lines = [
        `Quality scan complete on ${targetLabel}.`,
        ``,
        `🚩 Flagged: ${summary.totalFlagged} (${(summary.totalFlagged / scanTargets.length * 100).toFixed(1)}%)`,
        `   • High severity: ${summary.highSeverity}`,
        `   • Medium severity: ${summary.mediumSeverity}`,
        `   • Low severity: ${summary.lowSeverity}`,
        ``,
        `Recommendations:`,
        `   🗑 Delete: ${summary.recDelete}`,
        `   🔧 Fix: ${summary.recFix}`,
        `   🔍 Research: ${summary.recResearch}`,
        ``,
        `Tags applied: ${tagsUpdated} · Notes created: ${notesCreated}`,
        ``,
        `Click "🚩 AI flagged for review" in the saved views to see them.`,
      ]
      alert(lines.join('\n'))
      refresh()
    } catch (err) {
      alert(`Quality scan error: ${(err as Error).message}`)
    } finally {
      setScanRunning(false)
      setScanProgress('')
    }
  }

  /**
   * Backfill missing first/last names from email addresses. Pulls "John Smith"
   * out of patterns like john.smith@acme.com — completely free, regex-based.
   * Operates on the SELECTION if any, else on every contact missing a name.
   * Only fills empty fields; never overwrites existing names.
   */
  const backfillNamesFromEmails = async () => {
    setBackfillStatus({ phase: 'running', message: 'analyzing emails…' })
    try {
      const targets = (selectedIds.size > 0
        ? contacts.filter((c) => selectedIds.has(c.id))
        : contacts.filter((c) => !c.firstName || !c.lastName))
        .filter((c) => c.email)
      if (targets.length === 0) {
        setBackfillStatus({ phase: 'done', message: 'No contacts to backfill — names already set or no email on file.' })
        setTimeout(() => setBackfillStatus({ phase: 'idle', message: '' }), 4000)
        return
      }
      const updates = backfillNamesBulk(targets, 60)
      if (updates.length === 0) {
        setBackfillStatus({ phase: 'done', message: `Checked ${targets.length} — no email pattern was confident enough to autofill.` })
        setTimeout(() => setBackfillStatus({ phase: 'idle', message: '' }), 5000)
        return
      }
      setBackfillStatus({ phase: 'running', message: `writing ${updates.length} update${updates.length === 1 ? '' : 's'}…` })
      const now = new Date().toISOString()
      const writeRows = updates.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        updatedAt: now,
      }))
      // Bulk update in chunks of 50
      let written = 0
      for (let i = 0; i < writeRows.length; i += 50) {
        const chunk = writeRows.slice(i, i + 50)
        const res = await bulkUpdate('contacts', chunk)
        if (res.ok) written += res.updated || chunk.length
      }
      setBackfillStatus({
        phase: 'done',
        message: `✅ Backfilled ${written} name${written === 1 ? '' : 's'} from ${targets.length} email${targets.length === 1 ? '' : 's'}.`,
      })
      setTimeout(() => setBackfillStatus({ phase: 'idle', message: '' }), 5000)
    } catch (err) {
      setBackfillStatus({ phase: 'done', message: 'Backfill failed: ' + (err as Error).message })
      setTimeout(() => setBackfillStatus({ phase: 'idle', message: '' }), 6000)
    }
  }

  const aiEnrichSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const targets = contacts.filter((c) => ids.includes(c.id))
    // Process in chunks of 50 (Apps Script bulk endpoint cap)
    const chunks: typeof targets[] = []
    for (let i = 0; i < targets.length; i += 50) chunks.push(targets.slice(i, i + 50))
    let rolesFilled = 0
    let flaggedDelete = 0
    let flaggedResearch = 0
    let flaggedOther = 0
    let totalFailed = 0
    if (data) void data // type narrowing
    for (const chunk of chunks) {
      try {
        const res = await enrichContactsBulk(chunk, data || undefined)
        for (const r of res.results) {
          const c = contacts.find((x) => x.id === r.id)
          if (!c) continue
          const patch: Record<string, unknown> = { id: r.id }
          let touched = false
          if (r.role && !c.role) { patch.role = r.role; touched = true; rolesFilled++ }
          if (r.flagged) {
            // Add ai-flag-mismatch tag + a recommendation tag (keep/research/delete)
            const existingTags = parseTags(c.tags)
            const flagTag = 'ai-flag-mismatch'
            const recTag = r.recommendation ? `ai-rec-${r.recommendation}` : ''
            const newTags = Array.from(new Set([
              ...existingTags,
              flagTag,
              ...(recTag ? [recTag] : []),
            ]))
            patch.tags = newTags.join(', ')
            touched = true
            if (r.recommendation === 'delete') flaggedDelete++
            else if (r.recommendation === 'research') flaggedResearch++
            else flaggedOther++
            // Write flag reason as a Note (separate table)
            try {
              await api.note.create({
                entityType: 'contact',
                entityId: r.id,
                body: `[AI flag] ${r.flagReason || 'mismatch detected'} (rec: ${r.recommendation || 'review'})`,
                author: 'AI BDR',
                createdAt: new Date().toISOString(),
              })
            } catch { /* non-fatal */ }
          }
          if (touched) {
            try {
              await api.contact.update(patch)
            } catch {
              totalFailed++
            }
          }
        }
      } catch {
        totalFailed += chunk.length
      }
    }
    const flagTotal = flaggedDelete + flaggedResearch + flaggedOther
    const lines = [`Roles filled: ${rolesFilled}`]
    if (flagTotal > 0) {
      lines.push(`Flagged for review: ${flagTotal}`)
      if (flaggedDelete) lines.push(`  • Recommended delete: ${flaggedDelete}`)
      if (flaggedResearch) lines.push(`  • Recommended research: ${flaggedResearch}`)
      if (flaggedOther) lines.push(`  • Other: ${flaggedOther}`)
      lines.push('')
      lines.push('Filter to "AI flagged for review" to see them.')
    }
    if (totalFailed) lines.push(`Failed: ${totalFailed}`)
    alert(lines.join('\n'))
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} people`}
        action={
          <div className="flex items-center gap-2">
            {hasWriteBackend() && contacts.length > 0 && (
              <Button
                icon={<UserPlus2 size={13} />}
                onClick={backfillNamesFromEmails}
                disabled={backfillStatus.phase === 'running'}
                title={
                  selectedIds.size > 0
                    ? `Backfill names from emails on the ${selectedIds.size} selected contact(s)`
                    : 'Backfill missing first/last names from email addresses (john.smith@acme.com → John Smith). Free, no AI cost.'
                }
              >
                {backfillStatus.phase === 'running'
                  ? `Backfilling… ${backfillStatus.message}`
                  : selectedIds.size > 0
                    ? `Backfill names (${selectedIds.size})`
                    : 'Backfill names'}
              </Button>
            )}
            {hasWriteBackend() && contacts.length > 0 && (
              <Button
                icon={<ShieldCheck size={13} />}
                onClick={runQualityScan}
                disabled={scanRunning}
                title={
                  selectedIds.size > 0
                    ? `Scan the ${selectedIds.size} selected contact${selectedIds.size === 1 ? '' : 's'} for quality issues`
                    : 'Scan all contacts for data-quality issues — runs locally, no AI cost'
                }
              >
                {scanRunning
                  ? `Scanning… ${scanProgress}`
                  : selectedIds.size > 0
                    ? `Quality scan (${selectedIds.size})`
                    : 'Quality scan'}
              </Button>
            )}
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
              New contact
            </Button>
          </div>
        }
      />

      {backfillStatus.phase === 'done' && backfillStatus.message && (
        <div className="p-3 rounded-[var(--radius-md)] bg-[color:rgba(48,179,107,0.08)] text-[12px] text-[var(--color-success)]">
          {backfillStatus.message}
        </div>
      )}

      <Card padded={false}>
        <div className="p-3 border-soft-b">
          <ContactFilterBar
            state={filterState}
            setState={setFilterState}
            contacts={contacts}
            companies={companies}
            totalCount={contacts.length}
            filteredCount={filtered.length}
          />
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Users size={22} />}
            title="No contacts match"
            description={filterState.query ? `No matches for "${filterState.query}".` : contacts.length === 0 ? 'Add your first contact.' : 'Try adjusting filters or clear all.'}
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map((c, idx) => (
              <ContactRow
                key={c.id}
                contact={c}
                company={companyById(c.companyId)}
                selected={selectedIds.has(c.id)}
                onToggleSelect={(shiftKey) => toggleSelect(c.id, idx, shiftKey)}
                onEnrollClick={() => setEnrollFor(enrollFor === c.id ? null : c.id)}
                showEnrollPopover={enrollFor === c.id}
                sequences={sequences}
                onPickSequence={(seqId) => enrollOne(c.id, seqId)}
                onClosePopover={() => setEnrollFor(null)}
                onAi={hasWriteBackend() ? () => setAiContact(c) : undefined}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Bulk action bar — appears when contacts are selected */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          totalVisible={filtered.length}
          sequences={sequences}
          onEnroll={enrollMany}
          onDelete={deleteMany}
          onSelectAll={selectAll}
          onClear={clearSelection}
          onAiEnrich={hasWriteBackend() ? aiEnrichSelected : undefined}
        />
      )}

      <ContactEditor
        open={creating}
        initial={null}
        companies={companies}
        onClose={() => setCreating(false)}
        onSaved={() => { refresh() }}
      />

      <AIBdrDrawer
        open={!!aiContact}
        onClose={() => setAiContact(null)}
        entity={aiContact ? { kind: 'contact', contact: aiContact } : null}
        data={data}
        goal="What's the best next move with this contact? They might benefit from an email, SMS, or phone call. Look at their history and recommend one concrete action — draft any message that's needed."
        onApplied={() => { setAiContact(null); refresh() }}
      />
    </div>
  )
}

function ContactRow({
  contact, company,
  selected, onToggleSelect,
  onEnrollClick, showEnrollPopover,
  sequences, onPickSequence, onClosePopover,
  onAi,
}: {
  contact: Contact
  company?: Company
  selected: boolean
  onToggleSelect: (shiftKey: boolean) => void
  onEnrollClick: () => void
  showEnrollPopover: boolean
  sequences: Sequence[]
  onPickSequence: (sequenceId: string) => void
  onClosePopover: () => void
  onAi?: () => void
}) {
  const tags = parseTags(contact.tags)
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:surface-2 transition-colors group',
        selected && 'bg-[color:rgba(122,94,255,0.05)]',
      )}
    >
      {/* Selection checkbox — supports shift-click for range select */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect(e.shiftKey) }}
        className={cn(
          'w-4 h-4 rounded-[4px] border-2 shrink-0 grid place-items-center transition-all',
          selected
            ? 'bg-[var(--color-brand-600)] border-[var(--color-brand-600)]'
            : 'border-[var(--border-strong)] opacity-0 group-hover:opacity-100 hover:border-[var(--color-brand-500)]',
        )}
        aria-label={selected ? 'Deselect' : 'Select'}
      >
        {selected && (
          <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-white">
            <path d="M2.5 6l2.5 2.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        )}
      </button>
      <Link
        to={`/contacts/${contact.id}`}
        className="flex items-center gap-4 flex-1 text-left min-w-0"
      >
      <Avatar firstName={contact.firstName} lastName={contact.lastName} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-medium text-body truncate">
            {contact.firstName} {contact.lastName}
          </div>
          {tags.includes('ai-flag-mismatch') && (() => {
            const reason = getTopFlagReason(tags)
            const isDelete = tags.includes('ai-rec-delete')
            const tone = isDelete
              ? 'bg-[color:rgba(239,76,76,0.12)] text-[var(--color-danger)]'
              : 'bg-[color:rgba(245,165,36,0.18)] text-[var(--color-warning)]'
            return (
              <span
                className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded', tone)}
                title={`AI flagged · ${reason.tooltip}`}
              >
                <AlertTriangle size={10} />
                {isDelete ? 'delete?' : 'flag'}
                {reason.label && <span className="opacity-80">· {reason.label}{reason.extra ? ` +${reason.extra}` : ''}</span>}
              </span>
            )
          })()}
          {contact.status === 'Customer' && <Badge tone="success">Customer</Badge>}
          {contact.status && contact.status !== 'Customer' && <Badge tone="neutral">{contact.status}</Badge>}
          {tags.filter((t) => !t.startsWith('ai-')).slice(0, 3).map((t) => (
            <span
              key={t}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]"
            >
              #{t}
            </span>
          ))}
          {tags.filter((t) => !t.startsWith('ai-')).length > 3 && <span className="text-[10px] text-muted">+{tags.filter((t) => !t.startsWith('ai-')).length - 3}</span>}
        </div>
        <div className="text-[11px] text-muted truncate mt-0.5">
          {contact.title || <em>No title</em>}
          {company && (
            <>
              {' · '}
              <Link to={`/companies/${company.id}`} className="hover:text-body">
                {company.name}
              </Link>
              {company.industry && <span className="text-[var(--text-faint)]"> · {company.industry}</span>}
            </>
          )}
          {contact.state && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-[var(--text-faint)]">
              <MapPin size={10} />
              {contact.state}
            </span>
          )}
        </div>
      </div>
      <ChevronRight size={15} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
      </Link>

      {/* Quick actions — outside Link so clicks don't navigate */}
      <div className="flex items-center gap-0.5 shrink-0">
        {contact.email && (
          <ActionIcon
            href={`mailto:${contact.email}`}
            icon={<Mail size={13} />}
            title={`Email ${contact.email}`}
            tone="brand"
          />
        )}
        {contact.phone && (() => {
          const sms = smsUrl(contact.phone)
          const tel = telUrl(contact.phone)
          const display = formatPhoneDisplay(contact.phone)
          return (
            <>
              {sms && (
                <ActionIcon
                  href={sms}
                  icon={<MessageSquare size={13} />}
                  title={`Text ${display}`}
                  tone="success"
                />
              )}
              {tel && (
                <ActionIcon
                  href={tel}
                  icon={<Phone size={13} />}
                  title={`Call ${display}`}
                  tone="info"
                />
              )}
            </>
          )
        })()}
        {contact.linkedinUrl && (
          <ActionIcon
            href={contact.linkedinUrl}
            target="_blank"
            icon={<Link2 size={13} />}
            title="LinkedIn"
            tone="info"
          />
        )}
        {onAi && (
          <button
            onClick={(e) => { e.stopPropagation(); onAi() }}
            className="w-7 h-7 rounded-[var(--radius-sm)] grid place-items-center text-[var(--text-faint)] hover:text-[var(--color-brand-600)] hover:bg-[color:rgba(122,94,255,0.1)] transition-colors"
            title="Ask AI BDR for the next move"
          >
            <Sparkles size={13} />
          </button>
        )}
      </div>

      {/* Inline enroll-in-sequence button + popover */}
      <div className="relative shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onEnrollClick() }}
          className={cn(
            'w-7 h-7 rounded-[var(--radius-sm)] grid place-items-center transition-colors',
            showEnrollPopover
              ? 'bg-[var(--color-brand-600)] text-white'
              : 'text-[var(--text-faint)] hover:text-[var(--color-brand-600)] hover:surface-3',
          )}
          title="Enroll in sequence"
        >
          <Zap size={13} />
        </button>
        {showEnrollPopover && (
          <>
            <div className="fixed inset-0 z-10" onClick={onClosePopover} />
            <div className="absolute right-0 top-9 z-20 w-64 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1 animate-fade-in">
              <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] border-soft-b">
                Enroll in sequence
              </div>
              {sequences.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted">No sequences yet.</div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {sequences.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => onPickSequence(s.id)}
                      className="w-full text-left px-3 py-2 text-[13px] hover:surface-2 rounded-[var(--radius-sm)] transition-colors"
                    >
                      <div className="text-body font-medium truncate">{s.name}</div>
                      <div className="text-[11px] text-[var(--text-faint)]">{s.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function BulkActionBar({
  count, totalVisible, sequences,
  onEnroll, onDelete, onSelectAll, onClear, onAiEnrich,
}: {
  count: number
  totalVisible: number
  sequences: Sequence[]
  onEnroll: (sequenceId: string) => void
  onDelete: () => void
  onSelectAll: () => void
  onClear: () => void
  onAiEnrich?: () => void
}) {
  const [enrollOpen, setEnrollOpen] = useState(false)
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 surface border-soft shadow-soft-xl rounded-full px-4 py-2.5 flex items-center gap-3 animate-fade-in">
      <span className="text-[13px] font-medium text-body whitespace-nowrap">
        {count} selected
      </span>
      {count < totalVisible && (
        <button
          onClick={onSelectAll}
          className="text-[12px] text-muted hover:text-body whitespace-nowrap"
        >
          Select all {totalVisible}
        </button>
      )}
      <button
        onClick={onClear}
        className="text-[12px] text-muted hover:text-body whitespace-nowrap"
      >
        Unselect all
      </button>
      <span className="w-px h-5 bg-[var(--border)]" />
      {onAiEnrich && (
        <>
          <button
            onClick={onAiEnrich}
            className="text-[12px] font-medium text-body hover:text-[var(--color-brand-600)] inline-flex items-center gap-1.5 whitespace-nowrap"
            title="AI fills empty Role fields based on Title"
          >
            <Sparkles size={13} /> AI enrich roles
          </button>
          <span className="w-px h-5 bg-[var(--border)]" />
        </>
      )}
      <div className="relative">
        <button
          onClick={() => setEnrollOpen((v) => !v)}
          className="text-[12px] font-medium text-body hover:text-[var(--color-brand-600)] inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          <Zap size={13} /> Enroll in sequence
        </button>
        {enrollOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setEnrollOpen(false)} />
            <div className="absolute bottom-full left-0 mb-2 z-20 w-64 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1">
              {sequences.length === 0 ? (
                <div className="px-3 py-3 text-[12px] text-muted">No sequences yet.</div>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  {sequences.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => { onEnroll(s.id); setEnrollOpen(false) }}
                      className="w-full text-left px-3 py-2 text-[13px] hover:surface-2 rounded-[var(--radius-sm)] transition-colors"
                    >
                      <div className="text-body font-medium truncate">{s.name}</div>
                      <div className="text-[11px] text-[var(--text-faint)]">{s.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <button
        onClick={onDelete}
        className="text-[12px] font-medium text-[var(--color-danger)] hover:opacity-80 inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <Trash2 size={12} /> Delete
      </button>
      <span className="w-px h-5 bg-[var(--border)]" />
      <button
        onClick={onClear}
        className="text-[12px] font-medium text-muted hover:text-body inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <X size={12} /> Unselect all
      </button>
    </div>
  )
}

export function parseTags(raw: string): string[] {
  if (!raw) return []
  return raw.split(/[,|]+/).map((t) => t.trim()).filter(Boolean)
}

// ============================================================
// Row-level flag reason — short chip text + tooltip text
// ============================================================

// Priority order — most severe / most actionable first. The contact's
// "headline" reason is the highest-priority flag we find on the contact.
const FLAG_PRIORITY: Array<{
  tag: string
  short: string         // appears inline on the row
  long: string          // appears in tooltip
}> = [
  // Delete-recommended
  { tag: 'ai-flag-duplicate-email',          short: 'dupe email',         long: 'Duplicate of an earlier contact (same email)' },
  { tag: 'ai-flag-duplicate-name-company',   short: 'dupe name+co',       long: 'Duplicate of an earlier contact (same name + company)' },
  { tag: 'ai-flag-no-reply-email',           short: 'noreply',            long: 'Automated/no-reply email — not a real person' },
  { tag: 'ai-flag-test-data',                short: 'test data',          long: 'Looks like test/placeholder data' },
  { tag: 'ai-flag-admin-email-with-person',  short: 'admin email',        long: 'Shared admin inbox attached to a person' },
  // Fix-recommended
  { tag: 'ai-flag-invalid-email',            short: 'invalid email',      long: 'Invalid email format' },
  { tag: 'ai-flag-title-is-company-name',    short: 'title=company',      long: 'Title looks like a company name (wrong column?)' },
  { tag: 'ai-flag-title-is-email',           short: 'title=email',        long: 'Title contains an email (wrong column?)' },
  { tag: 'ai-flag-title-is-phone',           short: 'title=phone',        long: 'Title looks like a phone number (wrong column?)' },
  { tag: 'ai-flag-email-domain-typo',        short: 'domain typo',        long: 'Email domain looks like a typo' },
  { tag: 'ai-flag-phone-fake-pattern',       short: 'fake phone',         long: 'Phone matches a fake/placeholder pattern' },
  { tag: 'ai-flag-phone-too-short',          short: 'phone short',        long: 'Phone number too short' },
  // Research-recommended
  { tag: 'ai-flag-email-name-mismatch',      short: 'wrong name',         long: "Email contains a different person's name" },
  { tag: 'ai-flag-personal-email-senior-title', short: 'personal email', long: 'Personal email at a senior corporate title' },
  { tag: 'ai-flag-no-name-no-title',         short: 'no name/title',      long: 'No name and no title' },
  { tag: 'ai-flag-no-contact-info',          short: 'no contact info',    long: 'No email and no phone' },
]

function getTopFlagReason(tags: string[]): { label: string; tooltip: string; extra: number } {
  const matched = FLAG_PRIORITY.filter((f) => tags.includes(f.tag))
  if (matched.length === 0) {
    return { label: '', tooltip: 'AI flagged this contact — open to see details', extra: 0 }
  }
  const top = matched[0]
  const tooltip = matched.map((m) => `• ${m.long}`).join('\n')
  return {
    label: top.short,
    tooltip,
    extra: matched.length - 1,
  }
}

// Quick-action icon button for contact rows. tel:, sms:, mailto: links work
// natively on mobile (and Mac via FaceTime / Messages).
function ActionIcon({
  href, target, icon, title, tone,
}: {
  href: string
  target?: string
  icon: React.ReactNode
  title: string
  tone: 'brand' | 'success' | 'info' | 'warning'
}) {
  const toneClasses: Record<string, string> = {
    brand:   'hover:text-[var(--color-brand-600)] hover:bg-[color:rgba(122,94,255,0.1)]',
    success: 'hover:text-[var(--color-success)] hover:bg-[color:rgba(48,179,107,0.1)]',
    info:    'hover:text-[var(--color-info)] hover:bg-[color:rgba(59,130,246,0.1)]',
    warning: 'hover:text-[var(--color-warning)] hover:bg-[color:rgba(245,165,36,0.12)]',
  }
  return (
    <a
      href={href}
      target={target}
      rel={target === '_blank' ? 'noreferrer' : undefined}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'w-7 h-7 rounded-[var(--radius-sm)] grid place-items-center text-[var(--text-faint)] transition-colors',
        toneClasses[tone],
      )}
      title={title}
    >
      {icon}
    </a>
  )
}
