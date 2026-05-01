// Popup main logic. State machine:
//   1. Configured? No → show "configure" CTA → opens options page
//   2. Configured? Yes → check active tab
//      a. On Gmail with email open → show email panel + actions
//      b. On Gmail without email → show search panel
//      c. Anywhere else → show search panel
// All API calls go through the background service worker (cached).

import { getConfig } from '../lib/api.js'

const root = document.getElementById('root')

// ============================================================
// Bootstrap
// ============================================================

;(async () => {
  const cfg = await getConfig()
  if (!cfg) {
    renderNotConfigured()
    return
  }
  await renderMainUI()
})()

// ============================================================
// State 1: not configured
// ============================================================

function renderNotConfigured() {
  root.innerHTML = `
    <div class="empty-state">
      <div class="emoji">🔌</div>
      <h2>Configure first</h2>
      <p>Add your Apps Script URL + API key to connect this extension to your Hashio CRM.</p>
      <button class="btn btn-primary" id="open-options">Open settings →</button>
    </div>
  `
  document.getElementById('open-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage()
  })
}

// ============================================================
// State 2: configured — main UI
// ============================================================

async function renderMainUI() {
  // Detect what tab we're on
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tab = tabs && tabs[0]
  const onGmail = tab && /^https:\/\/mail\.google\.com\//.test(tab.url || '')

  let email = null
  if (onGmail) {
    email = await getCurrentEmailFromTab(tab.id)
  }

  if (email && email.senderEmail) {
    renderEmailView(email)
  } else if (onGmail) {
    renderGmailNoEmailSelected()
  } else {
    renderGlobalSearch()
  }
}

async function getCurrentEmailFromTab(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'GET_CURRENT_EMAIL' })
    if (res && res.ok) return res.email
  } catch (err) {
    // Content script may not have loaded yet — silent fail
  }
  return null
}

// ============================================================
// Email-selected view
// ============================================================

async function renderEmailView(email) {
  // Show skeleton first
  root.innerHTML = `
    <div class="stack stack-3">
      ${renderEmailMeta(email)}
      <div class="loading"><span class="spinner"></span> Looking up contact…</div>
    </div>
  `

  // Look up the contact via background cache
  const data = await sendBg({ type: 'GET_CRM_DATA' })
  if (!data.ok) {
    root.innerHTML = `
      <div class="stack stack-3">
        ${renderEmailMeta(email)}
        <div class="toast err">${escapeHtml(data.error || 'Failed to load CRM data')}</div>
      </div>
    `
    return
  }

  const contacts = data.data.contacts || []
  const deals = data.data.deals || []
  const companies = data.data.companies || []
  const activityLogs = data.data.activityLogs || []
  const emailSends = data.data.emailSends || []

  const senderEmail = (email.senderEmail || '').toLowerCase().trim()
  const contact = contacts.find((c) => (c.email || '').toLowerCase().trim() === senderEmail)
  const company = contact && contact.companyId ? companies.find((co) => co.id === contact.companyId) : null
  const contactDeals = contact ? deals.filter((d) => d.contactId === contact.id) : []
  const contactActivity = contact ? activityLogs.filter((l) => l.entityType === 'contact' && l.entityId === contact.id) : []
  const contactSends = contact ? emailSends.filter((s) => s.contactId === contact.id) : []

  root.innerHTML = `
    <div class="stack stack-3">
      ${renderEmailMeta(email)}
      ${renderContactCard(contact, company, contactDeals, contactActivity, contactSends, email)}
      ${renderActions(contact, contactDeals, email)}
      <div id="form-slot"></div>
      <div id="toast-slot"></div>
    </div>
  `

  wireActions(contact, contactDeals, companies, email)
}

function renderEmailMeta(email) {
  return `
    <div class="email-meta">
      <div class="from">
        ${escapeHtml(email.senderName || email.senderEmail)}
        ${email.senderName && email.senderEmail !== email.senderName ? `<span class="muted" style="font-weight:400;">&lt;${escapeHtml(email.senderEmail)}&gt;</span>` : ''}
      </div>
      <div class="subject">${escapeHtml(email.subject || '(no subject)')}</div>
      ${email.bodyPreview ? `<div class="preview">${escapeHtml(email.bodyPreview.slice(0, 300))}${email.bodyPreview.length > 300 ? '…' : ''}</div>` : ''}
    </div>
  `
}

