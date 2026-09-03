# BadgeBudget (ScrubPay) Backlog

Durable, git-tracked queue for the **autonomous nightly groom+build loop** (see CLAUDE.md →
"Autonomous nightly loop"). This file is the loop's memory — the container is ephemeral, so
anything not committed here is lost between runs.

**Each nightly run:** (1) GROOM — mine feedback/events + review the app, add/reprioritize items
below; (2) BUILD — implement the single highest-priority **unblocked, gate-safe** item
end-to-end (build → iPhone-13 Playwright harness → safety gate → deploy), then mark it done here
with a dated line in the Done log.

- **Status:** `todo` · `doing` · `done` · `deferred` · `blocked`
- **Priority:** P0 (broken/critical) · P1 (high value) · P2 (nice) · P3 (polish)
- **Safety gate (must pass before deploy):** boot happy + `hang-getsession` + `block-babel`
  error screen; no page errors; SRI hashes intact (5); boot hardening untouched; money surfaces
  legible; wage-math sanity. Never weaken boot hardening / SRI / wage-core. If an item is risky,
  ambiguous, or the gate fails → mark `deferred` with a note, take the next safe item or stop.
  **One build item per run.**

## In progress
_(none)_

## Queue

### P1
_(empty — promote from the candidate lists below with judgment)_

