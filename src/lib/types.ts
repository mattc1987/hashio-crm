// Data types mirroring the Google Sheet schema built by Cowork.
// Source of truth: https://docs.google.com/spreadsheets/d/1kHn4GA2YB5LyBImxMqhwDBF374gjqOOoNpr7LeBRHoQ

export type DealStage =
  | 'Lead'
  | 'Qualified'
  | 'Demo'
  | 'Proposal'
  | 'Negotiation'
  | 'Closed Won'
  | 'Closed Lost'

export type BillingCycle = 'monthly' | 'quarterly' | 'annual' | ''

export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'open' | 'completed' | 'cancelled'

export interface Company {
  id: string
  name: string
  industry: string
  licenseCount: string // kept as string since sheet stores it as string
  size: string
  website: string
  address: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Contact {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string
  title: string
  companyId: string
  status: string
  /** US state / region the contact is in (e.g. "CO", "OR", "Kentucky"). */
  state: string
  /** Full LinkedIn profile URL. */
  linkedinUrl: string
  /** Comma-separated tags (e.g. "vip, q3-demo"). Rendered as pills. */
  tags: string
  createdAt: string
}

export interface Deal {
  id: string
  title: string
  contactId: string
  companyId: string
  value: number
  stage: string
  probability: number
  closeDate: string
  mrr: number
  billingCycle: BillingCycle
  billingMonth: string
  contractStart: string
  contractEnd: string
  mrrStatus: string
  notes: string
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  title: string
  dueDate: string
  priority: TaskPriority | string
  contactId: string
  dealId: string
  notes: string
  status: TaskStatus | string
  createdAt: string
  updatedAt: string
}

export interface Activity {
  id: string
  type: string
  text: string
  icon: string
  createdAt: string
}

export interface Invoice {
  id: string
  companyId: string
  dealId: string
  period: string
  sent: string
  sentDate: string
  createdAt: string
}

export interface Cashflow {
  id: string
  period: string // "YYYY_MM"
  expenses: number
}

export interface ExecUpdate {
  id: string
  period: string
  newCustomers: number
  savedMRR: number
  prevMRR: number
  demosBooked: number
  wins: string
  plans: string
  losses: string
  problems: string
}

/* ============================================================
   Email sequences
   ============================================================ */

export type SequenceStatus = 'draft' | 'active' | 'paused' | 'archived'

export type StepType = 'email' | 'sms' | 'wait' | 'branch' | 'action'

/** Each step's `config` is a JSON string. Shape depends on `type`. */
export interface StepConfigEmail {
  templateId?: string // optional: reference a template
  subject: string
  body: string // markdown-ish; supports {{firstName}}, {{company}}, etc.
  trackOpens?: boolean
  replyBehavior?: 'exit' | 'continue' // default: 'exit' — replies stop the sequence
}

export interface StepConfigSms {
  body: string                       // SMS text (supports merge tags). Keep <= 1600 chars.
  mediaUrl?: string                  // Optional MMS image URL
  replyBehavior?: 'exit' | 'continue' // default: 'exit'
}

export interface StepConfigWait {
  amount: number
  unit: 'hours' | 'days' | 'weeks' | 'businessDays'
}

export type BranchCondition =
  | { kind: 'opened-last'; withinHours?: number }
  | { kind: 'clicked-last'; withinHours?: number }
  | { kind: 'replied'; withinHours?: number }
  | { kind: 'contact-field'; field: keyof Contact; equals: string }
  | { kind: 'deal-stage'; equals: string }

export interface StepConfigBranch {
  condition: BranchCondition
  trueNext: number // index of next step if condition is true
  falseNext: number // index of next step if false
}

export type ActionKind =
  | 'create-task'
  | 'update-contact'
  | 'update-deal-stage'
  | 'notify-owner'
  | 'end-sequence'
  | 'unsubscribe-contact'

export interface StepConfigAction {
  kind: ActionKind
  payload?: Record<string, unknown>
}

export type StepConfig =
  | StepConfigEmail
  | StepConfigSms
  | StepConfigWait
  | StepConfigBranch
  | StepConfigAction

export interface Sequence {
  id: string
  name: string
  description: string
  status: SequenceStatus
  createdAt: string
  updatedAt: string
}

export interface SequenceStep {
  id: string
  sequenceId: string
  order: number // 0-indexed position in the sequence
  type: StepType
  config: string // JSON-encoded StepConfig
  label: string // human label like "Day 1 — intro email"
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  category: string
  createdAt: string
  updatedAt: string
}

export type EnrollmentStatus =
  | 'active' // scheduler will fire next
  | 'paused'
  | 'completed'
  | 'stopped-reply' // contact replied
  | 'stopped-manual'
  | 'stopped-error'
  | 'unsubscribed'

export interface Enrollment {
  id: string
  sequenceId: string
  contactId: string
  dealId: string // optional — links enrollment to a deal for merge tags
  currentStepIndex: number
  status: EnrollmentStatus
  enrolledAt: string
  lastFiredAt: string
  nextFireAt: string // ISO datetime; scheduler fires when this is in the past
  notes: string
}

export interface EmailSend {
  id: string
  enrollmentId: string
  sequenceId: string
  stepId: string
  contactId: string
  to: string
  subject: string
  bodyPreview: string // first 120 chars for list view
  threadId: string // Gmail thread id
  messageId: string // Gmail message id
  sentAt: string
  openedAt: string // blank until tracking pixel fires
  repliedAt: string // blank until reply detected
  clickedAt: string
  status: 'sent' | 'bounced' | 'error'
  errorMessage: string
}

/* ============================================================
   Booking links (Calendly-style scheduler)
   ============================================================ */

export type BookingLinkStatus = 'active' | 'disabled'

export interface BookingLink {
  id: string
  slug: string                  // URL slug, e.g. "matt-15min"
  name: string                  // Display name, e.g. "Quick 15-min chat"
  description: string           // Shown on the public booking page
  durationMinutes: number       // 15, 30, 60, etc.
  workingDays: string           // CSV of weekday numbers (0=Sun..6=Sat) e.g. "1,2,3,4,5"
  startHour: number             // 0-23 in `timezone`
  endHour: number               // 0-23 in `timezone` (exclusive)
  timezone: string              // IANA tz, e.g. "America/Denver"
  bufferMinutes: number         // padding between meetings
  minAdvanceHours: number       // can't book closer than this many hours out
  maxAdvanceDays: number        // can't book further than this many days out
  ownerEmail: string            // whose calendar to read + write to
  ownerName: string             // displayed on public page
  status: BookingLinkStatus
  createdAt: string
  updatedAt: string
}

export type BookingStatus = 'confirmed' | 'cancelled'

export interface Booking {
  id: string
  bookingLinkId: string
  slug: string                  // denormalized for convenience
  attendeeName: string
  attendeeEmail: string
  attendeeNotes: string         // free-text from the booking form
  slotStart: string             // ISO datetime
  slotEnd: string               // ISO datetime
  eventId: string               // Google Calendar event id
  status: BookingStatus
  createdAt: string
}

/* ============================================================
   Notes (free-text per-record feed)
   ============================================================ */

export type NoteEntityType = 'contact' | 'company' | 'deal'

export interface Note {
  id: string
  entityType: NoteEntityType
  entityId: string
  body: string
  author: string
  createdAt: string
  updatedAt: string
}

/* ============================================================
   Leads — prospects ingested from LinkedIn / Teamfluence / Apollo
   etc. via webhook. Convertible to Contact + Deal once qualified.
   ============================================================ */

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'archived'
export type LeadTemperature = 'cold' | 'warm' | 'hot' | 'molten'

export interface LeadEngagementSignal {
  /** Free-form signal type: 'company-follow', 'post-like', 'post-comment', 'profile-view', etc. */
  kind: string
  ts: string
  /** What they engaged with — post URL, page name, etc. */
  target?: string
  /** Optional weight multiplier (1 = baseline). */
  weight?: number
}

export interface Lead {
  id: string
  /** Where this lead came from: 'teamfluence', 'apollo', 'clay', 'csv-import', 'manual', etc. */
  source: string
  /** External ID from the source system (so we can dedupe). */
  externalId: string

