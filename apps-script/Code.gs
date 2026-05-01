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
  knowledge:      'Knowledge',
};

/** Canonical header set per entity. Used by ensureHeaders / ensureTabs to
 *  self-heal a Sheet that's missing columns or tabs. Any field the app
 *  tries to write that's not listed here still gets auto-appended. */
const KNOWN_HEADERS_ = {
  companies:     ['id','name','industry','licenseCount','size','website','address','notes','createdAt','updatedAt'],
  contacts:      ['id','firstName','lastName','email','phone','title','role','companyId','status','state','linkedinUrl','tags','createdAt'],
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
  activityLogs:  ['id','entityType','entityId','kind','outcome','body','durationMinutes','occurredAt','createdAt','author','externalId'],
  leads:         ['id','source','externalId','firstName','lastName','email','linkedinUrl','headline','title','companyName','companyLinkedinUrl','companyDomain','companyIndustry','companySize','location','engagementSignals','temperature','score','status','notes','convertedContactId','createdAt','lastSignalAt'],
  smsSends:      ['id','enrollmentId','sequenceId','stepId','contactId','to','from','body','twilioSid','status','errorMessage','sentAt','deliveredAt','repliedAt'],
  proposals:     ['id','ruleId','category','priority','confidence','risk','title','reason','expectedOutcome','actionKind','actionPayload','status','createdAt','resolvedAt','resolvedBy','executedAt','executionResult','contactIds','dealId','companyId'],
  // Knowledge — central company-context bank that auto-injects into every AI prompt.
  // type: 'interview' | 'freeform' | 'source'
  //   interview = structured Q/A from the AI interview wizard
  //   freeform  = anything-goes notes
  //   source    = pasted demo transcripts, battlecards, pricing docs, case studies
  knowledge:     ['id','type','title','content','summary','tags','enabled','createdAt','updatedAt'],
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

      case 'bulkCreate': {
        // Bulk import endpoint — writes many rows at once in a single Sheet
        // operation. ~10-50x faster than per-row writes for large CSVs.
        const payload = safeJson_(params.payload);
        if (!payload) throw new Error('Missing or invalid payload');
        out.ok = true;
        out.data = bulkCreateRows_(payload.entity, payload.rows || []);
        break;
      }

      case 'bulkUpdate': {
        // Bulk update — patches many rows by id in a batched setValues call.
        // Used by Quality Scan to tag flagged contacts in one shot.
        const payload = safeJson_(params.payload);
        if (!payload) throw new Error('Missing or invalid payload');
        out.ok = true;
        out.data = bulkUpdateRows_(payload.entity, payload.rows || []);
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

      case 'scanInboundEmails': {
        // Scan Gmail inbox for messages from known contacts (cold inbound,
        // not just replies to our outbound). Logs each as an ActivityLog.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = scanInboundEmails_(payload.daysBack || 14);
        break;
      }

      case 'installInboundEmailTrigger': {
        out.ok = true;
        out.data = installInboundEmailTrigger_();
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

      case 'aiBuildSequence': {
        // AI sequence builder — produces a complete multi-step sequence with
        // branching response trees from a goal, audience, voice samples, and
        // channel/cadence preferences.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiBuildSequence_(payload);
        break;
      }

      case 'aiBuildEmailTemplate': {
        // Expert copywriter — builds a single email template with subject,
        // body, alternatives, and notes on when to use it.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiBuildEmailTemplate_(payload);
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

      case 'aiEnrichContact': {
        // Infer missing contact fields (most importantly: role from title).
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiEnrichContact_(payload);
        break;
      }

      case 'aiEnrichContactsBulk': {
        // Bulk enrichment for many contacts at once — reduces token cost vs
        // one call per contact.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiEnrichContactsBulk_(payload);
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

      case 'aiNextInterviewQuestion': {
        // Knowledge-bank interview: given prior Q/A, returns the next single
        // question to ask (or {done:true} when there's enough context).
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiNextInterviewQuestion_(payload);
        break;
      }

      case 'aiSummarizeKnowledge': {
        // Compresses a long pasted source (transcript, doc, battlecard) down
        // to a structured summary that gets injected into AI prompts. The
        // raw content is still saved — the summary is what the AI sees.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = aiSummarizeKnowledge_(payload);
        break;
      }

      case 'aiCompactKnowledge': {
        // Compresses ALL enabled knowledge items into one tight master summary.
        // Massive token saver — turns ~14k tokens of raw notes into ~2-3k of
        // structured essentials that still capture everything an AI BDR needs.
        out.ok = true;
        out.data = aiCompactKnowledge_();
        break;
      }

      case 'getEmailSignature': {
        // Returns { plain, html, source: 'custom'|'gmail'|'none' } — the signature
        // currently being appended to outgoing BDR/sequence emails.
        out.ok = true;
        out.data = getEmailSignature_();
        break;
      }

      case 'getSchedulerStatus': {
        // Reports whether the runScheduler time-trigger is installed. The
        // frontend uses this to show a "your sequences won't actually send"
        // banner if the trigger is missing.
        out.ok = true;
        out.data = getSchedulerStatus_();
        break;
      }

      case 'installSchedulerTrigger': {
        // Installs the runScheduler trigger (every 5 min). Idempotent —
        // safely re-runs.
        out.ok = true;
        out.data = installSchedulerTrigger_();
        break;
      }

      case 'setEmailSignature': {
        // Save a custom signature override. Body: { plain, html? }. Pass empty
        // strings to both to clear the override and fall back to Gmail auto-detect.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = setEmailSignature_(payload);
        break;
      }

      case 'getKnowledgeFeatureConfig': {
        // Returns the current per-feature ON/OFF map for Knowledge injection,
        // merged with hardcoded defaults. Used by Settings UI to render toggles.
        out.ok = true;
        out.data = getKnowledgeFeatureConfig_();
        break;
      }

      case 'setKnowledgeFeatureConfig': {
        // Saves a partial patch of feature toggles. Body: { features: { key: bool } }.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = setKnowledgeFeatureConfig_(payload);
        break;
      }

      case 'sendDailyDigest': {
        // Manually fire the daily digest now (for testing). Same code path as
        // the cron trigger.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = sendDailyDigest_(payload.recipient || '');
        break;
      }

      case 'installDailyDigestTrigger': {
        // Install/refresh the 8am-daily time trigger. Idempotent.
        const payload = safeJson_(params.payload) || {};
        out.ok = true;
        out.data = installDailyDigestTrigger_(payload.hour || 8, payload.recipient || '');
        break;
      }

      case 'getDailyDigestStatus': {
        out.ok = true;
        out.data = getDailyDigestStatus_();
        break;
      }

      case 'uninstallDailyDigestTrigger': {
        out.ok = true;
        out.data = uninstallDailyDigestTrigger_();
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

/** Bulk create — writes many rows in ONE setValues call instead of N
 *  appendRow calls. ~10-50x faster for large imports. Returns the rows
 *  with their assigned ids + createdAt timestamps. Only supports `create`
 *  op (most common bulk case — bulk update/delete are rare). */
function bulkCreateRows_(entity, rows) {
  const tabName = TABS[entity];
  if (!tabName) throw new Error('Unknown entity: ' + entity);
  if (!rows || rows.length === 0) return { written: 0, ids: [] };

  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(KNOWN_HEADERS_[entity] || ['id']);
  }

  // Union of all keys across all incoming rows — auto-add missing headers.
  const allKeys = new Set();
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { allKeys.add(k); }); });
  ensureHeaders_(entity, Array.from(allKeys));

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const idCol = headers.indexOf('id');
  if (idCol < 0) throw new Error('Tab ' + tabName + ' has no `id` column');
  const createdAtCol = headers.indexOf('createdAt');
  const updatedAtCol = headers.indexOf('updatedAt');

  const now = new Date().toISOString();
  const ids = [];

  // Build the 2D array we'll write in one pass.
  const valuesToWrite = rows.map(function (row) {
    if (!row.id) row.id = newId_(entity);
    if (createdAtCol >= 0 && !row.createdAt) row.createdAt = now;
    if (updatedAtCol >= 0) row.updatedAt = now;
    ids.push(row.id);
    return headers.map(function (h) { return row[h] === undefined ? '' : row[h]; });
  });

  // ONE setValues call writes them all atomically — this is the perf win.
  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, valuesToWrite.length, headers.length).setValues(valuesToWrite);

  return { written: valuesToWrite.length, ids: ids };
}

/** Bulk update — patches many rows by id in one Sheet read + multiple
 *  per-cell setValue calls. Still sequential setValue (Apps Script doesn't
 *  let us write non-contiguous ranges in one call), but reads the data once
 *  upfront so we don't re-scan for each row. ~10x faster than per-row API
 *  calls because we eliminate the network round-trip per row. */
function bulkUpdateRows_(entity, rows) {
  const tabName = TABS[entity];
  if (!tabName) throw new Error('Unknown entity: ' + entity);
  if (!rows || rows.length === 0) return { updated: 0, failed: [] };

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab not found: ' + tabName);

  // Union of all keys across all incoming rows — auto-add missing headers.
  const allKeys = new Set();
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { allKeys.add(k); }); });
  ensureHeaders_(entity, Array.from(allKeys));

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf('id');
  if (idCol < 0) throw new Error('Tab ' + tabName + ' has no `id` column');
  const updatedAtCol = headers.indexOf('updatedAt');
  const now = new Date().toISOString();

  // Build id→rowIndex map once
  const idToRowIdx = {};
  for (let r = 1; r < data.length; r++) {
    idToRowIdx[String(data[r][idCol])] = r;
  }

  let updated = 0;
  const failed = [];
  for (const row of rows) {
    if (!row.id) { failed.push({ id: '', reason: 'missing id' }); continue; }
    const rowIdx = idToRowIdx[String(row.id)];
    if (rowIdx === undefined) { failed.push({ id: row.id, reason: 'not found' }); continue; }
    if (updatedAtCol >= 0) row.updatedAt = now;
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c];
      if (key === 'id') continue;
      if (row[key] !== undefined) {
        sheet.getRange(rowIdx + 1, c + 1).setValue(row[key]);
      }
    }
    updated += 1;
  }

  return { updated: updated, failed: failed };
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

/** Idempotent: ensures the runScheduler time-trigger exists. Returns
 *  status object so the frontend can show install state. Called from the
 *  /engagement page so the user never has to know the Apps Script editor
 *  exists. */
