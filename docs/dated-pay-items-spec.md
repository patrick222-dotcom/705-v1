# Dated pay items — spec

Dedicated wage-core session, 2026-10-20 (Invariant 3). Session 4 of the multi-persona plan
(`docs/session-2026-10-10-pay-patterns-and-onboarding.md` §4). Committed before any code.

## The gap

A payment that lands in one particular check has no home today. Real examples from
`docs/pay-rule-patterns.md`: Hillsboro's holiday pay as a "separate lump sum" in January (21.4),
Lakewood's longevity in "two (2) equal payments in June and December" (12.02), nurse ratification
lumps of $1,000–$4,510 ((d) row 3). The workaround is a custom flat bonus on a shift in that period,
which mislabels the payment, is priced as part of that shift, and **vanishes if the shift is
deleted** — and a NurseGrid sync that removes the shift deletes it for her.

**Verified against the code before building on it** (the last session found a false BACKLOG claim):

- No shift, job or blob field carries a dated payment today. `sanitizeData` has no such key;
  `periodPaycheck` sums shifts, PTO and the derived overtime premium, nothing else.
- "Goal math" today is three places, and **none of them is a dated paycheck**: the Add-Shift
  sheet's `goal 12.4% (≈8 shifts)` (one shift's take-home, `previewNet`), the Pattern Lab's
  `goal: 7 paychecks` (a rotation's average check, `patternMetrics`), and the Settings goal hint
  (`≈ per shift`). The goal deadline feature — the one that would need December money — does not
  exist yet (`BACKLOG.md`, P1, out of scope here).
- The app has **no pay date**. A "paycheck" is the 14 days `payPeriodStart` is phase-aligned to;
  the hero is labelled with those days. Nothing models the 5–11 day lag to the check
  (`pay-rule-patterns.md` (g) finding 7).

## (a) Data shape

One new optional list in the `user_data` blob, beside `rateChanges`, and carried on the job
(`makeJob`), because what an employer pays and when is a property of the employer — the same reason
`rateChanges` lives there. `activeJob` is still built from App state, so there is one source of
truth.

```js
payItems: [
  { id:'pi-1', label:'Longevity',   cadence:'semiannual', date:'2026-06-05', amount:600,  withholding:'bonus'   },
  { id:'pi-2', label:'Holiday cash', cadence:'annual',    date:'2027-01-08', hours:88,   withholding:'regular' },
]
```

| Field | Rule (`sanitizePayItems`, shared by `sanitizeData` and `makeJob`) |
|---|---|
| list | Not an array → absent. At most `MAX_PAY_ITEMS` (12), in the order entered. |
| `id` | Non-empty string ≤ 40 or a finite number; else `pi-<index>`. A duplicate id drops the later entry. |
| `label` | Trimmed string, 1–80 chars, stored sliced to 40. Empty → **dropped**. Display only: **the math never reads it** (gated, below). |
| `cadence` | One of `once` / `monthly` / `semiannual` / `annual`. Anything else → **dropped**. |
| `date` | A real `YYYY-MM-DD` (`isISODate`): the first occurrence. Anything else → **dropped**. |
| `amount` | Dollars, finite, `0 < amount ≤ 25,000`, stored at 2 dp. |
| `hours` | Hours paid at her rate, finite, `0 < hours ≤ 400`, stored at 2 dp. |
| `amount` / `hours` | **Exactly one** valid. Both, or neither → **dropped**. Out of range → **dropped, never clamped** (the `otMult` / `rateChanges` rule): a clamped $25,000 would be a number she never typed. |
| `withholding` | `bonus` or `regular`. **Absent → `bonus`** (see (c) for why that is the safe default). Any other value → **dropped**. |

25,000 is above every lump in the research (the largest is $4,510) and below anything a corrupt
field would produce by accident; 400 hours covers a 240-hour vacation cash-out with room.

**A blob without the list prices byte-identically.** `periodPaycheck` only takes the new path when
the period holds at least one occurrence; with none, every expression is the one it was. Pinned in
`tests/core.test.mjs` (absent vs `[]` vs an item outside the period, over four work-period rules)
and by `tests/equality.mjs` against the deployed build.

`applyData` is authoritative (`setPayItems(d.payItems || [])`), like `rateChanges`, so one account's
items never linger into another's on a shared phone; `resetToDefaults` clears it.

### When an item occurs

`payItemOccursOn(item, dateKey)` — never before `date`, then:

| cadence | occurs on |
|---|---|
| `once` | `date` only |
| `monthly` | the same day of every month from `date` |
| `semiannual` | the same day every 6 months from `date` (Jun 5 → Dec 5 → Jun 5 …) |
| `annual` | the same month and day every year from `date` |

A day past the end of a short month lands on its last day (a monthly item on the 31st pays Feb 28
or 29; an annual Feb 29 pays Feb 28 in other years) — dropping it would lose a payment, moving it
into the next month could put two in one. There is no end date: removing the item stops it.

## (b) Which paycheck an item lands in

**The pay period whose 14 days contain its date** — the same attribution as a shift. Not a pay
date.

The two readings, and why this one:

- **A period date** (chosen). The app's paychecks *are* periods; the hero is labelled with their
  14 days, and every shift, PTO day and raise already attributes by a date inside them. An item
  dated Dec 1 lands in the paycheck labelled with the period containing Dec 1.
- **A pay date** (the date printed on the check). This needs the lag from period end to payday,
  which the app does not have and which is not one number: 5–7 days for the police, fire and
  California stubs read, 11 at UC (`pay-rule-patterns.md` (g) 7). Guessing it would put a
  $4,510 lump in the wrong check for some users with nothing on screen saying why.

**The cost of the choice, stated:** a nurse who types the payday printed on the check gets the item
one paycheck late, because a 5–11 day lag puts payday inside the *next* period. So the entry row
says, live, which paycheck the date lands in — *"Lands in your Nov 30 – Dec 13 paycheck"* — using
the same `periodRangeLabel` as the greet row, and the hint under it reads *"Pick a day inside the
pay period it's paid with."* She sees the period before she saves, not after.

## (c) Taxes: supplemental wages

Every item is **taxable wages**: it adds to gross, to the FICA base and to the income-tax base, and
the pre-tax buckets are unchanged (they are a flat dollar figure per check, not a rate). Pub 15 §7:
*"Regardless of the method you use to withhold income tax on supplemental wages, they're subject to
social security, Medicare, and FUTA taxes."* A non-taxable reimbursement (an accountable-plan
uniform allowance) is out of scope; Pub 15 §7 lists *"expense allowances paid under a
nonaccountable plan"* as supplemental wages, which is the common case.