  // Person-level fields
  firstName: string
  lastName: string
  email: string
  linkedinUrl: string
  headline: string  // their LinkedIn headline / current title
  title: string

  // Company-level fields (denormalized for fast filtering)
  companyName: string
  companyLinkedinUrl: string
  companyDomain: string
  companyIndustry: string
  companySize: string
  location: string

  /** JSON-encoded array of engagement signals over time. */
  engagementSignals: string

  /** Auto-computed temperature based on signals + recency. */
  temperature: LeadTemperature
  /** Auto-computed score (0-100). */
  score: number

  status: LeadStatus
  notes: string

  /** If converted, the contact id we created. */
  convertedContactId: string

  createdAt: string
  /** Most recent engagement signal timestamp. */
  lastSignalAt: string
}

/* ============================================================
   Activity logs (manual call/text/meeting entries)
   Separate from auto-tracked email sends — these are things
   Matt or the team logs by hand: "called Jane, left voicemail"
   etc.
   ============================================================ */

export type ActivityLogKind =
  | 'call-outbound'
  | 'call-inbound'
  | 'text-outbound'
  | 'text-inbound'
  | 'meeting'
  | 'voicemail'
  | 'linkedin-message'
  | 'other'

export type ActivityLogOutcome =
  | 'connected'
  | 'no-answer'
  | 'left-voicemail'
  | 'replied'
  | 'no-reply'
  | 'completed'
  | ''

export interface ActivityLog {
  id: string
  /** Which entity this log attaches to. */
  entityType: 'contact' | 'company' | 'deal'
  entityId: string
  kind: ActivityLogKind
  outcome: ActivityLogOutcome
  /** Free-text summary the user types. */
  body: string
  /** Optional duration for calls/meetings (in minutes). */
  durationMinutes: number
  /** When the activity actually happened (user-set). */
  occurredAt: string
  /** When the log was created in the CRM. */
  createdAt: string
  author: string
}

/* ============================================================
   Agentic BDR — Proposals
   ============================================================
   Each proposal is one concrete action the rule engine wants to take,
   gated behind Matt's approval. Audit-logged in the Proposals Sheet
   tab so we have a full history of what was proposed, what was
   approved/skipped, and what executed.
   ============================================================ */

export type ProposalCategory =
  | 'outreach'      // start new conversations
  | 'follow-up'     // continue existing conversations
  | 'deal'          // pipeline updates / nudges
  | 'hygiene'       // data quality
  | 'meeting'       // pre/post meeting actions
  | 'report'        // summaries / alerts (informational only)

export type ProposalRisk = 'safe' | 'moderate' | 'sensitive'
//  safe       = data-only, internal records (tasks, deal stage, notes)
//  moderate   = creates internal records that may surface to others (activity log)
//  sensitive  = sends external messages (email, SMS) — ALWAYS needs explicit approval

export type ProposalStatus =
  | 'proposed'
  | 'approved'
  | 'skipped'
  | 'edited'
  | 'executed'
  | 'failed'
  | 'cancelled'

export type ProposalActionKind =
  | 'enroll-in-sequence'
  | 'send-email'
  | 'send-sms'
  | 'create-task'
  | 'update-deal'
  | 'update-contact'
  | 'log-activity'
  | 'pause-enrollment'
  | 'merge-records'
  | 'create-note'

export interface Proposal {
  id: string
  ruleId: string
  category: ProposalCategory
  priority: 'critical' | 'high' | 'medium' | 'low'
  /** 0–100 — how confident the rule is. Surfaced in the UI. */
  confidence: number
  risk: ProposalRisk