function installSchedulerTrigger_() {
  // Wipe any existing runScheduler triggers first (avoids duplicates that
  // would multiply scheduler firing, which doubles email sends).
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduler') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('runScheduler').timeBased().everyMinutes(5).create();
  return { ok: true, message: 'Scheduler trigger installed — runs every 5 minutes', installed: true };
}

/** Returns whether the runScheduler time-trigger is currently installed. */
function getSchedulerStatus_() {
  let installed = false;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runScheduler') installed = true;
  });
  return { installed: installed };
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

/** Per-execution cache of the company-context block so we only read the
 *  Knowledge tab once per request, not once per AI call. */
let __companyContextCache_ = null;

/** Build the company-context block from the Knowledge tab. Each enabled
 *  knowledge item becomes a labeled section. Capped at ~40K chars (~10K
 *  tokens) so we don't blow the context window on huge transcript imports.
 *  Returns '' if there's no knowledge yet.
 *  Auto-injected into every AI system prompt via withCompanyContext_(). */
function buildCompanyContext_() {
  if (__companyContextCache_ !== null) return __companyContextCache_;
  let rows;
  try { rows = readTab_('Knowledge'); }
  catch (e) { __companyContextCache_ = ''; return ''; }
  if (!rows || !rows.length) { __companyContextCache_ = ''; return ''; }

  const enabled = rows.filter(function (r) { return r.enabled !== false && r.enabled !== 'false'; });
  if (!enabled.length) { __companyContextCache_ = ''; return ''; }

  const MAX_CHARS = 40000;
  const blocks = [];
  let totalLen = 0;
  for (let i = 0; i < enabled.length; i++) {
    const r = enabled[i];
    const title = String(r.title || '').trim() || 'Untitled';
    // Prefer summary if present (Claude-compressed) — falls back to raw content.
    const body = String(r.summary || r.content || '').trim();
    if (!body) continue;
    const block = '## ' + title + ' (' + (r.type || 'note') + ')\n' + body;
    if (totalLen + block.length > MAX_CHARS) {
      // Truncate this block to fit; mark with an ellipsis note.
      const remaining = MAX_CHARS - totalLen;
      if (remaining > 200) {
        blocks.push(block.slice(0, remaining) + '\n[...truncated]');
      }
      break;
    }
    blocks.push(block);
    totalLen += block.length;
  }
  if (!blocks.length) { __companyContextCache_ = ''; return ''; }
  __companyContextCache_ =
    '<company_context>\n' +
    'The user, Matt Campbell, has filled out a knowledge bank about his company. ' +
    'Use this to ground every recommendation, voice match, value prop, ICP detail, ' +
    'and objection handling. If the user\'s knowledge contradicts your assumptions, the knowledge wins.\n\n' +
    blocks.join('\n\n---\n\n') +
    '\n</company_context>';
  return __companyContextCache_;
}

/** Wrap any system prompt with the company-context block. The `featureKey`
 *  argument lets the user enable/disable knowledge per-feature in Settings —
 *  e.g. ON for the Sequence Builder (output quality matters), OFF for
 *  single-email drafts (high volume, generic OK) to control API cost. */
function withCompanyContext_(systemPrompt, featureKey) {
  if (featureKey && !knowledgeEnabledFor_(featureKey)) return systemPrompt;
  const ctx = buildCompanyContext_();
  if (!ctx) return systemPrompt;
  return ctx + '\n\n' + systemPrompt;
}

/** Per-feature defaults for Knowledge bank usage. ON = inject the company
 *  context (~14k tokens) into this AI call; OFF = skip the context, save cost.
 *
 *  Defaults split features into two buckets:
 *    • DEEP generation — knowledge ON (output quality is the whole point)
 *    • QUICK / mechanical actions — knowledge OFF (high volume, cost matters)
 *
 *  The user can override any of these in Settings → Knowledge bank usage.
 *  Stored in Script Properties as JSON under KNOWLEDGE_FEATURES. */
const KNOWLEDGE_DEFAULTS_ = {
  // Deep generation — knowledge is the differentiator
  aiBuildSequence:        true,   // Sequence Builder
  aiBuildEmailTemplate:   true,   // Email Template Builder
  aiSuggestTargets:       true,   // Lead-target suggestions (needs ICP)
  aiStrategistProposals:  true,   // Strategist proposals (full context)
  aiDashboardBriefing:    true,   // Daily briefing card / cron digest
  aiNextInterviewQuestion: true,  // Interview wizard (needs to know what's covered)
  aiSummarizeKnowledge:   true,   // Source summarizer (relevance-aware)

  // Quick / mechanical — opt-in to save cost
  draftMessage:           false,  // Single email/SMS drafts (high volume)
  narrativeReason:        false,  // "Why this proposal" tooltips
  aiSuggestNextMove:      false,  // AI BDR contact suggestions
  aiEnrichLead:           false,  // Lead enrichment (mechanical inference)
  aiEnrichContact:        false,  // Contact enrichment, single
  aiEnrichContactsBulk:   false,  // Contact enrichment, bulk
};

/** Read the per-feature config from Script Properties, merged on top of
 *  KNOWLEDGE_DEFAULTS_. Returns a complete map { featureKey: bool }. */
function getKnowledgeFeatureConfig_() {
  const raw = PropertiesService.getScriptProperties().getProperty('KNOWLEDGE_FEATURES') || '{}';
  let user = {};
  try { user = JSON.parse(raw); } catch (e) { user = {}; }
  const out = {};
  Object.keys(KNOWLEDGE_DEFAULTS_).forEach(function (k) {
    out[k] = user.hasOwnProperty(k) ? user[k] === true : KNOWLEDGE_DEFAULTS_[k];
  });
  return out;
}

/** Save a partial patch of feature toggles. Merges with whatever's stored
 *  so the caller only needs to send the keys they're flipping. */
function setKnowledgeFeatureConfig_(payload) {
  const raw = PropertiesService.getScriptProperties().getProperty('KNOWLEDGE_FEATURES') || '{}';
  let current = {};
  try { current = JSON.parse(raw); } catch (e) { current = {}; }
  const patch = (payload && payload.features) || {};
  Object.keys(patch).forEach(function (k) {
    if (KNOWLEDGE_DEFAULTS_.hasOwnProperty(k)) {
      current[k] = patch[k] === true;
    }
  });
  PropertiesService.getScriptProperties().setProperty('KNOWLEDGE_FEATURES', JSON.stringify(current));
  return getKnowledgeFeatureConfig_();
}

/** Cheap single-feature lookup. Used by withCompanyContext_. */
function knowledgeEnabledFor_(featureKey) {
  const cfg = getKnowledgeFeatureConfig_();
  return cfg[featureKey] === true;
}

/** Read active booking links from the BookingLinks tab and return them as
 *  a structured block of text that can be dropped into any AI system prompt
 *  or user message. Critical for preventing Claude from inventing fake
 *  scheduling URLs (the calendly/savvycal hallucination bug).
 *
 *  Returns: a multi-line string, or '' if no active links exist.
 *  Format: includes both the URLs and explicit "do not invent other URLs" rules. */
function getActiveBookingLinksBlock_() {
  let rows;
  try { rows = readTab_('BookingLinks'); }
  catch (e) { return ''; }
  if (!rows || !rows.length) {
    return 'BOOKING LINKS: NONE configured. If you suggest a meeting, do NOT invent a URL — write "I\'ll send a few times that work" instead.';
  }
  const active = rows.filter(function (r) { return r.status === 'active' || r.status === '' || r.status === undefined; });
  if (!active.length) {
    return 'BOOKING LINKS: NONE active. If you suggest a meeting, do NOT invent a URL — write "I\'ll send a few times that work" instead.';
  }
  const baseUrl = 'https://mattc1987.github.io/hashio-crm/#/book/';
  const lines = [
    'MATT\'S REAL ACTIVE BOOKING LINKS — when you propose a meeting/demo/call, paste one of these URLs VERBATIM:',
  ];
  active.forEach(function (b) {
    const url = baseUrl + b.slug;
    const dur = b.durationMinutes ? (b.durationMinutes + ' min') : '';
    const name = b.name || b.slug;
    lines.push('  - ' + name + (dur ? ' (' + dur + ')' : '') + ': ' + url);
  });
  lines.push('');
  lines.push('CRITICAL — NEVER invent calendly.com, hubspot.com, savvycal.com, calendar.google.com, or any other domain.');
  lines.push('Those are NOT Matt\'s URLs — they will 404 on the prospect. Use ONLY the URLs above. Pick the one that matches the goal');
  lines.push('(15-min intro for cold, 30-min demo for qualified, etc.). NEVER write a placeholder like [link], [URL], <link>, {{link}}.');
  return lines.join('\n');
}

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
      system: withCompanyContext_(systemPrompt, 'draftMessage'),
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
      system: withCompanyContext_(systemPrompt, 'narrativeReason'),
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
    '  "recommendedAction": "send-email" | "send-sms" | "make-call" | "create-task" | "log-activity" | "update-deal" | "create-deal" | "convert-lead" | "wait" | "pause",\n' +
    '  "reasoning": "Why this action, citing specific data points (1-2 sentences)",\n' +
    '  "draftedSubject": "subject if email, otherwise empty string",\n' +
    '  "draftedBody": "if email/sms: the message body. If make-call: a 3-5 bullet phone script (line-broken with \\n) that Matt reads off — opener, key questions, value-prop, ask-for-the-meeting. Else empty.",\n' +
    '  "taskTitle": "if recommendedAction is create-task, the task title",\n' +
    '  "taskNotes": "if create-task, what to do specifically",\n' +
    '  "alternativeActions": ["1-2 short strings describing other options Matt could take instead"],\n' +
    '  "confidence": 0-100\n' +
    '}\n' +
    'CALL GUIDANCE: pick make-call when the contact has a phone number, the situation is high-stakes (replied recently, hot lead, big deal stalled), and a written message is too cold. Voice-first when you have signal that they want a real conversation.\n';

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
      system: withCompanyContext_(systemPrompt, 'aiSuggestNextMove'),
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
      system: withCompanyContext_(systemPrompt, 'aiDashboardBriefing'),
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
      system: withCompanyContext_(systemPrompt, 'aiSuggestTargets'),
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


