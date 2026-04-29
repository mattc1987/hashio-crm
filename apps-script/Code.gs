/**
 * Hashio CRM — Apps Script backend
 * =================================
 *
 * Tiny web app that lets the Hashio CRM frontend read & write the backing
 * Google Sheet. Deploy as a web app (see SETUP.md). Secured by a shared
 * secret (API key) that you set in Script Properties.
 *
 * Endpoints (all GET for JSONP/CORS simplicity — writes send a `payload`
 * query param containing JSON):
 *   ?action=ping                          → { ok: true, time, sheet }
 *   ?action=read&tab=Deals                → { ok: true, data: [ {...}, ... ] }
 *   ?action=readAll                       → { ok: true, data: { deals: [...], companies: [...], ... } }
 *   ?action=write&payload={...}           → create / update / delete a row
 *
 * Write payload shape:
 *   { entity: 'companies'|'contacts'|'deals'|'tasks'|'invoices'|'cashflow'|'execUpdates',
 *     op:     'create'|'update'|'delete',
 *     payload: {...row fields, including `id` for update/delete} }
 *
 * Security: every request must include `key=<secret>` matching the
 * `API_KEY` script property. Unset = reject everything.
 */

/** --------------------------------------------------------------------- */
/**  Config                                                                */
/** --------------------------------------------------------------------- */

// Leave blank to use the active sheet the script is bound to. Or set the
// sheet ID explicitly via Script Properties → SHEET_ID.
function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('API_KEY') || '';
}

/** Map short entity name → sheet tab name. */
const TABS = {
  companies:      'Companies',
  contacts:       'Contacts',
  deals:          'Deals',
  tasks:          'Tasks',
  activity:       'Activity',
  invoices:       'Invoices',
  cashflow:       'Cashflow',
  execUpdates:    'ExecUpdates',
  sequences:      'Sequences',
  sequenceSteps:  'SequenceSteps',
  emailTemplates: 'EmailTemplates',
  enrollments:    'Enrollments',
  emailSends:     'EmailSends',
  bookingLinks:   'BookingLinks',
  bookings:       'Bookings',
  notes:          'Notes',
  activityLogs:   'ActivityLogs',
  leads:          'Leads',
  smsSends:       'SmsSends',
  proposals:      'Proposals',
};

/** Canonical header set per entity. Used by ensureHeaders / ensureTabs to
 *  self-heal a Sheet that's missing columns or tabs. Any field the app
 *  tries to write that's not listed here still gets auto-appended. */
const KNOWN_HEADERS_ = {
  companies:     ['id','name','industry','licenseCount','size','website','address','notes','createdAt','updatedAt'],
  contacts:      ['id','firstName','lastName','email','phone','title','companyId','status','state','linkedinUrl','tags','createdAt'],
  deals:         ['id','title','contactId','companyId','value','stage','probability','closeDate','mrr','billingCycle','billingMonth','contractStart','contractEnd','mrrStatus','notes','createdAt','updatedAt'],
  tasks:         ['id','title','dueDate','priority','contactId','dealId','notes','status','createdAt','updatedAt'],
  activity:      ['id','type','text','icon','createdAt'],
  invoices:      ['id','companyId','dealId','period','sent','sentDate','createdAt'],
  cashflow:      ['id','period','expenses'],
  execUpdates:   ['id','period','newCustomers','savedMRR','prevMRR','demosBooked','wins','plans','losses','problems'],
  sequences:     ['id','name','description','status','createdAt','updatedAt'],
  sequenceSteps: ['id','sequenceId','order','type','config','label'],
  emailTemplates:['id','name','subject','body','category','createdAt','updatedAt'],
  enrollments:   ['id','sequenceId','contactId','dealId','currentStepIndex','status','enrolledAt','lastFiredAt','nextFireAt','notes'],
  emailSends:    ['id','enrollmentId','sequenceId','stepId','contactId','to','subject','bodyPreview','threadId','messageId','sentAt','openedAt','repliedAt','clickedAt','status','errorMessage'],
  bookingLinks:  ['id','slug','name','description','durationMinutes','workingDays','startHour','endHour','timezone','bufferMinutes','minAdvanceHours','maxAdvanceDays','ownerEmail','ownerName','status','createdAt','updatedAt'],
  bookings:      ['id','bookingLinkId','slug','attendeeName','attendeeEmail','attendeeNotes','slotStart','slotEnd','eventId','status','createdAt'],
  notes:         ['id','entityType','entityId','body','author','createdAt','updatedAt'],
  activityLogs:  ['id','entityType','entityId','kind','outcome','body','durationMinutes','occurredAt','createdAt','author'],
  leads:         ['id','source','externalId','firstName','lastName','email','linkedinUrl','headline','title','companyName','companyLinkedinUrl','companyDomain','companyIndustry','companySize','location','engagementSignals','temperature','score','status','notes','convertedContactId','createdAt','lastSignalAt'],
  smsSends:      ['id','enrollmentId','sequenceId','stepId','contactId','to','from','body','twilioSid','status','errorMessage','sentAt','deliveredAt','repliedAt'],
  proposals:     ['id','ruleId','category','priority','confidence','risk','title','reason','expectedOutcome','actionKind','actionPayload','status','createdAt','resolvedAt','resolvedBy','executedAt','executionResult','contactIds','dealId','companyId'],
};

/** Add any missing fields as new header columns on the given entity's tab.
 *  Safe to call repeatedly. Returns the resulting header array. */
function ensureHeaders_(entity, fields) {
  const tabName = TABS[entity];
  if (!tabName) throw new Error('Unknown entity: ' + entity);
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    const seed = (KNOWN_HEADERS_[entity] || []).concat(fields || []);
    sheet.appendRow(Array.from(new Set(seed)));
    return sheet.getDataRange().getValues()[0];
  }
  const lastCol = sheet.getLastColumn() || 1;
  const row = sheet.getRange(1, 1, 1, Math.max(lastCol, 1)).getValues()[0].map(String);
  const have = new Set(row.filter(Boolean));
  const toAdd = (fields || []).filter(function (f) { return f && !have.has(f); });
  if (toAdd.length) {
    sheet.getRange(1, row.length + 1, 1, toAdd.length).setValues([toAdd]);
  }
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
}

/** Create any missing tabs from KNOWN_HEADERS_. */
function ensureTabs_() {
  const ss = getSpreadsheet_();
  const created = [];
  Object.keys(KNOWN_HEADERS_).forEach(function (entity) {
    const tabName = TABS[entity];
    if (!ss.getSheetByName(tabName)) {
      const sh = ss.insertSheet(tabName);
      sh.appendRow(KNOWN_HEADERS_[entity]);
      created.push(tabName);
    } else {
      // Top up with any known headers that aren't there yet.
      ensureHeaders_(entity, KNOWN_HEADERS_[entity]);
    }
  });
  return { created: created };
}

/** --------------------------------------------------------------------- */
/**  HTTP entry points                                                     */
/** --------------------------------------------------------------------- */

function doGet(e) {
  return handle_(e);
}
function doPost(e) {
  return handle_(e);
}

function handle_(e) {
  const params = (e && e.parameter) || {};
  const out = { ok: false };

  // Public actions — no API key required (booking pages are inherently public,
  // and lead-ingest is a webhook from third parties that don't have our key).
  const publicActions = {
    getAvailability: 1, createBooking: 1, trackOpen: 1, trackClick: 1,
    ingestLead: 1,
  };
  if (!publicActions[params.action]) {
    if (!getApiKey_() || params.key !== getApiKey_()) {
      out.error = 'Unauthorized';
      return respond_(out, params);
    }
  }

  try {
    switch (params.action) {
      case 'ping':
        out.ok = true;
        out.time = new Date().toISOString();
        out.sheet = getSpreadsheet_().getName();
        break;

      case 'read':
        out.ok = true;
        out.data = readTab_(params.tab);
        break;

      case 'readAll':
        out.ok = true;
        out.data = readAll_();
        break;

      case 'write': {
        const payload = safeJson_(params.payload);
        if (!payload) throw new Error('Missing or invalid payload');
        const result = writeRow_(payload.entity, payload.op, payload.payload || {});
        out.ok = true;
        out.data = result;
        break;
      }

      case 'ensureHeaders': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = ensureHeaders_(payload.entity, payload.fields || []);
        break;
      }

      case 'ensureTabs': {
        out.ok = true;
        out.data = ensureTabs_();
        break;
      }

      case 'runScheduler': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = runScheduler_(payload.maxSteps || 20);
        break;
      }

      case 'checkReplies': {
        out.ok = true;
        out.data = checkReplies_();
        break;
      }

      case 'trackOpen':
        return respondTrackingPixel_(params.s);

      case 'trackClick':
        return respondTrackClick_(params.s, params.u);

      case 'getAvailability': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = getAvailability_(payload.slug, payload.fromDate, payload.toDate);
        break;
      }

      case 'setTwilioConfig': {
        // Save Twilio credentials to Script Properties. Auth-required.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = setTwilioConfig_(payload);
        break;
      }

      case 'getTwilioStatus': {
        out.ok = true;
        out.data = getTwilioStatus_();
        break;
      }

      case 'sendTestSms': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = sendTestSms_(payload.to, payload.body);
        break;
      }

      case 'ingestLead': {
        // Public lead-ingest webhook. Accepts lead data from any source
        // (Teamfluence, Apollo, Clay, Zapier, n8n, custom scripts).
        // De-dupes on (source, externalId) — repeated webhooks just append
        // engagement signals instead of creating duplicate rows.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = ingestLead_(payload);
        break;
      }

      case 'createBooking': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = createBooking_(payload);
        break;
      }

      case 'setAnthropicConfig': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = setAnthropicConfig_(payload);
        break;
      }

      case 'getAnthropicStatus': {
        out.ok = true;
        out.data = getAnthropicStatus_();
        break;
      }

      case 'draftMessage': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = draftMessage_(payload);
        break;
      }

      case 'narrativeReason': {
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = narrativeReason_(payload);
        break;
      }

      case 'sendBdrEmail': {
        // Real email send via Gmail. Used by the BDR executor when an
        // approved sensitive proposal carries an AI-drafted message.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = sendBdrEmail_(payload);
        break;
      }

      case 'checkReplies': {
        // Manually trigger reply detection — scans recent EmailSends with a
        // threadId, checks Gmail for new messages, sets repliedAt.
        out.ok = true;
        out.data = checkReplies_();
        break;
      }

      case 'installReplyTrigger': {
        // Install a 5-minute time-driven trigger so checkReplies runs on its
        // own without manual clicks. Idempotent — safely re-runs.
        out.ok = true;
        out.data = installReplyTrigger_();
        break;
      }

      case 'aiSuggestNextMove': {
        // Generic AI-BDR endpoint. Pre-built CRM context comes from the client
        // (so we don't have to walk the full Sheet here) — we just forward
        // it to Claude with the BDR-strategist prompt.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiSuggestNextMove_(payload);
        break;
      }

      case 'aiDashboardBriefing': {
        // Dashboard-level strategist: reads a compact CRM digest, returns a
        // greeting + narrative + 3-7 priority cards Matt can click into.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiDashboardBriefing_(payload);
        break;
      }

      case 'aiSuggestTargets': {
        // Lead generation: looks at Matt's existing customers + ICP, proposes
        // lookalike target accounts (companies + roles).
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiSuggestTargets_(payload);
        break;
      }

      case 'aiEnrichLead': {
        // Fill missing lead fields (industry, size, likely role, LinkedIn search
        // hint) using whatever the lead already has + Claude's domain knowledge.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiEnrichLead_(payload);
        break;
      }

      case 'aiStrategistProposals': {
        // Free-form proposals beyond the rules engine — Claude reads a digest
        // and returns 3-7 ad-hoc actions the rules might miss (creative plays,
        // hygiene moves, strategic pivots).
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiStrategistProposals_(payload);
        break;
      }

      default:
        throw new Error('Unknown action: ' + params.action);
    }
  } catch (err) {
    out.error = String(err && err.message || err);
  }

  return respond_(out, params);
}

