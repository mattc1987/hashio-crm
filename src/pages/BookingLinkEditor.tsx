import { useMemo } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Calendar, Copy, ExternalLink, Trash2, Power, PowerOff, Check,
} from 'lucide-react'
import { useState as useLocalState } from 'react'
import { useSheetData } from '../lib/sheet-context'
import { Card, CardHeader, Button, Input, Textarea, Select, PageHeader, Empty, Badge, Avatar } from '../components/ui'
import { SavedIndicator } from '../components/SavedIndicator'
import { api } from '../lib/api'
import { date, relativeDate } from '../lib/format'
import type { BookingLink } from '../lib/types'
import { cn } from '../lib/cn'

const TIMEZONES = [
  'America/Denver', 'America/Los_Angeles', 'America/Chicago', 'America/New_York',
  'America/Phoenix', 'Pacific/Honolulu', 'America/Anchorage',
  'UTC', 'Europe/London', 'Europe/Berlin',
]

const DAY_LABELS = [
  { v: 0, l: 'S' },
  { v: 1, l: 'M' },
  { v: 2, l: 'T' },
  { v: 3, l: 'W' },
  { v: 4, l: 'T' },
  { v: 5, l: 'F' },
  { v: 6, l: 'S' },
]

export function BookingLinkEditor() {
  const { id } = useParams<{ id: string }>()
  const { state, refresh } = useSheetData()
  const navigate = useNavigate()
  const [saved, setSaved] = useLocalState(false)

  const data = 'data' in state ? state.data : undefined
  const link = data?.bookingLinks.find((b) => b.id === id)
  const bookings = useMemo(
    () => (data?.bookings ?? []).filter((b) => b.bookingLinkId === id),
    [data, id],
  )

  if (!data) return <PageHeader title="Booking link" />
  if (!link) {
    return (
      <div>
        <Link to="/scheduling" className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={12} /> All booking links
        </Link>
        <Empty icon={<Calendar size={22} />} title="Booking link not found" />
      </div>
    )
  }

  const publicUrl = `${window.location.origin}${import.meta.env.BASE_URL}book/${link.slug}`
  const set = <K extends keyof BookingLink>(k: K, v: BookingLink[K]) =>
    api.bookingLink.update({ id: link.id, [k]: v })

  const toggleDay = (d: number) => {
    const days = (link.workingDays || '').split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n))
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort()
    set('workingDays', next.join(','))
  }
  const activeDays = (link.workingDays || '').split(',').map((s) => parseInt(s, 10))

  const remove = async () => {
    if (!confirm(`Delete "${link.name}"? Existing bookings stay logged.`)) return
    await api.bookingLink.remove(link.id)
    navigate('/scheduling')
  }

  const saveAndConfirm = async () => {
    // Edits already auto-save through the local cache + backend, but this
    // gives a visible "your changes are stored" gesture. We force a refresh
    // to re-pull from the Sheet so the user can confirm the round-trip.
    await refresh()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/scheduling"
        className="text-[12px] text-muted hover:text-body inline-flex items-center gap-1 -mb-2 w-fit"
      >
        <ArrowLeft size={12} /> All booking links
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge tone={link.status === 'active' ? 'success' : 'neutral'}>{link.status}</Badge>
            <SavedIndicator value={JSON.stringify(link)} />
          </div>
          <input
            value={link.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Quick 15-min chat"
            className="bg-transparent border-none outline-none font-display text-[22px] font-semibold text-body w-full"
          />
          <p className="text-[12px] text-muted mt-1">
            Edits save automatically — no Save button needed.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="primary"
            icon={saved ? <Check size={14} /> : undefined}
            onClick={saveAndConfirm}
          >
            {saved ? 'Saved' : 'Save changes'}
          </Button>
          {link.status === 'active' ? (
            <Button icon={<PowerOff size={13} />} onClick={() => set('status', 'disabled')}>Disable</Button>
          ) : (
            <Button variant="primary" icon={<Power size={13} />} onClick={() => set('status', 'active')}>Enable</Button>
          )}
          <Button variant="danger" icon={<Trash2 size={13} />} onClick={remove}>Delete</Button>
        </div>
      </div>

      {/* ---------- Public URL card ---------- */}
      <Card>
        <CardHeader
          title="Public booking URL"
          subtitle="Anyone with this link can pick a time on your calendar."
        />
        <div className="flex items-center gap-2">
          <code className="flex-1 surface-2 border-soft rounded-[var(--radius-md)] px-3 py-2 text-[12px] font-mono truncate">
            {publicUrl}
          </code>
          <Button
            icon={<Copy size={13} />}
            onClick={() => navigator.clipboard?.writeText(publicUrl)}
          >
            Copy
          </Button>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="surface border-soft rounded-[var(--radius-md)] h-9 px-4 text-[13px] font-medium text-body hover:surface-2 inline-flex items-center gap-2"
          >
            <ExternalLink size={13} />
            Open
          </a>
        </div>
      </Card>

      {/* ---------- Settings ---------- */}
      <Card>
        <CardHeader title="Settings" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="URL slug" hint="What appears after /book/">
            <Input
              value={link.slug}
              onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))}
            />
          </Field>
          <Field label="Duration">
            <Select
              value={link.durationMinutes}
              onChange={(e) => set('durationMinutes', Number(e.target.value))}
            >
              {[15, 20, 30, 45, 60, 90].map((n) => (
                <option key={n} value={n}>{n} min</option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Description" hint="Shown on the public booking page.">
          <Textarea
            value={link.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Quick chat to walk through Hashio for your cultivation business. Bring a few questions."
            rows={3}
          />
        </Field>

        <Field label="Working days">
          <div className="flex items-center gap-1.5">
            {DAY_LABELS.map((d) => {
              const on = activeDays.includes(d.v)
              return (
                <button
                  key={d.v}
                  type="button"
                  onClick={() => toggleDay(d.v)}
                  className={cn(
                    'w-9 h-9 rounded-full text-[12px] font-semibold transition-colors',
                    on
                      ? 'bg-[var(--color-brand-600)] text-white'
                      : 'surface-2 text-muted hover:text-body',
                  )}
                  title={['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.v]}
                >
                  {d.l}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Day starts at">
            <Select
              value={link.startHour}
              onChange={(e) => set('startHour', Number(e.target.value))}
            >
              {hourOptions(0, 23).map((h) => (
                <option key={h.value} value={h.value}>{h.label}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Day ends at"
            hint={
              link.endHour <= link.startHour
                ? '⚠️ End time must be AFTER start time'
                : undefined
            }
          >
            <Select
              value={link.endHour}
              onChange={(e) => set('endHour', Number(e.target.value))}
            >
              {hourOptions(1, 24).map((h) => (
                <option key={h.value} value={h.value} disabled={h.value <= link.startHour}>
                  {h.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone">
            <Select value={link.timezone} onChange={(e) => set('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Buffer between meetings (min)">
            <Input
              type="number"
              min={0}
              value={link.bufferMinutes}
              onChange={(e) => set('bufferMinutes', Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Min advance notice (hours)" hint="Closest someone can book.">
            <Input
              type="number"
              min={0}
              value={link.minAdvanceHours}
              onChange={(e) => set('minAdvanceHours', Math.max(0, Number(e.target.value) || 0))}
            />
          </Field>
          <Field label="Max advance (days)" hint="Furthest someone can book.">
            <Input
              type="number"
              min={1}
              value={link.maxAdvanceDays}
              onChange={(e) => set('maxAdvanceDays', Math.max(1, Number(e.target.value) || 30))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Owner display name" hint="Shown on the public page.">
            <Input value={link.ownerName} onChange={(e) => set('ownerName', e.target.value)} />
          </Field>
          <Field label="Owner email" hint="Whose calendar to read & write to.">
            <Input value={link.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} />
          </Field>
        </div>
      </Card>

      {/* ---------- Bookings list ---------- */}
      <Card padded={false}>
        <div className="px-5 py-4 border-soft-b">
          <CardHeader
            title="Bookings"
            subtitle={`${bookings.length} confirmed`}
          />
        </div>
        {bookings.length === 0 ? (
          <Empty title="No bookings yet" description="Once someone uses your public URL, their meetings show up here." />
        ) : (
          <div className="divide-y divide-[color:var(--border)]">
            {bookings
              .slice()
              .sort((a, b) => (b.slotStart || '').localeCompare(a.slotStart || ''))
              .map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={b.attendeeName || b.attendeeEmail} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-body truncate">{b.attendeeName || '(no name)'}</div>
                    <div className="text-[11px] text-muted truncate">{b.attendeeEmail}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[13px] font-medium tabular text-body">{date(b.slotStart, "EEE MMM d 'at' h:mm a")}</div>
                    <div className="text-[11px] text-muted">{relativeDate(b.slotStart)}</div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const isWarning = hint?.startsWith('⚠️')
  return (
    <label className="flex flex-col gap-1.5 mb-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{label}</span>
      {children}
      {hint && (
        <span className={cn('text-[11px]', isWarning ? 'text-[var(--color-warning)] font-medium' : 'text-muted')}>
          {hint}
        </span>
      )}
    </label>
  )
}

function hourOptions(min: number, max: number): Array<{ value: number; label: string }> {
  const out: Array<{ value: number; label: string }> = []
  for (let h = min; h <= max; h++) {
    let label: string
    if (h === 0)       label = '12 am (midnight)'
    else if (h === 12) label = '12 pm (noon)'
    else if (h === 24) label = '12 am (next day)'
    else if (h < 12)   label = `${h} am`
    else               label = `${h - 12} pm`
    out.push({ value: h, label: `${label}  ·  ${h}:00` })
  }
  return out
}
