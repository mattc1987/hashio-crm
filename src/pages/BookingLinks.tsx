import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, Calendar, Copy, ChevronRight, ExternalLink } from 'lucide-react'
import { useSheetData } from '../lib/sheet-context'
import { Card, Button, Input, PageHeader, Empty, Badge } from '../components/ui'
import { api } from '../lib/api'
import type { BookingLink } from '../lib/types'
import { cn } from '../lib/cn'

const TIMEZONES = [
  'America/Denver',
  'America/Los_Angeles',
  'America/Chicago',
  'America/New_York',
  'UTC',
]

export function BookingLinks() {
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [draftSlug, setDraftSlug] = useState('')
  const [draftName, setDraftName] = useState('')
  const [draftDuration, setDraftDuration] = useState(30)

  const data = 'data' in state ? state.data : undefined
  const links = data?.bookingLinks ?? []
  const bookings = data?.bookings ?? []

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    return links.filter(
      (l) => !q || l.name.toLowerCase().includes(q) || l.slug.toLowerCase().includes(q),
    )
  }, [links, query])

  const create = async () => {
    if (!draftSlug.trim() || !draftName.trim()) return
    const safeSlug = draftSlug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    const res = await api.bookingLink.create({
      slug: safeSlug,
      name: draftName.trim(),
      description: '',
      durationMinutes: draftDuration,
      workingDays: '1,2,3,4,5',
      startHour: 9,
      endHour: 17,
      timezone: TIMEZONES[0],
      bufferMinutes: 10,
      minAdvanceHours: 2,
      maxAdvanceDays: 30,
      ownerEmail: 'matt@gohashio.com',
      ownerName: 'Matt Campbell',
      status: 'active',
    })
    setDraftSlug('')
    setDraftName('')
    setCreating(false)
    // Land directly in the editor so the user can finish setting up the link.
    if (res.row?.id) navigate(`/scheduling/${res.row.id}`)
    else refresh()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Scheduling"
        subtitle={`${links.length} booking link${links.length === 1 ? '' : 's'} · ${bookings.length} total booking${bookings.length === 1 ? '' : 's'}`}
        action={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
            New booking link
          </Button>
        }
      />

      {creating && (
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto_auto_auto] gap-2 items-end">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Display name</span>
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Quick 15-min chat"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">URL slug</span>
              <Input
                value={draftSlug}
                onChange={(e) => setDraftSlug(e.target.value)}
                placeholder="matt-15min"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Duration</span>
              <select
                value={draftDuration}
                onChange={(e) => setDraftDuration(Number(e.target.value))}
                className="surface border-soft h-9 px-2 text-[13px] rounded-[var(--radius-md)]"
              >
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
              </select>
            </label>
            <Button variant="primary" onClick={create} disabled={!draftSlug.trim() || !draftName.trim()}>Create</Button>
            <Button onClick={() => { setCreating(false); setDraftSlug(''); setDraftName('') }}>Cancel</Button>
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-3 border-soft-b">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <Input
              placeholder="Search booking links…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <Empty
            icon={<Calendar size={22} />}
            title={links.length === 0 ? 'No booking links yet' : 'No matches'}
            description={
              links.length === 0
                ? 'Create your first booking link — share a public URL where contacts pick a time. We handle the calendar invite + Google event automatically.'
                : `No links match "${query}".`
            }
            action={
              links.length === 0 ? (
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  New booking link
                </Button>
              ) : null
            }
          />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {filtered.map((link) => (
              <BookingLinkRow
                key={link.id}
                link={link}
                bookingCount={bookings.filter((b) => b.bookingLinkId === link.id).length}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function BookingLinkRow({ link, bookingCount }: { link: BookingLink; bookingCount: number }) {
  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}book/${link.slug}`
  const copyLink = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard?.writeText(publicUrl)
  }

  return (
    <Link
      to={`/scheduling/${link.id}`}
      className="flex items-center gap-4 px-4 py-3 hover:surface-2 transition-colors group"
    >
      <div className="w-10 h-10 rounded-[var(--radius-md)] grid place-items-center bg-[color:rgba(122,94,255,0.1)] text-[var(--color-brand-700)] dark:text-[var(--color-brand-300)]">
        <Calendar size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-medium text-body truncate">{link.name}</div>
          <Badge tone={link.status === 'active' ? 'success' : 'neutral'}>{link.status}</Badge>
        </div>
        <div className="text-[11px] text-muted mt-0.5 truncate flex items-center gap-1.5">
          <code className="text-[var(--text-faint)]">/book/{link.slug}</code>
          <span>·</span>
          <span>{link.durationMinutes} min</span>
          <span>·</span>
          <span>{link.timezone}</span>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-3 text-[11px] text-muted">
        <button
          onClick={copyLink}
          className="inline-flex items-center gap-1 hover:text-body"
          title="Copy public booking URL"
        >
          <Copy size={11} />
          Copy
        </button>
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 hover:text-body"
          title="Open public page"
        >
          <ExternalLink size={11} />
          Preview
        </a>
      </div>
      <div className="text-right shrink-0 w-20">
        <div className="font-display text-[13px] font-semibold tabular text-body">{bookingCount}</div>
        <div className="text-[10px] text-muted uppercase tracking-wider">bookings</div>
      </div>
      <ChevronRight size={15} className={cn('text-[var(--text-faint)] group-hover:text-body transition-colors')} />
    </Link>
  )
}