function respond_(payload, params) {
  const body = JSON.stringify(payload);
  // JSONP support for future static-file deployment (no CORS).
  if (params.callback) {
    return ContentService.createTextOutput(
      params.callback + '(' + body + ');'
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

/** --------------------------------------------------------------------- */
/**  Read helpers                                                          */
/** --------------------------------------------------------------------- */

function readTab_(name) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Tab not found: ' + name);
  const values = sheet.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(String);
  const rows = [];
  for (let r = 1; r < values.length; r++) {
    const row = {};
    let hasId = false;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (!key) continue;
      row[key] = values[r][c] === null || values[r][c] === undefined ? '' : values[r][c];
      if (key === 'id' && row[key]) hasId = true;
    }
    if (hasId) rows.push(row);
  }
  return rows;
}

function readAll_() {
  const out = {};
  Object.keys(TABS).forEach(function (shortName) {
    try {
      out[shortName] = readTab_(TABS[shortName]);
    } catch (err) {
      out[shortName] = [];
    }
  });
  out.fetchedAt = new Date().toISOString();
  return out;
}

/** --------------------------------------------------------------------- */
/**  Write helpers                                                         */
/** --------------------------------------------------------------------- */

function writeRow_(entity, op, row) {
  const tabName = TABS[entity];
  if (!tabName) throw new Error('Unknown entity: ' + entity);
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(tabName);

  // Auto-create the tab if it's missing, seeding it with the entity's known
  // header set plus any fields present on this incoming payload.
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    const seed = KNOWN_HEADERS_[entity] || [];
    const withRow = Array.from(new Set(seed.concat(['id', 'createdAt', 'updatedAt']).concat(Object.keys(row))));
    sheet.appendRow(withRow);
  }

  // Ensure every field on the incoming row exists as a header column.
  // New fields get auto-appended to row 1 — no schema migrations ever.
  ensureHeaders_(entity, Object.keys(row));

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf('id');
  if (idCol < 0) throw new Error('Tab ' + tabName + ' has no `id` column');

  const now = new Date().toISOString();

  if (op === 'create') {
    if (!row.id) row.id = newId_(entity);
    if (headers.indexOf('createdAt') >= 0 && !row.createdAt) row.createdAt = now;
    if (headers.indexOf('updatedAt') >= 0) row.updatedAt = now;
    const rowValues = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    sheet.appendRow(rowValues);
    logActivity_('create', entity, row);
    return row;
  }

  if (op === 'update') {
    if (!row.id) throw new Error('update requires an id');
    const rowIdx = findRowIndex_(data, idCol, row.id);
    if (rowIdx < 0) throw new Error('Row not found: ' + row.id);
    if (headers.indexOf('updatedAt') >= 0) row.updatedAt = now;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (row[key] !== undefined) {
        sheet.getRange(rowIdx + 1, c + 1).setValue(row[key]);
      }
    }
    logActivity_('update', entity, row);
    return row;
  }

  if (op === 'delete') {
    if (!row.id) throw new Error('delete requires an id');
    const rowIdx = findRowIndex_(data, idCol, row.id);
    if (rowIdx < 0) throw new Error('Row not found: ' + row.id);
    sheet.deleteRow(rowIdx + 1);
    logActivity_('delete', entity, { id: row.id });
    return { id: row.id, deleted: true };
  }

  throw new Error('Unknown op: ' + op);
}

function findRowIndex_(data, idCol, id) {
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(id)) return r;
  }
  return -1;
}

function newId_(entity) {
  const prefix = {
    companies: 'co', contacts: 'ct', deals: 'dl',
    tasks: 'tk', invoices: 'in', activity: 'act',
    cashflow: 'cf', execUpdates: 'ex',
  }[entity] || 'x';
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
}

function logActivity_(op, entity, row) {
  try {
    const sheet = getSpreadsheet_().getSheetByName('Activity');
    if (!sheet) return;
    const headers = sheet.getDataRange().getValues()[0].map(String);
    const icon = { create: '📌', update: '✏️', delete: '🗑️' }[op] || '•';
    const title = row.title || row.name || [row.firstName, row.lastName].filter(Boolean).join(' ') || row.id;
    const payload = {
      id: 'act' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
      type: entity,
      text: op + ': ' + (title || ''),
      icon: icon,
      createdAt: new Date().toISOString(),
    };
    const rowValues = headers.map(function (h) { return payload[h] === undefined ? '' : payload[h]; });
    sheet.appendRow(rowValues);
  } catch (err) {
    // Silently ignore — activity log is best-effort.
  }
}

/** --------------------------------------------------------------------- */
/**  Utilities                                                             */
/** --------------------------------------------------------------------- */

function safeJson_(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

/** --------------------------------------------------------------------- */
/**  Setup helper — run once from the Apps Script editor                   */
/** --------------------------------------------------------------------- */

/**
 * Generates a fresh API key and stores it in Script Properties.
 * Run this once from the Apps Script editor (Run > setupApiKey), then copy
 * the logged value into your .env as VITE_APPS_SCRIPT_KEY.
 */
function setupApiKey() {
  const key = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  Logger.log('API_KEY set. Copy this into your .env as VITE_APPS_SCRIPT_KEY:\n\n' + key);
}

/**
 * Quick test — run from the Apps Script editor to check the tabs are wired up.
 */
function smokeTest() {
  const data = readAll_();
  Logger.log(
    'Companies: ' + data.companies.length +
    ' · Contacts: ' + data.contacts.length +
    ' · Deals: ' + data.deals.length +
    ' · Tasks: ' + data.tasks.length
  );
}

/**
 * One-shot: triggers Google's authorization prompt for Calendar access.
 * Run this once after pasting the latest Code.gs. After you approve, the
 * scheduler can read availability + create events on your calendar.
 */
function setupCalendarAuth() {
  const cal = CalendarApp.getDefaultCalendar();
  const me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  // Look at one event to actually exercise the read scope.
  const events = cal.getEventsForDay(new Date());
  Logger.log(
    'Calendar authorized for: ' + me +
    ' · Calendar: ' + cal.getName() +
    ' · Events today: ' + events.length
  );
}


/* ========================================================================
   Email sequences — sender, scheduler, tracking, reply detection
   ======================================================================== */

/**
 * Install time-based triggers. RUN THIS ONCE after pasting this script.
 * Creates:
 *   - runScheduler every 5 minutes  (advances enrollments, sends emails)
 *   - checkReplies  every 15 minutes (marks enrollments as stopped-reply)
 */
function installSequenceTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'runScheduler' || fn === 'checkReplies') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runScheduler').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(15).create();
  Logger.log('Installed: runScheduler every 5m, checkReplies every 15m.');
}

function uninstallSequenceTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    const fn = t.getHandlerFunction();
    if (fn === 'runScheduler' || fn === 'checkReplies') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Uninstalled all sequence triggers.');
}

/** Can be invoked manually or via time-trigger. */
function runScheduler(e) {
  try {
    const summary = runScheduler_(50);
    Logger.log('Scheduler: ' + JSON.stringify(summary));
  } catch (err) {
    Logger.log('Scheduler error: ' + (err && err.message));
  }
}

function runScheduler_(maxSteps) {
  const ss = getSpreadsheet_();
  const enrollmentsSheet = ss.getSheetByName('Enrollments');
  if (!enrollmentsSheet) return { processed: 0, skipped: 'no-enrollments-tab' };
  const data = enrollmentsSheet.getDataRange().getValues();
  if (data.length < 2) return { processed: 0 };
  const headers = data[0].map(String);

  const now = new Date();
  const nowIso = now.toISOString();
  let processed = 0;
  const errors = [];

  for (let r = 1; r < data.length; r++) {
    if (processed >= maxSteps) break;
    const row = rowToObj_(headers, data[r]);
    if (row.status !== 'active') continue;
    if (row.nextFireAt && new Date(row.nextFireAt) > now) continue;

    try {
      const result = advanceEnrollment_(row);
      applyEnrollmentUpdate_(enrollmentsSheet, r + 1, headers, result);
      processed++;
    } catch (err) {
      errors.push({ id: row.id, error: String(err && err.message) });
      applyEnrollmentUpdate_(enrollmentsSheet, r + 1, headers, {
        status: 'stopped-error',
        notes: (row.notes ? row.notes + ' | ' : '') + 'ERR: ' + (err && err.message),
        lastFiredAt: nowIso,
      });
    }
  }

  return { processed: processed, errors: errors };
}