/* ---------- AI Email Template Builder ---------- */
/* Expert copywriter persona. Builds a single high-converting email template
 * with subject, body, alternative subject lines, alternative CTAs, and notes
 * on when to use it. Knows direct-response copywriting frameworks (AIDA, PAS,
 * BAB, FAB, StoryBrand) and applies the right one for the use case. */

function aiBuildEmailTemplate_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const useCase     = payload.useCase     || 'cold-outreach';
  const useCaseDetail = payload.useCaseDetail || '';
  const audience    = payload.audience    || '';
  const framework   = payload.framework   || 'auto';     // auto / aida / pas / bab / fab / story / question
  const tone        = payload.tone        || 'direct';   // direct / conversational / witty / formal / story-driven
  const length      = payload.length      || 'short';    // very-short / short / medium / long
  const ctaType     = payload.ctaType     || 'auto';     // auto / book-meeting / reply / question / resource / call
  const voiceSamples = payload.voiceSamples || '';
  const folder      = payload.folder      || '';
  const subjectStyle = payload.subjectStyle || 'auto';   // auto / question / curiosity / personalized / short / specific

  const useCaseMap = {
    'cold-outreach':       'first cold touch — they\'ve never heard from you',
    'follow-up':           'follow-up to a cold email that hasn\'t replied',
    'inbound-reply':       'reply to inbound interest (they reached out, lead form, demo request)',
    'demo-recap':          'post-demo recap with next step',
    'proposal-send':       'sending a proposal/contract for review',
    'renewal-outreach':    'renewal reminder for an existing customer',
    'win-back':            'win-back to a churned or dormant customer',
    'referral-request':    'asking a happy customer for a referral',
    'review-request':      'asking for a review / case study / testimonial',
    'breakup':             'final touch — the breakup email at the end of a sequence',
    'event-invite':        'invitation to a webinar, dinner, or event',
    'check-in':            'casual check-in to a warm contact who\'s gone quiet',
    'introduction':        'making an introduction between two people',
    'thank-you':           'thank-you note after a meeting or call',
    'meeting-request':     'asking for a meeting (vs. cold outreach where the ask is softer)',
    'custom':              useCaseDetail || 'custom use case',
  };
  const useCaseDescription = useCaseMap[useCase] || useCaseMap['cold-outreach'];

  const frameworkGuidance = {
    'auto': 'Pick the framework that fits this use case best. For cold outreach use a personalized question hook. For follow-up use a soft bump. For breakup use permission-to-close.',
    'aida': 'AIDA — Attention (hook subject + opening line), Interest (specific value relevant to them), Desire (concrete benefit + proof), Action (single clear CTA).',
    'pas':  'PAS — Problem (name a specific pain they have), Agitation (twist the knife — what does it cost them?), Solution (one-line solution + soft CTA).',
    'bab':  'BAB — Before (their current state, with empathy), After (the better state), Bridge (how Hashio gets them there). Emotional + concrete.',
    'fab':  'FAB — Feature (what we do), Advantage (how it works better than alternatives), Benefit (what it means for them). Useful for product-led emails.',
    'story': 'StoryBrand — they are the hero, you are the guide. Lead with their goal, name the obstacle, position Hashio as the helper that gets them to the win. 1-paragraph mini-story.',
    'question': 'Question-led — open with a SHORT, specific question that makes them think. The whole email is the question + 1 line of context. Curiosity-first.',
  };

  const toneGuidance = {
    'direct':         'No-fluff, value-upfront. Each sentence does work. No throat-clearing. No "I hope this finds you well". No "just checking in".',
    'conversational': 'Friendly but professional. Short sentences. A touch of personality. Use contractions. Sound like a smart friend.',
    'witty':          'Clever, with personality. ONE good line of humor (subtle, not goofy). Makes them grin and reply. Risk: don\'t be try-hard.',
    'formal':         'Professional, polished. Full sentences. No contractions or slang. Think McKinsey email. Use sparingly — most modern B2B prefers conversational.',
    'story-driven':   'Lead with a 1-2 sentence anecdote (specific, vivid, relatable). Bridge to the ask. Make them feel something before you ask anything.',
  };

  const lengthGuidance = {
    'very-short': '1-3 sentences. One ask. Often the highest reply rate for cold.',
    'short':      '2-4 short paragraphs. 50-100 words. Modern best practice.',
    'medium':     '4-6 short paragraphs. 100-200 words. Use when you need to establish credibility or share data.',
    'long':       '6+ paragraphs. Only for warm contacts who want depth (proposal recap, detailed thinking, case studies).',
  };

  const ctaGuidance = {
    'auto':         'Pick the right CTA for the use case. Cold = soft (question or short call). Follow-up = same as cold but reference prior. Breakup = "should I close your file?". Demo recap = book-next-meeting.',
    'book-meeting': 'CTA: book a meeting via the booking link in context. Format: "Worth a 15-min chat next week? [link]" or similar.',
    'reply':        'CTA: ask for a one-line reply. Format: "Worth a quick call? Just hit reply with a yes or no."',
    'question':     'CTA: ask a specific question that\'s easy to answer. Should make them think but not require effort. e.g. "How are you tracking cost-per-pound today?"',
    'resource':     'CTA: offer a relevant resource (case study, guide, calculator). "I put together X — want me to send it over?"',
    'call':         'CTA: propose a quick phone call. "Mind if I grab 10 min on the phone next Tuesday?"',
  };

  const subjectGuidance = {
    'auto':         'Pick the strongest subject for this use case + tone.',
    'question':     'Subject is a specific question. e.g. "Is cost-per-pound on your radar?" or "{{company}} — quick question?"',
    'curiosity':    'Open a curiosity gap. Tease without revealing. e.g. "Saw {{company}} on the MED licensing list…" or "About your last harvest…"',
    'personalized': 'Lead with their first name or company. e.g. "{{firstName}} — quick thought" or "re: {{company}}"',
    'short':        '1-3 words max. e.g. "Quick question" or "Re: cost per pound"',
    'specific':     'Reference something specific only-they-know. Mutual contact, recent post, news. e.g. "Saw your post about METRC reporting"',
  };

  const systemPrompt =
    'You are a world-class B2B email copywriter — top 1% in the industry. You\'ve studied direct-response copywriting (Ogilvy, Halbert, Sugarman, Joanna Wiebe), modern outbound (Outreach.io playbook, Becc Holland, Josh Braun), and conversational copy (Gong frameworks). You write emails that get 30%+ reply rates because every word does work.\n\n' +
    'You\'re writing an email template for Matt Campbell at Hashio Inc. — B2B SaaS for licensed cannabis cultivators (compliance, scheduling, yield, cost-per-pound tracking).\n\n' +
    '## NON-NEGOTIABLES (these break the email if violated)\n' +
    '1. NEVER use: synergy, leverage, circle back, touch base, just checking in, ping you, low-hanging fruit, moving forward, deep dive, value-add, win-win, reach out, low-risk no-brainer, paradigm shift, game-changer, take this offline, drill down, ducks in a row, bandwidth, swim lanes.\n' +
    '2. NEVER open with: "I hope this finds you well", "I hope your week is going well", "Hope you\'re doing great", or any wellness check.\n' +
    '3. NEVER use exclamation points unless something genuinely warrants one (max 1 per email).\n' +
    '4. NEVER apologize for following up. Persistence is value, not pestering.\n' +
    '5. ALWAYS sign emails "— Matt" on its own line at the end.\n' +
    '6. ALWAYS use plain text (not markdown) — output uses \\n for line breaks.\n' +
    '7. ALWAYS include a single, specific CTA. No double-asks. No "let me know if you have questions" wishy-washy endings.\n' +
    '8. SUBJECT lines under 60 chars. Often shorter is stronger.\n' +
    '9. Use merge tags where they add specificity: {{firstName}}, {{lastName}}, {{company}}, {{title}}, {{role}}, {{state}}. Don\'t shoehorn — better to omit a tag than have it look stuffed in.\n' +
    '10. Cannabis cultivation context: reference real industry pain points when fitting — cost-per-pound, METRC reporting, multi-strain yield variance, harvest scheduling, GMP certification, multi-state expansion, Tier 1-3 licensing, indoor vs greenhouse vs outdoor, regulatory audits, K-12 / employee training, OSHA, state-specific compliance.\n' +
    '11. BOOKING LINKS: if your CTA proposes a meeting, paste ONLY a real URL from the list below — never invent calendly.com, hubspot.com, savvycal.com, or any other domain.\n\n' +
    '## BOOKING LINKS (real, active, verbatim only)\n' +
    getActiveBookingLinksBlock_() + '\n\n' +
    '## USE CASE\n' +
    useCaseDescription + (useCaseDetail ? '\nADDITIONAL CONTEXT: ' + useCaseDetail : '') + '\n\n' +
    '## AUDIENCE\n' +
    (audience || '(general — use merge tags + adapt body to context)') + '\n\n' +
    '## FRAMEWORK\n' +
    (frameworkGuidance[framework] || frameworkGuidance['auto']) + '\n\n' +
    '## TONE\n' +
    (toneGuidance[tone] || toneGuidance['direct']) + '\n\n' +
    '## LENGTH\n' +
    (lengthGuidance[length] || lengthGuidance['short']) + '\n\n' +
    '## CTA\n' +
    (ctaGuidance[ctaType] || ctaGuidance['auto']) + '\n\n' +
    '## SUBJECT LINE STYLE\n' +
    (subjectGuidance[subjectStyle] || subjectGuidance['auto']) + '\n\n' +
    (voiceSamples ? '## MATT\'S VOICE — match these samples\n' + voiceSamples + '\n\n' : '') +
    '## OUTPUT — STRICT JSON, NO MARKDOWN, NO PREAMBLE\n' +
    '{\n' +
    '  "name": "Short, descriptive template name (5-9 words, e.g. \\"Cold outreach — METRC reporting hook\\")",\n' +
    '  "subject": "Primary subject line",\n' +
    '  "body": "The full email body. Use \\\\n for line breaks. End with \\"— Matt\\" on its own line.",\n' +
    '  "alternativeSubjects": ["3 alternative subject lines, ranked best-to-worst"],\n' +
    '  "alternativeCtas": ["2-3 alternative CTAs (single-sentence each), if a different angle would work"],\n' +
    '  "useCaseNotes": "1-2 sentences: when to use this template, when NOT to use it, and what makes it work",\n' +
    '  "framework": "Which framework you actually used (e.g. \\"PAS\\" or \\"question-led\\")",\n' +
    '  "category": "Suggested folder name (e.g. \\"Cold outreach\\" or \\"Demo follow-up\\") — use existing folder if provided",\n' +
    '  "mergeTagsUsed": ["{{firstName}}", "{{company}}"]\n' +
    '}';

  const folderHint = folder ? '\n\nIMPORTANT: This template is being saved to the existing folder "' + folder + '". Set "category" to that folder name verbatim.' : '';

  const userMessage = 'Generate the JSON template. Strict JSON only.' + folderHint;

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 2500,
      system: withCompanyContext_(systemPrompt, 'aiBuildEmailTemplate'),
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Claude returned malformed JSON: ' + (e && e.message) + '. First 500 chars: ' + cleaned.slice(0, 500));
  }
  if (!parsed.subject || !parsed.body) {
    throw new Error('Claude returned an incomplete template (missing subject or body).');
  }
  parsed.model = model;
  parsed.generatedAt = new Date().toISOString();
  return parsed;
}


