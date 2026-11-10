# Inbox

Where an idea or off-plan work lands until the chief of staff gives it an outcome: **attach** (to a
thread), **park** (one line, why), or **swap** (proposed to Pat as a thread replacement). One line
each. Format: `- YYYY-MM-DD · source · what · → outcome`. Source is `session <title>`, `commit <sha>`,
`pat`, or a seat name. An item with no outcome after 7 days is listed in the brief.

## Open

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
