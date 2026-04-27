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

export type StepType = 'email' | 'wait' | 'branch' | 'action'

/** Each step's `config` is a JSON string. Shape depends on `type`. */
export interface StepConfigEmail {
  templateId?: string // optional: reference a template
  subject: string
  body: string // markdown-ish; supports {{firstName}}, {{company}}, etc.
  trackOpens?: boolean
  replyBehavior?: 'exit' | 'continue' // default: 'exit' — replies stop the sequence
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
  fetchedAt: string
}