**Federal withholding is the employer's choice, so it is a per-item setting.** IRS Pub 15 (2026),
section 7, *Supplemental Wages*
(https://www.irs.gov/publications/p15, read 2026-10-20):

- *"If you pay supplemental wages with regular wages but don't specify the amount of each, withhold
  federal income tax as if the total were a single payment for a regular payroll period."*
- *"If you pay supplemental wages separately (or combine them in a single payment and specify the
  amount of each) … If you withheld income tax from an employee's regular wages in the current or
  immediately preceding calendar year, you can use one of the following methods"* — **1a**,
  *"Withhold a flat 22% (no other percentage allowed)"*, or **1b**, the aggregate method.
- The size of the difference, from its own Examples 2 and 3 on one $1,000 bonus: **$114** withheld
  by the aggregate method, **$220** by the flat rate.

The app's flat federal % is the stand-in for the aggregate method (it is the app's model of
"withhold as if the total were a single payment"). It **cannot** stand in for 1a: a nurse whose
effective federal rate is 12% would see a $4,510 ratification lump withheld at $541 instead of the
$992 the flat method takes — take-home overstated by **$451** on the one check she is planning
around. So:

| `withholding` | Federal on the item | When |
|---|---|---|
| `bonus` (default) | **22%** of the item | the item is paid separately or itemised on the stub (method 1a) |
| `regular` | her federal % | it is folded into the check without being itemised (method 1b / a single payment) |