function advanceEnrollment_(enrollment) {
  const ss = getSpreadsheet_();
  const stepsSheet = ss.getSheetByName('SequenceSteps');
  const sequenceSheet = ss.getSheetByName('Sequences');
  if (!stepsSheet || !sequenceSheet) throw new Error('Missing Sequences / SequenceSteps tabs');

  // Check sequence is active
  const seq = findById_(sequenceSheet, enrollment.sequenceId);
  if (!seq) throw new Error('Sequence not found: ' + enrollment.sequenceId);
  if (seq.status !== 'active') {
    return { status: 'paused', notes: 'Sequence is ' + seq.status, lastFiredAt: new Date().toISOString() };
  }

  // Fetch all steps for this sequence, ordered
  const steps = findAllWhere_(stepsSheet, 'sequenceId', enrollment.sequenceId)
    .sort(function (a, b) { return Number(a.order) - Number(b.order); });
  if (!steps.length) return { status: 'completed', lastFiredAt: new Date().toISOString() };

  const stepIdx = Number(enrollment.currentStepIndex) || 0;
  if (stepIdx >= steps.length) {
    return { status: 'completed', lastFiredAt: new Date().toISOString() };
  }

  const step = steps[stepIdx];
  const config = safeJson_(step.config) || {};
  const now = new Date();

  // Fetch contact + deal + company for merge tags
  const contact = findById_(ss.getSheetByName('Contacts'), enrollment.contactId);
  if (!contact) throw new Error('Contact not found: ' + enrollment.contactId);
  const deal = enrollment.dealId ? findById_(ss.getSheetByName('Deals'), enrollment.dealId) : null;
  const company = contact.companyId ? findById_(ss.getSheetByName('Companies'), contact.companyId) : null;
  const ctx = { contact: contact, deal: deal, company: company };

  switch (step.type) {
    case 'sms': {
      if (!contact.phone) throw new Error('Contact has no phone: ' + contact.id);
      const smsBody = resolveMergeTags_(config.body, ctx);
      const sendResult = sendSequenceSms_({
        enrollmentId: enrollment.id,
        sequenceId: enrollment.sequenceId,
        stepId: step.id,
        contactId: contact.id,
        to: contact.phone,
        body: smsBody,
      });
      return {
        currentStepIndex: stepIdx + 1,
        lastFiredAt: now.toISOString(),
        nextFireAt: now.toISOString(),
        status: stepIdx + 1 >= steps.length ? 'completed' : 'active',
        notes: 'Sent SMS: ' + (sendResult.sid || smsBody.slice(0, 40)),
      };
    }

    case 'email': {
      if (!contact.email) throw new Error('Contact has no email: ' + contact.id);
      const subject = resolveMergeTags_(config.subject, ctx);
      const body = resolveMergeTags_(config.body, ctx);
      const sendResult = sendSequenceEmail_({
        enrollmentId: enrollment.id,
        sequenceId: enrollment.sequenceId,
        stepId: step.id,
        contactId: contact.id,
        to: contact.email,
        subject: subject,
        body: body,
        trackOpens: !!config.trackOpens,
      });
      // Move to next step
      return {
        currentStepIndex: stepIdx + 1,
        lastFiredAt: now.toISOString(),
        nextFireAt: now.toISOString(),
        status: stepIdx + 1 >= steps.length ? 'completed' : 'active',
        notes: 'Sent: ' + sendResult.subject,
      };
    }

    case 'wait': {
      const amount = Number(config.amount) || 0;
      const ms = waitUnitToMs_(config.unit) * amount;
      const next = new Date(now.getTime() + ms);
      return {
        currentStepIndex: stepIdx + 1,
        lastFiredAt: now.toISOString(),
        nextFireAt: next.toISOString(),
        status: 'active',
        notes: 'Waiting ' + amount + ' ' + (config.unit || 'days'),
      };
    }

    case 'branch': {
      const result = evaluateBranch_(enrollment, config, ctx);
      let nextIdx;
      if (result.matched) {
        nextIdx = (config.trueNext === undefined || config.trueNext === -1) ? stepIdx + 1 : Number(config.trueNext);
      } else {
        nextIdx = (config.falseNext === undefined || config.falseNext === -1) ? stepIdx + 1 : Number(config.falseNext);
      }
      if (nextIdx === -2) {
        return { status: 'completed', lastFiredAt: now.toISOString(), notes: 'Branch → end' };
      }
      return {
        currentStepIndex: nextIdx,
        lastFiredAt: now.toISOString(),
        nextFireAt: now.toISOString(),
        status: nextIdx >= steps.length ? 'completed' : 'active',
        notes: 'Branch: ' + (result.matched ? 'TRUE' : 'FALSE') + ' → step ' + (nextIdx + 1),
      };
    }

    case 'action': {
      applyAction_(config, enrollment, ctx);
      return {
        currentStepIndex: stepIdx + 1,
        lastFiredAt: now.toISOString(),
        nextFireAt: now.toISOString(),
        status: stepIdx + 1 >= steps.length ? 'completed' : 'active',
        notes: 'Action: ' + (config.kind || 'unknown'),
      };
    }

    default:
      throw new Error('Unknown step type: ' + step.type);
  }
}

/* ---------- Twilio configuration ---------- */
/* Lets the CRM Settings page configure Twilio without touching the
 * Apps Script editor. Credentials live in Script Properties — same as
 * before — but now you can write/read them via the API.
 *
 * setTwilioConfig({sid, token, from})    → stores all three
 * getTwilioStatus()                       → { configured, sid (last 4), from, balance, accountSid }
 * sendTestSms(to, body)                   → sends a one-off test message
 */

function setTwilioConfig_(payload) {
  const props = PropertiesService.getScriptProperties();
  if (payload.sid)   props.setProperty('TWILIO_SID',   String(payload.sid).trim());
  if (payload.token) props.setProperty('TWILIO_TOKEN', String(payload.token).trim());
  if (payload.from)  props.setProperty('TWILIO_FROM',  String(payload.from).trim());

  // After saving, return fresh status for the UI to display
  return getTwilioStatus_();
}

function getTwilioStatus_() {
  const props = PropertiesService.getScriptProperties();
  const sid = props.getProperty('TWILIO_SID') || '';
  const token = props.getProperty('TWILIO_TOKEN') || '';
  const from = props.getProperty('TWILIO_FROM') || '';
  const configured = !!(sid && token && from);

  let balance = '';
  let connectionOk = false;
  let connectionError = '';
  let accountFriendlyName = '';

  if (configured) {
    try {
      const url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Balance.json';
      const res = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) {
        const json = JSON.parse(res.getContentText());
        balance = (json.balance ? '$' + json.balance : '') + (json.currency ? ' ' + json.currency : '');
        connectionOk = true;
      } else {
        connectionError = 'HTTP ' + res.getResponseCode();
      }

      // Also fetch account info for friendly name
      const accUrl = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '.json';
      const accRes = UrlFetchApp.fetch(accUrl, {
        method: 'get',
        headers: { Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token) },
        muteHttpExceptions: true,
      });
      if (accRes.getResponseCode() === 200) {
        const accJson = JSON.parse(accRes.getContentText());
        accountFriendlyName = accJson.friendly_name || '';
      }
    } catch (err) {
      connectionError = String(err && err.message || err);
    }
  }

  return {
    configured: configured,
    sidMasked: sid ? '••••' + sid.slice(-4) : '',
    sidFull: configured ? sid : '',
    from: from,
    balance: balance,
    accountFriendlyName: accountFriendlyName,
    connectionOk: connectionOk,
    connectionError: connectionError,
  };
}

function sendTestSms_(to, body) {
  if (!to) throw new Error('Missing "to" phone number');
  const finalBody = body || 'Test from your Hashio CRM — Twilio is wired up. 🎉';

  // Reuse the sequence-send infra so it gets logged the same way
  return sendSequenceSms_({
    enrollmentId: '',
    sequenceId: '',
    stepId: '',
    contactId: '',
    to: to,
    body: finalBody,
  });
}


/* ---------- Anthropic (Claude) proxy ---------- */
/* Server-side proxy so the API key never ships to the browser. The CRM
 * Settings page calls setAnthropicConfig({apiKey}) once; thereafter the
 * BDR can call draftMessage / narrativeReason and we forward to Claude
 * with the stored key.
 */

const ANTHROPIC_DEFAULT_MODEL_ = 'claude-sonnet-4-5-20250929';
const ANTHROPIC_API_URL_ = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION_ = '2023-06-01';

function setAnthropicConfig_(payload) {
  const props = PropertiesService.getScriptProperties();
  if (payload.apiKey) props.setProperty('ANTHROPIC_API_KEY', String(payload.apiKey).trim());
  if (payload.model)  props.setProperty('ANTHROPIC_MODEL',   String(payload.model).trim());
  return getAnthropicStatus_();
}

function getAnthropicStatus_() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('ANTHROPIC_API_KEY') || '';
  const model = props.getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  const configured = !!key;

  let connectionOk = false;
  let connectionError = '';
  let sampleResponse = '';

  if (configured) {
    try {
      const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_API_VERSION_,
        },
        payload: JSON.stringify({
          model: model,
          max_tokens: 32,
          messages: [{ role: 'user', content: 'Reply with the word "ok" only.' }],
        }),
        muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      if (code === 200) {
        const json = JSON.parse(res.getContentText());
        connectionOk = true;
        sampleResponse = (json.content && json.content[0] && json.content[0].text) || '';
      } else {
        connectionError = 'HTTP ' + code + ': ' + res.getContentText().slice(0, 200);
      }
    } catch (err) {
      connectionError = String(err && err.message || err);
    }
  }

  return {
    configured: configured,
    keyMasked: key ? '••••' + key.slice(-6) : '',
    model: model,
    connectionOk: connectionOk,
    connectionError: connectionError,
    sampleResponse: sampleResponse,
  };
}

/**
 * Calls Claude with a structured prompt for drafting an outbound message.
 * Inputs: { kind: 'email'|'sms', context: {...}, instruction?: string }
 * Output: { subject?: string, body: string, model: string }
 */
