---
name: wage-core
description: "The Invariant 3 protocol for touching BadgeBudget's wage math. Use BEFORE editing shiftGross, hourlyRate, computeNet, calc, statOf, ptoStatOf, patternMetrics, the rate/differential coercions in sanitizeData, the BONUS table, or anything that changes a displayed dollar figure. Also use when reviewing a diff that touches them, or when the user mentions take-home, differentials, overtime, FICA, tax math or paycheck figures."
---

# Wage core

These functions decide what a nurse believes her paycheck will be. A silent error here is
worse than a crash: a crash gets reported, a wrong number gets trusted and acted on — someone
picks up a shift because the app said it was worth $940.

Invariant 3: **a dedicated session, never a nightly build.** If you are the nightly loop,
stop and mark the item `deferred`.

## What counts as wage core

`shiftGross`, `hourlyRate`, `computeNet` (the per-paycheck tax model shared by the hero and
the pattern lab since #65), `calc`, `statOf` / `ptoStatOf`, `patternMetrics`, and the
rate/differential coercions in `sanitizeData`. The `BONUS` table too — changing a bonus rate
changes every historical shift's displayed value.

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
- **FICA is levied on gross; income tax on gross minus pre-tax.** `computeNet` keeps
  `ficaBase = gross` and `incomeTaxBase = max(0, gross - pretax)` separate. Collapsing them
  is the single easiest way to silently overstate take-home.
- **Displayed pre/post-tax rows are capped so `Breakdown` still sums.** `dispPre`/`dispPost`
  are display-only; `net` uses the uncapped figures.

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
for and the one that is easy to skip. Probes prove the functions are self-consistent; they do
not prove the *rendered* figures are unchanged for cases you did not think about.

Render the same seeded state against both the local build and `https://badgebudget.com/index.html`,
and assert the hero figure, the Gross / Taxes / Keep-% chips, every Breakdown row and the
take-home text are **byte-identical** — except where you intended a change, which you name
explicitly before running.

Cover, at minimum, the cases the #65 harness covered: pre- and post-tax deductions, a custom
FICA percentage, percent *and* dollar custom withholdings, an overtime shift, and a PTO day
(paid at base rate). Seed via `localStorage['nursingWagePlannerData']`.

If a figure differs and you did not intend it, that is the bug — not a rounding artifact to
wave through.

**5. Ship via the `ship` skill**, with a marker that is unique to this change.

## Reviewing someone else's wage diff

Same protocol, in reverse: read the diff for the five invariants above, then run steps 1, 3
and 4. "The tests pass" is not sufficient — ask which *new* assertion covers the changed
behaviour. If none does, that is the finding.
