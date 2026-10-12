---
name: wage-core
description: "The Invariant 3 protocol for touching BadgeBudget's wage math. Use BEFORE editing shiftGross, hourlyRate, computeNet, calc, periodPaycheck, keepRatioOf, statOf, ptoStatOf, patternMetrics, patternCellToShift, sampleNet, keepRatio, the rate/differential coercions in sanitizeData, the BONUS table, the *Cents helpers, paidHoursOf, otMultOf, minHoursOf, minimumTopUpCents, or anything that changes a displayed dollar figure — including arithmetic in a UI component that prints one. Use it when a nightly queue item asks for any of these, however small it is called. Also use when reviewing a diff that touches them, or when the user mentions take-home, differentials, overtime, FICA, tax math or paycheck figures."
---

# Wage core

These functions decide what a nurse believes her paycheck will be. A silent error here is
worse than a crash: a crash gets reported, a wrong number gets trusted and acted on — someone
picks up a shift because the app said it was worth $940.

Invariant 3: **a dedicated session, never a nightly build.**

## If you are the nightly loop

Do not edit wage core — not the function, not a caller that does its arithmetic for it, not a
"prep" refactor, not a probe for it. Instead, in `BACKLOG.md`:

1. **Move** the item out of `## Queue` into `## Needs a dedicated session (NOT for the nightly
   loop)` with a one-line reason naming this rule and a harness tag. Move, don't copy: leave no
   pointer or stub in the Queue for a later run to pick up.
2. Write down what the dedicated session needs: the defect as verified, what is wrong with any
   proposed patch, and the new probe it must add.
3. Add a dated Done-log line saying nothing shipped for it and why, then either take the next
   gate-safe Queue item or stop.

