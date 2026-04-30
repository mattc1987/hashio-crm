import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mail, Phone, MapPin, Building2, Link2, Pencil,
  Briefcase, Zap, Sparkles, Wand2, MessageSquare, AlertTriangle,
  Trash2, Search as SearchIcon, Settings,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Avatar, Badge, PageHeader, Empty, Button } from '../components/ui'
import { ActivityFeed } from '../components/ActivityFeed'
import { NotesSection } from '../components/NotesSection'
import { ContactEditor } from '../components/editors/ContactEditor'
import { LogActivityDrawer } from '../components/editors/LogActivityDrawer'
import { AIBdrDrawer } from '../components/AIBdrDrawer'
import { api, hasWriteBackend } from '../lib/api'
import { enrichContact } from '../lib/bdrAi'
import { telUrl, smsUrl, formatPhoneDisplay } from '../lib/phone'
import { date, currency, monthlyMRR } from '../lib/format'
import type { Sequence } from '../lib/types'
import { cn } from '../lib/cn'
import { parseTags } from './Contacts'

export function ContactDetail() {
  const { id } = useParams<{ id: string }>()
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [logging, setLogging] = useState(false)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichMsg, setEnrichMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const data = 'data' in state ? state.data : undefined
  if (!data) return <PageHeader title="Contact" />

  const contact = data.contacts.find((c) => c.id === id)
  if (!contact) {
    return (
      <div>
        <Link to="/contacts" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All contacts
        </Link>
        <Empty title="Contact not found" />
      </div>
    )
  }

  const company = data.companies.find((co) => co.id === contact.companyId)
  const contactDeals = data.deals.filter((d) => d.contactId === contact.id)
  const sequences = data.sequences.filter((s) => s.status !== 'archived')
  const activeEnrollments = data.enrollments.filter(
    (e) => e.contactId === contact.id && e.status === 'active',
  )
  const allTags = parseTags(contact.tags)
  // Visible tags exclude the ai-* meta tags — those render as a dedicated
  // flag callout below the header instead.
  const tags = allTags.filter((t) => !t.startsWith('ai-'))
  const aiFlagTypes = allTags.filter((t) => t.startsWith('ai-flag-') && t !== 'ai-flag-mismatch')
  const aiRecommendation = allTags.find((t) => t.startsWith('ai-rec-'))?.replace('ai-rec-', '') as 'delete' | 'research' | 'fix' | 'keep' | undefined
  const isFlagged = allTags.includes('ai-flag-mismatch')
  const fullName = `${contact.firstName} ${contact.lastName}`.trim() || contact.email

  const enroll = async (sequenceId: string) => {
    await api.enrollment.create({
      sequenceId,
      contactId: contact.id,
      dealId: '',
      currentStepIndex: 0,
      status: 'active',
      enrolledAt: new Date().toISOString(),
      nextFireAt: new Date().toISOString(),
    })
    setEnrollOpen(false)
    refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/contacts"
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> All contacts
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 flex-wrap">
        <Avatar firstName={contact.firstName} lastName={contact.lastName} size={64} className="text-[22px]" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="font-display text-[22px] font-semibold text-body tracking-tight">
              {fullName}
            </h1>
            {contact.status === 'Customer' && <Badge tone="success">Customer</Badge>}
            {contact.status && contact.status !== 'Customer' && <Badge tone="neutral">{contact.status}</Badge>}
            {tags.map((t) => (
              <span
                key={t}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]"
              >
                #{t}
              </span>
            ))}
          </div>
          <div className="text-[13px] text-muted flex items-center flex-wrap gap-x-3 gap-y-1">
            {contact.title && <span>{contact.title}</span>}
            {contact.role && <Badge tone="brand">{contact.role}</Badge>}
            {company && (
              <Link to={`/companies/${company.id}`} className="hover:text-body inline-flex items-center gap-1">
                <Building2 size={12} />
                {company.name}
              </Link>
            )}
            {contact.state && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} />
                {contact.state}
              </span>
            )}
            {contact.email && (
              <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 hover:text-body">
                <Mail size={11} />
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1 hover:text-body">
                <Phone size={11} />
                {contact.phone}
              </a>
            )}
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-[#0a66c2]"
              >
                <Link2 size={11} />
                LinkedIn
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(() => {
            const tel = telUrl(contact.phone)
            const sms = smsUrl(contact.phone)
            const display = formatPhoneDisplay(contact.phone)
            return (
              <>
                {tel && (
                  <a
                    href={tel}
                    className="inline-flex items-center justify-center font-medium transition-all whitespace-nowrap select-none surface border-soft text-body hover:surface-2 active:surface-3 shadow-soft-xs h-9 px-4 text-[13px] rounded-[var(--radius-md)] gap-2"
                    title={`Call ${display}`}
                  >
                    <Phone size={13} /> Call
                  </a>
                )}
                {sms && (
                  <a
                    href={sms}
                    className="inline-flex items-center justify-center font-medium transition-all whitespace-nowrap select-none surface border-soft text-body hover:surface-2 active:surface-3 shadow-soft-xs h-9 px-4 text-[13px] rounded-[var(--radius-md)] gap-2"
                    title={`Text ${display}`}
                  >
                    <MessageSquare size={13} /> Text
                  </a>
                )}
              </>
            )
          })()}
          {hasWriteBackend() && (
            <Button
              variant="primary"
              icon={<Sparkles size={13} />}
              onClick={() => setAiOpen(true)}
            >
              AI BDR
            </Button>
          )}
          {hasWriteBackend() && (
            <Button
              icon={<Wand2 size={13} />}
              disabled={enriching}
              onClick={async () => {
                setEnriching(true)
                setEnrichMsg(null)
                try {
                  const enr = await enrichContact(contact, data)
                  const patch: Record<string, unknown> = { id: contact.id }
                  if (!contact.role && enr.role) patch.role = enr.role
                  if (!contact.title && enr.title) patch.title = enr.title
                  if (!contact.linkedinUrl && enr.linkedinSearchUrl) patch.linkedinUrl = enr.linkedinSearchUrl

                  // Quality flag — add tags
                  if (enr.flagged) {
                    const existingTags = parseTags(contact.tags)
                    const flagTag = 'ai-flag-mismatch'
                    const recTag = enr.recommendation ? `ai-rec-${enr.recommendation}` : ''
                    const newTags = Array.from(new Set([
                      ...existingTags,
                      flagTag,
                      ...(recTag ? [recTag] : []),
                    ]))
                    patch.tags = newTags.join(', ')
                    // Write the flag reason as a Note record (separate table)
                    try {
                      await api.note.create({
                        entityType: 'contact',
                        entityId: contact.id,
                        body: `[AI flag] ${enr.flagReason || 'mismatch detected'} (rec: ${enr.recommendation || 'review'})`,
                        author: 'AI BDR',
                        createdAt: new Date().toISOString(),
                      })
                    } catch { /* non-fatal */ }
                  }

                  const fields = Object.keys(patch).filter((k) => k !== 'id').length
                  if (fields === 0) {
                    setEnrichMsg({ ok: true, text: `Already enriched, no flags. (${enr.confidence}% conf)` })
                  } else {
                    await api.contact.update(patch)
                    const flagSuffix = enr.flagged ? ` ⚠️ Flagged: ${enr.flagReason}` : ''
                    setEnrichMsg({
                      ok: true,
                      text: `Updated (${enr.confidence}% conf). ${enr.notes || ''}${flagSuffix}`,
                    })
                    refresh()
                  }
                } catch (err) {
                  setEnrichMsg({ ok: false, text: (err as Error).message })
                } finally {
                  setEnriching(false)
                }
              }}
              title="AI fills empty fields (especially Role from Title)"
            >
              {enriching ? 'Enriching…' : 'AI enrich'}
            </Button>
          )}
          <Button icon={<Phone size={13} />} onClick={() => setLogging(true)}>Log activity</Button>
          <div className="relative">
            <Button
              variant="primary"
              icon={<Zap size={13} />}
              onClick={() => setEnrollOpen((v) => !v)}
            >
              Enroll in sequence
            </Button>
            {enrollOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEnrollOpen(false)} />
                <div className="absolute right-0 top-full mt-1.5 z-20 w-72 surface border-soft shadow-soft-lg rounded-[var(--radius-md)] p-1 animate-fade-in">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)] border-soft-b">
                    Pick a sequence
                  </div>
                  {sequences.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-muted">No sequences yet.</div>
                  ) : (
                    <div className="max-h-72 overflow-y-auto">
                      {sequences.map((s) => (
                        <SequenceOption key={s.id} sequence={s} onClick={() => enroll(s.id)} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <Button icon={<Pencil size={13} />} onClick={() => setEditing(true)}>Edit</Button>
        </div>
        {enrichMsg && (
          <div className={`mt-2 text-[11px] ${enrichMsg.ok ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            {enrichMsg.text}
          </div>
        )}
      </div>

      {/* Active enrollments banner */}
      {activeEnrollments.length > 0 && (
        <Card className="bg-[color:rgba(122,94,255,0.06)] border-[color:rgba(122,94,255,0.2)]">
          <div className="flex items-center gap-3">
            <Zap size={16} className="text-[var(--color-brand-600)] shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-body">
                Currently enrolled in {activeEnrollments.length} sequence{activeEnrollments.length === 1 ? '' : 's'}
              </div>
              <div className="text-[11px] text-muted truncate">
                {activeEnrollments
                  .map((e) => data.sequences.find((s) => s.id === e.sequenceId)?.name)
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <Button size="sm" onClick={() => navigate(`/sequences`)}>Manage</Button>
          </div>
        </Card>
      )}

      {/* AI Flag callout — clean replacement for the raw ai-* tag pills */}
      {isFlagged && (
        <FlagCallout
          recommendation={aiRecommendation}
          flagTypes={aiFlagTypes}
          onClear={async () => {
            const cleaned = allTags.filter((t) => !t.startsWith('ai-')).join(', ')
            await api.contact.update({ id: contact.id, tags: cleaned })
            refresh()
          }}
          onDelete={async () => {
            if (!confirm(`Delete ${fullName}? This can't be undone.`)) return
            await api.contact.remove(contact.id)
            navigate('/contacts')
          }}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open deals" value={contactDeals.filter((d) => !d.stage.startsWith('Closed')).length.toString()} />
        <StatCard
          label="Pipeline value"
          value={currency(contactDeals.filter((d) => !d.stage.startsWith('Closed')).reduce((s, d) => s + d.value, 0), { compact: true })}
        />
        <StatCard
          label="Active MRR"
          value={currency(contactDeals.filter((d) => d.stage === 'Closed Won').reduce((s, d) => s + monthlyMRR(d), 0))}
        />
        <StatCard label="Created" value={date(contact.createdAt, 'MMM d, yyyy')} />
      </div>

      {/* Deals (linked) */}
      {contactDeals.length > 0 && (
        <Card padded={false}>
          <div className="px-5 py-4 border-soft-b">
            <CardHeader title="Deals" subtitle={`${contactDeals.length} linked`} />
          </div>
          <div className="divide-y divide-[color:var(--border)]">
            {contactDeals.map((d) => (
              <Link
                key={d.id}
                to={`/deals/${d.id}`}
                className="px-5 py-3 flex items-center gap-3 hover:surface-2 transition-colors"
              >
                <Briefcase size={14} className="text-[var(--text-faint)]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{d.stage}</Badge>
                    <span className="text-[13px] font-medium text-body truncate">{d.title}</span>
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">
                    {currency(d.value, { compact: true })}
                    {monthlyMRR(d) > 0 && <> · {currency(monthlyMRR(d))}/mo</>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Notes + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NotesSection entityType="contact" entityId={contact.id} />
        <ActivityFeed entityType="contact" entityId={contact.id} />
      </div>

      <ContactEditor
        open={editing}
        initial={contact}
        companies={data.companies}
        onClose={() => setEditing(false)}
        onSaved={() => refresh()}
      />
      <LogActivityDrawer
        open={logging}
        entityType="contact"
        entityId={contact.id}
        entityLabel={fullName}
        onClose={() => setLogging(false)}
        onSaved={() => refresh()}
      />
      <AIBdrDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        entity={{ kind: 'contact', contact }}
        data={data}
        goal="What's the single best next move with this contact? Look at their engagement history, any open deals, and recent touches. Recommend one concrete action and draft any message that's needed."
        onApplied={() => { setAiOpen(false); refresh() }}
      />
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</div>
      <div className="font-display text-[20px] font-semibold tabular text-body mt-1">{value}</div>
    </Card>
  )
}

// ============================================================
// FlagCallout — clean summary of AI flags (replaces raw tag pills)
// ============================================================

const FLAG_TYPE_LABELS: Record<string, string> = {
  'ai-flag-no-reply-email': 'Automated/no-reply email',
  'ai-flag-test-data': 'Looks like test/placeholder data',
  'ai-flag-invalid-email': 'Invalid email format',
  'ai-flag-title-is-company-name': 'Title looks like a company name (wrong column?)',
  'ai-flag-title-is-email': 'Title contains an email (wrong column?)',
  'ai-flag-title-is-phone': 'Title looks like a phone number (wrong column?)',
  'ai-flag-admin-email-with-person': 'Shared admin inbox attached to a person',
  'ai-flag-personal-email-senior-title': 'Personal email at a senior corporate title',
  'ai-flag-email-name-mismatch': 'Email contains a different person\'s name',
  'ai-flag-email-domain-typo': 'Email domain looks like a typo',
  'ai-flag-phone-too-short': 'Phone number too short',
  'ai-flag-phone-fake-pattern': 'Phone matches a fake/placeholder pattern',
  'ai-flag-duplicate-email': 'Duplicate of an earlier contact (same email)',
  'ai-flag-duplicate-name-company': 'Duplicate of an earlier contact (same name + company)',
  'ai-flag-no-name-no-title': 'No name and no title — orphan contact info',
  'ai-flag-no-contact-info': 'No email and no phone',
}

function FlagCallout({
  recommendation,
  flagTypes,
  onClear,
  onDelete,
}: {
  recommendation?: 'delete' | 'research' | 'fix' | 'keep'
  flagTypes: string[]
  onClear: () => void
  onDelete: () => void
}) {
  const isDelete = recommendation === 'delete'
  const isFix = recommendation === 'fix'
  const tone = isDelete ? 'danger' : isFix ? 'warning' : 'warning'
  const bg = isDelete
    ? 'bg-[color:rgba(239,76,76,0.06)] border-[color:rgba(239,76,76,0.25)]'
    : 'bg-[color:rgba(245,165,36,0.08)] border-[color:rgba(245,165,36,0.3)]'
  const fg = isDelete ? 'text-[var(--color-danger)]' : 'text-[var(--color-warning)]'
  const recIcon = isDelete ? <Trash2 size={13} /> : isFix ? <Settings size={13} /> : <SearchIcon size={13} />
  const recLabel = isDelete ? 'Recommend delete' : isFix ? 'Recommend fix' : 'Recommend research'

  return (
    <Card className={cn('border', bg)}>
      <div className="flex items-start gap-3">
        <div className={cn('w-8 h-8 rounded-full grid place-items-center shrink-0', fg)}>
          <AlertTriangle size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-display font-semibold text-[14px] text-body">AI flagged this contact</span>
            <Badge tone={tone === 'danger' ? 'danger' : 'warning'}>
              <span className="inline-flex items-center gap-1">
                {recIcon} {recLabel}
              </span>
            </Badge>
          </div>
          {flagTypes.length > 0 && (
            <ul className="text-[12px] text-body space-y-0.5 mt-1.5">
              {flagTypes.map((ft) => (
                <li key={ft} className="flex items-start gap-1.5">
                  <span className="text-[var(--text-faint)] mt-0.5">•</span>
                  <span>{FLAG_TYPE_LABELS[ft] || ft.replace(/^ai-flag-/, '').replace(/-/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[11px] text-muted mt-2">
            See the activity feed below for the full Quality Scan note.
          </div>
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            title="Remove the AI flag tags from this contact (keeps the contact)"
          >
            Clear flag
          </Button>
          {isDelete && (
            <Button
              size="sm"
              variant="danger"
              icon={<Trash2 size={12} />}
              onClick={onDelete}
            >
              Delete contact
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function SequenceOption({ sequence, onClick }: { sequence: Sequence; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2 text-[13px] hover:surface-2 rounded-[var(--radius-sm)] transition-colors"
    >
      <div className="flex items-center gap-2">
        <Badge tone={sequence.status === 'active' ? 'success' : 'neutral'}>{sequence.status}</Badge>
        <span className="text-body font-medium truncate">{sequence.name}</span>
      </div>
    </button>
  )
}

void cn
