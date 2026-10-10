# Can BadgeBudget price a police officer's paycheck? Upper Darby Township (PA), drafted from public sources

Research date 2026-10-10. **Provisional and research-only** — nothing here changes `index.html`, and every
gap below that moves a dollar figure is Invariant 3 work. It exists because a nurse user says Upper Darby
officers asked for the goals feature ("save $5,000 for a February trip: how much per paycheck, or how much
OT?"). Goals don't depend on profession; the pay math does. Every rule below was read in the source text
itself unless it is marked **unverified**.

## Verdict

**Over a goal horizon, probably yes, within ~5% — but only after about eight settings are changed from the
nurse defaults, and only if Upper Darby patrol works 8-hour tours (unverified).** Two things decide it.
(1) **Social Security:** the township's FY2026 police budget carries FICA of $361,562 against ~$20.6M of
police pay, i.e. 1.75% — consistent with Medicare-only (1.45%), not 7.65%. That is an inference from a
budget ratio, not a contract read, but if it holds, the default FICA alone understates take-home by ~8%.
It is a setting (FICA → Custom 1.45%), not code. (2) **Overtime on long tours:** the app *derives* FLSA
overtime from hours logged, and its only two work periods are a 40-hour week and hospital 8/80. Police
are on a §7(k) work period (up to 86 h per 14 days with no FLSA overtime), and Upper Darby's contract pays
overtime for work *outside the scheduled tour*, which the officer flags by hand. On 8-hour tours the 8/80
setting happens to produce zero phantom overtime (probed below), so config works. **On 12-hour tours no
setting works**: the 40-hour week adds +4.8% to every fortnight's gross, 8/80 adds +16.7%. **The cheapest
gap to close is one more `WORK_PERIODS` value** — "overtime only where I flag it" (or a 7(k) 86 h/14-day
threshold) — about ten lines in `overtimePremiumCents` plus a select option. **It is wage-core
(Invariant 3)**: it changes `overtimePremiumCents` and the work-period whitelist `sanitizeData` coerces
against, so it needs the `wage-core` protocol in a dedicated session, not a nightly. The second gap,
**salaried pay** (a flat check per period with only the premiums varying), is bigger and matters per
check, not on average — see (d).

## Sources (text read)

**The Upper Darby CBA itself could not be reached.** It is not posted on upperdarby.org (Council agendas,
Finance, Township Budget archive and the police department site were all checked), no Act 111 award for
Upper Darby turned up, and a PLRB search found no Upper Darby orders. What *is* public is the township's own
financial documents, which summarize the contract's pay terms. Those are the **UD** keys below: township
documents, **not contract text**, so every UD value is one step removed from the CBA. Getting the CBA
needs a Right-to-Know request to the township's Open Records Officer (see Next steps in the PR).

| Key | Document | What it is | URL |
|---|---|---|---|
| **UD-PFM** | *Township of Upper Darby Multi-Year Financial Plan* (PFM Group Consulting, 2023). "Other Cash Compensation" table, pp. 66–67; "Premium Pay" and "Overtime", p. 22 | A consultant's summary, for the township, of the FOP contract **then in force — the one that expired 2020-12-31**. Terms may have moved in the 2021+ award and the 2025 arbitration | https://www.upperdarby.org/DocumentCenter/View/270/2023-UDT-Strategic-Management-Five-Year-Planning-Program-Report-2023-PDF |
| **UD-ACFR** | *Upper Darby Township Financial Statements, December 31, 2024*. Notes: workforce, Police Pension Plan | Audited statements. Union headcount, FOP contract status, the police pension contribution rate and its source (ordinance) | https://www.upperdarby.org/Archive/ViewFile/Item/117 |
| **UD-B26** | *FY2026 Approved Budget*, General Fund, dept. 410 Police; *Mayor's 2026 Budget Message* | Budget lines for salaries, holiday pay, overtime, shift differential, FICA, clothing | https://www.upperdarby.org/DocumentCenter/View/310/2026-General-Fund-Budget-PDF · …/View/315/Mayors-2026-Budget-Message-PDF |
| **UD-HR** | UDPD *Application Booklet* (2026-07-31), "Work Schedules" | Recruiting packet. Describes the schedule shape, not the hours | https://udpd.org/wp-content/uploads/2026/07/Application-Booklet-2026-7-31.pdf |
| UD-BH2 (thin) | "Budget Hearing 2: Follow-Up", upperdarby.org news post, 2024-11-26 | The step plan. **The page now returns 404**; read only through a search engine's excerpt, so **unverified** | https://www.upperdarby.org/news/post/8717/ |
<!-- fallback-sources: pending -->

**Bargaining unit and lodge.** UD-ACFR: "137 employees are members of the Fraternal Order of Police." It
names no lodge. **Lodge 27 is unverified for Upper Darby**: it is the *Delaware County* lodge (PLRB final
order *FOP, Delaware County Lodge 27 v. Yeadon Borough*, PF-C-18-100-E; Upper Providence Township's 2025
salary resolution cites "FOP Lodge 27"), but no source found ties Upper Darby's unit to it.

**Contract status — the terms are unsettled right now.** UD-ACFR says both that the FOP agreement was
"renewed on January 1, 2025" and that "the FOP bargaining agreement that expired on December 31, 2024 is
currently in arbitration" — the two sentences conflict. The Mayor's 2026 message says the township is
"actively engaged in contract negotiations with our Police and Fire unions—one currently in arbitration"
without saying which. So any value below may be superseded by an award not yet issued.

## (a) Pay rules and how each source sets them

| Rule | Upper Darby (UD) | Cite |
|---|---|---|
| Base salary, steps | Steps run **5 years**; new officers start "$30,000.00 less than the base". No step table or dollar figures in any source read | UD-BH2 (**unverified**, page 404) |
| Step placement | Service-based: PFM models police salary growth as "service based", unlike 3.5%/yr for non-uniformed staff | UD-PFM; UD-BH2 |
| Across-the-board raises | 3.0% in 2019 and 2020; none in 2021–22 (contract expired, in arbitration); PFM *projected* 3.0%/yr after — a projection, not a term | UD-PFM p. 22 and ATB table |
| Tour length / rotation | "Rotating tours of duty (i.e., night work shift, day work shift)". Hours and cycle not stated | UD-HR "Work Schedules" |
| Overtime basis | "1.5 times their base hourly wage for working outside of regularly scheduled shifts" — a contract rule keyed to the tour, not to a 40 h week. The FLSA work period (7(k) or not) is not stated anywhere read: **unverified** | UD-PFM p. 66 |
| Shift differential | "An additional 10% of their hourly wage", police: "hours worked between 3 pm and 7 am" | UD-PFM p. 66; p. 22 |
| Holiday pay | "14 paid holidays per year. They can either use the paid holiday as time off, or work and receive 2.0 times their normal rate of pay." Also: "additional compensation for working overtime on certain holidays" (terms not given) | UD-PFM p. 66 |
| Longevity | "An additional 3% of their annual salary for every 5 years of completed service, up to a maximum of 15%." Frozen on DROP entry (UD-ACFR). Lump sum vs. per check: **unverified** | UD-PFM p. 66; UD-ACFR DROP note |
| Court time | "$40 per day that they are on standby for criminal proceedings in the Court of Common Pleas." A minimum for actual appearances: **not found**. Court practices were "restructured" in 2021 (−$130,000 OT) | UD-PFM pp. 22, 67 |
| Call-back minimum | **Not found** | — |
| Paid details / secondary employment | **Not found** | — |
| Clothing allowance | $750/yr | UD-PFM p. 66; UD-HR "yearly clothing/equipment allowance" |
| Education incentive | $200 (associate) to $400 (bachelor's) a year | UD-PFM p. 66 |
| Out-of-rank pay | "Additional compensation if they work in a higher rank temporarily" (amount not given) | UD-PFM p. 67 |
| Pension contribution | "5.00% of compensation … or 6.50% if hired before January 1, 2021", set by ordinance. Pick-up (pre-tax) status: **unverified** | UD-ACFR, Police Pension Plan note |
| Social Security | FY2026 police FICA line $361,562 on ~$20.65M of police pay (FT + PT salaries, holiday, OT, differential) = **1.75%**. Full coverage would be ~$1.58M. Reads as **Medicare-only for full-time officers — inference, unverified** | UD-B26, dept. 410 |
| Local taxes | Upper Darby resident and non-resident EIT **0%** (2023); **LST $52/yr** on anyone working in the township earning > $12,000 | UD-PFM Delco comparison table; LST section |
| Scale of each premium (FY2026 budget; 137 FOP members per UD-ACFR) | FT salaries $16.32M; overtime $2.50M; holiday $0.75M; shift differential $0.66M. Overtime is ~15% of FT salary — the "how much OT" half of the goal question is not a rounding error | UD-B26, dept. 410 |
| Pay frequency | **Not found**; biweekly assumed | — |

<!-- fallback-table: pending -->

## (b) Each rule against the model in `index.html`

What the code does was read, not assumed: `shiftGrossCents` (`index.html:1803`), `hourlyRateCents`
(`:1793`), `overtimePremiumCents` (`:1701`), `workPeriodChunks` (`:1693`), `WORK_PERIODS` / `OT_METHODS` /
`PAY_FREQUENCIES` (`:1629–1635`), `makeJob` (`:1649`), `periodPaycheck` (`:1972`), `computeNet` (`:1931`),
`BONUS` / `BONUS_LABEL` (`:871`), `DIFF_DEFAULTS` (`:826`), Settings → differentials (`addDiff`, `:6219`)
and Overtime (`:6256`).

| Rule (Upper Darby reading) | What the code does today | Class | How, or what's missing |
|---|---|---|---|
| **Base salary, by step** (annual) | One hourly `baseRate` per job; gross = paid hours × rate (`shiftGrossCents`) | fits with config | Enter annual ÷ annual scheduled hours. The app has no "annual salary" input |
| **Salary paid flat per period** | Every period is priced from the tours logged in it (`periodPaycheck`) | **needs new math** (per check) | Average over a goal window is right if the divisor is right; a single check is off by whatever the rotation puts above or below average. Gap 3 in (d) |
| **Step placement / anniversary step-up** | One rate, no effective date | fits with config (manual) | She edits the rate on the step date. Raises inside the goal window are invisible until then |
| **Overtime: 1.5 × base hourly, for work outside the scheduled tour** | Per-shift `isOvertime` pays 1.5 × the differential-inclusive rate (`shiftGrossCents`, `otMult`) | fits with config | Log the extra hours as their own shift, OT box ticked, type *Day (regular)* so the 1.5 × is on base only |
| **FLSA basis: §7(k) work period** (Upper Darby's period **unverified**) | Derived overtime on top, threshold from `WORK_PERIODS`: `'40'` (7-day chunks) or `'8-80'` only (`overtimePremiumCents`) | 8 h tours: fits with config (8/80). 12 h tours: **needs new math** | No 7(k) or "flagged only" option; the probe above shows +4.8% / +16.7% phantom on 12 h tours. Gap 2 in (d) |
| **Shift differential: +10% of hourly wage, 3 pm–7 am** | Differential per shift type; math supports `dollar`, `percent`, `multiplier` (`hourlyRateCents`), but Settings only *creates* `dollar` ones (`addDiff`) and can't switch type | fits with config | Set *Night* to +$ = 10% × base (re-enter after a raise). Whole-tour only: a tour straddling 3 pm or 7 am must be split into two shifts |
| **Holidays: 14 a year; off, or worked at 2.0×** | *Holiday* is a `multiplier` shift type (default 1.5) | fits with config | Set it to 2.0. A worked holiday on a night tour loses the 10% (one type per shift). Whether "2.0×" is total or salary + 1× extra is **unverified**; 2.0 matches either if the tour is logged as the holiday shift |
| **Longevity: +3% of salary per 5 years, max 15%** | Nothing by name | fits with config if paid each check; **needs new math** if a lump sum | Fold into base. Payment cadence **unverified** |
| **Court standby: $40 per day** (Court of Common Pleas) | `custom` bonus = flat $ per shift (`BONUS`, `shiftGrossCents`) | fits with config | $40 custom bonus on that day's tour; on a day off it needs a 0.1 h placeholder shift (hours must be > 0, `sanitizeData` `:1416`) |
| **Court appearance / call-back minimum hours** | — | fits with config (manual) | **Not in any UD source read.** If a minimum exists, log max(actual, minimum) as a flagged OT shift |
| **Clothing $750/yr, education $200–$400/yr** | No annual or one-off line | fits with config (hack) | One-off custom flat bonus in the check it lands in |
| **Paid details / secondary employment** | — | **needs new math** if through township payroll | **Not in any UD source read.** Hours would count toward derived OT; FLSA excludes them. Gap 7 in (d) |
| **Pension 5.00% / 6.50% of compensation** (UD-ACFR) | `pretaxDeductions`: one flat $, off both federal and state bases (`computeNet`) | fits with config | Flat $ per check. Doesn't scale with OT; PA taxes 414(h) pick-ups, so state is ~0.15% of gross low |
| **FICA: Medicare only** (budget-ratio inference, **unverified**) | `ficaType` `standard` 7.65% or `percent` (`computeNet`); the stub import sets `percent` from a stub's rate | fits with config | Custom 1.45%. Left at default: net ~8% low |
| **PA income tax 3.07%; LST $52/yr; Upper Darby EIT 0% (2023)** | Flat state %; custom withholdings % or flat $ | fits as-is / config | 3.07; LST as $2 flat per check; resident EIT depends where the officer lives |
| **Pay frequency** (**unverified**; biweekly assumed) | Periods are always 14 days (`periodStartOf`); `payFrequency` is stored on the job but read by nothing | fits as-is if biweekly; **needs new math** otherwise | — |

**Probe (2026-10-10), the app's own core, not a reimplementation.** One fortnight priced through
`periodPaycheck` from `supabase/functions/_shared/badgebudget-core.mjs` at an illustrative $45/h (not an
Upper Darby figure), no overtime actually worked:

| Schedule | Work period | Hours | Derived OT hours | Gross vs. straight time |
|---|---|---|---|---|
| 12 h Pitman (2-2-3), 84 h | 40 h week | 84 | 8 | **+4.8%** phantom |
| 12 h Pitman (2-2-3), 84 h | 8/80 | 84 | 28 | **+16.7%** phantom |
| 8 h, 5-2, 80 h | either | 80 | 0 | 0 |
| 8 h, six tours in week 1 (48 h), 72 h total | 40 h week | 72 | 8 | **+5.6%** phantom |
| 8 h, six tours in week 1 (48 h), 72 h total | 8/80 | 72 | 0 | 0 |
| 8 h, 5-2, plus 4 h court flagged OT (day off, or on a tour day) | 8/80 | 84 | 0 | +2.4% — the *real* 1.5× on the flagged 4 h; no double count |

So on 8-hour tours, **8/80 is the working setting** for an officer even though its label says "hospital":
an 8-hour tour never crosses 8 in a day, a fortnight of tours never crosses 80, and flagged overtime is
subtracted from the derived figure (`unflagged`, `:1735`). On 12-hour tours nothing works.

## (c) "Set up for an officer" card, 8 lines

What an officer must change from the nurse defaults, in the order the error is largest. Each line has a
blank she or he can correct; the values in bold are the Upper Darby reading above.

1. FICA: **Custom 1.45%** (Medicare only — **confirm on a stub**; if the stub shows Social Security, keep 7.65%). ____
2. Overtime starts after: **8 in a day or 80 in two weeks** (8-hour tours). On 12-hour tours: no setting is right yet. ____
3. Base rate: **annual salary incl. longevity ÷ hours actually scheduled in a year** (not ÷ 2080 unless the rotation really is 2080). ____
4. Night differential: **+$ equal to 10% of base**, applied to tours touching 3 pm–7 am. ____
5. Holiday: multiplier **2.0** on a worked holiday. ____
6. Pre-tax deductions: **pension 5.00%** (hired 2021+) or **6.50%** (before), as a flat $ per check. ____
7. State **3.07%**; custom withholding **$2 flat** (LST $52/yr ÷ 26); add a resident EIT % if the town you live in levies one. ____
8. Overtime shift type: **Day (regular)** with the OT box ticked, so it pays 1.5 × base, as the contract summary reads. ____

## (d) Open questions and gaps, smallest first

1. **Tour length and rotation (decides everything above).** UD-HR says only "rotating tours of duty
   (i.e., night work shift, day work shift)". The 3 pm–7 am differential window fits 8-hour tours
   (7–3 / 3–11 / 11–7) — **inference, unverified**. One officer's answer, or their rotation chart, settles it.
2. **A "flagged overtime only" work period** — the cheapest code gap. Wage-core. Covers 12-hour tours
   and any rotation that puts more than 40 h in a calendar week.
3. **Salaried base pay.** An officer's base check is the same every period (presumably annual ÷ 26 —
   **pay frequency unverified**); the app prices each logged tour. With a rotation that doesn't land the
   same hours every fortnight, a single check can be off by a tour (8 h of 80 = 10%), even though the
   average over a goal window is right when line 3 of the card is set honestly. Closing it means a job-level
   "salary per period" that `periodPaycheck` pays flat, with differentials, holiday and flagged overtime
   layered on. Bigger than gap 2, touches the hero, previews and goal lines — wage-core, its own session.
4. **Lump sums the per-paycheck model has no line for.** Clothing allowance $750/yr; education incentive
   $200–$400/yr; and longevity *if* paid as a lump sum rather than in each check (**unverified** — UD-PFM
   says only that it is "tracked along with salaries and wages"). Workaround today: a one-off custom flat
   bonus on a shift in the paycheck it lands in. Small (≤1% of annual pay) except longevity at 10–15%.
5. **Pension is a % in the contract, a flat $ in the app.** `pretaxDeductions` is one flat amount, so it
   won't grow with overtime if "compensation" includes overtime (**unverified**), and it also comes off the
   PA state base, which PA does not allow for a 414(h) pick-up — state tax understated by about 0.15% of
   gross. Small.
6. **Step increases mid-goal.** Steps run five years from a start ~$30,000 below base (UD-BH2,
   **unverified**). One base rate, no effective date: a step or contract raise inside the goal window is
   invisible until she edits the rate. Conservative direction (understates what she can save).
7. **Paid details / secondary employment.** Not in any UD source read. If Upper Darby runs details through
   township payroll at a set rate, a detail logged as a shift counts toward the derived-overtime hours,
   which federal law excludes for special detail work (29 CFR 553.227). Needs a per-shift "not hours worked"
   flag or the second-job spine (`groupHoursByJob`, `:1752`, which already exists for exactly this).
8. **Is the shift differential paid on overtime hours, and is overtime 1.5 × base or 1.5 × base+longevity?**
   UD-PFM says "1.5 times their base hourly wage"; whether longevity is in "base" is **unverified**. At 15%
   longevity and ~15% of pay in overtime, the difference is ~2% of gross.
