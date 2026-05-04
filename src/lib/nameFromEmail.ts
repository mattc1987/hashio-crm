// Heuristic name extractor — pull "First Last" out of an email address
// when the contact's firstName / lastName are missing. Common patterns:
//
//   john.smith@acme.com         → first=John, last=Smith
//   john_smith@acme.com         → first=John, last=Smith
//   john-smith@acme.com         → first=John, last=Smith
//   john.m.smith@acme.com       → first=John, last=Smith (drop middle initial)
//   jsmith@acme.com             → first=J, last=Smith    (low-confidence)
//   john@acme.com               → first=John (no last, low-confidence)
//   smith.j@acme.com            → first=J, last=Smith    (low-confidence)
//
// Output:
//   { firstName, lastName, confidence: 0-100 }
//   confidence ≥ 80 = clean dotted/underscored "first.last" pattern
//   confidence 50-79 = single-token / inferred / lower-quality
//   confidence < 50 = not enough signal — leave the contact untouched

export interface NameFromEmail {
  firstName: string
  lastName: string
  confidence: number  // 0-100
  source: string      // diagnostic — which heuristic matched
}

const STOP_LOCALPARTS = new Set([
  'info', 'support', 'help', 'admin', 'sales', 'contact',
  'team', 'office', 'hr', 'careers', 'jobs', 'press', 'media',
  'hello', 'hi', 'enquiries', 'inquiries', 'noreply', 'no-reply',
  'orders', 'billing', 'accounts', 'accounting', 'finance',
  'legal', 'compliance', 'security', 'webmaster', 'postmaster',
  'service', 'services', 'business', 'biz', 'general', 'main',
])

const TITLE_TOKENS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'jr', 'sr', 'ii', 'iii', 'iv',
])

function titleCase(s: string): string {
  if (!s) return ''
  // Hyphenated last names (e.g. smith-jones) → Smith-Jones
  return s
    .split(/(['-])/)
    .map((part) => /^['-]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('')
}

export function nameFromEmail(email: string): NameFromEmail {
  const empty: NameFromEmail = { firstName: '', lastName: '', confidence: 0, source: 'no-match' }
  if (!email) return empty
  const trimmed = email.trim().toLowerCase()
  const at = trimmed.indexOf('@')
  if (at <= 0) return empty
  const local = trimmed.slice(0, at)

  // Reject role-based addresses outright — they shouldn't get a synthetic name
  if (STOP_LOCALPARTS.has(local)) return { ...empty, source: 'stop-localpart' }

  // Drop suffixes like "+work" / "+newsletter"
  const cleaned = local.split('+')[0]

  // ---- Pattern 1: dotted/underscored/hyphenated multi-token ----
  if (/[._-]/.test(cleaned)) {
    const tokens = cleaned.split(/[._-]+/).filter((t) => t.length > 0 && !TITLE_TOKENS.has(t))
    // Drop trailing pure-numeric tokens (john.smith2 → john.smith)
    while (tokens.length && /^\d+$/.test(tokens[tokens.length - 1])) tokens.pop()
    // Drop middle-initial single letters
    const meaningful = tokens.filter((t, i, arr) => !(t.length === 1 && i > 0 && i < arr.length - 1))

    if (meaningful.length >= 2) {
      // first = first token, last = last token (handles "john.michael.smith" → John Smith)
      const first = meaningful[0]
      const last = meaningful[meaningful.length - 1]
      // Require both to be at least 2 chars (avoid "j.smith" → "J Smith")
      const isStrong = first.length >= 2 && last.length >= 2
      return {
        firstName: titleCase(first),
        lastName: titleCase(last),
        confidence: isStrong ? 90 : 60,
        source: 'multi-token',
      }
    }
    if (meaningful.length === 1) {
      return {
        firstName: titleCase(meaningful[0]),
        lastName: '',
        confidence: 45,
        source: 'single-token-after-split',
      }
    }
  }

  // ---- Pattern 2: single token, no separator ----
  // Only safe when it looks like a real first name (not "jsmith" or "smith2")
  // and short enough to NOT be a concatenated full name we'd rather skip.
  if (/^[a-z]+$/.test(cleaned) && cleaned.length >= 3 && cleaned.length <= 12) {
    return {
      firstName: titleCase(cleaned),
      lastName: '',
      confidence: 40,
      source: 'single-token',
    }
  }

  // ---- Pattern 3: "jsmith" / "msmith" / "tjones" — single initial + last name ----
  // Conservative: only match when 1 letter + 4+ alpha letters, no digits.
  const initialMatch = cleaned.match(/^([a-z])([a-z]{4,})$/)
  if (initialMatch) {
    return {
      firstName: titleCase(initialMatch[1]),
      lastName: titleCase(initialMatch[2]),
      confidence: 50,
      source: 'initial-plus-last',
    }
  }

  return empty
}

/** Apply name extraction to many contacts at once. Returns only the contacts
 *  where extraction succeeded above the confidence threshold. */
export function backfillNamesBulk(
  contacts: Array<{ id: string; email: string; firstName: string; lastName: string }>,
  minConfidence = 60,
): Array<{ id: string; firstName: string; lastName: string; source: string; confidence: number }> {
  const out: Array<{ id: string; firstName: string; lastName: string; source: string; confidence: number }> = []
  for (const c of contacts) {
    if (c.firstName && c.lastName) continue // both present, skip
    if (!c.email) continue
    const n = nameFromEmail(c.email)
    if (n.confidence < minConfidence) continue
    // Don't overwrite a name that was partially set; only fill the empty side(s).
    const next = {
      id: c.id,
      firstName: c.firstName || n.firstName,
      lastName: c.lastName || n.lastName,
      source: n.source,
      confidence: n.confidence,
    }
    if (next.firstName === c.firstName && next.lastName === c.lastName) continue
    out.push(next)
  }
  return out
}