/* ---------- AI Sequence Builder ---------- */
/* Generates a complete multi-step outreach sequence with branching response
 * trees. Designed to produce the kind of sequence a top BDR would build —
 * multi-channel, persistent, personalized, with smart branching on opens,
 * clicks, and replies. */

function aiBuildSequence_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const goal           = payload.goal           || 'cold-outreach';
  const goalDetail     = payload.goalDetail     || '';
  const audience       = payload.audience       || '';
  const voiceSamples   = payload.voiceSamples   || '';   // pasted prior emails
  const channels       = payload.channels       || ['email'];   // email/linkedin/sms/phone
  const cadence        = payload.cadence        || 'standard';  // light/standard/aggressive
  const enableBranches = payload.enableBranches !== false;

  const cadenceMap = {
    light:      { touches: '5-6 touches over 2-3 weeks',  spacing: 'D1, D3, D6, D10, D15' },
    standard:   { touches: '7-9 touches over 3-4 weeks',  spacing: 'D1, D3, D5, D8, D12, D17, D24, D30' },
    aggressive: { touches: '10-12 touches over 5-6 weeks', spacing: 'D1, D2, D4, D6, D9, D13, D18, D24, D31, D38, D45' },
  };
  const cadenceInfo = cadenceMap[cadence] || cadenceMap.standard;

  const goalMap = {
    'cold-outreach':     'cold outreach to new prospects who don\'t know you yet',
    'warm-followup':     'follow-up with prospects who engaged (opened, clicked, downloaded) but haven\'t replied',
    'demo-followup':     'post-demo nurture for prospects who attended a demo and need next-step push',
    'customer-expansion': 'expansion outreach to existing customers — upsell, cross-sell, more seats',
    're-engagement':     're-engaging cold/dormant contacts who went silent 60+ days ago',
    'event-invite':      'invite to a webinar, event, or office hours',
    'custom':            goalDetail || 'custom goal',
  };
  const goalDescription = goalMap[goal] || goalMap['cold-outreach'];

  const channelGuidance = [];
  if (channels.indexOf('email') >= 0)    channelGuidance.push('email (primary channel — automated send via Gmail)');
  if (channels.indexOf('linkedin') >= 0) channelGuidance.push('LinkedIn (use action steps with kind="create-task" — Matt sends manually)');
  if (channels.indexOf('sms') >= 0)      channelGuidance.push('SMS (via Twilio — keep <320 chars, no links unless approved sender)');
  if (channels.indexOf('phone') >= 0)    channelGuidance.push('phone calls (use action steps with kind="create-task" + script in payload.notes — Matt makes the call)');

  const systemPrompt =
    'You are the most expert BDR sequence designer in the world, building a multi-touch outreach sequence ' +
    'for Matt Campbell at Hashio Inc. (B2B SaaS for licensed cannabis cultivators — compliance, scheduling, ' +
    'yield, cost-per-pound). Your sequences consistently outperform industry benchmarks because you follow ' +
    'every research-backed best practice:\n\n' +
    '## CORE PRINCIPLES\n' +
    '1. PERSISTENCE: Average B2B deal needs 7-12 touches. Sequences that stop at 3 leave money on the table.\n' +
    '2. MULTI-CHANNEL: Email + LinkedIn + phone outperforms email-only by 3-5x. Mix channels.\n' +
    '3. FRONT-LOADED CADENCE: Touches close together early, taper out. ' + cadenceInfo.spacing + '\n' +
    '4. THE 3-BY-3 RULE: Every cold touch references 3 specific facts about the prospect/company.\n' +
    '5. SHORT BODIES: 2-4 short paragraphs. Single, specific CTA. No "I hope this finds you well" garbage.\n' +
    '6. CURIOSITY SUBJECT LINES: Short (under 60 chars), specific, no jargon. Often a question.\n' +
    '7. BREAKUP EMAIL: Final touch should be a "permission to close your file" message. Counter-intuitively gets the highest reply rate of the sequence.\n' +
    '8. BRANCHING: Different content for opened-vs-not, clicked-vs-not, replied-vs-not. The sequence reacts intelligently.\n' +
    '9. VOICE: Warm, direct, low-key. NEVER use "synergy", "leverage", "circle back", "touch base", "just checking in", "ping you", "circle around", "moving forward", "low-hanging fruit". Sign emails "— Matt".\n' +
    '10. DON\'T APOLOGIZE for following up. Persistence is value, not pestering.\n' +
    '11. BOOKING LINKS — when an email or SMS step proposes a meeting/demo/call, you MUST paste a real URL from the BOOKING LINKS block below VERBATIM. NEVER invent calendly.com, hubspot.com, savvycal.com, calendar.google.com, or any other domain. NEVER use a placeholder like [link] or {{link}}. If no booking link is suitable, write "I\'ll send a few times that work" instead of any URL.\n\n' +
    '## BOOKING LINKS (real, active, verbatim only)\n' +
    getActiveBookingLinksBlock_() + '\n\n' +
    '## SEQUENCE STRUCTURE TEMPLATE (adapt to the goal)\n' +
    'For cold outreach with branching:\n' +
    '  Step 0: D1 intro email (specific value, single CTA)\n' +
    '  Step 1: Wait 3 days\n' +
    '  Step 2: Branch — did they reply?\n' +
    '    [reply]    → exit (replyBehavior:"exit" handles this in the email itself; branch checks for opens/clicks instead)\n' +
    '  Step 3: Branch — did they open the first email?\n' +
    '    [opened]   → soft-bump email referencing the open\n' +
    '    [no-open]  → completely different angle (different stakeholder, different value prop, different format like a question-only email)\n' +
    '  Step N: LinkedIn task (manual), follow-up emails, etc.\n' +
    '  Final step: Breakup email — "Should I close your file?"\n\n' +
    '## OUTPUT SCHEMA — STRICT JSON, NO MARKDOWN, NO PREAMBLE\n' +
    '{\n' +
    '  "name": "Short, descriptive sequence name (under 60 chars)",\n' +
    '  "description": "1-2 sentence summary: who, what, how many touches, what makes it work",\n' +
    '  "rationale": "1-2 sentences explaining the structural decisions you made",\n' +
    '  "steps": [\n' +
    '    {\n' +
    '      "type": "email" | "sms" | "wait" | "branch" | "action",\n' +
    '      "label": "Human-readable step label e.g. \\"Day 1 — Intro email\\"",\n' +
    '      "config": { ... shape varies by type ... }\n' +
    '    }\n' +
    '  ]\n' +
    '}\n\n' +
    '## CONFIG SHAPES\n' +
    'EMAIL config:\n' +
    '  { "subject": "...", "body": "...", "trackOpens": true, "replyBehavior": "exit" }\n' +
    '  Body supports merge tags: {{firstName}}, {{lastName}}, {{company}}, {{title}}, {{state}}, {{role}}.\n' +
    '  Body should be plain text with line breaks (use \\n for newlines).\n' +
    '  Sign every email "— Matt" on its own line.\n' +
    '  Single CTA per email — booking link, reply prompt, or specific question.\n\n' +
    'SMS config:\n' +
    '  { "body": "...", "replyBehavior": "exit" }\n' +
    '  Under 320 chars. Plain text. Same merge tags.\n\n' +
    'WAIT config:\n' +
    '  { "amount": <number>, "unit": "hours"|"days"|"weeks"|"businessDays" }\n\n' +
    'BRANCH config:\n' +
    '  { "condition": { "kind": "opened-last"|"clicked-last"|"replied", "withinHours": 72 }, "trueNext": <step idx>, "falseNext": <step idx> }\n' +
    '  trueNext/falseNext are 0-based indexes into the steps array.\n' +
    '  Use these to send different content based on engagement signals.\n\n' +
    'ACTION config:\n' +
    '  { "kind": "create-task"|"update-contact"|"update-deal-stage"|"notify-owner"|"end-sequence"|"unsubscribe-contact", "payload": {...} }\n' +
    '  For LinkedIn touches, use kind="create-task" with payload.title="LinkedIn: connect/message {{firstName}}" and payload.notes="<script for Matt>"\n' +
    '  For phone calls, same: kind="create-task" with payload.title="Call {{firstName}}" and payload.notes="<phone script>"\n\n' +
    '## ABOUT THIS SEQUENCE\n' +
    'GOAL: ' + goalDescription + (goalDetail ? '\nADDITIONAL CONTEXT: ' + goalDetail : '') + '\n' +
    'AUDIENCE: ' + (audience || '(general — adapt subject/body to the merge-tag fields)') + '\n' +
    'CADENCE: ' + cadenceInfo.touches + '\n' +
    'CHANNELS TO USE: ' + (channelGuidance.length ? channelGuidance.join(', ') : 'email only') + '\n' +
    'BRANCHING: ' + (enableBranches ? 'YES — design a branching response tree based on opens/clicks/replies' : 'NO — linear sequence only') + '\n' +
    (voiceSamples ? '\n## MATT\'S VOICE (study these prior emails to match his tone, sentence patterns, signoffs, and vocabulary)\n' + voiceSamples + '\n' : '') +
    '\nGenerate the sequence now. Be detailed. Each email should reference specific, plausible value-props for cannabis cultivators (cost-per-pound, harvest scheduling, METRC compliance, multi-strain operations, multi-state expansion, GMP certification, regulatory audits, yield optimization, labor scheduling, etc.). Differentiate each touch — never reuse the same hook twice.';

  const userMessage = 'Generate the JSON sequence definition. Match the schema exactly. Strict JSON only.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 8000,
      system: withCompanyContext_(systemPrompt, 'aiBuildSequence'),
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error('Claude returned malformed JSON: ' + (e && e.message) + '. First 500 chars: ' + cleaned.slice(0, 500));
  }
  if (!parsed.steps || !Array.isArray(parsed.steps)) {
    throw new Error('Claude returned a sequence with no steps array.');
  }
  parsed.model = model;
  parsed.generatedAt = new Date().toISOString();
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
      system: withCompanyContext_(systemPrompt, 'aiEnrichLead'),
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