function renderContactCard(contact, company, deals, activity, sends, email) {
  if (!contact) {
    return `
      <div class="contact-card unknown">
        <div class="name">Unknown sender</div>
        <div class="meta">${escapeHtml(email.senderEmail)} isn't in your CRM yet.</div>
      </div>
    `
  }
  const fullName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email
  const openDeals = deals.filter((d) => !(d.stage || '').startsWith('Closed'))
  const totalActivity = activity.length + sends.length
  const lastSendOpen = sends.find((s) => s.openedAt)
  const lastReply = sends.find((s) => s.repliedAt)

  return `
    <div class="contact-card">
      <div class="name">${escapeHtml(fullName)}</div>
      <div class="meta">
        ${escapeHtml([contact.title, contact.role, company && company.name].filter(Boolean).join(' · '))}
      </div>
      <div class="stats">
        <span><strong>${openDeals.length}</strong> open deal${openDeals.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span><strong>${totalActivity}</strong> activit${totalActivity === 1 ? 'y' : 'ies'}</span>
        ${lastReply ? `<span>·</span><span class="badge badge-success">replied</span>` : lastSendOpen ? `<span>·</span><span class="badge badge-warning">opened</span>` : ''}
      </div>
      <div style="margin-top: 8px;">
        <a href="https://mattc1987.github.io/hashio-crm/#/contacts/${contact.id}" target="_blank" class="btn btn-sm btn-ghost" style="padding-left: 0;">Open in app ↗</a>
      </div>
    </div>
  `
}

function renderActions(contact, deals, email) {
  const isInbound = email.url && (email.url.includes('#inbox') || email.url.includes('#label/'))
  return `
    <div>
      <div class="section-label">Quick actions</div>
      <div class="action-grid">
        <button class="action-btn" data-action="log-email">
          <div class="icon">📧</div>
          <div class="label">Log this email</div>
          <div class="hint">${isInbound ? 'Inbound activity' : 'Activity log'}</div>
        </button>
        <button class="action-btn" data-action="create-task">
          <div class="icon">✅</div>
          <div class="label">Create task</div>
          <div class="hint">Pre-filled from this email</div>
        </button>
        <button class="action-btn" data-action="${deals.length > 0 ? 'add-to-deal' : 'create-deal'}">
          <div class="icon">💼</div>
          <div class="label">${deals.length > 0 ? 'Add to deal' : 'Create deal'}</div>
          <div class="hint">${deals.length > 0 ? `${deals.length} existing` : 'New opportunity'}</div>
        </button>
        <button class="action-btn" data-action="ai-bdr">
          <div class="icon">✨</div>
          <div class="label">AI BDR</div>
          <div class="hint">What's the next move?</div>
        </button>
        ${!contact ? `
          <button class="action-btn" data-action="add-contact" style="grid-column: 1 / -1;">
            <div class="icon">👤</div>
            <div class="label">Add as contact</div>
            <div class="hint">Save ${escapeHtml(email.senderEmail)} to your CRM</div>
          </button>
        ` : ''}
      </div>
    </div>
  `
}

// ============================================================
// Action handlers
// ============================================================

function wireActions(contact, deals, companies, email) {
  const formSlot = document.getElementById('form-slot')
  const toastSlot = document.getElementById('toast-slot')

  document.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action')
      handleAction(action, { contact, deals, companies, email, formSlot, toastSlot })
    })
  })
}

async function handleAction(action, ctx) {
  const { contact, deals, companies, email, formSlot, toastSlot } = ctx
  toastSlot.innerHTML = ''

  switch (action) {
    case 'log-email':
      return doLogEmail(contact, email, toastSlot)
    case 'create-task':
      return showTaskForm(contact, email, formSlot, toastSlot)
    case 'add-to-deal':
      return showAddToDealForm(contact, deals, email, formSlot, toastSlot)
    case 'create-deal':
      return showCreateDealForm(contact, companies, email, formSlot, toastSlot)
    case 'ai-bdr':
      // Open the web app's AI BDR drawer for the contact (since our drawer is reactive)
      if (contact) {
        chrome.tabs.create({ url: `https://mattc1987.github.io/hashio-crm/#/contacts/${contact.id}?ai=1` })
      } else {
        showToast(toastSlot, 'Add as contact first to use AI BDR.', false)
      }
      return
    case 'add-contact':
      return showAddContactForm(email, formSlot, toastSlot)
  }
}

