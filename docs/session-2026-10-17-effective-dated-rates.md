# Session 2026-10-17 — Courtney's raise (effective-dated rates)

Dedicated wage-core session (Invariant 3). Spec: `docs/effective-dated-rates-spec.md`.
Pre-flight: `git fetch` then `node scripts/deploy_watch.mjs` → **LIVE**, serving `cf75064`, the
deploy branch head. Branch cut from `origin/claude/migrate-to-github-deploy-3F5RD`.

## 1. Diagnosis — what her report could and could not be

**Correction first.** `BACKLOG.md` said *"a shift stores its own rate at entry"*. False: no shift
carries a rate. One App-level `baseRate` priced every shift (`periodPaycheck`, `statOf`,
`ptoStatOf`, the year view, the Add-Shift preview, `activeJob`), and nothing memoizes a stale
figure — every one of those reads `baseRate` with it in its dependency list. A rate change that
lands therefore re-prices every shift at once, worked ones included.

| Candidate | Verdict | Evidence |
|---|---|---|
| Two devices, whole-blob last-writer-wins putting the old rate back | **Ruled out for 10-14** | `events` for her `user_id`: three `anon_id`s ever; on 2026-10-13/14 only `f184ffa5` wrote anything. The other, `592667f1`, was last seen **2026-10-04**. |
| A surface pricing from something other than `baseRate` | **Ruled out** | Read every pricing call site; templates, patterns and differentials carry no rate; `job.baseRate` is built from the same state. |
| The rate field not committing | **PROVEN in the harness, fixed** | `NumInput` commits on blur only, and React never delivers `onBlur` to a component being unmounted. Closing Settings with the field still focused (an `el.click()` on the X — what a WebKit tap does, since WebKit does not focus a tapped `<button>`) left `baseRate` at 48 and the hero at $467 instead of $561. A real Playwright click focuses the button first, which is why §1 never saw it. |
| The deletions (109 → 67) were caused by the raise | **Likely wrong** | Her 08:03 note (*"I was not careful with which dates got pulled over"*) and 08:55 note (*"Once I deleted shifts that were not coded properly on BB"*) bracket the deletions; the raise wish came at 08:51. |

**Whether the commit bug is what she hit is unverified.** It needs either her answer to *"after you
typed the new rate, did you close Settings with the X, and when you reopened it did it show the old
number?"*, or one real-iPhone repro: type a rate, tap the X without tapping Done, reopen. Her
`user_data` row was **not read** — personal data, and the brief said ask first. Her wish still
stands on its own: even with the rate saved, the app could only re-price everything.

**Fix:** `NumInput commitOnUnmount`, on the Settings scalar fields only (rate, federal, state, FICA %,
retirement, health, post-tax). Not on differential or goal rows: their `onCommit` closes over the
list as rendered, so a commit after a Delete would resurrect the deleted row (logged in `BACKLOG.md`).

## 2. What was built

`rateChanges [{from, rate}]` beside `baseRate`; `rateEntryOn` / `rateOn` / `sanitizeRateChanges` in
the `money` core region (3 new names in the gate's wage list); per-date pricing in
`periodPaycheck`, `overtimePremiumCents` (weighted regular rate, 29 CFR 778.109 / 778.115),
`groupHoursByJob`, `statOf`, `ptoStatOf`, the year view and the Add-Shift preview; pattern lab and
the goal hint at today's rate. `periodPaycheck` returns `rates`; the Breakdown prints *"Priced at
two rates: …"* when a period straddles a raise. Settings: *"Got a raise? New rate from [date]"*,
defaulting to the next pay period's start, a listed row with Remove (asks first), and the base
label becomes *"Hourly rate before [date]"*. Events `rate_change_added` / `rate_change_removed`
carry `{count}` only.

## 3. Proof

| Check | Result |
|---|---|
| Baseline before any code | gate 14/14, core 116/116, smoke **791/791** |
| `node scripts/check_build.mjs` | 14/14, 34 wage definitions |
| `node tests/core.test.mjs` | **135/135** (19 new) |
| Mutants of the extracted core (11) | every new core assertion fails under at least one; `bpdavg` (always average, never the exact base) is **equivalent** — 896 randomized fortnights showed no float dust, so the exact-base branch is defensive |
| Differential sweep, deployed core vs new, 896 fortnights × 4 empty/no-op lists | **0 differ** |
| `tests/smoke.mjs` §49 (was §48 before the merge with #188), iPhone 13 | 15/15; 10 broken copies, each caught |
| full `tests/smoke.mjs` | **806/806** (791 + §49's 15) before the merge with #188 |
| `tests/equality.mjs` vs badgebudget.com | **26 identical / 0 unintended / 4 of 4 named** — and the four session-3 cases un-named, since #174 is live |

## 4. Not done, on purpose

Paystub import still writes `baseRate` (would re-price history once a raise exists); list-row
`NumInput`s still drop an unblurred edit; a typed base is rounded to cents for shifts but not PTO
(pre-existing). All three are in `BACKLOG.md` → *Needs a dedicated session*. Out of scope per the
brief: dated pay items (session 4, still next), step tables, jobs, the gateway.

## 5. After Pat merges

`git fetch origin claude/migrate-to-github-deploy-3F5RD`, then `node scripts/deploy_watch.mjs`
must read **LIVE naming the merge commit** — it has printed LIVE for a stale head before.