Investigating is fine (read the code, run a probe in `node` against a scratch copy, check the
owner's arithmetic); shipping is not. If the owner needs an answer before the dedicated
session, put a **no-code workaround** in the notify line (a Settings value, a toggle she can
tap) instead of a code change.

### Red flags — each of these means stop and move the item

| The pressure | Why it doesn't change the answer |
|---|---|
| "It isn't on the wage-core list" | The list below is examples. The test is: **can this change move a displayed dollar figure?** If yes, it is wage core. |
| "It's config / a constant / input cleaning / an hours helper" | Rates, bonus tables, sanitizer coercions and paid hours all feed the figure. Same test. |
| "Don't touch X, just do the math in the component instead" | Moving the arithmetic to a caller is editing wage core with none of its checks. A surface that prints a dollar figure from its own arithmetic is wage core. |
| "The probe is already written" / "I'll add a test with it" | A probe is step 2 of a protocol whose step 4 (equality against the deployed build) cannot run in a nightly. A test does not make a nightly edit safe. Verify the claim anyway; it has been false. |
| "Gate is green" | That was before the change. The gate does not check wage math (`check_build.mjs` reports Invariant 3 UNCHECKED). |
| "It's one line" | The FICA-base collapse below is one line and is the easiest way to silently overstate take-home. |
| "I'm the owner, it's my call" / a 7am deadline | The owner's call is to schedule the dedicated session. A deadline gets a workaround, not a wage edit. |

## What counts as wage core

`shiftGross`, `hourlyRate`, `computeNet` (the per-paycheck tax model shared by the hero and
the pattern lab since #65), `calc` and the `periodPaycheck` it calls, `keepRatioOf` (both
hoisted to module level 2026-10-07 and extracted for the MCP gateway — after editing either, re-run
`node scripts/extract_core.mjs` and `node tests/core.test.mjs`), `statOf` / `ptoStatOf`, `patternMetrics` and the
`patternCellToShift` it prices cells through, and the rate/differential coercions in
`sanitizeData`. The `BONUS` table too (and `BONUS_LABEL`, which must agree with it) — changing
a bonus rate changes every historical shift's displayed value. **The helpers underneath them
count too**, because the public names are thin wrappers: `shiftGrossCents` and
`hourlyRateCents` (where the arithmetic actually lives), `paidHoursOf` (the hours every gross
multiplies by), `overtimePremiumCents`, and `toCents` / `fromCents` / `roundCents`.
**Also `sampleNet`** (the onboarding done-screen figure) **and `keepRatio`**
(the take-home ratio behind the Add-Shift preview, the goal reverse view and the calendar
cells): both build a tax model *beside* `computeNet` and had drifted from it when the council
looked on 2026-09-13 (`wage-math-04`, `-06`). They were outside this list, which is how they
drifted; a surface that prints a dollar figure from its own arithmetic is wage core whatever
it is called. Both were folded back into `computeNet` on 2026-09-19 — `sampleNet` now calls it,
`keepRatio` now includes percent custom withholdings.

**And `workPeriodRule` / `workPeriodChunks`** (2026-10-10) — which hours count toward overtime and
in which paycheck. A custom 7(k) period can straddle two paychecks and is counted in the one holding
its last day; `'40'` and `'8-80'` must keep their original code path. Pinned by the phantom-overtime
table in `tests/core.test.mjs`.

**And `otMultOf` / `minHoursOf` / `minimumTopUpCents`** (2026-10-11, session 3) — the per-shift
overtime multiplier and the court / call-back / report minimum. Every shift is priced through them,
and the sanitizer's `payEventFields` uses the same two helpers so there is one definition of the
bounds. Spec: `docs/pay-events-spec.md`.

**And `firstActiveShiftType`** — which shift type the Add-Shift draft opens on. It decides which
differential a preview prices, so it moves a dollar figure even though it returns a string.
`active:false` means "don't offer me this in a picker" and NEVER "stop paying a shift already
tagged with it": every saved shift is priced through `shiftGross(baseRate,
differentials[s.shiftType], …)`, so the other reading would retroactively re-price her whole
logged history the moment she flipped a switch. **The lit chip is always what is priced.**

Adding a *sanitizer branch for a new data shape* (as #62 did for `goals`) is not wage core
and is fine in a nightly, provided it ships with a unit test and the existing probes stay green.

## The invariants inside the math

Know these before you edit — each is a decision someone made deliberately, and each is
pinned by an assertion in `tests/smoke.mjs`:

- **Overtime stacks on top of the differential.** `shiftGross` computes
  `hourlyRate(base, diff) * 1.5 * hours`, not `base * 1.5 * hours`. A night OT shift earns
  1.5× the *differential-inclusive* rate. At $50 base with a $5 night diff over 12h that is
  **990, not 900**. Getting this wrong under-reports every overtime night shift.
- **Per-hour bonuses stay at face value under OT.** `perHr*hours + flat` is added after the
  multiplier, matching the legacy `overtime` shift type.
- **`bonusType:'custom'` is a flat amount, not per-hour.** `custom` zeroes `perHr` and adds
  `customBonus` once.
- **FICA is levied on gross minus pre-tax health premiums; income tax on gross minus BOTH pre-tax
  buckets** (corrected 2026-10-11). There are two pre-tax fields because the IRS taxes them
  differently (Pub 15 / 15-B): `pretaxDeductions` is **retirement** (401(k)/403(b)/457(b)), which
  skips income tax but is still FICA wages; `pretaxHealth` is **Section 125 health/dental/vision**
  (plus health FSA, payroll HSA), which skips income tax *and* Social Security/Medicare.
  `computeNet` keeps `ficaBase = gross − health` and `incomeTaxBase = max(0, gross − retirement −
  health)` separate. Collapsing them in either direction is the single easiest way to silently
  misstate take-home: moving retirement into the FICA base overstates it, putting health back into
  the FICA base understates it. A real California stub pins it: Medicare = 1.45% × ($9,820.04 −
  $266.03) = **$138.53** to the cent (`tests/core.test.mjs`). With no premium, `ficaBase` is
  `gross` exactly, which is why a blob saved before the field existed prices identically.
  `keepRatioOf` stays rates-only: a premium is a flat dollar figure, not a rate. Spec:
  `docs/fica-health-premium-spec.md`.
- **A marked shift pays its own multiplier, 1.5× unless she picked another** (2026-10-11).
  `otMult` rides `isOvertime` and never replaces it: absent = 1.5, so every shift saved before
  it prices identically, and the flag is still what removes a premium hour from derived overtime
  — so a 2.5× hour is never also given a derived 0.5×. Bounds 1.5 < m ≤ 4, **dropped, not
  clamped**, outside them; below 1.5 is refused because a "premium" under 1.5× would still be
  credited as if it were 1.5×.
- **A minimum pays the rate line on max(worked, minimum) hours; it adds no hours worked**
  (2026-10-11). Per-hour add-ons stay on hours worked. The derived overtime threshold counts
  hours WORKED and the regular rate excludes the top-up — **29 CFR 778.221(b)**: "the 43 actual
  hours (not 44)", "the regular rate … remains $12". That exact week is pinned in
  `tests/core.test.mjs`; moving `minHours` into the threshold or the regular rate fails it.
- **`payEvent` (court / call-back / report) is a label the math never reads**, like the persona.
  `check_build.mjs` fails if any wage definition names it.
- **Displayed pre/post-tax rows are capped so `Breakdown` still sums.** `dispPre`/`dispHealth`/
  `dispPost` are display-only, capped in that order; `net` uses the uncapped figures.

## The protocol

**1. Run the probes before you touch anything.** Establish the baseline is green:

```bash
node tests/smoke.mjs
```

The wage probes are the `wage:` assertions. If they are red before your change, fix that first.

**2. Make the change. Add a probe for the behaviour you changed** — in `tests/smoke.mjs`,
next to the existing `wage:` block. A wage change without a new assertion is not finished.

**3. Run the probes again, plus the gate:**

```bash
node scripts/check_build.mjs && node tests/smoke.mjs
```

**4. The equality assertion against the DEPLOYED build.** This is the step Invariant 3 exists
for and the one that is easy to skip. **It is now a script — `node tests/equality.mjs`** (needs
network; not in `smoke.mjs`, not in CI, on purpose). Name every intended difference before you
run it; a case that DIFFERS is either one you named or the bug, and "probably rounding" is not
a third option. Probes prove the functions are self-consistent; they do
not prove the *rendered* figures are unchanged for cases you did not think about.

A case can carry a third element naming its intended difference; the script reports those
separately and **fails if a named difference comes back identical** (the change never reached the
screen) as well as when an unnamed case moves.

Render the same seeded state against both the local build and `https://badgebudget.com/index.html`,
and assert the hero figure, the Gross / Taxes / Keep-% chips, every Breakdown row and the
take-home text are **byte-identical** — except where you intended a change, which you name
explicitly before running.

Cover, at minimum, the cases the #65 harness covered: pre- and post-tax deductions, a custom
FICA percentage, percent *and* dollar custom withholdings, an overtime shift, and a PTO day
(paid at base rate). Seed via `localStorage['nursingWagePlannerData']`.

If a figure differs and you did not intend it, that is the bug — not a rounding artifact to
wave through.

**5. Ship via the `ship` skill**, with a marker that is unique to this change. Who merges is
decided by step 4, not by you (`docs/leadership.md` → *Approval tiers*, 2026-10-12): every case
identical and no difference named → auto-merge. Any named difference → the PR waits for Pat, and
its body opens with a **before → after card**: three example paychecks from the equality cases, in
plain words ("3×12 nights, $38/h: take-home $1,842 → $1,815"). That card is what he approves, so
it must be readable without the diff.

## Reviewing someone else's wage diff

Same protocol, in reverse: read the diff for the five invariants above, then run steps 1, 3
and 4. "The tests pass" is not sufficient — ask which *new* assertion covers the changed
behaviour. If none does, that is the finding.
