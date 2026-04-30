// Reads from the public Google Sheet via the gviz CSV export endpoint.
// No auth needed because Matt set the sheet to viewable-by-link.
//
// Future-facing: when we add write support, we'll call an Apps Script URL
// defined in VITE_APPS_SCRIPT_URL — see api.ts.

import Papa from 'papaparse'
import type {
  Activity,
  ActivityLog,
  Booking,
  BookingLink,
  Cashflow,
  Company,
  Contact,
  Deal,
  EmailSend,
  EmailTemplate,
  Enrollment,
  ExecUpdate,
  Invoice,
  Lead,
  Note,
  Proposal,
  Sequence,
  SequenceStep,
  SheetData,
  SmsSend,
  Task,
} from './types'

export const SHEET_ID =
  import.meta.env.VITE_SHEET_ID ||
  '1kHn4GA2YB5LyBImxMqhwDBF374gjqOOoNpr7LeBRHoQ'

function csvUrl(sheetName: string) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    sheetName,
  )}`
}

async function fetchTab(name: string): Promise<Record<string, string>[]> {
  const res = await fetch(csvUrl(name), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Failed to load ${name}: HTTP ${res.status}`)
  const text = await res.text()
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  })
  // Drop rows where the id column is empty (handles stray blank rows)
  return parsed.data.filter((row) => (row.id ?? '').toString().trim() !== '')
}

const toNum = (v: unknown) => {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : 0
}

// ---------- Per-tab mappers ----------

function mapCompanies(rows: Record<string, string>[]): Company[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '',
    industry: r.industry || '',
    licenseCount: r.licenseCount || '',
    size: r.size || '',
    website: r.website || '',
    address: r.address || '',
    notes: r.notes || '',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapContacts(rows: Record<string, string>[]): Contact[] {
  return rows.map((r) => ({
    id: r.id,
    firstName: r.firstName || '',
    lastName: r.lastName || '',
    email: r.email || '',
    phone: r.phone || '',
    title: r.title || '',
    role: r.role || '',
    companyId: r.companyId || '',
    status: r.status || '',
    state: r.state || '',
    linkedinUrl: r.linkedinUrl || '',
    tags: r.tags || '',
    createdAt: r.createdAt || '',
  }))
}

function mapDeals(rows: Record<string, string>[]): Deal[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title || '',
    contactId: r.contactId || '',
    companyId: r.companyId || '',
    value: toNum(r.value),
    stage: r.stage || '',
    probability: toNum(r.probability),
    closeDate: r.closeDate || '',
    mrr: toNum(r.mrr),
    billingCycle: (r.billingCycle as Deal['billingCycle']) || '',
    billingMonth: r.billingMonth || '',
    contractStart: r.contractStart || '',
    contractEnd: r.contractEnd || '',
    mrrStatus: r.mrrStatus || '',
    notes: r.notes || '',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapTasks(rows: Record<string, string>[]): Task[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.title || '',
    dueDate: r.dueDate || '',
    priority: r.priority || 'medium',
    contactId: r.contactId || '',
    dealId: r.dealId || '',
    notes: r.notes || '',
    status: r.status || 'open',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapActivity(rows: Record<string, string>[]): Activity[] {
  return rows.map((r) => ({
    id: r.id,
    type: r.type || '',
    text: r.text || '',
    icon: r.icon || '',
    createdAt: r.createdAt || '',
  }))
}

function mapInvoices(rows: Record<string, string>[]): Invoice[] {
  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId || '',
    dealId: r.dealId || '',
    period: r.period || '',
    sent: r.sent || '',
    sentDate: r.sentDate || '',
    createdAt: r.createdAt || '',
  }))
}

function mapCashflow(rows: Record<string, string>[]): Cashflow[] {
  return rows.map((r) => ({
    id: r.id,
    period: r.period || '',
    expenses: toNum(r.expenses),
  }))
}

function mapExecUpdates(rows: Record<string, string>[]): ExecUpdate[] {
  return rows.map((r) => ({
    id: r.id,
    period: r.period || '',
    newCustomers: toNum(r.newCustomers),
    savedMRR: toNum(r.savedMRR),
    prevMRR: toNum(r.prevMRR),
    demosBooked: toNum(r.demosBooked),
    wins: r.wins || '',
    plans: r.plans || '',
    losses: r.losses || '',
    problems: r.problems || '',
  }))
}

