# Onboarding v2 — funnel spec (session 1 of the multi-persona plan)

Written 2026-10-10, before the build, as the plan's first step requires. Decision record:
`docs/session-2026-10-10-pay-patterns-and-onboarding.md`. Mockup (design reference, illustrative
math): https://claude.ai/artifact/Xt6xNpBXCrbTaFLBaAHMrV, `project/Main.dc.html`.

**The one rule this spec is built around: the funnel sets inputs, the pay math prices them.** Every
answer below lands in a field the app already has (or one of three new, non-pay fields), and every
dollar figure the funnel shows comes from `periodPaycheck` — the hero's own function. No wage-core
function changes. Nothing in this spec turned up a pay-math change, so the build proceeds without a
stop (see "What this does not do" for the two places that came close).

## Screens

Seven screens, one question each. `ob_step` keeps its existing contract (fires once per furthest
step reached); the index below is its new meaning **from the deploy date of this change** — 0 and 1
mean what they always meant ("saw the welcome", "left it"), 2+ are new.

| # | `screen` | Question / content | Answers (`ob_answer {q,a}`) | Sets |
|---|---|---|---|---|
| 0 | `landing` | "Know your paycheck before you work the shift." + the existing derived sample card (`sampleNet`, 72 h). CTAs: **See my next paycheck**; *Already have an account? Sign in* | — | nothing. Sign in opens the existing `AuthModal` |
| 1 | `persona` | "What kind of work do you do?" Two tiles: **Healthcare**, **Other hourly work** | `persona`: `healthcare` · `other` | `persona` (new) + applies that persona's preset (below) |
| 2 | `shift` | "How long is your usual shift?" 8 / 10 / 12 hours | `shift`: `8` · `10` · `12` | nothing saved — seeds the first estimate only |
| 3 | `status` | "How much do you work?" Full-time / Part-time / PRN | `status`: `ft` · `pt` · `prn` | `workStatus` (new) + seeds the first estimate |
| 4 | `union` | "Is your pay set by a union contract?" Yes / No / Not sure | `union`: `yes` · `no` · `unsure` | `union` (new). `yes` adds a union-dues field to screen 6 |
| 5 | `pay` | "Let's find your pay." Scan a stub (PDF, on-device) · or Hourly / Salary + amount · or *use an example rate* | `pay`: `stub` · `hourly` · `salary` · `example` | see "Pay" |
| 6 | `extras` | "What else shows up on your check?" Toggles from the persona's list, union dues if `union=yes`, and a read-only overtime line | `x_diffs` · `x_evenings` · `x_weekend` · `x_holiday`: `on` · `off` | `differentials[k].active`; `posttaxDeductions` (dues) |

Then **See my paycheck** finishes setup and lands on the planner, whose hero *is* the result screen —
the same thing the old `rough` path already did.

Single-choice screens (1–4) advance on tap; the choice stays highlighted (`aria-pressed`) if she
comes back. Every funnel screen has a Back button (`ob_back {from}`) and a header meter, "Next check,
take-home", which reads "—" until a rate exists and then shows `periodPaycheck(...).net` over the
schedule her answers seed. The figure it shows on screen 6 is the figure the hero shows after
finishing; `tests/smoke.mjs` §38 asserts they are equal.

**Not shown:** Law enforcement and Fire & EMS tiles (they wait for the configurable work period —
on 12-hour schedules today's 40-hour rule invents overtime), a 24-hour shift tile (the same reason:
it is the back door a firefighter would take into "Other hourly"), and any waitlist.

## Personas — a preset table in `@core:begin personas`

A persona sets **starting values** and **which cards show**. It is never read by the pay math:
`scripts/check_build.mjs` walks the body of every wage-core function and fails if one references
`persona`, `workStatus`, `union` or the preset table.

