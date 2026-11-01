# Inbox

Where an idea or off-plan work lands until the chief of staff gives it an outcome: **attach** (to a
thread), **park** (one line, why), or **swap** (proposed to Pat as a thread replacement). One line
each. Format: `- YYYY-MM-DD · source · what · → outcome`. Source is `session <title>`, `commit <sha>`,
`pat`, or a seat name. An item with no outcome after 7 days is listed in the brief.

## Open

(none — the 2026-11-01 cabinet gave all 21 an outcome; the full nightly write-ups are in
`BACKLOG.md` → Done log and in this file's git history at `bb1d8f1`)

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