function draftMessage_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured. Open Settings to add your API key.');

  const kind = payload.kind || 'email';
  const ctx = payload.context || {};
  const instruction = payload.instruction || '';

  const systemPrompt =
    'You are Matt Campbell\'s sales assistant at Hashio Inc. — a B2B SaaS that helps licensed agricultural producers ' +
    '(specifically cannabis cultivators) run their operations. Hashio replaces spreadsheets with a single dashboard ' +
    'covering compliance, scheduling, yield, and cost-per-pound tracking. Matt is the founder and writes every email himself.\n\n' +
    'Voice: warm, direct, low-key. Short paragraphs. No marketing fluff. No exclamation points unless something genuinely warrants ' +
    'one. Never use the word "synergy", "leverage", "circle back", or any bro-sales phrasing. Never start with "I hope you\'re well".\n\n' +
    (kind === 'sms'
      ? 'You are drafting an SMS — must be under 320 chars, ideally under 160. Plain text only.\n'
      : 'You are drafting an email — short subject line (under 60 chars), 2-4 short paragraphs body, signed "— Matt".\n') +
    'CRITICAL — BOOKING LINKS:\n' +
    'If the context contains a "bookingLinks" array, those are Matt\'s real scheduling URLs. Paste the FULL URL VERBATIM.\n' +
    'NEVER write [booking link], [URL], <link>, {{link}}, or any placeholder — the message ships as-is to the prospect.\n' +
    'NEVER invent calendly.com, hubspot.com, savvycal.com, etc — those will 404. If bookingLinks is empty, write "I\'ll send a few times that work" instead.\n\n' +
    'Return ONLY a JSON object. No markdown, no preamble. Schema:\n' +
    (kind === 'sms'
      ? '{"body": "..."}'
      : '{"subject": "...", "body": "..."}');

  const userMessage = buildDraftPrompt_(ctx, instruction);

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_API_VERSION_,
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';

  // Try to extract JSON. Claude usually returns clean JSON with our system prompt,
  // but be defensive in case it adds a code-fence.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Last resort: return raw text as body
    parsed = { body: text };
  }
  return {
    subject: parsed.subject || '',
    body: parsed.body || '',
    model: model,
    raw: text,
  };
}

function buildDraftPrompt_(ctx, instruction) {
  const lines = [];
  lines.push('Draft a message to this prospect.\n');

  if (ctx.contact) {
    lines.push('CONTACT:');
    lines.push('  Name: ' + (ctx.contact.firstName || '') + ' ' + (ctx.contact.lastName || ''));
    if (ctx.contact.title)   lines.push('  Title: ' + ctx.contact.title);
    if (ctx.contact.companyName) lines.push('  Company: ' + ctx.contact.companyName);
    if (ctx.contact.email)   lines.push('  Email: ' + ctx.contact.email);
    if (ctx.contact.linkedinUrl) lines.push('  LinkedIn: ' + ctx.contact.linkedinUrl);
    lines.push('');
  }

  if (ctx.deal) {
    lines.push('DEAL:');
    lines.push('  Title: ' + (ctx.deal.title || ''));
    if (ctx.deal.stage) lines.push('  Stage: ' + ctx.deal.stage);
    if (ctx.deal.value) lines.push('  Value: $' + ctx.deal.value);
    lines.push('');
  }

  if (ctx.signal) {
    lines.push('TRIGGERING SIGNAL: ' + ctx.signal);
    lines.push('');
  }

  if (ctx.recentActivity && ctx.recentActivity.length) {
    lines.push('RECENT TOUCHES (newest first):');
    ctx.recentActivity.slice(0, 5).forEach(function (a) {
      lines.push('  - ' + a);
    });
    lines.push('');
  }

  if (ctx.priorEmail) {
    lines.push('PRIOR EMAIL THREAD (their last reply / your last send):');
    lines.push('  Subject: ' + (ctx.priorEmail.subject || ''));
    lines.push('  Body excerpt: ' + (ctx.priorEmail.body || '').slice(0, 400));
    lines.push('');
  }

  if (Array.isArray(ctx.bookingLinks) && ctx.bookingLinks.length > 0) {
    lines.push('MATT\'S ACTIVE BOOKING LINKS (use these EXACT URLs if you propose a meeting — never invent calendly.com etc):');
    ctx.bookingLinks.forEach(function (b) {
      lines.push('  - ' + (b.name || b.slug) + ' (' + (b.durationMinutes || '?') + ' min): ' + b.url);
    });
    lines.push('');
  } else if (ctx.bookingLinks && Array.isArray(ctx.bookingLinks) && ctx.bookingLinks.length === 0) {
    lines.push('NO BOOKING LINKS AVAILABLE — if you suggest a meeting, write "I\'ll send a few times that work" instead of any URL.');
    lines.push('');
  }

  lines.push('GOAL: ' + (ctx.goal || 'Continue the conversation in a way that earns a reply.'));
  if (instruction) lines.push('\nADDITIONAL INSTRUCTION FROM MATT: ' + instruction);

  return lines.join('\n');
}

/**
 * Generates a 1-2 sentence narrative reason explaining WHY this proposal
 * matters. Used to upgrade the reason field on a proposal card.
 * Input: { proposalSummary: string, context: {...} }
 * Output: { narrative: string }
 */
function narrativeReason_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const systemPrompt =
    'You explain why a sales action matters, in 1-2 plain sentences. No marketing fluff, no hedging. ' +
    'Reference specific data points the user gave you. Reply with raw text — no JSON, no markdown.';

  const userMessage =
    'Proposal: ' + (payload.proposalSummary || '') + '\n\n' +
    'Context: ' + JSON.stringify(payload.context || {}, null, 2) + '\n\n' +
    'Explain why this is worth doing now (1-2 sentences).';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_API_VERSION_,
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  return { narrative: text.trim() };
}


/* ---------- AI BDR strategist — suggests next moves ---------- */
/* Generic endpoint the UI calls from any entity (task, contact, deal, lead).
 * Client builds the context (it has all the joined data already), we just
 * forward to Claude with a strategist prompt and a strict output schema.
 * Returns one or more concrete next-move actions Matt can approve.
 */
function aiSuggestNextMove_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured. Open Settings to add your API key.');

  const entityType = payload.entityType || 'unknown';
  const context    = payload.context    || {};
  const goal       = payload.goal       || '';

  const systemPrompt =
    'You are Matt Campbell\'s autonomous BDR (business development rep) at Hashio Inc. — a B2B SaaS that helps ' +
    'licensed agricultural producers (specifically cannabis cultivators) run operations: compliance, scheduling, ' +
    'yield, cost-per-pound. Matt is the founder. You drive the sales motion: prospecting, qualifying, scheduling ' +
    'demos, follow-ups. Matt only approves your daily plays.\n\n' +
    'Real BDR best practices you operate by:\n' +
    '- The "3 by 3" — reference 3 specific facts about the prospect/company before every cold touch.\n' +
    '- Personalization > volume. Always reference recent engagement signals (post they liked, link they clicked, role).\n' +
    '- Multi-channel orchestration: email + LinkedIn + phone. Adapt the channel to what\'s worked before.\n' +
    '- Average deal needs 7-12 touches. Don\'t give up early. Don\'t spam either.\n' +
    '- Discovery questions over feature pitches. Lead with their pain.\n' +
    '- After 8+ touches with zero engagement, recommend pausing and trying again in 90 days.\n\n' +
    'Voice: warm, direct, low-key. Short paragraphs. Never "synergy", "leverage", "circle back". Sign emails "— Matt".\n' +
    'SMS under 320 chars. Email subject under 60 chars. Email body 2-4 short paragraphs.\n\n' +
    'CRITICAL — BOOKING LINKS:\n' +
    'When you suggest a meeting / demo / call, the context contains a "bookingLinks" array with Matt\'s ACTUAL active scheduling URLs.\n' +
    '- ALWAYS paste the FULL URL VERBATIM. Example: "https://mattc1987.github.io/hashio-crm/book/15-min-intro"\n' +
    '- NEVER write a placeholder like [booking link], [URL], <link here>, {{link}}, etc. The message goes out as-is — placeholders ship to the prospect.\n' +
    '- Pick the booking link whose name/duration best matches the goal (e.g. "15-min intro" for cold outreach, "30-min demo" for qualified).\n' +
    '- NEVER invent calendly.com, hubspot.com, savvycal.com, or any other URL — those domains are not Matt\'s and will 404.\n' +
    '- If bookingLinks is empty, write "I\'ll send a few times that work" instead of any URL or placeholder.\n\n' +
    'EXTRA INSTRUCTION FROM MATT (if present in the user message under "ADDITIONAL INSTRUCTION"): treat that as authoritative — incorporate it.\n\n' +
    'YOU MUST RETURN STRICT JSON — no markdown, no preamble, no code fences. Schema:\n' +
    '{\n' +
    '  "narrative": "1-2 sentence read on the situation in plain English",\n' +
    '  "recommendedAction": "send-email" | "send-sms" | "create-task" | "log-activity" | "update-deal" | "create-deal" | "convert-lead" | "wait" | "pause",\n' +
    '  "reasoning": "Why this action, citing specific data points (1-2 sentences)",\n' +
    '  "draftedSubject": "subject if email, otherwise empty string",\n' +
    '  "draftedBody": "message body if email/sms, otherwise empty string",\n' +
    '  "taskTitle": "if recommendedAction is create-task, the task title",\n' +
    '  "taskNotes": "if create-task, what to do specifically",\n' +
    '  "alternativeActions": ["1-2 short strings describing other options Matt could take instead"],\n' +
    '  "confidence": 0-100\n' +
    '}\n';

  const extraInstruction = payload.instruction || '';
  const userMessage = 'GOAL: ' + (goal || 'Suggest the single best next move.') + '\n\n' +
    'ENTITY TYPE: ' + entityType + '\n\n' +
    'CONTEXT (JSON):\n' + JSON.stringify(context, null, 2) + '\n\n' +
    (extraInstruction ? 'ADDITIONAL INSTRUCTION FROM MATT — treat as authoritative:\n' + extraInstruction + '\n\n' : '') +
    'Return your JSON.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_API_VERSION_,
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  }
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parsed = {
      narrative: text.slice(0, 200),
      recommendedAction: 'create-task',
      reasoning: '(could not parse JSON — raw text returned)',
      draftedSubject: '',
      draftedBody: '',
      taskTitle: '',
      taskNotes: text,
      alternativeActions: [],
      confidence: 0,
    };
  }
  parsed.model = model;
  return parsed;
}