// ============================================================
// Action: log email as ActivityLog
// ============================================================

async function doLogEmail(contact, email, toastSlot) {
  if (!contact) {
    showToast(toastSlot, 'Add the sender as a contact first.', false)
    return
  }
  showToast(toastSlot, '<span class="spinner"></span> Logging…', true)
  // Determine direction by URL — if we're in inbox, it's inbound
  const isInbound = email.url && /#inbox|#label\//.test(email.url)
  const kind = isInbound ? 'email-inbound' : 'email-outbound'
  const body = (email.subject || '') + (email.bodyPreview ? '\n\n' + email.bodyPreview.slice(0, 500) : '')
  const externalId = (email.threadId || '') + '|' + (email.subject || '')

  const res = await sendBg({
    type: 'CALL_SCRIPT',
    action: 'write',
    payload: {
      entity: 'activityLogs',
      op: 'create',
      payload: {
        entityType: 'contact',
        entityId: contact.id,
        kind,
        outcome: '',
        body,
        durationMinutes: 0,
        occurredAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        author: 'gmail-extension',
        externalId,
      },
    },
  })
  if (res.ok) {
    showToast(toastSlot, `✅ Logged ${isInbound ? 'inbound' : 'outbound'} email on ${contact.firstName} ${contact.lastName}.`, true)
  } else {
    showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
  }
}

// ============================================================
// Action: create task form
// ============================================================

function showTaskForm(contact, email, formSlot, toastSlot) {
  const defaultDue = nDaysFromNow(2)
  formSlot.innerHTML = `
    <div class="form-drawer">
      <h3>Create task</h3>
      <div class="field">
        <label>Title</label>
        <input type="text" id="task-title" value="${escapeAttr('Follow up: ' + (email.subject || (contact ? contact.firstName : email.senderEmail)))}" />
      </div>
      <div class="field">
        <label>Due date</label>
        <input type="date" id="task-due" value="${defaultDue}" />
      </div>
      <div class="field">
        <label>Priority</label>
        <select id="task-priority">
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="low">Low</option>
        </select>
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="task-notes" placeholder="Optional context…">${escapeAttr('From email: ' + (email.subject || ''))}</textarea>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="save-task">Create task</button>
        <button class="btn btn-ghost" id="cancel-task">Cancel</button>
      </div>
    </div>
  `
  document.getElementById('cancel-task').addEventListener('click', () => { formSlot.innerHTML = '' })
  document.getElementById('save-task').addEventListener('click', async () => {
    showToast(toastSlot, '<span class="spinner"></span> Creating…', true)
    const title = document.getElementById('task-title').value.trim()
    const dueDate = document.getElementById('task-due').value
    const priority = document.getElementById('task-priority').value
    const notes = document.getElementById('task-notes').value
    const res = await sendBg({
      type: 'CALL_SCRIPT',
      action: 'write',
      payload: {
        entity: 'tasks',
        op: 'create',
        payload: {
          title,
          dueDate: dueDate ? new Date(dueDate).toISOString() : '',
          priority,
          contactId: contact ? contact.id : '',
          dealId: '',
          notes,
          status: 'open',
          createdAt: new Date().toISOString(),
        },
      },
    })
    if (res.ok) {
      formSlot.innerHTML = ''
      showToast(toastSlot, `✅ Task created: "${title}"`, true)
    } else {
      showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    }
  })
}

// ============================================================
// Action: add to existing deal
// ============================================================

