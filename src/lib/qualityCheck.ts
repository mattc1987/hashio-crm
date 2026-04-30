// Contact quality check — runs locally on the full contact list and flags
// records that look problematic. No AI calls (instant + free + scales to
// 100K contacts). Used to seed the AI flag tags so saved views work
// immediately without a Claude round-trip per contact.
//
// AI enrichment is still available as a deeper second pass for ambiguous
// cases — but we shouldn't pay Claude to confirm that info@ + CEO is a
// shared inbox. That's obvious.

import type { Contact } from './types'

// ============================================================
// Types
// ============================================================

export type FlagSeverity = 'high' | 'medium' | 'low'
export type FlagRecommendation = 'delete' | 'research' | 'fix' | 'keep'

export interface QualityFlag {
  type: string                      // machine-readable, e.g. 'admin-email-with-person-title'
  severity: FlagSeverity
  recommendation: FlagRecommendation
  reason: string                    // human-readable
}

export interface ContactFlags {
  contactId: string
  flags: QualityFlag[]
  /** Roll-up: highest severity across all flags. */
  topSeverity: FlagSeverity | null
  /** Roll-up: most-actionable recommendation. */
  topRecommendation: FlagRecommendation | null
}

// ============================================================
// Detection — pure functions, fast (regex + Set lookups)
// ============================================================

// Generic admin/role-based email prefixes — these are SHARED INBOXES,
// not real people. Adding a person's name + executive title to one of
// these is a data error.
const ADMIN_EMAIL_PREFIXES = new Set([
  'info', 'contact', 'contacts', 'hello', 'hi', 'help', 'support',
  'sales', 'admin', 'office', 'team', 'inquiries', 'inquiry',
  'general', 'main', 'reception', 'frontdesk', 'front-desk',
  'marketing', 'press', 'media', 'pr',
  'hr', 'humanresources', 'people', 'careers', 'jobs', 'recruitment',
  'billing', 'accounts', 'accounting', 'finance', 'ar', 'ap',
  'partners', 'partnerships', 'business', 'biz', 'bd',
  'legal', 'compliance', 'privacy', 'security', 'abuse',
  'webmaster', 'postmaster', 'hostmaster',
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'mailer-daemon',
  'newsletter', 'updates', 'news', 'announcements', 'notifications',
  'feedback', 'survey', 'service', 'customerservice', 'customer-service',
])

// Free / consumer email domains. Founders sometimes use these legitimately,
// but combined with a senior corporate title it's worth verifying.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.uk',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'aol.com',
  'icloud.com', 'me.com', 'mac.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'mail.com', 'gmx.com', 'gmx.us', 'tutanota.com', 'fastmail.com',
  'comcast.net', 'verizon.net', 'sbcglobal.net', 'cox.net', 'att.net',
])

// Common email-domain typos — almost always data-entry errors.
const DOMAIN_TYPOS: Record<string, string> = {
  'gmial.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'yhoo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.co': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'aoll.com': 'aol.com',
  'iclod.com': 'icloud.com',
  'icoud.com': 'icloud.com',
}

// Senior / decision-maker title patterns. Used to detect mismatches with
// admin emails (info@CEO is wrong) and personal-domain titles (gmail+CEO
// is suspicious).
const SENIOR_TITLE_PATTERNS = [
  /\b(c[eo]o|cto|cmo|cfo|coo|cio|cso|cco|cro)\b/i,            // C-suite acronyms
  /\b(ceo|chief|president|founder|cofounder|co-founder)\b/i,
  /\b(owner|principal|partner|principal\s+partner|managing)\b/i,
  /\b(director|vp|vice\s+president|head\s+of)\b/i,
  /\b(senior|sr\.?|principal|lead)\s+/i,
  /\bvice[\s-]?president\b/i,
  /\bgeneral\s+manager\b/i,
  /\b(executive|managing|operating)\s+(director|partner|officer)\b/i,
]

// Test/placeholder data patterns — these are almost always junk.
const TEST_DATA_PATTERNS = [
  /\b(test|testing|tester|demo|demonstration|example|sample|fake|dummy|placeholder)\b/i,
  /^(asdf|qwerty|aaaa|abcd|abc|xyz|qwe|test\d*)/i,
  /^(a@a|test@test|abc@abc|foo@bar|noone@nowhere)/i,
]

