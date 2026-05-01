// Content script for LinkedIn — scrapes the current profile or search-results
// page and renders a Hashio sidebar (Shadow-DOM, same style as Gmail) so the
// user can:
//   • On a profile page (/in/<slug>): see if the person is already in the CRM,
//     and if not, one-click "Add to CRM" with name / title / company /
//     location pre-filled from the page.
//   • On a People search results page (/search/results/people/...) or Sales
//     Nav search: bulk-select up to 25 results and add them all at once.
//
// LinkedIn's DOM changes frequently — selectors are intentionally fuzzy and
// fall back through several alternatives. If LinkedIn breaks us, the user
// sees the sidebar but the data is empty (rather than the sidebar
// disappearing entirely).

;(function () {
  // ============================================================
  // Page-type detection
  // ============================================================

  const PAGE = {
    PROFILE: 'profile',
    SEARCH: 'search',
    SALES_LEAD: 'sales-lead',
    SALES_SEARCH: 'sales-search',
    OTHER: 'other',
  }

  function detectPageType() {
    const path = window.location.pathname
    if (/^\/in\/[^/]+\/?/.test(path))                      return PAGE.PROFILE
    if (/^\/search\/results\/people\b/.test(path))         return PAGE.SEARCH
    if (/^\/sales\/lead\//.test(path))                     return PAGE.SALES_LEAD
    if (/^\/sales\/search\/people/.test(path))             return PAGE.SALES_SEARCH
    return PAGE.OTHER
  }

  // ============================================================
  // Profile scraping (/in/<slug>)
  // ============================================================

  function readProfile() {
    // Name — h1 in the top card. LinkedIn's classes change but h1 is stable.
    let name = ''
    const nameEl = document.querySelector('main h1, h1.text-heading-xlarge, .top-card-layout__title')
    if (nameEl) name = (nameEl.textContent || '').trim()

    // Headline / current title — usually right below the name in the top card.
    // Multiple candidate selectors because LinkedIn renames classes regularly.
    let headline = ''
    const headlineEl =
      document.querySelector('main .text-body-medium.break-words') ||
      document.querySelector('.top-card-layout__headline') ||
      document.querySelector('div[class*="text-body-medium"][class*="break-words"]')
    if (headlineEl) headline = (headlineEl.textContent || '').trim()

    // Location — small text near the top, usually after headline. Matches the
    // pattern "City, ST" / "Region, Country" or just a single location string.
    let location = ''
    const locEl =
      document.querySelector('main .text-body-small.inline.t-black--light.break-words') ||
      document.querySelector('.top-card-layout__first-subline + div') ||
      document.querySelector('span.text-body-small[class*="break-words"]')
    if (locEl) location = (locEl.textContent || '').trim()

    // Current company — try the experience section first, fall back to parsing
    // from the headline ("Title at Company" pattern).
    let companyName = ''
    const expBtn = document.querySelector('main section[id^="experience"] [aria-hidden="true"]')
    // Better: grab the FIRST experience entry's company line
    const firstExp = document.querySelector('main section[id^="experience"] li, main section[id^="experience"] .pvs-list__paged-list-item')
    if (firstExp) {
      // The company name appears as a span inside the experience entry — usually
      // the second prominent span (first is the title).
      const spans = firstExp.querySelectorAll('span[aria-hidden="true"], span.t-14, span.t-bold')
      const candidates = []
      spans.forEach((s) => {
        const txt = (s.textContent || '').trim()
        if (txt && txt.length > 1 && txt.length < 80) candidates.push(txt)
      })
      // Heuristic: company is usually candidates[1] (after the title) — but
      // LinkedIn varies. Try to find one that doesn't contain "Present" or dates.
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i]
        if (/Present|\d{4}|·\s\d|yrs?|mos?/i.test(c)) continue
        if (i === 0) continue // first is usually the title
        companyName = c
        break
      }
    }
    if (!companyName) {
      // Headline parser fallback
      const m = headline.match(/\b(?:at|@)\s+(.+?)(?:\s*[|·\-]|$)/i)
      if (m) companyName = m[1].trim()
    }

    // Profile URL — strip query/hash, normalize trailing slash
    const profileUrl = location.href.split('?')[0].split('#')[0].replace(/\/$/, '')
    const slugMatch = window.location.pathname.match(/^\/in\/([^/]+)/)
    const slug = slugMatch ? slugMatch[1] : ''

    // Avatar (best-effort)
    let avatarUrl = ''
    const avatarEl = document.querySelector('main .pv-top-card__photo img, main .top-card-layout__entity-image, main img.profile-picture-link img')
    if (avatarEl && avatarEl.tagName === 'IMG') avatarUrl = avatarEl.getAttribute('src') || ''

    // Split name → first + last (LinkedIn names sometimes have suffixes/credentials)
    const cleanName = name.replace(/\s*,\s*(MBA|PhD|CPA|MD|JD|Esq\.?|Ph\.?D\.?)$/i, '').trim()
    const parts = cleanName.split(/\s+/).filter(Boolean)
    const firstName = parts[0] || ''
    const lastName = parts.slice(1).join(' ')

    return {
      slug,
      profileUrl: 'https://www.linkedin.com/in/' + slug,
      name: cleanName,
      firstName,
      lastName,
      headline,
      title: parseTitleFromHeadline(headline),
      companyName,
      location,
      avatarUrl,
    }
  }

  function parseTitleFromHeadline(headline) {
    if (!headline) return ''
    // Strip "at Company" suffix to leave just the title
    const noAt = headline.replace(/\s+(?:at|@)\s+.+$/i, '')
    return noAt.trim()
  }

  // ============================================================
  // Search-results scraping
  // ============================================================
  // Two flavors handled:
  //   - Public LinkedIn /search/results/people — anonymous DOM, list of cards
  //   - Sales Nav /sales/search/people — different DOM, similar idea

  function readSearchResults() {
    const isSalesNav = /^\/sales\/search\/people/.test(window.location.pathname)
    const results = []

    if (isSalesNav) {
      // Sales Nav uses a different DOM. Each result is a tr or li with a
      // profile link. This selector is fuzzy — Sales Nav rebuilds the DOM
      // when filters change, so we use the most stable structural traits.
      const rows = document.querySelectorAll('li.artdeco-list__item, .search-results__result-item, [data-x-search-result="LEAD"]')
      rows.forEach((row) => {
        const link = row.querySelector('a[href*="/sales/lead/"]')
        if (!link) return
        const href = link.getAttribute('href') || ''
        const name = (link.textContent || '').trim()
        if (!name || !href) return
        const titleEl = row.querySelector('[data-anonymize="title"], .result-lockup__highlight-keyword')
        const companyEl = row.querySelector('[data-anonymize="company-name"], a[href*="/sales/company/"]')
        const locationEl = row.querySelector('[data-anonymize="location"]')
        results.push({
          source: 'sales-nav',
          profileUrl: href.startsWith('http') ? href : ('https://www.linkedin.com' + href),
          name,
          firstName: name.split(/\s+/)[0] || '',
          lastName: name.split(/\s+/).slice(1).join(' ') || '',
          title: titleEl ? (titleEl.textContent || '').trim() : '',
          companyName: companyEl ? (companyEl.textContent || '').trim() : '',
          location: locationEl ? (locationEl.textContent || '').trim() : '',
        })
      })
    } else {
      // Public LinkedIn search results
      const rows = document.querySelectorAll('.search-results-container li, .reusable-search__result-container, .entity-result__item')
      rows.forEach((row) => {
        const link = row.querySelector('a[href*="/in/"]')
        if (!link) return
        const href = (link.getAttribute('href') || '').split('?')[0]
        const slugMatch = href.match(/\/in\/([^/]+)/)
        const slug = slugMatch ? slugMatch[1] : ''
        if (!slug) return

        // Name — anchor text or aria-label, sometimes includes a connection-degree suffix
        let name = ''
        const titleSpan = row.querySelector('.entity-result__title-text a span[aria-hidden="true"], .actor-name, span.actor-name-text')
        if (titleSpan) name = (titleSpan.textContent || '').trim()
        if (!name) name = (link.textContent || '').trim()
        // Strip connection-degree suffix like "• 2nd"
        name = name.replace(/\s*[•·]\s*\d(?:st|nd|rd)\b.*$/i, '').trim()
        if (!name) return

        // Title and company appear on subsequent lines in the result card
        let title = ''
        let companyName = ''
        let location = ''
        const subtitle = row.querySelector('.entity-result__primary-subtitle, div.subline-level-1')
        if (subtitle) {
          const sub = (subtitle.textContent || '').trim()
          // Common pattern: "Director of Operations at Acme Corp"
          const atMatch = sub.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i)
          if (atMatch) {
            title = atMatch[1].trim()
            companyName = atMatch[2].trim()
          } else {
            title = sub
          }
        }
        const locEl = row.querySelector('.entity-result__secondary-subtitle, div.subline-level-2')
        if (locEl) location = (locEl.textContent || '').trim()

        const parts = name.split(/\s+/).filter(Boolean)
        results.push({
          source: 'public-search',
          slug,
          profileUrl: 'https://www.linkedin.com/in/' + slug,
          name,
          firstName: parts[0] || '',
          lastName: parts.slice(1).join(' '),
          title,
          companyName,
          location,
        })
      })
    }
    // Dedupe by profileUrl
    const seen = new Set()
    return results.filter((r) => {
      if (seen.has(r.profileUrl)) return false
      seen.add(r.profileUrl)
      return true
    })
  }

  // ============================================================
  // Sidebar (Shadow-DOM, mirrors the Gmail content script's UX)
  // ============================================================

  let sidebarHost = null
  let shadow = null
  let collapsed = false
  let lastKey = ''
  try { collapsed = localStorage.getItem('hashio.li.sidebarCollapsed') === '1' } catch {}

  function ensureSidebar() {
    if (sidebarHost && document.body.contains(sidebarHost)) return
    sidebarHost = document.createElement('div')
    sidebarHost.id = 'hashio-li-sidebar-host'
    sidebarHost.style.cssText = `
      position: fixed; top: 70px; right: 12px; z-index: 999999;
      pointer-events: auto;
    `
    shadow = sidebarHost.attachShadow({ mode: 'open' })
    shadow.innerHTML = SIDEBAR_HTML
    document.body.appendChild(sidebarHost)
    wireSidebarEvents()
    applyCollapsed()
  }

  function applyCollapsed() {
    const root = shadow && shadow.getElementById('root')
    if (!root) return
    if (collapsed) root.classList.add('collapsed')
    else root.classList.remove('collapsed')
    try { localStorage.setItem('hashio.li.sidebarCollapsed', collapsed ? '1' : '0') } catch {}
  }

  function wireSidebarEvents() {
    const collapseBtn = shadow.getElementById('collapse-btn')
    const header = shadow.querySelector('.header')
    function setCollapsed(next) {
      collapsed = next
      applyCollapsed()
      if (!collapsed) { lastKey = ''; render() }
    }
    if (collapseBtn) {
      collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!collapsed) })
    }
    if (header) {
      header.addEventListener('click', () => { if (collapsed) setCollapsed(false) })
    }
  }

  function showSidebar() { if (sidebarHost) sidebarHost.style.display = 'block' }
  function hideSidebar() { if (sidebarHost) sidebarHost.style.display = 'none' }

  // ============================================================
  // Renderer
  // ============================================================

  async function render() {
    const pageType = detectPageType()
    if (pageType === PAGE.OTHER) { hideSidebar(); return }
    ensureSidebar()
    showSidebar()
    if (collapsed) return

    const slot = shadow.getElementById('content')

    if (pageType === PAGE.PROFILE || pageType === PAGE.SALES_LEAD) {
      const profile = readProfile()
      const key = 'profile|' + profile.slug + '|' + profile.name
      if (key === lastKey) return
      lastKey = key

      slot.innerHTML = `<div class="loading"><span class="spinner"></span> Looking up contact…</div>`

      // Look up in CRM by LinkedIn URL or name
      let existing = null
      try {
        const res = await sendBg({ type: 'GET_CRM_DATA' })
        if (res.ok) {
          const contacts = res.data.contacts || []
          existing = contacts.find((c) => {
            const ciURL = (c.linkedinUrl || '').toLowerCase()
            if (ciURL && profile.profileUrl && ciURL.includes(profile.slug.toLowerCase())) return true
            const fullName = `${c.firstName} ${c.lastName}`.toLowerCase().trim()
            return fullName === profile.name.toLowerCase()
          })
        }
      } catch { /* ignore */ }

      slot.innerHTML = renderProfileCard(profile, existing)
      wireProfileActions(profile, existing)
    } else if (pageType === PAGE.SEARCH || pageType === PAGE.SALES_SEARCH) {
      // Re-scrape on every render — search results change with scroll/filter
      const results = readSearchResults()
      const key = 'search|' + results.length + '|' + (results[0] && results[0].profileUrl)
      if (key === lastKey && shadow.getElementById('result-list')) return
      lastKey = key

      slot.innerHTML = renderSearchList(results)
      wireSearchActions(results)
    }
  }

  // ============================================================
  // Profile card UI
  // ============================================================

  function renderProfileCard(p, existing) {
    if (existing) {
      const fullName = `${existing.firstName} ${existing.lastName}`.trim()
      return `
        <div class="contact-card">
          <div class="badge badge-success">Already in CRM</div>
          <div class="name">${escapeHtml(fullName || existing.email)}</div>
          <div class="meta">${escapeHtml([existing.title, existing.email].filter(Boolean).join(' · '))}</div>
          <div style="margin-top: 8px;">
            <a href="https://mattc1987.github.io/hashio-crm/#/contacts/${existing.id}" target="_blank" class="link-btn">Open in app ↗</a>
          </div>
        </div>
      `
    }
    return `
      <div class="contact-card unknown">
        <div class="name">${escapeHtml(p.name || 'Unknown profile')}</div>
        <div class="meta">${escapeHtml([p.title, p.companyName].filter(Boolean).join(' at '))}</div>
        ${p.location ? `<div class="meta-faint">${escapeHtml(p.location)}</div>` : ''}
        <div class="muted small" style="margin-top: 8px;">Not in your CRM.</div>
      </div>
      <div>
        <div class="section-label">Quick actions</div>
        <div class="action-grid one-col">
          <button class="action-btn" data-action="add-from-profile">
            <div class="icon">👤</div>
            <div class="label">Add to CRM</div>
          </button>
        </div>
      </div>
      <div id="form-slot"></div>
      <div id="toast-slot"></div>
    `
  }

  function wireProfileActions(profile, existing) {
    const formSlot = shadow.getElementById('form-slot')
    const toastSlot = shadow.getElementById('toast-slot')
    shadow.querySelectorAll('.action-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action')
        if (action === 'add-from-profile') showAddFromProfileForm(profile, formSlot, toastSlot)
      })
    })
    void existing // currently unused — placeholder for future "edit existing" actions
  }

  function showAddFromProfileForm(p, formSlot, toastSlot) {
    formSlot.innerHTML = `
      <div class="form-drawer">
        <h3>Add contact from LinkedIn</h3>
        <div class="row">
          <div class="field" style="flex:1;"><label>First name</label>
            <input type="text" id="lc-first" value="${escapeAttr(p.firstName)}" /></div>
          <div class="field" style="flex:1;"><label>Last name</label>
            <input type="text" id="lc-last" value="${escapeAttr(p.lastName)}" /></div>
        </div>
        <div class="field"><label>Title</label>
          <input type="text" id="lc-title" value="${escapeAttr(p.title)}" placeholder="Director of Operations" /></div>
        <div class="row">
          <div class="field" style="flex:1;"><label>Company</label>
            <input type="text" id="lc-company" value="${escapeAttr(p.companyName)}" /></div>
          <div class="field" style="flex:1;"><label>Location</label>
            <input type="text" id="lc-location" value="${escapeAttr(p.location)}" /></div>
        </div>
        <div class="field"><label>Email (LinkedIn doesn't expose this — fill if you know it)</label>
          <input type="email" id="lc-email" value="" placeholder="optional" /></div>
        <div class="field"><label>LinkedIn URL</label>
          <input type="url" id="lc-linkedin" value="${escapeAttr(p.profileUrl)}" /></div>
        <div class="actions">
          <button class="btn btn-primary" id="save-li-contact">Add to CRM</button>
          <button class="btn btn-ghost" id="cancel-li-contact">Cancel</button>
        </div>
      </div>
    `
    formSlot.querySelector('#cancel-li-contact').addEventListener('click', () => { formSlot.innerHTML = '' })
    formSlot.querySelector('#save-li-contact').addEventListener('click', async () => {
      showToast(toastSlot, '<span class="spinner"></span> Adding…', true)
      const companyName = formSlot.querySelector('#lc-company').value.trim()
      const companyId = await resolveOrCreateCompany(companyName)
      const res = await sendBg({
        type: 'CALL_SCRIPT', action: 'write',
        payload: {
          entity: 'contacts', op: 'create',
          payload: {
            firstName: formSlot.querySelector('#lc-first').value.trim(),
            lastName: formSlot.querySelector('#lc-last').value.trim(),
            email: formSlot.querySelector('#lc-email').value.trim(),
            phone: '',
            title: formSlot.querySelector('#lc-title').value.trim(),
            role: '',
            companyId: companyId,
            status: 'new',
            state: '',
            linkedinUrl: formSlot.querySelector('#lc-linkedin').value.trim(),
            tags: 'linkedin-ext',
            createdAt: new Date().toISOString(),
            // Stash location in notes so we don't lose it (no dedicated field)
            notes: formSlot.querySelector('#lc-location').value.trim()
              ? 'Location: ' + formSlot.querySelector('#lc-location').value.trim()
              : '',
          },
        },
      })
      if (res.ok) {
        formSlot.innerHTML = ''
        showToast(toastSlot, '✅ Contact added.', true)
        await sendBg({ type: 'INVALIDATE_CACHE' })
        lastKey = ''
        setTimeout(render, 600)
      } else {
        showToast(toastSlot, '❌ ' + (res.error || 'Failed'), false)
      }
    })
  }

  // ============================================================
  // Search results UI — bulk select + bulk add
  // ============================================================

  function renderSearchList(results) {
    if (!results.length) {
      return `
        <div class="muted small" style="padding: 12px;">
          No people detected on this search page yet. Scroll the page or wait for results to load — the sidebar will refresh.
        </div>
      `
    }
    const rows = results.map((r, i) => `
      <label class="result-row">
        <input type="checkbox" class="result-cb" data-idx="${i}" />
        <div class="result-meta">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="meta-faint">${escapeHtml([r.title, r.companyName].filter(Boolean).join(' at ') || r.location || '')}</div>
        </div>
      </label>
    `).join('')
    return `
      <div class="section-label">${results.length} people on this search</div>
      <div class="search-actions">
        <button class="btn btn-secondary btn-tiny" id="select-all">Select all</button>
        <button class="btn btn-secondary btn-tiny" id="select-none">None</button>
        <button class="btn btn-primary btn-tiny" id="bulk-add" disabled>Add 0 to CRM</button>
      </div>
      <div id="result-list" class="result-list">${rows}</div>
      <div id="form-slot"></div>
      <div id="toast-slot"></div>
    `
  }

  function wireSearchActions(results) {
    const list = shadow.getElementById('result-list')
    const bulkBtn = shadow.getElementById('bulk-add')
    const selectAll = shadow.getElementById('select-all')
    const selectNone = shadow.getElementById('select-none')
    const toastSlot = shadow.getElementById('toast-slot')

    function updateBulkLabel() {
      const checked = shadow.querySelectorAll('.result-cb:checked').length
      bulkBtn.textContent = `Add ${checked} to CRM`
      bulkBtn.disabled = checked === 0
    }

    list.querySelectorAll('.result-cb').forEach((cb) => {
      cb.addEventListener('change', updateBulkLabel)
    })
    selectAll.addEventListener('click', () => {
      list.querySelectorAll('.result-cb').forEach((cb) => { cb.checked = true })
      updateBulkLabel()
    })
    selectNone.addEventListener('click', () => {
      list.querySelectorAll('.result-cb').forEach((cb) => { cb.checked = false })
      updateBulkLabel()
    })

    bulkBtn.addEventListener('click', async () => {
      const checkedIdxs = Array.from(shadow.querySelectorAll('.result-cb:checked'))
        .map((cb) => Number(cb.getAttribute('data-idx')))
      const selected = checkedIdxs.map((i) => results[i]).filter(Boolean)
      if (!selected.length) return

      showToast(toastSlot, `<span class="spinner"></span> Adding ${selected.length} contacts…`, true)

      // Phase 1: resolve company IDs (batched lookup against existing CRM)
      const crm = await sendBg({ type: 'GET_CRM_DATA' })
      const existingByName = new Map()
      if (crm.ok) {
        ;(crm.data.companies || []).forEach((co) => {
          if (co.name) existingByName.set(co.name.toLowerCase().trim(), co.id)
        })
      }
      const uniqueNewCompanies = []
      const seenNew = new Set()
      for (const r of selected) {
        const nm = (r.companyName || '').trim()
        if (!nm) continue
        const lower = nm.toLowerCase()
        if (existingByName.has(lower)) continue
        if (seenNew.has(lower)) continue
        seenNew.add(lower)
        uniqueNewCompanies.push(nm)
      }
      // Create missing companies one by one (only the new ones — typically 0-5
      // for a 25-person batch, so cost stays low).
      for (const nm of uniqueNewCompanies) {
        try {
          const created = await sendBg({
            type: 'CALL_SCRIPT', action: 'write',
            payload: {
              entity: 'companies', op: 'create',
              payload: {
                name: nm, industry: '', size: '', website: '', address: '', notes: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            },
          })
          if (created.ok && created.data && created.data.id) {
            existingByName.set(nm.toLowerCase(), created.data.id)
          }
        } catch { /* skip */ }
      }

      // Phase 2: create contacts (sequentially — Apps Script can't batch
      // arbitrary write payloads safely without `bulkCreate`, which doesn't
      // help here because we need IDs back per-row).
      let added = 0
      let failed = 0
      for (const r of selected) {
        try {
          const cmpId = (r.companyName || '').trim()
            ? existingByName.get(r.companyName.toLowerCase().trim()) || ''
            : ''
          const res = await sendBg({
            type: 'CALL_SCRIPT', action: 'write',
            payload: {
              entity: 'contacts', op: 'create',
              payload: {
                firstName: r.firstName,
                lastName: r.lastName,
                email: '',
                phone: '',
                title: r.title || '',
                role: '',
                companyId: cmpId,
                status: 'new',
                state: '',
                linkedinUrl: r.profileUrl || '',
                tags: 'linkedin-ext',
                createdAt: new Date().toISOString(),
                notes: r.location ? 'Location: ' + r.location : '',
              },
            },
          })
          if (res.ok) added++
          else failed++
        } catch {
          failed++
        }
      }

      await sendBg({ type: 'INVALIDATE_CACHE' })
      const msg = `✅ Added ${added}${failed ? ` · ${failed} failed` : ''}.` +
        (uniqueNewCompanies.length ? ` Created ${uniqueNewCompanies.length} new compan${uniqueNewCompanies.length === 1 ? 'y' : 'ies'}.` : '')
      showToast(toastSlot, msg, failed === 0)
    })
  }

  // ============================================================
  // Helpers
  // ============================================================

  async function resolveOrCreateCompany(name) {
    const trimmed = (name || '').trim()
    if (!trimmed) return ''
    try {
      const crm = await sendBg({ type: 'GET_CRM_DATA' })
      if (crm.ok) {
        const existing = (crm.data.companies || []).find(
          (c) => (c.name || '').toLowerCase().trim() === trimmed.toLowerCase()
        )
        if (existing) return existing.id
        const created = await sendBg({
          type: 'CALL_SCRIPT', action: 'write',
          payload: {
            entity: 'companies', op: 'create',
            payload: {
              name: trimmed, industry: '', size: '', website: '', address: '', notes: '',
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            },
          },
        })
        if (created.ok && created.data && created.data.id) return created.data.id
      }
    } catch { /* fall through */ }
    return ''
  }

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

  // ============================================================
  // Lifecycle — re-render on URL changes (LinkedIn is an SPA)
  // ============================================================

  let lastUrl = window.location.href
  setInterval(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href
      lastKey = ''
      render()
    }
  }, 600)

  // Initial render
  setTimeout(render, 1200)

  // Watch DOM changes — search results / profile sections load asynchronously
  const observer = new MutationObserver(() => {
    if (collapsed) return
    const pageType = detectPageType()
    if (pageType === PAGE.PROFILE || pageType === PAGE.SALES_LEAD) {
      const profile = readProfile()
      const key = 'profile|' + profile.slug + '|' + profile.name
      if (key !== lastKey) render()
    } else if (pageType === PAGE.SEARCH || pageType === PAGE.SALES_SEARCH) {
      const results = readSearchResults()
      const key = 'search|' + results.length + '|' + (results[0] && results[0].profileUrl)
      if (key !== lastKey) render()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // ============================================================
  // Sidebar HTML (Shadow-DOM contents) — same purple Apple-ish style as Gmail
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

        width: 360px;
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
      }
      #root.collapsed .header {
        padding: 0; height: 44px; width: 44px;
        justify-content: center;
        border-bottom: none;
        cursor: pointer;
      }
      .logo {
        width: 22px; height: 22px;
        background: var(--brand);
        color: white;
        border-radius: 6px;
        display: grid; place-items: center;
        font-weight: 600; font-size: 12px;
        flex-shrink: 0;
      }
      .header-text { font-weight: 600; font-size: 13px; flex: 1; }
      #collapse-btn {
        background: none; border: none; cursor: pointer;
        color: var(--muted); padding: 4px 6px;
        border-radius: 4px; font-size: 14px; line-height: 1;
      }
      #collapse-btn:hover { background: var(--surface-2); color: var(--body); }
      #root.collapsed #collapse-btn { display: none; }

      #content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex; flex-direction: column;
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

      .contact-card {
        padding: 12px;
        border-radius: 8px;
        background: var(--brand-100);
        border: 1px solid rgba(122, 94, 255, 0.2);
      }
      .contact-card.unknown {
        background: var(--surface-2);
        border-color: var(--border);
      }
      .contact-card .name { font-weight: 600; font-size: 14px; line-height: 1.2; }
      .contact-card .meta { font-size: 12px; color: var(--muted); margin-top: 4px; }
      .contact-card .meta-faint { font-size: 11px; color: var(--faint); margin-top: 2px; }

      .badge {
        display: inline-flex; align-items: center;
        padding: 2px 8px; border-radius: 999px;
        font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.04em;
        margin-bottom: 6px;
      }
      .badge-success { background: rgba(48, 179, 107, 0.12); color: var(--success); }

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

      .action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .action-grid.one-col { grid-template-columns: 1fr; }
      .action-btn {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--surface);
        border: 1px solid var(--border);
        cursor: pointer; text-align: left;
        transition: border-color 0.15s, background 0.15s;
        font: inherit; color: inherit;
      }
      .action-btn:hover { border-color: var(--brand); background: var(--surface-2); }
      .action-btn .icon { font-size: 14px; }
      .action-btn .label { font-size: 12px; font-weight: 500; }

      .search-actions {
        display: flex; gap: 6px; margin-bottom: 8px; align-items: center;
      }
      .btn-tiny { font-size: 11px; padding: 4px 8px; }

      .result-list {
        max-height: 380px;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 8px;
      }
      .result-row {
        display: flex; gap: 8px; align-items: flex-start;
        padding: 8px 10px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
      }
      .result-row:last-child { border-bottom: none; }
      .result-row:hover { background: var(--surface-2); }
      .result-row input[type="checkbox"] { margin-top: 2px; flex-shrink: 0; }
      .result-meta { min-width: 0; flex: 1; }
      .result-meta .name { font-weight: 500; font-size: 13px; line-height: 1.3; }
      .result-meta .meta-faint { font-size: 11px; color: var(--faint); margin-top: 2px; line-height: 1.3; }

      .form-drawer {
        background: var(--surface);
        border-radius: 8px;
        border: 1px solid var(--border);
        padding: 10px;
      }
      .form-drawer h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 600; }
      .form-drawer label {
        display: block; font-size: 10px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.04em;
        color: var(--faint); margin-bottom: 4px;
      }
      .form-drawer .field { margin-bottom: 8px; }
      .form-drawer .row { display: flex; gap: 6px; }
      .form-drawer input {
        width: 100%; font: inherit;
        padding: 6px 8px;
        border: 1px solid var(--border); border-radius: 6px;
        background: var(--bg); color: var(--body); font-size: 12px;
      }
      .form-drawer .actions { display: flex; gap: 6px; margin-top: 8px; }

      .btn {
        display: inline-flex; align-items: center; justify-content: center;
        gap: 6px; padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: var(--surface);
        font: inherit; font-size: 12px; font-weight: 500;
        cursor: pointer; color: var(--body);
        border-color: var(--border);
      }
      .btn:hover { background: var(--surface-2); }
      .btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-primary { background: var(--brand); color: white; border-color: var(--brand); }
      .btn-primary:hover:not(:disabled) { background: var(--brand-700); }
      .btn-ghost { background: transparent; border-color: transparent; color: var(--muted); }
      .btn-ghost:hover { background: var(--surface-2); color: var(--body); }
      .btn-secondary { border-color: rgba(0,0,0,0.18); }

      .toast {
        padding: 8px 10px; border-radius: 8px;
        font-size: 12px; line-height: 1.4;
      }
      .toast.ok  { background: rgba(48, 179, 107, 0.10); color: var(--success); }
      .toast.err { background: rgba(239, 76, 76, 0.08); color: var(--danger); }

      .muted { color: var(--muted); }
      .small { font-size: 11px; }

      @media (prefers-color-scheme: dark) {
        #root {
          --bg: #1c1c1f; --surface: #25252a;
          --surface-2: #2e2e33; --surface-3: #3a3a40;
          --border: rgba(255, 255, 255, 0.10);
          --body: #f0f0f2; --muted: #a8a8b0; --faint: #71717a;
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

  console.log('[Hashio CRM] LinkedIn content script loaded')
})()
