# FICA on pre-tax health premiums: spec

Dedicated wage-core session, 2026-10-11 (Invariant 3). Backlog item: "FICA is charged on pre-tax
health premiums". Evidence: `docs/pay-rule-patterns.md` (g) finding 1.

## The rule

| Deduction | Federal / state income tax | Social Security + Medicare (FICA) |
|---|---|---|
| 401(k), 403(b), 457(b) deferrals | exempt | **taxed** |
| Section 125 health, dental, vision premiums; health FSA; HSA through payroll | exempt | **exempt** |

Source: IRS Pub 15 and 15-B, plus the IRS cafeteria-plan FAQ for government entities.

**Checked against the California stub this session:** 1.45% × ($9,820.04 − $266.03) = $138.533 →
**$138.53**, the printed Medicare line. On full gross it would be $142.39. The stub has **no Social
Security line** (the department is Medicare-only), so the SS half is **not confirmed from a stub**.
It rests on the IRS rule, which treats both FICA halves the same way. To verify it, run one of
Courtney's stubs through: SS ÷ 0.062 vs gross − medical.

## Fields

- `pretaxDeductions` stays the **retirement** bucket (FICA-taxable). The blob key does not change
  (Invariant 5 spirit: the key is data). Only the UI labels change.
- **New:** `pretaxHealth`, in dollars per pay period. It covers health, dental and vision premiums,
  health FSA and payroll HSA. It is FICA-exempt and income-tax-exempt.
- `sanitizeData` keeps `pretaxHealth` only when it is a finite number **≥ 0**. Anything else is
  dropped. This is stricter than `pretaxDeductions` on purpose: a negative premium would *raise*
  the FICA base.
- `applyData` treats it as **authoritative**: a blob without it sets 0. So one account's premium
  never lingers into another account's blob, and a blob that has never heard of the field prices
  exactly as it does today.
- `serializeState`, the save effect's dependency list, `resetToDefaults` and `taxInputs` all carry it.

## How existing data maps

Every saved `pretaxDeductions` stays in the retirement bucket, and `pretaxHealth` is absent, so it
reads as 0. **No existing figure moves.** That is the equality claim. A nurse who had typed her
health premium into the old combined field keeps today's (over-taxed) figure until she moves it to
the new field. We can't tell her 403(b) from her premium inside one number, so we don't guess.

The paystub import only ever filled `pretaxDeductions` from a `403(b)` line, so everything saved by
a scan is already in the right bucket.

## `computeNet`

```
health        = toCents(t.pretaxHealth)
ficaBase      = taxable − min(health, max(0, taxable))   // = taxable exactly when health = 0
incomeTaxBase = max(0, taxable − pretax − health)
fica          = ficaBase × (7.65% | custom %)
fed, st, % custom withholdings: × incomeTaxBase (as today)
ded           = pretax + health + fica + fed + st + posttax + cw
```

The two bases stay separate. **Never collapse them.** A custom FICA % applies to `ficaBase`, because
it is a rate, and the exemption is a base question, not a rate question.

**Display caps** (so the Breakdown still sums). Rows are capped in display order: retirement, then
health, then post-tax:
`dispPre = min(pretax, cap)`, `dispHealth = min(health, cap − dispPre)`,
`dispPost = min(posttax, cap − dispPre − dispHealth)`.
With `health = 0`, every capped figure is today's. The function returns a new `health` field (the
capped display figure). `net` uses the uncapped figures, as today.

## `keepRatioOf`

Unchanged: it is a rates-only preview. A flat premium is a dollar amount per paycheck, not a rate,
so it stays out, for the same reason flat custom withholdings do. A comment says so.

## UI

- **Settings → Deductions · per pay period**: three fields. *Retirement (pre-tax)*, with the hint
  "401(k), 403(b), 457(b)". *Health (pre-tax)*, with the hint "medical, dental, vision, FSA, HSA".
  *Post-tax*, unchanged. One line under them: health premiums also skip Social Security and
  Medicare, and retirement doesn't.
- When FICA is **Custom %** and a health premium is set, a note appears. A custom % back-solved from
  a stub (FICA ÷ gross) already folds in the premium's exemption, so entering the premium would
  count it twice. That is about 7% of the premium, ~$18 on $266. The note says to switch FICA back
  to Standard after entering the premium. The paystub scan sets exactly such a %, which is why the
  note exists.
- **Breakdown** rows: `Pre-tax · 401k, health` becomes **`Pre-tax · retirement`**, and a new
  **`Pre-tax · health, dental, vision`** row follows it. A zero row is hidden, as today.
- **Paystub review sheet**: "Pre-tax deductions" becomes "Retirement (pre-tax)". That is the only
  thing the scan has ever put there.

## Paystub import: left as is

The parser is a set of regexes tuned to one payroll layout, Courtney's Workday-style stub (`Fed
MED/EE`, `Fed OASDI/EE`, `PA W/H`, `403(b)`). Its only fixtures come from that layout, and **no
fixture carries a medical, dental or vision line**. The California stub is not in the repo as a PDF.
A medical regex written blind would be a guess on a wage path, and "reads it reliably" can't be
shown without a real line to read. So the import keeps mapping `403(b)` only, and that line goes
into the retirement bucket, which is correct. Next step when a stub with a medical line is in hand:
add it as a fixture and map it to `pretaxHealth`.

## Personas

`pretaxHealth: 0` is added to both presets. The `tests/core.test.mjs` "Healthcare = today's
defaults" literal gains `pretaxHealth: 0`, and the "persona never moves tax" list gains it too.
`check_build.mjs`'s persona rule is untouched (`computeNet` names no persona).

## Tests

**Core** (`tests/core.test.mjs`):
- **California stub:** Medicare at a custom 1.45% on $9,820.04 with a $266.03 premium is exactly
  **$138.53**. The same $266.03 in the retirement bucket gives $142.39.
- **Retirement money is still FICA-taxed:** $1,000 with $100 retirement → FICA $76.50, income tax
  on $900.
- **Health is exempt from both:** $1,000 with $100 health → FICA $68.85, income tax on $900.
- **An existing blob prices identically:** five fixtures. Every pre-change output key is
  hand-written as a literal captured from the pre-change build, and the new `health` key is 0.
- **Sanitizer:** keeps 266.03 and the string "50", and drops −5, NaN, "abc" and Infinity.
- **Breakdown sums under the cap:** rows + taxes + net = gross when the deductions exceed what
  gross can absorb.
- **Presets:** updated literal.

**Smoke** (`tests/smoke.mjs` §40):
- Settings shows both labelled fields.
- Typing a premium into the health field saves `pretaxHealth`, leaves `pretaxDeductions` alone,
  and moves the hero.
- The Breakdown shows both rows with their figures, and gross − rows = take-home.
- The custom-% note appears only with a custom % and a premium.

Every new assertion is negative-tested by breaking the behaviour in a scratch copy.

**Equality** (`tests/equality.mjs` against badgebudget.com):
- Every existing case comes back IDENTICAL.
- One named case, *health premium*, is an **intended difference**: deployed drops the field, so its
  FICA and income tax run on the full gross.
- The Breakdown label rename (`Pre-tax · 401k, health` → `Pre-tax · retirement`) is the one
  **named text change**. The script maps the deployed label to the new one before comparing, and
  says so in its output, so every *figure* is still compared byte for byte.

## Out of scope

Session 3 (multipliers, minimum hours), the overtime pay-lag setting, the Social Security question
for police and fire, the 0.9% additional Medicare, the Social Security wage-base cap, and a medical
line in the paystub import (above).
