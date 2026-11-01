# Session 2026-10-20 — dated pay items (session 4 of the multi-persona plan)

Dedicated wage-core session (Invariant 3). Spec: `docs/dated-pay-items-spec.md`, committed before
any code (`1925894`). Pre-flight: `node scripts/deploy_watch.mjs` → **LIVE**, serving `a103682`
(#187, effective-dated rates), after its own fetch. Branch cut from
`origin/claude/migrate-to-github-deploy-3F5RD`.

## 1. What was verified before building

- **No home for a dated payment existed.** `sanitizeData` had no such key; `periodPaycheck` summed
  shifts, PTO and the derived overtime premium only. The workaround (a custom flat bonus on a shift)
  is priced as part of that shift and is deleted with it.
- **"Goal math" today is three places, none of them a dated paycheck**: the Add-Shift sheet's
  per-shift goal line, the Pattern Lab's rotation average, and the Settings goal hint. So no
  existing goal line could "see December money"; what the future deadline feature needs is for
  `periodPaycheck` to carry it, which is what was built.
- **The app has no pay date.** A paycheck is the 14 days `payPeriodStart` is phase-aligned to.
  That decided (b) in the spec: items attribute by a date inside the period, and the Settings row
  says which paycheck the date lands in before she saves.
- **Citations were read from the text**, not recalled: 29 CFR 778.208, .209, .211, .212, .218, .219
  on law.cornell.edu, and IRS Pub 15 (2026) §7 on irs.gov. The fetch tool would not quote, so the
  pages were pulled with curl and quoted from the raw text.

## 2. What was built

`payItems [{id, label, cadence, date, amount | hours, withholding}]` on the job and at the top of
the blob (the `rateChanges` pattern). Four new wage definitions in the core `money` region —
`sanitizePayItems`, `payItemOccursOn`, `payItemOccurrences`, `payItemCents` — all in the gate's
wage list, which now also forbids `label` in any wage definition but the sanitizer.
`periodPaycheck` adds occurrences **after** the overtime premium (never into it, 29 CFR
778.209(a)), adds no hours, and returns `items` / `itemCents`; `computeNet` withholds a `bonus`
item's share of the income-tax base at a flat 22% (Pub 15 §7, method 1a), and not at all when
the regular federal rate is 0 (1a needs withholding on regular wages). Hours items price at
`rateOn` their own date. Settings: *EXTRA PAY ON A SET DATE*; Breakdown: *"Includes $X paid on a
set date: …"* plus the 22% line; year view: by month. Events `pay_item_added` / `pay_item_removed`
carry `{count, cadence}` only.

## 3. Proof

| Check | Result |
|---|---|
| Baseline before any code (deploy branch, clean archive) | gate 14/14, core 135/135, groom 33/33, smoke **817/817** |
| `node scripts/check_build.mjs` | 14/14, 38 wage definitions (34 before); the new `label` rule negative-tested (a `label` read injected into `periodPaycheck` fails it) |
| `node tests/core.test.mjs` | **175/175** (40 new) |
| Core mutants (18) | **18/18 caught** — month-end clamp, before-date guard, 22% vs her rate, the 0% edge, the cap at the income-tax base, dated vs global rate for hours, line rounding, clamp-not-drop, default withholding, both/neither, item hours leaking into hours worked, the max, the job mirror, the sanitizer key, the no-item early return |
| Differential sweep, deployed core vs new, 1,200 random fortnights × 4 lists (absent / empty / one-off after / annual outside) | **4,800 compared, 0 differ** (full JSON of `periodPaycheck`) |
| Pinned literals from the deployed module (`git show origin/…:…/badgebudget-core.mjs`), 4 work periods × 5 lists | identical — in `tests/core.test.mjs` |
| `tests/smoke.mjs` §50, iPhone 13 | **19/19**; 17 broken copies, 16 caught by §50 and the 17th (a one-off recurring yearly — no next-year date is on screen) caught by the core suite |
| full `tests/smoke.mjs` (clean archive of the branch) | **836/836** (817 + §50's 19); the deploy branch did not move during the session, so there was nothing to merge in |
| `tests/equality.mjs` vs badgebudget.com | **34 identical / 0 unintended / 5 of 5 named** — the four raise cases un-named and IDENTICAL, four new item identity probes IDENTICAL |

Every named difference was checked by hand against the rows it printed, e.g. the $600 bonus case:
federal $2,868 × 12% + $600 × 22% = $344.16 + $132 = **$476** ✓; the $4,510 lump in a 48-hour week
moves gross by exactly $4,510, so the overtime premium did not move ✓.

## 4. Not done, on purpose

- The 778.209 overtime true-up for a non-discretionary item (bounded at ~$29 a year in the worked
  example) and the period-date-vs-payday choice — both in `BACKLOG.md` → *Needs a dedicated session*.
- Per-item state withholding, end dates, non-taxable reimbursements. Spec → *Known limits*.
- Out of scope per the brief: salaried base, comp-time banking, the 0/+1 lag, the paystub
  `baseRate` overwrite, the Law enforcement and Fire & EMS tiles, jobs, the goal deadline feature.

## 5. After Pat merges

`git fetch origin claude/migrate-to-github-deploy-3F5RD`, then `node scripts/deploy_watch.mjs` must
read **LIVE naming the merge commit**. Then, in `tests/equality.mjs`, un-name the five dated-item
cases: from session 5 on they must come back IDENTICAL.

## 6. Kickoff prompt for session 5

```
Session 5 of the multi-persona plan: the Law enforcement and Fire & EMS persona tiles. Not
wage-core by design (a persona sets starting values and which cards show; the pay math never
reads it, and check_build.mjs fails if a wage definition names one), but it ships figures to new
users, so run the equality check anyway.

First run `node scripts/deploy_watch.mjs`. If it doesn't read LIVE naming the session-4 merge
commit (dated pay items), stop and say so. Then `git fetch origin
claude/migrate-to-github-deploy-3F5RD` and branch from `origin/claude/migrate-to-github-deploy-3F5RD`.

Read first: CLAUDE.md; docs/cos/now.md and docs/leadership.md; BACKLOG.md → "Needs a dedicated
session": the multi-persona plan item 5, "Session 5 inputs the field evidence adds", and the
"Paid on this check / the next check" item (it says to do the 0/+1 lag BEFORE session 5 — decide
whether it is in this session's scope or a blocker, and say which); docs/onboarding-funnel-spec.md;
docs/session-2026-10-10-pay-patterns-and-onboarding.md §3–4; docs/pay-rule-patterns.md (a), (c)
and (g) findings 2, 4, 5; docs/dated-pay-items-spec.md (longevity and holiday cash are now
dated pay items — a preset may suggest one, never invent an amount).

Verify every BACKLOG claim you build on against the code first; two of the last three sessions
found one false.

1. Spec first: extend docs/onboarding-funnel-spec.md before any code. It must answer: each tile's
   preset values (work period — 'flagged' or N-in-D, never the 40-hour week on a 12-hour tour —
   OT method, meal rule, FICA); the Social Security question (Medicare-only → FICA custom 1.45%),
   who is asked it, and its ob_answer whitelist values; the hourly-divisor question (police
   1,950–2,088, fire 2,080–2,994) and whether it is an input or a hint; what a leveled-pay
   firefighter is told, since salaried base (primitive 4) is out of scope; which cards show.
2. The gate: no phantom overtime on the probed schedules (12 h Pitman, 12 h + Kelly day, 24/48,
   48/96 with 212/28 and 182/24) under each new preset — assertions in tests/core.test.mjs.
3. Prove it: baseline first; an iPhone 13 smoke section driving each new tile to the done screen,
   numbered from the highest want(N) on the fetched deploy branch; negative-test every new
   assertion against a mutated copy; tests/equality.mjs with the five dated-item cases un-named.
4. Merge the latest deploy branch in before pushing, `node --check tests/smoke.mjs`, re-run.
5. Ship by the approval tiers in docs/leadership.md. New tiles change no existing figure, so if
   the equality check is all IDENTICAL it may auto-merge; if any case moves, it waits for Pat
   with a before → after card. Update BACKLOG.md, CLAUDE.md, docs/cos/now.md.
6. End with a session log and a kickoff prompt for session 6 (jobs).

Personal data: don't read anyone's user_data row without asking the owner. Out of scope: jobs
(session 6), salaried/leveled base, comp-time banking, the goal deadline feature.

Talk to the owner per CLAUDE.md: short, plain words, Next steps tagged (You)/(Me).
```