// Phone patterns that are obviously fake or placeholder
const FAKE_PHONE_PATTERNS = [
  /^(\d)\1{6,}$/,                  // all same digit (5555555 or 5555555555)
  /^0123456789|1234567890$/,       // sequential
  /^9876543210|9999999999$/,       // sequential descending or fake
  /^555555\d{4}$/,                 // 555-555-XXXX (fictional)
  /^000$/, /^123$/, /^999$/,       // way too short to be real
]

// ============================================================
// Helpers
// ============================================================

function getEmailParts(email: string): { local: string; domain: string } {
  if (!email) return { local: '', domain: '' }
  const at = email.lastIndexOf('@')
  if (at < 0) return { local: email.toLowerCase(), domain: '' }
  return {
    local: email.slice(0, at).toLowerCase().trim(),
    domain: email.slice(at + 1).toLowerCase().trim(),
  }
}

function isSeniorTitle(title: string): boolean {
  if (!title) return false
  return SENIOR_TITLE_PATTERNS.some((re) => re.test(title))
}

function looksLikeCompanyName(title: string): boolean {
  if (!title) return false
  // Title contains corporate suffix → it's probably a company name in the wrong field
  return /\b(inc|llc|ltd|corp|co\.|company|incorporated|limited|holdings|group|enterprises|industries)\b\.?$/i.test(title.trim())
}