/* ---------- AI Dashboard briefing — daily strategist read ---------- */
function aiDashboardBriefing_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured. Open Settings to add your API key.');

  const digest = payload.digest || {};

  const systemPrompt =
    'You are Matt Campbell\'s autonomous BDR at Hashio Inc. (B2B SaaS for cannabis cultivators — compliance, scheduling, ' +
    'yield, cost-per-pound). Matt is the founder. Your job: read the CRM state every morning and brief Matt on what to focus on today.\n\n' +
    'You operate like a real BDR: 3 facts before every cold touch, personalize every outreach, multi-channel (email/LinkedIn/phone), ' +
    'persistence (7-12 touches per deal), discovery questions over feature pitches, BANT/MEDDIC qualifying.\n\n' +
    'Identify what genuinely needs attention. PRIORITIZE LIKE THIS:\n' +
    '1. Replies waiting (highest — opportunity-cost bleeds fast)\n' +
    '2. Hot/molten leads not yet contacted (pipeline-creation)\n' +
    '3. Today\'s bookings/meetings (preparation)\n' +
    '4. Stale high-value deals (advancement)\n' +
    '5. Pipeline-coverage gaps (when total pipeline is thin)\n' +
    '6. Strategic next moves\n\n' +
    'If pipeline is thin (e.g. <5 open deals or <2 hot leads), include a "find-leads" priority.\n' +
    'If everything is calm, suggest something proactive — research an account, draft a piece of content, etc.\n\n' +
    'Voice: warm, direct, short. Like a BDR sliding into Slack. Sign nothing. No fluff.\n\n' +
    'STRICT JSON ONLY — no markdown, no preamble. Schema:\n' +
    '{\n' +
    '  "greeting": "1-line greeting based on time/day (e.g. \\"Wednesday morning — pipeline\'s healthy.\\")",\n' +
    '  "narrative": "2-3 sentences: read on the day. What\'s urgent, what\'s opportunity, what\'s not.",\n' +
    '  "priorities": [\n' +
    '    {\n' +
    '      "title": "punchy 5-9 word title",\n' +
    '      "reason": "1 sentence why this matters today",\n' +
    '      "urgency": "critical" | "high" | "medium",\n' +
    '      "entityType": "contact" | "deal" | "lead" | "task" | "booking" | "find-leads" | "none",\n' +
    '      "entityId": "id from the digest if applicable, else empty string",\n' +
    '      "actionHint": "send-email" | "respond" | "call" | "research" | "find-leads" | "advance-deal" | "qualify" | "review"\n' +
    '    }\n' +
    '  ],\n' +
    '  "pipelineHealth": {\n' +
    '    "status": "healthy" | "thin" | "critical",\n' +
    '    "comment": "1-line explanation"\n' +
    '  }\n' +
    '}\n' +
    'Return 3-6 priorities. Keep it tight.';

  const userMessage = 'CRM DIGEST (today):\n' + JSON.stringify(digest, null, 2) + '\n\nReturn your JSON briefing.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = {};
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    parsed = {
      greeting: 'Good morning.',
      narrative: text.slice(0, 300),
      priorities: [],
      pipelineHealth: { status: 'healthy', comment: '(could not parse Claude response)' },
    };
  }
  parsed.model = model;
  parsed.generatedAt = new Date().toISOString();
  return parsed;
}


/* ---------- AI Lead generation — suggest target accounts ---------- */
function aiSuggestTargets_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const existingCustomers = payload.existingCustomers || [];
  const criteria = payload.criteria || '';
  const count = Math.min(Math.max(payload.count || 10, 1), 20);

  const systemPrompt =
    'You are Matt Campbell\'s BDR at Hashio Inc. — B2B SaaS for cannabis cultivators (compliance, scheduling, yield, cost-per-pound).\n' +
    'Your task: propose ' + count + ' target accounts that would be a strong ICP fit. Look at Matt\'s existing customers ' +
    '(if provided) for lookalike modeling. Use real US/Canadian cannabis cultivation companies and named industry figures.\n\n' +
    'Important grounding:\n' +
    '- Hashio sells to LICENSED cultivators (Tier 1-3 indoor or outdoor, MED/REC/MMJ).\n' +
    '- Best fits: 50k+ sqft canopy, 3+ harvest cycles tracked, multi-strain operations, expanding to multi-state.\n' +
    '- Roles to target: Founder, Director of Cultivation, Head Grower, COO, Operations Manager, Compliance Manager.\n' +
    '- Avoid: brokers, dispensaries-only, edibles-only, hemp/CBD-only (different ICP).\n\n' +
    'For each proposed account, infer realistic attributes (company size, state, license type, why-fit). ' +
    'Be HONEST about confidence — if you\'re not sure a company exists, mark confidence lower.\n\n' +
    'Return STRICT JSON only (no markdown):\n' +
    '{\n' +
    '  "targets": [\n' +
    '    {\n' +
    '      "companyName": "string",\n' +
    '      "state": "2-letter state code, or empty",\n' +
    '      "size": "Small | Medium | Large",\n' +
    '      "licenseType": "MED | REC | MMJ | Multi | Unknown",\n' +
    '      "targetRoles": ["Founder", "Head Grower"],\n' +
    '      "whyFit": "1-2 sentence reasoning citing specific lookalike",\n' +
    '      "confidence": 0-100,\n' +
    '      "linkedinHint": "LinkedIn search URL or company URL guess if known, else empty"\n' +
    '    }\n' +
    '  ],\n' +
    '  "researchSteps": ["1-2 short suggestions for next research steps Matt should take"]\n' +
    '}';

  const userMessage = 'EXISTING CUSTOMERS (lookalike basis):\n' + JSON.stringify(existingCustomers, null, 2) + '\n\n' +
    (criteria ? 'EXTRA CRITERIA FROM MATT: ' + criteria + '\n\n' : '') +
    'Propose ' + count + ' target accounts.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = { targets: [], researchSteps: [] };
  try { parsed = JSON.parse(cleaned); }
  catch (e) { /* return empty */ }
  parsed.model = model;
  return parsed;
}


/* ---------- AI Lead enrichment — fill missing fields ---------- */
function aiEnrichLead_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const lead = payload.lead || {};

  const systemPrompt =
    'You enrich sparse lead records for Matt Campbell\'s BDR system at Hashio Inc. (B2B SaaS for cannabis cultivators). ' +
    'Given whatever fields a lead has, infer likely missing fields. Be honest — if you can\'t infer something, leave it empty. ' +
    'Never invent specific data (real email addresses, real LinkedIn URNs). DO suggest LinkedIn SEARCH URLs and category-level ' +
    'attributes (industry, size band, license type).\n\n' +
    'Return STRICT JSON only:\n' +
    '{\n' +
    '  "title": "best-guess role like \\"Director of Cultivation\\" if not given, else empty",\n' +
    '  "headline": "alternate phrasing of role for display",\n' +
    '  "companyIndustry": "Cannabis Cultivation / Edibles / Multi / etc.",\n' +
    '  "companySize": "Small / Medium / Large / empty",\n' +
    '  "linkedinSearchUrl": "https://www.linkedin.com/search/results/people/?keywords=... if you can construct one from name+company, else empty",\n' +
    '  "notes": "1-2 sentences of context — why this lead might be a good fit, things to research, etc.",\n' +
    '  "confidence": 0-100\n' +
    '}';

  const userMessage = 'Lead to enrich (some fields may be empty):\n' + JSON.stringify(lead, null, 2);

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = {};
  try { parsed = JSON.parse(cleaned); } catch (e) { parsed = {}; }
  parsed.model = model;
  return parsed;
}

/* ---------- AI Strategist — free-form proposals beyond rules ---------- */
function aiStrategistProposals_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const digest = payload.digest || {};

  const systemPrompt =
    'You are Matt Campbell\'s autonomous BDR at Hashio Inc. (B2B SaaS for cannabis cultivators). ' +
    'A rules-based engine already covers the obvious moves (reply needed → respond, hot lead → enroll, stale deal → nudge). ' +
    'Your job: propose 3-7 ADDITIONAL moves the rules can\'t see. Examples:\n' +
    '- Creative plays: a personalized note referencing their LinkedIn post about cost-per-pound\n' +
    '- Strategic pivots: "deal stalled in Demo for 3 weeks — try a different stakeholder"\n' +
    '- Cross-sells: "Customer X had great expansion in Q1 — propose case study collab"\n' +
    '- Hygiene: "5 leads with no activity for 60d — bulk archive"\n' +
    '- Research: "competitor mentioned in 2 deals — prep a battlecard"\n\n' +
    'Avoid obvious moves the rules already handle. Be specific to the data given. Each proposal should be ACTIONABLE today.\n\n' +
    'STRICT JSON only:\n' +
    '{\n' +
    '  "proposals": [\n' +
    '    {\n' +
    '      "title": "punchy 5-10 word title",\n' +
    '      "reason": "1-2 sentences citing specific data points",\n' +
    '      "expectedOutcome": "what changes if Matt does this",\n' +
    '      "actionKind": "send-email" | "create-task" | "log-activity" | "update-deal" | "create-deal" | "create-note" | "research",\n' +
    '      "priority": "critical" | "high" | "medium" | "low",\n' +
    '      "risk": "safe" | "moderate" | "sensitive",\n' +
    '      "confidence": 0-100,\n' +
    '      "draftedSubject": "subject if email, else empty",\n' +
    '      "draftedBody": "body if email, else empty",\n' +
    '      "taskTitle": "if create-task",\n' +
    '      "taskNotes": "if create-task",\n' +
    '      "contactRef": "contactId if applicable, else empty",\n' +
    '      "dealRef": "dealId if applicable, else empty"\n' +
    '    }\n' +
    '  ]\n' +
    '}';

  const userMessage = 'CRM digest:\n' + JSON.stringify(digest, null, 2) + '\n\nReturn 3-7 strategist proposals.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 3000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = { proposals: [] };
  try { parsed = JSON.parse(cleaned); } catch (e) { /* return empty */ }
  parsed.model = model;
  return parsed;
}


/* ---------- BDR email send (real Gmail send) ---------- */
/* Called by the BDR executor when an approved send-email proposal has an
 * AI-drafted (or hand-edited) subject + body. Sends via Gmail with the
 * existing sequence-email infra (so opens + clicks + replies tracking all
 * just work). Logs into EmailSends.
 */
function sendBdrEmail_(payload) {
  if (!payload.to)      throw new Error('Missing "to" recipient');
  if (!payload.subject) throw new Error('Missing "subject"');
  if (!payload.body)    throw new Error('Missing "body"');

  // Reuse the sequence-email infra so tracking + logging happen the same way.
  // No enrollmentId/sequenceId/stepId — this is an ad-hoc BDR send.
  const result = sendSequenceEmail_({
    enrollmentId: '',
    sequenceId: '',
    stepId: '',
    contactId: payload.contactId || '',
    to: payload.to,
    subject: payload.subject,
    body: payload.body,
    trackOpens: payload.trackOpens !== false,
  });
  return {
    sendId: result.sendId,
    subject: result.subject,
    sentAt: new Date().toISOString(),
  };
}