/* ---------- AI Contact enrichment — infer role from title etc ---------- */
const CONTACT_ROLE_OPTIONS_ = [
  'Executive', 'Operations', 'Cultivation', 'Compliance', 'Finance',
  'Sales', 'Marketing', 'Procurement', 'IT / Tech', 'HR / People',
  'Legal', 'Quality', 'Other',
];

function aiEnrichContact_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const contact = payload.contact || {};

  const systemPrompt =
    'You are the smartest, most skeptical BDR enrichment system for Matt Campbell\'s CRM at Hashio Inc. ' +
    '(B2B SaaS for cannabis cultivators). You do TWO jobs at once:\n\n' +
    '1) ENRICH — fill missing fields you can confidently infer.\n' +
    '2) FLAG — detect obvious data-quality mismatches that suggest the record is junk.\n\n' +
    '— ENRICH —\n' +
    'Map `title` to a standard role: ' + CONTACT_ROLE_OPTIONS_.join(', ') + '.\n' +
    '- Founder/CEO/President/COO/CFO/Owner → Executive\n' +
    '- Director of Operations/Ops Manager/General Manager → Operations\n' +
    '- Head Grower/Master Grower/Cultivation Director → Cultivation\n' +
    '- Compliance/QA → Compliance (or Quality if QA-specific)\n' +
    '- CFO/Controller/Bookkeeper → Finance\n' +
    '- Sales/BD/AE/Wholesale → Sales\n' +
    '- Marketing/Brand/CMO → Marketing\n' +
    '- Buyer/Procurement → Procurement\n' +
    '- Ambiguous → Other. Truly unknown → empty.\n\n' +
    '— FLAG (be CONFIDENT, not wishy-washy) —\n' +
    'Set `flagged: true` and `flagReason` if any of these mismatches apply:\n' +
    '- Generic admin/role-based email (info@, contact@, hello@, sales@, support@, admin@, office@, team@, hi@) ' +
    'paired with a SPECIFIC PERSON title (CEO, Founder, Director, Manager, etc). These are SHARED INBOXES, not people. FLAG them.\n' +
    '- Email domain doesn\'t plausibly match the company (e.g. ceo@gmail.com claiming to be at "Acme Cultivation Inc"). ' +
    'Founders sometimes use personal emails — only flag if the title is very senior AND the domain is generic (gmail/yahoo/hotmail/outlook).\n' +
    '- "Test", "demo", "example", "noreply", "no-reply" anywhere in name/email/title → FLAG.\n' +
    '- Title looks pasted-in-wrong (e.g. "John Smith" with title "Acme Inc"; or title="Cultivator" at a software company).\n' +
    '- Same email, same first name and last name as a clearly different person\'s record (cross-check best you can with the data given).\n' +
    '- Missing both name AND title (just an email floating around).\n\n' +
    'When you flag: write a CRISP one-line flagReason like "info@ email with CEO title — likely shared inbox, recommend deletion or research" or ' +
    '"Personal Gmail at corporate — verify if founder or scrape error".\n\n' +
    'Return STRICT JSON only — no markdown:\n' +
    '{\n' +
    '  "role": "standard role or empty",\n' +
    '  "title": "best-guess title if missing, else empty (do NOT overwrite if provided)",\n' +
    '  "linkedinSearchUrl": "linkedin.com/search URL guess, else empty",\n' +
    '  "notes": "1 short sentence of useful context",\n' +
    '  "flagged": true | false,\n' +
    '  "flagReason": "one-line reason if flagged, else empty",\n' +
    '  "recommendation": "keep" | "research" | "delete" (if flagged, what to do; else empty),\n' +
    '  "confidence": 0-100\n' +
    '}';

  const userMessage = 'Contact to enrich:\n' + JSON.stringify(contact, null, 2);

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 400,
      system: withCompanyContext_(systemPrompt, 'aiEnrichContact'),
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

/** Bulk enrichment — one Claude call to process up to 50 contacts.
 *  Returns map of contactId → { role, confidence }. */
function aiEnrichContactsBulk_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const contacts = (payload.contacts || []).slice(0, 50);
  if (contacts.length === 0) return { results: [] };

  const systemPrompt =
    'You are the smartest, most skeptical BDR enrichment system for Matt Campbell\'s CRM at Hashio Inc. ' +
    '(B2B SaaS for cannabis cultivators). For each contact in this batch, you do TWO jobs:\n\n' +
    '1) CATEGORIZE — map their `title` to ONE of: ' + CONTACT_ROLE_OPTIONS_.join(', ') + '.\n' +
    '   - Founder/CEO/President/COO/CFO/Owner → Executive\n' +
    '   - Director of Operations/Ops Manager/General Manager → Operations\n' +
    '   - Head Grower/Master Grower/Cultivation Director → Cultivation\n' +
    '   - Compliance/QA → Compliance or Quality\n' +
    '   - CFO/Controller/Bookkeeper → Finance\n' +
    '   - Sales/BD/AE/Wholesale → Sales\n' +
    '   - Marketing/Brand/CMO → Marketing\n' +
    '   - Buyer/Procurement → Procurement\n' +
    '   - Ambiguous → Other. Unknown → empty role.\n\n' +
    '2) FLAG mismatches — be CONFIDENT, not wishy-washy.\n' +
    'Set `flagged: true` and `flagReason` if ANY of these apply:\n' +
    ' - Generic admin/role email (info@, contact@, hello@, sales@, support@, admin@, office@, team@, hi@) ' +
    'paired with a specific person\'s title (CEO, Founder, Director, etc). These are SHARED INBOXES, not people.\n' +
    ' - Personal email (gmail/yahoo/hotmail/outlook) at a senior corporate title — could be founder, but worth verifying.\n' +
    ' - "Test", "demo", "example", "noreply" in name/email/title.\n' +
    ' - Title looks like a company name (e.g. title="Acme Inc").\n' +
    ' - Missing both name AND title — just an email floating around.\n\n' +
    'flagReason should be ONE crisp line. recommendation should be "keep" / "research" / "delete".\n\n' +
    'Return STRICT JSON only:\n' +
    '{\n' +
    '  "results": [ {\n' +
    '    "id": "contact-id",\n' +
    '    "role": "Operations",\n' +
    '    "flagged": true | false,\n' +
    '    "flagReason": "one-line reason if flagged, else empty",\n' +
    '    "recommendation": "keep" | "research" | "delete" | "",\n' +
    '    "confidence": 0-100\n' +
    '  } ]\n' +
    '}';

  const userMessage = 'Contacts to categorize + flag (' + contacts.length + ' total):\n' +
    JSON.stringify(contacts.map(function (c) {
      return { id: c.id, firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '', title: c.title || '', company: c.company || '', role: c.role || '' };
    }), null, 2);

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_API_VERSION_ },
    payload: JSON.stringify({
      model: model,
      max_tokens: 4000,
      system: withCompanyContext_(systemPrompt, 'aiEnrichContactsBulk'),
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = { results: [] };
  try { parsed = JSON.parse(cleaned); } catch (e) { /* return empty */ }
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
      system: withCompanyContext_(systemPrompt, 'aiStrategistProposals'),
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


/* ---------- Knowledge Bank — interview wizard + source summarization ---------- */

/** Returns the next interview question given prior Q/A. The interview
 *  walks Matt through ~12 topics (company, ICP, value props, objections,
 *  competition, pricing, voice, etc.) but adapts based on prior answers
 *  — short answers trigger follow-ups, long answers move to the next topic.
 *
 *  Input:  { history: [{question, answer}, ...] }
 *  Output: { question: "...", topicLabel: "...", done: bool, progress: 0-100 }
 */
function aiNextInterviewQuestion_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const history = Array.isArray(payload.history) ? payload.history : [];

  const systemPrompt =
    'You are running a structured discovery interview for a founder named Matt Campbell who runs Hashio Inc. ' +
    '(B2B SaaS for cannabis cultivators). Your job is to extract the company knowledge that an AI BDR ' +
    'needs to write outstanding outbound: company positioning, ICP, value props, common objections, ' +
    'competitor angles, pricing model, demo flow, voice/tone, and red flags.\n\n' +
    '## TOPICS (cover all in roughly this order — but skip topics already answered)\n' +
    '1. Company in one sentence — what you sell, who buys it\n' +
    '2. ICP — title + company-size + industry of the BUYER (who signs the check)\n' +
    '3. CHAMPION inside the buyer org — who feels the pain, advocates internally\n' +
    '4. Top 3 value props — concrete, quantified if possible\n' +
    '5. Top 3 objections you hear and how you handle each\n' +
    '6. Top 2-3 competitors and how you win against them\n' +
    '7. Pricing model + typical first-year deal size\n' +
    '8. What makes a great demo — flow, "wow moments"\n' +
    '9. Best customer story / case study you reference in outbound\n' +
    '10. Red flags / deal-killers / poor-fit signals\n' +
    '11. Voice/tone — describe how you want emails to sound (3-5 adjectives)\n' +
    '12. Anything else AI should know — quirky details, internal jargon, must-mention\n\n' +
    '## RULES\n' +
    '- Ask ONE question at a time. Make it conversational, not a survey.\n' +
    '- If the prior answer was vague or short, ask a follow-up that pulls more specifics. ' +
    'But don\'t over-drill — 1 follow-up max per topic.\n' +
    '- Don\'t restate prior answers. Just ask the next question.\n' +
    '- After all 12 topics are well-covered, return {"done": true, "question": ""}.\n\n' +
    '## OUTPUT — STRICT JSON, NO MARKDOWN\n' +
    '{\n' +
    '  "question": "the next question to ask Matt (1-2 sentences max)",\n' +
    '  "topicLabel": "short label for what topic this is, e.g. \\"ICP\\" or \\"Objections\\"",\n' +
    '  "topicIndex": 1-12,\n' +
    '  "progress": 0-100,\n' +
    '  "done": false\n' +
    '}';

  const userMessage = history.length === 0
    ? 'No history yet — ask the first question.'
    : 'Interview so far:\n' + history.map(function (qa, i) {
        return '[' + (i + 1) + '] Q: ' + qa.question + '\n    A: ' + qa.answer;
      }).join('\n\n') + '\n\nWhat\'s the next question?';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_API_VERSION_,
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 400,
      // Inject prior knowledge so the interview knows which topics are
      // already covered (avoids redundant questions) and can ask sharper
      // follow-ups grounded in what Matt has already said.
      system: withCompanyContext_(systemPrompt, 'aiNextInterviewQuestion'),
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = { question: '', topicLabel: '', topicIndex: 0, progress: 0, done: false };
  try { parsed = JSON.parse(cleaned); } catch (e) { /* fall through */ }
  parsed.model = model;
  return parsed;
}

/** Compresses a long pasted source (transcript, doc, battlecard) into a
 *  structured summary the AI can use without burning context tokens.
 *
 *  Input:  { title, content, kind?: 'transcript'|'document'|'battlecard'|'pricing'|'casestudy'|'other' }
 *  Output: { summary: "markdown bullets", model }
 */
function aiSummarizeKnowledge_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  const title   = (payload.title || 'Untitled source').toString();
  const kind    = (payload.kind  || 'other').toString();
  const content = (payload.content || '').toString();
  if (!content.trim()) throw new Error('No content to summarize.');

  // Cap input at ~80K chars (~20K tokens) to stay safe of model limits.
  const trimmed = content.length > 80000 ? content.slice(0, 80000) + '\n[truncated]' : content;

  const systemPrompt =
    'You compress sales/company sources into compact, structured summaries that an AI BDR can use as ' +
    'reference. Pull out: key claims, numbers, customer quotes, objections + responses, competitor ' +
    'moves, pricing details, "wow moments" from demos, and any concrete soundbites. ' +
    'Discard fluff. No preamble. Markdown bullets only. Aim for 200-600 words. If the source is short ' +
    '(under 1500 chars), return the original cleaned up.';

  const userMessage =
    'Source title: ' + title + '\n' +
    'Source kind: ' + kind + '\n\n' +
    '---BEGIN SOURCE---\n' + trimmed + '\n---END SOURCE---\n\n' +
    'Compress this into a structured summary an AI BDR will reference when writing outbound for this company.';

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
      // Inject prior knowledge so summaries lock onto what's relevant for
      // THIS company (Claude pulls out the right quotes / objections / numbers
      // instead of generic ones).
      system: withCompanyContext_(systemPrompt, 'aiSummarizeKnowledge'),
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const text = (json.content && json.content[0] && json.content[0].text) || '';
  return { summary: text.trim(), model: model };
}