function isInvalidEmail(email: string): boolean {
  if (!email) return false
  const e = email.trim()
  if (!e) return false
  if (e.includes(' ')) return true
  if (!e.includes('@')) return true
  if (!e.includes('.')) return true
  // Too many @s
  if (e.split('@').length !== 2) return true
  // No local part or no domain
  const { local, domain } = getEmailParts(e)
  if (!local || !domain) return true
  // Domain has no dot
  if (!domain.includes('.')) return true
  // Domain ends with a dot
  if (domain.endsWith('.')) return true
  // Common chars that shouldn't be in emails
  if (/[<>(){}[\]\\,;:"]/.test(e)) return true
  return false
}

function digitsOnly(s: string): string {
  return (s || '').replace(/\D/g, '')
}

// ============================================================
// Per-contact check (returns flags for ONE contact)
// ============================================================

export function checkContact(
  c: Contact,
  ctx: {
    emailToContacts: Map<string, Contact[]>
    nameAndCompanyToContacts: Map<string, Contact[]>
  },
): QualityFlag[] {
  const flags: QualityFlag[] = []
  const { local: emailLocal, domain: emailDomain } = getEmailParts(c.email || '')
  const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
  const titleStr = (c.title || '').trim()

  // ── HIGH SEVERITY (recommend delete/fix) ──────────────────────────────

  // 1. noreply / mailer-daemon / explicit do-not-reply
  if (emailLocal && /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|notifications?|alerts?|automated)$/.test(emailLocal)) {
    flags.push({
      type: 'no-reply-email',
      severity: 'high',
      recommendation: 'delete',
      reason: `${c.email} is an automated/no-reply address — not a real person`,
    })
  }

  // 2. Test/placeholder data
  const testHaystack = `${fullName} ${c.email || ''} ${titleStr}`.toLowerCase()
  for (const pattern of TEST_DATA_PATTERNS) {
    if (pattern.test(testHaystack)) {
      flags.push({
        type: 'test-data',
        severity: 'high',
        recommendation: 'delete',
        reason: `Looks like test/placeholder data (matched "${pattern}")`,
      })
      break
    }
  }

  // 3. Invalid email format
  if (c.email && isInvalidEmail(c.email)) {
    flags.push({
      type: 'invalid-email',
      severity: 'high',
      recommendation: 'fix',
      reason: `"${c.email}" doesn't look like a valid email address`,
    })
  }

  // 4. Title looks like a company name (someone pasted into wrong column)
  if (looksLikeCompanyName(titleStr)) {
    flags.push({
      type: 'title-is-company-name',
      severity: 'high',
      recommendation: 'fix',
      reason: `Title "${titleStr}" looks like a company name — probably pasted into the wrong column`,
    })
  }

  // 5. Title contains an email or phone number (also wrong column)
  if (titleStr && titleStr.includes('@') && titleStr.includes('.')) {
    flags.push({
      type: 'title-is-email',
      severity: 'high',
      recommendation: 'fix',
      reason: `Title "${titleStr}" contains an email address — probably pasted into the wrong column`,
    })
  }
  if (titleStr && /^\+?\d[\d\s\-().]{7,}$/.test(titleStr)) {
    flags.push({
      type: 'title-is-phone',
      severity: 'high',
      recommendation: 'fix',
      reason: `Title "${titleStr}" looks like a phone number — probably pasted into the wrong column`,
    })
  }

  // ── MEDIUM SEVERITY (recommend research) ──────────────────────────────

  // 6. Generic admin/role email + person title — this is the big one
  if (emailLocal && ADMIN_EMAIL_PREFIXES.has(emailLocal)) {
    if (fullName || isSeniorTitle(titleStr)) {
      flags.push({
        type: 'admin-email-with-person',
        severity: isSeniorTitle(titleStr) ? 'high' : 'medium',
        recommendation: isSeniorTitle(titleStr) ? 'delete' : 'research',
        reason:
          `${c.email} is a shared/admin inbox` +
          (isSeniorTitle(titleStr) ? ` but title is "${titleStr}" — almost certainly not a real person` : '') +
          (fullName && !isSeniorTitle(titleStr) ? ` linked to "${fullName}" — verify or delete` : ''),
      })
    }
  }

  // 7. Personal email domain + senior corporate title
  if (emailDomain && PERSONAL_EMAIL_DOMAINS.has(emailDomain) && isSeniorTitle(titleStr)) {
    flags.push({
      type: 'personal-email-senior-title',
      severity: 'medium',
      recommendation: 'research',
      reason: `${c.email} is a personal email but title is "${titleStr}" — could be founder or scrape error, worth verifying`,
    })
  }

  // 8. Email domain typo
  if (emailDomain && DOMAIN_TYPOS[emailDomain]) {
    flags.push({
      type: 'email-domain-typo',
      severity: 'medium',
      recommendation: 'fix',
      reason: `Email domain "${emailDomain}" is likely a typo of "${DOMAIN_TYPOS[emailDomain]}"`,
    })
  }

  // 9. Phone looks fake
  if (c.phone) {
    const d = digitsOnly(c.phone)
    if (d.length > 0 && d.length < 7) {
      flags.push({
        type: 'phone-too-short',
        severity: 'medium',
        recommendation: 'fix',
        reason: `Phone "${c.phone}" only has ${d.length} digits — too short to be real`,
      })
    } else if (FAKE_PHONE_PATTERNS.some((re) => re.test(d))) {
      flags.push({
        type: 'phone-fake-pattern',
        severity: 'medium',
        recommendation: 'fix',
        reason: `Phone "${c.phone}" matches a fake/placeholder pattern (all-same-digit, sequential, or 555-555-XXXX)`,
      })
    }
  }

  // 10. Duplicate email (case-insensitive)
  if (c.email) {
    const emailKey = c.email.toLowerCase().trim()
    const sameEmail = ctx.emailToContacts.get(emailKey) || []
    if (sameEmail.length > 1) {
      // Only flag the duplicates — keep the oldest one as canonical
      const sortedByCreatedAt = [...sameEmail].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      const isOldest = sortedByCreatedAt[0]?.id === c.id
      if (!isOldest) {
        flags.push({
          type: 'duplicate-email',
          severity: 'medium',
          recommendation: 'delete',
          reason: `Duplicate of an earlier contact with email "${c.email}"`,
        })
      }
    }
  }

  // 11. Duplicate name + company (case-insensitive)
  if (fullName && c.companyId) {
    const key = `${fullName.toLowerCase()}|${c.companyId}`
    const sameKey = ctx.nameAndCompanyToContacts.get(key) || []
    if (sameKey.length > 1) {
      const sortedByCreatedAt = [...sameKey].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))
      const isOldest = sortedByCreatedAt[0]?.id === c.id
      if (!isOldest) {
        flags.push({
          type: 'duplicate-name-company',
          severity: 'medium',
          recommendation: 'delete',
          reason: `Duplicate of an earlier contact with same name + company`,
        })
      }
    }
  }

  // 12. Both name AND title missing — just a floating email
  if (!fullName && !titleStr) {
    flags.push({
      type: 'no-name-no-title',
      severity: 'medium',
      recommendation: 'research',
      reason: 'No name and no title — just a floating email or phone, hard to know who this is',
    })
  }

  // ── LOW SEVERITY (FYI / opt-in) ──────────────────────────────

  // 13. Missing email AND phone — can't contact this person at all
  if (!c.email && !c.phone) {
    flags.push({
      type: 'no-contact-info',
      severity: 'low',
      recommendation: 'research',
      reason: 'No email or phone — cannot reach this contact',
    })
  }

  return flags
}

// ============================================================
// Bulk check (returns flags for all contacts)
// ============================================================

