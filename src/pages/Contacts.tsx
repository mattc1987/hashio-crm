import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Mail, Phone, Users, ChevronRight, MapPin, Link2 } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Avatar, Badge } from '../components/ui'
import { ContactEditor } from '../components/editors/ContactEditor'
import type { Contact, Company } from '../lib/types'
import { cn } from '../lib/cn'

export function Contacts() {
  const { state, refresh } = useSheetData()
  const [query, setQuery] = useState('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [editing, setEditing] = useState<Contact | null>(null)
  const [creating, setCreating] = useState(false)

  const data = 'data' in state ? state.data : undefined
  const contacts = data?.contacts ?? []
  const companies = data?.companies ?? []

  const companyById = (id: string) => companies.find((c) => c.id === id)

  // All unique tags across all contacts, for the filter bar.
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const c of contacts) {
      parseTags(c.tags).forEach((t) => set.add(t))
    }
    return Array.from(set).sort()
  }, [contacts])

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return contacts
      .filter((c) => {
        if (tagFilter && !parseTags(c.tags).includes(tagFilter)) return false
        if (!q) return true
        const name = companyById(c.companyId)?.name || ''
        return (
          c.firstName.toLowerCase().includes(q) ||
          c.lastName.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          c.state.toLowerCase().includes(q) ||
          c.tags.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const an = `${a.lastName}${a.firstName}`.toLowerCase()
        const bn = `${b.lastName}${b.firstName}`.toLowerCase()
        return an.localeCompare(bn)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, query, tagFilter, companies])

  if (!data) return <PageHeader title="Contacts" />

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
        <div className="p-3 border-soft-b flex flex-col gap-2">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              placeholder="Search by name, email, company, state, tag…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {allTags.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              <button
                onClick={() => setTagFilter('')}
                className={cn(
                  'h-7 px-2.5 text-[11px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap',
                  !tagFilter ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
                )}
              >
                All
              </button>
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTagFilter(tagFilter === t ? '' : t)}
                  className={cn(
                    'h-7 px-2.5 text-[11px] font-medium rounded-[var(--radius-sm)] transition-colors whitespace-nowrap',
                    tagFilter === t ? 'bg-[var(--color-brand-600)] text-white' : 'surface-2 text-muted hover:text-body',
                  )}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Users size={22} />}
            title="No contacts"
            description={query ? `No matches for "${query}".` : 'Add your first contact.'}
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                company={companyById(c.companyId)}
                onClick={() => setEditing(c)}
              />
            ))}
          </div>
        )}
      </Card>

      <ContactEditor
        open={creating || !!editing}
        initial={editing}
        companies={companies}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={() => { refresh() }}
      />
    </div>
  )
}

function ContactRow({ contact, company, onClick }: { contact: Contact; company?: Company; onClick: () => void }) {
  const tags = parseTags(contact.tags)
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-4 px-4 py-3 hover:surface-2 transition-colors group w-full text-left"
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
    </button>
  )
}

export function parseTags(raw: string): string[] {
  if (!raw) return []
  return raw.split(/[,|]+/).map((t) => t.trim()).filter(Boolean)
}
