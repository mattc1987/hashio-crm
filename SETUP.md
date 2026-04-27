# Hashio CRM — Setup guide

**Reading this for the first time? Welcome back, Matt.** This walkthrough gets the CRM fully live — writes saving to your Sheet, the app hosted at a real URL your team can open, optional custom domain. Total time: **~45 min**.

There are four steps. Do them in order.

1. [Run it locally first (2 min)](#1-run-it-locally)
2. [Deploy the Apps Script backend (10 min)](#2-deploy-the-apps-script-backend)
3. [Push to GitHub + Vercel (15 min)](#3-deploy-the-app-to-vercel)
4. [Restrict who can sign in (later drop)](#4-team-sign-in)

---

## 1. Run it locally

Open Terminal and paste:

```bash
cd ~/Desktop/hashio-crm
npm install            # first time only
npm run dev
```

Your browser opens at `http://localhost:5173`. You should see the dashboard with your real Hashio data loaded from the Google Sheet.

**If nothing loads:** the Sheet needs to be viewable-by-link (you already set this). If the status dot goes red in the footer, open `Settings` in the app — it'll tell you what's wrong.

---

## 2. Deploy the Apps Script backend

This is what lets the CRM **write** data back to your Sheet (new deals, edits, task check-offs). Until you do this, the app runs read-only and queues any writes locally.

### 2.1 — Open Apps Script

1. Open your CRM Google Sheet.
2. Top menu: **Extensions → Apps Script**.
3. A new tab opens with a code editor.

### 2.2 — Paste the backend code

1. Delete everything in the default `Code.gs` file.
2. Open `~/Desktop/hashio-crm/apps-script/Code.gs` in any text editor (TextEdit is fine), copy all of it, and paste it in.
3. Click the **💾 Save** icon (or Cmd+S). When prompted, name the project "Hashio CRM API".

### 2.3 — Generate an API key

1. In the Apps Script editor, at the top of the code, there's a dropdown that says **"Select function"**. Change it to **`setupApiKey`**.
2. Click **▶ Run**.
3. First run only: it'll ask for permission. Click **Review permissions → your Google account → Advanced → Go to Hashio CRM API (unsafe) → Allow**. (It's "unsafe" only because it's your own script, not published by a company.)
4. Click **View → Logs** (or Cmd+Enter). You'll see something like:
   ```
   API_KEY set. Copy this into your .env as VITE_APPS_SCRIPT_KEY:

   a1b2c3d4e5f6...
   ```
5. Copy that key. You'll paste it in a minute.

### 2.4 — Deploy as a web app

1. Click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** `v1`
   - **Execute as:** `Me` (your Google account)
   - **Who has access:** `Anyone`  ← yes, Anyone. The API key protects it.
4. Click **Deploy**.
5. Copy the **Web app URL** it gives you (ends in `/exec`).

### 2.4b — Install the sequence triggers (only if you plan to use email sequences)

The email sequences feature needs two time-based triggers to run on a loop:

1. In the Apps Script editor, change the function dropdown to **`installSequenceTriggers`**.
2. Click **▶ Run**.
3. If it prompts for Gmail permission (it will — the script sends mail from your Gmail), click through the Review → Allow steps as before.
4. Check the log. You should see `Installed: runScheduler every 5m, checkReplies every 15m.`

Your sequences now run automatically. If you ever want to turn them off, run `uninstallSequenceTriggers`.

**Gmail quota notes**
- Personal Gmail: **100 sequence emails / day** total across the whole script.
- Google Workspace: **1,500 emails / day**.
- Hashio is on Workspace → plenty for sales sequences.

### 2.5 — Wire it into the app

1. In Terminal:
   ```bash
   cd ~/Desktop/hashio-crm
   cp .env.example .env.local
   open .env.local
   ```
2. Paste your two values in:
   ```
   VITE_APPS_SCRIPT_URL=https://script.google.com/.../exec
   VITE_APPS_SCRIPT_KEY=a1b2c3d4e5f6...
   ```
3. Save. Restart `npm run dev`. Open Settings in the app — the Write access row should now say **Ready** ✓.

---

## 3. Deploy the app to Vercel

So your team can open it at a URL, not just your laptop.

### 3.1 — Push to GitHub

1. Go to [github.com/new](https://github.com/new). Create a repo named `hashio-crm`. Keep it **private**.
2. In Terminal:
   ```bash
   cd ~/Desktop/hashio-crm
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/hashio-crm.git
   git push -u origin main
   ```

### 3.2 — Connect Vercel

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub.
2. Click **Add New → Project**. Pick your `hashio-crm` repo.
3. Framework preset: **Vite** (auto-detected).
4. **Environment Variables** — add these two:
   - `VITE_APPS_SCRIPT_URL` = (same value as your `.env.local`)
   - `VITE_APPS_SCRIPT_KEY` = (same value as your `.env.local`)
5. Click **Deploy**. ~90 seconds later you have a live URL like `hashio-crm.vercel.app`.

### 3.3 — Custom domain (optional)

In Vercel → your project → **Settings → Domains** → add `crm.hashio.co` (or whatever domain you own). Follow Vercel's DNS instructions — usually one `CNAME` record.

---

## 4. Team sign-in

**Status:** planned for the next drop, not in V1.

V1 is unauthenticated — anyone who has the URL can see the CRM. Keep the URL private until sign-in lands. Add Google sign-in by:

1. Create OAuth credentials in [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → OAuth client ID → Web application.
2. Authorized redirect URI: `https://your-vercel-url.vercel.app/auth/callback`.
3. Add sign-in UI (Next drop — Claude will build this).

---

## Troubleshooting

**"Couldn't reach the Sheet"**
The Sheet is view-restricted. In Google Sheets: **Share → General access → Anyone with the link → Viewer**.

**"Unauthorized" on writes**
The `VITE_APPS_SCRIPT_KEY` in `.env.local` (or Vercel env vars) doesn't match what's in Apps Script → Project Settings → Script Properties → `API_KEY`. Copy it fresh.

**Writes silently not saving**
Open Settings in the app. If "Write access" says "Not configured" or pending writes are stacking up, your Apps Script URL is probably wrong or the deployment is an old version. In Apps Script: **Deploy → Manage deployments → edit → new version → redeploy**.

**New deployment broke things**
Apps Script deployments are versioned. You can always roll back in **Deploy → Manage deployments**.

---

## What's already done

- ✅ Apple-style UI, sticky sidebar, light + dark mode, mobile responsive
- ✅ Dashboard with MRR, pipeline snapshot, top clients, exec update summary
- ✅ Deals list with stage filters + search
- ✅ Companies list with MRR per client
- ✅ Company detail pages with contacts, deals, tasks
- ✅ Contacts list
- ✅ Tasks list with check-off (syncs via Apps Script once deployed)
- ✅ Exec Updates page
- ✅ **Email sequences** with four step types (send email, wait, if/then branch, take action), merge tags, reply detection, open tracking
- ✅ **Email templates** with merge-tag preview
- ✅ **Enrollment UI** — pick a contact, enroll them, see their progress and the next fire time
- ✅ CSV import for contacts / deals / companies / tasks
- ✅ Reads from your existing Google Sheet (`1kHn4GA2...`)
- ✅ Writes queued locally when backend isn't live

## New sheet tabs (auto-populated on first write)

The sequences feature adds these tabs. You don't have to create them — the app will create rows in them once you start building sequences and they already exist. If they don't exist yet, manually add tabs named:

- **`Sequences`** — columns: `id, name, description, status, createdAt, updatedAt`
- **`SequenceSteps`** — columns: `id, sequenceId, order, type, config, label`
- **`EmailTemplates`** — columns: `id, name, subject, body, category, createdAt, updatedAt`
- **`Enrollments`** — columns: `id, sequenceId, contactId, dealId, currentStepIndex, status, enrolledAt, lastFiredAt, nextFireAt, notes`
- **`EmailSends`** — columns: `id, enrollmentId, sequenceId, stepId, contactId, to, subject, bodyPreview, threadId, messageId, sentAt, openedAt, repliedAt, clickedAt, status, errorMessage`

(Row 1 = headers exactly as above. Leave the rest blank; the app fills them.)

## How sequences work under the hood

- **Sending:** `GmailApp.sendEmail()` inside Apps Script sends from *your* Gmail. Replies land in your inbox normally.
- **Scheduling:** A time trigger fires `runScheduler` every 5 minutes. It looks for enrollments where `status=active` and `nextFireAt < now`, then advances them one step.
- **Tracking opens:** Each email gets a 1×1 transparent pixel whose URL hits your Apps Script with `?action=trackOpen&s=<sendId>`. The script records `openedAt` on the matching `EmailSends` row.
- **Detecting replies:** `checkReplies` runs every 15 min. For each sent email, it re-reads the Gmail thread. If a message from the recipient appears after the sent one, we mark `repliedAt` and stop the enrollment (unless the step was configured to continue).
- **Logic gates:** Branch steps evaluate conditions like "opened the last email within 48h," "replied," "deal stage is Closed Won." The editor UI lets you pick the condition and the true/false next step.

## What's next (after V1 is live)

- Team Google sign-in with per-user assignments
- Per-contact / per-deal "Enroll in sequence" button (UI for bulk enrollment from a segmented list)
- Executive summary **generation** (AI-drafted monthly report from your data)
- Cashflow deep-dive with Stripe / QuickBooks integration
- Reporting (pipeline velocity, win rates, sequence conversion rates)
- Custom tracking domain (so `trackOpen` URLs look like `t.hashio.co` instead of `script.google.com`)
