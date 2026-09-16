# BadgeBudget — Shift Pay Planner

Take-home pay planner for bedside nurses, built for the owner's wife and her unit. Logs shifts +
differentials, shows what a shift is worth *before* it's worked, imports/exports .ics schedules, and
hosts an anonymous shift-swap board.

- **Live:** https://badgebudget.com (custom domain since 2026-09-02). The old
  `https://patrick222-dotcom.github.io/705-v1/` URL 301-redirects there. **Verify deploys against
  badgebudget.com.**
- **Naming:** renamed from ScrubPay on 2026-09-04 (#64), visible strings only — the storage keys, the
  .ics UID scheme and the swap salt still say `scrubpay` on purpose (Invariants 5–7). The `scrubpay.*`
  domains belong to other parties; never present them as ours. Why the name changed:
  `docs/session-2026-09-02-domain-and-naming.md`.
- **Two goals:** (1) ship a polished app; (2) **meta-goal** — refine a reusable multi-agent
  "development council" process: context preservation between agents, automated fix→re-review
  until every lens scores 8/10, less manual synthesis by the orchestrator, real mobile testing.
  The council became reusable on 2026-09-13 — charter in `docs/council.md`, runnable in
  `.claude/workflows/council.mjs`; before that it lived only in whichever session ran it. Review is
  automated, **fixes are still applied serially by the orchestrator** (workflow scripts have no
  filesystem access, and parallel edits to one 5,800-line file would conflict anyway), so the
  "automated fix→re-review" half of this goal is genuinely unmet.
  Council history lives in `docs/history.md`; the latest full run (2026-09-13 → 16: 56 cells, 85
  confirmed, three doc claims disproved) is in `docs/council-runs/2026-09-13/`.

## Where things are

| Path | What |
|---|---|
| `index.html` | the whole app: CSS, a plain-JS boot script, one Babel-transformed JSX block |
| `pdf.worker.min.js` | pdf.js worker, served same-origin next to `index.html` |
| `CNAME` | `badgebudget.com` — load-bearing, see Deployment |
| `ops.html` | the ops console — a live feedback inbox for the two admins, served at `/ops.html`. In the publish set. Plain JS, no React/Babel/fonts, supabase-js only (same SRI pin as the app). Borrows the app's session (same origin = same localStorage), so it has no auth UI of its own. `noindex`, and deliberately **unlinked from the app** — the gate is `is_ops_admin()` in Postgres, not this page. Design: `docs/ops-console-scope.md` |
| `privacy.html` | the privacy notice, served at `/privacy.html`. In the publish set. Self-contained — no fonts, scripts or styles from anywhere else, so it can't break and makes no third-party requests. Linked from Settings |
| `.github/workflows/deploy.yml` | the deploy workflow: 5-file publish to GitHub Pages. (`ci.yml` is the PR gate — see Deployment) |
| `BACKLOG.md` | the nightly loop's durable memory: queue, parked items, blocked, Done log |
| `supabase/migrations/` | `000_core.sql` (`user_data`/`feedback`/`events` + RLS, captured 2026-09-13), `001_swap_board.sql`, `002_ical_subscription.sql` (the iCal feed table), `003_feedback_kind.sql` (the feedback tile tag), `004_ops_console.sql` (the `ops_admins` allow-list + the admin-gated ops RPCs + the first indexes on `events`/`feedback`; applied 2026-09-13, gate probed 10/10), `005_feedback_anon_id.sql` (the device join key on `feedback`; applied 2026-09-14), `006_ops_device_trail.sql` (phase 3b — `ops_device_list()` + `ops_device()`, the per-device touch-point trail; applied 2026-09-16, gate probed 6/6 including over the real REST API with the public anon key). 000→004 in order stands up a fresh project; 000 is a snapshot of the schema *before* `kind`, so it is never back-edited |
| `supabase/functions/ical-proxy/index.ts` | SSRF-guarded Edge Function that fetches a nurse's secret iCal feed (deployed, `verify_jwt` on) |
| `scripts/groom_seed.mjs` + `scripts/test_groom_seed.mjs` | Reddit-seed groom tooling + its 33-assertion suite |
| `scripts/check_build.mjs` | the mechanical invariant gate — parses the JSX and asserts Invariants 1, 2, 4, 5, 6, 8, 9 |
| `tests/harness.mjs` + `tests/smoke.mjs` | the Playwright rig, in git since 2026-09-07; 65 assertions on an iPhone 13 profile. `buildScratch` emits a local copy of `ops.html` too, so the console's gate is drivable |
| `scripts/ops_gate_probe.sql` | the adversarial probe set for the ops console's guard — non-admin, `anon`, revocation, and the positive control. Run it before trusting `/ops.html`; the SQL editor's default session is a superuser and both obvious probes lie |
| `scripts/dashboard_snapshot.sql` + `.mjs` | one query → one JSON blob for the ops dashboard; the `.mjs` folds in the track-name inventory read from `index.html` |
| `docs/reddit-persona-pipeline.md`, `reddit_seed.json`, `reddit_personas.json`, `reddit_intake_prompt.md` | Reddit insights → backlog candidates → persona testers |
| `docs/ops-console-scope.md` | the ops console design record — why an artifact can never be live, the three read-path shapes and why security-definer functions won, the wedge that shipped, phases 2–4, and the written-down line on what the console may never show |
| `docs/swap-board.md` | swap-board design, anonymity model, audit history, verification standard |
| `docs/domains.md` | registrar, DNS, renewals, OAuth consent-screen limitation |
| `docs/council.md` | the council charter — the 13×10 lens/slice matrix, the ≥8/10 standard, adversarial verification, and what a run deliberately does not do. Runnable form: `.claude/workflows/council.mjs` |
| `docs/history.md` | dated log of decisions, incidents and resolved work (council runs, the sync P0, NurseGrid research) |
| `docs/state-brief-2026-09-02.md` | adversarially-verified repo survey + a 23-item prioritized cleanup list |
| `docs/agent-gateway-scope.md` | the "one domain, two surfaces" (UI + MCP) design: core extraction, versioned ops, an MCP Edge Function on Supabase OAuth, an ops manifest. Design only — nothing implemented |
| `docs/scaling-and-burn.md` | capacity + cost ladder to 100k users, the pre-scoped infra levers with trigger thresholds, the density/retention metric definitions (runnable SQL), and the transferability checklist. Strategy only |
| `design-system/` | 12 static HTML spec pages + `cards.json` from the 2026-07-29 Liquid Glass pass. Reference only: not deployed, not loaded by the app, may lag `index.html` |
| `.mcp.json`, `.agents/skills/`, `skills-lock.json` | Supabase MCP server config + vendored Supabase skills (symlinked, hash-pinned) |
| `.claude/skills/{ship,wage-core,harness}/` | the project's own skills — the deploy ritual, the Invariant 3 protocol, and the test rig. See Skills |

## Invariants — never weaken, never rename

`scripts/check_build.mjs` gates **1, 2, 4, 5, 6, 8 and 9** on every PR. **3, 7, 10, 11, 12 and 13
are human-held** — no machine sees them.

Each one carries a `↳` trailer in a fixed shape: **Detect** (what would tell you it is *already*
broken in production), **Blast** (what breaks, and how widely, when it is) and **Verify** (the
command that proves it holds right now). The prose is for a reader; the trailer is a fixed shape so
it can be parsed later instead of re-excavated from the history — it is the remediation graph in
denormalized form, so don't strip it as decoration. `Detect: none` is not a hole in the notes, it
is the finding: **exactly one invariant (4) has a live production signal**, and it was added *after*
the 47-day outage it exists to catch.

1. **Boot hardening** in the plain-JS boot script: 8s watchdog error screen; Supabase client creation
   null-guarded (app degrades to localStorage-only if the CDN script fails); `getSession()` raced
   against a 4s timeout (WebKit deadlock — iPhone Chrome is WebKit too). These fixed a long-standing
   iPhone infinite spinner.
   ↳ **Detect** none — a device that never boots never fires `app_open` and never flushes the error
   buffer, so the spinner was invisible in analytics for its entire life. **Blast** every WebKit
   device including iPhone Chrome; app unusable, silently. **Verify** `node scripts/check_build.mjs`
   plus `tests/smoke.mjs` §1 (boots), §5 (`getSession` hangs), §6 (Babel blocked).
2. **SRI on all 5 CDN scripts** (`grep -c 'integrity="sha384-' index.html` → 5), exact pinned versions.
   ↳ **Detect** none — SRI *working* is a blocked script, which surfaces as the watchdog screen,
   indistinguishable from a CDN outage. **Blast** without it a CDN compromise runs arbitrary JS with
   the whole `user_data` blob in reach. **Verify** the grep above; gated by `check_build.mjs`.
3. **Wage-core** (`shiftGross`, `hourlyRate`, `computeNet` — the per-paycheck tax model shared by the
   hero and the pattern lab since #65 — `calc`, `statOf`/`ptoStatOf`, `patternMetrics`, and the
   rate/differential coercions in `sanitizeData`): touch only in a dedicated session, with the
   wage-math probes **and the hero/breakdown equality assertion against the deployed build**, never in
   a nightly build. Adding a sanitizer branch for a *new* data shape (as #62 did for `goals`) is fine
   in a nightly if it comes with a unit test and the existing probes stay green.
   ↳ **Detect** none automated — a wrong take-home figure throws no error, so the *A number looks
   wrong* feedback tile (2026-09-13) is the only channel, and it is opt-in and human. **Blast** every
   displayed dollar figure, i.e. the one thing the app is for. **Verify** the `wage-core` skill:
   baseline probes, a new assertion for the changed behaviour, then the equality check against the
   **deployed** build. Probes live in `tests/smoke.mjs` §1; `check_build.mjs` reports this UNCHECKED
   on purpose.
4. **`saveToSupabase` upserts with `{onConflict:'user_id'}`.** The table's PK is a generated `id` and
   `user_id` carries a separate unique constraint; without the option every save after the first fails
   with 23505. That silently broke cloud sync for every signed-in user from 2026-07-07 to 2026-08-23.
   Companion rules from the fix: the per-user failed-save backup carries `savedAt` and wins when newer
   than the cloud row; `console.error` is mirrored into the error ring buffer.
   ↳ **Detect** 23505 → error ring buffer → `client_error`, live since 2026-09-07 — *that channel did
   not exist during the outage, which is why it ran 47 days.* **Blast** every signed-in user, silent;
   cloud sync dead, data surviving only in the per-user localStorage backup. **Verify**
   `check_build.mjs`; end-to-end, save twice and reload on a second device.
5. **Storage keys are data, not branding.** Renaming any of them orphans user data or severs analytics
   joins: `nursingWagePlannerData` (anonymous users' data — contains no brand string, so a
   ScrubPay→BadgeBudget find/replace misses it) and `nursingWagePlannerData::<uid>` (per-user
   failed-save backup); `scrubpay_anon_id`; `scrubpay_feedback_pending`; `scrubpay_pending_invite`;
   `scrubpayErrors` (`ERR_KEY` in the boot script; every read goes through it since #64);
   `scrubpay_events_pending` (deferred analytics events awaiting the next load).
   ↳ **Detect** none — a rename orphans data silently; the symptom is a returning user seeing an empty
   app and not saying so. **Blast** anonymous users lose everything (localStorage is the only copy);
   signed-in users lose the failed-save backup; `anon_id` joins break historically. **Verify**
   `check_build.mjs` asserts each key literal.
6. **`@scrubpay` is the .ics self-recognition sentinel**: export stamps UIDs as
   `scrubpay-<date>-<id>@scrubpay`, import drops any UID containing `@scrubpay`. Change either half and
   every previously exported event re-imports as a duplicate.
   ↳ **Detect** none — the symptom is duplicate shifts after a re-import, visible to the nurse and
   reported nowhere. **Blast** every previously exported shift duplicates, inflating hours and every
   wage figure downstream of them. **Verify** `check_build.mjs` asserts both halves; there is no
   round-trip test — a known gap.
7. **`'scrubpay-swaps'` is a live md5 salt** deriving `poster_key` in the deployed `swap_board()`
   function. It is the swap board's anonymity model, not a string — **and, as of 2026-09-13, a
   known-broken one** (`security-00`, critical): the hash's other inputs are readable by any
   `authenticated` member (`swap_members.user_id`, `swap_groups.created_by`) and the salt is a
   constant in a public repo, so one select plus md5 maps every key on a board to a uuid. The
   invariant still holds — rotating the salt breaks the reveal linkage without fixing the leak; the
   fix is the hardening session in `BACKLOG.md` (revoke the grants, then a per-group secret read
   inside `swap_board()`).
   ↳ **Detect** none, and nothing in this repo *can* see it — the salt lives in the deployed Postgres
   function, not in `index.html`, so `check_build.mjs` is blind to it by construction; the
   reversibility was found by a council lens reading the grants, not by any probe. **Blast**
   rotating it re-derives every `poster_key`, silently breaking the identity linkage the reveal step
   depends on and changing the anonymity model with no visible error; leaving it as is leaves every
   board pseudonymous to a lazy colleague and transparent to a curious one. **Verify** the swap-UI
   standard in `docs/swap-board.md`; `rls_audit.js` — **not in git**, so currently unreproducible —
   and when it is ported, two new probes: as a member, selecting `user_id` from `swap_members` and
   `created_by` from `swap_groups` must both be denied.
8. **The publish set is load-bearing** (`cp … _site/` in `deploy.yml`): `index.html`,
   `pdf.worker.min.js`, `privacy.html`, `ops.html`, `CNAME`. Pages reads the custom domain from `CNAME` in the
   deployed artifact, so a deploy without it knocks the site off badgebudget.com. `privacy.html`
   backs the URL on the Google OAuth consent screen — drop it and `/privacy.html` 404s, which breaks
   consent-screen publishing and leaves the app with no reachable privacy notice. `ops.html` joined
   the set 2026-09-13; because it ships to a public URL, `check_build.mjs` also asserts it carries
   `noindex`, contains no `service_role` string, never assigns `innerHTML` (every string it renders
   was typed by the public into a feedback box), and is not linked from `index.html`.
   ↳ **Detect** derivable but unwatched — a missing `CNAME` takes the site off the domain within one
   deploy and `events` goes silent; nothing watches for that silence. **Blast** total outage on
   badgebudget.com; a missing `privacy.html` 404s the consent-screen URL. `ops.html` ships to a
   public URL, so its four page-level assertions are defence in depth behind the real gate
   (`is_ops_admin()` in Postgres) — except the `service_role` one, where a shipped key bypasses RLS
   outright and is a breach, not a weakened layer. **Verify** `check_build.mjs` asserts the set
   exactly in both directions and runs the four ops-console checks, then
   `curl -sI https://badgebudget.com/index.html?cb=N` per the `ship` skill.
9. **No `main` branch.** `claude/migrate-to-github-deploy-3F5RD` is the de facto default and deploy
   branch, deliberately in the workflow's push triggers. Add `main` to the triggers *before* removing
   it, never in the same commit — removing it first stopped all deploys once.
   ↳ **Detect** derivable but unwatched — deploys stop while pushes keep succeeding, so nothing fails
   loudly; the signal is an empty Actions tab. **Blast** everything merged after that point sits
   unshipped while looking merged. **Verify** `check_build.mjs` asserts the branch is still in the
   triggers; confirm a run actually appears in Actions after the merge.
10. **Fetch before touching the deploy branch.** Fresh checkouts are shallow and have been seen 14
    commits behind origin. Always `git fetch origin claude/migrate-to-github-deploy-3F5RD` and branch
    from `origin/…`, never from the local ref.
    ↳ **Detect** none — a stale branch is a valid branch, so the PR merges green while quietly
    reverting recent commits. **Blast** up to N commits of other people's work reverted on merge; 14
    observed. **Verify** `git merge-base --is-ancestor origin/claude/migrate-to-github-deploy-3F5RD
    HEAD` before you push. UNCHECKED in the gate.
11. **Don't delete `claude/clause-md-review-9tqlj8`** (the nightly's working branch) or the head of any
    open PR. Merged heads are fair game (see Open items for the current list).
    ↳ **Detect** none — a deleted branch is noticed only the next time something needs it, which for
    the nightly is the next 04:0x ET run. **Blast** deleting the nightly's branch stops the loop
    silently; deleting an open PR's head closes the PR and loses the work. **Verify** cross-check
    `git branch -r` against open PRs before any delete. UNCHECKED in the gate.
12. **URL Forwarding stays OFF on badgebudget.com at Porkbun** — it overrides the A records entirely.
    ↳ **Detect** none — registrar state sits outside every check in this repo, and the failure
    presents as a Pages problem. **Blast** total site outage; the A records are ignored wholesale.
    **Verify** `dig +short badgebudget.com` → the 4 GitHub Pages A records, and
    `curl -sI https://badgebudget.com` → 200 from Pages, not a 301 to a Porkbun redirector. UNCHECKED
    in the gate.
13. **The iCal feed URL is a bearer credential.** It lives only in `ical_subscriptions` (owner-only RLS,
    no `anon` grants), is absent from `serializeState` so it never enters the `user_data` blob (which
    is exported, mirrored to localStorage and echoed by the sync poll), never goes into `events`, and
    is never logged by `ical-proxy`. The parser stores dates, times, hours and UIDs — never titles.
    ↳ **Detect** none, and a leak is silent by construction — nothing observable changes when a bearer
    credential escapes. **Blast** anyone holding the URL reads the nurse's whole calendar
    indefinitely; the only revocation is the calendar provider reissuing it. **Verify** confirm
    `serializeState` never touches the feed field, `ical-proxy` logs no URL, and an exported blob
    contains no feed address. UNCHECKED in the gate.

**What this shape surfaced (2026-09-13).** Filling in `Detect` for all thirteen showed that only #4
has a live production signal; #8 and #9 have one that exists in the data but nothing watches. The
other ten fail silently. Detection, not remediation, is the thin layer here — a plan for fixing a
break is worth nothing against a break nobody sees, and the 47-day sync outage is the proof.

## Architecture

- **Single file, no build step.** React 18 + Babel standalone, JSX transformed in-browser. Keep it
  single-file. Two god components: `App` (~1,180 lines) and `SwapsSheet` (~820 lines). No
  memoization on the calendar path (a parked item; stabilizing `keyOf` alone is a no-op).
- **CDN deps** (pinned + SRI): React/ReactDOM 18.2.0 (unpkg), Babel standalone 7.24.7 (unpkg), pdf.js
  3.11.174 (cdnjs), supabase-js 2.45.4 (jsdelivr). Google Fonts (Bricolage Grotesque + Plus Jakarta
  Sans) is a fourth external vendor — stylesheet only, no SRI possible, graceful fallback. pdf.js
  `getDocument` uses `isEvalSupported:false` (CVE-2024-4367). The `<meta>` CSP covers every runtime
  host; `frame-ancestors` can't be set via meta and Pages sends no `X-Frame-Options`, so clickjacking
  protection is simply unavailable on this host. The `<head>` also carries an inline SVG data-URI
  favicon, a meta description and a theme-color (#64) — head-only, so the 3-file publish set holds.
- **Data.** Signed-in → Supabase `user_data`: one `jsonb` blob per user, upserted on `user_id`,
  debounced 500ms, capped at `MAX_BLOB_BYTES` = 512KB (free-tier guard). The blob holds pay settings,
  shifts, differentials, templates, day events, notes, `goals` (≤ `MAX_GOALS` 12), `patterns`
  (≤ `MAX_PATTERNS` 8) and `estimateMode` (`''`|`'rough'`|`'sample'`, whitelisted in `sanitizeData`
  so a corrupt blob can only land on `''` — no banner, never a false one); every array goes through
  `sanitizeData` on load. Anonymous → localStorage.
  Writes are whole-blob, last-writer-wins, no version — fine for one human on two devices, not for an
  agent writing concurrently (the agent-gateway scoping doc, PR #67, starts from this fact).
  Cross-device sync is a 15s poll while the tab is visible, guarded by `updated_at` vs `lastSeenAt`
  and a content-equality check so two devices never ping-pong writes; `applyData(...,{keepPeriod:true})`
  leaves the viewed pay period alone. Not push: Realtime would need the table in the
  `supabase_realtime` publication plus `wss://*.supabase.co` in the CSP.
- **Feedback.** Widget (top-bar 💬 + Settings) → `feedback` table, insert-only RLS for
  `anon`+`authenticated` (nobody can read back via the anon key). Offline submissions queue in
  localStorage and flush on next load. **Each row also carries `page` (pathname, ≤120 chars), `user_agent`
  (≤400 chars) and — since migration 005, 2026-09-14 — `anon_id`**, the same per-device id
  `events.anon_id` carries, which is the *only* join from a report to what that device actually did
  (`page` is always `/` in a single-page app, and `user_id` is null when she isn't signed in). **It
  only works forward:** `anon_id is null` means "submitted before 2026-09-14" and those rows are
  permanently unjoinable. Set inside `submitFeedback` rather than at the call site, so the
  offline-queue flush carries it too. Disclosed in `privacy.html` → Feedback, which shipped in the
  same change. `page`/`user_agent` were undisclosed until 2026-09-02; keep-or-strip is an open
  product call.
  **Tiles, not a blank box (2026-09-13).** The sheet opens on four one-tap tiles — *A number looks
  wrong* / *Something didn't work* / *I couldn't find how to…* / *I wish it could…* — and each
  pre-fills the textarea with a scaffold whose blanks are the questions the owner would otherwise
  have to ask by email, so a nurse fills two lines instead of composing a bug report. The tile sets
  `feedback.kind` (migration 003, CHECK-constrained to the five values in `FEEDBACK_KINDS`; tapping
  no tile is the old open box, filed as `'other'`, and `kind is null` means "before the tiles
  shipped"). The wrong-number scaffold stamps a **`Where:`** line from the surface the sheet was
  opened from — `page` can't supply it, since this is a single-page app and the pathname is always
  `/`. Three guards, each negative-tested: switching tiles rewrites the box only while it still
  holds an untouched scaffold, so her own words are never eaten; submitting an untouched scaffold is
  refused rather than filed as a row of prompts; and the textarea no longer `autoFocus`es, because on
  a phone that raised the keyboard over the tiles before she could read them.
  Owner read: `select created_at, kind, message, contact, user_id, anon_id, page, user_agent from
  public.feedback order by created_at desc;` — and the join migration 005 unlocked:
  `select f.created_at, f.kind, f.message, f.anon_id, (select count(*) from public.events e where
  e.anon_id = f.anon_id) as events_from_device from public.feedback f order by 1 desc;` and `select kind, count(*) from public.feedback group
  by kind order by 2 desc;`
- **Analytics.** `track(name, props)` → `events` (insert-only RLS). Coarse names only — **never wage or
  goal figures** — plus the same `page` + `user_agent` columns and a stable per-device `anon_id`.
  Naming: `snake_case`, `<surface>_<verb>`. Regenerate the list with
  `grep -o "track('[a-z_]*'" index.html | sort -u`; currently 41 through `track()` plus one
  (`session_end`) that is sent only by the unload path below and so never appears in that grep —
  42 in the table. `app_open` `{via}` (present only when the URL
  carried a recognized `?via=` arrival tag — `qr` or `link` from the share sheet),
  `setup_completed` `{mode:'full'|'rough'|'sample'}` — which onboarding path they took,
  `signed_in`, `view_changed` `{view}`, `today_jump`, `shift_saved`, `note_saved`,
  `day_event_added/removed`, `template_saved/applied/tap`, `paystub_imported`, `ics_exported`,
  `ics_import_parsed/done`, `ics_sync_done`, `pattern_lab_opened`, `pattern_saved` `{cycle}`,
  `pattern_applied` `{shifts,weeks}`, `pattern_shifts_removed` `{n}`,
  `feedback_submitted` `{kind}` (which tile, or `'other'` for the open box), `swap_group_created/joined`,
  `swap_invite_shared/opened`, `swap_posted`, `swap_withdrawn`,
  `swap_match_proposed/accepted/declined/confirmed`, `swap_plan_applied`,
  `share_opened`, `share_sent` `{via:'share'|'copy'}`, `estimate_sharpened` `{mode}`,
  `estimate_dismissed`, `sample_cleared`, `ob_step` `{step}`, `client_error` `{n,errors}`,
  `sign_in_attempted` `{method:'google'|'email'|'email_signup'}`,
  `session_end` `{secs,last,n,setup,shifts,ob,via?}` — see below.
  **`session_end` is the exit row, and the reason abandonment was unanswerable until 2026-09-16.**
  Every other event says something *happened*; none said what happened **last** or how long she
  stayed, so a device whose entire lifetime was one `app_open` — **416 of 424 public devices on
  2026-09-16** — had a trail with one step and no ending. It fires from `pagehide` /
  `visibilitychange`, which is why it cannot go through `track()`: supabase-js issues an ordinary
  fetch and an ordinary fetch in flight at unload is cancelled by the browser (that is exactly the
  `AbortError: … browsing context is going away` already in `client_error` rows). `beaconInsert()`
  uses `fetch(..., {keepalive:true})` instead, posting the same `eventRow()` shape straight to
  `/rest/v1/events`. Re-fires on a later hide only if the event count moved or a minute passed,
  capped at `SESSION_END_MAX` = 4 per load, so an app-switching phone cannot bill the free tier;
  **read the LAST row for a load, not the first.** `shifts` is a COUNT — the no-wage-figures rule
  is unchanged, and `tests/smoke.mjs` §12 asserts the prop whitelist and negative-tests it.
  (`health_check` rows in the table are owner probes.) Owner read: `select name, count(*) from
  public.events group by name order by 2 desc;`
  **`ob_step` is the onboarding funnel.** `app_open`→`setup_completed` was a 132-device to 9-device
  cliff with no event in between, so a bounce off the welcome screen was indistinguishable from one
  off the rate input. It fires once per *furthest* step reached (0 welcome … 4 done), so
  back-navigation and "Edit my setup" don't double count. **Stage 0 never actually fired until
  2026-09-16** and every historical `ob_step` row therefore starts at 1: `obMax` was seeded at `0`
  so `n > obMax.current` rejected step 0, *and* nothing called `goObStep(0)` on arrival — Onboarding
  only reports a step when the nurse moves. So the welcome-screen bounce, the most common outcome
  in the data, was the one stage the funnel existed to measure and could not see. Fixed by seeding
  `obMax` at `-1` and marking stage 0 from an effect that waits for `ready && !setupComplete` (not
  mount — `setupComplete` is false while the saved blob loads, which would count every returning
  nurse as a fresh bounce). Read stage 0 as live from 2026-09-16, the same way `ob_step` itself is
  live only from 2026-09-07. Read it as a funnel:
  `select props->>'step' as step, count(distinct anon_id) from public.events where name='ob_step'
  group by 1 order by 1;`
  **`client_error` is last load's captured errors**, flushed once per app open from the boot
  script's ring buffer — see Testing → Client error telemetry. Never one row per error.
  **`sign_in_attempted` measures the consent-screen wall.** Only successes were instrumented before
  2026-09-07, so a sign-in that died on Google's screen was invisible. The Google path uses
  `trackDeferred()` rather than `track()`: `signInWithOAuth` navigates away and the insert would race
  the unload, so the event is written synchronously to `scrubpay_events_pending` (cap 10) and flushed
  on the next load beside the error buffer — read-and-clear, same discipline. Someone who closes the
  tab outright is still uncounted; someone who completes sign-in, or bails and comes back, is counted.
  The email path has no navigation and tracks inline. Read the wall:
  `select props->>'method' m, count(*) attempts from public.events where name='sign_in_attempted'
  group by 1;` against `signed_in`.
- **Auth.** Supabase email/password + Google OAuth (**implicit flow, not PKCE** — this file said PKCE
  until 2026-09-16; the council proved otherwise (`security-11`): `createClient(url,key)` takes
  supabase-js 2.45.4's default `flowType:'implicit'`, so tokens land in the URL fragment and the
  post-load `hash=''` leaves that URL one Back-press away. Switching is one line plus a real-phone
  verification with a never-signed-in account — `BACKLOG.md` → Needs a dedicated session.
  `redirectTo` = `origin + pathname`, so the domain move needed no code change). Site URL `https://badgebudget.com/`; the allow list also keeps
  `www.` and the github.io URL so in-flight links resolve. Google's consent screen still shows
  `mnnlgcxnvodjwlhhiphq.supabase.co` — unfixable without a paid Supabase custom domain. **Branding
  and publishing were done 2026-09-07:** app name `BadgeBudget`, homepage and privacy-policy links to
  badgebudget.com, `badgebudget.com` as an authorized domain, and the app moved from **Testing** to
  **In production** on the Audience page. That matters more than the branding: in Testing, Google only
  admitted accounts on an explicit test-user list, so every prospective user outside it hit "Access
  blocked" — all 3 accounts predate the domain move and nobody had signed up since. **Confirmed In
  production 2026-09-07**, so the test-user list is now moot. No logo, on purpose: uploading one
  triggers Google's brand-verification queue.
  **Brand verification is a separate track from publishing status** and is currently failing with two
  issues; neither gates sign-in for basic scopes, so it is optional polish. (1) `badgebudget.com` is
  not verified as owned — needs a Search Console DNS TXT record at Porkbun under the same Google
  account. (2) "Your home page is behind a login page" — mechanically true: **`curl` of
  badgebudget.com yields exactly one word of body text, `badgebudget`, and the page carries no
  `<noscript>`.** The whole app is JS-rendered, so any reviewer or crawler without JS sees an empty
  shell. That also explains why crawler traffic never fires a second event. A `<noscript>` block, or a
  static `about.html` to point the home-page field at, would fix it. Neither is built.
  **Testing the wall needs an account that has never signed in.** Signing in with an existing account
  proves nothing — it was already on the test-user list and would have worked before publishing.
- **Swap board.** Invite-code unit groups, anonymous posts, client-computed
  pickup/handoff/trade/3-cycle suggestions, names revealed only after every leg accepts. Anonymity is
  *meant* to be enforced in Postgres (column grants + security-definer RPCs); the 2026-07-30 audit
  (29/29 + 5/5) proved `author` can't be selected but never tried rebuilding the key, and it can be
  rebuilt — see Invariant 7 and `security-00` (2026-09-13). Two more verified holes sit beside it:
  `propose_swap` never checks the caller is a party to the match (`security-01`) and a raw UPDATE
  policy lets a decline bypass `decline_swap_match` (`security-02`). All three wait on the hardening
  session in `BACKLOG.md`; until then the in-app "anonymously" copy overstates the board. Invite links `https://badgebudget.com/?join=CODE` go through the native
  share sheet; the recipient always confirms; the code survives the OAuth redirect via a 1h
  localStorage stash. The 🛠️ "not set up yet" screen (`tablesMissing`) is a defensive fallback,
  unreachable in normal operation and not doc-sized to remove. Known gap by design: `poster_key` is
  stable per group, so a colleague identified via one confirmed match can recognize that person's
  later posts (disclosed in-app since 2026-08-11; key rotation parked). Everything else:
  `docs/swap-board.md`.
- **Product surfaces.** Month-first scrolling calendar with a scroll-following pay period; a hero
  take-home figure with Gross / Taxes / Keep-% chips; an Add-Shift sheet with shift templates,
  quick-fill, day events (PTO paid at base rate) and a live preview — gross, take-home, ≈$/hr
  take-home, OT tag — so a nurse can judge whether picking up an extra shift is worth it *before*
  working it; **onboarding that ends at the first screen** — welcome's primary CTA is "Get my
  estimate" (the paystub scan is a secondary "instead", after producing exactly one successful import
  in two months as the primary), the base-rate step's CTA finishes setup at `estimateMode:'rough'`,
  differentials + taxes become an opt-in "Add my differentials & taxes now", and a "Show me an
  example" footlink finishes at `estimateMode:'sample'` seeding six 12h shifts tagged
  `patternId:SAMPLE_PATTERN_ID` (`'__sample__'`) across the current fortnight so the planner shows a
  real figure instead of $0. Both shortened paths raise a persistent amber `.est-banner` naming what
  is assumed; "Clear the sample" removes only the tagged shifts (same contract as
  `removePatternShifts`), and dismissing sets `estimateMode:''`. Settings → **SHARE** (first row)
  opens a QR + native-share sheet — the QR is authored inline from `SHARE_URL`, not generated at
  runtime; savings goals (Settings, capped at `MAX_GOALS`=12, stored in the same blob) shown in
  that preview as "% of goal (≈N shifts)" and on each goal in Settings as "≈ N typical 12h shifts to
  reach this" (#68); a month-first calendar whose month label + weekday row stay pinned while scrolling
  (#63); a breakdown view; paystub PDF import (parsed on-device, never
  uploaded); Settings.
- **Top bar (2026-09-13).** The avatar is the account menu at every width — it absorbed the separate
  gear and sign-out icon buttons, so the bar carries exactly one icon (feedback 💬) plus the avatar,
  and a signed-out visitor also gets a first-class **Sign in** button. Two problems it closes: on
  desktop the gear sat immediately beside the topnav's own "Settings" link, and below 920px `.topnav`
  is `display:none`, so the avatar is now the *only* route to Settings and Sign out on a phone —
  which is why the `≤360px` rule may never hide it again (it used to, as decoration; that would
  strand an iPhone SE with neither). Removing two icon buttons freed ~96px, so the bar got narrower,
  not wider. Feedback deliberately stays a one-tap icon rather than moving into the menu: the tiles
  exist to lower the cost of reporting something, and a menu would raise it. Menu mechanics: an
  outside tap closes it through a transparent fixed backdrop, not a document listener (on iOS WebKit
  a document-level click handler misses taps on non-interactive elements unless a touch handler is
  bound too); Escape closes it; `z-index` clears `.topbar` (40) and `.fab` (45) but stays under
  `.scrim` (80), so an open sheet always covers it. **Known a11y limit:** the items carry
  `role="menuitem"` but there is no roving-tabindex arrow-key handling, which `role="menu"`
  technically implies — Tab and Escape both work, and at two items it isn't worth a focus manager
  the rest of the app doesn't have either (no sheet traps focus). Revisit if the menu grows.
- **Pattern lab (#65, 2026-09-04).** Top-nav "Patterns", a dashboard card and the empty-state CTA open
  a modal lab: presets nurses actually describe (Mon–Wed nights, 3/1/3/7, 2-2-3 Pitman, 4 on/4 off,
  Fri–Sun weekend program) or a blank 7/8/14/28/custom-day cycle anchored on a date; paint cells with
  Day/Night 12h/8h brushes or a saved template (weekend cells resolve to the weekend differential at
  apply time, same inference as .ics import). Readout: take-home per paycheck via `computeNet()`
  over `lcm(cycle,14)` days (`patternMetrics()`), gross, hours, ≈/yr, the reverse goal view, and the
  life shape — shifts/cycle, hrs/wk, longest stretch and break (cyclic), weekends worked, which
  weekdays are always off, or a "drifts across the week" warning when the cycle doesn't divide 7.
  Saved patterns compare side by side with no "best" highlighting (no-nudge rule). "Put it on the
  calendar" previews adds/skips and never clobbers existing shifts unless the replace switch is on;
  placed shifts carry `patternId` so "Remove them" pulls back only what the pattern added. Shape:
  `patterns:[{id,name,anchor,cells:[cell|null]}]`, presets in `PATTERN_PRESETS`.
- **Schedule import/export (calendar sync).** .ics export (deterministic UIDs, no wage data) and
  .ics import with a guided shift-type questionnaire; re-import moves shifts and preserves pay types via
  `shift.icsUid`. **Auto-sync (#57, 2026-09-03):** Settings → CALENDAR SYNC takes a calendar's *secret
  iCal address* (signed-in users only); the app re-fetches it through `ical-proxy` once per app open
  and on "Sync now", and routes the result through the same import stepper, so auto-sync never
  silently rewrites wage-affecting shifts. Re-sync lifecycle: matched-by-UID shifts move and keep their
  pay type; shifts that vanished from the feed are proposed for removal only inside the fetched window
  (60 days back, 366 forward) and never when the 200-event cap truncated the feed; "Not a shift" files a
  wage-neutral day-event chip and "Ignore these" hides it, both remembered by UID. Proxy: host allowlist
  (Google Calendar hosts only so far — the NurseGrid feed host is still a TODO, and still wanted:
  this is the nurse's own secret `.ics` address and needs no partnership, so the 2026-09-13 decision to
  rule out the hStream partner API does not touch it), https only, no
  redirects, 2MB cap, 8s timeout. Known limits: the confirm step is all-or-nothing, and a local edit to a
  synced shift's hours loses to the feed on the next sync.

## Skills

Three project skills encode the rituals that were previously carried in prose here, so an agent
picks them up without being told. Invoke by name (`/ship`) or let the description match the task.

- **`ship`** — deploying. Fetch-before-branch (Invariant 10), run all three suites, PR to the deploy
  branch, then **verify with a marker against badgebudget.com** — the old github.io URL 301s with an
  empty 162-byte body, so anything grepping it for content can never see the change. Also the
  deployed-bytes-vs-branch diff, and the Invariant 11 branch rules.
- **`wage-core`** — anything touching a displayed dollar figure. Names the five decisions inside the
  math (OT stacks on the differential-inclusive rate; FICA on gross while income tax uses
  gross-minus-pretax; custom bonus is flat; display-only pre/post caps), then the protocol: baseline
  probes, a new assertion for the changed behaviour, and the equality assertion against the
  *deployed* build. Refuses the nightly loop.
- **`harness`** — driving the app for real. Rebuild, run, add an assertion, and the rule that every
  new assertion is negative-tested — plus the three ways that check lies (an aborted run is not a
  failed assertion; a short timeout caps `page.goto` and fakes a clean sweep; patch a copy, never
  the working tree) and `SMOKE_ONLY` for re-running just the affected sections. Covers the dev-build console diagnostic and what is still missing.

## Ops dashboard

**Two surfaces, deliberately.** `/ops.html` is the **live** one (phase 1 shipped 2026-09-13: the
feedback inbox; **phase 3b shipped 2026-09-16: the Devices tab** — one card per `anon_id` with
visits/returns/where-it-stopped, tapping through to that device's whole trail split into numbered
visits by a 30-minute gap. That is the surface that answers "did the same person come back and
give up again", which nothing in this repo could answer before). The nightly artifact below is the **batched** one. The split is not a preference,
it is a constraint: a claude.ai artifact cannot fetch Supabase — its CSP blocks all outbound
fetch/XHR/WebSocket — so an artifact can only ever show what something else pushed into it, and its
freshness ceiling is the push cadence. Anything that has to answer "what just happened" has to live
on badgebudget.com. Design record and phases 2–4: `docs/ops-console-scope.md`.
**Open question recorded there:** once phase 2 lands, the live page can compute trends too
(`events` *is* the history), at which point the artifact's only remaining advantage is being
readable without signing in.

`scripts/dashboard_snapshot.sql` returns the whole operational picture as one JSON blob;
`scripts/dashboard_snapshot.mjs` folds in the `track()` inventory read from `index.html` (the database
can only say which events *have* fired — "never fired" is the interesting half and lives in the
source). Nothing is queried live, because `events` is insert-only for `anon` — the property that
keeps analytics unreadable to everyone else.

**The dashboard artifact:** `https://claude.ai/code/artifact/1dc2d599-258e-4cd9-bf0c-8cc1f0ae3f0e`
(owned by the nightly session's account; declares `db`+`downloads` capabilities — carry them forward
on every republish). It embeds the snapshot inline in a `<script id="snapdata">` block; to refresh
it, regenerate the snapshot, swap that block in the artifact's authored HTML (everything from
`<title>` on — the publish wrapper re-adds the `<!doctype>…<body>` skeleton, so don't include it) and
republish to the same URL. The in-page "paste JSON → Load snapshot" box is a per-viewer preview only;
it does not change what others see.

**Nightly auto-refresh (owner-approved 2026-09-12).** Each nightly run, after GROOM, regenerate the
snapshot (`dashboard_snapshot.sql` → `dashboard_snapshot.mjs`) and republish the artifact above so it
stays current without being asked. This is dashboard upkeep, separate from the one app build item.

**Insider vs public.** `segment` tags each device `insider` (builders — owner `patrickguthrie222@` +
`pghawkins222@`, Courtney `bagwellc0387@`; matched by any anon_id ever seen signed in as one of them)
or `public`. The **`anon_funnel`** block is the payoff: activation over public, mobile devices only —
where genuine anonymous visitors abandon as invite links go out, builders excluded (its welcome-screen
stage reads `ob_step`, live only since 2026-09-07, so it undercounts earlier visitors).

**The device cohorts are wrong as written, and the dashboard overstates the audience (found
2026-09-16).** `dashboard_snapshot.sql:52` reads `case when is_mobile then 'mobile'` — an iPhone
user agent short-circuits the engagement check entirely, so anything *claiming* to be a phone is
counted as, in the file's own comment, "The real users." Two things broke that: bots now spoof
mobile user agents, and **the project's own test harness was writing to production analytics** —
`tests/harness.mjs` rewrote the five CDN `<script>` tags but never `SUPABASE_URL`, so on a GitHub
runner (open network, `ci.yml` runs `smoke` on every push and PR) each run inserted real rows under
a fresh `anon_id`. Fingerprint: `app_open` rows 2–3 seconds apart in bursts, all carrying
Playwright's iPhone 13 profile, identified by the internally inconsistent pair **`iPhone OS 15_0`
+ `Version/18.0`** (no real iPhone reports Safari 18 on iOS 15.0; match the pair, never a WebKit
build number — `AppleWebKit/605.1.15` is on every genuine iPhone in the table). **291 rows across
251 devices, 232 of them a single event, first seen 2026-09-07 — the day `ci.yml` was added and
`gate` + `smoke` became required checks — and the only seven event names present are exactly the
ones `tests/smoke.mjs` drives.** For scale: of 304 iPhone-UA devices on 2026-09-16, 266 had fired
exactly one event.
The harness is contained as of 2026-09-16 (scratch copies point at an RFC 2606 `.invalid` host,
gated in `check_build.mjs` and negative-tested); `ops_device_list()` flags those rows `synthetic`
and hides them by default rather than deleting history. **The classifier itself is not yet fixed
and every activation figure computed since 2026-09-07 is inflated — re-baseline before quoting
one.** The honest cut, insiders removed: 425 public devices ever, 4 completed setup, 5 saved a
shift, 1 signed in, 26 ever fired anything past `app_open`, and **all 26 have `days = 1`** — zero
second-day returns, lifetime.

**The crawler split is the load-bearing part.** badgebudget.com was registered 2026-09-02 and
immediately drew crawler traffic: of 135 devices, **83 are non-mobile and never fired anything but
`app_open`**. Counting them as users understates activation by ~2.5x and overstates the bounce rate.
The query classifies every device `mobile` / `desktop` / `crawler` and the dashboard defaults to
mobile-only. It is a heuristic — a nurse on a laptop who bounces is indistinguishable from a crawler —
so it is named, not hidden. Real mobile numbers as of 2026-09-07: 48 devices, 8 finished setup (17%),
13 opened it twice (27%), 7 came back on a later day.

## Deployment

- GitHub Pages via `deploy.yml`, on push to the deploy branch (and to `main`/`master`, which don't
  exist yet). The publish set is exactly `index.html`, `pdf.worker.min.js`, `privacy.html`, `ops.html`, `CNAME`
  — anything else silently 404s, and `check_build.mjs` asserts the set exactly (in both directions:
  a missing file 404s, an accidental one ships publicly). **CI** (`.github/workflows/ci.yml`, added 2026-09-07) gates pull requests — a
  `gate` job running `scripts/check_build.mjs` (Babel-parses the JSX block and mechanically asserts
  Invariants 1, 2, 4, 5, 6, 8 and 9) plus `scripts/test_groom_seed.mjs`, and a `smoke` job running
  `tests/smoke.mjs` on an iPhone 13 profile. **Both are required status checks** as of 2026-09-07
  via the `deploy gate` ruleset (Settings → Rules), which targets `claude/migrate-to-github-deploy-3F5RD`
  and also restricts deletion and non-fast-forward pushes. A red run now blocks the merge, and because
  required checks apply to pushes too, a direct push of an unchecked commit to the deploy branch is
  rejected — the "a JSX error ships live" hole is closed. Repository admin is on the bypass list, so
  the owner keeps an emergency override. **Auto-merge is enabled** repo-wide: a PR with auto-merge
  turned on lands itself the moment both checks go green.
- **Custom domain** badgebudget.com at Porkbun; `badgebudget.app`, `shiftstogo.com` and
  `shiftstogo.app` redirect to it. DNS is 4 A + 4 AAAA records to GitHub Pages plus a `www` CNAME.
  Registrar details, renewals, kept records: `docs/domains.md`.
- Deploy branch `claude/migrate-to-github-deploy-3F5RD`. Ship = PR → squash-merge → ~1–2 min → confirm
  at `https://badgebudget.com/index.html?cb=N` with a marker unique to the change.
- Delete merged branches; never the open PR heads or the two protected branches (Invariant 11).

## Autonomous nightly loop

**Routine** `ScrubPay nightly (dedicated lean session)` — id `trig_019zkn8Z6Xu18t1B46iNMuwP`, cron
`0 8 * * *` UTC (≈04:0x ET). It fires into a **persistent, authorized session**
(`session_01GGWUJsjTww44sqB58U5Ahp`) where `git push` and the Supabase MCP both work — *not* a fresh
session per fire, which is why every nightly commit carries the same `Claude-Session:` trailer.
Nothing in the repo represents the Routine; delete it and the loop stops silently. Its prompt says
to read this file and `BACKLOG.md` first, so keep both self-sufficient.

Each run is **groom → build → gate → deploy → notify**:

1. **Groom.** Read `feedback` + `events` (Supabase MCP `execute_sql`, or the Management API fallback
   below), review the app, add/reprioritize P0–P3 in `BACKLOG.md` with a one-line rationale, dedupe
   against Done/Blocked. Run `node scripts/groom_seed.mjs --apply` to refresh the source-tagged
   "Reddit-seeded candidates" managed block (`docs/reddit-persona-pipeline.md`): those are candidates
   to promote with judgment, never auto-built. Seed sources: `seed` (curated 2026-08-13);
   `reddit-owner` (the owner browsing Reddit via Claude in Chrome with `docs/reddit_intake_prompt.md`;
   each theme carries an `observed` field — weight thin ones accordingly); `reddit-live` is
   **unavailable** (Reddit closed self-serve API registration — don't send the owner to
   reddit.com/prefs/apps). **Known dedupe defect:** coverage is keyword presence across CLAUDE.md +
   BACKLOG.md, so a theme merely narrated as *deferred* counts as covered (`self-schedule-fairness`);
   pinned by a test — don't "fix" it by trimming the Done log, that resurrects shipped themes. When
   the queue runs dry, a persona pass (`docs/reddit_personas.json`, 6 personas driven as subagents)
   replenishes it; a persona finding ships only if it reproduces in the harness or is corroborated by
   a Reddit theme.
2. **Build.** `git fetch origin claude/migrate-to-github-deploy-3F5RD && git checkout -B
   claude/clause-md-review-9tqlj8 origin/claude/migrate-to-github-deploy-3F5RD`, then implement the
   **single** highest-priority unblocked, gate-safe item from `## Queue`.
3. **Gate** — all must pass: boot happy renders; `hang-getsession` still renders; `block-babel` shows
   the boot error screen; zero non-network page errors; SRI intact (5); boot hardening + wage-core
   untouched; wage-math probes pass; money surfaces legible on iPhone 13.
4. **Deploy** only on green: commit with the dated Done-log line, push the work branch
   (`--force-with-lease`), PR to the deploy branch, squash-merge, confirm live at badgebudget.com. If
   push is denied, put `git format-patch` output in the summary rather than losing the work.
5. **Notify** the owner by push with 1–2 lines.

**Queue shape.** `## Queue` holds only work one run can finish *and verify*. Anything needing a live
repro, a design call, or delicate surgery lives under `## Needs a dedicated session (NOT for the
nightly loop)` — don't pull from there, and move an item there with a one-line reason rather than
re-deferring it nightly. Every open item carries a harness tag: `harness:drivable` (verifiable
end-to-end in the iPhone-13 sandbox — every build since 2026-08-17), `harness:needs-live-auth`
(authenticated swap board; verify by the swap-UI standard in `docs/swap-board.md` instead),
`harness:unscoped` (no existing surface — a feature to design). Within a band, `drivable` first.

**Rules.** Full autonomy, gate-limited. One build item per run. Risky or ambiguous → mark `deferred`
with a note and take the next safe item or stop; never deploy a failing gate. `BACKLOG.md` is the
durable memory — commit everything. Scheduled-run quirks: `BACKLOG.md` → Environment notes.

## Supabase

- Project `mnnlgcxnvodjwlhhiphq`, free tier, and **the only project** — it holds real users' pay
  history while RLS audits and migrations run against it (a dev project is a parked item). Tables,
  all RLS-enabled: `user_data`, `feedback` (+ `kind`, migration 003, applied 2026-09-13; nullable,
  CHECK-constrained, no RLS change needed — the insert-only policies are per-command, not
  per-column), `events`, `ops_admins` (migration 004 — the ops-console allow-list; RLS on with **zero policies**, so it is
  invisible through the API and readable only by `is_ops_admin()` as owner), `ical_subscriptions` (migration 002, applied
  2026-09-02; 4 per-command policies, `anon` unlisted), `swap_profiles`, `swap_groups`, `swap_members`,
  `swap_posts`, `swap_matches`, `swap_match_legs`. One Edge Function: `ical-proxy` (ACTIVE, `verify_jwt`
  on — a POST with no token is 401, **but the public anon key from `index.html` passes `verify_jwt`
  and runs the handler** — live-probed 2026-09-13, `security-08`: 422, not 401 — and `www.google.com`
  is allowlisted with no path constraint, so until the handler checks `role === 'authenticated'` it
  is an anonymous relay against free-tier egress; `BACKLOG.md` → hardening session).
- **MCP.** `.mcp.json` runs `@supabase/mcp-server-supabase` over stdio with `SUPABASE_ACCESS_TOKEN`
  from the environment (uppercase; set in the cloud environment settings, never committed). Network
  policy must allow `api.supabase.com`. Prefer the typed tools (`execute_sql`, `get_advisors`,
  `list_tables`) over dashboard instructions. PR #57 replaces this with the hosted HTTP/OAuth server;
  revert that hunk when merging — OAuth can't complete in the nightly's headless container.
- **Management API fallback.** `curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
  https://api.supabase.com/v1/projects/<ref>/…` — `database/query` (POST, SQL), `config/auth`
  (GET/PATCH), `advisors/{security,performance}`, `usage`. Node fetch needs
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- **Advisor state (re-read 2026-09-13, after migration 004).** No ERRORs. 19 security-definer WARNs:
  8 that the swap RPCs are `anon`-executable, and 11 that they plus the 3 new `ops_*` functions are
  `authenticated`-executable. Expected in both cases — those RPCs *are* the boundary and gate
  internally (swap board audited 2026-07-30; the ops functions probed 10/10 on 2026-09-13, see
  `docs/ops-console-scope.md`). **The ops functions are deliberately absent from the `anon` list**;
  if one ever appears there, that is a real regression. Plus "leaked password protection disabled" —
  HIBP is Pro-only; the API silently ignores it on free. One INFO: `ops_admins` has RLS with no
  policy — **that is the design** (invisible through the API, readable only by `is_ops_admin()` as
  owner). Don't "fix" it by adding a policy.
- **Headroom (re-read 2026-09-13).** 4 `user_data` rows, 9 feedback, 689 events, 278 distinct
  `anon_id` devices, 4 `auth.users`; DB far under 500MB. The prior figures in this line (3/4/~270)
  had drifted badly — re-read them, don't trust them. Watch MAU (50k cap)
  and DB size; `MAX_BLOB_BYTES` and the feedback length caps bound per-row growth.

## Testing (no device needed)

Browsers are pre-installed under `/opt/pw-browsers/` (the nightly launches
`chromium_headless_shell-1194/chrome-linux/headless_shell` with `--no-sandbox`). The sandbox blocks
CDNs and Supabase but allows `registry.npmjs.org`, so the harness is rebuilt per session:

1. Vendor the pinned packages from npm (react, react-dom, @babel/standalone, pdfjs-dist,
   @supabase/supabase-js, playwright-core@1.47.2).
2. Scratch-copy `index.html`; rewrite the 5 CDN `<script>` tags to the local paths and strip
   `integrity`/`crossorigin` **in the scratch copy only**.
3. Serve with `python3 -m http.server`; drive with Playwright's iPhone 13 device profile; capture
   `console`, `pageerror` and `requestfailed` (that is how the spinner bug was found).
4. Top-level function declarations are globals, so unit-test the real `shiftGross`/`hourlyRate`/
   `sanitizeData` via `page.evaluate`. Seed `localStorage['nursingWagePlannerData']` with
   `{setupComplete:true, baseRate:50}` to skip onboarding. For any wage-core change, also render the
   same seed against the *deployed* build and assert the hero, chips, breakdown rows and take-home
   text are byte-identical (the #65 harness did this with pre/post-tax deductions, custom FICA %,
   percent + dollar withholdings, OT and PTO). A `makeMinimalPdf(text)` builder that emits a
   structurally valid PDF drives the paystub path.
5. Test failure modes, not just the happy path: block Babel (expect the boot error screen), hang
   `getSession()` (expect the app to render anyway).

**Dev-build console diagnostic.** Production React silences dev-only warnings (missing `key`,
controlled/uncontrolled flips, setState-on-unmounted, invalid nesting) — real defects that never
surface as a `pageerror`. Make a second scratch copy pointing at `react.development.js` +
`react-dom.development.js` (already in the vendored packages), drive the real flows, and capture
`warning`/`error` console messages. A clean run shows only the Babel in-browser transformer notice
and the sandbox `ERR_CONNECTION_RESET`s. Last run 2026-08-23: clean.

**The scratch copy cannot reach the real project (2026-09-16).** `buildScratch` now also rewrites
`SUPABASE_URL` to `https://harness-must-never-write.invalid` and widens the scratch copy's
`connect-src` by exactly that one unresolvable host — without the CSP half every telemetry request
dies before Playwright can intercept it, so an assertion on what the app *sends* could never fire.
`index.html` itself is untouched, asserted both ways in `tests/smoke.mjs` §13 and gated by
`check_build.mjs` → `[events] Harness cannot write to production`.

**The harness is in git as of 2026-09-07** — `tests/harness.mjs` (vendors the pinned packages,
builds the scratch copy with local script paths, serves it) and `tests/smoke.mjs` (65 assertions:
boot renders, no non-network page errors, the wage-math probes, money redaction, the error-buffer
drain, the onboarding funnel, the account menu, the feedback tiles, both failure modes, the ops console's signed-out gate, and that a submitted feedback row really carries this device's `anon_id` — asserted by intercepting the insert, not by trusting the code).
§12 covers the `session_end` exit row (it exists, carries this device's `anon_id`, says how long
and what happened last, keeps to a money-free prop whitelist, and does not duplicate on a second
hide) and §13 covers `ob_step` stage 0 plus the harness containment above — all negative-tested.
`node tests/smoke.mjs` runs it; it resolves
the sandbox browser at `/opt/pw-browsers/...` when present and falls back to Playwright's own
registry on a GitHub runner. **Every assertion was negative-tested** — the gate was confirmed to
FAIL when each invariant is deliberately broken, because a gate that has only ever passed proves
nothing.

**Still not in git:** the 27-assertion swap-matching suite (`te_swap_p2_algo.js`) and the RLS audit
(`rls_audit.js`, which mints throwaway confirmed users via the admin API). Those figures in the Done
log remain unreproducible. Porting them to `tests/` is the remaining half of this item.

**Client error telemetry.** Errors are captured by the boot script's ring buffer
(`localStorage['scrubpayErrors']`, cap 20) and, since 2026-09-07, flushed once per app load into
`events` as `client_error`. `window.__takeErrorLog()` reads *and clears* — clearing first is
deliberate, so a failed send drops the batch instead of resending it on every load forever. One row
per load, never one per error, so an error loop can't hammer the free tier. Money-shaped figures are
redacted by `redactMoney()` (the paystub path `console.error`s a raw parse error that can embed PDF
text — a real leak vector, not a ceremonial scrub); Postgres codes and line numbers survive. Stacks
are not sent — `src` + `line` names the site, and the watchdog screen's "Copy error log" still hands
a user the full stack. Errors from the current session also flush on `pagehide` via the same keepalive
sender as `session_end` (`flushClientErrors(uid, true)`) — **added 2026-09-16, and it is the
change that makes the channel exist at all for the public.** Flushing only on the next load meant
a device that never came back never reported anything, and every public device to date is a
one-visit device: all 13 `client_error` rows ever recorded came from 4 *insider* devices. A crash
that kills the page still cannot report itself; an ordinary abandonment now can. Owner read: `select created_at, props from public.events where
name='client_error' order by created_at desc;`

## Open items (state as of 2026-09-05 — the work queue itself is `BACKLOG.md`)

- **Agent gateway** (`docs/agent-gateway-scope.md`, merged 2026-09-05 via #67): the scoping design for
  "one domain, two surfaces" — extract the wage core into `core/` with a build step that inlines it
  back; versioned `apply_ops` instead of whole-blob writes; an MCP Edge Function authenticated by
  Supabase's OAuth 2.1 server so RLS applies to the agent unchanged; an ops manifest that gates UI/tool
  parity. **Nothing is built.** Five owner decisions gate the first session: build step yes/no,
  rehearsal project, agent swap-board writes, custom auth domain, create `main`. The doc's own advice:
  step 1 (core extraction, zero behavior change) then step 3 (read-only gateway) is the cheapest route
  to a connector on a real phone; writes wait for step 2 (versioned ops). **Path B** (same doc, added
  2026-09-05): a shared Siri Shortcut that enqueues proposed ops into an inbox the app confirms — the
  near-term bridge that needs none of those decisions and leaves the app the sole writer to
  `user_data`. Scoped, not built; `BACKLOG.md` → Needs a dedicated session.
- **Scaling, burn and transferability** (`docs/scaling-and-burn.md`, 2026-09-07): ~$30/mo covers 100k MAU, so
  cash is never the constraint — what breaks first was **no CI** (closed 2026-09-07: `gate` + `smoke` are
  required checks), no backups on the free tier, and the 15s whole-blob polls (`index.html:2363` and `:4703`), the second of which grows with
  the square of unit size. North-star metric is **density** (units with ≥10 members and ≥1 confirmed swap in
  30 days — currently zero), not DAU. Levers L0–L6 are pre-scoped with trigger thresholds; pulling them early
  is waste. Queued in `BACKLOG.md` → Needs a dedicated session + Blocked.
- **Open PRs.** #46 — ten lines of AuthModal copy naming supabase.co before Google does (still says
  "ScrubPay"; rebase + rename before merging, or close it in favour of the GCP consent-screen branding).
- **iCal sync, owner-side.** The proxy allowlist still lacks the real NurseGrid feed host (marked TODO;
  Google Calendar works); do a smoke test with a real secret address. Follow-ups (per-item confirm,
  "locally edited" protection for synced shifts, the iOS Shortcuts push alternative) are in `BACKLOG.md`.
- **Merged branches to delete** (delete pushes are 403 from agent sessions — do it in the GitHub UI):
  `claude/reddit-agent-personas-threads-q3mobt`, `claude/reddit-seed-phase1`,
  `docs/reddit-persona-pipeline`, `crawler-pushtest`, `claude/scrubpay-domain-purchase-j9cqf6`,
  `claude/ical-subscription-sync`, `claude/ical-branch-progress-4x2baj`,
  `claude/rename-scrubpay-badgebudget-5jesy5`.
- **Google consent screen — done 2026-09-07, wall confirmed down.** Branded and **In production**, so
  any Google account can now sign in (see Auth). The supabase.co string remains and needs a paid
  Supabase custom domain to remove. Brand verification is failing on two issues but does not gate
  basic-scope sign-in; the `<noscript>` half of that is worth fixing on its own merits. **Watch for the
  payoff:** `sign_in_attempted` vs `signed_in` vs new rows in `auth.users`. First
  `sign_in_attempted` landed 2026-09-07 21:16 — the deferred queue survives the OAuth redirect in
  production, not just in the harness. **The baseline was beaten: a 4th `auth.users` row landed
  2026-09-12 12:14 UTC via Google, and it is not one of the three builder accounts — the first
  genuine signup since 2026-09-02, and the first evidence the consent-screen work paid off.** It
  is also a one-visit account: `last_sign_in_at` equals `created_at` to the millisecond, so they
  signed in once and never came back. Nobody noticed for a day, which is the case the ops console
  exists for.
- **The nightly Routine's prompt still curls the github.io URL** for its live check (a 301 with no
  body, so it can never see the change it verifies) — change it to
  `https://badgebudget.com/index.html?cb=N`. The `ship` skill already encodes the correct check.
- **Anonymous users and the domain move:** checked 2026-09-02 — no device that saved a shift or
  completed setup without also signing in, so nobody lost data. Every phone did mint a fresh `anon_id`
  on the new origin, so distinct-device counts are inflated across the cutover.
- **Feedback → email** (Resend Edge Function + DB webhook on `feedback` INSERT): blocked on the owner's
  `re_...` key + destination address. Spec in `BACKLOG.md` → Blocked.
- **Second Supabase project for dev/test** (free plan allows two) so audits and migrations stop
  touching real data. `BACKLOG.md` → Needs a dedicated session.
- **CI and the harness (2026-09-07).** `tests/`, `.github/workflows/ci.yml`, the negative-tested
  invariant gate, and the `deploy gate` ruleset making `gate` + `smoke` required are all in place;
  auto-merge is on. Remaining: port `te_swap_p2_algo.js` and `rls_audit.js` into `tests/`; pin the six
  actions to SHAs and `.mcp.json` off `@latest` (`actions/checkout@v4` and `actions/setup-node@v4`
  also target a deprecated Node 20 runtime — bump while pinning). **Not yet negative-tested end to
  end:** the ruleset is confirmed in force via the API, but no deliberately-red PR has been pushed to
  prove it actually blocks a merge. Worth one throwaway PR to close that loop.
- **Capture `user_data`/`feedback`/`events` DDL + RLS** as `supabase/migrations/000_core.sql`.
- **Council rerun** (owner's standing request) — last full run 2026-07-30, `docs/history.md`.
- **Parked engineering** (calendar memoization + virtualization; sync content-equality
  canonicalization — `user_data.data` is `jsonb`, so canonicalize key order before comparing;
  backdrop-filter perf; poster_key rotation; swap handoff redesign): `BACKLOG.md` → Needs a
  dedicated session.
