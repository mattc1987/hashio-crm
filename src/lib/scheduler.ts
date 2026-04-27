// Public-side scheduler API. The /book/:slug page calls these without
// being authenticated against the CRM. The Apps Script allows
// getAvailability + createBooking without the API key.

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''

export interface AvailabilityResponse {
  slug: string
  name: string
  description: string
  durationMinutes: number
  timezone: string
  ownerName: string
  /** ISO datetimes of available slot starts. */
  slots: string[]
}

export interface BookingResponse {
  id: string
  eventId: string
  slotStart: string
  slotEnd: string
  status: 'confirmed'
}

async function publicCall<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  if (!APPS_SCRIPT_URL) throw new Error('Backend not configured')
  const url = new URL(APPS_SCRIPT_URL)
  url.searchParams.set('action', action)
  url.searchParams.set('payload', JSON.stringify(payload))
  const res = await fetch(url.toString(), { method: 'GET', redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  // The Apps Script sometimes returns `ok: true` alongside an `error` string
  // (when the action is recognized but the underlying call threw). Treat any
  // present `error` as a failure.
  if (!json.ok || json.error) throw new Error(json.error || 'Request failed')
  return json.data as T
}

export function fetchAvailability(slug: string, fromDate: string, toDate: string) {
  return publicCall<AvailabilityResponse>('getAvailability', { slug, fromDate, toDate })
}

export function createBooking(input: {
  slug: string
  slotStart: string
  attendeeName: string
  attendeeEmail: string
  attendeeNotes?: string
}) {
  return publicCall<BookingResponse>('createBooking', input)
}