| Field | Healthcare | Other hourly |
|---|---|---|
| `baseRate` (the example rate) | **65.15** | 25.00 |
| `federalTaxRate` / `stateTaxRate` | **12 / 2.5** | 12 / 2.5 |
| `pretaxDeductions` / `posttaxDeductions` | **0 / 0** | 0 / 0 |
| `ficaType` / `ficaPct` | **standard / 7.65** | standard / 7.65 |
| `workPeriod` / `otMethod` | **'40' / 'regular-rate'** | '40' / 'regular-rate' |
| `mealBreakMins` / `mealBreakMode` | **30 / 'included'** | 30 / 'included' |
| `differentials` | **`DIFF_DEFAULTS`** (night +$10, weekend day +$11.50, weekend night +$16.50, holiday 1.5×; weekday evening off) | evening +$1.00 on, night +$1.50 on, weekend +$1.00/+$1.50 off, holiday 1.5× on |
| sample mix | rotating (nights + weekends, today's) | days (all `base`) |
| extras offered | `diffs` (night + weekends), `holiday` | `evenings` (evening + night), `weekend`, `holiday` |
| cards | NurseGrid sync card shown | NurseGrid sync card hidden |

**Healthcare is today's defaults exactly** (bold column). It is not a copy of them: App's initial
state, `resetToDefaults` and the example-rate path now read the preset, so there is one source, and
`tests/core.test.mjs` pins every value against a literal so the source cannot drift either. Picking
Healthcare on a first run is therefore a no-op on every pay input.

Other hourly's differential amounts are illustrative starting values inside the $0.35–$2.75/h range
`docs/pay-rule-patterns.md` observed for non-nurse differentials. They cannot move its first
estimate — that schedule is all day shifts — and the estimate banner says to sharpen them.

Applying a preset sets the employer-side fields (rate, differentials, work period, OT method, meal
break). Taxes are user-level (`makeJob`'s comment) and identical in both presets, so a persona
switch never touches them. A persona switch after the pay step keeps the rate she gave, and after a
stub keeps everything the stub wrote.

## How Full-time / Part-time / PRN seed the first estimate

Through the existing sample-shift path, not new math. `buildSampleShifts(startISO)` gains optional
`{hours, perWeek, mix}`; called with none it returns exactly what it returns today (six 12-hour
shifts on days 1–3 and 8–10, weekend → `weekend-day`, odd day → `night`, else `base`), pinned in
`tests/core.test.mjs`. Every seeded shift carries `patternId: SAMPLE_PATTERN_ID`, so **Clear the
sample** removes exactly what was seeded.

| Shifts per week | 8 h | 10 h | 12 h |
|---|---|---|---|
| Full-time | 5 (80 h/period) | 4 (80 h) | **3 (72 h — "3×12")** |
| Part-time (~24 h/week) | 3 (48 h) | 2 (40 h) | 2 (48 h) |
| PRN | 1 (16 h) | 1 (20 h) | 1 (24 h) |

Days 1..n of each week, so no seeded week passes 40 hours: under the 40-hour week both presets
use, the first estimate never carries overtime. (Under 8/80 a 10- or 12-hour shift is overtime past
hour 8 by definition — real overtime, not a seeding artefact — and the funnel never selects 8/80.) Mix is `rotating` only when the persona's mix is rotating
**and** the night/weekend extra is on — turning differentials off must not leave seeded night shifts
priced with them (`active:false` never stops pricing a shift already tagged with it).

**The equality the build must hold:** Healthcare · 12 h · Full-time · example rate produces the same
state the old *Show me an example* path wrote (`baseRate` 65.15, `buildSampleShifts(today's period)`,
`estimateMode:'sample'`, every other field at its default), so its hero equals the old path's hero.
§38 asserts it three ways: funnel hero = hero of a context seeded with the old path's state =
`periodPaycheck` from the extracted core.

## Pay

| Choice | Writes | `setup_completed {mode}` | Banner |
|---|---|---|---|
| Stub | `applyPaystub` as today (rate, period start, pretax, state, FICA, differentials). During onboarding it now **continues to screen 6** instead of ending setup | `full` | "Starting schedule" + Clear the sample |
| Hourly | `baseRate` | `rough` | "Rough estimate" + Sharpen it / Clear the sample |
| Salary | `baseRate = round(salary ÷ 2080, cents)`, shown to her as the hourly figure before she continues | `rough` | as Hourly |
| Example | `baseRate` = the persona's example rate | `sample` | "These are example numbers" + Enter my rate / Clear the sample |

`setup_completed`'s three modes keep their meaning: `full` = her own figures beyond the rate (a stub
is the only way now), `rough` = her rate on default differentials and taxes, `sample` = nothing of
hers. The banner now also shows while any seeded shift remains, so a seeded schedule can never sit
in the hero unlabelled.

## Events

All four `ob_*` events go through `obEventProps(name, props)` in the core, which returns only
whitelisted keys with enumerated values, or `null` — and a `null` is not sent. No answer that is a
number she typed (rate, salary, dues) is ever a value; `pay` records *how* she answered, never what.

| Event | When | Props |
|---|---|---|
| `ob_view` | each time a screen is shown, once onboarding is actually visible (the same `ready && !setupComplete` guard as `ob_step` 0) | `{screen}` ∈ the seven names |
| `ob_answer` | each answer | `{q, a}` per the screens table |
| `ob_back` | Back pressed | `{from}` = the screen she left |
| `ob_step` | unchanged mechanism, new indices 0–6 | `{step}` |
| `setup_completed` | finish, unchanged | `{mode}` |
| `paystub_imported` | unchanged | `{shifts}` (row count) |

The funnel query is `scripts/onboarding_funnel.sql`: devices per screen, answer mix, back-outs and
completion, from the deploy date, excluding the harness's Playwright fingerprint (`iPhone OS 15_0` +
`Version/18.0`), `nostore-%` ids, builder accounts' devices, and crawlers — redefined there, because
`ob_step 0` and now `ob_view landing` fire on arrival, so "fired something besides `app_open`" no
longer separates a human from a bot that runs JavaScript.

