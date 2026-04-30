# Hashio CRM — Chrome Extension

A Gmail-integrated companion for the Hashio CRM. Click any email in your inbox, click the Hashio extension icon, and see the sender's CRM card + quick actions:

- 📧 **Log this email** as activity (inbound or outbound)
- ✅ **Create task** with the email pre-filled
- 💼 **Add to existing deal** OR create a new one
- ✨ **AI BDR** — opens the contact's AI BDR drawer in the web app
- 👤 **Add as contact** if the sender isn't in your CRM yet
- 🔍 **Quick search** across all contacts / deals / companies (works anywhere, not just Gmail)

## Install (one-time, ~2 min)

1. Open Chrome → `chrome://extensions/`
2. Toggle **Developer mode** (top-right corner)
3. Click **Load unpacked**
4. Pick the `chrome-ext/` folder inside the Hashio repo
5. The extension installs. **Pin it** to the toolbar (puzzle-piece icon → click pushpin next to "Hashio CRM")

## Configure (one-time, ~30 sec)

1. Click the extension icon → it'll say "Configure first"
2. Click **Open settings**
3. Paste:
   - **Apps Script URL** — same `VITE_APPS_SCRIPT_URL` as in your `.env` file (ends in `/exec`)
   - **API key** — same `VITE_APPS_SCRIPT_KEY` as in your `.env` file
4. Click **Save & test connection** — should show green ✅

## Use it

1. Open a Gmail email
2. Click the Hashio CRM icon in the toolbar
3. Popup shows the sender's CRM info + 4 action buttons
4. Click any action → it runs against your Apps Script (same backend as the web app, so changes appear in your Sheet immediately)

When NOT viewing an email:
- Quick search still works — type any name/email/company/deal title to find it in the CRM
- Click any result to open it in the web app

## Architecture

- **Manifest V3** — modern Chrome extension format
- **Service worker** (`background/background.js`) — handles all API calls, caches CRM data 30 sec to avoid spam
- **Content script** (`content/content.js`) — runs on `mail.google.com`, scrapes the currently-displayed email's sender / subject / body when the popup asks
- **Popup** (`popup/popup.html` + `popup.js`) — main UI when you click the toolbar icon
- **Options page** (`options/options.html` + `options.js`) — Apps Script URL + API key configuration
- **Shared lib** (`lib/api.js`) — single API client used by popup, options, and background

All four communicate via `chrome.runtime.sendMessage` for type-safe messaging.

## Data flow

```
Gmail email open
    ↓
Click extension icon → popup.js opens
    ↓
popup.js → tabs.sendMessage(GET_CURRENT_EMAIL) → content.js scrapes DOM
    ↓
popup.js → runtime.sendMessage(GET_CRM_DATA) → background.js → Apps Script readAll
    ↓
popup.js renders contact card + actions
    ↓
User clicks action → popup.js → runtime.sendMessage(CALL_SCRIPT)
    ↓
background.js → Apps Script write/etc → invalidates cache
    ↓
Toast confirmation in popup
```

## What requires the latest Apps Script deploy

The extension uses these Apps Script actions (all already deployed):

- `readAll` — reads all CRM tabs
- `write` (for create/update/delete on any entity) — used for task/deal/contact/activity log creation
- `getTwilioStatus` — used as the connection-test ping (lightweight, always available)

If the connection test fails with "Unknown action", redeploy the latest `apps-script/Code.gs` from the repo.

## Updating the extension

When code changes (you `git pull` and there's a new commit touching `chrome-ext/`):

1. Open `chrome://extensions/`
2. Find "Hashio CRM" in the list
3. Click the **🔄 reload icon** on the extension card

That's it — no re-install needed.

## Limitations / Phase 2 ideas

- **Compose-window integration** — currently we read the email being viewed, not the one being drafted. Phase 2 could inject a "Use Hashio template" button into Gmail's compose window.
- **Inline sidebar** — the popup is a separate window. Phase 2 could inject a sidebar directly into Gmail using InboxSDK or a custom DOM injection.
- **Auto-log on send** — Phase 2 could automatically log emails as you send them (currently the auto-scanner does this hourly).
- **OAuth → Gmail API** — direct API access would be more reliable than DOM scraping, but adds OAuth setup complexity.