**Default `bonus`.** Lumps like the ones in the gap are itemised on a stub almost by definition,
and if the guess is wrong in this direction she plans on *less* money than arrives — the
recoverable error for a goal. The other direction is the unrecoverable one.

Two edges, both from the same text:

- **No federal withholding on her regular pay → no flat rate.** Method 1a is available only *"if
  you withheld income tax from an employee's regular wages"*; otherwise the employer must use 1b.
  So with `federalTaxRate` 0, a `bonus` item is withheld like regular pay (0).
- **Only the income-tax base the item actually adds is taxed at 22%.** `computeNet` splits
  `incomeTaxBase` into the item's share (capped at the base) and the rest; the rest keeps her
  federal %. With no `bonus` item the split is `{rest: incomeTaxBase, supp: 0}` and the federal
  line is the expression it always was.

**Not modelled, on purpose:** the 37% rate on supplemental wages over $1 million a year (no nurse's
lump reaches it); state supplemental rates (they differ by state — California's is its own flat
rate, Pennsylvania's is the regular rate — and the app has one state %, which the item uses);
retirement deferrals taken as a percent of a bonus (the app's retirement field is dollars per check).

## (d) The regular rate and overtime

**An item never enters the overtime computation of the check it lands in.** `overtimePremiumCents`
reads shifts only, and items are not shifts; this is a ruling, not an accident, and a core test
pins it (`ot.premiumCents` and every `regularRateCents` identical with and without an item).

Why, from the text (law.cornell.edu, read 2026-10-20):

- **Which items belong in the regular rate.** 29 CFR 778.208: section 7(e) *"requires the
  inclusion in the regular rate of all remuneration for employment except eight specified types of
  payments"*, and *"Bonuses which do not qualify for exclusion … must be totaled in with other
  earnings."* A contractual payment does not qualify: 778.211(c), *"any bonus which is promised to
  employees upon hiring or which is the result of collective bargaining would not be excluded"* —
  so a **ratification lump** and a **contractual longevity payment** are in. Excluded: a truly
  discretionary bonus (778.211(b), the employer keeps discretion over fact and amount), a gift
  *"not measured by or dependent on hours worked"* (778.212(a)), **holiday pay for a day not
  worked** (778.218(a): payments *"when the employee is not at work due to vacation, holiday …
  are not made as compensation for his hours of employment"*), and **cash for a forgone holiday or
  unused leave** (778.219(a): it *"may be excluded whether paid out during the pay period in which
  the holiday or prescheduled leave is forgone or as a lump sum at a later point in time"*).
- **Where an included one goes.** 778.209(a): *"When the amount of the bonus can be ascertained, it
  must be apportioned back over the workweeks of the period during which it may be said to have
  been earned."* The extra owed is, for each overtime week, *"one-half of the hourly rate of pay
  allocable to the bonus for that week multiplied by the number of statutory overtime hours worked
  during the week."* So adding a six-month longevity payment to the straight time of the 14 days it
  lands in would be **wrong** — it would credit half a year's bonus to one fortnight's overtime and
  overstate that check. Not recomputing the landing period is the correct half.
- **The true-up is not modelled.** The correct other half — a retroactive premium spread over the
  weeks the item was earned (778.209(b) allows equal-per-week or equal-per-hour allocation) — needs
  the earning period, which a one-off item does not have, and is small: a $1,200 annual longevity
  payment over 2,080 hours is $0.58/h, so the true-up is $0.29 × overtime hours — **$29 a year at
  100 overtime hours**. Employers commonly pay it as a separate later line, if they itemise it at
  all. A Known limit, below.
- **No item reduces overtime.** 778.211(a), 778.212(a), 778.218(a) and 778.219(a) each say the
  excluded sum *"may not … be credited toward overtime compensation due"*. Nothing here does.

**Hours on an hours-priced item are not hours worked.** 778.218(a) and 778.219(a): they are not
compensation for hours of employment. They are not added to the period's `hours`, never count
toward an overtime threshold, and the hero's hours figure does not move.

## (e) Rates

An item priced in hours is paid **`hours × rateOn(baseRate, job.rateChanges, occurrenceDate)`** —
the rate in force on the day it occurs, never the global `baseRate` — with no differential and no
bonus, like PTO. A June longevity check after an April raise pays at the new rate; one before it at
the old. Rounded once, as a payroll line is: `roundCents(toCents(rate) × hours)` (the shift rule;
`BACKLOG.md` already records that PTO multiplies a dollar rate instead, a pre-existing P3).

A dollar item is its amount. A raise never touches it.

## (f) Where she enters it, and where it shows

**Settings → a new section, "EXTRA PAY ON A SET DATE"**, right after YOUR PAY's raise row (per job:
there is one job, and the list rides on it):

- Saved items list one per row: **"Longevity · $600.00 · twice a year from Jun 5, 2026 [Remove]"**
  (hours items: *"88 hrs at your rate"*). Remove asks first.
- An entry block: *What is it?* (text, placeholder *"Longevity, holiday pay, a bonus…"*), the amount
  with a **$ / hours** switch, *How often* (*Once* / *Every month* / *Twice a year* / *Once a year*),
  the date, and *Taxes* (*"Taxed as a bonus (22% federal)"* / *"Taxed like my regular pay"*), then
  **Add**.
- Under the date, live: *"Lands in your Nov 30 – Dec 13 paycheck. Pick a day inside the pay period
  it's paid with."*
- Plain controlled inputs read by Add — not `NumInput`, so a tap straight from a field to Add
  cannot lose the value (the 2026-10-17 commit-on-blur lesson).
- Events `pay_item_added` / `pay_item_removed`, props `{count, cadence}` — `cadence` is a
  whitelisted token; **never** an amount or a label (Analytics rule).

**The hero** shows the take-home including the item in the check it lands in; no layout change.

**The Breakdown**, only when the period holds an item, adds one note under Gross pay:

> *Includes **$600.00** paid on a set date: Longevity $600.00 (Dec 5). Federal tax on it is
> withheld at the 22% bonus rate.*

The second sentence appears only when a `bonus` item is in the period and the flat rate applied.
The figures are `periodPaycheck`'s own `items` list, so the note sums with gross.

**The year view** adds each occurrence to the month of its date, so the year total includes the
December money. **Calendar day cells do not show items** — an item is a paycheck line, not work on
a day, and the calendar's per-day figures are what a shift earned.

**Goal lines.** None of today's three is a dated paycheck (see *The gap*), so none changes: a
shift's preview is what that shift is worth, and the Pattern Lab compares rotations at today's rate,
where an item adds the same constant to every rotation. What lets goal math see December and
January money is that **`periodPaycheck` now carries it**: the deadline feature sums
`periodPaycheck` over the checks between now and the goal date, and each occurrence lands in exactly
one of them. Pinned in `tests/core.test.mjs`: across 26 consecutive checks an annual item adds its
amount exactly once, a semi-annual one twice.

### The math never reads the label

`check_build.mjs`'s wage scan — the persona rule — also refuses `label` inside any wage definition,
the same rule as `payEvent`. `periodPaycheck` hands the Breakdown the item object, and the Breakdown
reads the label to print it.

## Known limits (not built here)

- **The 778.209 true-up** for a non-discretionary item (above). Bound: half the item's per-hour
  share × the overtime hours of the weeks it was earned.
- **Pay dates.** Items attribute by period date; a pay-date model (and the 0/+1 lag for custom
  periods, already in `BACKLOG.md`) is a separate session.
- **Per-item state withholding, the $1M 37% rate, percent-of-bonus retirement deferrals,
  non-taxable reimbursements, end dates.**
- Out of scope by the session brief: salaried/leveled base, comp-time banking, jobs (session 6),
  the Law enforcement and Fire & EMS tiles (session 5), the goal deadline feature.
