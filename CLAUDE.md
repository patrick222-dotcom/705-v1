# BadgeBudget — Shift Pay Planner

Take-home pay planner for bedside nurses, built for the owner's wife and her unit. Logs shifts +
differentials, shows what a shift is worth *before* it's worked, imports/exports .ics schedules, and
plans toward savings goals. It also carries an anonymous shift-swap board, kept deliberately quiet —
see Positioning.

- **Live:** https://badgebudget.com (custom domain since 2026-09-02). The old
  `https://patrick222-dotcom.github.io/705-v1/` URL 301-redirects there. **Verify deploys against
  badgebudget.com.**
- **Naming:** renamed from ScrubPay on 2026-09-04 (#64), visible strings only — the storage keys, the
  .ics UID scheme and the swap salt still say `scrubpay` on purpose (Invariants 5–7). The `scrubpay.*`
  domains belong to other parties; never present them as ours. Why the name changed:
  `docs/session-2026-09-02-domain-and-naming.md`.
- **Positioning (owner decision, 2026-09-19).** One sentence: **replace NurseGrid for schedule,
  then do the thing NurseGrid never did — tell her what the paycheck will be and whether the goal is
  reachable.** Calendar sync is the *substitution* half (she stops opening NurseGrid); the pay
  estimate and goal planning are the half nothing else on her phone does. Both are single-nurse value
  and need no colleague to adopt anything, which is why they lead.
  **The swap board is an Easter egg, not the growth engine.** It is the one feature that needs a
  critical mass of her unit before it is worth anything, and density has been zero since it shipped;
  Courtney asked for it off entirely. The call is to *quiet its CTAs*, not delete it: the board keeps
  working for anyone holding an invite link, and it stops competing for attention on the first screen
  with the two things that work for one nurse alone. Practical consequences, all load-bearing:
  (a) growth copy and any invite/QR framing lead with sync + paycheck, never with swapping — **and
      that includes the copy with no CTA attached to it**: the `<meta name="description">` search
      snippet and the `<noscript>` fallback both still ended on "runs an anonymous shift-swap board"
      four days after the decision, because the de-emphasis work went looking for buttons. Fixed
      2026-09-23 and pinned by `tests/smoke.mjs` §18;
  (b) `security-00` stops being a ship-blocker and becomes a **promotion-blocker** — the hardening
  session must land before the board is ever re-emphasised or its invite links go out at scale, and
  in-app copy may not call the board anonymous until it does — the last four such strings, the
  post toast `Posted — your unit sees it anonymously.` among them, were removed 2026-09-24 and
  pinned by `tests/smoke.mjs` §19, along with `privacy.html`'s claim that the database enforces
  the anonymity (it enforces the *reveal gate*, which is a different and true thing);
  (c) a lens that scores the app down for under-serving the swap board is scoring against a recorded
  decision — see `docs/council.md` and the council-charter item in `BACKLOG.md`;
  (d) **the NurseGrid host is confirmed (2026-09-28)** — the owner generated a real feed from the
  app (Calendar Settings → Generate Nursegrid Calendar Feed) and it serves from `app.nursegrid.com`,
  which the existing allowlist regex already matched: the guess was right. The regex is deliberately
  **not** narrowed to that exact host yet — one account is one sample, and a narrow pin that misses
  Courtney's subdomain would break the one user this app exists for. Narrow it when a second real
  feed agrees. What "no more need for NurseGrid" still lacks is **one end-to-end sync on a real
  phone**.
  **Corrected 2026-09-29:** this line used to end "everything up to that point is now verified",
  which was one step too generous. That real phone *did* try to sync, and it **failed six times** —
  NurseGrid hands out `webcal://app.nursegrid.com/…`, and `webcal:` is a non-special scheme whose
  `protocol` setter cannot be reassigned to `https:`, so `ical-proxy` rejected every feed with
  `400 https_only`. **No real NurseGrid feed had ever synced** since the subscription shipped on
  2026-09-03. What 09-28 verified was the feed's *host and shape*, not that the app could read it.
  Fixed in the app 2026-09-29 (`normalizeFeedUrl`, pinned by `tests/smoke.mjs` §23); the deployed
  Edge Function still carries the broken line but can no longer be reached by it, because the app is
  its only caller and now normalizes first.
  **The gap closed 2026-09-29 at 11:53 UTC, confirmed by the 09-30 groom: a real NurseGrid feed
  synced end to end on a real phone.** `ics_sync_done {events:3}` → `ics_import_done {added:3}`,
  the device's `session_end` shift count 7 → 10, and `POST 200` twice in the function's edge log
  with **zero 400s**, 3h18m after the fix deployed. So the substitution half of the positioning is
  real, the import stepper's pay-type questionnaire has been driven against a real NurseGrid feed,
  and the owner checked the result on 2026-10-03: **the synced shift is correct** (Wed Oct 14,
  12:15 AM, 12.5h, inferred *Night Shift* — matching NurseGrid's own shift screen side by side), and
  **removals propagate** (he deleted 2 of the 3 shifts in NurseGrid and they left BadgeBudget;
  `ics_sync_result {up_to_date, nursegrid}` at 12:49 UTC, zero `client_error`). Scope of that claim:
  **one shift, one account, owner's eyes** — not a test, and the dollar figure rests on his word
  rather than a probe. Before then this line said "do not upgrade until checked"; the 09-29
  correction above is what over-claiming here looked like.
  **A separate fault survives the fix and is NOT transient:** the first proxy call of a load has
  returned `422 not_a_calendar` on both real sessions (09-28 12:26:32, 09-29 11:53:07), each time
  followed by a retry that succeeded 24s later. Hypothesis (**unverified**): NurseGrid serves an
  HTML interstitial on the first hit. Legible from `client_error` from 2026-09-30 on — see below —
  so read one more real occurrence before building a retry against a guess. `BACKLOG.md` → P2.
  **Since 2026-09-30 a failed sync says why.** `icalFailureDetail` puts the HTTP status and the
  proxy's own `{error}` code in the ring buffer, so the four proxy failures are four distinct
  `client_error` rows instead of supabase-js's one generic sentence. The code is **whitelisted** to
  a short snake_case token, never trusted: an HTML body or a URL in the `error` field degrades to
  the bare status, because the feed URL is a bearer credential (Invariant 13). Pinned by
  `tests/smoke.mjs` §24. This exists because diagnosing the two failures above required the Edge
  Function's edge log, **which retains 24 hours** — the 09-29 groom read it with 4h11m to spare and
  the 09-30 groom with 4h42m. Two consecutive nights one bad night away from losing the evidence.
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

## How to talk to me (owner: Pat)

Applies to every session in this repo — nightly loop, council run, ad-hoc, subagent summaries.

- **Be direct. Keep answers short, in everyday language, unless I ask for detail.** No preamble, no
  restating my question, no closing recap — first sentence is the answer or the recommendation. Past
  ~200 words, give the short version and offer the long one. "Explain", "detail", "stress-test",
  "explore" or "vision" are the switches that turn depth on; until one of those, assume I'm
  executing, not studying.
- **Plain words over repo jargon.** This file is dense on purpose, but a *reply* shouldn't be. Say
  "the deploy check" before `check_build.mjs`, "the pay math" before Invariant 3 — name the file or
  invariant once for precision, then keep going in English.
- **Anything I need to do goes in a numbered "Next steps" list at the end.** Max 5, concrete, the
  first one doable right now. Tasks buried in paragraphs get lost.
  **Tag every step with who does it** — start each with **(You)** or **(Me)** — so an action of
  mine is never mistaken for one of his (owner request, 2026-10-03).
- **When there are options, pick one and say why in a sentence.** Don't survey. If you need a decision
  from me, ask at most one clarifying question, and only if you genuinely can't proceed on a stated
  assumption — otherwise state the assumption and keep going.
- **No sycophancy, no validation, no hedging.** Disagree when I'm wrong and say so plainly. If a
  finding is uncertain, say "unverified" and name what would verify it — this repo has been burned by
  confident doc claims that turned out false (three of them in the 2026-09-13 council run).

## Where things are

| Path | What |
|---|---|
| `index.html` | the whole app: CSS, a plain-JS boot script, one Babel-transformed JSX block |
| `pdf.worker.min.js` | pdf.js worker, served same-origin next to `index.html` |
| `CNAME` | `badgebudget.com` — load-bearing, see Deployment |
| `ops.html` | the ops console — a live feedback inbox for the two admins, served at `/ops.html`. In the publish set. Plain JS, no React/Babel/fonts, supabase-js only (same SRI pin as the app). Borrows the app's session (same origin = same localStorage), so it has no auth UI of its own. `noindex`, and deliberately **unlinked from the app** — the gate is `is_ops_admin()` in Postgres, not this page. Design: `docs/ops-console-scope.md` |
| `privacy.html` | the privacy notice, served at `/privacy.html`. In the publish set. Self-contained — no fonts, scripts or styles from anywhere else, so it can't break and makes no third-party requests. Linked from Settings. Served by the harness (copied verbatim) and asserted off its own DOM since 2026-09-24 — `tests/smoke.mjs` §19 |
| `.github/workflows/deploy.yml` | the deploy workflow: 5-file publish to GitHub Pages. (`ci.yml` is the PR gate — see Deployment) |
| `docs/project-notes.md` | the mechanisms, history and figures moved out of this file on 2026-09-27 — Architecture detail, analytics event list, ops dashboard, nightly-loop history, Supabase, Testing, Open items |
| `.claude/settings.json` + `scripts/hooks/pre_push_gate.mjs` | the harness hooks — see Harness hooks |
| `BACKLOG.md` | the nightly loop's durable memory: queue, parked items, blocked, Done log |
| `supabase/migrations/` | `000_core.sql` (`user_data`/`feedback`/`events` + RLS, captured 2026-09-13), `001_swap_board.sql`, `002_ical_subscription.sql` (the iCal feed table), `003_feedback_kind.sql` (the feedback tile tag), `004_ops_console.sql` (the `ops_admins` allow-list + the admin-gated ops RPCs + the first indexes on `events`/`feedback`; applied 2026-09-13, gate probed 10/10), `005_feedback_anon_id.sql` (the device join key on `feedback`; applied 2026-09-14), `006_ops_device_trail.sql` (phase 3b — `ops_device_list()` + `ops_device()`, the per-device touch-point trail; applied 2026-09-16, gate probed 6/6 including over the real REST API with the public anon key), `007_feedback_inbox_anon_id.sql` (adds `anon_id` to `ops_feedback_inbox()` so a report links to that device's trail; applied 2026-09-16 — a DROP and recreate, because Postgres cannot add an OUT column with CREATE OR REPLACE, with the grants and the `anon` denial re-probed after). 000→004 in order stands up a fresh project; 000 is a snapshot of the schema *before* `kind`, so it is never back-edited |
| `supabase/functions/ical-proxy/index.ts` | SSRF-guarded Edge Function that fetches a nurse's secret iCal feed (deployed, `verify_jwt` on) |
| `scripts/groom_seed.mjs` + `scripts/test_groom_seed.mjs` | Reddit-seed groom tooling + its 33-assertion suite |
| `scripts/check_build.mjs` | the mechanical invariant gate — parses the JSX and asserts Invariants 1, 2, 4, 5, 6, 8, 9 |
| `tests/harness.mjs` + `tests/smoke.mjs` | the Playwright rig, in git since 2026-09-07; **571 assertions** on an iPhone 13 profile, plus first-gen iPhone SE in §30 (read "555" until the exhausted-load banner 2026-10-07, "539" until the cloud-load retry 2026-10-06, "518" until the unload-save keepalive 2026-10-05, "496" until the time-off repair path 2026-10-04, "467" until the hero-stats change 2026-10-03, "456" until time-off entries got their own default 2026-10-03, "455" until the weekend-pickup card was hidden 2026-10-03, "450" before the second 2026-10-03 change, "437" before that — regenerate the figure from a run, don't trust the line). `buildScratch` emits a local copy of `ops.html` too, so the console's gate is drivable |
| `scripts/ops_gate_probe.sql` | the adversarial probe set for the ops console's guard — non-admin, `anon`, revocation, and the positive control. Run it before trusting `/ops.html`; the SQL editor's default session is a superuser and both obvious probes lie |
| `scripts/silence_watch.mjs` + `scripts/test_silence_watch.mjs` | is the app silent because nobody came, or because telemetry is broken? Four verdicts (`FRESH` / `SILENT_BUT_HEALTHY` / `SILENT_AND_UNHEALTHY` / `UNKNOWN`), always saying which side it could establish. Reports rather than alarms — only a silence *with* a failed health check exits non-zero. Needs network + `SUPABASE_ACCESS_TOKEN`, so like `tests/equality.mjs` it is not in CI; its 36-assertion classifier suite is |
| `scripts/dashboard_snapshot.sql` + `.mjs` | one query → one JSON blob for the ops dashboard; the `.mjs` folds in the track-name inventory read from `index.html` |
| `scripts/deploy_watch.mjs` + `scripts/test_deploy_watch.mjs` | is what is MERGED actually LIVE? Hashes the three HTML files of the publish set against the deploy branch's git blobs — `deploy.yml` copies them verbatim, so a sha256 match is conclusive and needs no marker string. Five verdicts (`LIVE` / `BEHIND` / `NOT_THE_APP` / `UNKNOWN_BUILD` / `UNREACHABLE`); `BEHIND` names the commit actually being served and how many changes are unshipped. Needs network, so like `silence_watch.mjs`'s live probes it is not in CI; its 55-assertion classifier suite is |
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
   hero and the pattern lab since #65 — `calc`, `statOf`/`ptoStatOf`, `patternMetrics`,
   `patternCellToShift`, **`sampleNet`**, **`keepRatio`**, `firstActiveShiftType`, the
   rate/differential coercions in `sanitizeData`, the `BONUS`/`BONUS_LABEL` tables, and the helpers
   the public names wrap — `shiftGrossCents`, `hourlyRateCents`, `paidHoursOf`,
   `overtimePremiumCents`, `toCents`/`fromCents`/`roundCents`. The list is examples; the test is
   whether a change can move a displayed dollar figure, including arithmetic in a UI component
   that prints one): touch only in a dedicated session, with the
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
    is never logged by `ical-proxy`. The parser stores dates, times, hours and UIDs — never titles. It *reads* `SUMMARY` once, at
    parse time, to set the boolean `offHint` (time off vs. shift), and keeps nothing else from it.
    ↳ **Detect** none, and a leak is silent by construction — nothing observable changes when a bearer
    credential escapes. **Blast** anyone holding the URL reads the nurse's whole calendar
    indefinitely; the only revocation is the calendar provider reissuing it. **Verify** confirm
    `serializeState` never touches the feed field, `ical-proxy` logs no URL, and an exported blob
    contains no feed address. UNCHECKED in the gate.

**What this shape surfaced (2026-09-13).** Filling in `Detect` for all thirteen showed that only #4
has a live production signal; #8 and #9 have one that exists in the data but nothing watches. The
other ten fail silently. Detection, not remediation, is the thin layer here — a plan for fixing a
break is worth nothing against a break nobody sees, and the 47-day sync outage is the proof.

## Architecture — the rules (mechanisms and history: `docs/project-notes.md` → Architecture)

- **Single file, no build step.** React 18 + Babel standalone, JSX transformed in-browser; keep it
  single-file. Two god components, `App` and `SwapsSheet`. CDN deps are pinned with SRI
  (React/ReactDOM 18.2.0, Babel 7.24.7, pdf.js 3.11.174 with `isEvalSupported:false`, supabase-js
  2.45.4); the `<meta>` CSP must cover every runtime host.
- **Data.** Signed-in → Supabase `user_data`, one `jsonb` blob per user, whole-blob last-writer-wins,
  debounced 500ms, capped at `MAX_BLOB_BYTES` (512KB); anonymous → localStorage. Every array goes
  through `sanitizeData` on load. Cross-device sync is a 15s visible-tab poll guarded by
  `updated_at` + content equality; `applyData(...,{keepPeriod:true})` leaves the viewed period alone.
  **The unload flush rides `keepalive`, not supabase-js** (2026-10-05): an ordinary fetch started in
  a `pagehide`/`visibilitychange` handler is cancelled as the document is discarded — three real
  loads logged `AbortError: Promise was rejected because the browsing context is going away` on
  2026-10-03 — so the flush sends a raw `keepalive` POST (`beaconSaveUserData`) instead. **Invariant
  4 applies to the raw call**: `?on_conflict=user_id` + `Prefer: resolution=merge-duplicates`, or it
  is a plain INSERT and 23505s forever. It cannot ride the anon key (`user_data` is owner-only RLS),
  so the access token is cached in module scope by `rememberAuthToken` — armed at sign-in, re-armed
  on `TOKEN_REFRESHED`, cleared on sign-out; **never read auth state inside an unload handler**.
  Success is unobservable there, so the flush writes the per-user backup **every time**, stamped with
  the `updated_at` it sent: `backupWins` is a strict `>`, so an equal stamp leaves the cloud
  authoritative and the backup wins only when the write never landed. Pinned by `tests/smoke.mjs`
  §33 — which also records one assertion deleted for being unfalsifiable (both clock reads land in
  the same millisecond, so the equality check passed with the fix broken; it is pinned at the source
  instead).
- **A failed cloud load retries, because it used to sink the whole load silently** (2026-10-06).
  `hydratedForUser` staying unset on a load failure is correct — it is what stops default or stale
  state overwriting her real blob — but every write path is gated on it, so the debounced save, the
  unload flush, the 15s poll and the iCal auto-sync all go quiet together and **her edits reach
  neither the cloud nor localStorage**, with no UI saying so (`syncError` is set by a failed *save*,
  never a failed *load*). `Load error: TypeError: Load failed` was 10 of 22 `client_error` rows at
  the 2026-10-06 groom, across 3 real devices. `hydrateWithRetry` awaits attempt 1 and **schedules**
  the rest (`HYDRATE_RETRY_MS`, 1500/4000ms), plus a `visibilitychange` re-attempt
  (`HYDRATE_RETRY_MIN_MS`, 5s). **Never await the retry chain** — `init` holds the splash until that
  call returns and Invariant 1's watchdog replaces the app at 8s. **Never write the per-user backup
  from the failed path** — it would mirror the state hydration failed to replace, win the next load
  by being newer, and clobber her real cloud row. Pinned by `tests/smoke.mjs` §34, which asserts the
  boot bound *causally* (when the splash goes, exactly one attempt has happened) after a stopwatch
  version let a partially-awaited chain through. **When all three attempts fail she is told, since 2026-10-07**:
  one `cloudLoad` state (`null`/`'failed'`/`'retrying'`), a `role="alert"` banner above the
  greeting, and a button calling `hydrateWithRetry`. Deliberately **not** `syncError` — its string
  says "saved on this device", which on this path is false, and its `retrySync` is itself gated on
  `hydratedForUser`, so it would render an affordance that does nothing. `'failed'` is raised only
  by an **exhausted** chain, never the first failure (that flashes a red panel for one 1500ms
  backoff), and only a landed load retires it. Pinned by `tests/smoke.mjs` §35, whose own first
  draft held two unfalsifiable assertions: a transient-blip check that read after the retry landed,
  and a no-sideways-scroll check subtracting `window.innerWidth`, which **grows with the overflow**
  — compare against `clientWidth`.
- **Analytics.** `track(name, props)` → `events`, insert-only. Coarse `snake_case`
  `<surface>_<verb>` names only — **never wage or goal figures**. `session_end` goes through
  `beaconInsert()` (keepalive fetch), not `track()`, and the row to read is the LAST per load.
  `nostore-<uuid>` anon_ids are visits, never returning devices — exclude them from device counts.
  `client_error` is one row per load, money-redacted, read-and-clear. Full event list and funnel
  queries: notes → Architecture → Analytics.
- **Feedback.** Insert-only for `anon`+`authenticated`; rows carry `kind`, `page`, `user_agent` and
  (since migration 005) `anon_id`, set inside `submitFeedback` so the offline queue carries it.
- **Auth.** Supabase email/password + Google OAuth, **implicit flow, not PKCE** (`security-11`;
  switching is a dedicated session). Google consent screen is **In production**. Testing the sign-in
  wall needs an account that has never signed in.
- **Swap board is deliberately quiet** (Positioning). No new CTAs, no "anonymous" copy until the
  `security-00/01/02` hardening session lands; names are revealed only after every leg accepts.
- **`active:false` on a differential means "don't offer me this", never "stop paying it".** The lit
  chip is always what is priced (`tests/smoke.mjs` §15).
- **Top bar.** The avatar is the only route to Settings and Sign out below 920px — never hide it at
  any width.
- **Calendar sync** never silently rewrites wage-affecting shifts: feed results go through the same
  import stepper. `ical-proxy` is host-allowlisted (Google + `nursegrid.com`, confirmed 2026-09-28).
  **A feed URL is normalized to `https:` in the app before the proxy ever sees it** (2026-09-29):
  `webcal://` and `webcals://` are swapped on the *string*, because `webcal:` is a non-special scheme
  and the WHATWG `protocol` setter refuses to reassign it — Node and Deno enforce that, **Chromium
  does not**, so a browser test of the setter passes while production returns `400`. Never rely on
  the setter; `tests/smoke.mjs` §23 pins both engines.
  **A removal is bounded by the feed's own reach, never by the parser's window** (2026-10-03):
  absence from a fetch means "deleted" only on or after **today**, or earlier than today where the
  feed demonstrably reaches that far (it carries some event on or before that date). The window
  alone was wrong because it starts **60 days back** while a forward-only feed — NurseGrid's
  apparent shape — carries nothing before today, so every shift she had already worked was offered
  up for deletion through the import stepper. The bound is a **union on purpose**: the obvious
  "never remove anything before the feed's first event" is a regression, because cancelling the
  *nearest* shift moves the feed's first event past it and the cancellation would never propagate.
  Being a union is also what makes it provider-independent, so it needed no answer to "how far
  back does NurseGrid publish?" — that question is still open and now gates nothing. Pinned by
  `tests/smoke.mjs` §28.
  **Every sync says how it ended** (2026-10-02): one `ics_sync_result {result, provider}` per sync
  that reaches the proxy — `changes` / `up_to_date` / `empty` / `unparseable` / `failed` — tracked
  from `finally` with `failed` as the initialiser, so a new early return cannot be silent. Before
  it, four of the five states wrote nothing anywhere and a background sync against an unparseable
  feed was invisible forever (Invariant 4's shape in the sync path, and the one branch
  `icalFailureDetail` cannot see). `ics_sync_done` still means **"found changes"**, not "sync
  completed" — don't count it as a success rate. `provider` is on all three ics events now
  (`google`/`nursegrid`/`file`/`null`). Pinned by `tests/smoke.mjs` §27.
  **Field-verified 2026-10-04:** 20 rows in 48h, all `provider:'nursegrid'` — 19 `up_to_date` and
  one `changes`. The foreground re-sync makes `ics_sync_result` the dominant row in `events` from
  here on, so read funnel counts with that in mind.
  **The feed re-syncs on foreground, quietly** (2026-10-01): the cold-load sync runs once per page
  load, and a phone never page-loads, so a `visibilitychange` re-sync was added — throttled to
  `ICAL_RESYNC_MIN_MS` (10 min) and **quiet**, parking the plan in a banner rather than opening the
  import stepper. Never make it a modal: it fires when she returns to the app. The cold-load sync
  still opens the stepper. Pinned by `tests/smoke.mjs` §25.
  **The sync is now offered, not just available** (2026-10-01): it shipped 2026-09-03 and lived at
  the bottom of Settings behind a label that assumed a feed URL was already in hand — the owner's
  own first real sync took a hand-held walkthrough. A home-screen card ("Want to sync your
  NurseGrid calendar to load shifts?") opens a sheet carrying NurseGrid's six steps **in
  NurseGrid's own on-screen wording** (`Enable Calendar Sharing` → `Generate Nursegrid Calendar
  Feed` → worksite toggle → `Share` → `Copy`), with its own paste field wired to the same
  `onSaveIcalUrl` handler Settings uses. **The labels are the feature** — a rewrite into friendlier
  copy is a regression, which is why `tests/smoke.mjs` §26 mounts the sheet and asserts them off
  the rendered DOM rather than grepping the source. **No screenshots**: the publish set is exactly
  five files (Invariant 8), so an image would have to ride inline as base64 inside the file every
  visitor downloads, to illustrate a sheet most of them never open. The card is gated to a
  signed-in nurse with no subscription yet and one "Not now" retires it on that device
  (`scrubpay_ical_cta_dismissed` — cosmetic, deliberately not in the synced blob); Settings keeps
  the same walkthrough reachable for anyone who waved it off.
  **Time off defaults to "Not a shift"** (2026-10-03): NurseGrid puts vacation and unavailable
  days in the same feed as shifts, often as 24-hour blocks, and the stepper used to pre-select every
  card as a paid shift — Courtney's first sync priced 13 of them, 312 phantom hours. An entry that is
  all-day, ≥20h, or titled like time off (`ICS_OFF_TITLE_RE`; "holiday" deliberately excluded) now
  defaults to "Not a shift" on its own card. A default, not a filter: she still sees every card.
  Pinned by `tests/smoke.mjs` §29.
  **That default is forward-only, so the already-imported ones get a repair path** (2026-10-04):
  `longSyncedShifts` re-finds them from the *saved* blob — titles are never stored (Invariant 13)
  and `allDay` is not a field on a shift, so **duration is the only signal that survives an
  import**, at the same 20h floor and scoped to `icsUid`-bearing shifts so a long day she typed in
  herself is untouched. A dashboard card appears only while suspects exist and opens a sheet where
  "Not a shift" makes exactly the stepper's two `skip` writes (drop the shift, remember the uid in
  `icsIgnored`). **Never add a "remove all"** — a batch button on a list she has not read deletes
  shifts she actually worked. It shipped because the 10-03 claim that her 13 were "cleaned up by
  hand" was **false**: both her devices still reported `session_end {shifts:165}` eight hours after
  #145 deployed. Pinned by `tests/smoke.mjs` §32.
  **A feed's times are converted to the viewer's clock** (2026-09-28): a trailing `Z` is UTC and a
  `TZID=` names a zone, both converted; a bare value is floating per RFC 5545 §3.3.5 and left as
  written; an unknown zone falls back to as-written rather than dropping the shift. It did not used
  to — "no timezone math" was the written spec, which is correct only when a feed's times already
  sit in the viewer's zone. NurseGrid's do not, so every synced shift landed 4 hours late and the
  error surfaced as a wrong take-home figure. Pinned by `tests/smoke.mjs` §22, which sets its own
  `timezoneId` because CI runners are UTC, where the conversion is the identity.

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

## Ops dashboard (detail: `docs/project-notes.md` → Ops dashboard)

`/ops.html` is the live console (feedback inbox + Devices tab), gated by `is_ops_admin()` in
Postgres. The nightly also republishes the batched dashboard artifact
`https://claude.ai/code/artifact/1dc2d599-258e-4cd9-bf0c-8cc1f0ae3f0e` after GROOM
(`dashboard_snapshot.sql` → `.mjs`; carry the `db`+`downloads` capabilities forward). **Every
activation figure computed since 2026-09-07 is inflated** by harness and bot rows until the device
classifier is fixed — re-baseline before quoting one. Exclude Playwright's `iPhone OS 15_0` +
`Version/18.0` pair and `nostore-%` ids.

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
- **Agents merge their own PRs.** Open PRs to the deploy branch **ready (never draft)** and enable
  **auto-merge (squash)** in the same step — this overrides the platform's draft-PR default. Never
  ask the owner to merge; the two required checks are the gate. Exception: wage-core, schema or
  security changes wait for him, and the reply says so. (Owner decision, 2026-10-03.)
- Delete merged branches; never the open PR heads or the two protected branches (Invariant 11).
- **A merge is not a deploy, and since 2026-10-06 that has been literal.** Run **168** (`a64348b`,
  PR #150) has sat `status:"waiting"` with its one `deploy` job `waiting` since 2026-10-06 08:49:27
  — the status Actions uses for a **deployment protection rule** on the `github-pages` environment,
  which the job declares. Because `concurrency: group:"pages"` holds the group, everything merged
  behind it is stuck too: runs 169 and 170 `cancelled`, run 171 `pending` with zero jobs created.
  As of 2026-10-07 badgebudget.com serves the pre-#150 bytes and **four merged, green changes are
  unshipped**. Nothing in this repo can clear it.
  **The cause was read from the API on 2026-10-08 and it is NOT what the three nights before it
  guessed.** `GET /actions/runs/37438695953/pending_deployments` returns `wait_timer: 0` and
  `reviewers: []` — **no required reviewer, no wait timer**. So there is nothing to approve and no
  *Review deployments* button to press; the earlier advice in this file to approve it, or to remove
  a reviewer under Settings → Environments, was wrong and pointed at a control that does not exist.
  (The environments REST API is 403 through this session's proxy, which is why it stayed a guess
  for three nights; `pending_deployments` is an Actions path and is permitted — reach for that one.)
  It is an **orphaned pending deployment**: a run holding the `pages` concurrency group that can
  never start and can never be released. **The fix is to CANCEL run 168**, which frees the group;
  the next run then checks out the branch head and ships everything at once.
  **The structural fix is `cancel-in-progress: true`** on `deploy.yml`'s `pages` concurrency group.
  `false` (GitHub's starter default, written for busy repos with slow production deploys) makes any
  stuck run a permanent blocker of every deploy after it. With `true` the next merge cancels the
  holder and deploys itself, so a stall costs one cycle instead of all of them. What is given up is
  small here — the job is `cp` of five files plus the Pages upload, ~20s end to end, and anything
  interrupted is redone by the newer run seconds later. **Not yet applied:** editing a workflow file
  is blocked for agent sessions in this sandbox, so it needs the owner or an approved session. Written down here rather than left in `BACKLOG.md` because it is now a
  standing property of this repo's deploy path and it is **Invariant 9's blast shape arriving by a
  different door** — everything merged after that point sits unshipped while looking merged. Treat
  every merge as unshipped until a live check against badgebudget.com says otherwise; that step,
  not the green check, is what caught this.
  **Since 2026-10-08 that check is one command: `node scripts/deploy_watch.mjs`.** It replaces the
  per-change `curl … | grep -c <marker>` ritual, which only ever worked when you already knew which
  string was new, said nothing at all on a night that shipped no new string, and "passed" against
  the ~162-byte github.io redirect body. Because `deploy.yml` copies the publish set verbatim the
  served file is byte-for-byte a git blob, so the watch sha256s `index.html`, `privacy.html` and
  `ops.html` against the deploy branch's own history and reports which commit is live — `BEHIND`
  names it and counts the unshipped changes. `UNKNOWN_BUILD` is deliberately **not** green: a
  build it cannot place is a check that could not be established, the same rule `silence_watch`'s
  `UNKNOWN` encodes. It also checks `CNAME`, the one Invariant 8 failure that is a total outage
  rather than a stale page.

## Autonomous nightly loop

**Routine** `BadgeBudget nightly (fresh session, fail-loud)` — id `trig_016Q4eZdanDoaVWzydPcGKpZ`,
cron `0 8 * * *` UTC (≈04:0x ET), model pinned to `claude-opus-5`, **rebuilt 2026-09-20**. It fires
a **fresh session per run** and carries `notifications: {push, email}` at the Routine level. Its
prompt says to read this file and `BACKLOG.md` first, so keep both self-sufficient.

The Routine was rebuilt after its predecessor sat silently disabled for three days; the design
reasons (fresh session for Routine-level notifications, commit every night as the heartbeat, verify
against badgebudget.com, run the committed suites) are in `docs/project-notes.md` → Autonomous
nightly loop. It refuses wage core by name, never re-adds a swap-board CTA or "anonymously" copy,
skips a queue item that overlaps an open PR's region of `index.html`, and honours `DRY RUN` in the
fire input by stopping after the gate.

Each run is **groom → build → gate → deploy → notify**:

1. **Groom.** Read `feedback` + `events` (Supabase MCP `execute_sql`, or the Management API fallback
   below) and run `node scripts/silence_watch.mjs` — a gap in `events` is ambiguous between "no
   visitors" and "telemetry broken", and the groom hand-ran that distinction three nights running
   (09-23, 09-25, 09-26) before it was written down. Quote its verdict, not a guess. Review the app, add/reprioritize P0–P3 in `BACKLOG.md` with a one-line rationale, dedupe
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
   (`--force-with-lease`), PR to the deploy branch, squash-merge, then confirm live with
   `node scripts/deploy_watch.mjs` — a `LIVE` verdict, not a green check, is what counts as shipped.
   If push is denied, put `git format-patch` output in the summary rather than losing the work.
5. **Notify** — push + email fire from the Routine itself now; the run still ends with 1–2 lines
   saying what shipped (or why not) and the live-confirmation result.

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


## Harness hooks

`.claude/settings.json` runs `scripts/hooks/pre_push_gate.mjs` before any `git push` an agent
issues. It blocks (exit 2) unless HEAD contains `origin/claude/migrate-to-github-deploy-3F5RD`
(Invariant 10, fetched fresh — a failed fetch blocks too) and `scripts/check_build.mjs` passes.
A fresh container has no Babel, so the first push is blocked with the install line
(`npm install --no-save @babel/standalone@7.24.7`); run it and push again. Branch deletions pass
through. It sees only agent pushes; CI stays the binding gate.

## Supabase (detail: `docs/project-notes.md` → Supabase)

- Project `mnnlgcxnvodjwlhhiphq`, free tier, **the only project** — it holds real users' pay
  history, so audits and migrations run against production. Every table is RLS-enabled.
- `ops_admins` has RLS with **zero policies by design** — don't "fix" the advisor INFO by adding one.
  The `ops_*` functions must never appear in the advisor's `anon`-executable list.
- `ical-proxy` accepts the public anon key (`security-08`) — an open relay until the handler checks
  `role === 'authenticated'` (hardening session).
- MCP: `.mcp.json` runs `@supabase/mcp-server-supabase@0.13.0` over stdio with `SUPABASE_ACCESS_TOKEN`
  from the environment, **pinned and `--read-only`** (2026-10-01): every session can query
  production, none can write to it by accident. Read-only blocks writes, **not RLS bypass** — queries
  run as `supabase_read_only_user`, which is not a superuser but has `rolbypassrls` and
  `pg_read_all_data` (checked 2026-10-03: sees every `user_data` row), so they can't show what a user
  sees; use `scripts/ops_gate_probe.sql` for that. Writes (migrations, function patches) go through the Management API (`database/query`,
  `config/auth`, `advisors/*`) in a dedicated session; Node fetch needs
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Bump the pin deliberately.
- Re-read headroom figures before quoting them; old ones in the notes have drifted before.

## Testing (detail: the `harness` skill and `docs/project-notes.md` → Testing)

`node scripts/check_build.mjs` (gate), `node scripts/test_groom_seed.mjs` (33),
`node tests/smoke.mjs` (Playwright, iPhone 13). `tests/equality.mjs` is the wage-core check against
the **deployed** build — by hand only, needs network. Every new assertion is negative-tested. Scratch
copies point `SUPABASE_URL` at `.invalid` so the harness can never write to production analytics.
Not in git: the swap-matching suite and `rls_audit.js`, so those Done-log figures are unreproducible.

## Open items

`BACKLOG.md` is the work queue. The older narrative list (agent gateway, scaling, open PRs, merged
branches to delete, consent-screen payoff) is in `docs/project-notes.md` → Open items.
