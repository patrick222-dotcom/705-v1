# Session log — 2026-10-11: pay events (session 3 of the multi-persona plan)

Dedicated wage-core session (Invariant 3). Spec: `docs/pay-events-spec.md`. Plan:
`docs/session-2026-10-10-pay-patterns-and-onboarding.md` §4.

## What was built

- **A marked shift pays its own multiplier.** `isOvertime` + optional `otMult` (1.5 < m ≤ 4; absent
  = 1.5). Replaces the hard-coded `otMult = s.isOvertime ? 1.5 : 1` in `shiftGrossCents`.
- **Minimum-hours events.** Optional `minHours` on any shift: the rate line pays max(hours worked,
  minimum); per-hour add-ons stay on hours worked. Optional `payEvent` (`court` / `callback` /
  `report`) is a label only.
- **The overtime rule follows 29 CFR 778.221–222.** Hours a minimum pays but she did not work never
  count toward the 40 h / 8-80 / N-in-D threshold, and the top-up stays out of the regular rate.
  778.221(b)'s own worked week is a core test ($552, 43 hours, not 44).
- **UI.** Add-Shift: rate chips (1.5× · 2× · 2.5× · 3× · other) under Overtime, and a closed-by-default
  *Minimum pay* row (Court · Call-back · Report pay → "Paid at least N hours"). The list row, template
  chip and preview name the rate and the minimum. The Breakdown says how much of gross is
  minimum-hours pay.
- Templates and pattern cells carry the fields (templates dropped the OT flag once before).
- `check_build.mjs`: three new wage definitions, and the persona rule now also forbids `payEvent`.

## Proof

| Check | Result |
|---|---|
| Baseline before any edit (clean worktree of `81c1954`) | gate 13/13, core 83/83, smoke 725/725 |
| After | gate 13/13, core 111/111, smoke 740/740 (§41 +15) |
| Negative tests | 23 mutations of a scratch copy; every new assertion seen failing |
| `tests/equality.mjs` vs badgebudget.com | 19 identical, 0 unintended, 4 of 4 named differences seen; each delta matches the hand math ($175, $150, $120, $75) |

## Decisions, and why

1. **The multiplier rides `isOvertime` instead of replacing it.** The flag is what already keeps a
   premium hour out of derived overtime, so any multiplier inherits "no hour paid a premium twice"
   with no new path. Absent = 1.5 keeps every saved shift identical.
2. **A range, not a whitelist, for the multiplier.** The California stub's 1.87× is most likely a
   missing pay component, but a bounded number lets her match a stub she can't explain.
3. **No pre-filled minimum.** Contracts run 2–5 h; a guessed default would move a figure she trusts.
4. **Always exclude the top-up from the regular rate**, though 778.221(a) includes *prearranged*
   payments. The app can't tell prearranged from not; the error is small and only under a derived
   rule in a week that also has derived overtime. Written in the spec.
5. **Nurse "2× after 12 h" = a second entry at 2×**, said in the hint text. The automatic daily
   trigger is primitive 11 and needs a no-pyramiding decision first.

## Found, filed

- **An iCal update drops hand-set fields** on a synced shift (`isOvertime`, `noMeal`, and now the
  three new ones). Pre-existing; `BACKLOG.md`.

## Not in git

The negative-test copies and the mutation list lived in the session scratchpad.

## Kickoff prompt for session 4 (paste as is)

```
Session 4 of the multi-persona plan: dated pay items — lump sums and periodic pays (holiday cash,
longevity, uniform allowance, comp cash-outs, ratification bonuses). This is WAGE-CORE
(Invariant 3): a dedicated session, following the wage-core skill's full protocol. Develop on a
fresh branch from the deploy branch head.

Where things stand: session 3 (pay events: per-shift multiplier + minimum hours) shipped as the PR
from `claude/pay-events-session-3`; confirm `node scripts/deploy_watch.mjs` reads LIVE before
starting, and if it doesn't, stop and say so.

Read first:
- CLAUDE.md
- BACKLOG.md → "Needs a dedicated session" → the multi-persona plan, item 4, and the goals item
  ("A goal has no deadline…") — session 4 is what lets goal math see December/January money
- docs/session-2026-10-10-pay-patterns-and-onboarding.md §4
- docs/session-2026-10-11-pay-events.md (this session) and docs/pay-events-spec.md, as the shape of
  a wage-core spec
- docs/pay-rule-patterns.md: (a) the holiday-pay and longevity rows, (d) row 3, (g) finding 7
- the wage-core skill

The gap: a payment that lands in a particular check (Hillsboro's January holiday lump sum,
Lakewood's June/December longevity, nurse ratification lumps of $1,000–$4,510) has no home. The
workaround is a custom flat bonus on a shift in that period, which mislabels it and vanishes if the
shift is deleted.

1. Spec first. Commit docs/dated-pay-items-spec.md before any code. It must answer:
   (a) The data shape: a list on the job (not a shift) of {id, label, amount, cadence, date(s)};
       cadence one-off / monthly / semi-annual / annual. Bounded, whitelisted values in sanitizeData.
       A blob without the list prices exactly as today.
   (b) Which paycheck an item lands in: the period containing its date. Say what happens when the
       date is a pay DATE vs a period date, and pick one.
   (c) Taxes: supplemental wages. Does the app's flat federal % stand in for the 22% supplemental
       rate, or is a per-item withholding choice needed? Check IRS Pub 15 (section 7) and cite it.
   (d) Regular rate: which items enter the FLSA regular rate (non-discretionary bonuses do,
       29 CFR 778.208–215; holiday pay for hours not worked doesn't, 778.219). Decide whether the
       derived overtime premium must be re-computed for a period with an item, and cite it.
   (e) Where she enters it (Settings, per job) and how the Breakdown and the goal lines show it.
2. Build in index.html inside the existing @core regions. Re-run node scripts/extract_core.mjs and
   commit both files. Add any new wage function to check_build.mjs's WAGE list.
3. Prove it: baseline probes first; new core assertions (an annual item lands in exactly one of 26
   checks; a semi-annual one in two; a one-off outside the visible period moves nothing; an absent
   list is byte-identical); a smoke section on iPhone 13 that drives entry and reads the hero and
   Breakdown; negative-test every new assertion against a broken copy, never the working tree;
   tests/equality.mjs against badgebudget.com with 0 unintended differences and each new case named.
4. Ship: PR to the deploy branch, opened ready with auto-merge OFF, because wage-core waits for the
   owner's merge. Say so in the PR and in your reply. Update the wage-core skill, BACKLOG.md and
   CLAUDE.md. After he merges, confirm node scripts/deploy_watch.mjs reads LIVE.
5. End with a short session log in docs/ and a ready-to-paste kickoff prompt for session 5.

Out of scope: salaried/leveled base (primitive 4), effective-dated rate changes (7), comp-time
banking (8), the 0/+1 paycheck lag for custom periods, the Law enforcement and Fire & EMS tiles
(session 5), jobs (session 6), and the goal deadline feature itself (only make sure goal math reads
the new items).

Talk to the owner per CLAUDE.md: short, plain words, with Next steps tagged (You)/(Me).
```