### P2
- [ ] **Savings goals, second slice: the reverse view** (owner/Courtney; follows the MVP shipped
  2026-09-03, see Done log) — `harness:drivable`. The MVP shows a previewed shift as "% of goal". Add
  the goal's own view: "about N more shifts" and, if the user has logged shifts, "on track for
  <month>". Model, to keep it one run: average take-home of the shifts logged in the last 8 weeks
  (fall back to the current preview's take-home when fewer than 3); N = ceil(remaining ÷ average);
  the date = today + N × (56 days ÷ shifts-in-window). Place it under each goal in Settings → SAVINGS
  GOALS and, optionally, as "moves your goal ~N days closer" in the Add-Shift preview. **Keep the
  no-nudge-engine constraint**: informational only — no streaks, no push, no "behind on your goal",
  no encouragement to pick up more. Derived state only; `goals` shape and `sanitizeData` unchanged.
- [ ] **Paystub review sheet: say so when 0 differential rows were detected**
  (source:persona/Per-diem-Priya; `harness:drivable`; `index.html` ~2762/2784 — the
  `{rows.length>0 && …}` block in `PaystubReview` has no else branch) — when a paystub parses a base
  rate but no differential rows (the "0 shifts" case), the whole "DETECTED DIFFERENTIAL ROWS" section
  is omitted with no note. Add an else note: "No differential rows were detected — add
  night/weekend/holiday rates in the next step." Drivable end-to-end: the nightly's harness has a
  `makeMinimalPdf(text)` builder (`gate.js`, session-local — rebuild it if the container was
  reclaimed) that produces a valid PDF pdf.js parses; extend it to emit a "Pay Rate: $X Hourly" line
  with no HOURS AND EARNINGS section to reach the base-rate-but-0-rows case, then assert the note.

### P3
- [ ] **First-run "Join with a code" card lacks the helper line the second one has**
  (source:persona/Swap-savvy-Sam; `harness:needs-live-auth`; `index.html` ~4019) — add "Enter the
  6-character code a colleague shared with you." under its `<h3>`. Corroborated by the 2026-08-11
  "how do I use a pin" feedback. Verify by the swap-UI standard (`docs/swap-board.md`).
- [ ] **Pre-reveal anonymity reassurance** (source:persona/Swap-savvy-Sam; `harness:needs-live-auth`;
  `index.html` ~4129-4130, above "SUGGESTED FOR YOU") — one muted line "Names stay hidden until
  everyone accepts." above the suggestion cards. Verify by the swap-UI standard (`docs/swap-board.md`).

## Needs a dedicated session (NOT for the nightly loop)

_These are real and wanted, but none can be implemented **and** fully verified inside one
autonomous run — each needs a live repro, a design call, or delicate surgery on machinery the
sandbox can't exercise. They lived in P1–P3 for weeks and the nightly correctly skipped every one
of them, every night, which cost a full scan each run and produced one no-ship (2026-08-16). Parked
here so the loop's queue contains only work it can actually finish; pick these up interactively._

- [ ] **Groom dedupe erodes deferred themes** (tooling, found 2026-08-22) — `groom_seed.mjs` decides
  "covered" by keyword hits against CLAUDE.md + BACKLOG.md, so a theme merely *narrated in the Done
  log as deferred* is counted as built and silently drops out of the candidate set. Live example:
  `self-schedule-fairness` matched `self schedule` / `self-scheduling` / `fairness` in the 2026-08-16
  no-ship note and has been invisible ever since. **Do not** fix by reducing the Done log to its
  bolded titles — probed 2026-08-22, that regresses genuinely-shipped themes (`swap-partner-discovery`
  reappears as a candidate). Needs a real notion of built-vs-discussed (an explicit shipped-ids list
  is the likely answer). Defect is pinned by a test so it can't rot silently. **Parked 2026-09-02:**
  a tooling change with no harness gate and an open design question (the shipped-ids list) — not a
  nightly build.

- [ ] **Split test writes off the production database (a second Supabase project)** — raised by
  the owner 2026-09-02 while asking about dev/test/stage/prod environments. **Scope deliberately
  narrowed to the database**, see reasoning below.
  **The actual exposure:** there is exactly one Supabase project (`mnnlgcxnvodjwlhhiphq`) and it
  holds real wage data for the owner's wife and her friends. Against that same live project we
  currently: mint throwaway confirmed users via the admin API during RLS audits
  (the RLS audit script — never committed, lived in a session scratchpad; 29 assertions + 5
  adversarial probes), apply migrations directly
  via the Management API, and patch functions live (that is how the `reveal_match` 42702 fix
  landed). None of that is reckless in isolation, but it means a bad migration or a runaway test
  script writes into the only copy of real users' pay history.
  **Proposed fix:** create a second Supabase project as `dev`. The free plan allows **2 active
  projects**, so this costs nothing. Point the RLS audit and any future migration rehearsal at it;
  apply to prod only after the dev run is clean. Needs a way for the harness to pick a project
  (env var or a `?env=dev` switch in the scratch copy — NOT a committed prod/dev toggle in
  `index.html`, which would be a new boot-path branch and a gate risk).
  **Why NOT four environments (dev/test/stage/prod):** the app is a single HTML file with under a
  dozen users, and dev+test already exist in the form that matters — the iPhone-13 Playwright
  harness builds a scratch copy with vendored deps and the safety gate blocks a bad deploy. A
  staging *site* would also need a second repo or a non-Pages host (GitHub Pages serves one site
  per repo), and would slow the nightly loop for no one's benefit: staging earns its keep when
  someone would notice a broken deploy before the users do, and right now nobody is watching.
  Revisit a staging tier when there are enough users that a bad nightly costs something real.

- [ ] **Auto-syncing calendar subscription (replace one-shot .ics file upload)** — owner-requested
  2026-08-23. Today importing a schedule means exporting a file and uploading it by hand, once. The
  ask: it should just stay in sync. **Chosen approach: secret iCal URL + proxy** (owner picked it
  2026-08-23 over Google OAuth, see the rejected alternative below).
  **Design:** the nurse pastes a calendar's *secret iCal address* once — Google Calendar publishes
  one per calendar, and NurseGrid publishes one for its schedule feed, so this covers both the
  Google route and NurseGrid directly. Store it, then re-fetch + re-parse on every app open.
  Practically indistinguishable from background sync from the user's side.
  **Reuse — this is why it's cheap:** `parseICSSchedule(text)` (index.html:646) already takes raw
  .ics *text*, so the only new input path is fetch-instead-of-FileReader (`onImportICS`, :2271).
  Re-sync idempotency is already solved: the existing `icsUid` keying (:2251) moves shifts on
  re-import and preserves assigned pay types, which is exactly re-sync semantics.
  **The one piece that needs building:** a Supabase Edge Function to proxy the fetch — Google's and
  NurseGrid's .ics endpoints send no CORS headers, so the browser can't read them directly. Keep the
  proxy narrow: allowlist the two known host patterns, cap response size, no redirects to private
  ranges (SSRF), and never log the URL.
  **Treat the URL as a credential.** A secret iCal address is a bearer token — anyone holding it can
  read that calendar forever. It must NOT go in the `user_data` JSON blob (that blob is exported by
  "Export data", mirrored to localStorage, and echoed through the sync poll). Give it its own column
  or table, and keep it out of `events`/analytics entirely.
  **Privacy:** store dates, start/end and a stable event id only — never event titles. A personal
  calendar carries appointments and family detail that a wage app has no business retaining.
  **Rejected alternative — Google OAuth (what it would have cost):** Calendar scopes are *sensitive*,
  so beyond ~100 test users it needs Google OAuth verification (branding, privacy policy, homepage,
  demo video). Worse for the async goal specifically: refresh tokens issued while the app is in
  Testing mode expire after ~7 days, which breaks unattended cron sync until verified. And Supabase
  deliberately discards the Google token — *"Provider tokens are intentionally not stored in your
  project's database"* — so `provider_refresh_token` is available exactly once, in the session at
  sign-in, and true background sync would mean persisting a long-lived key to the user's whole Google
  account (encrypted, service-role-only, Edge-Function-only). The app holds zero third-party
  credentials today; that is a large jump in security surface for the same user-visible result.
  Also note Google's GIS JS library is not a pinned/SRI-able URL, so the OAuth route would have to
  hand-roll the redirect to avoid regressing the SRI rule.
  **Why not the nightly loop:** new Edge Function + a new secret-bearing column + a live third-party
  fetch the sandbox can't reach. Needs a dedicated session.
  **Second candidate — iOS Shortcuts push (researched 2026-08-23, owner's idea; may be the better
  one).** The owner's insight: most iPhone users already sync Google/Outlook into **iOS Calendar**,
  so iOS Calendar is the aggregation point and reading *it* is provider-agnostic in a way reading
  Google's API never is. Route with no native app: a Shortcut using `Find Calendar Events` +
  `Get Contents of URL` POSTs the events to a ScrubPay ingest endpoint. Distributed as an iCloud
  link (one tap, no App Store); runnable by voice ("Hey Siri, sync my shifts"); and a **Personal
  Automation** on a Daily trigger with "Ask Before Running" off runs it unattended, so it syncs
  while the app is closed — which the iCal-URL option cannot do. Server side is *simpler* than the
  proxy: the phone pushes to us, so no CORS and no SSRF surface; needs an ingest Edge Function plus
  a per-user token the app issues and the user pastes into the Shortcut once (same
  treat-as-credential rules as above).
  Trade-offs: **iOS-only** (the iCal URL also serves Android/desktop), setup is a shortcut install
  rather than a paste, and time-of-day automations are best-effort — Apple's developer forums note
  they can skip when the phone has been locked and idle a long while, so it is "usually daily", not
  cron. Given the actual user base (a nurse and her unit, all iPhones), Shortcuts-first is the
  likely call; decide at build time.
  **Ruled out — native Siri / App Intents.** Checked because iOS 27 (ships Sept 2026) deprecates
  SiriKit and makes **App Intents the only way Siri talks to a third-party app** (WWDC 2026; App
  Intents 2.0 adds streaming, multi-turn, on-screen awareness). App Intents is a **Swift-native
  framework with no web/PWA surface** — an installed PWA appears in Spotlight and App Library search
  but **Siri cannot find it**, and it gets no widgets, Live Activities, or App Intents. Putting
  ScrubPay into the new Siri therefore requires a real native app in Swift shipped via the App
  Store, which contradicts the single-file architecture. Shortcuts is the supported way to reach
  Siri without going native. Revisit only if ScrubPay ever goes native.

- [ ] **"Couldn't sync" after Google sign-in** — recurring in feedback (2 of 3 rows: 2026-08-04
  patrickguthrie222@gmail.com, 2026-07-19 pghawkins222@gmail.com): users hit a sync error after
  logging in with Gmail. Likely the getSession 4s-race / loadCloudRow error path surfacing a
  transient failure as "couldn't sync." INVESTIGATE with a real multi-device/auth repro — NOT
  gate-safe for a one-run autonomous build; needs focused attention. High user-trust impact.

- [ ] **Calendar memoization** — App re-renders all ~480 month cells on every unrelated state
  change. `useCallback` on statOf/ptoStatOf/keyOf and `React.memo` on MonthSection; verify no
  stale-closure bugs and the scroll machinery (scrollMonthTo/jumpToday/hero-follow) still works.

- [ ] **Sync content-equality canonicalization** — the poll-sync anti-ping-pong guard may be
  inert. First confirm `user_data.data` column type (json vs jsonb) via Supabase MCP; if jsonb,
  canonicalize key order before compare. Delicate — exercise the poll_sync probe.

- [ ] **Calendar 16-month virtualization** — all months stay mounted; window them WITHOUT
  breaking scrollMonthTo/jumpToday/hero-follow (they need measurable rects). Careful.

- [ ] **Backdrop-filter perf pass** — reproduce jank on older-iPhone emulation FIRST; only then
  trim blur on the ~8 glass surfaces. Don't blind-remove (visual regression).

- [ ] **Swap poster_key rotation** — copy disclosure SHIPPED 2026-08-11 (see Done log); the
  optional harder follow-up remains: per-cycle key rotation so a colleague identified via one
  confirmed match can't correlate that person's *future* posts. Non-trivial (touches the
  security-definer poster_key derivation) — defer until real demand.

- [ ] **Swap handoff redesign: double-blind + reliability signal + negotiation "market"** —
  owner design question 2026-08-24; decided via a 5-persona council A/B (Sam, Val, Nadia, Nia,
  Frank). NOT a nightly build — `needs-live-auth` + RLS/anonymity-critical + a product decision;
  may overlap the `claude/share-link-swap-board` work.
  **Council verdict (B wins 3–2, but really "B+"):** go **double-blind** (peers never see each
  other; only the approver/manager sees both identities to process — you can't be anonymous to the
  processor, only to peers). The two A-votes (Sam, Frank) weren't asking for names — they wanted
  *accountability/coordination*, which a **failure-weighted reliability signal** ("completed N
  swaps, M no-shows"; new users flagged no-history) satisfies. With that signal, B converts all
  five.
  **Unanimous must-haves:** (1) the handoff must **reliably complete + show status**
  (`Submitted → pending (Xd) → Approved/Declined + reason`) — every persona's dealbreaker was
  silent limbo; (2) the approver package = **both real names + both parties' documented acceptance
  + an OT/hours-rule flag**, delivered as ONE locked approve/deny (Val's hard constraint: an
  anonymous-to-the-approver swap is un-enterable in Kronos). Corroborated by real seed themes
  `swap-manager-approval-bottleneck` + `swap-falls-through`.
  **Negotiation market — concept yes, chains NO (unanimous):** ship only (a) a `giveaway` vs
  `trade-only` toggle, (b) a single **atomic paired** swap ("accept only if you also take one of my
  posts", accept-both-or-neither), and (c) Frank's **availability windows** ("pick up: Tue/Wed
  days; giving up: Fri nights" → board surfaces overlaps). Plain accept stays the default (Nia's
  dealbreaker). **Hard rule:** cap conditionals at ONE linked pair, never a chain; resolve the
  negotiation to a locked package before it reaches the approver. Full multi-way negotiation was
  rejected by all five as a "combinatorial swamp." Full panel writeup in the session transcript.

## Blocked
- [ ] **Feedback → email (Resend)** — Edge Function formats each new `feedback` row + sends via
  Resend `onboarding@resend.dev` → owner email; DB webhook on `feedback` INSERT calls it.
  **BLOCKED** on a Resend API key (`re_...`) + destination email from the owner.
- [ ] **"Sync to calendar" label reads like a live sync but is a one-shot .ics download**
  (source:persona/Veteran-Val; `harness:drivable`) — relabel to "Export .ics" (symmetric with
  "Import .ics") or "Add to my calendar." One-word copy change; **blocked on the owner's preferred
  wording** (naming call).

## Environment notes (for the nightly loop — updated 2026-09-02)
- **Where it runs:** the Routine fires into a persistent, authorized session (CLAUDE.md → Autonomous
  nightly loop), where `git push` and the typed Supabase MCP tools both work — every build since
  2026-08-10 shipped that way, and GROOM has read `feedback`/`events` live via MCP since 2026-08-27.
  Two earlier limitations are **historical, not current**: fresh-session Routine fires could not push
  (403 "repo not in this session's authorized repository set", seen 2026-08-04 and 2026-08-09) and
  could not send an authenticated Management API request. If the loop is ever moved back to
  fresh-session-per-fire, expect both to return; the `git format-patch` fallback in the Routine prompt
  exists for that case.
- **Container reclaim:** the session persists but its container does not. Re-clone the repo and
  rebuild the harness (CLAUDE.md → Testing) when they are gone, and never branch from a local
  `claude/migrate-to-github-deploy-3F5RD` ref without fetching first — a stale one has been seen 14
  commits behind origin.
- **Sandbox network:** CDNs and Supabase's REST/auth endpoints are blocked from Playwright, so the
  harness vendors deps from `registry.npmjs.org` and stubs Supabase in-page for swap flows; the
  Management API and the MCP server are reachable.

<!-- GROOM_SEED:BEGIN (managed by scripts/groom_seed.mjs — do not edit by hand) -->
### Reddit-seeded candidates (auto — review before building)
_Generated by `scripts/groom_seed.mjs` from `docs/reddit_seed.json`. Deduped against CLAUDE.md + BACKLOG.md. Promote an item into the priority queues above (and delete it here) once a human/groom confirms it; these still pass the normal safety gate before any deploy._

_Within each priority, **`drivable` items come first** — they are the ones the nightly can verify end-to-end in the iPhone-13 harness, which is what every shipped build since 2026-08-17 has been. `needs-live-auth` and `unscoped` items are real but are not one-run builds; prefer them only when nothing drivable remains._

**P1**
- [ ] **Want to see what a schedule means for the paycheck before committing** (P1 · source:reddit-seed · self-scheduling · drivable) — When self-scheduling or picking up, nurses want to project the paycheck impact of a proposed set of shifts before they lock it in. Maps to `paycheck-projection` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Gross is easy; nurses want realistic take-home after taxes/deductions** (P1 · source:reddit-seed · pay-differentials · drivable) — Nurses know their gross but want a believable net after federal/state tax, FICA, and pre/post-tax deductions. Maps to `paycheck-projection` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.

**P2**
- [ ] **Managers change posted schedules with little notice** (P2 · source:reddit-seed · manager-conflicts · drivable) — Posted schedules get changed on short notice, breaking plans; nurses want to keep their own source-of-truth record of shifts and notes. Maps to `shift-logging` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Confusion about when OT kicks in and how it interacts with differentials** (P2 · source:reddit-seed · pay-differentials · drivable) — Nurses are unsure whether OT is 1.5x of base or of the differential-inclusive rate, and when daily vs. weekly OT applies. Maps to `overtime-flag` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Automatic unpaid-break deductions take pay for breaks that were never taken** (P2 · source:reddit-owner · pay-differentials · drivable) — Timekeeping systems auto-deduct one or two unpaid breaks per 12-hour shift regardless of whether staff actually got them, pushing the burden onto nurses to file a manual missed-lunch form to reclaim the pay. Several report employers quietly ceasing to honor those forms, turning it into an ongoing unpaid-wage dispute rather than a one-off gripe. Maps to `shift-logging` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from owner-gathered Reddit signal (observed: 5+ distinct r/nursing threads over ~1 year); groom to confirm priority/scope before build.
- [ ] **Pure self-scheduling with no fixed recurring day makes childcare and life planning impossible** (P2 · source:reddit-owner · self-scheduling · drivable) — Distinct from general self-schedule fairness: nurses need a locked, recurring anchor day or a cyclic block pattern to coordinate childcare and appointments. Commenters consistently rate fixed or cyclic patterns as far more livable than pure self-schedule systems, where nothing repeats week to week. Maps to `shift-logging` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from owner-gathered Reddit signal (observed: 1 major r/nursing thread (~5d old, 194 up / 112 comments), dozens of independent corroborating commenters); groom to confirm priority/scope before build.
- [ ] **Manager sign-off delays or blocks agreed swaps** (P2 · source:reddit-seed · shift-swapping · needs-live-auth) — Even after two nurses agree to a trade, manager approval stalls or denies it, so nurses want the agreement locked in and easy to present. Maps to `swap-board` (harness:needs-live-auth — the sandbox cannot reach an authenticated board; verify by the swap-UI standard instead). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.

**P3**
- [ ] **PTO requests denied or blocked by blackout dates** (P3 · source:reddit-seed · manager-conflicts · drivable) — PTO is hard to plan around denials and blackout windows; nurses track requested vs. approved time off alongside their shifts. Maps to `day-events-pto` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Mandatory OT and floating make pay unpredictable** (P3 · source:reddit-seed · staffing-pickups · drivable) — Being mandated to stay or floated to another unit changes pay; nurses want to log these and see the effect. Maps to `shift-logging` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Travel/agency payroll errors take weeks of opaque escalation to get paid for a worked shift** (P3 · source:reddit-owner · pay-differentials · drivable) — Separate from understanding contract pay structure: a missed punch or unrecorded shift triggers slow back-and-forth between recruiter, agency payroll, and the facility's vendor-management system, sometimes a month for a few hundred dollars. Nurses are bounced between contacts with no ETA, and want their own defensible record of what they worked. Maps to `shift-logging` (harness:drivable — verifiable end-to-end in the iPhone-13 sandbox). Auto-surfaced from owner-gathered Reddit signal (observed: 3 distinct r/TravelNursing threads over ~1 year); groom to confirm priority/scope before build.
- [ ] **Agreed swaps fall apart last-minute** (P3 · source:reddit-seed · shift-swapping · needs-live-auth) — A colleague backs out of an agreed trade late, leaving someone scrambling; nurses want confirmation and a clear record of who accepted. Maps to `swap-board` (harness:needs-live-auth — the sandbox cannot reach an authenticated board; verify by the swap-UI standard instead). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Nurses want to negotiate swaps in a channel managers can't see until the trade is final** (P3 · source:reddit-owner · shift-swapping · needs-live-auth) — Units coordinate swaps in Facebook groups, GroupMe, or Teams that managers also belong to, letting a manager block an already-agreed trade after the fact. The prevailing advice is to find the partner in a management-free channel and bring only the finished trade for sign-off. Maps to `swap-board` (harness:needs-live-auth — the sandbox cannot reach an authenticated board; verify by the swap-UI standard instead). Auto-surfaced from owner-gathered Reddit signal (observed: 1 dedicated r/nursing thread (~1y, 855 up / 99 comments) with broad independent corroboration); groom to confirm priority/scope before build.
- [ ] **Swaps get denied by hidden eligibility rules (no-overtime, skill/seniority tier match)** (P3 · source:reddit-owner · shift-swapping · needs-live-auth) — Facilities require trades to be even in hours so nobody triggers overtime, and to preserve skill mix so a charge-qualified slot only goes to another charge-qualified nurse. These constraints are invisible until a swap is rejected, which reads as arbitrary even when it is a stated policy. Maps to `swap-board` (harness:needs-live-auth — the sandbox cannot reach an authenticated board; verify by the swap-UI standard instead). Auto-surfaced from owner-gathered Reddit signal (observed: same r/nursing thread plus scattered one-line confirmations elsewhere); groom to confirm priority/scope before build.
- [ ] **Travel/contract nurses compare take-home against staff roles** (P3 · source:reddit-seed · pay-differentials · unscoped) — Contract and travel nurses want to compare net pay of a contract vs. a staff position, factoring stipends and differentials. Maps to `new` (harness:unscoped — maps to no existing surface; a feature to design, not a one-run build). Auto-surfaced from the curated Reddit seed corpus; groom to confirm priority/scope before build.
- [ ] **Managers contacting nurses off shift, on PTO, or on leave to chart or cover** (P3 · source:reddit-owner · manager-conflicts · unscoped) — Managers reach out about documentation fixes or coverage during vacation, leave, or days off, occasionally escalating to a write-up for not responding off the clock. A boundary/communication-norms complaint distinct from schedule-change or PTO-denial themes. Out of scope for a pay planner; recorded for completeness. Maps to `new` (harness:unscoped — maps to no existing surface; a feature to design, not a one-run build). Auto-surfaced from owner-gathered Reddit signal (observed: 1 r/nursing thread (~2mo, 29 up / 22 comments); could NOT be independently corroborated — signal downgraded from the reporter's 'occasional'); groom to confirm priority/scope before build.

<!-- GROOM_SEED:END -->

## Done (log)
- 2026-09-03 — **Savings goals — MVP: a shift's take-home as % of a goal** (owner/Courtney P1;
  harness:drivable). First slice of the goal-tracker feature. Goals live in the existing `user_data`
  JSON blob (`goals:[{id,name,target}]`) — no new Supabase table, no schema/RLS surface; `sanitizeData`
  validates each (name 1–40 chars, target coerced to a finite positive number, capped at MAX_GOALS=12)
  so a malformed target can't produce NaN percentages. Added to serializeState + the debounced-save
  deps + applyData + resetToDefaults (same pattern as templates/dayEvents). Settings → **SAVINGS GOALS**
  section adds/edits/removes goals. The **forward, pre-commitment** placement (the owner's "whole
  thesis") is live: the Add-Shift preview shows the previewed take-home as a % of each goal — e.g.
  "toward your goal: 2.8% of House down payment" (up to 3 goals, guarded on `previewNet>0`). Held the
  line on the **no-nudge-engine** constraint: purely informational at the moment of choice — no streaks,
  no push, no "behind on your goal." **wage-core untouched.** iPhone-13 gate **63/63** incl. a
  sanitizer unit test (drops blank/negative/NaN, coerces numeric-string) and a live drive (seed a goal
  → Add-Shift preview names it with a plausible %; Settings lists it; zero page errors). SRI intact (5),
  boot hardening untouched. GROOM (Supabase MCP live): events healthy, no new feedback. **Follow-up left
  in the P1 item:** the reverse view ("N shifts to go" / on-track date) + "moves your goal N days
  closer" — both need an average-shift model; drivable next.
- 2026-09-02 — **Paystub "Couldn't read that paystub" failure modal now actionable** (persona/Per-diem-
  Priya; harness:drivable). The empty-result modal said only "We couldn't read this paystub format —
  you can set things up manually," giving no reason or what-to-try — matching the analytics (1 paystub
  import ever, 0 shifts). Replaced the `.help` line with actionable guidance: names the cause (no pay
  details found), what works (the **detailed** paystub from a payroll portal — Workday/UKG/Kronos —
  that lists pay rate + hours; a photo/screenshot/summary won't parse), keeps the on-device
  reassurance, and points to manual setup. Copy-only in the empty branch — **wage-core / parsePDF
  untouched**. iPhone-13 gate **59/59**, incl. a real end-to-end drive: a new `makeMinimalPdf()` harness
  builder emits a structurally-valid PDF (correct xref offsets) with no pay data → `onPaystub` →
  parsePDF returns empty → the modal renders the new copy; zero page errors. **Reusable win:** that PDF
  builder unlocks the remaining paystub-parse P2 (0-differential-rows note) for a future nightly. SRI
  intact (5), boot hardening untouched. GROOM (Supabase MCP live): feedback=4 (all previously triaged),
  events healthy; no new signal.
- 2026-09-01 — **Paystub "read on your device, never uploaded" privacy cue** (persona/Per-diem-Priya;
  harness:drivable). The "Scan a paystub" CTAs (onboarding welcome step + Settings → DATA) gave no
  format or privacy cue, so a nurse weighing whether to hand over a paystub had no reassurance it
  stays on-device — plausibly part of why paystub import is barely used (1 import ever in analytics).
  Added a muted line under the onboarding CTA ("PDF paystub · read on your device, never uploaded.")
  and a matching hint in the Settings DATA section. Additive copy — **wage-core untouched**. iPhone-13
  gate **56/56** incl. a live drive (fresh load → welcome step shows the CTA + the privacy cue; zero
  page errors). SRI intact (5), boot hardening untouched. GROOM (Supabase MCP live): feedback=4 (all
  previously triaged), events healthy; no new signal. NOTE: this clears the last clean drivable
  persona copy item — remaining persona candidates are the two paystub-parse P2s (need a crafted PDF
  fixture to drive) and needs-live-auth swap items; next nightly should either build a PDF fixture for
  those or the queue is effectively drained of one-run work (consider a fresh persona pass).
- 2026-08-31 — **Settings TAXES "starting estimates" reassurance line** (persona/New-grad-Nia;
  harness:drivable). Onboarding step 3 tags the tax fields ESTIMATED + says "We estimated these…",
  but the Settings → TAXES section showed raw %/FICA fields with no such cue, so a returning user had
  no signal the numbers are defaults to verify. Added a muted hint under the TAXES header: "Starting
  estimates — check a recent paystub and adjust." Pure additive copy — **wage-core untouched**.
  iPhone-13 gate **56/56** incl. a live drive (open Settings via the gear → TAXES section shows the
  reassurance line; zero page errors). SRI intact (5), boot hardening untouched. GROOM (Supabase MCP
  live): feedback=4 (all previously triaged), events healthy; no new signal.
- 2026-08-30 — **Day-sheet section header reads "MARK THIS DAY" on a shift-less day** (persona/Float-
  pool-Frank; harness:drivable). The Add-a-shift sheet's day-events section was always labelled "ALSO
  ON THIS DAY" — but "ALSO" presumes a shift is already logged, so on an empty day it read as a
  non-sequitur. Made it conditional: `{list.length ? 'ALSO ON THIS DAY' : 'MARK THIS DAY'}`. One-line,
  copy-only; **wage-core untouched**. iPhone-13 gate **58/58** incl. a live drive (open a shift-less
  day → header "MARK THIS DAY"; open a day with a shift → header "ALSO ON THIS DAY"; zero page errors).
  SRI intact (5), boot hardening untouched. GROOM (Supabase MCP live): feedback=4 (all previously
  triaged), events healthy; no new signal.
- 2026-08-29 — **Calendar day-cell aria-label names the event kinds** (persona/Float-pool-Frank;
  harness:drivable). The month-grid cell aria-label announced day events as a bare count ("2 day
  events"), so VoiceOver couldn't tell PTO from an appointment. Replaced the count with the kind
  labels — `evs.map(e=>EVENT_KIND_META[e.kind]?.label).join(', ')` — so a day now reads e.g.
  "Sat Aug 29 2026, PTO, Appt, about $467 take-home". Pure a11y/label change, one line, **wage-core
  untouched**. iPhone-13 gate **57/57** incl. a live drive (seeded a PTO+appointment day → aria-label
  names both "PTO" and "Appt", no bare "day event" phrase). SRI intact (5), boot hardening untouched.
  GROOM (Supabase MCP live): feedback=4 (all previously triaged — swap-pin → parked P3, 4h → already
  built, 2× couldn't-sync → parked live-repro), events healthy; no new signal.
- 2026-08-28 — **Onboarding step-2 differentials copy reworded** (persona/New-grad-Nia; harness:drivable).
  Step 2 shows each differential's amount as read-only text with only an on/off toggle — amounts are
  editable later in Settings, not here — but the help line read "toggle what applies and tweak to your
  contract," sending a new grad hunting for an amount input that isn't on the screen. Reworded to
  "toggle what applies — you can fine-tune the amounts anytime in Settings." Pure onboarding copy —
  wage-core untouched. iPhone-13 gate **55/55** incl. a live drive (onboarding → Set it up myself →
  Continue → assert STEP 2 renders the new copy and the old wording is gone) plus the shipped-PTO-hint
  regression checks. SRI intact (5), boot hardening untouched. GROOM (Supabase MCP live): no new
  feedback since 2026-08-11 (still 4 rows, all triaged: swap-pin → parked P3 join-helper; "4-hour
  shift" → already built as the [4,8,12,16] HOURS chips; two "couldn't sync after Gmail" → parked
  dedicated-session live-repro). Events healthy (app_open leads); nothing new to surface.
- 2026-08-27 — **PTO is paid at base rate — hint under the PTO hours input** (persona/Float-pool-Frank;
  harness:drivable). A PTO day adds a $ figure to the calendar/hero (hours × baseRate, taxed normally),
  but the input never said how PTO is valued, so the number looked unexplained. Added a muted line
  under the PTO hours field: "Paid at your base rate — about {fmt2(baseRate)}/hr." Pure additive copy
  using `baseRate` (already a prop) + the global `fmt2` — **wage-core untouched** (no change to
  ptoStatOf / statOf / calc). iPhone-13 gate **55/55** incl. a live PTO drive (open a day → tap the PTO
  chip → assert the hint shows the seeded base rate; a non-PTO day shows no hint). SRI intact (5),
  boot hardening untouched. GROOM (Supabase MCP live this run): feedback=4, events=198. The 2026-08-04
  "add a 4-hour shift option" request is **already satisfied** — the Add-Shift HOURS picker chips are
  `[4,8,12,16]` (index.html ~3367); noted so it isn't re-surfaced. The 2026-08-11 "how do I use a pin
  someone gives me to join a board?" feedback corroborates the parked P3 "first-run Join-with-a-code
  card lacks the helper line" item (not sandbox-drivable — swap sheet needs live auth). The two
  "couldn't sync after Gmail" rows remain the parked dedicated-session live-repro item.
- 2026-08-26 — **Onboarding "this is just an example" cue on the base rate** (persona/New-grad-Nia;
  fresh persona pass this run). Step 1 pre-fills the base-rate field with the default $65.15, and a
  low-confidence new grad could tap Continue leaving a stranger's rate in — silently corrupting
  **every** projection. Appended a bold cue to the step-1 help: "The amount below is just an example
  — enter your own rate." Copy only — **wage-core / default state / boot / SRI / sync untouched**.
  iPhone-13 gate **42/42** incl. an unseeded onboarding drive (cue renders on step 1; confirmed the
  input is pre-filled with 65.15 so the cue is warranted). SRI intact (5). GROOM: no new feedback;
  ran a fresh 3-persona pass on under-reviewed surfaces (onboarding/settings, day-events/PTO,
  paystub import) → new candidates queued below.
- 2026-08-25 — **Calendar day-cell OT signal** (persona/Night-shift-Nadia; last open drivable
  persona candidate). A logged OT shift was pixel-identical to a base shift on the month grid, so a
  differential/OT nurse couldn't spot which days were OT at a glance. Added a tiny green "OT" marker
  by the date number when any shift that day is OT (`arr.some(s=>s.isOvertime)`, already stored) and
  ", includes overtime" to the cell aria-label for screen readers. Additive display only — no
  calendar scroll-machinery, wage-core, boot, or SRI touched. iPhone-13 gate **41/41** incl. a live
  calendar drive (seeded an OT shift on today → cell shows "OT" + aria "includes overtime"; a
  no-shift day stays unmarked). SRI intact (5). GROOM: no new feedback/events. This clears the last
  drivable persona candidate — a fresh persona pass (or one of the parked dedicated-session builds)
  is next.
- 2026-08-24 — **"Keep N%" take-home chip on the hero** (persona/Per-diem-Priya; last open drivable
  persona candidate). The hero showed Gross + Taxes chips but the take-home *ratio* only lived in the
  breakdown/settings; added a "Keep {calc.pct}%" chip to the hero chips row (gated on `calc.hours>0`,
  like the hours chip) so any gross figure can be mentally netted at a glance. Used `calc.pct` — the
  app's canonical net/gross — so it matches the breakdown exactly (no second, slightly-different
  percentage). Pure display — **wage-core untouched**. iPhone-13 gate **35/35** incl. a live hero
  drive (seeded a charge shift → "Keep 78%" renders, validated 1–99%). SRI intact (5). GROOM: the
  "couldn't sync" issue was fixed as a **P0** by another session (#45 — cloud saves were broken for
  ALL signed-in users since Jul 7); shareable invite links shipped (#43) and are in active use
  (`swap_invite_shared`/`_opened`/`swap_group_joined` events). Also captured the owner's swap-handoff
  A/B council decision into the dedicated-session section above.
- 2026-08-23 — **OT confirmation in the Add-Shift preview** (persona/Night-shift-Nadia; highest-
  priority `drivable` item in the newly harness-classified queue). Toggling Overtime silently ×1.5'd
  the "This shift adds" total with nothing saying so — a differential/OT power user couldn't tell her
  toggle "took" without mental math. Appended a green "· incl. OT ×1.5" tag to the preview line, gated
  on `isOvertime` (already-set state). Pure display — **wage-core untouched** (no change to shiftGross/
  previewNet). iPhone-13 gate **34/34** incl. a live OT-toggle drive (tag hidden → "+$1,080 gross ·
  +$841 take-home · incl. OT ×1.5" on → hidden off) + fabtoday/bonusfix/addclose/breakdown/invite
  regressions. SRI intact (5). GROOM: no new feedback; active use continues (swap_posted + signed_in +
  new setup_completed since 2026-08-22). Noted the council's pipeline upgrades landed while idle
  (#41 owner-mediated Reddit intake + design doc; #42 harness classification) and a `share-link-swap-
  board` branch is in flight (untouched — no overlap with this AddShift change).
- 2026-08-22 — **Queue focus pass: harness classification + park the un-runnable work** (meta-goal /
  council process; docs + scripts only, `index.html` untouched). Owner asked whether a per-run cap on
  auto-added candidates would keep the nightly focused. Evidence said no: the loop already builds
  exactly ONE item per run, so a cap changes what's *visible*, not what's built — and it would trim
  P3s while keeping the P1/P2s, which were the unbuildable ones. The real cost was that **100% of the
  formal queue was self-annotated as not-runnable** (sync = "NOT gate-safe for a one-run autonomous
  build", memoization = stale-closure risk, canonicalization = "Delicate", virtualization =
  "Careful", backdrop = needs a repro, poster_key rotation = "Non-trivial"), so the nightly scanned
  past every P1–P3 item each night and shopped in the candidate lists instead — six consecutive
  builds (08-17 → 08-22) came from persona/seed candidates, **zero** from the queue, and 08-16
  shipped nothing at all. Two changes: (1) those six items moved to a new
  `## Needs a dedicated session (NOT for the nightly loop)` section, leaving `## Queue` holding only
  work a run can finish; (2) `groom_seed.mjs` now classifies every candidate with a **`harness:`**
  tag — `drivable` / `needs-live-auth` / `unscoped` — derived from `mapped_feature` (per-insight
  override supported, bogus values ignored), renders it into the backlog line with a plain-language
  note, and **orders `drivable` first within each priority band** so the first thing the build step
  reads is the thing it can most likely ship. The classification is not a guess: it reproduces the
  swap-board deferrals the Done log already recorded for exactly that reason. Tests **33/33** (was
  23): classification, override precedence, bogus-override rejection, validator, tag-in-line, and the
  ordering invariant. No cap added.
- 2026-08-22 — **Reddit intake re-scoped to owner-mediated browsing + design doc finally landed**
  (meta-goal / council process; docs + scripts only, `index.html` untouched). **Phase 3 as designed is
  dead:** Reddit closed self-serve app registration under its Responsible Builder Policy (Nov 2025,
  updated Jun 2026) — Data API access now needs a manually-approved ticket that can be denied without
  appeal, and `/prefs/apps` routes to Devvit (apps that run *inside* Reddit, uncallable from a
  container). Verified from the nightly's own environment: egress to Reddit is fine
  (`api/v1/access_token` → 401, unauth `search.json` → 403 datacenter block), so credentials were
  always the only gap. **Replaced with Phase 3-alt (active):** the owner browses Reddit logged-in via
  Claude in Chrome, which returns paraphrased aggregate themes in the Stage-1 schema; reusable prompt
  committed at `docs/reddit_intake_prompt.md`. First run returned **7 new themes** (now in
  `docs/reddit_seed.json`, 15 → 22), each carrying an `observed` field recording how widely it was
  actually seen — the standout is `missed-break-auto-deduction-pay-loss` (5+ threads, high confidence,
  squarely a wage-accuracy feature; see the corpus entry for the pattern — described obliquely here on
  purpose, because spelling it out trips the dedupe defect below and hides the candidate).
  One theme's signal was downgraded to `one-off` on intake because the reporter flagged it
  uncorroborated. Wiring: `reddit-owner` added as a valid source; **fixed a latent rendering bug**
  where a non-`seed` source double-prefixed its tag (`source:reddit-reddit-live`) via a new exported
  `sourceTag()`; `observed` is threaded through `analyze()` into the backlog line. Also landed
  `docs/reddit-persona-pipeline.md` — drafted in PR #29 on 2026-08-13 and never merged, so every
  reference to it (CLAUDE.md, BACKLOG.md, `groom_seed.mjs`) was dangling and the nightly agent was
  following a spec it could not read. Corrected two subreddits in it that don't exist (r/AskNursing,
  r/ICUnursing → r/asknurses, r/IntensiveCare). Tests **23/23** (was 15). Groom re-applied: 18
  candidates. Found but deliberately **deferred** the dedupe-erosion defect above rather than patching
  it blind.
- 2026-08-22 — **Invite links for the swap board** (owner-requested; follows directly from the
  re-share item below — the code was reachable, but handing it over still meant a colleague retyping
  6 characters into a screen they'd have to find first). Sharers now send
  `…/705-v1/?join=ABC123` via the **native iOS share sheet** (`navigator.share`, straight into
  Messages), falling back to copying the same link+message wherever `navigator.share` is absent or
  the user cancels the sheet (AbortError is treated as "chose not to send", not as a failure).
  Recipients get a **confirm screen, never a silent auto-join** — the board's name can't be shown
  pre-join (RLS hides `swap_groups` from non-members and `join_swap_group` returns only an id), so
  the code is what's confirmed and the name lands in the success toast. Handles the two ways the
  code gets lost on the way in: a **1h-TTL localStorage stash** carries it across the Google OAuth
  redirect (which returns to a bare origin+pathname), and the URL is consumed on mount but presented
  only once onboarding is done — a link recipient is exactly the person most likely to be a
  first-time user. `?join=` is deleted from the address bar immediately; every other query param is
  written back byte-identical so supabase-js's own PKCE `?code=` is untouched. A code that matches
  no board retires itself rather than re-prompting; re-tapping your own link says "already in", not
  "joined". Also collapsed three duplicated clipboard blocks into one module-level `copyText()`.
  **No RLS / security-definer / poster_key / reveal changes** — the link carries only the invite
  code, which is exactly what reading it aloud already carried; no wage-core/boot/SRI touched (SRI
  still 5). iPhone-13 harness **38/38** invite assertions + **4/4** boot gate (happy,
  `hang-getsession` incl. the invite still rendering behind a deadlocked session, `block-babel`
  watchdog) + dev-React console-warning run clean. Sandbox can't reach the authenticated board, so
  the signed-in flow was driven end-to-end against an in-page Supabase stub (fake auth +
  `join_swap_group`) — the swap-UI standard of #27/#28.
- 2026-08-22 — **Re-share the invite code from the active swap board** (persona/Swap-savvy-Sam;
  **directly addresses the standing "How do I use a pin someone gives me to go to the swap board?"
  feedback** — pghawkins 2026-08-11). After the one-time "Board created!" screen the invite code was
  nowhere, so a member couldn't hand it to a colleague without leaving/recreating the board. Added an
  "Invite code · ABC123" ghost button to the active-board header (next to "+ Post to the board") that
  reuses the existing `copyCode` + the already-loaded `activeGroup.invite_code`. **Security-checked:**
  the groups query already selects `invite_code` (line 1019) and RLS on `swap_groups` only returns
  rows the caller is a member of (comment at 1013), so re-showing the code to a member leaks nothing;
  **no RLS / security-definer / poster_key / reveal changes**, no wage-core/boot/SRI touched. iPhone-13
  gate **31/31**. Verified via the swap-UI standard (#27/#28): bundle presence + reuse of vetted
  primitives + whole-file compile (seeded-boot renders, zero page errors) — the authenticated board
  isn't sandbox-drivable (needs live Supabase auth). GROOM: no new feedback/events. Fifth persona-pass
  build; closes the last real recurring user complaint in the queue.
- 2026-08-21 — **Fix doubled "+" on saved bonus rows** (real display bug, found by the 2026-08-21
  persona pass — Night-shift-Nadia). The "ON THIS DAY" list rendered `+{BONUS_LABEL[...]}`, but
  `BONUS_LABEL` already includes the sign (e.g. `Charge +$3/hr`), so charge/preceptor/on-call rows
  read "**+Charge +$3/hr**" — noise on every logged charge shift. Dropped the stray literal `+` (1
  char). **wage-core / boot / SRI / sync untouched** (BONUS math unchanged, only its label). iPhone-13
  gate **29/29** incl. a live drive: seeded a charge shift on today, opened the sheet via the FAB, and
  asserted the row reads "Charge +$3/hr" with NO "+Charge". SRI intact (5). GROOM: another new user
  completed setup + 2 swap_posted 2026-08-21 (swap board actively used). Also ran a **second persona
  pass** (Swap-savvy Sam + Night-shift Nadia) → 6 new candidates logged above; top: re-share invite
  code (closes the recurring "how do I use the pin" feedback). Chose the verifiable bug over Sam's
  higher-value-but-sandbox-unverifiable swap item this run.
- 2026-08-20 — **New-grad jargon glosses** (persona/New-grad-Nia, corroborated by seed
  `take-home-vs-gross`; timely — a new user onboarded 2026-08-18). Three plain-language additions for
  first-year nurses: (1) onboarding differentials step now says the pay bumps "are called
  **differentials** — the word you'll see on your paystub"; (2) onboarding FICA row gains a subtitle
  "Social Security + Medicare — required, same for everyone"; (3) the breakdown's "Gross pay" gains a
  "before taxes & take-outs" subtitle (mirroring the existing "% of gross" line on Take-home).
  Additive copy only — **wage-core / boot hardening / SRI / sync untouched** (no change to the FICA
  math, just its label). iPhone-13 gate **30/30** incl. a live unseeded onboarding walkthrough
  (differentials + FICA glosses render) and a seeded breakdown drive (gross-pay subtitle visible),
  plus fabtoday + close-button regressions. SRI intact (5). GROOM: no new feedback/events. Fourth
  consecutive persona-pipeline build; queue now down to the "keep ~%" chip (possible redundancy) and
  the owner-input "Sync to calendar" relabel — a fresh persona pass will replenish next.
- 2026-08-19 — **"Log a shift" lands on today** (promoted from the persona pass — Veteran-Val).
  The mobile FAB and the empty-state "+ Log a shift" button both opened the Add-Shift sheet on
  `days[0]` (the first day of the viewed pay period — often several days in the past), forcing the
  user to close and hunt for today. Added `openSheetForLog()` which opens **today** when today is in
  the viewed period (the common case: logging tonight's shift), falling back to `days[0]` when
  browsing another period; wired the FAB + empty-state button to it. The desk-only "first empty day"
  button is unchanged. Additive helper — `openSheet`/wage-core/boot/SRI/sync untouched. iPhone-13
  gate **26/26** incl. a decisive drive (seeded `payPeriodStart` 6 days back → FAB opens on "today",
  NOT the 6-days-ago period start) + the Close-button regression. SRI intact (5). GROOM: a new user
  completed setup 2026-08-18; no new feedback. Third consecutive persona-pipeline build.
- 2026-08-18 — **Add-Shift sheet Close (X) button** (promoted from the 2026-08-17 persona pass —
  Veteran-Val's strongest finding). The Add-Shift bottom sheet was the only sheet without a visible
  close control; the sole exit was tapping the dim scrim, which *saves* if anything was touched
  (`dismiss` = save-if-dirty-else-close). Added a `.back` X to the sheet header (grouped with the
  date pill so the flex layout holds), wired to the existing `dismiss` — discoverable exit, behavior
  identical to the scrim tap, matching every other sheet. Additive UI reusing `dismiss` + `Ic.x`;
  **wage-core / boot hardening / SRI / sync untouched**. iPhone-13 gate **23/23** incl. a live drive
  (open sheet → Close visible in header → tap dismisses the sheet). SRI intact (5). GROOM: no new
  feedback/events since 2026-08-13. Second consecutive build from the persona pipeline.
- 2026-08-17 — **Take-home per hour in the Add-Shift preview** + **Reddit pipeline Phase 2
  (personas) built & run.** SHIP: the Add-Shift live preview now shows "≈ $X/hr take-home" under
  the gross/net line (gated on `hours>0`), so per-diem/pickup nurses can compare shifts at a glance
  — the recurring `pickup-worth-decision` seed theme. Pure display of the already-computed
  `previewNet`/`hours`; **wage-core untouched** (no change to shiftGross/hourlyRate/calc). iPhone-13
  gate **23/23** incl. a live Add-Shift drive (preview shows "≈ $46.75/hr take-home", figure
  validated as plausible net hourly). SRI intact (5). META: shipped `docs/reddit_personas.json`
  (6 grounded personas) and ran the **first persona-review pass** (3 personas via subagents:
  New-grad Nia, Per-diem Priya, Veteran Val) against the app — the shipped item came from Priya and
  is corroborated by the Reddit seed (passes the design's reproduce-or-corroborate verification
  gate). Their other findings are logged as persona-sourced candidates below. GROOM: no new
  feedback/events since 2026-08-13.
- 2026-08-16 — **No ship (deliberate defer) + testing-process improvement.** GROOM: no new
  feedback/events since 2026-08-13; seed candidates stable (12). Reviewed for a gate-safe build and
  found none that clears the bar: the formal-queue P1/P2/P3 are all risky/not-gate-safe (sync,
  memoization, virtualization, backdrop, poster_key rotation), and the remaining Reddit-seed
  candidates are feature-sized (paycheck-preview, self-schedule fairness, PTO-request tracking,
  contract-vs-staff) or map to already-shipped surfaces (take-home, per-shift preview, differentials,
  .ics import). The one grounded copy candidate — manager-ready swap-plan text
  (`swap-manager-approval-bottleneck`) — is **not gate-verifiable**: `buildSwapPlanText` is
  component-scoped inside `SwapsSheet` (not a top-level global) and the reveal/copy flow needs a live
  confirmed match (Supabase, unreachable in the sandbox), and swap usage is near-zero (2 posts ever).
  Per the rules (defer risky/ambiguous; never gamble the live app), **deferred rather than churn**.
  Instead shipped a durable council-process win: added a **dev-build console-warning diagnostic** to
  CLAUDE.md → Testing (surfaces React key/controlled-input/unmount warnings the prod gate silences) and
  **ran it — app is clean** (no React warnings across boot / add-shift / OT toggle / save / period nav).
  Docs/process only; `index.html` untouched. **Next high-value work needs dedicated feature builds, not
  one-run additive changes** — recommend the owner green-light a focused session on: (1) the **sync P1**
  (recurring "couldn't sync" user-trust issue) and (2) **schedule-to-paycheck preview**.
- 2026-08-15 — **Pay-period navigator accessibility** (app-review find, not a seed theme). The
  period `‹`/`›` buttons above the take-home figure were the **only** nav control with no accessible
  name (calnav + all back buttons were already labeled), so screen readers announced them as
  "less-than sign, button." Added `aria-label` (Previous/Next pay period), wrapped the control in
  `role="group" aria-label="Pay period"`, and made the range label an `aria-live="polite"` region so
  the new period is announced on navigation. Pure ARIA attributes — no logic/layout change; boot
  hardening / SRI / wage-core / sync untouched. iPhone-13 gate **25/25** incl. a live drive (both
  buttons reachable by accessible name; Next advances the label Aug 15–28 → Aug 29–Sep 11). SRI
  intact (5). GROOM this run: no new feedback/events since 2026-08-13; the take-home, pay-period, and
  per-shift preview surfaces were reviewed and are already well-handled (no change warranted there).
- 2026-08-14 — **Surface .ics import on the calendar card** (promoted from the Reddit-seeded
  `nursegrid-schedule-reentry` theme — loud/high-confidence: nurses keep schedules in NurseGrid and
  won't re-type them). Import was buried in Settings while export ("Sync to calendar") sat on the
  main calendar card. Added an "Import .ics" affordance next to Sync (calendar card, `groups.length`
  n/a) that **reuses the existing `onImportICS` handler + the whole import stepper** — no new import
  path. Container flex now wraps so the row never crowds on iPhone; Settings import kept too (two
  entry points now). Additive UI only — boot hardening / SRI / wage-core / sync untouched. iPhone-13
  gate **25/25** incl. a live seeded-view drive (label visible on the calendar card, `.ics` file
  input present in the main view, existing Sync export intact). SRI intact (5). GROOM this run: no
  new feedback/events since 2026-08-13; seed candidates stable (12).
- 2026-08-13 — **Overtime × differential explainer** (P2, promoted from the Reddit-seeded
  candidates `overtime-rules-confusion` + `differential-stacking-confusion` — both loud/recurring
  themes). When the OT toggle is on, the Add-Shift sheet now shows a muted one-liner: "1.5× is
  applied to your differential rate — a night/weekend shift earns 1.5×(base + differential), not
  just 1.5×base. Per-hour add-ons (charge, preceptor, on-call) stay at face value." Copy only —
  it *describes* the already-shipped `shiftGross` behavior; **wage-core untouched**. Additive,
  gated on `isOvertime`. iPhone-13 gate **24/24** incl. a live sheet drive (explainer hidden →
  visible on toggle → hidden on un-toggle) + 9 wage-math probes + boot/hang/block-babel. SRI
  intact (5). GROOM this run (Management API): no new feedback since 2026-08-11 (that "pin/join"
  row shipped in #28); 1 new app_open; sync P1 still not gate-safe. First build promoted from the
  Reddit pipeline.
- 2026-08-13 — **Reddit-insights pipeline Phase 1 (seed corpus + groom wiring)** (meta-goal /
  council process). Owner-approved direction (see `docs/reddit-persona-pipeline.md`, PR #29):
  manual seed first, insights flow directly into BACKLOG. Shipped: `docs/reddit_seed.json` (15
  curated nurse-scheduling pain themes in the Stage-1 schema, paraphrased aggregates only — no
  PII/verbatim) + `scripts/groom_seed.mjs` (validates schema, dedupes each insight against
  CLAUDE.md + BACKLOG.md, emits source-tagged priority-proposed candidates; dry-run/`--json`/
  `--apply`, idempotent managed block) + `scripts/test_groom_seed.mjs` (**15/15**, incl. a fixed
  main-module-guard bug that ran `main()` on import). `--apply` populated the "Reddit-seeded
  candidates" managed block above (12 candidates; 3 already-shipped themes correctly deduped out).
  Docs/scripts only — `index.html` untouched, Pages publishes only app files, so no safety-gate
  surface. Phase 2 (persona harness) + Phase 3 (live Reddit API) still pending.
- 2026-08-12 — **Join another swap board with a code** (from direct user feedback 2026-08-11,
  pghawkins222: "How do I use a pin someone gives me to go to the swap board they created?").
  Root cause: the "Create board" / "Join with a code" cards only rendered at `groups.length===0`,
  so once a nurse had ANY board, a colleague's invite code had **nowhere to be entered**. Added a
  persistent "+ Join another board with a code" affordance at the bottom of the board view
  (`groups.length>0`) that expands to the same 6-char code input — reuses the existing
  `joinCode`/`joining`/`doJoinGroup` machinery + `swap_group_joined` analytics; collapses on
  success. Additive only (one `useState` + one UI block) — no touch to boot hardening / SRI /
  wage-core / sync. iPhone-13 gate **22/22** (boot happy / hang-getSession / block-babel error
  screen + 9 wage-math probes + seeded-setup boot past onboarding + feature-wired markers). SRI
  intact (5). GROOM this run (Management API): new feedback row above (now resolved) + the 2×
  "couldn't sync" (still top P1, not gate-safe); usage healthy (app_open 56, shift_saved 22,
  swap_group_created 2, swap_posted 2). Session-bound run; git push authorized here.
- 2026-08-11 — **Swap match consent disclosure** (P3, from the CLAUDE.md-documented anonymity
  gap). After a swap is confirmed and names are revealed, the match card now shows a muted note:
  colleagues on a confirmed swap can see each other's names and may recognize each other's future
  posts, while your identity stays hidden from everyone you haven't matched with. Purely additive
  UI copy inside the `confirmed && reveal` branch of `SwapsSheet` — zero touch to boot hardening /
  SRI / wage-core / sync. iPhone-13 gate 18/18 (boot happy / hang-getSession / block-babel error
  screen + 9 wage-math probes incl. night-OT×diff & sanitize isOvertime coercion + disclosure copy
  present). SRI intact (5). GROOM this run reached feedback+events via the Management API (token
  present as `$supabase_access_token`): 3 feedback rows (4h shift = already Done; 2× "couldn't
  sync after Gmail" = existing top P1, not gate-safe), healthy core usage (app_open 54, shift_saved
  19) — no new actionable items. Session-bound run; git push authorized here.
- 2026-08-10 — **4-hour shift quick-select** (from user feedback 2026-08-04: "add an option for a
  4 hour shift"). Added a `4h` preset chip to the Add-Shift HOURS row (now 4/8/12/16 + custom) and
  `flex-wrap` on `.hrs` so the row never crowds on narrow screens. iPhone-13 gate 14/14 + a 4h-chip
  e2e probe 6/6 (chip renders 4h/8h/12h/16h, selects on tap, row fits iPhone, no page errors).
  SRI intact (5). Shipped by the **session-bound nightly run** (first successful autonomous deploy).
- 2026-08-09 — **FAB overlap** (P2). Corner-anchored the fixed "Log a shift" button to
  `right:16px` (was centered `left:50%;translateX(-50%)`, which covered calendar/card content
  mid-scroll); `:active` transform simplified to `translateY(1px)`. 2-line CSS diff; safe-area
  bottom inset preserved. iPhone-13 gate 14/14, SRI intact (5). NOTE: originally built by the
  nightly scheduled run but its push was DENIED (403 "repo not in this session's authorized
  repository set"); reproduced + shipped from an interactive session. See Groom notes.
- 2026-08-04 — **Overtime × differential stacking** (P1). `isOvertime` is now an independent
  per-shift flag (own toggle in AddShiftSheet) instead of a mutually-exclusive shift-type chip;
  `shiftGross` applies `hourlyRate(base,diff)` then ×1.5 so a night/weekend OT shift keeps its
  differential (e.g. night OT = 1.5×(base+$10) rather than a flat 1.5×base that dropped it).
  Per-hour/flat bonuses stay at face value. `overtime` filtered out of the shift-type chips (key
  kept for legacy shifts + paystub classify); `sanitizeData` coerces `isOvertime` to a strict
  boolean (old shifts → false); "OT ×1.5" badge on logged shifts. iPhone-13 gate 14/14 (boot
  happy / hang-getSession / block-babel + 8 wage-math probes + sanitize coercion). SRI intact (5).
- 2026-07-30 — Liquid Glass UI; 24-item council fix pass; swap board live + 2 RLS holes closed
  (direct-INSERT anonymity bypass, status forge); tighter grid-style month calendar.

## Discovery inputs (for the GROOM phase)
- `select created_at, message, contact from public.feedback order by created_at desc;` — real user asks.
- `select name, count(*) from public.events group by name order by 2 desc;` — usage patterns.
- Competitive/parity ideas (NurseGrid-style scheduling gaps); nurse pay-planning pain points.
- **Reddit seed corpus** (`docs/reddit_seed.json`) → run `node scripts/groom_seed.mjs` to see
  deduped, source-tagged candidates, or `--apply` to (re)write the managed "Reddit-seeded
  candidates" block above. See `docs/reddit-persona-pipeline.md` for the full pipeline. Live
  Reddit API mining is unavailable (Reddit closed self-serve registration); new themes come from the
  owner's browser intake via `docs/reddit_intake_prompt.md`.
- Turn signal into P0–P3 items above, each with a one-line rationale. Dedupe; don't re-add
  anything already in Done or Blocked.
