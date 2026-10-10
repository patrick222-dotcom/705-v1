# Pay-rule patterns across police, nursing and other shift work: what the pay model would need

<!-- skeleton: corpus sections pending -->

## (c) The pay model today, in primitives

What `index.html` can express right now, read from the code (line numbers as of `37025f5`):

| Primitive | What exists | Where |
|---|---|---|
| Base pay | One hourly `baseRate` per job; gross = paid hours × rate. No annual-salary input, no flat salary per period, no step table, no effective dates | `makeJob` `:1649`, `shiftGrossCents` `:1803` |
| Premium forms | Per shift type: `dollar` (+$/h), `percent` (math + sanitizer only — Settings can't create one), `multiplier`. Per-hour bonus table (charge / preceptor / on-call). Flat $ per shift (`custom`) | `hourlyRateCents` `:1793`, `BONUS` `:871`, `addDiff` `:6219` |
| Premium scope | **Whole shift, one type per shift.** No clock-window split, no shift-start rule, no stacking of two premiums on one shift beyond one differential + one bonus | `shiftGrossCents` |
| Overtime triggers | Per-shift flag at a hard-coded **1.5×** of the differential-inclusive rate; plus derived FLSA OT on a **40 h week** or **8/80**. No 7(k) period, no daily-only, no annual, no "flagged only", no tiered multiplier | `otMult` in `shiftGrossCents`; `overtimePremiumCents` `:1701`; `WORK_PERIODS` `:1629` |
| OT rate basis | `regular-rate` (FLSA blended) or `base-plus-diff` for the derived premium; flagged shifts always 1.5 × (base + diff) | `OT_METHODS` `:1634` |
| Minimum-guarantee events | None. A call-back or court minimum is logged by hand as max(actual, minimum) | — |
| Paid time off | PTO hours × base rate, no differentials, not counted toward OT | `periodPaycheck` `:1972` |
| Lump sums | None as such; a one-off custom flat bonus on a shift is the workaround | — |
| Pay period | Always 14 days. `payFrequency` is stored on the job and read by nothing | `periodStartOf` `:798`, `makeJob` |
| Deductions | Pre-tax and post-tax as flat $; FICA 7.65% or a custom %; federal and state flat %; custom withholdings % or flat $ | `computeNet` `:1931` |
| Multiple employers | Spine exists and is dormant: `jobs`, `groupHoursByJob`, per-job OT grouping | `groupHoursByJob` `:1752` |