function showAddToDealForm(contact, deals, email, formSlot, toastSlot) {
  if (!contact) {
    showToast(toastSlot, 'Add the sender as a contact first.', false)
    return
  }
  const openDeals = deals.filter((d) => !(d.stage || '').startsWith('Closed'))
  if (openDeals.length === 0) {
    showToast(toastSlot, 'No open deals — use "Create deal" instead.', false)
    return
  }
  formSlot.innerHTML = `
    <div class="form-drawer">
      <h3>Log this email on a deal</h3>
      <div class="field">
        <label>Deal</label>
        <select id="deal-select">
          ${openDeals.map((d) => `<option value="${d.id}">${escapeHtml(d.title)} — ${escapeHtml(d.stage)}</option>`).join('')}
        </select>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="save-deal-log">Log activity on deal</button>
        <button class="btn btn-ghost" id="cancel-deal-log">Cancel</button>
      </div>
    </div>
  `
  document.getElementById('cancel-deal-log').addEventListener('click', () => { formSlot.innerHTML = '' })
  document.getElementById('save-deal-log').addEventListener('click', async () => {
    showToast(toastSlot, '<span class="spinner"></span> Logging…', true)
    const dealId = document.getElementById('deal-select').value
    const isInbound = email.url && /#inbox|#label\//.test(email.url)
    const body = (email.subject || '') + (email.bodyPreview ? '\n\n' + email.bodyPreview.slice(0, 500) : '')
    const res = await sendBg({
      type: 'CALL_SCRIPT',
      action: 'write',
      payload: {
        entity: 'activityLogs',
        op: 'create',
        payload: {
          entityType: 'deal',
          entityId: dealId,
          kind: isInbound ? 'email-inbound' : 'email-outbound',
          outcome: '',
          body,
          durationMinutes: 0,
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          author: 'gmail-extension',
          externalId: (email.threadId || '') + '|' + (email.subject || ''),
        },
      },
    })
    if (res.ok) {
      formSlot.innerHTML = ''
      showToast(toastSlot, '✅ Email logged on the deal.', true)
    } else {
      showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    }
  })
}

// ============================================================
// Action: create new deal
// ============================================================

function showCreateDealForm(contact, companies, email, formSlot, toastSlot) {
  const company = contact && contact.companyId ? companies.find((c) => c.id === contact.companyId) : null
  const defaultTitle = `${contact ? `${contact.firstName} ${contact.lastName}` : email.senderName || email.senderEmail}${company ? ` — ${company.name}` : ''}`
  formSlot.innerHTML = `
    <div class="form-drawer">
      <h3>Create deal</h3>
      <div class="field">
        <label>Deal title</label>
        <input type="text" id="deal-title" value="${escapeAttr(defaultTitle)}" />
      </div>
      <div class="field">
        <label>Stage</label>
        <select id="deal-stage">
          <option value="Lead">Lead</option>
          <option value="Qualified">Qualified</option>
          <option value="Demo">Demo</option>
          <option value="Proposal">Proposal</option>
          <option value="Negotiation">Negotiation</option>
        </select>
      </div>
      <div class="field">
        <label>Annual value (optional)</label>
        <input type="number" id="deal-value" placeholder="0" />
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="save-deal">Create deal</button>
        <button class="btn btn-ghost" id="cancel-deal">Cancel</button>
      </div>
    </div>
  `
  document.getElementById('cancel-deal').addEventListener('click', () => { formSlot.innerHTML = '' })
  document.getElementById('save-deal').addEventListener('click', async () => {
    showToast(toastSlot, '<span class="spinner"></span> Creating deal…', true)
    const title = document.getElementById('deal-title').value.trim()
    const stage = document.getElementById('deal-stage').value
    const value = Number(document.getElementById('deal-value').value) || 0
    const res = await sendBg({
      type: 'CALL_SCRIPT',
      action: 'write',
      payload: {
        entity: 'deals',
        op: 'create',
        payload: {
          title,
          contactId: contact ? contact.id : '',
          companyId: company ? company.id : '',
          value,
          stage,
          probability: stage === 'Lead' ? 10 : stage === 'Qualified' ? 25 : stage === 'Demo' ? 50 : 70,
          notes: 'Created from Gmail extension. Source email: ' + (email.subject || ''),
          createdAt: new Date().toISOString(),
        },
      },
    })
    if (res.ok) {
      formSlot.innerHTML = ''
      showToast(toastSlot, `✅ Deal created in ${stage} stage.`, true)
    } else {
      showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    }
  })
}

// ============================================================
// Action: add new contact
// ============================================================