  /** One-line headline shown in the queue card. */
  title: string
  /** Why this proposal exists — the rule's reasoning. */
  reason: string
  /** What we expect to happen after execution. */
  expectedOutcome: string

  /** The action shape — exactly one of these is populated.  */
  actionKind: ProposalActionKind
  /** JSON-encoded action payload. Shape depends on actionKind. */
  actionPayload: string

  status: ProposalStatus
  createdAt: string
  /** When status moved away from 'proposed'. */
  resolvedAt: string
  resolvedBy: string
  /** When the action actually ran (after approval). */
  executedAt: string
  /** Any output / error string from execution. */
  executionResult: string

  /** Subject ids — denormalized for quick filtering by entity. */
  contactIds: string  // comma-separated
  dealId: string
  companyId: string
}

/* ============================================================
   SMS sends (mirrors EmailSends but for Twilio-sent texts)
   ============================================================ */

export interface SmsSend {
  id: string
  enrollmentId: string
  sequenceId: string
  stepId: string
  contactId: string
  to: string                  // E.164 phone number
  from: string
  body: string
  twilioSid: string           // Twilio message SID
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'undelivered'
  errorMessage: string
  sentAt: string
  deliveredAt: string
  repliedAt: string
}

export interface SheetData {
  companies: Company[]
  contacts: Contact[]
  deals: Deal[]
  tasks: Task[]
  activity: Activity[]
  invoices: Invoice[]
  cashflow: Cashflow[]
  execUpdates: ExecUpdate[]
  sequences: Sequence[]
  sequenceSteps: SequenceStep[]
  emailTemplates: EmailTemplate[]
  enrollments: Enrollment[]
  emailSends: EmailSend[]
  bookingLinks: BookingLink[]
  bookings: Booking[]
  notes: Note[]
  activityLogs: ActivityLog[]
  leads: Lead[]
  smsSends: SmsSend[]
  proposals: Proposal[]
  fetchedAt: string
}
