# Session log — 2026-10-10/11: onboarding v2, the configurable work period, and field evidence

Handoff record for the session that built sessions 1 and 2 of the multi-persona plan
(`docs/session-2026-10-10-pay-patterns-and-onboarding.md`). The PRs carry the code; this file carries
what was decided, what was found, and what the next session starts from.

## What shipped (all confirmed LIVE with `node scripts/deploy_watch.mjs`)

| PR | What | Live as |
|---|---|---|
| #167 | **Session 1 — Onboarding v2 (Healthcare + Other hourly) + funnel tracking.** Seven screens (landing → profession → shift length → How much do you work? → union → pay → extras), live take-home meter, persona presets in `@core:begin personas`, `ob_view` / `ob_answer` / `ob_back`, `scripts/onboarding_funnel.sql`. Spec: `docs/onboarding-funnel-spec.md` | `71a311b` |
| #168 | **Session 2 — Configurable work period** (wage-core, owner-merged). "Only the shifts I mark as overtime" and N hours in a D-day period (7–28 days, may straddle two paychecks; overtime counted in the check holding the period's last day) | `7aa590a` |
| #169 | **Docs — field evidence against the pay model.** `docs/pay-rule-patterns.md` (g) and three `BACKLOG.md` items | `3532234` (docs only; app bytes unchanged) |

Test figures at the end of the session: gate 13/13, core 71/71, smoke 694/694 (CI read, not the badge).
Every new assertion in both sessions was seen failing against a deliberately broken copy.

## Decisions made in this session, and why

1. **Personas never reach the pay math, and a machine enforces it.** `check_build.mjs` walks 28
   wage-core definitions as an AST and fails if one names a persona, work status, union answer or the
   preset table. The rule existed only in prose before.
2. **The Healthcare preset *is* today's defaults, not a copy of them.** App's first-run state and
   `resetToDefaults` read the preset, and `tests/core.test.mjs` pins every value against hand-written
   literals. Two sources would eventually drift.
3. **No 24-hour shift tile yet.** It is the back door a firefighter would take into "Other hourly",
   and fire is gated on the work period plus leveled pay.
4. **Salary is converted (÷2,080), not modelled.** The pay screen prints the hourly rate it will use.
   A true salaried base is primitive 4 and wage-core.
5. **A scanned stub continues the funnel** instead of ending setup on an empty planner.
6. **`'40'` and `'8-80'` kept their original code path line for line** when the work period became
   configurable, so the equality check against the deployed build could prove no existing figure moved
   (14 identical, 0 unintended, 2 of 2 named differences seen).
7. **A 7(k) period's overtime lands in the paycheck holding the period's last day.** The federal
   default (29 CFR 778.106). Later evidence showed some departments pay one check later; filed as a
   setting rather than changed (see below).
8. **The owner merges wage-core PRs.** #168 waited for "merge 168"; the docs and onboarding PRs
   auto-merged.

## What was found

- **The app overcharges FICA on pre-tax health premiums** (wage-core bug, verified three ways: a real
  California police stub to the cent, LaSalle IL's payroll table, IRS Pub 15 / 15-B). Section 125
  premiums are FICA-exempt; 401(k)/403(b)/457(b) deferrals are not. The paystub import only ever reads a
  403(b) line into the pre-tax field, so every saved value today is retirement money.
- **Police and fire are often Medicare-only** (115 of 115 Illinois officer rows; IAFF ~75%).
- **Some departments pay 24-day 7(k) overtime one check later** (Cambria CSD, 27 of 31 cycles).
- **Hourly divisors range 1,950–2,994**, and fire pay is often leveled.
- **The planner scrolls sideways by 31 px on a 320 pt phone** (pre-existing; signed-out top bar).
- **The landing's sample card ($4,147) and the example path ($4,053) disagree** (pre-existing;
  `sampleNet` is wage-core).
- **Real public pay stubs are nearly unreachable to automated search** (Reddit, imgur and nurse forums
  block it). Real stubs from users will beat any further scraping.

All of these are filed in `BACKLOG.md` with evidence links in `docs/pay-rule-patterns.md` (g).

## Order from here (owner's pick, 2026-10-11)

1. **Next: the FICA health-premium fix** (wage-core, dedicated session) — before session 3, because it
   affects nurses on the app today while session 3 serves police who aren't on it yet.
2. Session 3 — per-shift multiplier + minimum-hours events (court, call-back).
3. The "paid on this check / the next check" lag for custom work periods — before session 5.
4. Session 4 — dated pay items. Session 5 — Law enforcement + Fire & EMS personas (with the Social
   Security question, the hourly divisor as an input, and leveled fire pay). Session 6 — jobs.

## Not in git

The three full research reports (examples tables, per-question tallies, every search tried) and the
negative-test copies lived in the session scratchpad and are gone when the container is reclaimed.
Every source that carries a recorded finding is linked in `docs/pay-rule-patterns.md` (g).
