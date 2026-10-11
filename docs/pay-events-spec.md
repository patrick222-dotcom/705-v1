# Pay events: per-shift multiplier + minimum hours — spec

Session 3 of the multi-persona plan (`docs/session-2026-10-10-pay-patterns-and-onboarding.md` §4),
dedicated wage-core session, 2026-10-11 (Invariant 3). Evidence: `docs/pay-rule-patterns.md` (a) the
"Multiplier above 1.5×" and "Minimum-hours events" rows, (b) the nurse 2× row, (d) row 2.

## The defect

`shiftGrossCents` hard-codes `otMult = s.isOvertime ? 1.5 : 1`, and nothing models a minimum.

- **Minimums:** 21 of 21 police contracts pay court or call-back as *max(actual, minimum)* hours,
  usually 2–5 h at 1.5× (Portland court 5 h, Cleveland call-in 4 h, Florence 2 h). Logged at the
  hour she actually spent, a 1 h court appearance on a 3 h minimum reads **67% low**; on a 2 h
  minimum, 50%; 1.5 h on a 2 h minimum, 25%.
- **Multipliers:** 9 of 21 pay more than 1.5× somewhere (Philadelphia court 2.5×, Minneapolis
  holiday OT 2.25×, Hillsboro 2× on a second day off). Nurses: 2× past 12 h (UC, Kaiser). A 2.5×
  event logged at 1.5× reads **40% low**.

## (a) Data shape on a shift

Three optional fields. **All three absent = today's shift, priced byte-identically.**

| Field | Meaning | Kept by `sanitizeData` only when | Otherwise |
|---|---|---|---|
| `otMult` | the premium multiplier for a shift marked overtime | `isOvertime === true` **and** a finite number with 1.5 < m ≤ 4; stored rounded to 2 dp | deleted (reads as 1.5) |
| `minHours` | paid at least this many hours | a finite number with 0 < h ≤ 24; stored rounded to 2 dp | deleted (no minimum) |
| `payEvent` | what the minimum is for — a **label** | one of `'court'`, `'callback'`, `'report'` (`PAY_EVENTS`) | deleted |

Why this shape:

- **The multiplier hangs off `isOvertime` instead of replacing it.** `isOvertime:true` with no
  `otMult` still means 1.5×, so every saved shift prices as today. More importantly, the flag is
  what `overtimePremiumCents` already uses to keep a premium hour out of the derived overtime count
  (see (c)); any multiplier above 1× rides the same flag, so no new path can pay an hour twice.
- **Bounds.** Below 1.5 is refused: a "premium" shift at 1.2× would still be subtracted from derived
  overtime as if it had been paid 1.5×, so it would under-pay her week. 1.5× is the absent value, so
  it is never stored. Above 4× is refused: the highest multiplier in the sample is 3× (utility), and
  the one total-pay cap found is 4× (`SCL` 16.2). The range is continuous, not a short list, on
  purpose: the California stub's overtime line is **1.87×** the printed base. That is most likely a
  pay component missing from the stub's base rate (`pay-rule-patterns.md` (g)), so the right fix for
  her is the rate, not this field — but a bounded number lets her match a stub she cannot explain,
  and a whitelist of 2/2.25/2.5/3 would not.
- **`minHours` is independent of `isOvertime`.** Some call-back minimums pay straight time (1×),
  most pay 1.5×, Philadelphia court pays 2.5×. The minimum is a floor on the hours; the multiplier
  is the rate. Price = `max(paid hours, minHours) × rate × multiplier`.
- **`payEvent` is never read by the pay math**, the same rule as the persona. It names the row in the
  shift list and the Breakdown note. `check_build.mjs`'s persona rule is extended to forbid it in
  every wage definition, so a future "court pays differently" branch fails the gate.
- **Read-time coercion, not trust.** The math reads the fields through two core helpers,
  `otMultOf(s)` and `minHoursOf(s)`, which apply the same bounds as the sanitizer. The Add-Shift draft
  and the pattern lab hand the math unsanitized objects, so the bounds have to hold there too. One
  definition of the bounds, used by both.
