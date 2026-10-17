# Effective-dated pay rates — spec

Dedicated wage-core session, 2026-10-17 (Invariant 3). Trigger: Courtney's `wish` report,
2026-10-14 08:51:00 UTC, device `f184ffa5`:

> *"update my pay rate for future shifts because of a raise. the shifts I've already put into the
> app for future shifts do not update to my new pay rate so the amount is inaccurate unless I
> delete all the shifts"*

## What is actually true today (corrects `BACKLOG.md`)

`BACKLOG.md` said *"a shift stores its own rate at entry"*. **That is false.** No shift carries a
rate. One App-level `baseRate` prices every shift, past and future: `periodPaycheck` takes it as an
argument, `statOf` / `ptoStatOf` / the year view / the Add-Shift preview read it directly, and
`activeJob` is built from the same state. So changing the rate in Settings re-prices **everything
at once** — including every shift she has already worked and been paid for. That is the real
defect a raise exposes: there is no way to say *"from this date"*.

Her symptom (future shifts *not* re-pricing) is therefore not explained by the pricing code. The
diagnosis is in `docs/session-2026-10-17-effective-dated-rates.md`; in short, one real path was
**proven in the harness and fixed in this session** (a rate typed into Settings and closed without
the field losing focus first is silently discarded), and two others were ruled out from `events`.
Whether that path is the one she hit is **unverified** — it needs her answer or a real iPhone.

## (a) Data shape

One new optional top-level field in the `user_data` blob, beside `baseRate`:

```js
rateChanges: [ { from: '2026-10-25', rate: 52 }, … ]   // ascending by `from`
```

- **`baseRate` keeps its meaning for every date before the first change.** With no changes it is
  the rate for every date, exactly as today.
- **The rate on a date** is the `rate` of the latest change with `from <= date`, else `baseRate`
  (`rateOn(baseRate, rateChanges, dateKey)` in the `money` core region). When no change applies it
  returns the `baseRate` value itself — not a copy, not a rounded figure — so every downstream
  expression is the one it always was.
- **No field, or an empty list, prices byte-identically.** Pinned in `tests/core.test.mjs` (four
  work periods, a PTO day, a minimum and an overtime week, compared with and without `[]`) and by
  `tests/equality.mjs` against the deployed build.

### Sanitizer bounds (`sanitizeRateChanges`, shared by `sanitizeData` and `makeJob`)

| Rule | Why |
|---|---|
| Not an array → field absent | Same as every other optional list. |
| Entry kept only if `from` is a real `YYYY-MM-DD` (`isISODate`) and `rate` is finite, `0 < rate <= 1000` | **Dropped, never clamped** — the `otMult` rule. A $0 "raise" would price every later shift at $0; above $1000/hr is corruption, not a raise. |
| Two entries on the same `from`: the **later one in the array** wins | The UI appends; a re-entered date is a correction. |
| Sorted ascending by `from` | `rateOn` walks it once. |
| At most `MAX_RATE_CHANGES` (24), keeping the **latest** 24 | Two years of monthly steps. The latest are the ones that price shifts she has not worked. |
| `rate` stored rounded to 4 dp | A real rate is fractional cents ($67.034424/hr, MLH 2023 stub); 4 dp keeps cents exact and stops float dust from a typed value. |

`applyData` is **authoritative** for the field (`setRateChanges(d.rateChanges || [])`), like
`pretaxHealth`: a blob that never heard of it clears it, so one account's raise never lingers into
another's on a shared phone. `resetToDefaults` clears it too.

The dormant jobs spine gets the same field (`makeJob` carries `rateChanges`, sanitized by the same
function) because a rate is what an employer decides; `activeJob` is built from App state as
before, so there is still exactly one source of truth.

## (b) Which date a shift belongs to

**Its date key — the day it starts.** An overnight shift that starts the evening before the raise
and ends after midnight is priced entirely at the old rate.