function showAddContactForm(email, formSlot, toastSlot) {
  // Try to split sender name into first + last
  const fullName = email.senderName || ''
  const nameParts = fullName.split(/\s+/).filter(Boolean)
  const firstName = nameParts[0] || ''
  const lastName = nameParts.slice(1).join(' ') || ''

  // Signature pre-parsed by content.js's readCurrentEmail (regex extractor
  // for title / phone / company / LinkedIn). Auto-fills the form so the
  // user only edits what's wrong.
  const sig = email.signature || { title: '', phone: '', companyName: '', linkedinUrl: '', website: '' }
  const extractedAny = !!(sig.phone || sig.title || sig.companyName || sig.linkedinUrl)

  formSlot.innerHTML = `
    <div class="form-drawer">
      <h3>Add contact</h3>
      ${extractedAny ? `
        <div class="sig-banner">
          <strong>✨ Auto-filled from signature:</strong>
          ${[
            sig.title       ? 'title' : '',
            sig.phone       ? 'phone' : '',
            sig.companyName ? 'company' : '',
            sig.linkedinUrl ? 'LinkedIn' : '',
          ].filter(Boolean).join(' · ')} — review below.
        </div>
      ` : ''}
      <div class="row" style="gap: 8px;">
        <div class="field" style="flex: 1;">
          <label>First name</label>
          <input type="text" id="c-first" value="${escapeAttr(firstName)}" />
        </div>
        <div class="field" style="flex: 1;">
          <label>Last name</label>
          <input type="text" id="c-last" value="${escapeAttr(lastName)}" />
        </div>
      </div>
      <div class="field">
        <label>Email</label>
        <input type="email" id="c-email" value="${escapeAttr(email.senderEmail)}" />
      </div>
      <div class="field">
        <label>Title</label>
        <input type="text" id="c-title" value="${escapeAttr(sig.title)}" placeholder="Director of Operations" />
      </div>
      <div class="row" style="gap: 8px;">
        <div class="field" style="flex: 1;">
          <label>Phone</label>
          <input type="tel" id="c-phone" value="${escapeAttr(sig.phone)}" placeholder="(555) 555-5555" />
        </div>
        <div class="field" style="flex: 1;">
          <label>Company</label>
          <input type="text" id="c-company" value="${escapeAttr(sig.companyName)}" placeholder="Acme Corp" />
        </div>
      </div>
      <div class="field">
        <label>LinkedIn</label>
        <input type="url" id="c-linkedin" value="${escapeAttr(sig.linkedinUrl)}" placeholder="https://linkedin.com/in/…" />
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="save-contact">Add contact</button>
        <button class="btn btn-ghost" id="cancel-contact">Cancel</button>
      </div>
    </div>
  `
  document.getElementById('cancel-contact').addEventListener('click', () => { formSlot.innerHTML = '' })
  document.getElementById('save-contact').addEventListener('click', async () => {
    showToast(toastSlot, '<span class="spinner"></span> Adding…', true)

    const companyName = document.getElementById('c-company').value.trim()

    // Resolve company → id (lookup or create) so the contact links cleanly.
    let companyId = ''
    if (companyName) {
      try {
        const crm = await sendBg({ type: 'GET_CRM_DATA' })
        if (crm.ok) {
          const existing = (crm.data.companies || []).find(
            (c) => (c.name || '').toLowerCase().trim() === companyName.toLowerCase()
          )
          if (existing) {
            companyId = existing.id
          } else {
            const created = await sendBg({
              type: 'CALL_SCRIPT', action: 'write',
              payload: {
                entity: 'companies', op: 'create',
                payload: {
                  name: companyName,
                  website: sig.website || '',
                  industry: '', size: '', address: '', notes: '',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              },
            })
            if (created.ok && created.data && created.data.id) companyId = created.data.id
          }
        }
      } catch { /* fall through — contact gets blank companyId */ }
    }

    const res = await sendBg({
      type: 'CALL_SCRIPT',
      action: 'write',
      payload: {
        entity: 'contacts',
        op: 'create',
        payload: {
          firstName: document.getElementById('c-first').value.trim(),
          lastName: document.getElementById('c-last').value.trim(),
          email: document.getElementById('c-email').value.trim(),
          phone: document.getElementById('c-phone').value.trim(),
          title: document.getElementById('c-title').value.trim(),
          role: '',
          companyId: companyId,
          status: 'new',
          state: '',
          linkedinUrl: document.getElementById('c-linkedin').value.trim(),
          tags: 'gmail-ext',
          createdAt: new Date().toISOString(),
        },
      },
    })
    if (res.ok) {
      formSlot.innerHTML = ''
      showToast(toastSlot, '✅ Contact added. Refresh popup to see actions.', true)
      // Force-refresh CRM cache + re-render
      await sendBg({ type: 'INVALIDATE_CACHE' })
      setTimeout(() => renderMainUI(), 800)
    } else {
      showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    }
  })
}

// ============================================================
// Gmail open but no email selected
// ============================================================

function renderGmailNoEmailSelected() {
  root.innerHTML = `
    <div class="empty-state">
      <div class="emoji">📧</div>
      <h2>Open an email</h2>
      <p>Click into a Gmail message — this popup will show the contact's CRM info + quick actions.</p>
    </div>
    <div style="padding: 0 14px 14px;">
      <div class="section-label">Or search the CRM</div>
      <div id="search-zone"></div>
    </div>
  `
  renderSearchInto(document.getElementById('search-zone'))
}

// ============================================================
// Off-Gmail global search
// ============================================================

function renderGlobalSearch() {
  root.innerHTML = `
    <div class="body">
      <div class="section-label">Search your CRM</div>
      <div id="search-zone"></div>
    </div>
  `
  renderSearchInto(document.getElementById('search-zone'))
}

async function renderSearchInto(container) {
  container.innerHTML = `
    <input type="text" id="q" placeholder="Name, email, company, deal title…" autofocus />
    <div id="results" style="margin-top: 8px;"></div>
  `
  const q = container.querySelector('#q')
  const resultsEl = container.querySelector('#results')

  // Pre-fetch data
  const dataRes = await sendBg({ type: 'GET_CRM_DATA' })
  if (!dataRes.ok) {
    resultsEl.innerHTML = `<div class="toast err">${escapeHtml(dataRes.error)}</div>`
    return
  }
  const { contacts = [], deals = [], companies = [] } = dataRes.data

  const handler = () => {
    const query = q.value.toLowerCase().trim()
    if (!query) { resultsEl.innerHTML = ''; return }
    const cMatches = contacts.filter((c) =>
      `${c.firstName} ${c.lastName} ${c.email} ${c.title} ${c.role}`.toLowerCase().includes(query),
    ).slice(0, 8)
    const dMatches = deals.filter((d) => (d.title || '').toLowerCase().includes(query)).slice(0, 5)
    const coMatches = companies.filter((co) => (co.name || '').toLowerCase().includes(query)).slice(0, 5)

    const all = [
      ...cMatches.map((c) => ({ kind: 'contact', id: c.id, title: `${c.firstName} ${c.lastName}`.trim() || c.email, sub: c.email })),
      ...dMatches.map((d) => ({ kind: 'deal', id: d.id, title: d.title, sub: d.stage + (d.value ? ` · $${d.value}` : '') })),
      ...coMatches.map((co) => ({ kind: 'company', id: co.id, title: co.name, sub: co.industry || '' })),
    ]
    if (all.length === 0) {
      resultsEl.innerHTML = `<div class="muted" style="padding: 12px; font-size: 12px; text-align: center;">No matches</div>`
      return
    }
    resultsEl.innerHTML = `
      <div class="search-results">
        ${all.map((r) => `
          <div class="search-result" data-kind="${r.kind}" data-id="${r.id}">
            <span class="kind-badge">${r.kind}</span>
            <div class="title">${escapeHtml(r.title)}</div>
            ${r.sub ? `<div class="sub">${escapeHtml(r.sub)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    `
    resultsEl.querySelectorAll('.search-result').forEach((row) => {
      row.addEventListener('click', () => {
        const kind = row.getAttribute('data-kind')
        const id = row.getAttribute('data-id')
        const path = kind === 'contact' ? `contacts/${id}` : kind === 'deal' ? `deals/${id}` : `companies/${id}`
        chrome.tabs.create({ url: `https://mattc1987.github.io/hashio-crm/#/${path}` })
      })
    })
  }

  q.addEventListener('input', handler)
}

// ============================================================
// Helpers
// ============================================================

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message })
        return
      }
      resolve(res || { ok: false, error: 'No response' })
    })
  })
}

function showToast(slot, html, ok) {
  slot.innerHTML = `<div class="toast ${ok ? 'ok' : 'err'}">${html}</div>`
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(s) {
  return escapeHtml(s)
}

function nDaysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
