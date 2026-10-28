# Inbox

Where an idea or off-plan work lands until the chief of staff gives it an outcome: **attach** (to a
thread), **park** (one line, why), or **swap** (proposed to Pat as a thread replacement). One line
each. Format: `- YYYY-MM-DD · source · what · → outcome`. Source is `session <title>`, `commit <sha>`,
`pat`, or a seat name. An item with no outcome after 7 days is listed in the brief.

## Open

- 2026-10-28 · session BadgeBudget nightly · Invariant 13's "never goes into `events`" clause was
  held at ONE call site: `icalFailureDetail` guards the sync log, but every `console.error` in the
  app is mirrored into the ring buffer that `flushClientErrors` ships to `events`, and only money
  was scrubbed. `redactUrlPaths` now sits beside `redactMoney` at that choke point — a URL keeps
  its scheme and host, loses its path/query/fragment, so Invariant 2's "which host failed" signal
  survives. No live leak found; this is a regression guard. `tests/smoke.mjs` §54 (14, 883 total),
  falsifiable both ways, four measured breaks. Belongs to no live thread.
  Three groom findings worth a seat, two of them outranking the build: **PR #191 no longer merges**
  (four conflicts incl. `tests/smoke.mjs`, unnoticed seven nights because five grooms read hunk
  numbers instead of running the merge — standing rule is now `git merge-tree --write-tree`);
  **the publish-set commit name has been wrong four nights running including the 10-27
  "correction"** (`41d2549` is on no ref; `git log -1 -- <file>` resolves against the container's
  HEAD — name the ref, or trust `deploy_watch`, which was right every night); and **CABINET MISSED
  is at nine nights**, brief 16.0 days old, next Sunday 2026-11-01 · → outcome pending

- 2026-10-27 · session BadgeBudget nightly · the deploy gate had no gate: deleting any `check()`
  call printed a smaller number and exited 0, so the invariant it held went unguarded with no
  signal anywhere. `check_build.mjs` now holds its own roster (check 16 of 16, red in CI today) and
  `scripts/test_check_build.mjs` (23) proves it has teeth with one deliberate break per check —
  justified by the measurement that a gate with `must()` neutered still prints "All 16 passed" and
  only the breaks catch it. Invariant 6's third hole closed in the same pass, as its note asked.
  Belongs to no live thread. Three groom findings worth a seat: **`events` took zero new rows in
  24h** — the first flat night in the file, and `FRESH` is 31.7h into its 48h window, so the next
  run may read `SILENT`; **the new suite needs one line in `ci.yml`** that only Pat can add, since
  editing a workflow is blocked for agent sessions; and **CABINET MISSED is at eight nights**, two
  Sundays gone, next 2026-11-01 · → outcome pending

