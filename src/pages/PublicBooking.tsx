// Public booking page at /book/:slug. No CRM auth required.
// Anyone with the URL can see availability and book a slot on the
// owner's Google Calendar via Apps Script.

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Calendar, Clock, ChevronLeft, ChevronRight, Check, AlertCircle } from 'lucide-react'
import { fetchAvailability, createBooking, type AvailabilityResponse, type BookingResponse } from '../lib/scheduler'
import { cn } from '../lib/cn'

export function PublicBooking() {
  const { slug } = useParams<{ slug: string }>()
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null)
  const [bookingForm, setBookingForm] = useState({ name: '', email: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [confirmation, setConfirmation] = useState<BookingResponse | null>(null)

  // Default range: today through 30 days
  const fromDate = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const toDate = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  }, [])

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    fetchAvailability(slug, fromDate, toDate)
      .then((data) => setAvailability(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug, fromDate, toDate])

  const slotsByDay = useMemo(() => {
    const map = new Map<string, string[]>()
    if (availability) {
      for (const iso of availability.slots) {
        const day = iso.slice(0, 10) // YYYY-MM-DD in UTC; for display we'll format with tz
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(iso)
      }
    }
    return map
  }, [availability])

  const days = useMemo(() => {
    const out: string[] = []
    const start = new Date(fromDate + 'T00:00:00Z')
    for (let i = 0; i < 30; i++) {
      const d = new Date(start.getTime() + i * 86400000)
      out.push(d.toISOString().slice(0, 10))
    }
    return out
  }, [fromDate])

  const [pageStart, setPageStart] = useState(0)
  const visibleDays = days.slice(pageStart, pageStart + 14)

  const submit = async () => {
    if (!selectedSlot || !slug) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await createBooking({
        slug,
        slotStart: selectedSlot,
        attendeeName: bookingForm.name,
        attendeeEmail: bookingForm.email,
        attendeeNotes: bookingForm.notes,
      })
      setConfirmation(res)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmation) {
    return <Confirmed confirmation={confirmation} availability={availability} />
  }

  return (
    <div className="min-h-screen bg-app text-body py-8 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 surface-2 rounded-full px-4 py-1.5 mb-4 text-[12px] font-medium text-muted">
            <Calendar size={13} className="text-[var(--color-brand-600)]" />
            Book a meeting
          </div>
          <h1 className="font-display text-[28px] font-semibold tracking-tight">
            {availability?.name || (loading ? 'Loading…' : 'Booking link')}
          </h1>
          {availability?.ownerName && (
            <p className="text-[13px] text-muted mt-1">with {availability.ownerName}</p>
          )}
          {availability?.description && (
            <p className="text-[14px] text-body mt-3 max-w-xl mx-auto leading-relaxed">{availability.description}</p>
          )}
          {availability && (
            <div className="text-[12px] text-muted mt-3 flex items-center justify-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <Clock size={12} />
                {availability.durationMinutes} min
              </span>
              <span>·</span>
              <span>{availability.timezone}</span>
            </div>
          )}
        </header>

        {/* Errors */}
        {error && !confirmation && (
          <div className="mb-4 flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[color:rgba(239,76,76,0.08)] text-[var(--color-danger)]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div className="text-[13px]">{error}</div>
          </div>
        )}

        {/* Picker + form */}
        {availability && availability.slots.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
            <DayPicker
              days={visibleDays}
              slotsByDay={slotsByDay}
              tz={availability.timezone}
              selected={selectedSlot}
              onSelect={setSelectedSlot}
              onPrev={pageStart > 0 ? () => setPageStart(Math.max(0, pageStart - 7)) : undefined}
              onNext={() => setPageStart(pageStart + 7)}
            />

            <BookingForm
              selectedSlot={selectedSlot}
              tz={availability.timezone}
              durationMinutes={availability.durationMinutes}
              form={bookingForm}
              setForm={setBookingForm}
              onSubmit={submit}
              submitting={submitting}
            />
          </div>
        )}

        {availability && availability.slots.length === 0 && !loading && (
          <div className="surface border-soft rounded-[var(--radius-lg)] p-8 text-center">
            <Calendar size={32} className="mx-auto mb-3 text-[var(--text-faint)]" />
            <div className="text-[14px] font-medium">No times available in the next 30 days</div>
            <div className="text-[13px] text-muted mt-1">Try again soon, or reach out directly.</div>
          </div>
        )}

        {loading && !availability && (
          <div className="text-center py-12 text-muted text-[13px]">Loading availability…</div>
        )}
      </div>
    </div>
  )
}

