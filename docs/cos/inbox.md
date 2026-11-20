# Inbox

Where an idea or off-plan work lands until the chief of staff gives it an outcome: **attach** (to a
thread), **park** (one line, why), or **swap** (proposed to Pat as a thread replacement). One line
each. Format: `- YYYY-MM-DD · source · what · → outcome`. Source is `session <title>`, `commit <sha>`,
`pat`, or a seat name. An item with no outcome after 7 days is listed in the brief.

## Open

- 2026-11-20 · nightly · **the publish set ships six SRI-pinned scripts and the gate counted
  five** — `ops.html` loads supabase-js with its own `integrity` attribute, a second copy of the
  app's pin on the same origin, and nothing read it. Three of four measured edits left the gate
  green, including **deleting the attribute outright**, which is the one that fails open: a third
  party's JavaScript then executes unverified in the origin that holds `user_data` and the auth
  session. Gated as identity against `index.html`'s row (url + hash), five breaks, a third GREEN,
  no bad hash found. **Also tonight, and the bigger item for the committee:** Courtney's second
  load landed 11-19 18:13 and gave the first production reading of #219's sync-plan counts —
  feed **107**, plan **50**, **7 cards**. Every judgement in the repo about how heavy that sheet
  is was made off the feed count and was off by one to two orders of magnitude. She spent 41
  seconds on a seven-tap sheet and imported nothing, for the fourth load running, and still has
  not taken either sync opt-out. That is a product question, not a nightly one — belongs with T3
  or a dedicated session.