export function checkAllContacts(contacts: Contact[]): Map<string, ContactFlags> {
  // Build lookup maps once for O(1) duplicate detection.
  const emailToContacts = new Map<string, Contact[]>()
  const nameAndCompanyToContacts = new Map<string, Contact[]>()

  for (const c of contacts) {
    if (c.email) {
      const key = c.email.toLowerCase().trim()
      const arr = emailToContacts.get(key) || []
      arr.push(c)
      emailToContacts.set(key, arr)
    }
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.trim()
    if (fullName && c.companyId) {
      const key = `${fullName.toLowerCase()}|${c.companyId}`
      const arr = nameAndCompanyToContacts.get(key) || []
      arr.push(c)
      nameAndCompanyToContacts.set(key, arr)
    }
  }

  const result = new Map<string, ContactFlags>()
  for (const c of contacts) {
    const flags = checkContact(c, { emailToContacts, nameAndCompanyToContacts })
    if (flags.length === 0) continue
    const topSeverity: FlagSeverity = flags.some((f) => f.severity === 'high')
      ? 'high'
      : flags.some((f) => f.severity === 'medium')
        ? 'medium'
        : 'low'
    const topRecommendation: FlagRecommendation = flags.some((f) => f.recommendation === 'delete')
      ? 'delete'
      : flags.some((f) => f.recommendation === 'fix')
        ? 'fix'
        : flags.some((f) => f.recommendation === 'research')
          ? 'research'
          : 'keep'
    result.set(c.id, {
      contactId: c.id,
      flags,
      topSeverity,
      topRecommendation,
    })
  }
  return result
}

// ============================================================
// Tag helpers — translate flags into the tags the saved-views expect
// ============================================================

/** Build the full tag set for a contact based on its flags + existing tags.
 *  Adds quality-flag tags but preserves all existing non-quality tags. */
export function tagsWithQualityFlags(
  existingTagsCsv: string,
  flags: ContactFlags,
): string {
  const existing = (existingTagsCsv || '')
    .split(/[,|]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    // Strip old ai-* tags so we can re-apply fresh
    .filter((t) => !t.startsWith('ai-flag-') && !t.startsWith('ai-rec-'))

  const newTags: string[] = ['ai-flag-mismatch']
  if (flags.topRecommendation === 'delete') newTags.push('ai-rec-delete')
  else if (flags.topRecommendation === 'research') newTags.push('ai-rec-research')
  else if (flags.topRecommendation === 'fix') newTags.push('ai-rec-fix')

  // Per-flag-type tags so we can build precise saved views later
  for (const f of flags.flags) {
    newTags.push(`ai-flag-${f.type}`)
  }

  return Array.from(new Set([...existing, ...newTags])).join(', ')
}

/** Format the flags into a single Note body for the contact. */
export function flagsToNoteBody(flags: ContactFlags): string {
  const lines = ['[Quality Scan] Issues detected:']
  for (const f of flags.flags) {
    const sevTag = f.severity.toUpperCase()
    lines.push(`  • [${sevTag} · rec: ${f.recommendation}] ${f.reason}`)
  }
  return lines.join('\n')
}

/** Summary stats for the alert. */
export interface ScanSummary {
  totalContacts: number
  totalFlagged: number
  highSeverity: number
  mediumSeverity: number
  lowSeverity: number
  recDelete: number
  recFix: number
  recResearch: number
  byFlagType: Record<string, number>
}

export function summarizeFlags(flagsMap: Map<string, ContactFlags>, totalContacts: number): ScanSummary {
  let high = 0, mid = 0, low = 0
  let recDelete = 0, recFix = 0, recResearch = 0
  const byFlagType: Record<string, number> = {}
  for (const cf of flagsMap.values()) {
    if (cf.topSeverity === 'high') high++
    else if (cf.topSeverity === 'medium') mid++
    else if (cf.topSeverity === 'low') low++
    if (cf.topRecommendation === 'delete') recDelete++
    else if (cf.topRecommendation === 'fix') recFix++
    else if (cf.topRecommendation === 'research') recResearch++
    for (const f of cf.flags) {
      byFlagType[f.type] = (byFlagType[f.type] || 0) + 1
    }
  }
  return {
    totalContacts,
    totalFlagged: flagsMap.size,
    highSeverity: high,
    mediumSeverity: mid,
    lowSeverity: low,
    recDelete,
    recFix,
    recResearch,
    byFlagType,
  }
}
