# ScrubPay — Nursing Wage Planner

Take-home pay planner for bedside nurses (built for the owner's wife and friends).
Live at: https://patrick222-dotcom.github.io/705-v1/

## Dual project goals

1. Ship a working, polished app.
2. **Meta-goal:** refine a reusable multi-agent "development council" process the owner
   wants to reuse on future projects. Council improvements requested: context
   preservation between agents, automated fix→re-review iteration until all agents
   score 8/10, less manual synthesis by the orchestrator, and real mobile testing
   (headless Chromium with iPhone emulation — see Testing below).

## Architecture

- **Single-file app**: everything lives in `index.html` — React 18 + Babel standalone
  (JSX transformed in-browser), no build step. Keep it single-file.
- CDN dependencies (pinned versions, all with SRI hashes): React/ReactDOM 18.2.0 (unpkg),
  Babel standalone 7.24.7 (unpkg), pdf.js **main lib** 3.11.174 (cdnjs), supabase-js 2.45.4
  (jsdelivr). The pdf.js **worker** is hosted locally (`pdf.worker.min.js`, deployed next to
  `index.html`) — same-origin, no third-party CDN in the paystub path; `getDocument` uses
  `isEvalSupported:false` (CVE-2024-4367 hardening).
- **Data**: logged-in users → Supabase `user_data` table (one JSON blob per user,
  upserted, debounced 500ms; capped at `MAX_BLOB_BYTES` = 512KB as a free-tier guard).
  Anonymous users → localStorage (`nursingWagePlannerData`).
- **Feedback**: in-app widget (top-bar 💬 + Settings) → Supabase `feedback` table. RLS is
  insert-only for `anon`+`authenticated` (anyone can submit, **nobody can read back via the
  anon key** — submissions are private). Offline submissions are stashed in localStorage
  (`scrubpay_feedback_pending`) and flushed on next load. Read submissions as the owner via
  the dashboard or Management API: `select created_at, message, contact, user_id from
  public.feedback order by created_at desc;`
- **Analytics** (privacy-light): in-app `track(name, props)` inserts to Supabase `events`
  (insert-only RLS, same private model as `feedback`). Coarse events only — **never wage
  figures**: `app_open`, `setup_completed`, `shift_saved`, `paystub_imported`, `view_changed`
  (props `{view}`), `feedback_submitted`, `signed_in`. A stable per-device `anon_id`
  (localStorage `scrubpay_anon_id`) lets you count distinct anonymous users without PII. Query
  as owner: `select name, count(*) from public.events group by name order by 2 desc;` or
  `select created_at, name, props, anon_id, user_id from public.events order by created_at desc;`
- **Auth**: Supabase email/password + Google OAuth. Project ref: `mnnlgcxnvodjwlhhiphq`.
- **Boot hardening** (do not remove): plain-JS boot watchdog in `index.html` shows an
  error screen if the app hasn't rendered in 8s; Supabase client creation is
  null-guarded (app degrades to localStorage-only if the CDN script fails);
  `getSession()` is raced against a 4s timeout (known WebKit deadlock — iPhone Chrome
  is WebKit too). These fixed a long-standing infinite-spinner bug on iPhones.

## Deployment

- GitHub Pages via `.github/workflows/deploy.yml`.
- **This repo has no `main` branch.** The de facto default branch is
  `claude/migrate-to-github-deploy-3F5RD` and it is deliberately in the workflow's
  push triggers. If you remove it before a `main` branch exists, all deploys stop
  (this happened once). When work is eventually merged to `main`, remove it.

## Supabase MCP

- `.mcp.json` runs `@supabase/mcp-server-supabase` and expects `SUPABASE_ACCESS_TOKEN`
  as an environment variable (set in the Claude Code cloud environment settings —
  never commit the token). If MCP tools are available, use them directly instead of
  giving the owner dashboard instructions.
- **Network policy must allow `api.supabase.com`** (environment network settings) or
  both the MCP server and direct Management API calls get 403 from the egress proxy.
  Env vars and network policy load at container start. If MCP started without the
  token, the Management API via `curl` works as a fallback (POST
  `/v1/projects/<ref>/database/query` for SQL, GET/PATCH `/v1/projects/<ref>/config/auth`
  for auth settings, GET `/v1/projects/<ref>/advisors/{security,performance}`).

## Pending tasks (check before starting new work)

1. ~~RLS~~ **Done 2026-07-04**: RLS enabled on `user_data` with per-command policies
   `(select auth.uid()) = user_id` (subselect form per the performance advisor).
2. ~~Supabase Auth URL config~~ **Done 2026-07-04**: Site URL set to
   `https://patrick222-dotcom.github.io/705-v1/`, redirect allow list to
   `https://patrick222-dotcom.github.io/705-v1/**` via Management API.
3. ~~Verify Google sign-in on a real iPhone~~ **Done 2026-07-07**: owner confirmed Google
   sign-in works end-to-end on a real iPhone.
4. Rerun the improved agent council against the app (owner's standing request) —
   first full run with the automated fix→re-review loop done 2026-07-04, see
   `git log` for the fixes it produced.
5. ~~P1 backlog~~ **Done 2026-07-07**: Pages publishes only `index.html` + `pdf.worker.min.js`;
   pdf.js worker hosted locally; SRI hashes on all 5 CDN scripts (verified byte-for-byte vs
   live CDNs); client error monitoring (onerror + unhandledrejection ring buffer + "Copy error
   log"); free-tier guard (`MAX_BLOB_BYTES`). Note: leaked password protection (HIBP) is
   Pro-plan only — the API silently ignores it on the free tier.
6. **Free-tier headroom** (as of 2026-07-07): DB 11MB / 500MB, well within limits. Watch
   Monthly Active Users (50k cap) and DB size as friends join. Check usage:
   `GET /v1/projects/<ref>/usage` (Management API) or the dashboard's Usage page. The
   `MAX_BLOB_BYTES` guard and `feedback` length checks bound per-row growth.
7. **Feedback email delivery — BACKLOG (owner wants it; blocked on a Resend API key
   2026-07-07):** email each new `feedback` row to the owner. Plan: Supabase Edge Function
   (formats the row, sends via Resend `onboarding@resend.dev` → owner email; no domain setup
   needed to start) + a Database Webhook on `feedback` INSERT that calls it. Deploy the
   function via Management API (`POST /v1/projects/<ref>/functions`) and set the
   `RESEND_API_KEY` secret. Table stays the durable record; email is the notification layer.
   Ask the owner for the `re_...` key + destination address to proceed.
8. ~~Cross-device sync lag~~ **Fixed 2026-07-07 (v2, poll-based)**: focus/visibility refetch
   alone missed the common case (iPhone tab already foregrounded → no event fires; iOS
   `window.focus` is unreliable). Now also **polls every 15s while the tab is visible**.
   Guarded by `updated_at` vs a `lastSeenAt` ref AND a content-equality check (normalized,
   ignoring the local view period) so we never echo our own write, re-save identical data
   (which would ping-pong writes between two devices), or clobber unsaved local edits;
   `applyData(...,{keepPeriod:true})` leaves the user's current pay-period view alone. Still
   poll-based near-realtime (~15s), not push — a Supabase Realtime subscription (needs the
   table added to the `supabase_realtime` publication + `wss://*.supabase.co` in the CSP)
   would make it instant and is the future upgrade.
9. **NurseGrid capabilities — BUILT 2026-07-19 (owner green-lit going native instead of
   integrating).** Shipped in the orchestrated feature run: shift templates + quick-fill,
   work-life day events (PTO paid at base rate, education/appointment/off) + notes + shift
   start times, .ics export (deterministic UIDs, no wage data), and .ics import with a
   grouped Intuit-style shift-type questionnaire (re-import moves shifts, preserves assigned
   pay types via shift.icsUid). Original research below for reference.** Goal: pull a
   nurse's NurseGrid schedule into ScrubPay so they can project paychecks while self-scheduling.
   Research: NurseGrid has **no public API**; it offers an iCal feed/calendar sync + a shareable
   schedule link. Ready-to-build spec when demand appears:
   - **Import**: start with **.ics file upload** (most reliable, works offline on the static
     site; parse VEVENT date/times). A pasted iCal *subscribe URL* would need a proxy (CORS),
     so defer that. Screenshot/OCR is a later, lower-reliability option.
   - **Shift-type mapping** (NurseGrid events carry no pay differential): owner likes an
     **"Intuit-style" guided questionnaire** — e.g. "Is Tue Jul 7 a night or day shift?" —
     ideally pre-filled by inferring from start time + weekend, then confirmed per shift.
   - **Sync model**: one-time **re-import when the schedule changes** (no live sync without an
     API); a new import updates the affected dates.
   - Validate first via the `feedback` table (are users actually asking for this?).
   - **hStream / HealthStream angle (researched 2026-07-07):** NurseGrid was acquired by
     HealthStream; the **hStream Developer Portal** (developers.hstream.com) DOES expose
     RESTful APIs + **webhooks** (e.g. schedule-change events) and NurseGrid is in its first
     integration cohort. BUT access is a **gated B2B partner/customer program**: requires a
     pre-authorized hStreamID + "Request Access" approval + becoming **hStream-Certified**;
     data is a health *system's* authorized data (not an individual nurse's consent), so it
     near-certainly needs contracts + a **HIPAA BAA**. Not accessible to a personal/PoC app.
     This is the *legitimate* path to live NurseGrid sync **only if ScrubPay becomes a real
     product** and pursues certified-partner status — a business/legal step, not a code task.
     Revisit only with real demand + intent to commercialize.

## Testing (no device needed)

Chromium + Playwright are pre-installed (`executablePath: '/opt/pw-browsers/chromium'`).
The sandbox blocks CDNs/Supabase by default, but `registry.npmjs.org` is allowed:
download the pinned packages from npm, rewrite the script tags in a scratch copy of
`index.html` to local paths, serve with `python3 -m http.server`, and drive it with
Playwright using the iPhone 13 device profile. Capture `console`, `pageerror`, and
`requestfailed` events — this is how the mobile spinner bug was found. Test failure
modes too (block a script, hang `getSession()`), not just the happy path.
