# ScrubPay — Nursing Wage Planner

Take-home pay planner for bedside nurses (built for the owner's wife and friends).
Live at: **https://badgebudget.com** (custom domain since 2026-09-02 — see Domains below).
The old `https://patrick222-dotcom.github.io/705-v1/` URL 301-redirects here, so existing
bookmarks and invite links still work. **Verify deploys against badgebudget.com**, not github.io.

## Dual project goals

1. Ship a working, polished app.
2. **Meta-goal:** refine a reusable multi-agent "development council" process the owner
   wants to reuse on future projects. Council improvements requested: context
   preservation between agents, automated fix→re-review iteration until all agents
   score 8/10, less manual synthesis by the orchestrator, and real mobile testing
   (headless Chromium with iPhone emulation — see Testing below).

## Autonomous nightly loop

A nightly Routine (fresh session per fire) runs a **groom + build** loop against `BACKLOG.md`:
1. **Groom** — mine `feedback` + `events` (Supabase MCP or the documented curl fallback), review
   the app, and add/reprioritize P0–P3 items in `BACKLOG.md` (dedupe; skip Done/Blocked). Also run
   `node scripts/groom_seed.mjs` (Reddit-insights pipeline, see
   `docs/reddit-persona-pipeline.md`): it dedupes the `docs/reddit_seed.json` themes against
   CLAUDE.md + BACKLOG.md and refreshes the source-tagged "Reddit-seeded candidates" managed block
   (`--apply`). These are candidates for you to promote with judgment — they're not auto-built; the
   normal safety gate + one-item-per-run rules still apply.
   **Seed sources:** `seed` = curated pain patterns (2026-08-13). `reddit-owner` = gathered by the
   owner browsing Reddit in their own logged-in browser via Claude in Chrome (prompt:
   `docs/reddit_intake_prompt.md`), paraphrased on intake and carrying an `observed` field recording
   how widely the theme was actually seen — weight thin `observed` accordingly. `reddit-live` =
   direct API mining, **not available**: Reddit's Responsible Builder Policy closed self-serve app
   registration, so API access needs a manually-approved ticket. Don't send the owner to
   reddit.com/prefs/apps; it's gone. Egress to Reddit is fine — credentials are the gap.
   **Known dedupe defect:** a theme merely narrated in the Done log as *deferred* counts as covered
   and drops out of the candidate set (live example: `self-schedule-fairness`). Pinned by a test in
   `scripts/test_groom_seed.mjs`; don't "fix" it by reducing the Done log to bold titles — that
   regresses genuinely-shipped themes.
2. **Build** — implement the single highest-priority **unblocked, gate-safe** item end-to-end:
   develop on `claude/clause-md-review-9tqlj8` (restarted from the deploy base each run), test on
   the iPhone-13 Playwright harness (see Testing), pass the **safety gate**, then PR + squash-merge
   to the deploy branch (auto-deploys) and verify live. Mark it done in `BACKLOG.md`.

**Queue shape:** `BACKLOG.md` → `## Queue` holds only work a single run can finish. Items that need
a live repro, a design call, or delicate surgery live under **`## Needs a dedicated session (NOT for
the nightly loop)`** — don't pull from there, and move an item there (with a one-line reason) rather
than re-deferring it nightly. Auto-surfaced candidates carry a **`harness:`** tag: `drivable`
(verifiable end-to-end in the iPhone-13 sandbox — every build since 2026-08-17 has been one),
`needs-live-auth` (authenticated swap board; the sandbox can't reach it — verify by the swap-UI
standard of #27/#28 instead), `unscoped` (maps to no existing surface: a feature to design, not a
one-run build). Within a priority band, `drivable` is listed first — prefer it.

**Rules:** full autonomy but **gate-limited** — never weaken boot hardening / SRI / wage-core;
one build item per run; if an item is risky/ambiguous or the gate fails, mark it `deferred` with a
note and take the next safe item or stop (never deploy a failing gate). End with a concise summary
(delivered via the Routine's completion notification). `BACKLOG.md` is the durable memory — the
container is ephemeral, so commit everything.

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
- **Custom domain — `CNAME` must stay in the publish set.** `deploy.yml` stages only
  `index.html`, `pdf.worker.min.js` and `CNAME` into `_site`. Pages reads the custom domain
  out of the deployed artifact: **an Actions deploy whose artifact lacks `CNAME` can clear the
  custom domain setting and knock the site off badgebudget.com.** Never drop that `cp` line.
- **This repo has no `main` branch.** The de facto default branch is
  `claude/migrate-to-github-deploy-3F5RD` and it is deliberately in the workflow's
  push triggers. If you remove it before a `main` branch exists, all deploys stop
  (this happened once). When work is eventually merged to `main`, remove it.

## Domains (registered 2026-09-02, Porkbun)

Registrar **Porkbun**, account `pathwk`. All four registered 2026-09-02, expire 2027-09-01,
WHOIS privacy on (verified: no registrant PII in the public RDAP record), transfer lock on
(`clientTransferProhibited` + `clientDeleteProhibited`).

| Domain | Role | Renewal |
|---|---|---|
| **badgebudget.com** | **primary — the live app** | $11.08/yr |
| badgebudget.app | redirect → badgebudget.com | $14.93/yr |
| shiftstogo.com | redirect → badgebudget.com | $11.08/yr |
| shiftstogo.app | redirect → badgebudget.com | $14.93/yr |

**DNS on badgebudget.com** (Porkbun nameservers): four A records to GitHub Pages
(`185.199.108-111.153`), four AAAA (`2606:50c0:800{0..3}::153`), `www` CNAME →
`patrick222-dotcom.github.io`. The MX/SPF records for Porkbun email forwarding and the two
`_acme-challenge` TXT records are deliberately kept — they don't touch web traffic.
**URL Forwarding must stay OFF on badgebudget.com** — it overrides the A records entirely
(Porkbun's bundled "Link-in-Bio" turns it on at registration; it was removed).

**The app needed no code changes for the move**: `index.html` has no hardcoded github.io URLs,
the Google OAuth redirect builds from `window.location.origin + window.location.pathname`, and
invite links build from the live page URL — all three follow the origin.

**Naming context:** the app is still *branded* ScrubPay in `index.html` (page title, headings,
onboarding copy) — the rename to BadgeBudget is not done, only the domain. Note that
"ScrubPay" is a crowded name: a healthcare payroll/ATS company launched on `scrubpay.app` +
`scrubpay.org` in 2026-08, a 2014 Atlanta medical-bill app used the name, and SCRUBJAY is a
registered USPTO mark in healthcare staffing. `scrubpay.com` is investor-held on Atom.com.

**Google OAuth consent screen** still shows `mnnlgcxnvodjwlhhiphq.supabase.co` — that string is
the host of the OAuth callback, which lives on Supabase, so it is not changeable from the app or
from Google Cloud Console. The only fix is a Supabase Custom Domain: Pro plan (from $25/mo) plus
the custom-domain add-on ($10/mo). Not worth it at current scale; set the app name + logo on the
GCP OAuth consent screen instead (free, and it's the more prominent branding).

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
2. ~~Supabase Auth URL config~~ **Done 2026-07-04**, **updated 2026-09-02 for the custom
   domain**: Site URL is now `https://badgebudget.com/`; the redirect allow list is
   `https://badgebudget.com/**,https://www.badgebudget.com/**,https://patrick222-dotcom.github.io/705-v1/**`
   (the github.io entry is kept so in-flight invite links and cached sessions still resolve).
   Set via Management API `PATCH /v1/projects/<ref>/config/auth`.
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

## Swap board (multi-user) — status

Built 2026-07-24 (P1 groups/board/posting + P2 matching/reveal/swap-plan), live in the
app UI. **Schema APPLIED to the live project 2026-07-30** (owner ran
`supabase/migrations/001_swap_board.sql`); all 6 tables + 8 functions confirmed present
and the "not set up yet" UI state is retired. Design: invite-code unit groups; anonymity
enforced by column-level grants + security-definer RPCs
(swap_board/propose_swap/match_details/reveal_match — names reveal only after ALL legs
accept); posts freeze once reserved (RLS status gate) and reveal re-validates
(match_stale). Client computes pickup/handoff/trade/3-cycle suggestions from
pseudonymous poster_key correlation (27-assertion unit suite in the harness:
te_swap_p2_algo.js).

**Adversarial RLS/anonymity audit — DONE 2026-07-30, 29/29 passing** (throwaway confirmed
users minted via the admin API; script `scratchpad/rls_audit.js`). Verified end-to-end
against the live DB from real user JWTs: `author` column ungrantable (select author / `*`
both 403 for everyone incl. authors), swap_board leaks no author + correct is_mine +
stable/cross-author-distinct poster_key, cross-group isolation, no author spoofing on
insert, no cross-author update/delete, propose_swap freezes posts + blocks double-booking
(`post_unavailable`), reserved posts uneditable by their author, reveal gated until all
legs accept, non-parties blocked from match_details/reveal, can't accept another's leg,
decline releases posts. **Found + fixed a real bug the happy path had never exercised:**
`reveal_match` hit Postgres `42702` (`column reference "post_id" is ambiguous` — bare
`post_id` in the retire-posts subquery collided with the function's `RETURNS TABLE
(post_id ...)` OUT param), which would have 400'd every successful reveal. Fixed by
aliasing the subquery (`select l.post_id from swap_match_legs l`); patched live via
Management API AND in the migration file. Reveal now returns display names only after full
acceptance.

Note (env): ~~the Management API token is named `supabase_access_token` (lowercase)~~
**Fixed — as of 2026-09-02 the variable is `SUPABASE_ACCESS_TOKEN` (uppercase)**, which is what
the MCP server and standard tooling look for, so the typed Supabase MCP tools should work. The
curl fallback is `-H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"`; for Node, route fetch
through the egress proxy (`NODE_USE_ENV_PROXY=1`
`NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`).

**Two more RLS fixes applied live + in migration 2026-07-30 (found by the council run):**
(1) **Direct-INSERT hole** — `swap_matches`/`swap_match_legs` had raw `insert` grants, so a
member could fabricate a match + self-named leg pointing at any post_id and then read that
post's hidden (non-open) content via `match_details()` (gated only on is_match_party). Revoked
both insert grants; matches/legs are created ONLY through the security-definer `propose_swap()`.
(2) **Status forge** — tightened the "update own posts" WITH CHECK to `status in
('open','withdrawn')` so an author can't forge `proposed`/`matched` via a direct REST update
(edit-while-open and the direct withdraw still work). Re-verified: RLS audit 29/29 + 5/5 new
adversarial probes (both inserts denied, forge blocked, withdraw intact).

**Invite links (2026-08-22):** boards are shared as `https://badgebudget.com/?join=ABC123` through the native
share sheet (`navigator.share`, clipboard fallback). The recipient always gets a confirm screen —
the board name is unknowable pre-join, so the code is what's confirmed. The param is consumed on
mount (other query params preserved for supabase-js PKCE) and stashed in localStorage
(`scrubpay_pending_invite`, 1h TTL) so it survives the OAuth redirect and onboarding. A link carries
only the invite code — the same secret as reading it aloud — so no anonymity/RLS surface changed.

Known disclosure gap (still open, by design): poster_key is stable per group, so a
colleague identified via one confirmed match can recognize that person's other posts
thereafter — consider copy disclosure or key rotation later.

## Agent council run — 2026-07-30 (ultracode)

Ran the multi-lens council (8 dimensions: wage-math, security, mobile-ux, accessibility,
performance, data-integrity, code-quality, product-design) as a Workflow with adversarial
verification of every finding: 30 confirmed / 2 rejected. Auto-applied the 24 confirmed-safe,
low-risk fixes (index.html + the 2 swap SQL fixes above), device-tested on iPhone-13 emulation
(boot happy + hang-getsession + block-babel, wage-math, NaN-safety, Year-PTO, delete-confirm)
and swap RLS re-audited (29/29 + 5/5), then deployed. Highlights: differential-delete now
confirms before silently repricing logged shifts; `loadCloudRow` throws on transient errors
(no more clobbering cloud with local on a network blip); `sanitizeData` coerces malformed
differentials (no NaN take-home); Year view includes PTO; global `--muted-2` + calendar-amount
contrast raised to WCAG AA; reduced-motion/transparency media queries; iconbtn double-blur
removed; many P3 nits (BACKUP_KEY cleanup, aria-pressed/labels, safe-area FAB, dead-code).

**Deferred (real but not safe to auto-apply overnight — need focused work):** overtime×
differential stacking (wage-core redesign: add an isOvertime flag + independent toggle);
FAB overlapping content mid-scroll (corner-anchor is a design call); calendar memoization +
16-month virtualization (subtle re-render/scroll-machinery risk); sync content-equality
canonicalization (verify user_data.data is json vs jsonb first); broad backdrop-filter
reduction (needs a real older-iPhone perf repro). See the workflow result for specifics.

## Testing (no device needed)

Chromium + Playwright are pre-installed (`executablePath: '/opt/pw-browsers/chromium'`).
The sandbox blocks CDNs/Supabase by default, but `registry.npmjs.org` is allowed:
download the pinned packages from npm, rewrite the script tags in a scratch copy of
`index.html` to local paths, serve with `python3 -m http.server`, and drive it with
Playwright using the iPhone 13 device profile. Capture `console`, `pageerror`, and
`requestfailed` events — this is how the mobile spinner bug was found. Test failure
modes too (block a script, hang `getSession()`), not just the happy path.

**Console-warning diagnostic (dev-build) — catches bugs the prod gate can't see.** The live
app ships React *production* builds, which silence dev-only warnings (missing `key`,
controlled/uncontrolled input flips, setState-on-unmounted, invalid DOM nesting). These are
real defects that never surface as a `pageerror`. To find them: make a second scratch copy that
points at the **development** React UMD builds (`react.development.js` +
`react-dom.development.js`, both already in the vendored npm packages), serve it, seed
`{setupComplete:true,baseRate:50}`, drive the real flows (open Add-Shift, toggle OT, pick
hours, save; nav the period; open the breakdown), and capture `console` messages of type
`warning`/`error`. A clean run shows only the two expected notices (the in-browser Babel
transformer warning + sandbox network `ERR_CONNECTION_RESET` for the blocked CDN/Supabase).
Anything else is a real bug to fix. (Ran 2026-08-16 — app was clean; no React warnings.)
