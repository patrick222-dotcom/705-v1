# Inbox

Where an idea or off-plan work lands until the chief of staff gives it an outcome: **attach** (to a
thread), **park** (one line, why), or **swap** (proposed to Pat as a thread replacement). One line
each. Format: `- YYYY-MM-DD · source · what · → outcome`. Source is `session <title>`, `commit <sha>`,
`pat`, or a seat name. An item with no outcome after 7 days is listed in the brief.

## Open

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


## Parked

- 2026-10-12 · cos · status page with a phone capture box (artifact + `db`) · → park: build after
  the first cabinet proves the brief is worth reading; until then capture is `/cos <idea>`.
- 2026-10-12 · cos · gate check that a diff inside `@core` regions is number-moving unless the
  equality check is green · → attach: CTO queue item 1 (failure mode 6 in the pre-mortem).

- 2026-10-17 · session Courtney's raise (dedicated wage-core) · effective-dated rates built ("New
  rate from [date]"), plus a Settings fix: a rate typed and closed without a blur was discarded.
  BACKLOG's "a shift stores its own rate" was false; the 109 → 67 drop is better explained by her
  deleting mis-coded synced shifts. PR waits for Pat (moves figures) · → outcome pending