/* ---------- SMS via Twilio ---------- */

function sendSequenceSms_(opts) {
  const sid = PropertiesService.getScriptProperties().getProperty('TWILIO_SID');
  const token = PropertiesService.getScriptProperties().getProperty('TWILIO_TOKEN');
  const from = PropertiesService.getScriptProperties().getProperty('TWILIO_FROM');
  if (!sid || !token || !from) {
    throw new Error('Twilio not configured. Set TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM in Apps Script Project Settings.');
  }

  const url = 'https://api.twilio.com/2010-04-01/Accounts/' + sid + '/Messages.json';
  const formData = {
    From: from,
    To: opts.to,
    Body: opts.body,
  };

  let twilioSid = '';
  let status = 'sent';
  let errorMessage = '';

  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: formData,
      headers: {
        Authorization: 'Basic ' + Utilities.base64Encode(sid + ':' + token),
      },
      muteHttpExceptions: true,
    });
    const respCode = res.getResponseCode();
    const json = JSON.parse(res.getContentText());
    if (respCode >= 200 && respCode < 300) {
      twilioSid = json.sid || '';
      status = json.status || 'sent';
    } else {
      status = 'failed';
      errorMessage = json.message || ('HTTP ' + respCode);
    }
  } catch (err) {
    status = 'failed';
    errorMessage = String(err && err.message || err);
  }

  // Log to SmsSends
  const sheet = getSpreadsheet_().getSheetByName('SmsSends');
  if (sheet) {
    const headers = sheet.getDataRange().getValues()[0].map(String);
    const id = 'sm' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    const row = {
      id: id,
      enrollmentId: opts.enrollmentId,
      sequenceId: opts.sequenceId,
      stepId: opts.stepId,
      contactId: opts.contactId,
      to: opts.to,
      from: from,
      body: opts.body,
      twilioSid: twilioSid,
      status: status,
      errorMessage: errorMessage,
      sentAt: new Date().toISOString(),
      deliveredAt: '',
      repliedAt: '',
    };
    sheet.appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  }

  if (status === 'failed') {
    throw new Error('Twilio: ' + errorMessage);
  }
  return { sid: twilioSid, status: status };
}

function sendSequenceEmail_(opts) {
  const emailSendsSheet = getSpreadsheet_().getSheetByName('EmailSends');

  // Build tracking pixel + click-tracked URLs
  const sendId = 'em' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const webAppUrl = ScriptApp.getService().getUrl();
  const pixelUrl = opts.trackOpens && webAppUrl
    ? webAppUrl + '?action=trackOpen&s=' + sendId + '&key=' + getApiKey_()
    : '';

  // Wrap URLs so we can record clicks.
  const htmlBodyCore = webAppUrl
    ? plainToHtmlWithTracking_(opts.body, sendId, webAppUrl)
    : plainToHtml_(opts.body);
  const htmlBody = htmlBodyCore + (pixelUrl ? ('<img src="' + pixelUrl + '" width="1" height="1" alt="" style="display:none" />') : '');

  // Send
  GmailApp.sendEmail(opts.to, opts.subject, opts.body, {
    name: getFromName_() || undefined,
    htmlBody: htmlBody,
  });

  // Find the thread we just created
  const threads = GmailApp.search('to:' + opts.to + ' subject:"' + opts.subject.replace(/"/g, '\\"') + '" newer_than:1d', 0, 1);
  const threadId = threads && threads.length ? threads[0].getId() : '';
  const msgId = threads && threads.length ? threads[0].getMessages().slice(-1)[0].getId() : '';

  // Log to EmailSends
  if (emailSendsSheet) {
    const headers = emailSendsSheet.getDataRange().getValues()[0].map(String);
    const payload = {
      id: sendId,
      enrollmentId: opts.enrollmentId,
      sequenceId: opts.sequenceId,
      stepId: opts.stepId,
      contactId: opts.contactId,
      to: opts.to,
      subject: opts.subject,
      bodyPreview: (opts.body || '').slice(0, 120),
      threadId: threadId,
      messageId: msgId,
      sentAt: new Date().toISOString(),
      openedAt: '',
      repliedAt: '',
      clickedAt: '',
      status: 'sent',
      errorMessage: '',
    };
    emailSendsSheet.appendRow(headers.map(function (h) { return payload[h] === undefined ? '' : payload[h]; }));
  }

  return { sendId: sendId, subject: opts.subject };
}

/** Check recent email sends' threads for replies; mark enrollments stopped-reply. */
function checkReplies() {
  try {
    checkReplies_();
  } catch (err) {
    Logger.log('checkReplies error: ' + (err && err.message));
  }
}

/** Install a 5-minute time-driven trigger to auto-run checkReplies.
 *  Idempotent — removes any existing checkReplies trigger first. */
function installReplyTrigger_() {
  // Remove old triggers for checkReplies
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'checkReplies') {
      ScriptApp.deleteTrigger(t);
      removed += 1;
    }
  }
  // Install a fresh one
  ScriptApp.newTrigger('checkReplies').timeBased().everyMinutes(5).create();
  return { installed: true, removed: removed, intervalMinutes: 5 };
}

function checkReplies_() {
  const ss = getSpreadsheet_();
  const sendsSheet = ss.getSheetByName('EmailSends');
  const enrollmentsSheet = ss.getSheetByName('Enrollments');
  if (!sendsSheet || !enrollmentsSheet) return { checked: 0 };

  const sendsData = sendsSheet.getDataRange().getValues();
  const sendsHeaders = sendsData[0].map(String);
  const enrollmentsData = enrollmentsSheet.getDataRange().getValues();
  const enrollmentsHeaders = enrollmentsData[0].map(String);

  let updated = 0;
  for (let r = 1; r < sendsData.length; r++) {
    const send = rowToObj_(sendsHeaders, sendsData[r]);
    if (send.repliedAt) continue;
    if (!send.threadId) continue;
    try {
      const thread = GmailApp.getThreadById(send.threadId);
      if (!thread) continue;
      const messages = thread.getMessages();
      const replies = messages.filter(function (m) {
        return !m.isDraft() && m.getFrom().toLowerCase().indexOf(send.to.toLowerCase()) >= 0;
      });
      if (replies.length > 0) {
        const replyDate = replies[0].getDate().toISOString();
        applyRowUpdate_(sendsSheet, r + 1, sendsHeaders, { repliedAt: replyDate });
        // Stop enrollment if step was configured that way
        for (let er = 1; er < enrollmentsData.length; er++) {
          const enr = rowToObj_(enrollmentsHeaders, enrollmentsData[er]);
          if (enr.id === send.enrollmentId && enr.status === 'active') {
            applyRowUpdate_(enrollmentsSheet, er + 1, enrollmentsHeaders, {
              status: 'stopped-reply',
              lastFiredAt: new Date().toISOString(),
              notes: (enr.notes ? enr.notes + ' | ' : '') + 'Replied',
            });
          }
        }
        updated++;
      }
    } catch (err) {
      // swallow — thread may have been deleted
    }
  }
  return { checked: sendsData.length - 1, updated: updated };
}

function respondTrackingPixel_(sendId) {
  // Mark send.openedAt if not already
  try {
    if (sendId) {
      const sendsSheet = getSpreadsheet_().getSheetByName('EmailSends');
      if (sendsSheet) {
        const data = sendsSheet.getDataRange().getValues();
        const headers = data[0].map(String);
        const idCol = headers.indexOf('id');
        const openedCol = headers.indexOf('openedAt');
        for (let r = 1; r < data.length; r++) {
          if (String(data[r][idCol]) === String(sendId)) {
            if (!data[r][openedCol]) {
              sendsSheet.getRange(r + 1, openedCol + 1).setValue(new Date().toISOString());
            }
            break;
          }
        }
      }
    }
  } catch (err) {
    // silent
  }
  // Return a 1x1 transparent GIF
  const gif = Utilities.base64Decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7');
  return ContentService.createTextOutput(
    Utilities.newBlob(gif, 'image/gif').getDataAsString('ISO-8859-1'),
  ).setMimeType(ContentService.MimeType.TEXT); // closest we can do in ContentService
}

/* ---------- Step helpers ---------- */

function evaluateBranch_(enrollment, config, ctx) {
  const cond = config.condition || {};
  const ss = getSpreadsheet_();
  const sendsSheet = ss.getSheetByName('EmailSends');

  if (cond.kind === 'opened-last' || cond.kind === 'clicked-last' || cond.kind === 'replied') {
    if (!sendsSheet) return { matched: false };
    const sends = findAllWhere_(sendsSheet, 'enrollmentId', enrollment.id);
    if (!sends.length) return { matched: false };
    sends.sort(function (a, b) { return (b.sentAt || '').localeCompare(a.sentAt || ''); });
    const last = sends[0];
    const within = (cond.withinHours || 48) * 60 * 60 * 1000;
    const field = cond.kind === 'opened-last' ? 'openedAt'
      : cond.kind === 'clicked-last' ? 'clickedAt'
      : 'repliedAt';
    if (!last[field]) return { matched: false };
    const ts = new Date(last[field]).getTime();
    const sentTs = new Date(last.sentAt).getTime();
    return { matched: ts - sentTs <= within };
  }

  if (cond.kind === 'contact-field') {
    const val = (ctx.contact && ctx.contact[cond.field]) || '';
    return { matched: String(val) === String(cond.equals) };
  }

  if (cond.kind === 'deal-stage') {
    const val = (ctx.deal && ctx.deal.stage) || '';
    return { matched: String(val) === String(cond.equals) };
  }

  return { matched: false };
}

