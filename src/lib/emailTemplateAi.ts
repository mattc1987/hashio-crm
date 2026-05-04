// AI Email Template Builder — calls aiBuildEmailTemplate on Apps Script.
// Expert copywriter persona. Returns a complete template with primary
// subject + body + alternative subjects + alternative CTAs + use-case
// notes + which framework was used + which merge tags it relied on.

const APPS_SCRIPT_URL = import.meta.env.VITE_APPS_SCRIPT_URL || ''
const APPS_SCRIPT_KEY = import.meta.env.VITE_APPS_SCRIPT_KEY || ''

// ============================================================
// Input
// ============================================================

export type EmailUseCase =
  | 'cold-outreach'
  | 'follow-up'
  | 'inbound-reply'
  | 'demo-recap'
  | 'proposal-send'
  | 'renewal-outreach'
  | 'win-back'
  | 'referral-request'
  | 'review-request'
  | 'breakup'
  | 'event-invite'
  | 'check-in'
  | 'introduction'
  | 'thank-you'
  | 'meeting-request'
  | 'custom'

export type EmailFramework = 'auto' | 'aida' | 'pas' | 'bab' | 'fab' | 'story' | 'question'

export type EmailTone = 'direct' | 'conversational' | 'witty' | 'formal' | 'story-driven'

export type EmailLength = 'very-short' | 'short' | 'medium' | 'long'

export type CtaType = 'auto' | 'book-meeting' | 'reply' | 'question' | 'resource' | 'call'

export type SubjectStyle = 'auto' | 'question' | 'curiosity' | 'personalized' | 'short' | 'specific'

export interface EmailTemplateBuildInput {
  useCase: EmailUseCase
  useCaseDetail?: string
  audience?: string
  framework: EmailFramework
  tone: EmailTone
  length: EmailLength
  ctaType: CtaType
  subjectStyle: SubjectStyle
  voiceSamples?: string
  /** Freeform "extra instructions" — guardrails the AI must respect.
   *  e.g. "Don't mention METRC — targets are in non-METRC states" or
   *  "Lead with cost-per-pound, not yield". Stronger than `audience`. */
  customInstructions?: string
  folder?: string  // e.g. "Cold outreach" — sets the saved category
}

// ============================================================
// Output
// ============================================================

export interface BuiltEmailTemplate {
  name: string
  subject: string
  body: string
  alternativeSubjects: string[]
  alternativeCtas: string[]
  useCaseNotes: string
  framework: string
  category: string
  mergeTagsUsed: string[]
  model: string
  generatedAt: string
}

// ============================================================
// Call
// ============================================================