function mapSequences(rows: Record<string, string>[]): Sequence[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '',
    description: r.description || '',
    status: ((r.status as Sequence['status']) || 'draft'),
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapSequenceSteps(rows: Record<string, string>[]): SequenceStep[] {
  return rows.map((r) => ({
    id: r.id,
    sequenceId: r.sequenceId || '',
    order: toNum(r.order),
    type: ((r.type as SequenceStep['type']) || 'email'),
    config: r.config || '{}',
    label: r.label || '',
  }))
}

function mapEmailTemplates(rows: Record<string, string>[]): EmailTemplate[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name || '',
    subject: r.subject || '',
    body: r.body || '',
    category: r.category || '',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapEnrollments(rows: Record<string, string>[]): Enrollment[] {
  return rows.map((r) => ({
    id: r.id,
    sequenceId: r.sequenceId || '',
    contactId: r.contactId || '',
    dealId: r.dealId || '',
    currentStepIndex: toNum(r.currentStepIndex),
    status: ((r.status as Enrollment['status']) || 'active'),
    enrolledAt: r.enrolledAt || '',
    lastFiredAt: r.lastFiredAt || '',
    nextFireAt: r.nextFireAt || '',
    notes: r.notes || '',
  }))
}

function mapEmailSends(rows: Record<string, string>[]): EmailSend[] {
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollmentId || '',
    sequenceId: r.sequenceId || '',
    stepId: r.stepId || '',
    contactId: r.contactId || '',
    to: r.to || '',
    subject: r.subject || '',
    bodyPreview: r.bodyPreview || '',
    threadId: r.threadId || '',
    messageId: r.messageId || '',
    sentAt: r.sentAt || '',
    openedAt: r.openedAt || '',
    repliedAt: r.repliedAt || '',
    clickedAt: r.clickedAt || '',
    status: ((r.status as EmailSend['status']) || 'sent'),
    errorMessage: r.errorMessage || '',
  }))
}

function mapBookingLinks(rows: Record<string, string>[]): BookingLink[] {
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug || '',
    name: r.name || '',
    description: r.description || '',
    durationMinutes: toNum(r.durationMinutes) || 30,
    workingDays: r.workingDays || '1,2,3,4,5',
    startHour: toNum(r.startHour) || 9,
    endHour: toNum(r.endHour) || 17,
    timezone: r.timezone || 'America/Denver',
    bufferMinutes: toNum(r.bufferMinutes) || 0,
    minAdvanceHours: toNum(r.minAdvanceHours) || 2,
    maxAdvanceDays: toNum(r.maxAdvanceDays) || 30,
    ownerEmail: r.ownerEmail || '',
    ownerName: r.ownerName || '',
    status: ((r.status as BookingLink['status']) || 'active'),
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapBookings(rows: Record<string, string>[]): Booking[] {
  return rows.map((r) => ({
    id: r.id,
    bookingLinkId: r.bookingLinkId || '',
    slug: r.slug || '',
    attendeeName: r.attendeeName || '',
    attendeeEmail: r.attendeeEmail || '',
    attendeeNotes: r.attendeeNotes || '',
    slotStart: r.slotStart || '',
    slotEnd: r.slotEnd || '',
    eventId: r.eventId || '',
    status: ((r.status as Booking['status']) || 'confirmed'),
    createdAt: r.createdAt || '',
  }))
}

function mapNotes(rows: Record<string, string>[]): Note[] {
  return rows.map((r) => ({
    id: r.id,
    entityType: (r.entityType as Note['entityType']) || 'contact',
    entityId: r.entityId || '',
    body: r.body || '',
    author: r.author || '',
    createdAt: r.createdAt || '',
    updatedAt: r.updatedAt || '',
  }))
}

function mapActivityLogs(rows: Record<string, string>[]): ActivityLog[] {
  return rows.map((r) => ({
    id: r.id,
    entityType: (r.entityType as ActivityLog['entityType']) || 'contact',
    entityId: r.entityId || '',
    kind: (r.kind as ActivityLog['kind']) || 'other',
    outcome: (r.outcome as ActivityLog['outcome']) || '',
    body: r.body || '',
    durationMinutes: toNum(r.durationMinutes),
    occurredAt: r.occurredAt || r.createdAt || '',
    createdAt: r.createdAt || '',
    author: r.author || '',
  }))
}

function mapProposals(rows: Record<string, string>[]): Proposal[] {
  return rows.map((r) => ({
    id: r.id,
    ruleId: r.ruleId || '',
    category: (r.category as Proposal['category']) || 'outreach',
    priority: (r.priority as Proposal['priority']) || 'medium',
    confidence: toNum(r.confidence),
    risk: (r.risk as Proposal['risk']) || 'safe',
    title: r.title || '',
    reason: r.reason || '',
    expectedOutcome: r.expectedOutcome || '',
    actionKind: (r.actionKind as Proposal['actionKind']) || 'create-task',
    actionPayload: r.actionPayload || '{}',
    status: (r.status as Proposal['status']) || 'proposed',
    createdAt: r.createdAt || '',
    resolvedAt: r.resolvedAt || '',
    resolvedBy: r.resolvedBy || '',
    executedAt: r.executedAt || '',
    executionResult: r.executionResult || '',
    contactIds: r.contactIds || '',
    dealId: r.dealId || '',
    companyId: r.companyId || '',
  }))
}

function mapSmsSends(rows: Record<string, string>[]): SmsSend[] {
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollmentId || '',
    sequenceId: r.sequenceId || '',
    stepId: r.stepId || '',
    contactId: r.contactId || '',
    to: r.to || '',
    from: r.from || '',
    body: r.body || '',
    twilioSid: r.twilioSid || '',
    status: (r.status as SmsSend['status']) || 'sent',
    errorMessage: r.errorMessage || '',
    sentAt: r.sentAt || '',
    deliveredAt: r.deliveredAt || '',
    repliedAt: r.repliedAt || '',
  }))
}

