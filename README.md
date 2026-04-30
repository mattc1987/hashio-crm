# Hashio CRM

Internal customer + deal management for Hashio. Replaces HubSpot with a simpler, ruthlessly-focused tool that stays on top of the Google Sheet your team already edits.

## Quick start

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Reads your data from the Google Sheet out of the box.

To enable writes / hosting / team access: see [**SETUP.md**](./SETUP.md).

## Chrome extension

A Gmail-integrated companion lives in [`chrome-ext/`](./chrome-ext/) — log emails, create tasks, manage deals, and run the AI BDR straight from your inbox. See [chrome-ext/README.md](./chrome-ext/README.md) for install instructions.

## Stack

- **Vite + React 19 + TypeScript** — fast, small, no SSR needed (internal tool).
- **Tailwind v4** — design tokens in CSS, no config file.
- **Google Sheets via gviz CSV** — reads (no auth needed for view-public sheets).
- **Apps Script web app** — writes (see `apps-script/Code.gs`).
- **papaparse** — CSV import.
- **lucide-react** — icons.
- **date-fns** — date formatting.

Apple-style visual language: SF font stack, rounded corners, soft shadows, glass sidebar, generous whitespace, auto light/dark based on system preference.

## Layout

```
src/
  App.tsx                  # routes
  main.tsx                 # entry
  index.css                # Tailwind + theme tokens
  components/
    AppShell.tsx           # sticky sidebar + top bar shell
    Sidebar.tsx
    TopBar.tsx
    ui.tsx                 # Card, Button, Badge, Stat, Input, etc.
  pages/
    Dashboard.tsx
    Deals.tsx
    Companies.tsx
    CompanyDetail.tsx
    Contacts.tsx
    Tasks.tsx
    ExecUpdates.tsx
    Import.tsx
    Settings.tsx
    NotFound.tsx
  lib/
    types.ts               # Sheet schema types
    sheets.ts              # read via gviz CSV
    api.ts                 # write via Apps Script
    useSheet.ts            # React hook that manages load state
    sheet-context.ts       # React context wrapping useSheet
    format.ts              # currency, dates, MRR math
    theme.ts               # light/dark/system
    cn.ts                  # tiny classname joiner
apps-script/
  Code.gs                  # paste into an Apps Script project bound to the Sheet
```

## Data model

The Sheet has these tabs (schema designed by Claude Cowork — we reuse it verbatim):

- `Companies` — id, name, industry, licenseCount, website, address, notes, size, created/updated
- `Contacts` — id, firstName, lastName, email, phone, title, companyId, status, createdAt
- `Deals` — id, title, contactId, companyId, value, stage, probability, closeDate, mrr, billingCycle, contractStart/End, mrrStatus, notes, created/updated
- `Tasks` — id, title, dueDate, priority, contactId, dealId, notes, status, created/updated
- `Activity` — id, type, text, icon, createdAt (audit log)
- `Invoices` — id, companyId, dealId, period, sent, sentDate, createdAt
- `Cashflow` — id, period (YYYY_MM), expenses
- `ExecUpdates` — id, period, newCustomers, savedMRR, prevMRR, demosBooked, wins, plans, losses, problems

MRR is stored per deal. "Active MRR" = Closed Won deals with `mrrStatus=active` (or blank) and `mrr > 0`, normalized to monthly (quarterly ÷ 3, annual ÷ 12). See `src/lib/format.ts`.

## What's in V1

- Dashboard (exec summary, MRR, pipeline, top clients, upcoming tasks)
- Deals list (filters + search)
- Companies list + company detail pages
- Contacts list
- Tasks list with check-off (queued locally; syncs once backend is deployed)
- Exec Updates page
- CSV import
- Light/dark theme (auto, follows system)
- Mobile responsive
- Sticky sidebar

## What's next

See [SETUP.md → What's next](./SETUP.md#whats-next).