function DayPicker({
  days,
  slotsByDay,
  tz,
  selected,
  onSelect,
  onPrev,
  onNext,
}: {
  days: string[]
  slotsByDay: Map<string, string[]>
  tz: string
  selected: string | null
  onSelect: (iso: string) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const [activeDay, setActiveDay] = useState<string | null>(null)

  // Pick the first day with slots as default
  useEffect(() => {
    if (activeDay) return
    for (const d of days) {
      if ((slotsByDay.get(d) || []).length > 0) {
        setActiveDay(d)
        break
      }
    }
  }, [days, slotsByDay, activeDay])

  const slotsToday = activeDay ? slotsByDay.get(activeDay) || [] : []

  return (
    <div className="surface border-soft rounded-[var(--radius-lg)] p-5">
      {/* Date strip */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onPrev}
          disabled={!onPrev}
          className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2 disabled:opacity-30"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="flex-1 grid grid-cols-7 gap-1.5">
          {days.map((d) => {
            const count = slotsByDay.get(d)?.length || 0
            const date = new Date(d + 'T12:00:00Z')
            const isActive = activeDay === d
            return (
              <button
                key={d}
                disabled={count === 0}
                onClick={() => setActiveDay(d)}
                className={cn(
                  'flex flex-col items-center justify-center py-2 rounded-[var(--radius-md)] text-[12px] transition-colors',
                  isActive ? 'bg-[var(--color-brand-600)] text-white' :
                  count === 0 ? 'text-[var(--text-faint)] cursor-not-allowed' :
                  'surface-2 text-muted hover:text-body',
                )}
              >
                <span className="text-[10px] font-medium uppercase tracking-wider opacity-80">
                  {date.toLocaleDateString('en-US', { weekday: 'short', timeZone: tz })}
                </span>
                <span className="font-display text-[15px] font-semibold mt-0.5">
                  {date.toLocaleDateString('en-US', { day: 'numeric', timeZone: tz })}
                </span>
                {count > 0 && (
                  <span className={cn('text-[9px] mt-0.5', isActive ? 'text-white/70' : 'text-[var(--text-faint)]')}>
                    {count} slot{count === 1 ? '' : 's'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <button
          onClick={onNext}
          className="w-8 h-8 grid place-items-center rounded-[var(--radius-sm)] text-muted hover:text-body hover:surface-2"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Slot grid */}
      {activeDay && slotsToday.length > 0 ? (
        <>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] mb-3">
            {new Date(activeDay + 'T12:00:00Z').toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric', timeZone: tz,
            })}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {slotsToday.map((iso) => {
              const isSelected = selected === iso
              const slotDate = new Date(iso)
              return (
                <button
                  key={iso}
                  onClick={() => onSelect(iso)}
                  className={cn(
                    'h-10 px-3 text-[13px] font-medium rounded-[var(--radius-md)] transition-colors tabular',
                    isSelected
                      ? 'bg-[var(--color-brand-600)] text-white'
                      : 'surface-2 text-body hover:bg-[var(--color-brand-100)] hover:text-[var(--color-brand-800)]',
                  )}
                >
                  {slotDate.toLocaleTimeString('en-US', {
                    hour: 'numeric', minute: '2-digit', timeZone: tz,
                  })}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-muted text-[13px]">
          {activeDay ? 'No slots this day — pick another' : 'Select a day above'}
        </div>
      )}
    </div>
  )
}

function BookingForm({
  selectedSlot,
  tz,
  durationMinutes,
  form,
  setForm,
  onSubmit,
  submitting,
}: {
  selectedSlot: string | null
  tz: string
  durationMinutes: number
  form: { name: string; email: string; notes: string }
  setForm: (f: { name: string; email: string; notes: string }) => void
  onSubmit: () => void
  submitting: boolean
}) {
  if (!selectedSlot) {
    return (
      <div className="surface border-soft rounded-[var(--radius-lg)] p-8 flex flex-col items-center justify-center text-center text-muted">
        <Clock size={28} className="mb-3 text-[var(--text-faint)]" />
        <div className="text-[13px]">Pick a time to continue</div>
      </div>
    )
  }

  const slot = new Date(selectedSlot)
  const slotEnd = new Date(slot.getTime() + durationMinutes * 60000)

  const canSubmit = form.name.trim() && form.email.trim() && /@/.test(form.email)

  return (
    <div className="surface border-soft rounded-[var(--radius-lg)] p-5">
      <div className="surface-2 rounded-[var(--radius-md)] p-3 mb-4">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Selected time</div>
        <div className="font-display text-[15px] font-semibold mt-1 tabular">
          {slot.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })}
        </div>
        <div className="text-[12px] text-muted tabular">
          {slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
          {' – '}
          {slotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
          {' '}
          ({tz})
        </div>
      </div>

      <div className="flex flex-col gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Your name *</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="surface-2 border-soft rounded-[var(--radius-md)] h-10 px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Jane Doe"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Email *</span>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="surface-2 border-soft rounded-[var(--radius-md)] h-10 px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="jane@acme.com"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Anything we should know?</span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="surface-2 border-soft rounded-[var(--radius-md)] px-3 py-2 text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder="Optional"
          />
        </label>
      </div>

      <button
        onClick={onSubmit}
        disabled={!canSubmit || submitting}
        className="w-full h-11 rounded-[var(--radius-md)] bg-[var(--color-brand-600)] text-white text-[14px] font-medium hover:bg-[var(--color-brand-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Booking…' : 'Confirm booking'}
      </button>
    </div>
  )
}

function Confirmed({ confirmation, availability }: { confirmation: BookingResponse; availability: AvailabilityResponse | null }) {
  const tz = availability?.timezone || 'UTC'
  const slot = new Date(confirmation.slotStart)
  const slotEnd = new Date(confirmation.slotEnd)
  return (
    <div className="min-h-screen bg-app text-body py-8 px-4 sm:px-6 grid place-items-center">
      <div className="max-w-md w-full surface border-soft rounded-[var(--radius-lg)] shadow-soft-md p-8 text-center">
        <div
          className="w-14 h-14 rounded-full mx-auto mb-4 grid place-items-center text-white"
          style={{ background: 'linear-gradient(135deg, var(--color-success), #2a9b5e)' }}
        >
          <Check size={28} strokeWidth={2.5} />
        </div>
        <h1 className="font-display text-[22px] font-semibold tracking-tight">You're booked</h1>
        <p className="text-[13px] text-muted mt-1">
          A calendar invite is on its way. {availability?.ownerName || 'The host'} will see this in their inbox too.
        </p>
        <div className="surface-2 rounded-[var(--radius-md)] p-4 mt-5 text-left">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">When</div>
          <div className="font-display text-[15px] font-semibold mt-1 tabular">
            {slot.toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: tz })}
          </div>
          <div className="text-[12px] text-muted tabular">
            {slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
            {' – '}
            {slotEnd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })}
            {' '}
            ({tz})
          </div>
        </div>
      </div>
    </div>
  )
}
