import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Mail, Phone, Users, ChevronRight, MapPin, Link2, Zap, X, Trash2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, PageHeader, Empty, Avatar, Badge } from '../components/ui'
import { ContactEditor } from '../components/editors/ContactEditor'
import type { Contact, Company, Sequence } from '../lib/types'
import { cn } from '../lib/cn'
import { api } from '../lib/api'
import { ContactFilterBar } from '../components/ContactFilterBar'
import { applyContactFilter, EMPTY_FILTER, type ContactFilterState } from '../lib/contactFilter'
import { enrichContactsBulk } from '../lib/bdrAi'
import { Sparkles } from 'lucide-react'
import { hasWriteBackend } from '../lib/api'

export function Contacts() {
  const { state, refresh } = useSheetData()
  const [filterState, setFilterState] = useState<ContactFilterState>(EMPTY_FILTER)
  const [creating, setCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [enrollFor, setEnrollFor] = useState<string | null>(null) // contact id for single-enroll popover

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

  const toggleSelect = (id: string) => {
    setSelectedIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
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

  const aiEnrichSelected = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    const targets = contacts.filter((c) => ids.includes(c.id))
    // Process in chunks of 50 (Apps Script bulk endpoint cap)
    const chunks: typeof targets[] = []
    for (let i = 0; i < targets.length; i += 50) chunks.push(targets.slice(i, i + 50))
    let totalUpdated = 0
    let totalFailed = 0
    for (const chunk of chunks) {
      try {
        const res = await enrichContactsBulk(chunk)
        for (const r of res.results) {
          const c = contacts.find((x) => x.id === r.id)
          if (!c) continue
          if (r.role && !c.role) {
            try {
              await api.contact.update({ id: r.id, role: r.role })
              totalUpdated++
            } catch {
              totalFailed++
            }
          }
        }
      } catch (err) {
        totalFailed += chunk.length
      }
    }
    alert(`AI enrich done: ${totalUpdated} role${totalUpdated === 1 ? '' : 's'} filled, ${totalFailed} failed.`)
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} people`}
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New contact
          </Button>
        }
      />

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
            {filtered.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                company={companyById(c.companyId)}
                selected={selectedIds.has(c.id)}
                onToggleSelect={() => toggleSelect(c.id)}
                onEnrollClick={() => setEnrollFor(enrollFor === c.id ? null : c.id)}
                showEnrollPopover={enrollFor === c.id}
                sequences={sequences}
                onPickSequence={(seqId) => enrollOne(c.id, seqId)}
                onClosePopover={() => setEnrollFor(null)}
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
    </div>
  )
}

function ContactRow({
  contact, company,
  selected, onToggleSelect,
  onEnrollClick, showEnrollPopover,
  sequences, onPickSequence, onClosePopover,
}: {
  contact: Contact
  company?: Company
  selected: boolean
  onToggleSelect: () => void
  onEnrollClick: () => void
  showEnrollPopover: boolean
  sequences: Sequence[]
  onPickSequence: (sequenceId: string) => void
  onClosePopover: () => void
}) {
  const tags = parseTags(contact.tags)
  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:surface-2 transition-colors group',
        selected && 'bg-[color:rgba(122,94,255,0.05)]',
      )}
    >
      {/* Selection checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
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
          {contact.status === 'Customer' && <Badge tone="success">Customer</Badge>}
          {contact.status && contact.status !== 'Customer' && <Badge tone="neutral">{contact.status}</Badge>}
          {tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]"
            >
              #{t}
            </span>
          ))}
          {tags.length > 3 && <span className="text-[10px] text-muted">+{tags.length - 3}</span>}
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
      <div className="hidden md:flex items-center gap-3 text-[11px] text-muted">
        {contact.linkedinUrl && (
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 hover:text-[#0a66c2]"
            title="LinkedIn"
          >
            <Link2 size={12} />
          </a>
        )}
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-body max-w-[220px] truncate">
            <Mail size={11} /> {contact.email}
          </a>
        )}
        {contact.phone && (
          <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-body">
            <Phone size={11} /> {contact.phone}
          </a>
        )}
      </div>
      <ChevronRight size={15} className="text-[var(--text-faint)] group-hover:text-body transition-colors" />
      </Link>

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
      <button
        onClick={onSelectAll}
        className="text-[12px] text-muted hover:text-body whitespace-nowrap"
      >
        Select all {totalVisible}
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
      <button
        onClick={onClear}
        className="w-7 h-7 rounded-full grid place-items-center text-muted hover:text-body hover:surface-2"
        aria-label="Clear selection"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function parseTags(raw: string): string[] {
  if (!raw) return []
  return raw.split(/[,|]+/).map((t) => t.trim()).filter(Boolean)
}