/** Master compactor — takes EVERY enabled knowledge item and asks Claude to
 *  produce one tight, structured summary (~800-1500 words) that captures
 *  everything an AI BDR needs. The user then saves this as a new "compact"
 *  item and disables the originals — drops the AI context block from
 *  ~14k tokens to ~2-3k.
 *
 *  Returns: { compact: "markdown", inputChars, inputItems, estimatedSavings, model }
 */
function aiCompactKnowledge_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  const model = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_MODEL') || ANTHROPIC_DEFAULT_MODEL_;
  if (!key) throw new Error('Anthropic not configured.');

  // Gather every enabled item.
  let rows;
  try { rows = readTab_('Knowledge'); }
  catch (e) { throw new Error('Knowledge tab not found.'); }
  if (!rows || !rows.length) throw new Error('Your knowledge bank is empty — nothing to compact.');

  const enabled = rows.filter(function (r) { return r.enabled !== false && r.enabled !== 'false'; });
  if (!enabled.length) throw new Error('No enabled knowledge items.');

  // Concatenate. Use raw content (not summary) — we want the compactor to
  // see EVERYTHING and decide what's important itself.
  const blocks = enabled.map(function (r) {
    const title = (r.title || 'Untitled').trim();
    const body = (r.content || r.summary || '').trim();
    return '## ' + title + ' (' + (r.type || 'note') + ')\n' + body;
  });
  let inputText = blocks.join('\n\n---\n\n');

  // Cap at ~120K chars (~30K tokens) to stay safe — anything beyond that
  // is unlikely to fit usefully in a single Claude call anyway.
  if (inputText.length > 120000) {
    inputText = inputText.slice(0, 120000) + '\n\n[INPUT TRUNCATED — knowledge bank was very large; some later items not included]';
  }
  const inputChars = inputText.length;

  const systemPrompt =
    'You are a master sales-context compressor. Your job: take EVERY note, transcript, ' +
    'interview answer, and source the user has dumped about their company, and produce ' +
    'ONE tight, structured master summary that an AI BDR can use as the company knowledge ' +
    'base going forward.\n\n' +
    '## OUTPUT TARGET\n' +
    '- Length: 800-1500 words. Brutal compression. No filler. No "this document covers...".\n' +
    '- Format: markdown with these section headers (skip a section only if you have nothing for it):\n' +
    '  ### Company in one line\n' +
    '  ### What we sell + how it works\n' +
    '  ### ICP (buyer + champion)\n' +
    '  ### Top value props (with proof points / quantified where possible)\n' +
    '  ### Common objections + responses\n' +
    '  ### Competitive positioning\n' +
    '  ### Pricing model\n' +
    '  ### Demo flow + wow moments\n' +
    '  ### Customer stories worth referencing\n' +
    '  ### Voice / tone (3-5 adjectives + style notes)\n' +
    '  ### Red flags / deal-killers\n' +
    '  ### Internal jargon / must-mention details\n\n' +
    '## RULES\n' +
    '- Pull out concrete soundbites, customer quotes, numbers — those are the gold.\n' +
    '- Drop fluff, repetition, and meta-commentary.\n' +
    '- If two sources contradict, prefer the more specific / recent one and note the conflict in 1 line.\n' +
    '- DO NOT add anything that isn\'t supported by the source material.\n' +
    '- DO NOT preface with "Here is the summary..." — start directly with the first ### header.';

  const userMessage =
    '=== ALL KNOWLEDGE ITEMS (' + enabled.length + ' items, ' + inputChars + ' chars) ===\n\n' +
    inputText +
    '\n\n=== END ===\n\nProduce the master compressed summary now.';

  const res = UrlFetchApp.fetch(ANTHROPIC_API_URL_, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_API_VERSION_,
    },
    payload: JSON.stringify({
      model: model,
      max_tokens: 4000,
      // Don't wrap — this IS the compaction job; we don't want recursion.
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Claude API HTTP ' + code + ': ' + res.getContentText().slice(0, 300));
  const json = JSON.parse(res.getContentText());
  const compact = ((json.content && json.content[0] && json.content[0].text) || '').trim();

  return {
    compact: compact,
    inputChars: inputChars,
    inputItems: enabled.length,
    inputItemIds: enabled.map(function (r) { return r.id; }),
    compactChars: compact.length,
    estimatedTokensIn:  Math.round(inputChars / 4),
    estimatedTokensOut: Math.round(compact.length / 4),
    model: model,
  };
}


/* ---------- Daily Digest — 8am proactive briefing email ---------- */
/* Time-trigger fires every morning, builds a digest from the Sheet,
 * calls aiDashboardBriefing_, and emails Matt the priorities. The
 * email includes one-click links to each priority entity in the CRM.
 */

const DIGEST_PROP_RECIPIENT = 'DIGEST_RECIPIENT';
const DIGEST_PROP_HOUR = 'DIGEST_HOUR';
const DIGEST_PROP_LASTRUN = 'DIGEST_LASTRUN';
const DIGEST_TRIGGER_FN = 'dailyDigestCron';

/** Public function the time-trigger fires. Wraps the implementation to
 *  swallow errors so the cron doesn't disable itself. */
function dailyDigestCron() {
  try {
    sendDailyDigest_('');
  } catch (err) {
    Logger.log('dailyDigest error: ' + (err && err.message));
  }
}

/** Build a minimal digest from Sheet tabs + call Claude + email it. */
function sendDailyDigest_(overrideRecipient) {
  const props = PropertiesService.getScriptProperties();
  const recipient = (overrideRecipient || props.getProperty(DIGEST_PROP_RECIPIENT) || Session.getActiveUser().getEmail() || '').trim();
  if (!recipient) throw new Error('No recipient configured for daily digest. Set one in Settings.');

  const digest = buildDigestFromSheet_();
  const briefing = aiDashboardBriefing_({ digest: digest });
  const html = renderDigestHtml_(briefing, digest);
  const subject = '☀️ Hashio BDR — ' + (briefing.greeting || 'Daily briefing');

  GmailApp.sendEmail(recipient, subject, briefingPlainText_(briefing, digest), {
    htmlBody: html,
    name: 'Hashio AI BDR',
  });

  props.setProperty(DIGEST_PROP_LASTRUN, new Date().toISOString());
  return { sent: true, recipient: recipient, sentAt: new Date().toISOString(), priorityCount: (briefing.priorities || []).length };
}

/** Read the Sheet and build the same digest shape the frontend uses. */
function buildDigestFromSheet_() {
  const ss = getSpreadsheet_();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const dayOfWeek = today.toLocaleDateString('en-US', { weekday: 'long' });
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = today.getTime();

  function readTab(name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return [];
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return [];
    const headers = data[0].map(String);
    return data.slice(1).map(function (row) {
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i];
      return obj;
    });
  }

  const contacts = readTab('Contacts');
  const companies = readTab('Companies');
  const deals = readTab('Deals');
  const tasks = readTab('Tasks');
  const emailSends = readTab('EmailSends');
  const leads = readTab('Leads');
  const bookings = readTab('Bookings');

  // Replies waiting (last 7d)
  const repliesWaiting = emailSends
    .filter(function (s) {
      if (!s.repliedAt) return false;
      const t = new Date(s.repliedAt).getTime();
      return !isNaN(t) && (now - t) < 7 * DAY_MS;
    })
    .map(function (s) {
      const c = contacts.find(function (x) { return x.id === s.contactId; });
      return {
        sendId: s.id,
        contactId: s.contactId,
        contactName: c ? (c.firstName + ' ' + c.lastName) : s.to,
        subject: s.subject,
        repliedAt: s.repliedAt,
        hoursAgo: Math.floor((now - new Date(s.repliedAt).getTime()) / 3600000),
      };
    })
    .sort(function (a, b) { return a.hoursAgo - b.hoursAgo; })
    .slice(0, 5);

  // Hot leads (score >= 50, unconverted)
  const scoredLeads = leads
    .filter(function (l) { return l.status !== 'archived' && l.status !== 'converted'; })
    .map(function (l) {
      const score = Number(l.score) || 0;
      let temperature = 'cold';
      if (score >= 80) temperature = 'molten';
      else if (score >= 50) temperature = 'hot';
      else if (score >= 25) temperature = 'warm';
      return Object.assign({}, l, { _score: score, _temperature: temperature });
    });
  const hotLeads = scoredLeads
    .filter(function (l) { return l._temperature === 'hot' || l._temperature === 'molten'; })
    .sort(function (a, b) { return b._score - a._score; })
    .slice(0, 5)
    .map(function (l) {
      return {
        leadId: l.id,
        name: (l.firstName + ' ' + l.lastName).trim(),
        company: l.companyName,
        title: l.title || l.headline,
        score: l._score,
        temperature: l._temperature,
        lastSignal: l.lastSignalAt,
      };
    });

  // Today's bookings
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayEnd = todayStart + DAY_MS;
  const todaysBookings = bookings
    .filter(function (b) {
      if (b.status !== 'confirmed') return false;
      const t = new Date(b.slotStart).getTime();
      return t >= todayStart && t < todayEnd;
    })
    .map(function (b) {
      return {
        bookingId: b.id,
        attendee: b.attendeeName || b.attendeeEmail,
        slotStart: b.slotStart,
        notes: (b.attendeeNotes || '').slice(0, 100),
      };
    });

  // Stale high-value deals
  const staleDeals = deals
    .filter(function (d) { return !String(d.stage || '').startsWith('Closed') && (Number(d.value) || 0) >= 5000; })
    .map(function (d) {
      const lastEmail = emailSends
        .filter(function (s) { return s.contactId === d.contactId && s.sentAt; })
        .reduce(function (max, s) { return Math.max(max, new Date(s.sentAt).getTime()); }, 0);
      const lastUpdate = new Date(d.updatedAt || d.createdAt || 0).getTime();
      const lastActivity = Math.max(lastEmail, lastUpdate);
      const daysQuiet = Math.floor((now - lastActivity) / DAY_MS);
      const c = d.contactId ? contacts.find(function (x) { return x.id === d.contactId; }) : null;
      return {
        dealId: d.id,
        title: d.title,
        stage: d.stage,
        value: Number(d.value) || 0,
        contactName: c ? (c.firstName + ' ' + c.lastName) : '',
        daysQuiet: daysQuiet,
      };
    })
    .filter(function (d) { return d.daysQuiet >= 14; })
    .sort(function (a, b) { return b.value - a.value; })
    .slice(0, 5);

  // Pipeline shape
  const openDeals = deals.filter(function (d) { return !String(d.stage || '').startsWith('Closed'); });
  const dealsByStage = {};
  openDeals.forEach(function (d) { dealsByStage[d.stage] = (dealsByStage[d.stage] || 0) + 1; });
  const pipelineValue = openDeals.reduce(function (s, d) { return s + (Number(d.value) || 0); }, 0);
  const weightedPipeline = openDeals.reduce(function (s, d) {
    return s + (Number(d.value) || 0) * ((Number(d.probability) || 0) / 100);
  }, 0);
  const activeMRR = deals
    .filter(function (d) { return d.stage === 'Closed Won' && d.mrrStatus === 'active'; })
    .reduce(function (s, d) { return s + (Number(d.mrr) || 0); }, 0);

  // Tasks due today
  const dueTasks = tasks
    .filter(function (t) {
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      if (!t.dueDate) return false;
      return new Date(t.dueDate).getTime() < todayEnd;
    })
    .slice(0, 10)
    .map(function (t) {
      return { taskId: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority };
    });

  return {
    today: todayIso,
    dayOfWeek: dayOfWeek,
    repliesWaiting: repliesWaiting,
    hotLeads: hotLeads,
    todaysBookings: todaysBookings,
    staleDeals: staleDeals,
    dealsByStage: dealsByStage,
    pipeline: {
      openCount: openDeals.length,
      totalValue: pipelineValue,
      weightedValue: weightedPipeline,
      activeMRR: activeMRR,
    },
    leadCounts: {
      total: scoredLeads.length,
      hot: hotLeads.length,
    },
    dueTasks: dueTasks,
    companyCount: companies.length,
  };
}

