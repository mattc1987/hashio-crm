// Content script for Gmail. Two responsibilities:
//   1. Inject a floating Hashio sidebar into Gmail's right edge whenever
//      the user is viewing an email thread.
//   2. Respond to legacy popup messages (GET_CURRENT_EMAIL, PING) for the
//      toolbar-popup flow which still works in parallel.
//
// Style isolation: Shadow DOM. Gmail's CSS can't bleed into our panel.

;(function () {
  // ============================================================
  // Email-DOM scraping (shared by sidebar + popup)
  // ============================================================

  /**
   * Try to detect the current Gmail user's own email so we can filter THEM
   * out of the sender list (otherwise on threads the user started, we'd
   * always identify them as the prospect — which is the wrong contact card
   * to render in the sidebar).
   *
   * Cached after first detection — Gmail doesn't change accounts mid-page.
   */
  let __cachedUserEmail = null
  function getCurrentUserEmail() {
    if (__cachedUserEmail !== null) return __cachedUserEmail

    // 1. Best signal: the Google Account button's aria-label, e.g.
    //    "Google Account: Matt Campbell\n(matt@gohashio.com)"
    const accountLink = document.querySelector('a[aria-label*="@"]')
    if (accountLink) {
      const label = accountLink.getAttribute('aria-label') || ''
      const m = label.match(/[\w.+-]+@[\w.-]+\.\w+/)
      if (m) { __cachedUserEmail = m[0].toLowerCase(); return __cachedUserEmail }
    }

    // 2. Fallback: scan every [data-hovercard-id] (Gmail puts emails here).
    //    The user's own address shows up MORE often than any single
    //    correspondent in their own inbox (signature, sent stamps, etc.).
    const counts = {}
    document.querySelectorAll('[data-hovercard-id]').forEach(function (el) {
      const e = (el.getAttribute('data-hovercard-id') || '').toLowerCase()
      if (e && e.indexOf('@') > 0) counts[e] = (counts[e] || 0) + 1
    })
    let best = ''
    let bestN = 0
    Object.keys(counts).forEach(function (e) {
      if (counts[e] > bestN) { bestN = counts[e]; best = e }
    })
    if (best && bestN >= 3) { __cachedUserEmail = best; return __cachedUserEmail }

    // 3. Give up — content scripts can't read the user account directly.
    __cachedUserEmail = ''
    return ''
  }

  function readCurrentEmail() {
    // Gmail's inbox, folder, and label views ALL contain h2 elements with
    // their titles ("Inbox", "Sent", etc) — those aren't open-email signals.
    // Only treat the page as "viewing an email" if we see real thread DOM:
    //   - h2.hP exists ONLY on an open thread (the email subject heading)
    //   - .gD (sender chip) exists ONLY inside a thread message
    //   - URL hash typically looks like #inbox/<threadId> with a thread ID
    const subjectEl = document.querySelector('h2.hP')
    if (!subjectEl) return null
    const senderProbe = document.querySelector('[role="main"] .gD')
    if (!senderProbe) return null

    const subject = (subjectEl.textContent || '').trim()
    const myEmail = getCurrentUserEmail()

    // Collect every sender in the thread (one .gD per message). DOM order
    // = oldest message first, latest at the bottom.
    const senderEls = Array.from(document.querySelectorAll('[role="main"] .gD'))
    let pick = null

    // Walk newest-first; pick the most recent message NOT from the current
    // Gmail user. That's the "other party" in the conversation, which is
    // who the CRM card should be about.
    for (let i = senderEls.length - 1; i >= 0; i--) {
      const el = senderEls[i]
      const email = (el.getAttribute('email') || '').toLowerCase()
      if (email && (!myEmail || email !== myEmail)) { pick = el; break }
    }

    // If every message in this thread is from the user (e.g. a Sent-folder
    // thread with no reply yet), look at the RECIPIENT instead. Gmail
    // marks the "to" line of each message with .g2 / .hb / [email].
    if (!pick) {
      const recipientEls = Array.from(document.querySelectorAll('[role="main"] .g2, [role="main"] .hb [email]'))
      for (let i = recipientEls.length - 1; i >= 0; i--) {
        const el = recipientEls[i]
        const email = (el.getAttribute('email') || '').toLowerCase()
        if (email && (!myEmail || email !== myEmail)) { pick = el; break }
      }
    }

    // Last-ditch fallback: any [email] attribute on the page that isn't ours.
    if (!pick) {
      const anyEls = Array.from(document.querySelectorAll('[role="main"] [email]'))
      for (let i = anyEls.length - 1; i >= 0; i--) {
        const el = anyEls[i]
        const email = (el.getAttribute('email') || '').toLowerCase()
        if (email && (!myEmail || email !== myEmail)) { pick = el; break }
      }
    }

    let senderName = ''
    let senderEmail = ''
    if (pick) {
      senderName = pick.getAttribute('name') || (pick.textContent || '').trim()
      senderEmail = (pick.getAttribute('email') || '').toLowerCase()
    }

    // Body grab — IMPORTANT: prefer the body of the picked sender's specific
    // message, not just the first .a3s in the thread. The first .a3s belongs
    // to the OLDEST message; if Matt sent first and the prospect replied, the
    // prospect's reply (with their signature) is in a LATER .a3s. Walk up
    // from the picked .gD to its containing message, then find that
    // message's .a3s. Falls back to the first .a3s if traversal fails.
    let bodyPreview = ''
    let bodyEl = null
    if (pick) {
      // Walk up looking for a container that holds both the picked sender
      // AND a body. Gmail wraps each message in a parent containing both.
      let cursor = pick
      for (let i = 0; i < 12 && cursor && !bodyEl; i++) {
        cursor = cursor.parentElement
        if (cursor) bodyEl = cursor.querySelector('.a3s')
      }
    }
    if (!bodyEl) bodyEl = document.querySelector('[role="main"] .a3s')
    // 2500 chars instead of 800 — signatures live at the bottom and we need
    // enough buffer for the sig parser to find them past the body content.
    if (bodyEl) bodyPreview = ((bodyEl.innerText || bodyEl.textContent) || '').trim().slice(0, 2500)

    let date = ''
    const dateEl = document.querySelector('[role="main"] .g3, [role="main"] [data-tooltip-contains-time]')
    if (dateEl) {
      const t = dateEl.getAttribute('data-tooltip') || dateEl.getAttribute('title')
      date = t || (dateEl.textContent || '').trim()
    }

    const hash = window.location.hash || ''
    let threadId = ''
    const m = hash.match(/\/([A-Za-z0-9]+)$/)
    if (m) threadId = m[1]

    // Pre-parse the signature here so both the popup and the embedded sidebar
    // can use it without duplicating the regex extractor.
    const signature = parseSignature(bodyPreview, senderName || '', senderEmail || '')

    return {
      senderName: senderName || senderEmail || '',
      senderEmail: senderEmail,
      subject,
      bodyPreview,
      date,
      threadId,
      url: window.location.href,
      signature,
      // Useful for debugging: what email did the extension think was the user?
      _myEmail: myEmail,
    }
  }

  // Legacy popup flow — still works
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'GET_CURRENT_EMAIL') {
      try { sendResponse({ ok: true, email: readCurrentEmail() }) }
      catch (err) { sendResponse({ ok: false, error: (err && err.message) || String(err) }) }
    } else if (msg && msg.type === 'PING') {
      sendResponse({ ok: true, pong: true })
    }
    return true
  })

  // ============================================================
  // Sidebar injection
  // ============================================================

  let sidebarHost = null            // DOM host element
  let shadow = null                 // ShadowRoot
  let lastEmailKey = ''             // dedup re-render
  let collapsed = false             // user pref, also restored from localStorage
  let crmDataPromise = null         // single in-flight CRM fetch

  // Initial collapsed state from localStorage
  try { collapsed = localStorage.getItem('hashio.sidebarCollapsed') === '1' } catch {}

  function ensureSidebar() {
    if (sidebarHost && document.body.contains(sidebarHost)) return
    sidebarHost = document.createElement('div')
    sidebarHost.id = 'hashio-sidebar-host'
    sidebarHost.style.cssText = `
      position: fixed;
      top: 70px;
      right: 12px;
      z-index: 999999;
      pointer-events: auto;
    `
    shadow = sidebarHost.attachShadow({ mode: 'open' })
    shadow.innerHTML = SIDEBAR_HTML
    document.body.appendChild(sidebarHost)
    wireSidebarEvents(shadow)
    applyCollapsedState()
  }

  function applyCollapsedState() {
    if (!shadow) return
    const root = shadow.getElementById('root')
    if (!root) return
    if (collapsed) root.classList.add('collapsed')
    else root.classList.remove('collapsed')
    try { localStorage.setItem('hashio.sidebarCollapsed', collapsed ? '1' : '0') } catch {}
  }

  function wireSidebarEvents(shadow) {
    const collapseBtn = shadow.getElementById('collapse-btn')
    const header = shadow.querySelector('.header')

    function setCollapsed(next) {
      collapsed = next
      applyCollapsedState()
      if (!collapsed) {
        lastEmailKey = '' // force re-render with fresh data
        renderSidebar()
      }
    }

    // Explicit collapse button — collapses when expanded. Stops propagation
    // so the header click handler below doesn't immediately re-toggle.
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        setCollapsed(!collapsed)
      })
    }

    // Header click — only meaningful when COLLAPSED (lets you click the
    // 44px circle to expand). When expanded, header clicks are ignored
    // so accidental clicks don't collapse the panel.
    if (header) {
      header.addEventListener('click', () => {
        if (collapsed) setCollapsed(false)
      })
    }
  }

  // ============================================================
  // Renderer — same UI shape as popup, inline
  // ============================================================

  async function renderSidebar() {
    ensureSidebar()
    const email = readCurrentEmail()
    if (!email) {
      // No email open — hide sidebar
      hideSidebar()
      return
    }
    showSidebar()

    if (collapsed) return // skip data fetch when collapsed

    const key = email.senderEmail + '|' + email.threadId + '|' + email.subject
    if (key === lastEmailKey) return // already rendered for this thread
    lastEmailKey = key

    const slot = shadow.getElementById('content')
    slot.innerHTML = `<div class="loading"><span class="spinner"></span> Looking up contact…</div>`

    // Fetch CRM data via background (cached)
    let crmData
    try {
      const res = await sendBg({ type: 'GET_CRM_DATA' })
      if (!res.ok) throw new Error(res.error || 'Failed to load CRM data')
      crmData = res.data
    } catch (err) {
      slot.innerHTML = `
        <div class="email-meta">
          <div class="from">${escapeHtml(email.senderName)}</div>
          <div class="subject">${escapeHtml(email.subject)}</div>
        </div>
        <div class="toast err">${escapeHtml(err.message)}<br><br>Open extension settings if not configured.</div>
        <button class="btn btn-secondary" id="open-options-btn">Open settings</button>
      `
      const btn = slot.querySelector('#open-options-btn')
      if (btn) btn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }))
      return
    }

    const contacts = crmData.contacts || []
    const deals = crmData.deals || []
    const companies = crmData.companies || []
    const activityLogs = crmData.activityLogs || []
    const emailSends = crmData.emailSends || []

    const senderEmail = (email.senderEmail || '').toLowerCase().trim()
    const contact = contacts.find((c) => (c.email || '').toLowerCase().trim() === senderEmail)
    const company = contact && contact.companyId ? companies.find((co) => co.id === contact.companyId) : null
    const contactDeals = contact ? deals.filter((d) => d.contactId === contact.id) : []
    const contactActivity = contact ? activityLogs.filter((l) => l.entityType === 'contact' && l.entityId === contact.id) : []
    const contactSends = contact ? emailSends.filter((s) => s.contactId === contact.id) : []

    slot.innerHTML = `
      ${renderEmailMeta(email)}
      ${renderContactCard(contact, company, contactDeals, contactActivity, contactSends, email)}
      ${renderActions(contact, contactDeals)}
      <div id="form-slot"></div>
      <div id="toast-slot"></div>
    `

    wireActions(shadow, contact, contactDeals, companies, email)
  }

  function showSidebar() {
    if (sidebarHost) sidebarHost.style.display = 'block'
  }
  function hideSidebar() {
    if (sidebarHost) sidebarHost.style.display = 'none'
  }

  // ============================================================
  // Render helpers
  // ============================================================

  function renderEmailMeta(email) {
    return `
      <div class="email-meta">
        <div class="from">
          ${escapeHtml(email.senderName || email.senderEmail)}
          ${email.senderName && email.senderEmail !== email.senderName ? `<span class="muted" style="font-weight:400;">&lt;${escapeHtml(email.senderEmail)}&gt;</span>` : ''}
        </div>
        <div class="subject">${escapeHtml(email.subject || '(no subject)')}</div>
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
    const lastReply = sends.find((s) => s.repliedAt)
    const lastOpen = sends.find((s) => s.openedAt)

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
          ${lastReply ? `<span>·</span><span class="badge badge-success">replied</span>` : lastOpen ? `<span>·</span><span class="badge badge-warning">opened</span>` : ''}
        </div>
        <div style="margin-top: 8px;">
          <a href="https://mattc1987.github.io/hashio-crm/#/contacts/${contact.id}" target="_blank" class="link-btn">Open in app ↗</a>
        </div>
      </div>
    `
  }

  function renderActions(contact, deals) {
    return `
      <div>
        <div class="section-label">Quick actions</div>
        <div class="action-grid">
          <button class="action-btn" data-action="log-email">
            <div class="icon">📧</div>
            <div class="label">Log email</div>
          </button>
          <button class="action-btn" data-action="create-task">
            <div class="icon">✅</div>
            <div class="label">Create task</div>
          </button>
          <button class="action-btn" data-action="${deals.length > 0 ? 'add-to-deal' : 'create-deal'}">
            <div class="icon">💼</div>
            <div class="label">${deals.length > 0 ? 'Add to deal' : 'Create deal'}</div>
          </button>
          <button class="action-btn" data-action="ai-bdr">
            <div class="icon">✨</div>
            <div class="label">AI BDR</div>
          </button>
          ${!contact ? `
            <button class="action-btn" data-action="add-contact" style="grid-column: 1 / -1;">
              <div class="icon">👤</div>
              <div class="label">Add as contact</div>
            </button>
          ` : ''}
        </div>
      </div>
    `
  }

  function wireActions(shadow, contact, deals, companies, email) {
    const formSlot = shadow.getElementById('form-slot')
    const toastSlot = shadow.getElementById('toast-slot')
    shadow.querySelectorAll('.action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action')
        handleAction(action, { contact, deals, companies, email, formSlot, toastSlot, shadow })
      })
    })
  }

  // ============================================================
  // Action handlers (shadow-DOM aware versions of popup.js)
  // ============================================================

  async function handleAction(action, ctx) {
    const { contact, deals, companies, email, formSlot, toastSlot } = ctx
    toastSlot.innerHTML = ''
    switch (action) {
      case 'log-email': return doLogEmail(contact, email, toastSlot)
      case 'create-task': return showTaskForm(contact, email, formSlot, toastSlot)
      case 'add-to-deal': return showAddToDealForm(contact, deals, email, formSlot, toastSlot)
      case 'create-deal': return showCreateDealForm(contact, companies, email, formSlot, toastSlot)
      case 'ai-bdr':
        if (contact) window.open(`https://mattc1987.github.io/hashio-crm/#/contacts/${contact.id}?ai=1`, '_blank')
        else showToast(toastSlot, 'Add as contact first to use AI BDR.', false)
        return
      case 'add-contact': return showAddContactForm(email, formSlot, toastSlot)
    }
  }

  async function doLogEmail(contact, email, toastSlot) {
    if (!contact) { showToast(toastSlot, 'Add the sender as a contact first.', false); return }
    showToast(toastSlot, '<span class="spinner"></span> Logging…', true)
    const isInbound = email.url && /#inbox|#label\//.test(email.url)
    const kind = isInbound ? 'email-inbound' : 'email-outbound'
    const body = (email.subject || '') + (email.bodyPreview ? '\n\n' + email.bodyPreview.slice(0, 500) : '')
    const externalId = (email.threadId || '') + '|' + (email.subject || '')
    const res = await sendBg({
      type: 'CALL_SCRIPT',
      action: 'write',
      payload: {
        entity: 'activityLogs', op: 'create',
        payload: {
          entityType: 'contact', entityId: contact.id, kind, outcome: '', body,
          durationMinutes: 0, occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(), author: 'gmail-extension', externalId,
        },
      },
    })
    if (res.ok) showToast(toastSlot, `✅ Logged ${isInbound ? 'inbound' : 'outbound'} email on ${contact.firstName} ${contact.lastName}.`, true)
    else showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
  }

  function showTaskForm(contact, email, formSlot, toastSlot) {
    const defaultDue = nDaysFromNow(2)
    formSlot.innerHTML = `
      <div class="form-drawer">
        <h3>Create task</h3>
        <div class="field"><label>Title</label>
          <input type="text" id="task-title" value="${escapeAttr('Follow up: ' + (email.subject || (contact ? contact.firstName : email.senderEmail)))}" /></div>
        <div class="field"><label>Due date</label>
          <input type="date" id="task-due" value="${defaultDue}" /></div>
        <div class="field"><label>Priority</label>
          <select id="task-priority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div>
        <div class="field"><label>Notes</label>
          <textarea id="task-notes">${escapeAttr('From email: ' + (email.subject || ''))}</textarea></div>
        <div class="actions">
          <button class="btn btn-primary" id="save-task">Create task</button>
          <button class="btn btn-ghost" id="cancel-task">Cancel</button>
        </div>
      </div>
    `
    formSlot.querySelector('#cancel-task').addEventListener('click', () => { formSlot.innerHTML = '' })
    formSlot.querySelector('#save-task').addEventListener('click', async () => {
      showToast(toastSlot, '<span class="spinner"></span> Creating…', true)
      const res = await sendBg({
        type: 'CALL_SCRIPT', action: 'write',
        payload: {
          entity: 'tasks', op: 'create',
          payload: {
            title: formSlot.querySelector('#task-title').value.trim(),
            dueDate: formSlot.querySelector('#task-due').value ? new Date(formSlot.querySelector('#task-due').value).toISOString() : '',
            priority: formSlot.querySelector('#task-priority').value,
            contactId: contact ? contact.id : '', dealId: '',
            notes: formSlot.querySelector('#task-notes').value,
            status: 'open', createdAt: new Date().toISOString(),
          },
        },
      })
      if (res.ok) { formSlot.innerHTML = ''; showToast(toastSlot, '✅ Task created.', true) }
      else showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    })
  }

  function showAddToDealForm(contact, deals, email, formSlot, toastSlot) {
    if (!contact) { showToast(toastSlot, 'Add the sender as a contact first.', false); return }
    const openDeals = deals.filter((d) => !(d.stage || '').startsWith('Closed'))
    if (openDeals.length === 0) { showToast(toastSlot, 'No open deals — use "Create deal".', false); return }
    formSlot.innerHTML = `
      <div class="form-drawer">
        <h3>Log this email on a deal</h3>
        <div class="field"><label>Deal</label>
          <select id="deal-select">
            ${openDeals.map((d) => `<option value="${d.id}">${escapeHtml(d.title)} — ${escapeHtml(d.stage)}</option>`).join('')}
          </select></div>
        <div class="actions">
          <button class="btn btn-primary" id="save-deal-log">Log on deal</button>
          <button class="btn btn-ghost" id="cancel-deal-log">Cancel</button>
        </div>
      </div>
    `
    formSlot.querySelector('#cancel-deal-log').addEventListener('click', () => { formSlot.innerHTML = '' })
    formSlot.querySelector('#save-deal-log').addEventListener('click', async () => {
      showToast(toastSlot, '<span class="spinner"></span> Logging…', true)
      const dealId = formSlot.querySelector('#deal-select').value
      const isInbound = email.url && /#inbox|#label\//.test(email.url)
      const body = (email.subject || '') + (email.bodyPreview ? '\n\n' + email.bodyPreview.slice(0, 500) : '')
      const res = await sendBg({
        type: 'CALL_SCRIPT', action: 'write',
        payload: {
          entity: 'activityLogs', op: 'create',
          payload: {
            entityType: 'deal', entityId: dealId,
            kind: isInbound ? 'email-inbound' : 'email-outbound',
            outcome: '', body, durationMinutes: 0,
            occurredAt: new Date().toISOString(), createdAt: new Date().toISOString(),
            author: 'gmail-extension', externalId: (email.threadId || '') + '|' + (email.subject || ''),
          },
        },
      })
      if (res.ok) { formSlot.innerHTML = ''; showToast(toastSlot, '✅ Email logged on the deal.', true) }
      else showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    })
  }

  function showCreateDealForm(contact, companies, email, formSlot, toastSlot) {
    const company = contact && contact.companyId ? companies.find((c) => c.id === contact.companyId) : null
    const defaultTitle = `${contact ? `${contact.firstName} ${contact.lastName}` : email.senderName || email.senderEmail}${company ? ` — ${company.name}` : ''}`
    formSlot.innerHTML = `
      <div class="form-drawer">
        <h3>Create deal</h3>
        <div class="field"><label>Title</label>
          <input type="text" id="deal-title" value="${escapeAttr(defaultTitle)}" /></div>
        <div class="field"><label>Stage</label>
          <select id="deal-stage">
            <option value="Lead">Lead</option><option value="Qualified">Qualified</option>
            <option value="Demo">Demo</option><option value="Proposal">Proposal</option>
            <option value="Negotiation">Negotiation</option>
          </select></div>
        <div class="field"><label>Annual value</label>
          <input type="number" id="deal-value" placeholder="0" /></div>
        <div class="actions">
          <button class="btn btn-primary" id="save-deal">Create deal</button>
          <button class="btn btn-ghost" id="cancel-deal">Cancel</button>
        </div>
      </div>
    `
    formSlot.querySelector('#cancel-deal').addEventListener('click', () => { formSlot.innerHTML = '' })
    formSlot.querySelector('#save-deal').addEventListener('click', async () => {
      showToast(toastSlot, '<span class="spinner"></span> Creating…', true)
      const stage = formSlot.querySelector('#deal-stage').value
      const res = await sendBg({
        type: 'CALL_SCRIPT', action: 'write',
        payload: {
          entity: 'deals', op: 'create',
          payload: {
            title: formSlot.querySelector('#deal-title').value.trim(),
            contactId: contact ? contact.id : '',
            companyId: company ? company.id : '',
            value: Number(formSlot.querySelector('#deal-value').value) || 0,
            stage,
            probability: stage === 'Lead' ? 10 : stage === 'Qualified' ? 25 : stage === 'Demo' ? 50 : 70,
            notes: 'Created from Gmail extension. Source email: ' + (email.subject || ''),
            createdAt: new Date().toISOString(),
          },
        },
      })
      if (res.ok) { formSlot.innerHTML = ''; showToast(toastSlot, `✅ Deal created in ${stage} stage.`, true) }
      else showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    })
  }

  function showAddContactForm(email, formSlot, toastSlot) {
    const fullName = email.senderName || ''
    const parts = fullName.split(/\s+/).filter(Boolean)

    // Use the signature pre-parsed by readCurrentEmail (both sidebar and popup
    // share the same parsed result). Best-effort regex extraction — review
    // and edit before save.
    const sig = email.signature || { title: '', phone: '', companyName: '', linkedinUrl: '', website: '' }
    const extractedAny = !!(sig.phone || sig.title || sig.companyName || sig.linkedinUrl || sig.website)

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
        <div class="row">
          <div class="field" style="flex:1;"><label>First name</label>
            <input type="text" id="c-first" value="${escapeAttr(parts[0] || '')}" /></div>
          <div class="field" style="flex:1;"><label>Last name</label>
            <input type="text" id="c-last" value="${escapeAttr(parts.slice(1).join(' '))}" /></div>
        </div>
        <div class="field"><label>Email</label>
          <input type="email" id="c-email" value="${escapeAttr(email.senderEmail)}" /></div>
        <div class="field"><label>Title</label>
          <input type="text" id="c-title" value="${escapeAttr(sig.title)}" placeholder="Director of Operations" /></div>
        <div class="row">
          <div class="field" style="flex:1;"><label>Phone</label>
            <input type="tel" id="c-phone" value="${escapeAttr(sig.phone)}" placeholder="(555) 555-5555" /></div>
          <div class="field" style="flex:1;"><label>Company</label>
            <input type="text" id="c-company" value="${escapeAttr(sig.companyName)}" placeholder="Acme Corp" /></div>
        </div>
        <div class="field"><label>LinkedIn</label>
          <input type="url" id="c-linkedin" value="${escapeAttr(sig.linkedinUrl)}" placeholder="https://linkedin.com/in/…" /></div>
        <div class="actions">
          <button class="btn btn-primary" id="save-contact">Add contact</button>
          <button class="btn btn-ghost" id="cancel-contact">Cancel</button>
        </div>
      </div>
    `
    formSlot.querySelector('#cancel-contact').addEventListener('click', () => { formSlot.innerHTML = '' })
    formSlot.querySelector('#save-contact').addEventListener('click', async () => {
      showToast(toastSlot, '<span class="spinner"></span> Adding…', true)

      const companyName = formSlot.querySelector('#c-company').value.trim()

      // If we got a company name from the signature OR the user typed one,
      // make sure a Company row exists. Look it up case-insensitively in the
      // CRM cache; create if missing. The new contact then carries that
      // company's id so it links cleanly on the contact detail page.
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
        type: 'CALL_SCRIPT', action: 'write',
        payload: {
          entity: 'contacts', op: 'create',
          payload: {
            firstName: formSlot.querySelector('#c-first').value.trim(),
            lastName: formSlot.querySelector('#c-last').value.trim(),
            email: formSlot.querySelector('#c-email').value.trim(),
            phone: formSlot.querySelector('#c-phone').value.trim(),
            title: formSlot.querySelector('#c-title').value.trim(),
            role: '',
            companyId: companyId,
            status: 'new',
            state: '',
            linkedinUrl: formSlot.querySelector('#c-linkedin').value.trim(),
            tags: 'gmail-ext',
            createdAt: new Date().toISOString(),
          },
        },
      })
      if (res.ok) {
        formSlot.innerHTML = ''
        showToast(toastSlot, '✅ Contact added — refreshing…', true)
        await sendBg({ type: 'INVALIDATE_CACHE' })
        lastEmailKey = ''
        setTimeout(() => renderSidebar(), 800)
      } else showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
    })
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
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }
  function escapeAttr(s) { return escapeHtml(s) }
  function nDaysFromNow(n) {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return d.toISOString().slice(0, 10)
  }

  /**
   * Parse a sales/signature block out of an email body. Best-effort, regex-
   * based — handles ~80% of real signatures (names, titles, phones,
   * companies, LinkedIn URLs). Returns:
   *   { title, phone, companyName, linkedinUrl, website }
   *
   * Strategy:
   *   1. Isolate the signature region (after "-- " separator if present,
   *      or last 12 non-quoted lines otherwise).
   *   2. Skip quoted reply lines (start with ">" or "On <date> wrote:").
   *   3. Run separate regex extractors for each field.
   */
  function parseSignature(bodyText, senderName, senderEmail) {
    const out = { title: '', phone: '', companyName: '', linkedinUrl: '', website: '' }
    if (!bodyText) return out

    // Strip Gmail's quoted history — anything after "On <DATE>... wrote:"
    // and any line starting with > is the prior message, not the sig.
    let text = bodyText
    const onWroteIdx = text.search(/\nOn\s+\w+,?\s+\w.*\swrote:\s*\n/i)
    if (onWroteIdx > 0) text = text.slice(0, onWroteIdx)

    // Split into lines, drop quoted ones
    let lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => !l.startsWith('>'))

    // Isolate signature: after "-- " separator if present, else last 12 lines
    const sepIdx = lines.findIndex((l) => /^--\s*$/.test(l))
    let sigLines
    if (sepIdx >= 0) {
      sigLines = lines.slice(sepIdx + 1)
    } else {
      // Heuristic: signatures usually start with a name line that matches
      // (or partially matches) the sender's name. If we can find that line
      // near the bottom, take everything from there. Else last 12 lines.
      const nameTokens = (senderName || '').toLowerCase().split(/\s+/).filter(Boolean)
      let nameLineIdx = -1
      if (nameTokens.length >= 1) {
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
          const lower = lines[i].toLowerCase()
          if (nameTokens.every((tok) => lower.includes(tok))) { nameLineIdx = i; break }
        }
      }
      sigLines = nameLineIdx >= 0 ? lines.slice(nameLineIdx) : lines.slice(-12)
    }
    // Filter empty and overly-long lines (real sig lines are short)
    sigLines = sigLines.filter((l) => l.length > 0 && l.length < 120)

    const sigText = sigLines.join('\n')
    const sigLower = sigText.toLowerCase()

    // ---- LinkedIn URL ----
    const liMatch = sigText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(?:in|pub)\/[\w\-_/?=&%]+/i)
    if (liMatch) {
      let url = liMatch[0]
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url
      out.linkedinUrl = url.replace(/[.,;)]+$/, '') // trim trailing punctuation
    }

    // ---- Phone ----
    // Match a 10-digit US number or +CC variants. Avoid false-matching credit-
    // card / order-number sequences by requiring at least one separator
    // (-, ., space, parens) — pure digit runs are rejected.
    const phoneMatch = sigText.match(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/)
    if (phoneMatch) out.phone = phoneMatch[0].trim()

    // ---- Title ----
    // Look for a line containing common title keywords. If multiple, prefer
    // the one closest to the name line.
    const TITLE_RX = /\b(CEO|CTO|CFO|COO|CMO|CPO|CIO|VP|EVP|SVP|President|Founder|Co-?founder|Owner|Partner|Principal|Director|Manager|Lead|Head\sof|Chief|Senior|Sr\.|Junior|Engineer|Producer|Operator|Operations|Cultivator|Cultivation|Compliance|Sales|Marketing|Account\sExecutive|AE|BDR|SDR|Consultant|Analyst|Coordinator|Specialist|Architect|Designer|Developer|Strategist|Advisor|Buyer|Procurement|Supply|Grower|Master\sGrower)\b/i
    let titleLine = ''
    for (const l of sigLines) {
      if (l.includes('@') || l.includes('http')) continue // skip email/URL lines
      if (TITLE_RX.test(l) && l.length < 80) { titleLine = l; break }
    }
    if (titleLine) {
      // Strip trailing company info if separated by | / · ,
      // e.g. "Director of Operations | Acme Cultivation" → keep both halves
      // distinguishable for company extraction below.
      out.title = titleLine.replace(/\s*\|\s*/g, ' | ').trim()
    }

    // ---- Company ----
    // Heuristic: line with "at X", or " | X", or " - X" alongside a title,
    // or a standalone line that LOOKS like a company (capitalized, not the
    // person's name, not an email/url).
    let company = ''
    if (titleLine) {
      // "Title at Company"
      const atMatch = titleLine.match(/\b(?:at|@)\s+([A-Z][\w&'.\- ]{1,50})$/i)
      if (atMatch) company = atMatch[1].trim()
      else {
        // "Title | Company" or "Title - Company" or "Title, Company"
        const sepMatch = titleLine.match(/[,|\-·]\s*([A-Z][\w&'.\- ]{1,50})$/)
        if (sepMatch) company = sepMatch[1].trim()
      }
    }
    if (!company) {
      // Look for a line that looks like a company (capitalized, no email,
      // no URL, no obvious title keyword, after the name line).
      for (const l of sigLines) {
        if (l.includes('@') || l.includes('http') || /^\+?\d/.test(l)) continue
        if (TITLE_RX.test(l)) continue
        if (senderName && l.toLowerCase().includes(senderName.toLowerCase())) continue
        if (/^[A-Z][\w&'.\- ]{1,50}$/.test(l) && l.split(/\s+/).length <= 6) {
          company = l.trim()
          break
        }
      }
    }
    // Filter false positives: short single words (likely greetings) like
    // "Best", "Thanks", "Cheers", "Regards"
    if (company && /^(best|thanks|cheers|regards|sincerely|warmly|cordially|warm regards)\b/i.test(company)) {
      company = ''
    }
    out.companyName = company

    // ---- Website ----
    // First non-LinkedIn URL in the sig, or strip an email's domain.
    const urlMatch = sigText.match(/(?:https?:\/\/)?(?:www\.)?([\w\-]+\.[a-z]{2,})(?:\/[^\s]*)?/gi)
    if (urlMatch) {
      for (const u of urlMatch) {
        if (/linkedin\.com|gmail\.com|googlemail\.com|outlook\.com|yahoo\.com|hotmail\.com|protonmail\.com|icloud\.com/i.test(u)) continue
        out.website = u.replace(/[.,;)]+$/, '')
        break
      }
    }
    // If still no website, derive from the sender's email domain (if it
    // looks like a corporate domain, not a free-mail provider).
    if (!out.website && senderEmail) {
      const dom = (senderEmail.split('@')[1] || '').toLowerCase().trim()
      if (dom && !/^(gmail|googlemail|outlook|yahoo|hotmail|protonmail|icloud|aol|fastmail|me|mac)\.\w+$/.test(dom)) {
        out.website = 'https://' + dom
      }
    }

    return out
  }

  // ============================================================
  // Lifecycle: re-render on thread switches
  // ============================================================

  // Watch URL hash for navigation
  let lastHash = window.location.hash
  setInterval(() => {
    if (window.location.hash !== lastHash) {
      lastHash = window.location.hash
      lastEmailKey = '' // force re-render
      renderSidebar()
    }
  }, 500)

  // Initial render after DOM settles
  setTimeout(() => renderSidebar(), 1000)

  // Watch for late-loading email (Gmail's SPA renders after URL change)
  const observer = new MutationObserver(() => {
    const email = readCurrentEmail()
    if (email && email.senderEmail) {
      const key = email.senderEmail + '|' + email.threadId + '|' + email.subject
      if (key !== lastEmailKey) renderSidebar()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // ============================================================
  // Sidebar HTML (Shadow DOM contents)
  // ============================================================

  const SIDEBAR_HTML = `
    <style>
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }

      #root {
        --brand: #7a5eff;
        --brand-700: #5d3fe8;
        --brand-100: rgba(122, 94, 255, 0.10);
        --bg: #ffffff;
        --surface: #ffffff;
        --surface-2: #f5f5f7;
        --surface-3: #e8e8ec;
        --border: rgba(0, 0, 0, 0.08);
        --body: #1a1a1f;
        --muted: #5e5e66;
        --faint: #9a9aa3;
        --success: #1f7c43;
        --warning: #946400;
        --danger: #c0322a;

        width: 340px;
        max-height: calc(100vh - 90px);
        background: var(--bg);
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
        border: 1px solid var(--border);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-size: 13px;
        color: var(--body);
        transition: width 0.18s, height 0.18s;
      }
      #root.collapsed { width: 44px; height: 44px; }
      #root.collapsed .header-text,
      #root.collapsed #content { display: none; }

      .header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--border);
        background: var(--surface);
        cursor: default;
      }
      #root.collapsed .header {
        padding: 0;
        height: 44px;
        width: 44px;
        justify-content: center;
        border-bottom: none;
      }
      .logo {
        width: 22px; height: 22px;
        background: var(--brand);
        color: white;
        border-radius: 6px;
        display: grid;
        place-items: center;
        font-weight: 600;
        font-size: 12px;
        flex-shrink: 0;
      }
      .header-text { font-weight: 600; font-size: 13px; flex: 1; }
      #collapse-btn {
        background: none; border: none; cursor: pointer;
        color: var(--muted); padding: 4px 6px; border-radius: 4px;
        font-size: 14px; line-height: 1;
      }
      #collapse-btn:hover { background: var(--surface-2); color: var(--body); }
      #root.collapsed #collapse-btn {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      #root.collapsed .header { cursor: pointer; }

      #content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .loading {
        padding: 20px 12px; text-align: center;
        color: var(--muted); font-size: 12px;
      }
      .spinner {
        display: inline-block;
        width: 12px; height: 12px;
        border: 2px solid var(--surface-3);
        border-top-color: var(--brand);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        vertical-align: middle;
        margin-right: 6px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      .email-meta {
        background: var(--surface-2);
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
      }
      .email-meta .from { font-weight: 600; word-wrap: break-word; }
      .email-meta .subject { color: var(--muted); margin-top: 4px; line-height: 1.4; }

      .contact-card {
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--brand-100);
        border: 1px solid rgba(122, 94, 255, 0.2);
      }
      .contact-card.unknown {
        background: var(--surface-2);
        border-color: var(--border);
      }
      .contact-card .name { font-weight: 600; font-size: 13px; }
      .contact-card .meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
      .contact-card .stats {
        display: flex; gap: 8px; flex-wrap: wrap;
        margin-top: 8px; font-size: 11px; color: var(--muted);
      }
      .contact-card .stats strong { color: var(--body); }
      .badge {
        display: inline-flex; align-items: center;
        padding: 1px 6px; border-radius: 999px;
        font-size: 10px; font-weight: 500;
      }
      .badge-success { background: rgba(48, 179, 107, 0.12); color: var(--success); }
      .badge-warning { background: rgba(245, 165, 36, 0.14); color: var(--warning); }
      .link-btn {
        font-size: 11px; color: var(--brand);
        text-decoration: none; font-weight: 500;
      }
      .link-btn:hover { color: var(--brand-700); text-decoration: underline; }

      .section-label {
        font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.04em;
        color: var(--faint); margin-bottom: 8px;
      }

      .action-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
      }
      .action-btn {
        display: flex; flex-direction: column;
        align-items: flex-start; gap: 2px;
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        cursor: pointer; text-align: left;
        transition: border-color 0.15s, background 0.15s;
        font: inherit; color: inherit;
      }
      .action-btn:hover {
        border-color: var(--brand);
        background: var(--surface-2);
      }
      .action-btn .icon { font-size: 14px; }
      .action-btn .label { font-size: 11px; font-weight: 500; }

      .form-drawer {
        background: var(--surface);
        border-radius: 8px;
        border: 1px solid var(--border);
        padding: 10px;
      }
      .form-drawer h3 {
        margin: 0 0 8px 0;
        font-size: 13px;
        font-weight: 600;
      }
      .form-drawer label {
        display: block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--faint);
        margin-bottom: 4px;
      }
      .form-drawer .field { margin-bottom: 8px; }
      .form-drawer .row { display: flex; gap: 6px; }
      .form-drawer input, .form-drawer textarea, .form-drawer select {
        width: 100%;
        font: inherit;
        padding: 6px 8px;
        border: 1px solid var(--border);
        border-radius: 6px;
        background: var(--bg);
        color: var(--body);
        font-size: 12px;
      }
      .form-drawer textarea { min-height: 50px; resize: vertical; }
      .form-drawer .actions { display: flex; gap: 6px; margin-top: 8px; }

      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: var(--surface);
        font: inherit; font-size: 12px; font-weight: 500;
        cursor: pointer;
        color: var(--body);
        border-color: var(--border);
      }
      .btn:hover { background: var(--surface-2); }
      .btn-primary {
        background: var(--brand); color: white; border-color: var(--brand);
      }
      .btn-primary:hover { background: var(--brand-700); }
      .btn-ghost {
        background: transparent; border-color: transparent; color: var(--muted);
      }
      .btn-ghost:hover { background: var(--surface-2); color: var(--body); }
      .btn-secondary { border-color: rgba(0,0,0,0.18); }

      .toast {
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 12px;
        line-height: 1.4;
      }
      .toast.ok { background: rgba(48, 179, 107, 0.10); color: var(--success); }
      .toast.err { background: rgba(239, 76, 76, 0.08); color: var(--danger); }

      .sig-banner {
        background: rgba(122, 94, 255, 0.08);
        color: var(--brand-700);
        padding: 6px 10px;
        border-radius: 6px;
        font-size: 11px;
        line-height: 1.4;
        margin-bottom: 10px;
        border: 1px solid rgba(122, 94, 255, 0.18);
      }
      .sig-banner strong { color: var(--brand); }

      .muted { color: var(--muted); }

      @media (prefers-color-scheme: dark) {
        #root {
          --bg: #1c1c1f;
          --surface: #25252a;
          --surface-2: #2e2e33;
          --surface-3: #3a3a40;
          --border: rgba(255, 255, 255, 0.10);
          --body: #f0f0f2;
          --muted: #a8a8b0;
          --faint: #71717a;
        }
      }
    </style>
    <div id="root">
      <div class="header">
        <div class="logo">H</div>
        <div class="header-text">Hashio CRM</div>
        <button id="collapse-btn" title="Collapse">−</button>
      </div>
      <div id="content"></div>
    </div>
  `

  console.log('[Hashio CRM] sidebar content script loaded')
})()