## New saved fields

`persona` (`healthcare`|`other`), `workStatus` (`ft`|`pt`|`prn`), `union` (`yes`|`no`|`unsure`). In
`serializeState`, whitelisted in `sanitizeData` (anything else is dropped, never coerced), hydrated
authoritatively by `applyData` (a blob without them clears them, so an account blob is never
contaminated by a different visitor's answers), cleared by `resetToDefaults`. Unit-tested in
`tests/core.test.mjs`. Existing blobs have none of the three, which reads as "never answered":
nothing defaults to Healthcare silently.

## What the current `Onboarding` component keeps or replaces

| Today | v2 |
|---|---|
| Welcome: copy, derived sample card, *Get my estimate*, *Scan a paystub instead*, sign-in footlink | **Kept** card and sign-in; copy rewritten for both personas (still leads with the paycheck, no swap claim); CTA is *See my next paycheck*; the stub moves to the pay screen |
| Step 1 base rate + *See my estimate* / *Add my differentials & taxes* / *Show me an example* | **Replaced** by the pay screen; *Show me an example* survives as the example-rate link |
| Step 2 differentials (every key, toggles) | **Replaced** by screen 6's persona-scoped toggles; per-key amounts stay in Settings |
| Step 3 taxes | **Dropped** from the funnel — defaults plus the "Rough estimate" banner's *Sharpen it*, which is what the short road already did |
| Step 4 "You're all set" + name field | **Dropped** — the planner hero is the result. Name stays editable in Settings |
| `finish(mode)` modes, `ob_step`, `setup_completed`, `sampleNet` | **Kept**, unchanged in meaning; `sampleNet` itself untouched |

## What this does not do

- **Salary is converted, not modelled.** A true salaried base (same pay every check, primitive 4 in
  `pay-rule-patterns.md`) is wage-core and out of scope. ÷2080 is right for an 80-hour fortnight and
  10% low for a 72-hour one, so the pay screen says the rate it will use.
- **8/80 and daily overtime are not offered.** The overtime line on screen 6 states the rule in use
  (40-hour week) and points at Settings; switching rules is a wage-affecting choice the funnel does
  not make on her behalf.
- **A synced calendar does not replace the seeded schedule.** A nurse who connects NurseGrid after
  onboarding sees both until she taps *Clear the sample*; the banner stays up while seeded shifts
  exist. Logged in `BACKLOG.md` as a follow-up.
- No PostHog, no jobs, no police/fire tiles, no work-period, multiplier or dated-pay changes.