export async function buildEmailTemplate(input: EmailTemplateBuildInput): Promise<BuiltEmailTemplate> {
  if (!APPS_SCRIPT_URL) throw new Error('Backend not configured')
  const body = new URLSearchParams()
  body.set('action', 'aiBuildEmailTemplate')
  body.set('key', APPS_SCRIPT_KEY)
  body.set('payload', JSON.stringify(input))
  const res = await fetch(APPS_SCRIPT_URL, { method: 'POST', body, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json().catch(() => ({ ok: false, error: 'Non-JSON response' }))
  if (!json.ok) throw new Error(json.error || 'Failed')
  if (!json.data) throw new Error('Empty response from Claude')
  return json.data as BuiltEmailTemplate
}

// ============================================================
// UI option lists
// ============================================================

export const USE_CASE_OPTIONS: Array<{ value: EmailUseCase; label: string; hint: string }> = [
  { value: 'cold-outreach',     label: 'Cold outreach',         hint: 'First touch, never heard from you' },
  { value: 'follow-up',         label: 'Cold follow-up',        hint: 'Bump after the cold email' },
  { value: 'inbound-reply',     label: 'Inbound reply',         hint: 'They reached out — your response' },
  { value: 'demo-recap',        label: 'Demo recap',            hint: 'Post-demo, push to next step' },
  { value: 'proposal-send',     label: 'Proposal send',         hint: 'Sending the contract / quote' },
  { value: 'renewal-outreach',  label: 'Renewal outreach',      hint: 'Existing customer renewal' },
  { value: 'win-back',          label: 'Win-back',              hint: 'Churned or dormant customer' },
  { value: 'breakup',           label: 'Breakup email',         hint: 'Final touch — "should I close your file?"' },
  { value: 'referral-request',  label: 'Referral request',      hint: 'Asking happy customer for intros' },
  { value: 'review-request',    label: 'Review / case study',   hint: 'Ask for testimonial or case study' },
  { value: 'meeting-request',   label: 'Meeting request',       hint: 'Direct ask for a meeting' },
  { value: 'check-in',          label: 'Casual check-in',       hint: 'Warm contact gone quiet' },
  { value: 'event-invite',      label: 'Event invite',          hint: 'Webinar / dinner / conference' },
  { value: 'thank-you',         label: 'Thank-you note',        hint: 'After meeting or call' },
  { value: 'introduction',      label: 'Introduction',          hint: 'Connecting two people' },
  { value: 'custom',            label: 'Custom',                hint: 'Describe your own scenario' },
]

export const FRAMEWORK_OPTIONS: Array<{ value: EmailFramework; label: string; hint: string }> = [
  { value: 'auto',     label: 'Auto-pick',     hint: 'Best framework for this use case' },
  { value: 'aida',     label: 'AIDA',          hint: 'Attention → Interest → Desire → Action' },
  { value: 'pas',      label: 'PAS',           hint: 'Problem → Agitation → Solution' },
  { value: 'bab',      label: 'BAB',           hint: 'Before → After → Bridge' },
  { value: 'fab',      label: 'FAB',           hint: 'Feature → Advantage → Benefit' },
  { value: 'story',    label: 'StoryBrand',    hint: 'They\'re hero, you\'re guide' },
  { value: 'question', label: 'Question-led',  hint: 'Open with a single specific question' },
]

export const TONE_OPTIONS: Array<{ value: EmailTone; label: string; hint: string }> = [
  { value: 'direct',         label: 'Direct',         hint: 'No fluff, value upfront' },
  { value: 'conversational', label: 'Conversational', hint: 'Friendly, contractions, smart-friend energy' },
  { value: 'witty',          label: 'Witty',          hint: 'One clever line, makes them grin' },
  { value: 'formal',         label: 'Formal',         hint: 'McKinsey-style polish (use sparingly)' },
  { value: 'story-driven',   label: 'Story-driven',   hint: '1-2 sentence anecdote, then the ask' },
]

export const LENGTH_OPTIONS: Array<{ value: EmailLength; label: string; hint: string }> = [
  { value: 'very-short', label: 'Very short', hint: '1-3 sentences, often highest reply rate' },
  { value: 'short',      label: 'Short',      hint: '2-4 short paragraphs, 50-100 words' },
  { value: 'medium',     label: 'Medium',     hint: '4-6 paragraphs, 100-200 words' },
  { value: 'long',       label: 'Long',       hint: 'Use for warm contacts who want depth' },
]

export const CTA_OPTIONS: Array<{ value: CtaType; label: string; hint: string }> = [
  { value: 'auto',         label: 'Auto-pick',          hint: 'Right CTA for the use case' },
  { value: 'book-meeting', label: 'Book a meeting',     hint: 'Pushes them to a booking link' },
  { value: 'reply',        label: 'Reply yes/no',       hint: 'Lowest-friction ask' },
  { value: 'question',     label: 'Specific question',  hint: 'Easy to answer, opens dialogue' },
  { value: 'resource',     label: 'Offer a resource',   hint: 'Soft — no commitment ask' },
  { value: 'call',         label: 'Phone call',         hint: 'Higher-intent contacts' },
]

export const SUBJECT_STYLE_OPTIONS: Array<{ value: SubjectStyle; label: string; hint: string }> = [
  { value: 'auto',         label: 'Auto-pick',     hint: 'Best subject for use case + tone' },
  { value: 'question',     label: 'Question',      hint: '"Quick question about X?"' },
  { value: 'curiosity',    label: 'Curiosity gap', hint: '"Saw something about [Company]…"' },
  { value: 'personalized', label: 'Personalized',  hint: '"{{firstName}} — quick thought"' },
  { value: 'short',        label: 'Very short',    hint: '"Quick question" / "Re: pricing"' },
  { value: 'specific',     label: 'Specific',      hint: 'References mutual contact, news, post' },
]
