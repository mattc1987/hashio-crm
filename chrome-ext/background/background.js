// Background service worker. Handles:
//  - Long-lived API calls so the popup can close + reopen without losing state
//  - In-memory cache of CRM data (30 sec TTL) to avoid re-fetching on every popup open
//  - Cross-component messaging hub (content script → popup, etc.)

import { callScript, readAll } from '../lib/api.js'

const CACHE_TTL_MS = 30 * 1000
let cachedData = null
let cachedAt = 0

async function getCachedData(force = false) {
  const now = Date.now()
  if (!force && cachedData && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedData
  }
  cachedData = await readAll()
  cachedAt = now
  return cachedData
}

function invalidateCache() {
  cachedData = null
  cachedAt = 0
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Always async — we need to use sendResponse with `return true` pattern.
  ;(async () => {
    try {
      switch (msg.type) {
        case 'GET_CRM_DATA': {
          const data = await getCachedData(msg.force === true)
          sendResponse({ ok: true, data })
          break
        }
        case 'INVALIDATE_CACHE': {
          invalidateCache()
          sendResponse({ ok: true })
          break
        }
        case 'CALL_SCRIPT': {
          const data = await callScript(msg.action, msg.payload || {})
          // Many actions are writes — invalidate cache so next read is fresh
          invalidateCache()
          sendResponse({ ok: true, data })
          break
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type: ' + msg.type })
      }
    } catch (err) {
      sendResponse({ ok: false, error: (err && err.message) || String(err) })
    }
  })()
  return true // keep the channel open for async sendResponse
})

// Log install + update for sanity
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Hashio] Extension', details.reason, '— version', chrome.runtime.getManifest().version)
})
