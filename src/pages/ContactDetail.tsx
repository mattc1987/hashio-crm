import { useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Mail, Phone, MapPin, Building2, Link2, Pencil,
  Briefcase, Zap, Sparkles,
} from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Avatar, Badge, PageHeader, Empty, Button } from '../components/ui'
import { ActivityFeed } from '../components/ActivityFeed'
import { NotesSection } from '../components/NotesSection'
import { ContactEditor } from '../components/editors/ContactEditor'
import { LogActivityDrawer } from '../components/editors/LogActivityDrawer'
import { AIBdrDrawer } from '../components/AIBdrDrawer'
import { api, hasWriteBackend } from '../lib/api'
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
  const tags = parseTags(contact.tags)
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
          {hasWriteBackend() && (
            <Button
              variant="primary"
              icon={<Sparkles size={13} />}
              onClick={() => setAiOpen(true)}
            >
              AI BDR
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