/** Pretty HTML email with priority cards + links to the live app. */
function renderDigestHtml_(briefing, digest) {
  const appUrl = 'https://mattc1987.github.io/hashio-crm';
  const accent = '#7a5eff';
  const muted = '#777';
  const body = '#222';

  const priorityHtml = (briefing.priorities || []).map(function (p, i) {
    let link = appUrl + '/#/dashboard';
    if (p.entityType === 'contact' && p.entityId) link = appUrl + '/#/contacts/' + p.entityId;
    else if (p.entityType === 'deal' && p.entityId) link = appUrl + '/#/deals/' + p.entityId;
    else if (p.entityType === 'lead') link = appUrl + '/#/leads';
    else if (p.entityType === 'task') link = appUrl + '/#/tasks';
    else if (p.entityType === 'booking') link = appUrl + '/#/scheduling';
    else if (p.entityType === 'find-leads') link = appUrl + '/#/leads';

    const urgencyColor = p.urgency === 'critical' ? '#ef4c4c' : p.urgency === 'high' ? '#f5a524' : accent;

    return '<tr><td style="padding:10px 14px;border-left:3px solid ' + urgencyColor + ';background:#fafafa;border-radius:6px;">' +
      '<div style="font-size:14px;font-weight:600;color:' + body + ';margin-bottom:4px;">' + (i + 1) + '. ' + escapeHtml_(p.title || '') + '</div>' +
      '<div style="font-size:13px;color:' + muted + ';line-height:1.4;margin-bottom:6px;">' + escapeHtml_(p.reason || '') + '</div>' +
      '<a href="' + link + '" style="font-size:12px;color:' + accent + ';text-decoration:none;font-weight:500;">Open in Hashio →</a>' +
      '</td></tr><tr><td style="height:8px;"></td></tr>';
  }).join('');

  const pipelineHealth = briefing.pipelineHealth || { status: 'healthy', comment: '' };
  const healthBg = pipelineHealth.status === 'critical' ? '#fef0f0' :
                   pipelineHealth.status === 'thin' ? '#fef7e6' : '#f0f9f4';
  const healthColor = pipelineHealth.status === 'critical' ? '#c0322a' :
                      pipelineHealth.status === 'thin' ? '#946400' : '#1f7c43';

  const html = [
    '<!DOCTYPE html>',
    '<html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f7;padding:24px 0;">',
      '<tr><td align="center">',
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.06);">',
        '<tr><td style="padding:24px 28px 12px;">',
          '<div style="font-size:11px;font-weight:600;color:' + accent + ';text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">AI BDR · Daily briefing</div>',
          '<div style="font-size:20px;font-weight:600;color:' + body + ';margin-bottom:8px;">' + escapeHtml_(briefing.greeting || 'Good morning.') + '</div>',
          '<div style="font-size:14px;color:' + body + ';line-height:1.55;">' + escapeHtml_(briefing.narrative || '') + '</div>',
          '<div style="margin-top:14px;padding:10px 14px;background:' + healthBg + ';color:' + healthColor + ';border-radius:8px;font-size:12px;">',
            '<strong>Pipeline ' + escapeHtml_(pipelineHealth.status) + ':</strong> ' + escapeHtml_(pipelineHealth.comment || ''),
          '</div>',
        '</td></tr>',
        '<tr><td style="padding:8px 28px 8px;">',
          '<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.06em;margin:14px 0 10px;">Today\'s priorities</div>',
          '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' + priorityHtml + '</table>',
        '</td></tr>',
        '<tr><td style="padding:14px 28px 24px;border-top:1px solid #eee;font-size:11px;color:' + muted + ';">',
          'Sent by your AI BDR · <a href="' + appUrl + '" style="color:' + accent + ';">Open Hashio</a> · ',
          'Generated at ' + new Date().toLocaleString() + ' · Model: ' + escapeHtml_(briefing.model || 'unknown') +
        '</td></tr>',
      '</table>',
      '</td></tr>',
    '</table>',
    '</body></html>',
  ].join('');
  return html;
}

function briefingPlainText_(briefing, digest) {
  const lines = [];
  lines.push((briefing.greeting || 'Good morning.'));
  lines.push('');
  lines.push(briefing.narrative || '');
  lines.push('');
  lines.push('TODAY\'S PRIORITIES:');
  (briefing.priorities || []).forEach(function (p, i) {
    lines.push('');
    lines.push((i + 1) + '. ' + p.title);
    lines.push('   ' + p.reason);
  });
  lines.push('');
  lines.push('Open Hashio: https://mattc1987.github.io/hashio-crm');
  return lines.join('\n');
}

function escapeHtml_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function installDailyDigestTrigger_(hour, recipient) {
  const props = PropertiesService.getScriptProperties();
  if (recipient) props.setProperty(DIGEST_PROP_RECIPIENT, recipient.trim());
  props.setProperty(DIGEST_PROP_HOUR, String(hour || 8));

  // Remove old triggers for the digest fn
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === DIGEST_TRIGGER_FN) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed += 1;
    }
  }
  ScriptApp.newTrigger(DIGEST_TRIGGER_FN).timeBased().atHour(hour || 8).everyDays(1).create();

  return getDailyDigestStatus_();
}

function uninstallDailyDigestTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === DIGEST_TRIGGER_FN) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed += 1;
    }
  }
  return { uninstalled: true, removed: removed };
}