function mapLeads(rows: Record<string, string>[]): Lead[] {
  return rows.map((r) => ({
    id: r.id,
    source: r.source || 'manual',
    externalId: r.externalId || '',
    firstName: r.firstName || '',
    lastName: r.lastName || '',
    email: r.email || '',
    linkedinUrl: r.linkedinUrl || '',
    headline: r.headline || '',
    title: r.title || '',
    companyName: r.companyName || '',
    companyLinkedinUrl: r.companyLinkedinUrl || '',
    companyDomain: r.companyDomain || '',
    companyIndustry: r.companyIndustry || '',
    companySize: r.companySize || '',
    location: r.location || '',
    engagementSignals: r.engagementSignals || '[]',
    temperature: (r.temperature as Lead['temperature']) || 'cold',
    score: toNum(r.score),
    status: (r.status as Lead['status']) || 'new',
    notes: r.notes || '',
    convertedContactId: r.convertedContactId || '',
    createdAt: r.createdAt || '',
    lastSignalAt: r.lastSignalAt || '',
  }))
}

// ---------- Entry point ----------

export async function loadAll(): Promise<SheetData> {
  const [
    companiesRows,
    contactsRows,
    dealsRows,
    tasksRows,
    activityRows,
    invoicesRows,
    cashflowRows,
    execRows,
    seqRows,
    stepRows,
    tmplRows,
    enrollRows,
    sendRows,
    bookingLinkRows,
    bookingRows,
    noteRows,
    activityLogRows,
    leadRows,
    smsSendRows,
    proposalRows,
  ] = await Promise.all([
    fetchTab('Companies'),
    fetchTab('Contacts'),
    fetchTab('Deals'),
    fetchTab('Tasks'),
    fetchTab('Activity').catch(() => []),
    fetchTab('Invoices').catch(() => []),
    fetchTab('Cashflow').catch(() => []),
    fetchTab('ExecUpdates').catch(() => []),
    fetchTab('Sequences').catch(() => []),
    fetchTab('SequenceSteps').catch(() => []),
    fetchTab('EmailTemplates').catch(() => []),
    fetchTab('Enrollments').catch(() => []),
    fetchTab('EmailSends').catch(() => []),
    fetchTab('BookingLinks').catch(() => []),
    fetchTab('Bookings').catch(() => []),
    fetchTab('Notes').catch(() => []),
    fetchTab('ActivityLogs').catch(() => []),
    fetchTab('Leads').catch(() => []),
    fetchTab('SmsSends').catch(() => []),
    fetchTab('Proposals').catch(() => []),
  ])

  return {
    companies: mapCompanies(companiesRows),
    contacts: mapContacts(contactsRows),
    deals: mapDeals(dealsRows),
    tasks: mapTasks(tasksRows),
    activity: mapActivity(activityRows),
    invoices: mapInvoices(invoicesRows),
    cashflow: mapCashflow(cashflowRows),
    execUpdates: mapExecUpdates(execRows),
    sequences: mapSequences(seqRows),
    sequenceSteps: mapSequenceSteps(stepRows),
    emailTemplates: mapEmailTemplates(tmplRows),
    enrollments: mapEnrollments(enrollRows),
    emailSends: mapEmailSends(sendRows),
    bookingLinks: mapBookingLinks(bookingLinkRows),
    bookings: mapBookings(bookingRows),
    notes: mapNotes(noteRows),
    activityLogs: mapActivityLogs(activityLogRows),
    leads: mapLeads(leadRows),
    smsSends: mapSmsSends(smsSendRows),
    proposals: mapProposals(proposalRows),
    fetchedAt: new Date().toISOString(),
  }
}
