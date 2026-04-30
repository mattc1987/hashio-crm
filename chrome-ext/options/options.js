import { getConfig, setConfig, testConnection, STORAGE_KEY } from '../lib/api.js'

const urlInput = document.getElementById('url')
const keyInput = document.getElementById('key')
const saveBtn = document.getElementById('save')
const clearBtn = document.getElementById('clear')
const revealBtn = document.getElementById('reveal')
const resultEl = document.getElementById('result')

// Load existing config on mount
;(async () => {
  const cfg = await getConfig()
  if (cfg) {
    urlInput.value = cfg.appsScriptUrl
    keyInput.value = cfg.apiKey
  }
})()

revealBtn.addEventListener('click', () => {
  const isPwd = keyInput.type === 'password'
  keyInput.type = isPwd ? 'text' : 'password'
  revealBtn.textContent = isPwd ? 'Hide' : 'Show'
})

saveBtn.addEventListener('click', async () => {
  const url = urlInput.value.trim()
  const key = keyInput.value.trim()
  if (!url || !key) {
    showResult('Both URL and API key are required.', false)
    return
  }
  if (!url.includes('script.google.com')) {
    showResult('That doesn\'t look like an Apps Script URL. Should start with https://script.google.com/macros/s/...', false)
    return
  }

  saveBtn.disabled = true
  saveBtn.textContent = 'Saving + testing…'
  try {
    await setConfig({ appsScriptUrl: url, apiKey: key })
    // Test the connection
    await testConnection()
    showResult('✅ Connection works. You can now use the extension from Gmail.', true)
  } catch (err) {
    showResult('❌ ' + (err.message || 'Connection failed'), false)
  } finally {
    saveBtn.disabled = false
    saveBtn.textContent = 'Save & test connection'
  }
})

clearBtn.addEventListener('click', async () => {
  if (!confirm('Clear all settings? You\'ll need to re-enter the URL and API key.')) return
  await chrome.storage.local.remove(STORAGE_KEY)
  urlInput.value = ''
  keyInput.value = ''
  showResult('Settings cleared.', true)
})

function showResult(msg, ok) {
  resultEl.style.display = 'block'
  resultEl.className = 'result ' + (ok ? 'ok' : 'err')
  resultEl.textContent = msg
}
