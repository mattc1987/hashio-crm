# Autonomous BDR Session — Summary

What I built while you were stepped away (April 29, 2026).

## TL;DR

The BDR is now a **proactive go-getter, not a reactive helper**. Three big additions:

1. **Dashboard AI Briefing** — top of `/dashboard`, Claude reads everything every visit and tells you what to focus on today, with one-click drill-ins.
2. **Lead generation suite** — `/leads` has a "Find more leads" button that opens a multi-option drawer: AI-suggested target accounts (lookalikes from your customers), CSV import, manual entry, webhook setup. Also wired on `/companies` and inside the Dashboard briefing.
3. **AI BDR buttons across the platform** — Tasks, Contacts, Deals, **Leads** all have a sparkle button → opens the AI BDR drawer with goal-aware prompts.

Plus: pipeline coverage math card on Dashboard, transparent error handling, no LLM calls hit URL length limits anymore (everything is POST).

---

## What's new (file-by-file)

### Apps Script (`apps-script/Code.gs`)

Two new actions, ~190 lines added:

- **`aiDashboardBriefing`** — accepts a compact CRM digest (replies waiting, hot leads, today's bookings, stale deals, pipeline shape, due tasks). Returns a strict-JSON briefing: greeting + narrative + 3-7 prioritized action cards + pipeline-health verdict. System prompt includes real BDR best practices (3-by-3 research, multi-channel, persistence math, BANT/MEDDIC).

- **`aiSuggestTargets`** — accepts your existing customers + optional criteria. Returns 5-20 lookalike target accounts: company name, state, size, license type, target roles, why-fit reasoning, confidence score, LinkedIn hint. Grounded in cannabis cultivation ICP (licensed, 50K+ sqft, 3+ harvest cycles, multi-strain, etc.).

### Frontend lib (`src/lib/bdrAi.ts`)

- `dashboardBriefing(data)` — builds the digest client-side and calls the action.
- `suggestTargets(data, options)` — passes Closed-Won customers as lookalike basis.
- `buildDashboardDigest()` — surfaces only what Claude needs (avoids token bloat).

### Dashboard

- **`DashboardAIBriefing`** (`src/components/dashboard/DashboardAIBriefing.tsx`) — Top of `/dashboard`. Auto-runs on first visit. 30-min in-memory cache so navigating away + back doesn't re-burn tokens. Manual refresh button. Each priority card is clickable → opens AI BDR drawer pre-loaded for that entity, OR opens Find Leads drawer for `find-leads` priorities, OR navigates to `/scheduling` for booking priorities.

- **`PipelineCoverageCard`** — pure-math view (no LLM). Current MRR, target MRR (defaults to current × 1.5 or $25K floor), gap, weighted pipeline, and coverage ratio. Verdict badge: healthy / thin / critical based on the SaaS 3x rule.

### Lead generation

- **`LeadGenerationDrawer`** (`src/components/dashboard/LeadGenerationDrawer.tsx`) — multi-mode drawer:
  - **AI suggest** — type optional criteria + count, click Suggest → see proposed target cards with badges (state, size, license type, confidence). Click "Add to leads" on each → creates one lead per target role (or one cold-status lead per company if no roles given). All marked `source: 'ai-suggested'` for attribution.
  - **CSV import** — links to existing `/import` page.
  - **Manual entry** — quick form: name, email, LinkedIn, company, title.
  - **Webhook info** — points to Settings.

- **Wired on**: Dashboard briefing card (when AI flags pipeline thin), `/leads` header ("Find more leads" primary button), `/companies` header ("Find leads" secondary button).

### AI BDR buttons everywhere

- **`/leads`** rows — small ✨ AI pill on each lead row. Opens AI BDR drawer with goal: "qualify, convert, or pause based on what's most actionable."
- **`/contacts/[id]`** detail — purple "AI BDR" button in the action bar (already there from earlier).
- **`/deals/[id]`** detail — same (already there from earlier).
- **`/tasks`** rows — small AI BDR pill on each open task (already there).

### Type fixes / plumbing

- `bdrAi.ts` — exports `SuggestEntity` properly (was internal type).
- All `Contact`/`Deal`/`Lead`/`Task` `find()` callbacks now have explicit types so strict TS passes.
- Switched the AI BDR call to POST in an earlier commit — payloads of any size work without URL-truncation crashes.

---

## How to verify it works (when you're back)

**1. Redeploy Apps Script** (~1 min)

Two new actions live there: `aiDashboardBriefing` + `aiSuggestTargets`. Without redeploy you'll see "Backend out of date" banner.

```
Sheet → Extensions → Apps Script → paste latest Code.gs → Deploy → Manage deployments → ✏️ → New version → Deploy
```

I left the latest version on your clipboard (running `pbcopy` on Code.gs at the end). If it's gone, just `cat apps-script/Code.gs | pbcopy` from the project root.

**2. Open `/dashboard`**

Should see a purple-tinted "AI BDR · Daily briefing" card at the very top. Greeting + narrative + 3-6 priority cards. Each card is clickable.

**3. Click a priority card**

Depending on what Claude flagged:
- "Reply to X" → opens AIBdrDrawer for that contact
- "Hot lead Y" → opens AIBdrDrawer for that lead
- "Stale deal Z" → opens AIBdrDrawer for that deal
- "Find more leads — pipeline thin" → opens LeadGenerationDrawer

**4. Try Find Leads**

From `/dashboard`, `/leads`, or `/companies` (button in header). Click "AI suggest target accounts" → leave criteria blank or type something specific → Suggest. Claude will return 10 target companies with reasoning + confidence. Click "Add to leads" on the ones you want.

**5. Check Pipeline coverage card**

Below the Today widget on Dashboard. Shows your current MRR, target, gap, and a healthy/thin/critical verdict.

---

## What I deliberately didn't build (and why)

- **Web search for leads** — the deployed app has no web search API. Could call Claude with web search via Anthropic Tools, but that's a meaningful Phase 2 addition. For now, AI suggests from training data + your existing customers (which works well for the cannabis ICP).
- **Company-level AI BDR drawer** — companies don't map cleanly to a single entity for "what's the next move." Skipped to avoid a half-baked feature. Workaround: click into a company's primary contact and use AI BDR there.
- **Daily 8am briefing email** — would need an Apps Script time-trigger. Defer until you decide whether to use email-push or just the on-page briefing.
- **Auto-narrative on every existing rule proposal** — would Claude every Briefing-page card. High token cost for marginal value. Use the AI BDR drawer instead for narrative-heavy cases.
- **Lead conversion in the AI suggest flow** — when you click "Add to leads," they go in as cold leads. Up to you whether to enroll/convert further from `/leads`.

---

## Known issues / things to watch

1. **Dashboard briefing cache is in-memory only** — survives navigation but not page refresh. By design (refresh = retell the day). Cache TTL is 30 min.

2. **AI suggested companies are not validated** — Claude can hallucinate company names. The confidence score and `linkedinHint` (a plausible LinkedIn search URL) help you verify. Treat as a starting list, not a vetted database.

3. **The `aiSuggestTargets` system prompt assumes cannabis cultivation ICP**. If you start selling to other industries (you mentioned hemp/CBD has a different ICP), tune the prompt in `apps-script/Code.gs` → search for "Hashio sells to LICENSED cultivators".

4. **Pipeline coverage default target** — currently `current MRR × 1.5` or `$25K` floor. If you want a different target (e.g., $X by Q3), I can wire it to a Settings field.

---

## Phase 3 ideas (next session candidates)

- **8am daily digest email** — Apps Script time-trigger sends the briefing to your inbox so you don't even need to open the app.
- **Multi-step plans** — "for this lead: today email, in 3d call, in 7d LinkedIn." Generate cadences not single moves.
- **Company-level AI** — drawer that aggregates all contacts + deals + activity for a company, recommends portfolio moves.
- **AI strategist mode on Briefing** — same drawer pattern but Claude generates *new* proposals beyond what the rules can see (free-form).
- **Self-tuning rule thresholds** — track your skip rate per rule, auto-loosen rules you always approve, tighten rules you always skip.
- **Web search for lead enrichment** — wire Anthropic Tools w/ web search to enrich AI-suggested companies with real-world data (recent funding, hiring, news).

---

## Commits in this session

Will be a single commit covering everything above. Push goes to `main` → GitHub Pages auto-deploys.

---

Made by Claude (Sonnet 4.5) under Matt's direction. Voice + ICP grounded in Hashio's actual positioning.