function applyAction_(config, enrollment, ctx) {
  const ss = getSpreadsheet_();
  const kind = config.kind;
  const payload = config.payload || {};
  switch (kind) {
    case 'create-task': {
      const tasksSheet = ss.getSheetByName('Tasks');
      if (!tasksSheet) return;
      const headers = tasksSheet.getDataRange().getValues()[0].map(String);
      const task = {
        id: 'tk' + Utilities.getUuid().replace(/-/g, '').slice(0, 10),
        title: resolveMergeTags_(payload.title || 'Follow up', ctx),
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        priority: 'medium',
        contactId: enrollment.contactId,
        dealId: enrollment.dealId || '',
        notes: 'Auto-created by sequence',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: '',
      };
      tasksSheet.appendRow(headers.map(function (h) { return task[h] === undefined ? '' : task[h]; }));
      return;
    }
    case 'update-contact': {
      const contactsSheet = ss.getSheetByName('Contacts');
      if (!contactsSheet) return;
      const data = contactsSheet.getDataRange().getValues();
      const headers = data[0].map(String);
      const idCol = headers.indexOf('id');
      const fieldCol = headers.indexOf(payload.field);
      if (fieldCol < 0) return;
      for (let r = 1; r < data.length; r++) {
        if (String(data[r][idCol]) === String(enrollment.contactId)) {
          contactsSheet.getRange(r + 1, fieldCol + 1).setValue(payload.value);
          break;
        }
      }
      return;
    }
    case 'update-deal-stage': {
      if (!enrollment.dealId) return;
      const dealsSheet = ss.getSheetByName('Deals');
      if (!dealsSheet) return;
      const data = dealsSheet.getDataRange().getValues();
      const headers = data[0].map(String);
      const idCol = headers.indexOf('id');
      const stageCol = headers.indexOf('stage');
      for (let r = 1; r < data.length; r++) {
        if (String(data[r][idCol]) === String(enrollment.dealId)) {
          dealsSheet.getRange(r + 1, stageCol + 1).setValue(payload.stage || '');
          break;
        }
      }
      return;
    }
    case 'notify-owner': {
      const me = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
      if (!me) return;
      const subject = resolveMergeTags_(payload.subject || 'Sequence notification', ctx);
      const body =
        'Sequence notification for ' + (ctx.contact ? ctx.contact.firstName + ' ' + ctx.contact.lastName : 'a contact') +
        '\n\n' +
        (ctx.deal ? 'Deal: ' + ctx.deal.title + ' (stage: ' + ctx.deal.stage + ')\n' : '') +
        'Enrollment: ' + enrollment.id;
      GmailApp.sendEmail(me, subject, body);
      return;
    }
    case 'end-sequence':
      // handled by caller via return status
      return;
    case 'unsubscribe-contact': {
      const contactsSheet = ss.getSheetByName('Contacts');
      if (!contactsSheet) return;
      const data = contactsSheet.getDataRange().getValues();
      const headers = data[0].map(String);
      const idCol = headers.indexOf('id');
      const statusCol = headers.indexOf('status');
      if (statusCol < 0) return;
      for (let r = 1; r < data.length; r++) {
        if (String(data[r][idCol]) === String(enrollment.contactId)) {
          contactsSheet.getRange(r + 1, statusCol + 1).setValue('Unsubscribed');
          break;
        }
      }
      return;
    }
  }
}

function waitUnitToMs_(unit) {
  const H = 60 * 60 * 1000;
  switch (unit) {
    case 'hours': return H;
    case 'weeks': return 7 * 24 * H;
    case 'businessDays': return 24 * H; // approximate — caller is responsible for skipping weekends
    case 'days':
    default: return 24 * H;
  }
}

function plainToHtml_(text) {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.split(/\n\n+/).map(function (p) {
    return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br />') + '</p>';
  }).join('');
}

// Same as plainToHtml_ but wraps every http(s)://... URL with a click-tracked
// redirect so we can record `clickedAt` on the EmailSends row.
function plainToHtmlWithTracking_(text, sendId, webAppUrl) {
  if (!text) return '';
  const key = getApiKey_();
  function wrap(url) {
    const tracked = webAppUrl + '?action=trackClick&s=' + encodeURIComponent(sendId) +
      '&u=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(key);
    return '<a href="' + tracked + '" style="color:#6b4ef5">' + url + '</a>';
  }
  // Escape HTML, then re-scan for URLs and wrap.
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withLinks = escaped.replace(/(https?:\/\/[^\s<>"]+)/g, function (m) { return wrap(m); });
  return withLinks.split(/\n\n+/).map(function (p) {
    return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br />') + '</p>';
  }).join('');
}

// Record the click and redirect the user to the original URL.
function respondTrackClick_(sendId, url) {
  try {
    if (sendId) {
      const sendsSheet = getSpreadsheet_().getSheetByName('EmailSends');
      if (sendsSheet) {
        const data = sendsSheet.getDataRange().getValues();
        const headers = data[0].map(String);
        const idCol = headers.indexOf('id');
        const clickedCol = headers.indexOf('clickedAt');
        for (let r = 1; r < data.length; r++) {
          if (String(data[r][idCol]) === String(sendId)) {
            if (clickedCol >= 0 && !data[r][clickedCol]) {
              sendsSheet.getRange(r + 1, clickedCol + 1).setValue(new Date().toISOString());
            }
            break;
          }
        }
      }
    }
  } catch (err) {
    // silent
  }
  // Redirect to the original URL. Apps Script's simple redirect trick:
  const safeUrl = String(url || '').replace(/"/g, '%22');
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta http-equiv="refresh" content="0; url=' + safeUrl + '">' +
    '<script>location.replace(' + JSON.stringify(safeUrl) + ')</script>' +
    '<a href="' + safeUrl + '">continue</a>'
  );
}

function resolveMergeTags_(s, ctx) {
  if (!s) return '';
  return String(s).replace(/\{\{\s*([\w.]+)\s*\}\}/g, function (_, key) {
    key = String(key).trim();
    const c = ctx.contact || {};
    const d = ctx.deal || {};
    const co = ctx.company || {};
    switch (key) {
      case 'firstName': return c.firstName || '';
      case 'lastName': return c.lastName || '';
      case 'fullName': return [c.firstName, c.lastName].filter(Boolean).join(' ');
      case 'email': return c.email || '';
      case 'title': return c.title || '';
      case 'company':
      case 'companyName': return co.name || '';
      case 'dealTitle': return d.title || '';
      case 'dealValue': return d.value ? String(d.value) : '';
      case 'dealStage': return d.stage || '';
      default: return '{{' + key + '}}';
    }
  });
}

function getFromName_() {
  return PropertiesService.getScriptProperties().getProperty('FROM_NAME') || '';
}

/* ---------- Row utility helpers ---------- */

function rowToObj_(headers, row) {
  const obj = {};
  for (let c = 0; c < headers.length; c++) {
    if (!headers[c]) continue;
    obj[headers[c]] = row[c] === null || row[c] === undefined ? '' : row[c];
  }
  return obj;
}

function findById_(sheet, id) {
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf('id');
  if (idCol < 0) return null;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(id)) return rowToObj_(headers, data[r]);
  }
  return null;
}

function findAllWhere_(sheet, col, value) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const c = headers.indexOf(col);
  if (c < 0) return [];
  const results = [];
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][c]) === String(value)) results.push(rowToObj_(headers, data[r]));
  }
  return results;
}

function applyEnrollmentUpdate_(sheet, rowIdx, headers, patch) {
  applyRowUpdate_(sheet, rowIdx, headers, patch);
}

function applyRowUpdate_(sheet, rowIdx, headers, patch) {
  for (let c = 0; c < headers.length; c++) {
    const key = headers[c];
    if (patch[key] !== undefined) {
      sheet.getRange(rowIdx, c + 1).setValue(patch[key]);
    }
  }
}


/* ========================================================================
   Booking links — Calendly-style scheduler
   ========================================================================
   Endpoints:
     getAvailability(slug, fromDate "YYYY-MM-DD", toDate "YYYY-MM-DD")
       → { slug, name, durationMinutes, slots: [ISO datetimes...] }
     createBooking({ slug, slotStart, attendeeName, attendeeEmail, attendeeNotes })
       → { id, eventId, slotStart, slotEnd, status }

   Both use the script owner's primary Google Calendar
   (CalendarApp.getDefaultCalendar()). Multi-user comes later when we know
   who's signed in. For now, the BookingLink's ownerEmail is informational. */

function findBookingLinkBySlug_(slug) {
  const sheet = getSpreadsheet_().getSheetByName('BookingLinks');
  if (!sheet) throw new Error('BookingLinks tab not found');
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data[0].map(String);
  for (let r = 1; r < data.length; r++) {
    const row = rowToObj_(headers, data[r]);
    if (row.slug && String(row.slug).toLowerCase() === String(slug).toLowerCase()) {
      return row;
    }
  }
  return null;
}

function getAvailability_(slug, fromDate, toDate) {
  const link = findBookingLinkBySlug_(slug);
  if (!link) throw new Error('Booking link not found: ' + slug);
  if (link.status !== 'active') throw new Error('Booking link is disabled');

  const tz = link.timezone || Session.getScriptTimeZone() || 'UTC';
  const duration = Number(link.durationMinutes) || 30;
  const buffer = Number(link.bufferMinutes) || 0;
  const startHour = Number(link.startHour);
  const endHour = Number(link.endHour);
  const minAdvanceMs = (Number(link.minAdvanceHours) || 0) * 60 * 60 * 1000;
  const maxAdvanceMs = (Number(link.maxAdvanceDays) || 30) * 24 * 60 * 60 * 1000;
  const workingDays = String(link.workingDays || '1,2,3,4,5')
    .split(',').map(function (s) { return parseInt(s, 10); }).filter(function (n) { return !isNaN(n); });

  const cal = CalendarApp.getDefaultCalendar();

  const now = new Date();
  const earliest = new Date(now.getTime() + minAdvanceMs);
  const latest = new Date(now.getTime() + maxAdvanceMs);

  const from = parseDateLocal_(fromDate || ymd_(now, tz), tz);
  const to = parseDateLocal_(toDate || ymd_(latest, tz), tz);

  // Cap from/to with the advance windows
  const fromCapped = new Date(Math.max(from.getTime(), earliest.getTime()));
  const toCapped = new Date(Math.min(to.getTime() + 86400000, latest.getTime())); // +1 day to include `to`

  // Pull busy events once for the whole range, then bucket per-day
  const busy = cal.getEvents(fromCapped, toCapped).map(function (e) {
    return { start: e.getStartTime(), end: e.getEndTime(), busyStatus: e.isAllDayEvent() ? 'allDay' : 'busy' };
  });

  const slots = [];
  // Iterate day by day in `tz`
  for (
    let day = new Date(fromCapped.getTime());
    day < toCapped;
    day = new Date(day.getTime() + 86400000)
  ) {
    const localDate = ymd_(day, tz);
    const dow = weekdayInTz_(day, tz); // 0=Sun..6=Sat
    if (workingDays.indexOf(dow) < 0) continue;

    // Build candidate slot times for this day (in tz)
    const dayStart = combineDateTime_(localDate, startHour, 0, tz);
    const dayEnd = combineDateTime_(localDate, endHour, 0, tz);

    let cursor = dayStart;
    while (cursor.getTime() + duration * 60000 <= dayEnd.getTime()) {
      const slotEnd = new Date(cursor.getTime() + duration * 60000);
      // Skip if before earliest
      if (slotEnd <= earliest) {
        cursor = new Date(cursor.getTime() + (duration + buffer) * 60000);
        continue;
      }
      // Check against busy events (with buffer)
      const slotPaddedStart = new Date(cursor.getTime() - buffer * 60000);
      const slotPaddedEnd = new Date(slotEnd.getTime() + buffer * 60000);
      const conflict = busy.some(function (b) {
        return b.start < slotPaddedEnd && b.end > slotPaddedStart;
      });
      if (!conflict) {
        slots.push(cursor.toISOString());
      }
      cursor = new Date(cursor.getTime() + (duration + buffer) * 60000);
    }
  }

  return {
    slug: link.slug,
    name: link.name,
    description: link.description,
    durationMinutes: duration,
    timezone: tz,
    ownerName: link.ownerName,
    slots: slots,
  };
}