- 2026-11-19 · nightly · **the gate printed the word `self-contained` for `privacy.html`, and the
  word was a regex over two attribute spellings of one scheme** — that property is the whole
  reason the page ships with **no CSP at all**, and it backs the URL on the Google OAuth consent
  screen. Four realistic edits were measured against the old clause and all four left the gate
  printing `All 21 mechanical checks passed`: a `@font-face` webfont through CSS `url()`, an
  `@import` of a third-party stylesheet, a **single-quoted** `<script src='https://plausible.io/…'>`
  — an analytics script on the privacy notice, with no CSP to block it — and a protocol-relative
  tracking pixel. It now walks the content: every attribute the browser fetches (any quoting, any
  scheme; `<a href>` exempt, because a link is a navigation), every `url()`/`@import` in its CSS,
  no `<script>`/`<iframe>`/`<object>`/`<embed>` tag at all, and an anti-vacuity floor. No remote
  reference was found, so it is a regression guard. · **three for the chief of staff:** (a)
  **thirteenth consecutive night** on the one repo-wide shape — a printed claim that covers less
  than it says — and tonight's instance had no number in it at all, just a word, which is the
  cheaper kind to let stand; (b) the meta-test gained its **first two GREENS**: assertions that an
  ordinary edit must leave the gate *green*, because a false positive gets a check **weakened** by
  whoever meets it, and the first is justified on a measurement (a walk that counts `<a href>` as
  a fetch passes today's clean page, so the clean baseline cannot see it) — worth copying to the
  other suites; (c) **CABINET MISSED fires for the tenth night** with the brief at **18.3 days**
  against an 8-day switch, `docs/cos/now.md` still says *Updated 2026-11-02* — **seventeen
  days** — and the queue has had no unblocked build item that does not need Pat for **thirteen**
  nights, three blockers still being one-line workflow edits waiting on one visit. · → outcome
  pending

- 2026-11-18 · nightly · **the worker check now covers the bytes production serves, not just the
  ones in the repo** — last night's §62 proved the *committed* `pdf.worker.min.js` is npm's pinned
  build and stated plainly that it never fetches badgebudget.com; the live half was **one hand-run
  `curl`, one night, nothing re-checking it**. `deploy_watch.mjs` had excluded that file since it
  was written, behind a scope line reading *"a megabyte, and it has never changed"* — the same
  sentence as "nothing has read a byte of the copy real users execute". It is the fourth hashed
  file now, so the chain **npm's build = the committed file = what production serves** is closed
  at both ends on every nightly. Measured live: 1,087,212 bytes, identical, no bad byte. A second
  finding fell out: every file was hashed from `await res.text()`, so the comparison was of a
  **re-encoding of a decode** of the response (live worker 1,087,212 bytes vs 1,087,181
  characters; index.html 579,910 vs 578,622) — all four read as bytes now, and the risk that
  removes is a false `UNKNOWN_BUILD`, never a false `LIVE`. 23 assertions in a suite CI runs
  (98 → 121), eight measured breaks. · **three for the chief of staff:** (a) **twelfth
  consecutive night** on the one repo-wide shape — a printed word that counts less than it claims
  — and tonight's was *last night's own deferral*, which is the queue working rather than a new
  coincidence; (b) the queue has had **no unblocked build item that does not need Pat for twelve
  nights**, and three of the blockers are still **one-line workflow edits waiting on one visit**
  (the gate meta-test, the dashboard-snapshot suite, #209's `cp terms.html _site/`); (c)
  **CABINET MISSED fires for the ninth night** with the brief at **16.8 days** against an 8-day
  switch, and `docs/cos/now.md` still says *Updated 2026-11-02* — **sixteen days**, un-updated
  for the thirteenth night because #209 rewrites T2's whole block. · → outcome pending

- 2026-11-17 · nightly · **the last script in this app that ran with no integrity check of any
  kind now has one** — the gate printed `worker agrees` for `pdf.worker.min.js`, and "agrees" was
  **two substrings read out of 1,087,212 bytes**: pdf.js's own version guard and the literal
  `"3.11.174"`. Nothing in this repo had compared the shipped worker to the build its pin names.
  `pdfjs-dist` ships a **same-version** `legacy/build/` worker that carries both strings, differs
  by **46,448 bytes**, and leaves the gate printing `All 21 mechanical checks passed` — measured,
  not argued, and it passes §10's real-PDF drive too because the legacy worker *works*.
  `tests/smoke.mjs` §62, ten assertions, six measured breaks, four of which leave the gate green.
  No bad byte was found: this is a regression guard like §54, not a fix. · **three for the chief
  of staff:** (a) **eleventh consecutive night** on the one repo-wide shape — a printed number or
  word that counts less than it claims — and tonight it was the *same* `[2]` check band §60
  corrected 48 hours earlier, one file over, which is the strongest argument yet that this is a
  systematic property of how checks get written here rather than a run of coincidences; (b) the
  queue has had **no unblocked build item that does not need Pat for eleven nights** — every one
  of those nights has been filled by this audit search, which is productive but is not the plan,
  and three of the blockers are **one-line workflow edits waiting on one visit** (the gate
  meta-test, the dashboard-snapshot suite, #209's `cp terms.html _site/`); (c) **CABINET MISSED
  fires for the eighth night** with the brief at **15.8 days** against an 8-day switch, and
  `docs/cos/now.md` still says *Updated 2026-11-02* — the one page Pat is meant to read is
  **fifteen days stale**, un-updated for the twelfth night because #209 rewrites T2's whole block.
  · → outcome pending

- 2026-11-16 · nightly · **the FIRST item here with a live-user trigger, not a file audit — needs
  Pat's eyes more than the chief of staff's** — **Courtney loaded the app at 2026-11-15 23:23 UTC,
  26 days after her last visit, and was gone in 4 seconds.** Cold load, the stepper opened on a
  feed that found changes (`ics_sync_done {events:109}`), `session_end {secs:4, shifts:69}`, zero
  imports. Two things make it the first load worth reading rather than counting: (a) it is her
  **first ever load of a build carrying either sync opt-out switch** (banner 10-21, stepper
  10-22), so `ics_autosync_pref`'s zero rows have stopped being fully expected; (b) the first
  proxy call did **not** `422` this time, which is evidence against the HTML-interstitial
  hypothesis the P2 has been waiting on. · tonight's build is the thing that makes the next such
  load readable: `ics_sync_done` reported the size of the **feed** and six places in the repo read
  it as the size of the **plan**, which a 2026-10-10 `ics_import_done {shown:6, skipped:46}`
  against `events:127` disproves outright — 52 items, not 127. The row now carries
  `pending`/`cards`/`classify`/`updates`/`removals` (`tests/smoke.mjs` §61, 17 assertions, eight
  measured breaks). · **three for the chief of staff:** (a) **tenth consecutive night** on the
  same repo-wide shape — a printed number counting something other than what it is read as — and
  this is the first time that shape cost a *product* judgement rather than a test claim, which is
  the argument for naming it as a pattern; (b) resist the temptation to redesign the cold-load
  door off one 4-second visit — the number that would justify it does not exist for her yet;
  (c) **CABINET MISSED fires for the seventh night** (`brief.md` 15.0 days) and `now.md` is
  fourteen days stale because #209 rewrites T2's block — the fourteenth filing of the same
  decision: gate the build on an over-age brief, or retire the claim. · → **open**

- 2026-11-15 · nightly · **belongs to no thread — park or file as a standing CTO item** —
  Invariant 2's gate counted five `integrity` ATTRIBUTES and printed `5/5 pinned + hashed`;
  nothing had ever read a byte of those five CDN files, and the smoke suite strips every
  `integrity` attribute by construction. A hash copied from the wrong row is a total silent
  outage — the script never runs, the watchdog screen shows, and `Detect: none`. Now
  `tests/smoke.mjs` §60: four of five pins verified against the bytes npm ships, the fifth
  exempt with its exemption asserted (jsDelivr generates `supabase.min.js`). 23 assertions,
  twelve measured breaks. **Ninth consecutive night of the same repo-wide shape** — a true
  sentence with no mechanism under it, and a printed number that was counting something else.

- 2026-11-14 · nightly · **belongs to no thread — park or file as a standing CTO item** —
  Invariant 5's gate was a hardcoded list of six key literals printing `6/6 intact`; the app uses
  **eight**. The set is now derived by an AST walk (eight clauses, seven new breaks, measured both
  directions; suite 55 → 62). The two keys it found are cosmetic dismissal flags — the finding is
  that the gate could not have found them. **One real load-bearing catch inside it:** the `::` in
  `nursingWagePlannerData::<uid>` had never been checked, and a changed separator orphans every
  signed-in user's failed-save backup. · **two things for the chief of staff:** (a) this is the
  **fourth consecutive night** on the same class of defect — a true sentence with no mechanism
  under it (11-11 publish set, 11-12 suite roster, 11-13 RLS clause, tonight the key list) — which
  is worth naming as a pattern rather than fixing one file at a time; (b) **CABINET MISSED fires
  for the fifth night** (`brief.md` 13.0 days) and `now.md` is twelve days stale because #209
  rewrites T2's block — the twelfth filing of the same decision: gate the build on an over-age
  brief, or retire the claim. · → **open**

- 2026-11-13 · nightly · **attaches to T2 `legitimacy`** — Invariant 13's RLS clause had no
  mechanism and, by its own `Verify` line, no reproducible check at all (`rls_audit.js` is not in
  git). It decides whether the iCal feed URL — a bearer credential — is readable by the public
  anon key in `index.html`, and a leak there is silent by construction. New
  `scripts/access_watch.mjs` reads the production catalog and grades 16 rules across
  `ical_subscriptions`, `user_data`, `events`, `feedback`, `ops_admins` and the five `ops_*`
  functions; classifier is `tests/smoke.mjs` §59 (27 assertions, eight measured breaks), put in
  the suite CI runs rather than a fourth orphan suite. **First run: TIGHT, 16/16 — the clause
  holds, which nothing in this repo had ever established.** · **three things for the chief of
  staff:** (a) one real finding to route — `anon` holds **TRUNCATE** on `user_data` and the swap
  tables, and TRUNCATE escapes RLS, so the only control today is that PostgREST has no route to
  it; the fix is a one-line revoke but it is production DDL and needs a dedicated session (Risk
  seat); (b) **CABINET MISSED fires for the fourth night** (`brief.md` 11.6 days) and the
  dead-man's-switch decision is now **eleven** nights unanswered — tonight's build is the third
  consecutive instance of the same class, a true sentence with no mechanism under it, so the
  pattern is the finding; (c) PR #209 is **7.3 days** open and has blocked `docs/cos/now.md` for
  an **eighth** night — the one page Pat reads still says "Updated 2026-11-02".

- 2026-11-12 · nightly · belongs to no live thread (T1/T2/T3) — a test-coverage fix of the same
  class as the last two nights, one suite over: `tests/smoke.mjs` ended with
  `==== smoke: 922 passed / 0 failed ====` and **nothing had ever compared that number to what was
  supposed to run**, so a deleted `if (want(n))` guard, a renumbered section, or a `SMOKE_ONLY`
  leaked into the environment all exit 0 with whole sections never run. That is the hole
  `check_build.mjs` closed for itself on 2026-10-27, still open in the suite CI actually binds on.
  New section 58: a hand-declared roster of 57 sections, run outside `want()`, failing if a section
  never ran, if a section ran and asserted **nothing**, or if the roster and the file's own guards
  disagree either way. Suite 922 → 935, six measured breaks. · **two things for the chief of
  staff:** (a) **CABINET MISSED fires for the third night** (`brief.md` 10.8 days) and the
  dead-man's-switch decision has now been filed unanswered **ten** nights — which tonight's build
  makes concrete rather than rhetorical: a mechanism that only prints a line is the exact defect
  just fixed in two suites, and this one is still open; (b) PR #209 is **6.3 days** open, its CI is
  **red on purpose** since last night's check named `terms.html`, and it has blocked
  `docs/cos/now.md` for a **seventh** consecutive night — the one page Pat reads still says
  "Updated 2026-11-02", ten days stale, because a PR needing two one-line owner edits is sitting
  unmerged.

- 2026-11-11 · nightly · touches T2 but is not T2 work — a deploy-correctness gate: Invariant 8
  asserted the publish set is *exactly* five files and never that those five are **enough**, so a
  published page could link to a file `deploy.yml` never copies. New `check_build.mjs` check 21
  (roster 20 → 21, meta-test 51 → 55, four measured breaks), and the `[8]` tag — shared by two
  checks since 2026-09-13 with *neither* break pinning a label — is pinned now. · **two things for
  the chief of staff:** (a) **PR #209's CI is now red, correctly**: it adds a Settings link to
  `terms.html`, copies the file into the harness tree, and never adds it to the publish set, so
  merging it as it stands ships a 404 on a legal page. The fix is two lines, both Pat's tier (`cp
  terms.html _site/` in the workflow, which agents cannot edit, plus `'terms.html'` in the gate's
  `expected`), and that makes **three** one-line workflow edits now waiting on one visit from him —
  the other two being the gate meta-test and the dashboard-inventory suite; (b) **CABINET MISSED
  fires for the second night** (`brief.md` 9.8 days) and #209 has blocked `docs/cos/now.md` for a
  **sixth** consecutive night — the one page Pat reads still says "Updated 2026-11-02", nine days
  stale. Nine nights of filing the same dead-man's-switch decision unanswered is the answer to
  whether a notify line is a mechanism.

- 2026-11-10 · nightly · belongs to no live thread (T1/T2/T3) — a gate-coverage fix: last night's
  event-inventory rewrite shipped its regress guard in `scripts/test_dashboard_snapshot.mjs`, a
  suite **CI does not run**, so "simplify this back to a grep" would have been caught by nothing on
  a PR. Moved behind `check_build.mjs` as check 20 (roster 19 → 20, meta-test 46 → 51, five
  measured breaks). Found and closed a pre-existing hole on the way: `events` is now a shared tag
  and its two older breaks had no label pin, so a break failing the *wrong* row counted as a win —
  the exact defect the 10-30 run fixed for the `[2]` band, quietly reappeared. · **two things for
  the chief of staff:** (a) **CABINET MISSED fires tonight** — `brief.md` is 8.8 days old, the
  first firing since the 11-01 cabinet, and the decision it was meant to force (*gate the build on
  an over-age brief, or retire the dead-man's-switch claim*) has now been filed unanswered eight
  nights running; a notify line that has never once changed anyone's behaviour is not a mechanism;
  (b) PR #209 is **4.3 days** open and has blocked `docs/cos/now.md` for a **fifth** consecutive
  night — the one page Pat reads says "Updated 2026-11-02", eight days stale, because a mergeable
  PR is sitting unmerged. Saying so four times has not merged it.

- 2026-11-09 · nightly · belongs to no live thread (T1/T2/T3) — an observability fix with a
  doc correction attached: the ops dashboard's event inventory was a grep that could not see four
  of the app's `track()` shapes, so `dead_events` — *which shipped feature has nobody touched* —
  **structurally could not name the telemetry of the raise (#187) or dated pay items (#191)**, the
  two newest money features, both of which have zero rows. Four firing names (`ob_view`,
  `ob_answer`, `ob_back`, `session_end`) were also outside the list. Now an AST walk; 63 names, was
  55; new suite `scripts/test_dashboard_snapshot.mjs` 44/0, nine breaks measured. · **two things
  for the chief of staff:** (a) this closes a claim BACKLOG.md carried for **six nights** — that
  the raise shipped with no telemetry — which was false from the start and survived because it was
  checked with the same grep whose blind spot was the subject; worth one line in the brief on
  re-checking a premise, not just an overlap; (b) PR #209's review has now blocked
  `docs/cos/now.md` from being updated for **four consecutive nights** (it still says "Updated
  2026-11-02"), so the one page Pat reads is seven days stale because a mergeable PR is sitting
  unmerged — that is a decision, not a chore.

- 2026-11-06 · nightly (second run of the day) · belongs to no live thread (T1/T2/T3) — a tooling
  honesty fix: `deploy_watch.mjs` named a commit it could not know for **eight consecutive
  nights** (`privacy.html`/`ops.html` reported as "serving" a drifting 2026-10-08/09 commit, for
  files unchanged since 2026-09-24), because containers here clone **shallow** and a shallow
  boundary commit looks to `git log` like the commit that added every file in its tree. Verdict
  was always right; the attribution never was. Shipped tonight, `scripts/test_deploy_watch.mjs`
  98/0, seven breaks measured. · **two things for the chief of staff:** (a) PR #209's open review
  was nearly force-pushed over by the loop's shared working branch — tonight dodged it with a
  per-session branch, but the standing rule is Pat's call; (b) eight nights of a known-false
  figure being re-explained in prose rather than fixed is the same shape as the CABINET MISSED
  line under-reporting for thirteen — worth one decision covering both.

- 2026-11-03 · nightly · belongs to no live thread (T1/T2/T3) — an observability fix: since #191
  crossed Babel's 500,000-byte inline-script threshold on 2026-11-01, **every load filed a
  `client_error` row** carrying a benign Babel formatting note, which is the only channel that
  fires on a real fault (Invariant 4's 23505s, Invariant 2's blocked CDN script). Shipped tonight,
  filtered at the mirror, `tests/smoke.mjs` §57. · **for the CTO seat if it wants a standing
  item:** a feature-sized commit silently broke the fault channel and nothing but a groom's
  fifteen-night flat reading caught it — worth deciding whether that reading should be a check
  rather than a habit.

## Parked

- 2026-10-12 · cos · status page with a phone capture box (artifact + `db`) · → park: build after
  the first cabinet proves the brief is worth reading; until then capture is `/cos <idea>`.
- 2026-10-12 · cos · gate check that a diff inside `@core` regions is number-moving unless the
  equality check is green · → attach: CTO queue item 1 (failure mode 6 in the pre-mortem).

Outcomes given at the 2026-11-01 cabinet:

- 2026-11-01 · session BadgeBudget nightly · harness must test the pins the app ships (#205) ·
  → park: shipped. Its second point — nine nights with no buildable `## Queue` item — → attach: D4.
- 2026-10-31 · session BadgeBudget nightly · pdf.js worker must match its pin (#204) · → park:
  shipped. Its question (should an over-age brief fail the gate?) → closed: no — the switch fired
  correctly every night; the cause was the cabinet routine's missing push access (brief, red flag 2).
- 2026-10-30 · session BadgeBudget nightly · CSP must cover every loaded host (#203) · → park: shipped.
- 2026-10-29 · session BadgeBudget nightly · .ics parser keeps no titles, gated (#202) · → park: shipped.
- 2026-10-28 · session BadgeBudget nightly · URL paths redacted from `client_error` (#201) · → park:
  shipped; spot-checked live at the 11-01 cabinet.
- 2026-10-27 · session BadgeBudget nightly · the gate's own roster + meta-test (#200) · → park:
  shipped; the one-line `ci.yml` addition still waits on Pat (agents cannot edit workflows).
- 2026-10-26 · session BadgeBudget nightly · Invariant 13 feed-URL guard (#199) · → park: shipped.
- 2026-10-25 · session BadgeBudget nightly · discover Chromium instead of pinning it (#198) · → park: shipped.
- 2026-10-24 · session BadgeBudget nightly · .ics round-trip test, §52 · → park: shipped.
- 2026-10-23 · session BadgeBudget nightly · 320pt wordmark P3 withdrawn, assertion restored · → park: done.
- 2026-10-22 · session BadgeBudget nightly · manual-sync opt-out on the import stepper · → attach:
  brief red flag 1 — `ics_autosync_pref` has 0 rows ever; she went quiet 10-20.
- 2026-10-21 · session BadgeBudget nightly · manual-sync opt-out on the re-sync banner · → attach:
  brief red flag 1, same evidence.
- 2026-10-20 · session BadgeBudget nightly · §30 font-dependent assertion replaced · → park:
  superseded by 10-23.
- 2026-10-19 · session BadgeBudget nightly · `deploy_watch` fetches before judging · → park: shipped.
- 2026-10-18 · session BadgeBudget nightly · empty-day save fix, §48 · → park: shipped; device
  classifier stays in `BACKLOG.md`.
- 2026-10-17 · session Courtney's raise · effective-dated rates · → attach: T3; merged as #187 (D2).
- 2026-10-17 · session BadgeBudget nightly · paystub empty-parse counted · → park: shipped.
- 2026-10-16 · session BadgeBudget nightly · manual-sync switch in Settings · → park: shipped.
- 2026-10-15 · session BadgeBudget nightly · deleted synced shift remembers its uid · → park: shipped.
- 2026-10-14 · session BadgeBudget nightly · paystub photo refusal · → park: shipped; her two
  wording notes are in `BACKLOG.md` → Queue.
- 2026-10-13 · session BadgeBudget nightly · paystub worker failed 3× on a real phone · → park: no
  `paystub_failed` row since 10-13 (query at 11-01 cabinet); reopen on the next one.