Why not split at midnight: every other attribution in the app already uses the start date — which
paycheck a shift lands in, which workweek its hours count toward, which day the calendar prints it
on. Splitting the rate alone would make one shift the only thing in the app divided at midnight,
and the Breakdown could no longer say "N shifts at $X". Many timekeeping systems attribute a shift
to its start date for exactly this reason, but employers differ, so this is a stated rule, not a
claim about hers. **Bound on the error:** one shift per raise, (hours after midnight) × (raise per
hour) — 7.5 h × $2 = $15 on a 12.5 h night. Raises usually start on a pay-period boundary, so the
Settings copy suggests that date, which makes the case moot.

## (c) PTO, derived overtime and the regular rate across a change

- **PTO** is paid at the rate on its own date (it has always been "hours × base, no differential";
  only *which* base is new).
- **A court / call-back minimum** tops up at the rate on its own date — `minimumTopUpCents` gets the
  dated base, so the Breakdown's minimum note still sums with gross.
- **Derived overtime, `regular-rate` method (the default).** Straight-time pay is computed per shift
  at that shift's own dated rate, then divided by hours worked in the work period. That is the FLSA
  regular rate: 29 CFR 778.109 — *"determined by dividing his total remuneration for employment …
  in any workweek by the total number of hours actually worked"* — and 778.115 (*Employees working
  at two or more rates*): the regular rate *"is the weighted average of such rates."* So a workweek
  that straddles a raise gets a weighted-average regular rate automatically; nothing is assumed.
- **`base-plus-diff` method (the shortcut).** Its premium base becomes the **hours-weighted average
  of the base rates** worked in that period. With one rate in the period it is that rate exactly
  (not a computed average), so no figure can move from float dust.
- **Not modeled:** 29 CFR 778.419 (*Hourly workers employed at two or more jobs*) lets an employer,
  **by advance agreement**, pay overtime at the rate of the work done *during* the overtime hours.
  That is a contract term this app has no way to know; the weighted average is the statutory
  default. A custom 7(k) period that straddles two paychecks prices each day of it at that day's
  rate, the same rule.

## (d) Where she enters it, and what the Breakdown says

**Settings → YOUR PAY**, under the base rate:

- A row **"Got a raise? New rate from [date] $[rate] [Add]"**. The date defaults to the start of the
  next pay period (the common case, and the one that makes (b) moot).
- Each saved change lists as **"From Oct 25, 2026 · $52.00/hr [Remove]"**. Remove asks first.
- When any change exists, the base field's label becomes **"Hourly rate before Oct 25, 2026"** —
  so editing it visibly applies only to earlier shifts. With none, it stays "Base hourly rate".
- One line of copy: *"Shifts on or after that date use the new rate. Shifts before it keep the old
  one."*
- Events: `rate_change_added` / `rate_change_removed`, props `{count}` (how many changes now
  exist) — **never a rate**, per the analytics rule.

**Never a "re-price everything" button.** Changing `baseRate` already does that, which is the bug.

**The Breakdown**, only when the period mixes rates, adds one note under Gross pay:

> *Priced at two rates: 4 shifts at $48.00/hr (before Oct 25), 3 shifts at $52.00/hr (from Oct 25).*

`periodPaycheck` returns `rates: [{rate, from, shifts, hours}]` — one entry per rate that priced
something in the period (PTO counts as hours, not shifts). A period at one rate shows no note.

### Previews

| Surface | Rate used |
|---|---|
| Hero, Breakdown, calendar cells, year view | each date's own rate |
| Add-Shift preview, its PTO "Paid at your base rate" line | the rate on the sheet's date |
| Pattern lab, Settings "≈ per shift" goal hint | the rate in force **today** (they are rate-of-thumb previews, not a dated paycheck) |
| Onboarding sample | unchanged — onboarding has no rate changes |

## Known limits (not built here)

- **Paystub import still writes `baseRate`.** With a raise entered, importing a post-raise stub
  would move the *pre-raise* rate and re-price history. Logged to `BACKLOG.md`; the fix is to have
  the import offer "New rate from [stub period start]" instead.
- Out of scope by the session brief: dated pay items (session 4), step tables / automatic
  anniversary raises, multiple jobs, the gateway.
