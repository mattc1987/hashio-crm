// Phone number utilities. Click-to-call/text URLs (tel: / sms:) are picky
// about format — they want digits only OR E.164 with a leading +.
//
// What we accept:  "(555) 123-4567", "+1 555.123.4567", "5551234567",
//                  "1-555-123-4567", "+44 20 1234 5678" — anything.
// What we output:  "+15551234567" (E.164) for use in tel: / sms: URLs.
//
// US-default assumption: 10-digit numbers with no country code get +1.
// 11-digit numbers starting with 1 get + prepended.
// Anything that already starts with + is trusted.

/** Normalize to E.164 format suitable for tel: / sms: URL schemes.
 *  Returns empty string if the input doesn't have enough digits to be valid. */
export function toE164(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''

  // Already starts with + → trust the country code, just strip non-digits after
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '')
    return digits.length >= 7 ? '+' + digits : ''
  }

  // Strip everything non-digit
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 0) return ''

  // 10 digits → US/Canada → +1 prefix
  if (digits.length === 10) return '+1' + digits

  // 11 digits starting with 1 → US/Canada with country code → just add +
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits

  // 7 digits is too short for E.164 but technically valid for local dialing.
  // Return digits-only — tel: handles it on iPhone (uses your default country).
  if (digits.length === 7) return digits

  // Anything 8-15 digits without a leading + → trust as-is, prepend +
  // (catches international numbers entered without country code prefix)
  if (digits.length >= 8 && digits.length <= 15) return '+' + digits

  return ''
}

/** Format E.164 → human-readable. Used for display next to the icon. */
export function formatPhoneDisplay(raw: string): string {
  const e164 = toE164(raw)
  if (!e164) return raw
  if (e164.startsWith('+1') && e164.length === 12) {
    // US: +1 (555) 123-4567
    const d = e164.slice(2)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  }
  return e164
}

/** Build a tel: URL. Returns empty string if phone can't be normalized. */
export function telUrl(phone: string): string {
  const e164 = toE164(phone)
  return e164 ? `tel:${e164}` : ''
}

/** Build an sms: URL with optional pre-filled body. Returns empty if invalid.
 *
 *  Notes on the URL scheme — there's no perfect cross-platform format:
 *  - iOS 14+ Messages: `sms:+15551234567&body=Hello`  ← uses & as the
 *    separator, NOT ?  (this is iOS-specific; weird but real)
 *  - Android: `sms:+15551234567?body=Hello`  ← uses ? like a normal query
 *  - macOS Messages (Continuity): both work
 *
 *  We use the Apple form (`&`) since Matt is on Apple devices. If we
 *  later want cross-platform, sniff the user agent. */
export function smsUrl(phone: string, body?: string): string {
  const e164 = toE164(phone)
  if (!e164) return ''
  if (!body) return `sms:${e164}`
  // iOS expects `&body=` — encode the body
  return `sms:${e164}&body=${encodeURIComponent(body)}`
}
