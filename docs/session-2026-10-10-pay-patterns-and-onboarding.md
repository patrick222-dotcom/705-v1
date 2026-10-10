# Session log — 2026-10-10: from "can it price a cop's paycheck?" to a multi-persona onboarding plan

Written at the end of the session as a handoff. This is the **decision record**: the reasoning
behind two research PRs and an approved plan, which the PRs themselves don't carry. The evidence
lives in `docs/police-pay-rules-draft.md` and `docs/pay-rule-patterns.md`; this file is what was
decided and what happens next.

---

## 1. What was asked, and what happened

It started as one question: a nurse user says Upper Darby (PA) police officers asked for the goals
feature, so can BadgeBudget price an officer's paycheck? It widened to "what would the pay model
need for police, nurses and any hourly worker with an unusual pay structure?" It ended with an
onboarding funnel, a clickable mockup, and an owner-approved build sequence.

| | |
|---|---|
| PR #164 (merged) | `docs/police-pay-rules-draft.md` — Upper Darby vs. the pay model |
| PR #165 (merged) | `docs/pay-rule-patterns.md` — 30 public contracts, the patterns, 12 missing primitives ranked |
| Mockup | https://claude.ai/artifact/Xt6xNpBXCrbTaFLBaAHMrV — clickable onboarding funnel, 390×844, the app's palette and fonts. Illustrative math only, not the engine |
| This PR | this log, the plan in `BACKLOG.md`, and the owner decision in `CLAUDE.md` |

Nothing in `index.html` changed.

## 2. What the research found

- **Upper Darby's police contract is not online.** The township's own budget and financial-plan
  PDFs summarize its pay terms (overtime 1.5× base outside the scheduled shift, 10% differential
  3 pm–7 am, 14 holidays at 2× if worked, longevity 3% per 5 years to 15%, pension 5% / 6.5%).
  Its FY2026 police FICA line is 1.75% of police pay, which points to **Medicare-only**
  (an inference, not read in a contract). Left on the default 7.65%, net comes out about 8% low.
- **Right-to-Know requests are not needed.** Ohio (766 current police units), New Jersey (555 police
  contracts running to 2024+, plus 556 arbitration awards) and Iowa publish current contracts by
  statute. Pennsylvania publishes nothing centrally, but the app never needs a contract: users
  bring their own numbers from a stub.
- **The overtime model is the biggest gap.** Probed with the app's own extracted core, a fortnight
  with no real overtime gets **phantom** overtime on every common non-8-hour police schedule:

  | Schedule | 40-hour week setting | 8/80 setting |
  |---|---|---|
  | 12 h Pitman 2-2-3 | +4.8% | +16.7% |
  | 12 h + 8 h Kelly day | +5.0% | +15.0% |
  | 3 on / 3 off, 10.5 h | +2.4% | +11.9% |
  | 4/10 | 0 | +10.0% |
  | 8 h 5-2 | 0 | 0 |

  There is no correct setting for 12-hour schedules (6 of the 21 police contracts read).
- **Police pay pattern:** a base (11 of 21 salaried), overtime triggered by working **outside the
  schedule** (13 of 21) rather than crossing 40, a tail of *events* (court and call-back minimums in
  21 of 21), and *dated* money (holiday cash, longevity, uniform) that lands in specific checks.
- **Five primitives close most of it**, all wage-core: a configurable work period (including "only
  overtime I flag"), a per-shift multiplier plus minimum hours, dated pay items, salaried base pay,
  and how a shift qualifies for its differential (start / majority / clock window).

## 3. Decisions (owner, 2026-10-10)

1. **Broaden beyond nurses with persona presets on one engine.** The personas are Healthcare, Law
   enforcement, Fire & EMS, and Other hourly. A persona sets starting values and decides which cards
   show; **it is never read by the pay math**. "Union" is a follow-up question, not a persona.
   Multiple employers are **jobs** (the dormant spine), not "sub-accounts".
2. **TurboTax-style interview, not a sign-up wall.** One question per screen, a live take-home meter
   from the moment a rate exists, a number within about a minute, then "save my setup" to create an
   account.
3. **Courtney's feedback: add PRN and part-time next to 3×12.** These became a separate **"How much
   do you work?"** row (Full-time / Part-time / PRN), because how often she works is a different
   question from how long a shift is. Full-time 3×12 is **72** hours a pay period, not 80.
4. **No early-access list for police and fire.** Proceed with the plan: nurse and general-hourly
   onboarding ships first on today's math. **Assumption (confirm if wrong):** the Law enforcement and
   Fire & EMS tiles appear only once the configurable work period ships, so no officer on a 12-hour
   schedule sees phantom overtime on day one.
5. **Tracking stays first-party.** Extend `track()` → `events` (`ob_view`, `ob_answer`, `ob_back`)
   rather than adding PostHog now. PostHog would be a sixth CDN script: Invariant 2 hash-pins
   exactly five, and PostHog's standard snippet loads code at runtime that can't be pinned. Its
   autocapture and session replay would also record on-screen dollar figures, which the analytics
   rule forbids. And a new processor means `privacy.html` and CSP changes. **Revisit** when masked
   session replay or A/B tests on the funnel are wanted.

## 4. The plan, in order

| # | Session | Wage-core? | Unlocks |
|---|---|---|---|
| 1 | **Onboarding v2 (Healthcare + Other hourly) + funnel tracking.** Spec first (`docs/onboarding-funnel-spec.md`), then build | Presets touch inputs only; the Healthcare preset must equal today's defaults exactly (pinned by a test) | The funnel, live; step-by-step data |
| 2 | **Configurable work period**: "only overtime I flag" plus N hours in D days | **Yes** | 12-hour police, 24-hour fire |
| 3 | **Per-shift multiplier + minimum-hours events** (court, call-back) | **Yes** | Police events; nurse 2× after 12 h |
| 4 | **Dated pay items** (lump sums, periodic pays) | **Yes** | Holiday cash, longevity, uniform; goal math that sees them |
| 5 | **Law enforcement + Fire & EMS personas** (presets, the Social Security question, cards) | Inputs only | The other two tiles |
| 6 | **Jobs**: stamp `jobId` (existing backlog item) → activate the spine → job switcher → migration 008 for one calendar feed per job | Grouping only | Paid details, per diem, second jobs |

Recommended for each: Opus 5.5 at **high** effort. Sessions 2–4 are wage-core and get the `wage-core`
skill's full protocol, including the equality check against the deployed build.

## 5. Open questions

1. How common is Medicare-only coverage among police? Philadelphia states it in contract text;
   elsewhere it is **unverified**. This decides whether the Social Security question goes to everyone
   or only to police and fire.
2. Can session 2 ship "flagged only" alone, without the N-in-D threshold? Yes, if "outside the
   scheduled tour" is always at least as generous as 7(k). Check one case: a 12-hour officer working a
   full extra tour inside a short week.
3. Salaried base pay (primitive 4 in `pay-rule-patterns.md`) and non-biweekly pay frequency
   (primitive 10) are the two expensive ones. Code ~100 current Ohio and New Jersey contracts before
   committing to either.

## 6. What is not in git

The contract corpus (≈60 PDFs and text files, the SERB index CSV, the PERC crawl) lived in this
session's scratchpad and is gone when the container is reclaimed. Every source URL is in the two
research docs, and both state indexes can be re-fetched (SERB needs a browser User-Agent; PERC sits
behind bot protection that needs a browser User-Agent and ~12 s between requests).