function getDailyDigestStatus_() {
  const props = PropertiesService.getScriptProperties();
  const recipient = props.getProperty(DIGEST_PROP_RECIPIENT) || '';
  const hour = Number(props.getProperty(DIGEST_PROP_HOUR) || 8);
  const lastRun = props.getProperty(DIGEST_PROP_LASTRUN) || '';
  const triggers = ScriptApp.getProjectTriggers();
  let installed = false;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === DIGEST_TRIGGER_FN) {
      installed = true;
      break;
    }
  }
  return {
    installed: installed,
    recipient: recipient,
    hour: hour,
    lastRun: lastRun,
    defaultRecipient: Session.getActiveUser().getEmail() || '',
  };
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

  // Append email signature to plain + HTML bodies. GmailApp.sendEmail does
  // NOT auto-pull the user's Gmail signature, so we append it here.
  // Skipped if `opts.skipSignature` is true (used for cron-internal mails).
  const sig = opts.skipSignature ? { plain: '', html: '' } : getEmailSignature_();
  const plainWithSig = sig.plain
    ? (opts.body || '') + '\n\n-- \n' + sig.plain
    : (opts.body || '');

  // Wrap URLs so we can record clicks. Build HTML from the SIGNED plain
  // body so the signature inherits the same link-tracking treatment for
  // any URLs in it (e.g. booking links you've added to your sig).
  const htmlBodyCore = webAppUrl
    ? plainToHtmlWithTracking_(plainWithSig, sendId, webAppUrl)
    : plainToHtml_(plainWithSig);
  const htmlBody = htmlBodyCore + (pixelUrl ? ('<img src="' + pixelUrl + '" width="1" height="1" alt="" style="display:none" />') : '');

  // Send
  GmailApp.sendEmail(opts.to, opts.subject, plainWithSig, {
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

/** Public function the time-trigger fires for inbound-email scanning. */
function scanInboundEmailsCron() {
  try {
    scanInboundEmails_(7); // weekly window for the auto-run
  } catch (err) {
    Logger.log('scanInboundEmails error: ' + (err && err.message));
  }
}

/** Scan Gmail inbox for messages from known contacts and log each as
 *  an ActivityLog of kind=email-inbound. Idempotent via Gmail messageId
 *  stored in ActivityLog.externalId. */
function scanInboundEmails_(daysBack) {
  const days = Math.max(1, Math.min(daysBack || 14, 90));
  const ss = getSpreadsheet_();

  // 1. Build email→contactId lookup from Contacts tab.
  const contactsSheet = ss.getSheetByName('Contacts');
  if (!contactsSheet) return { scanned: 0, logged: 0, skipped: 0, knownContacts: 0 };
  const contactsData = contactsSheet.getDataRange().getValues();
  if (contactsData.length < 2) return { scanned: 0, logged: 0, skipped: 0, knownContacts: 0 };
  const cHeaders = contactsData[0].map(String);
  const emailCol = cHeaders.indexOf('email');
  const idCol = cHeaders.indexOf('id');
  if (emailCol < 0 || idCol < 0) return { scanned: 0, logged: 0, skipped: 0, knownContacts: 0 };

  const emailToContactId = {};
  for (let r = 1; r < contactsData.length; r++) {
    const email = String(contactsData[r][emailCol] || '').toLowerCase().trim();
    const id = String(contactsData[r][idCol] || '');
    if (email && id) emailToContactId[email] = id;
  }
  const knownContacts = Object.keys(emailToContactId).length;

  // 2. Build set of already-logged Gmail messageIds (from ActivityLogs.externalId).
  const logsSheet = ss.getSheetByName('ActivityLogs');
  const loggedMessageIds = {};
  if (logsSheet) {
    const lData = logsSheet.getDataRange().getValues();
    if (lData.length >= 2) {
      const lHeaders = lData[0].map(String);
      const extIdCol = lHeaders.indexOf('externalId');
      const kindColLog = lHeaders.indexOf('kind');
      if (extIdCol >= 0 && kindColLog >= 0) {
        for (let r = 1; r < lData.length; r++) {
          const k = String(lData[r][kindColLog] || '');
          if (k === 'email-inbound' || k === 'email-outbound') {
            const eid = String(lData[r][extIdCol] || '');
            if (eid) loggedMessageIds[eid] = true;
          }
        }
      }
    }
  }

  // 3. Get our own email so we don't log emails we sent.
  const myEmail = (Session.getActiveUser().getEmail() || '').toLowerCase().trim();

  // 4. Search Gmail inbox for recent messages.
  // Use is:inbox to skip drafts, sent items, and spam. newer_than:Nd window.
  const query = 'in:inbox newer_than:' + days + 'd';
  const threads = GmailApp.search(query, 0, 200); // up to 200 threads per scan

  let scanned = 0;
  let logged = 0;
  let skipped = 0;

  for (let t = 0; t < threads.length; t++) {
    const messages = threads[t].getMessages();
    for (let m = 0; m < messages.length; m++) {
      const message = messages[m];
      scanned++;
      const messageId = message.getId();
      if (loggedMessageIds[messageId]) { skipped++; continue; }

      // Parse sender — "Name <email@x.com>" or just "email@x.com"
      const fromStr = message.getFrom() || '';
      let senderEmail = '';
      const angleMatch = fromStr.match(/<([^>]+)>/);
      if (angleMatch) {
        senderEmail = angleMatch[1].toLowerCase().trim();
      } else {
        const emailMatch = fromStr.match(/([^\s]+@[^\s]+)/);
        if (emailMatch) senderEmail = emailMatch[1].toLowerCase().trim();
      }
      if (!senderEmail) continue;

      // Skip our own outbound (we shouldn't be sender of inbox messages anyway,
      // but defensive)
      if (senderEmail === myEmail) continue;

      // Look up contact
      const contactId = emailToContactId[senderEmail];
      if (!contactId) continue;

      // Build activity log entry
      const subject = message.getSubject() || '(no subject)';
      const plainBody = message.getPlainBody() || '';
      const bodyPreview = plainBody.replace(/\s+/g, ' ').slice(0, 500);
      const occurredAt = message.getDate().toISOString();

      const newId = 'al' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      try {
        writeRow_('activityLogs', 'create', {
          id: newId,
          entityType: 'contact',
          entityId: contactId,
          kind: 'email-inbound',
          outcome: '',
          body: subject + (bodyPreview ? '\n\n' + bodyPreview : ''),
          durationMinutes: 0,
          occurredAt: occurredAt,
          createdAt: new Date().toISOString(),
          author: senderEmail,
          externalId: messageId,
        });
        loggedMessageIds[messageId] = true;
        logged++;
      } catch (err) {
        Logger.log('Failed to log inbound email ' + messageId + ': ' + (err && err.message));
      }
    }
  }

  return { scanned: scanned, logged: logged, skipped: skipped, knownContacts: knownContacts, daysBack: days };
}

/** Install hourly time-trigger for inbound-email scanning. */
function installInboundEmailTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  for (let i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'scanInboundEmailsCron') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed += 1;
    }
  }
  // Hourly is enough — Gmail isn't real-time anyway.
  ScriptApp.newTrigger('scanInboundEmailsCron').timeBased().everyHours(1).create();
  return { installed: true, removed: removed, intervalMinutes: 60 };
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

/* ---------- Email signature ---------------------------------------------
 *  GmailApp.sendEmail does NOT auto-pull your Gmail signature, so we manage
 *  it ourselves. Two tiers:
 *    1. Custom signature stored in Script Properties (user override)
 *    2. Auto-pulled from Gmail's SendAs settings (Advanced Gmail Service)
 *  If neither is set, no signature is appended.
 * ----------------------------------------------------------------------- */

/** Returns { plain, html, source } where source is one of:
 *    'custom'  — user pasted a signature in Settings
 *    'gmail'   — auto-pulled from the user's Gmail account
 *    'none'    — nothing configured
 *
 *  In-process cache: once per execution. */
let __sigCache_ = null;
function getEmailSignature_() {
  if (__sigCache_) return __sigCache_;
  const props = PropertiesService.getScriptProperties();
  const customPlain = props.getProperty('EMAIL_SIGNATURE_PLAIN');
  const customHtml  = props.getProperty('EMAIL_SIGNATURE_HTML');
  if (customPlain || customHtml) {
    const plain = customPlain || htmlToPlain_(customHtml || '');
    const html  = customHtml || textToBasicHtml_(customPlain || '');
    __sigCache_ = { plain: plain, html: html, source: 'custom' };
    return __sigCache_;
  }
  // Try auto-detect from Gmail's SendAs settings (requires Gmail Advanced Service)
  try {
    if (typeof Gmail !== 'undefined' && Gmail && Gmail.Users && Gmail.Users.Settings && Gmail.Users.Settings.SendAs) {
      const list = Gmail.Users.Settings.SendAs.list('me');
      const sendAs = (list && list.sendAs) || [];
      // Pick the primary one's signature
      const primary = sendAs.find ? sendAs.find(function (s) { return s.isPrimary; }) : null;
      const sig = primary && primary.signature ? primary.signature : '';
      if (sig) {
        __sigCache_ = { plain: htmlToPlain_(sig), html: sig, source: 'gmail' };
        return __sigCache_;
      }
    }
  } catch (e) {
    // Gmail Advanced Service not enabled or no permission — silently fall back
  }
  __sigCache_ = { plain: '', html: '', source: 'none' };
  return __sigCache_;
}

/** Save a custom signature override. Body: { plain, html? }.
 *  Pass null/empty to both to clear and fall back to Gmail auto-detect. */
function setEmailSignature_(payload) {
  const props = PropertiesService.getScriptProperties();
  const plain = (payload && payload.plain) ? String(payload.plain) : '';
  const html  = (payload && payload.html)  ? String(payload.html)  : '';
  if (!plain && !html) {
    props.deleteProperty('EMAIL_SIGNATURE_PLAIN');
    props.deleteProperty('EMAIL_SIGNATURE_HTML');
  } else {
    if (plain) props.setProperty('EMAIL_SIGNATURE_PLAIN', plain);
    else props.deleteProperty('EMAIL_SIGNATURE_PLAIN');
    if (html) props.setProperty('EMAIL_SIGNATURE_HTML', html);
    else props.deleteProperty('EMAIL_SIGNATURE_HTML');
  }
  __sigCache_ = null; // invalidate cache so next read picks up the change
  return getEmailSignature_();
}

/** Crude HTML-to-plaintext: strip tags, collapse whitespace, decode common
 *  HTML entities. Good enough for Gmail signatures (which are mostly
 *  inline-styled text, not arbitrary HTML). */
function htmlToPlain_(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plaintext → minimal HTML (replace newlines with <br>). */
function textToBasicHtml_(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
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
