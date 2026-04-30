// Content script — runs on mail.google.com pages.
// Reads the currently-open email's metadata when the popup asks for it.
// Gmail's DOM is dynamic + complex, so we use multiple selectors with fallbacks.

(function () {
  // Listen for popup requests
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'GET_CURRENT_EMAIL') {
      try {
        const email = readCurrentEmail()
        sendResponse({ ok: true, email })
      } catch (err) {
        sendResponse({ ok: false, error: (err && err.message) || String(err) })
      }
    } else if (msg && msg.type === 'PING') {
      sendResponse({ ok: true, pong: true })
    }
    return true
  })

  /** Read the currently-displayed email. Returns:
   *  { senderName, senderEmail, subject, bodyPreview, date, threadId, messageId }
   *  Returns null fields when something can't be parsed. */
  function readCurrentEmail() {
    // Are we on a thread view? Gmail URL hash contains the thread id.
    const hash = window.location.hash || ''
    const isThreadView = /\/[A-Za-z0-9]+\/[A-Za-z]+\.\w+\.[A-Za-z0-9_-]+$/.test(hash) ||
                          /#inbox\/[A-Za-z0-9]+/.test(hash) ||
                          /#sent\/[A-Za-z0-9]+/.test(hash) ||
                          /#search/.test(hash) ||
                          /#all\/[A-Za-z0-9]+/.test(hash) ||
                          /#label\//.test(hash) && hash.split('/').length >= 3

    // Heuristic: any message rendered with class .gs (header) or .h7 (subject)?
    const subjectEl = document.querySelector('h2.hP, [data-thread-perm-id] h2, [role="main"] h2')
    if (!subjectEl) {
      return null // Not viewing a single email
    }

    const subject = (subjectEl.textContent || '').trim()

    // Sender: Gmail uses .gD (sender name + email span) on the most recent message
    // Fall back to email-only spans
    let senderName = ''
    let senderEmail = ''

    // The most recent expanded message in the thread
    const senderSpan = document.querySelector('[role="main"] .gD, [role="main"] [email]')
    if (senderSpan) {
      senderName = senderSpan.getAttribute('name') || (senderSpan.textContent || '').trim()
      senderEmail = senderSpan.getAttribute('email') || ''
    }

    // Fallbacks if .gD not found — search for any [email] in the main pane
    if (!senderEmail) {
      const fallback = document.querySelector('[role="main"] [email]')
      if (fallback) senderEmail = fallback.getAttribute('email') || ''
    }

    // Body preview: .a3s.aiL is the message body container
    let bodyPreview = ''
    const bodyEl = document.querySelector('[role="main"] .a3s')
    if (bodyEl) {
      bodyPreview = ((bodyEl.innerText || bodyEl.textContent) || '').trim().slice(0, 800)
    }

    // Date: .g3 holds the date in the message header
    let date = ''
    const dateEl = document.querySelector('[role="main"] .g3, [role="main"] [data-tooltip-contains-time]')
    if (dateEl) {
      const tooltip = dateEl.getAttribute('data-tooltip') || dateEl.getAttribute('title')
      date = tooltip || (dateEl.textContent || '').trim()
    }

    // Thread / message id from URL hash. Gmail's hash format varies.
    let threadId = ''
    const hashMatch = hash.match(/\/([A-Za-z0-9]+)$/)
    if (hashMatch) threadId = hashMatch[1]

    return {
      senderName: senderName || senderEmail || '',
      senderEmail: senderEmail.toLowerCase(),
      subject,
      bodyPreview,
      date,
      threadId,
      url: window.location.href,
    }
  }

  // Optional: console hint so we know the script is loaded
  console.log('[Hashio CRM] content script loaded on', window.location.host)
})()