- Templates and pattern cells carry all three, through their own sanitizer branches. Templates
  silently dropped the OT flag once already (council 2026-09-13 #9); a "Court — 3 h min" template
  that forgot its minimum would be the same bug.

## (b) Do guaranteed hours that were not worked count toward the overtime threshold? **No.**

**29 CFR 778.221(a):** "The amount by which the specified number of hours' pay exceeds the
compensation for hours actually worked is considered as a payment that is **not made for hours
worked**. As such, it **may be excluded** from the computation of the employee's regular rate and
**cannot be credited** toward statutory overtime compensation due the employee."

**778.221(b)** works the exact case: $12/h, 40 h week, 1 h of overtime on Monday, then a call-back
of **2 h worked on a 3 h minimum at time and one-half**. "**the 43 actual hours (not 44) are counted
as working time during the week**", the regular rate "remains $12", and the extra $18 from the
minimum is excluded from the regular rate and not credited. **778.222** applies the same treatment
to payments "similar to call-back pay" — report pay, short-notice pay, rest-gap pay.

So, in the code:

1. **Threshold hours are actual paid hours.** `overtimePremiumCents` keeps counting
   `paidHoursOf(s, job)`; `minHours` never enters it. Pinned by the regulation's own example as a
   core test: priced under the 40-hour week it must give $552 exactly and **no derived premium** (44
   hours would add a phantom $6).
2. **The regular rate excludes the top-up.** `straightTimeCents` prices a shift with its minimum
   removed, so the regular rate is straight time for hours *worked* ÷ hours worked. Pinned by a
   variant of the same week with Monday's extra hour left unmarked: one derived overtime hour at half
   of $12 = $6.00. Counting the top-up in the rate would make it $6.14.
3. **The top-up is not credited toward derived overtime.** Only the *worked* hours of a marked shift
   are subtracted from the derived overtime hours (unchanged code: `flaggedHours += h`).

**One simplification, stated:** 778.221(a) also says a payment that is **prearranged** ("the extra
work was anticipated and therefore reasonably could have been scheduled") is *not* excludable from
the regular rate. A subpoenaed court date is arguably prearranged. The app cannot tell, so it always
excludes. The direction is safe and the size is small: it only matters under a derived rule ('40',
'8-80', custom — not 'flagged', which most police use), only in a week that also has derived
overtime, and the error is half the top-up spread over that week's hours. Hours are unaffected
either way: prearranged or not, an hour not worked is not an hour worked.

## (c) A shift above 1.5× and derived overtime: no hour is paid a premium twice

Unchanged mechanism, now load-bearing for any multiplier:

- A marked shift pays `rate × otMult × hours` inside `shiftGrossCents`.
- In the derived computation its **straight time** (1×, actual hours) goes into the regular rate, its
  actual hours go into the period total, and the same hours are subtracted from the derived
  overtime hours (`unflagged = max(0, otHours − flaggedHours)`).

So a 2.5× hour is never also given a derived 0.5× premium. That is what 29 USC 207(e)(5)–(7) and
207(h)(2) allow: a true overtime premium of at least 1.5× is excluded from the regular rate and is
creditable against overtime owed. The app credits it **hour for hour**, not dollar for dollar — the
extra 1.0× of a 2.5× hour is not used to offset a *different* hour's derived overtime. That can only
pay her more than the statutory floor, never less, and it keeps the existing guarantee simple: one
marked hour removes exactly one hour from the derived count.

## (d) Where she sets it, and how the Breakdown says it

**Add-Shift sheet**, two changes, both closed by default so a nurse who never sees an event never
sees a new control:

1. **OVERTIME**: when the overtime chip is on, a row of rate chips appears under it — **1.5× · 2× ·
   2.5× · 3×** — plus an "Other" number field (1.5–4). 1.5× is lit by default. The chip label says
   the rate she picked: `Overtime — pays 2.5× the hourly rate`.
2. **MINIMUM PAY (OPTIONAL)**: three chips, **Court · Call-back · Report pay**. Tapping one opens
   "Paid at least [ ] hours". Tapping it again clears both the kind and the number. No number is
   pre-filled: minimums run 2–5 h and a guessed default would move the figure she is about to trust.
   A minimum with no kind is not offered (the UI always names the kind); the sanitizer still accepts
   one, because the math does not need the label.

The preview line names what it priced: `+$165 gross … · incl. OT ×2.5 · incl. court minimum (3h)`.
The day's list row shows `OT ×2.5` (was a hard-coded `OT ×1.5`) and `Court · min 3h`.
Template chips say ` · OT ×2.5` and ` · court min 3h`.

**Breakdown**: one new note under Gross, only when the period has a minimum that paid more than the
hours worked: `Includes $X of minimum-hours pay — N court / call-back / report shifts paid for more
hours than you worked.` The figure comes from `periodPaycheck`'s new `minTopUpCents`, computed by
the same function that priced the shift (`minimumTopUpCents`), so the note can never disagree with
the gross. A multiplier needs no Breakdown row: it is in the shift's own line and the gross, exactly
as the 1.5× flag always was.

Hours shown anywhere (hero, calendar, "hours this period") stay **hours worked**. A minimum pays
hours; it does not add them.

## (e) Nurse "2× after 12 h": the by-hand half is in scope, the trigger is not

A 16-hour shift under "2× after 12" is 12 hours at her normal rate (or 8 + 4 at 1.5× under daily
overtime) plus 4 hours at 2×. One whole-shift multiplier cannot express that, and splitting a shift
automatically is the daily trigger, primitive 11 — out of scope. What this session gives her: log
the 4 hours past 12 as a second entry on the same day, marked overtime at 2×. That prices correctly
today and is what the spec recommends in the hint text. The automatic trigger is not argued for
here: it needs daily *and* consecutive-day rules and a no-pyramiding decision (primitive 12) to be
right, which is its own session.

## Equality claim

A blob without `otMult`, `minHours` or `payEvent` prices identically, figure for figure:
`otMultOf` returns 1.5 for a marked shift and `minHoursOf` returns 0, so `max(h, 0) = h` and the
rate line is the same expression in the same order (`hourlyRateCents × 1.5 × hours`). Proven three
ways: the existing core and smoke probes unchanged; a core fixture set captured from the pre-change
module; and `tests/equality.mjs` against badgebudget.com with every existing case IDENTICAL and the
new cases listed as named differences (the deployed build ignores the fields).

## Tests

**Core** (`tests/core.test.mjs`), each figure hand-computed:
- **Court, 1 h worked, 3 h minimum, 1.5×** at $45: 3 × 45 × 1.5 = **$202.50** (today: $67.50).
- **Portland court, 5 h minimum**, 1 h worked, 1.5× at $45: **$337.50**.
- **Cleveland call-in, 4 h minimum**, 2 h worked, 1.5× at $40: **$240.00**.
- **Philadelphia court at 2.5×**, 1 h worked on a 2 h minimum, at the FY2026 step-5 hourly $44.52
  (the schedule's OT rate 66.7823 ÷ 1.5 = 44.5215; the app holds a base rate in whole cents):
  2 × 44.52 × 2.5 = **$222.60**.
- **Worked past the minimum**: 5 h on a 3 h minimum pays 5 h.
- **Minimum at straight time** (not marked overtime): 1 h on a 4 h minimum at $40 = $160.
- **(b), 778.221(b)'s own week** under the 40-hour rule: $552.00 gross, 43 hours, zero derived
  premium. Variant with Monday's hour unmarked: premium exactly $6.00, regular rate $12.
- **(c)**: a 2.5× marked 12 h shift in a 52 h week adds no derived premium for its hours.
- **Sanitizer**: keeps the in-range values; drops `otMult` without `isOvertime`, ≤1.5, >4, NaN,
  junk; drops `minHours` ≤0, >24, junk; drops an unknown `payEvent`; templates and pattern cells too.
- **Identity**: fixtures without the fields equal literals captured from the pre-change module.

**Smoke** (`tests/smoke.mjs`, new section, iPhone 13): drive the Add-Shift sheet — mark overtime,
pick 2.5×, set Court with a 3 h minimum on a 1 h shift — and assert the preview figure, the saved
blob's fields, the list-row tags, the hero, and the Breakdown note; plus that clearing the chips
removes the fields. Every new assertion negative-tested against a broken scratch copy.

**Equality** (`tests/equality.mjs` against badgebudget.com): all existing cases IDENTICAL; new named
differences for a 2.5× shift, a court minimum and a call-back minimum at 1×.

## Out of scope

Dated pay items (session 4); automatic daily, consecutive-day and rest-gap triggers (primitive 11);
stacking and no-pyramiding rules (12); comp time (8); the 0/+1 paycheck lag; the Law enforcement and
Fire & EMS tiles (session 5); jobs. **Known, pre-existing, not fixed here:** an iCal *update* rebuilds
the shift from the feed and drops hand-set fields — `isOvertime` and `noMeal` today, and now these
three. Events are hand-logged, not synced, so the exposure is a synced tour she later marked by hand.
Filed in `BACKLOG.md`.