- 2026-10-26 · session BadgeBudget nightly · Invariant 13 ("the iCal feed URL is a bearer
  credential") had no mechanical guard at all, against a failure mode its own Detect trailer calls
  silent by construction — the gate now fails on a feed field entering `serializeState` and on any
  `console.*` in `ical-proxy` (four breaks + a false-positive control), with the other three
  clauses still declared human-held. Belongs to no live thread, though it is adjacent to T2
  `legitimacy`. Two groom findings worth a seat: **`check_build.mjs` has no meta-test**, so
  deleting any of its fifteen checks is invisible to everything in this repo (next run's build
  item), and **CABINET MISSED is at seven nights** — the 10-25 Sunday passed without one, so two
  Sundays have now gone by · → outcome pending

- 2026-10-25 · session BadgeBudget nightly · the test rig's three Playwright entrypoints each
  pinned a browser path that no longer exists in this container, which kills the suite with a
  **harness error** — the gate reads un-run rather than red — so the browser is discovered now
  (`chromiumLaunch`, `tests/smoke.mjs` §53, nine breaks). Belongs to no live thread. Two groom
  findings worth a seat: the **Queue is out of unblocked build items** (its one candidate blocked
  by PR #191 for a sixth night), and **CABINET MISSED is at six nights with today being the
  Sunday** · → outcome pending

- 2026-10-24 · session BadgeBudget nightly · Invariant 6 (the `@scrubpay` .ics sentinel) had no
  round-trip test, as its own Verify trailer said — now pinned by `tests/smoke.mjs` §52, six breaks,
  two of my own assertions deleted as unfalsifiable. Belongs to no live thread; the groom finding
  worth a seat's attention is that the **Queue had no unblocked build item**, its one candidate
  blocked by PR #191 for a fifth night · → outcome pending

- 2026-10-13 · session BadgeBudget nightly · paystub import failed 3x on a real phone — the pdf.js
  worker would not load; message + tracking fixed, the worker's own failure is still unexplained ·
  → outcome pending
- 2026-10-14 · session BadgeBudget nightly · a real nurse tried a PHOTO of a paystub; refusal named
  the rule not the remedy and tracked nothing — fixed + countable. Her two other notes (make the
  import approval "more alarming", "save changes" not "add shift") are queued, not built ·
  → outcome pending
- 2026-10-15 · session BadgeBudget nightly · deleting a synced shift never recorded its uid, so the
  NurseGrid feed re-proposed it on every sync — the bug under her "put the sync on a button" ask;
  fixed + countable. The toggle itself, and her pre-tonight rejected uids, are still open ·
  → outcome pending

- 2026-10-16 · session BadgeBudget nightly · the manual-sync switch she asked for twice in 28 hours
  shipped (`syncManualOnly`, Settings, default off) — closing the 10-14 build order. Her shift count
  fell 109 → 67 on 10-14, which is the raise/effective-dated-rate item costing her her own history ·
  → outcome pending

- 2026-10-17 · session BadgeBudget nightly · the paystub modal Courtney actually hit — a parse that
  SUCCEEDED and found nothing — rendered a dead end and tracked nothing, so her 10-14 `broken`
  report read as a file-picker block; now `paystub_failed {reason:'empty'}`. Quiet groom otherwise:
  no new feedback, no events in 24h, `silence_watch` FRESH · → outcome pending

- 2026-10-18 · session BadgeBudget nightly · emptying a day in the shift sheet silently put a
  12-hour shift back on it, and the button she asked about ("save changes", not "add shift") was
  the same two taps — both fixed in one push, §48. Groom: every event in 48h is crawler-shaped and
  no iPhone has opened the app since 10-15, so the device classifier is now the blocker on every
  landing-screen figure · → outcome pending


- 2026-10-19 · session BadgeBudget nightly · the deploy watch could print `LIVE` against a clone it
  had not fetched — it now refreshes the deploy ref first and degrades to `UNKNOWN_BUILD` when it
  cannot, so a false all-clear is no longer reachable from the one check the ship ritual trusts.
  Tooling, under no thread. Groom: zero new events and zero new feedback since 10-18, no iPhone in
  four days, `silence_watch` FRESH, `deploy_watch` LIVE · → outcome pending

- 2026-10-20 · session BadgeBudget nightly · §30's "the wordmark is not ellipsised" assertion was
  measuring whichever font had resolved — three CI cycles on a coin flip, and the red runs were the
  truthful ones: the wordmark really does clip at 320pt with the real face. Replaced with a
  font-independent floor on the row the wordmark is given; the cosmetic CSS fix is filed as P3 with
  measured pixels, unbuilt because this sandbox cannot render the face that clips. Tooling, under no
  thread. Groom: third consecutive byte-identical `events` table, `silence_watch` SILENT_BUT_HEALTHY
  (53.9h, out of its 48h window — quiet, not broken), `deploy_watch` LIVE on `a103682`, and
  **CABINET MISSED** — `brief.md` turned 8.0 days old tonight · → outcome pending

- 2026-10-21 · session BadgeBudget nightly · the manual-sync switch Courtney asked for twice, and
  which shipped 10-16 into Settings, has **never been turned on by anyone** — her first three loads
  since (2026-10-20) were three more 125-event `changes` syncs with zero imports. Not a broken
  toggle, an unreachable one: it is now offered on the re-sync banner in the Settings switch's own
  words, §50. The import stepper half is filed P1. Groom: `silence_watch` FRESH (9.1h, a real
  person came), `deploy_watch` LIVE on `a103682`, no new feedback, no new `client_error` from three
  real loads, landing-only cohort 11 → 14, and **CABINET MISSED** (brief 9.0 days old, second
  night) · → outcome pending

- 2026-10-22 · session BadgeBudget nightly · the manual-sync opt-out now sits on the import stepper's
  confirm card too — the cold-load door, which was 2 of Courtney's 3 loads on 10-20, where the
  10-21 banner could never reach her. Same wording, same field, `src:'stepper'`. It deliberately
  does NOT dismiss the sheet (the banner's copy does), so a tap meaning "stop asking" never costs
  her the plan · → outcome pending

## Parked

- 2026-10-12 · cos · status page with a phone capture box (artifact + `db`) · → park: build after
  the first cabinet proves the brief is worth reading; until then capture is `/cos <idea>`.
- 2026-10-12 · cos · gate check that a diff inside `@core` regions is number-moving unless the
  equality check is green · → attach: CTO queue item 1 (failure mode 6 in the pre-mortem).

- 2026-10-17 · session Courtney's raise (dedicated wage-core) · effective-dated rates built ("New
  rate from [date]"), plus a Settings fix: a rate typed and closed without a blur was discarded.
  BACKLOG's "a shift stores its own rate" was false; the 109 → 67 drop is better explained by her
  deleting mis-coded synced shifts. PR waits for Pat (moves figures) · → outcome pending

- 2026-10-23 · session BadgeBudget nightly · a queued P3 ("the wordmark is clipped on a 320pt
  phone") was withdrawn, not built: its blocker — "this sandbox can't load the real font" — is
  false, and with the font loaded the wordmark has 22px of slack, so the proposed 11px fix was a
  regression. The removed ellipsis assertion is restored, now webfont-guarded and deterministic ·
  → outcome pending
