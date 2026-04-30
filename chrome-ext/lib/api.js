// Shared API client — used by popup, options, and background.
// Talks to the same Apps Script that the web app uses, with the same
// `action` + `key` + `payload` URL/form params. Same auth model.
//
// Settings are stored in chrome.storage.local under HASHIO_CFG.

export const STORAGE_KEY = 'HASHIO_CFG'

/** Read config from chrome.storage. Returns { appsScriptUrl, apiKey } or null. */
export async function getConfig() {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  const cfg = stored[STORAGE_KEY]
  if (!cfg || !cfg.appsScriptUrl || !cfg.apiKey) return null
  return cfg
}

/** Save config to chrome.storage. */
export async function setConfig(cfg) {
  await chrome.storage.local.set({ [STORAGE_KEY]: cfg })
}

/** POST to Apps Script. Form-encoded so we don't trigger CORS preflight.
 *  Returns the parsed JSON `data` from the response, or throws. */
export async function callScript(action, payload = {}) {
  const cfg = await getConfig()
  if (!cfg) throw new Error('Not configured — open the extension settings to add your Apps Script URL + API key.')

  const body = new URLSearchParams()
  body.set('action', action)
  body.set('key', cfg.apiKey)
  body.set('payload', JSON.stringify(payload))

  const res = await fetch(cfg.appsScriptUrl, {
    method: 'POST',
    body,
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  let json
  try { json = JSON.parse(text) }
  catch {
    throw new Error('Apps Script returned non-JSON. First 200 chars: ' + text.slice(0, 200))
  }
  if (!json.ok) {
    if (typeof json.error === 'string' && /unknown action/i.test(json.error)) {
      throw new Error(`The deployed Apps Script doesn't have the "${action}" action. Redeploy the latest Code.gs.`)
    }
    throw new Error(json.error || 'Failed')
  }
  return json.data
}

/** Same as callScript, but for write ops via the existing `write` action. */
export async function write(entity, op, payload) {
  return callScript('write', { entity, op, payload })
}

/** Test connection — pings getTwilioStatus (a cheap, always-deployed action). */
export async function testConnection() {
  // Use a minimal action to verify URL + key. getTwilioStatus is safe and always
  // available on the deployed Apps Script.
  const data = await callScript('getTwilioStatus', {})
  return data
}

/** Find a contact by email (case-insensitive). Returns first match or null. */
export async function findContactByEmail(email) {
  if (!email) return null
  const lower = email.toLowerCase().trim()
  const all = await callScript('readAll', {})
  const contacts = all.contacts || []
  return contacts.find((c) => (c.email || '').toLowerCase().trim() === lower) || null
}

/** Read all CRM data once. Cached in memory for ~30 seconds via background. */
export async function readAll() {
  return callScript('readAll', {})
}

/** Lightweight: just the entities the popup typically needs (contacts +
 *  open deals + companies). Falls back to readAll until the Apps Script
 *  has a slimmer endpoint. */
export async function readSlim() {
  const all = await callScript('readAll', {})
  return {
    contacts: all.contacts || [],
    deals: all.deals || [],
    companies: all.companies || [],
  }
}