/* ========================================================================
   Lead ingest webhook
   ========================================================================
   Accepts a lead payload from any third-party source. De-dupes on
   (source, externalId). Adds engagement signals to the existing row when
   a repeat ping comes in. Auto-recomputes temperature + score. */

function ingestLead_(payload) {
  if (!payload || !payload.source) throw new Error('Missing required field: source');

  const source = String(payload.source).toLowerCase();
  const externalId = String(payload.externalId || payload.id || payload.email || '');
  if (!externalId) throw new Error('Need externalId, id, or email to dedupe');

  ensureHeaders_('leads', Object.keys(payload));
  const sheet = getSpreadsheet_().getSheetByName('Leads');
  if (!sheet) throw new Error('Leads tab missing');

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf('id');
  const sourceCol = headers.indexOf('source');
  const extCol = headers.indexOf('externalId');
  const sigCol = headers.indexOf('engagementSignals');

  // Look for existing row by (source, externalId)
  let existingRow = -1;
  let existingObj = null;
  for (let r = 1; r < data.length; r++) {
    if (
      String(data[r][sourceCol]).toLowerCase() === source &&
      String(data[r][extCol]) === externalId
    ) {
      existingRow = r;
      existingObj = rowToObj_(headers, data[r]);
      break;
    }
  }

  // Merge incoming signals with existing
  const incomingSignals = Array.isArray(payload.signals) ? payload.signals
    : payload.signal ? [payload.signal]
    : [];
  let mergedSignals = [];
  if (existingObj && existingObj.engagementSignals) {
    try {
      const parsed = JSON.parse(existingObj.engagementSignals);
      if (Array.isArray(parsed)) mergedSignals = parsed;
    } catch (e) {}
  }
  for (const sig of incomingSignals) {
    if (sig && sig.kind) mergedSignals.push({
      kind: String(sig.kind),
      ts: sig.ts || new Date().toISOString(),
      target: sig.target ? String(sig.target) : '',
      weight: typeof sig.weight === 'number' ? sig.weight : 1,
    });
  }

  // Compute score + temperature
  const scoreData = computeLeadScore_(mergedSignals);

  const now = new Date().toISOString();
  const row = existingObj || {};
  // Apply incoming fields (only ones provided)
  const fieldKeys = [
    'firstName','lastName','email','linkedinUrl','headline','title',
    'companyName','companyLinkedinUrl','companyDomain','companyIndustry','companySize','location',
    'notes',
  ];
  fieldKeys.forEach(function (k) {
    if (payload[k] !== undefined && payload[k] !== '') row[k] = payload[k];
  });
  row.source = source;
  row.externalId = externalId;
  row.engagementSignals = JSON.stringify(mergedSignals);
  row.temperature = scoreData.temperature;
  row.score = scoreData.score;
  row.lastSignalAt = mergedSignals.length
    ? mergedSignals.map(function (s) { return s.ts; }).sort().pop()
    : (row.lastSignalAt || now);
  if (!row.status) row.status = 'new';

  if (existingRow > 0) {
    // Update existing
    applyRowUpdate_(sheet, existingRow + 1, headers, row);
    return { id: row.id, action: 'updated', score: scoreData.score, temperature: scoreData.temperature };
  } else {
    // Create new
    row.id = 'ld' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    row.createdAt = now;
    const rowValues = headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
    sheet.appendRow(rowValues);
    return { id: row.id, action: 'created', score: scoreData.score, temperature: scoreData.temperature };
  }
}

const LEAD_SIGNAL_WEIGHTS_ = {
  'company-follow': 15, 'company-page-visit': 8, 'post-like': 10, 'post-comment': 25,
  'post-share': 30, 'profile-view': 5, 'connection-accept': 20, 'inmail-reply': 35,
  'website-visit': 12, 'pricing-page-visit': 25, 'demo-page-visit': 20,
  'newsletter-signup': 18, 'webinar-attend': 28, 'content-download': 22,
  'event-rsvp': 30, 'replied-to-cold-email': 40,
};

function computeLeadScore_(signals) {
  const now = new Date();
  let total = 0;
  for (const sig of signals) {
    const base = LEAD_SIGNAL_WEIGHTS_[sig.kind] || 5;
    const ageDays = (now.getTime() - new Date(sig.ts).getTime()) / 86400000;
    const recency = ageDays <= 3 ? 1.5 : ageDays <= 14 ? 1.0 : ageDays <= 30 ? 0.6 : ageDays <= 90 ? 0.3 : 0.1;
    const weight = (sig.weight || 1) * base * recency;
    total += weight;
  }
  const score = Math.min(100, Math.round(total));
  let temperature = 'cold';
  if (score >= 80) temperature = 'molten';
  else if (score >= 50) temperature = 'hot';
  else if (score >= 25) temperature = 'warm';
  return { score: score, temperature: temperature };
}

function createBooking_(payload) {
  const slug = payload.slug;
  const slotStartIso = payload.slotStart;
  const attendeeName = payload.attendeeName || '';
  const attendeeEmail = payload.attendeeEmail || '';
  const notes = payload.attendeeNotes || '';

  if (!slug) throw new Error('Missing slug');
  if (!slotStartIso) throw new Error('Missing slotStart');
  if (!attendeeEmail) throw new Error('Missing attendeeEmail');

  const link = findBookingLinkBySlug_(slug);
  if (!link) throw new Error('Booking link not found');
  if (link.status !== 'active') throw new Error('Booking link is disabled');

  const slotStart = new Date(slotStartIso);
  const duration = Number(link.durationMinutes) || 30;
  const slotEnd = new Date(slotStart.getTime() + duration * 60000);

  // Re-validate: is the slot still free?
  const cal = CalendarApp.getDefaultCalendar();
  const buffer = Number(link.bufferMinutes) || 0;
  const paddedStart = new Date(slotStart.getTime() - buffer * 60000);
  const paddedEnd = new Date(slotEnd.getTime() + buffer * 60000);
  const conflicts = cal.getEvents(paddedStart, paddedEnd);
  if (conflicts.length > 0) {
    throw new Error('That slot was just taken — please pick another');
  }

  // Create the calendar event with the booker as guest
  const title = link.name + ' — ' + attendeeName;
  const description = (notes ? notes + '\n\n' : '') +
    'Booked via Hashio CRM\nLink: ' + link.slug + '\nAttendee: ' + attendeeName + ' <' + attendeeEmail + '>';
  const event = cal.createEvent(title, slotStart, slotEnd, {
    description: description,
    guests: attendeeEmail,
    sendInvites: true,
  });

  // Log to Bookings tab
  const bookingId = 'bg' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  const bookingsSheet = getSpreadsheet_().getSheetByName('Bookings');
  if (bookingsSheet) {
    const headers = bookingsSheet.getDataRange().getValues()[0].map(String);
    const row = {
      id: bookingId,
      bookingLinkId: link.id,
      slug: link.slug,
      attendeeName: attendeeName,
      attendeeEmail: attendeeEmail,
      attendeeNotes: notes,
      slotStart: slotStart.toISOString(),
      slotEnd: slotEnd.toISOString(),
      eventId: event.getId(),
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    bookingsSheet.appendRow(headers.map(function (h) { return row[h] === undefined ? '' : row[h]; }));
  }

  return {
    id: bookingId,
    eventId: event.getId(),
    slotStart: slotStart.toISOString(),
    slotEnd: slotEnd.toISOString(),
    status: 'confirmed',
  };
}

/* ---------- Date / timezone utilities ---------- */

// "YYYY-MM-DD" of a Date in a given timezone (using Apps Script's formatDate).
function ymd_(d, tz) {
  return Utilities.formatDate(d, tz || 'UTC', 'yyyy-MM-dd');
}

// Parse "YYYY-MM-DD" as midnight in the given tz.
function parseDateLocal_(ymd, tz) {
  // Build a date string that GAS can parse with the timezone
  // e.g. "2026-04-27 00:00:00 -0600"
  const parts = ymd.split('-');
  if (parts.length !== 3) return new Date(ymd);
  // Use formatDate trick: format midnight UTC, then parse with tz offset
  // Simpler: construct as UTC then shift back. We approximate by building
  // a Date with the local tz offset of "now" — which is fine for booking
  // ranges since DST shifts are < 1 hr.
  const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 0, 0, 0);
  // Adjust for the difference between the script's tz and `tz`.
  const scriptTzMidnight = Utilities.formatDate(date, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ssZ");
  const targetTzMidnight = Utilities.formatDate(date, tz || 'UTC', "yyyy-MM-dd'T'HH:mm:ssZ");
  const driftMs = new Date(scriptTzMidnight).getTime() - new Date(targetTzMidnight).getTime();
  return new Date(date.getTime() + driftMs);
}

function combineDateTime_(ymd, hour, minute, tz) {
  const base = parseDateLocal_(ymd, tz);
  return new Date(base.getTime() + hour * 3600000 + minute * 60000);
}

// Day-of-week (0=Sun..6=Sat) of a Date as observed in `tz`.
function weekdayInTz_(d, tz) {
  const dow = Utilities.formatDate(d, tz || 'UTC', 'u'); // 1=Mon..7=Sun (ISO)
  const isoDow = parseInt(dow, 10);
  return isoDow === 7 ? 0 : isoDow; // convert to 0=Sun..6=Sat
}
