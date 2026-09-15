# The development council

The council is BadgeBudget's comprehensive review: every lens over every slice it owns, each finding
adversarially verified before it reaches the owner, and a score out of 10 per lens with the bar at 8.
It exists twice over — once to keep the app honest, and once as the project's **meta-goal**, which is
a *reusable* multi-agent review process (`CLAUDE.md`, "Two goals").

Until 2026-09-13 it was not reusable: the 2026-07-30 run was ad-hoc, and nothing in the repo
represented it. Same silent-dependency shape as the nightly Routine — delete the session and the
process is gone. The charter is this file; the runnable form is `.claude/workflows/council.mjs`.

## The standard

1. **Every lens scores ≥ 8/10.** Below 8 means work remains, and the lens must say what would clear it.
2. **Every finding is adversarially verified** before it counts. Three refuters per finding, each
   given a *different* angle — already handled elsewhere / path unreachable in the shipped UI /
   outcome is actually intended — and the finding dies on a majority refute. Three copies of the same
   skeptic is redundancy, not verification. The 2026-07-30 run's credibility came from exactly this:
   30 confirmed, 2 rejected. A run that rejects nothing did not verify anything.
   **A dead refuter is not a vote.** A finding needs at least two *live* verdicts to count either
   way; with fewer it is reported as `unverified`, never as confirmed. The first automated run
   (2026-09-13) lost every refuter to a usage limit and, because the script only counted refutes,
   all 25 findings sailed through with an empty dissent list — a run that verified nothing and
   reported 25 confirmations. The script now carries that floor.
3. **A score without `ranAgainst` is a badge, not a result.** Every lens states which functions and
   line ranges it actually read. Zero findings is not automatically a 10 — a lens that could not
   examine something it owns must say so and score accordingly.
4. **No silent caps.** If a run bounds coverage, it says what it dropped.

## Scope: the app as it stands, never a diff

Reviewing "what changed since last time" misses everything the diff didn't touch, and after 55
commits the diff is most of the file anyway. The council reviews current state. This also means a
change shipped the same day is in scope rather than quietly exempt — including changes made by
whoever scoped the run.

## The matrix

**13 slices × the lenses that own them = 56 review cells.** Every slice is owned by at least one
lens; no lens is pointed at a slice it has no purchase on, because a lens with nothing to say still
costs a full agent and dilutes the run. `code-quality` is the one lens that owns all 13.

Slices: `boot`, `wage-core`, `money-surfaces`, `calendar`, `add-shift`, `pattern-lab`, `onboarding`,
`settings-etc`, `swap-board`, `data-sync`, `calendar-sync`, `telemetry-auth`, `infra`.

Lenses, with the count of slices each owns:

| Lens | Slices | Note |
|---|---|---|
| `wage-math` | 4 | Invariant 3 territory |
| `security` | 5 | RLS, SSRF, bearer credentials |
| `mobile-ux` | 7 | one-handed, mid-shift, on an iPhone |
| `accessibility` | 7 | AA contrast on every money figure |
| `performance` | 4 | in-browser Babel over 5,800 lines |
| `data-integrity` | 4 | last-writer-wins, no version |
| `code-quality` | 13 | judged by whether the *next* change is safe |
| `product-design` | 6 | holds the no-nudge rule |
| `privacy-telemetry` | 3 | collected vs disclosed |
| `cross-surface` | 3 | **new** — see below |

**Findings are deduplicated per lens before verification.** A lens's cells review the same
functions from different slices, so the same defect arrives more than once under different titles —
the first run's four `wage-math` cells reported the keepRatio omission three times and the hero-chip
disagreement twice, which under per-cell verification is nine refuters for two findings. A `sonnet`
merge step folds same-root-cause-same-site duplicates and unions their `slices` before any refuter is
paid for; when in doubt it keeps both. Cross-lens duplicates are still merged at synthesis.

**`cross-surface` has never run.** Three surfaces now compute dollars independently — the hero, the
Add-Shift preview, and the pattern lab readout. `CLAUDE.md` mandates a hero/breakdown equality check
for wage-core changes, but nothing has ever checked the trio against each other. Seeded identically,
do they agree? This is the lens most likely to find something that matters.

## What the workflow does not do

**It reviews; it does not fix.** Workflow scripts have no filesystem access, and parallel agents
editing one 5,800-line file would conflict regardless. So fixes are applied *serially* by the
orchestrating session after the run returns, then the council is re-run. That is an honest gap
against the meta-goal's "automated fix→re-review until every lens scores 8/10" — the review half is
automated and the fix half is not yet.

**Wage-core findings never auto-apply**, however safe they look. `patternMetrics` and `computeNet`
now feed three surfaces, the `wage-core` skill already refuses the nightly loop, and the same logic
applies to an auto-applying council. Every finding carries a `wageCore` flag for this.

## Running it

A full run does not fit one usage window and the session container that holds the workflow cache
is reclaimed between firings, so since 2026-09-13 the council runs in **batches whose state lives in
git**, under `docs/council-runs/<date>/`. Each batch reads the previous batches' output from those
files and writes its own back; nothing depends on the workflow cache or on a container surviving.

```
# build the args for a batch from the run dir, launch, then fold the result back in
node scripts/council_state.mjs args --run docs/council-runs/2026-09-13 --upTo 1   # -> JSON
Workflow({ scriptPath: '.claude/workflows/council.mjs', args: <that JSON> })
node scripts/council_state.mjs persist --run docs/council-runs/2026-09-13 --result <the .output file>
git add docs/council-runs && git commit && git push
```

`upTo` is cumulative and everything already on file is skipped, so a batch pays only for its own
work:

| `upTo` | Runs | Cost shape |
|---|---|---|
| `review` | the 56 review cells (only when the run dir has none) | ~9M tokens — one whole window |
| `1` | per-lens dedup, then refuters for every **critical/high** finding | ~20–30% of a window |
| `2a` | refuters for **medium** findings in the money/anonymity/data lenses | ~25–35% |
| `2b` | refuters for the other medium findings (all `sonnet`) | ~15–20% |
| `3` | the 10 scorers and the synthesis | ~10% |

**Low-severity findings are never agent-verified.** They are kept as backlog candidates and the
scorers see them labelled as such. This is a deliberate, stated deviation from "every finding is
verified" — at three refuters each they were a third of the verification bill for the least
consequential third of the findings. The `2026-07-30` baseline had no lows at all, so the
confirmed/rejected count still means what it meant.

**Ladder the batches across days when the account is in use for other work.** The usage limit is
per account and shared with chat and Cowork; a batch is a bounded dip, a full run is a spike that
caps everything else for the rest of the window. The 2026-09-13 run was scheduled one batch per
night (03:00 UTC) via one-shot Routines firing into the same session — `docs/history.md`.

Prerequisites, in order of how likely they are to bite:

- **Persist after every batch, before anything else.** The `.output` file with the workflow's return
  value lives in the container; `persist` is what moves it into git. A batch whose result was not
  persisted has to be bought again.
- **Concurrency is CPU-bound, not configurable.** Agents run `min(16, CPUs − 2)` at a time; on the
  4-core session box that is two. Even a batch is measured in hours.
- **Model tiers.** The session's model is the *frontier* tier and is what the script means when it
  passes no `model`: the reviewers **and refuters** of the four lenses over money, anonymity and
  data loss (`wage-math`, `cross-surface`, `security`, `data-integrity`), and the synthesis.
  Everything else — the six broad review lenses, dedup, the other lenses' refuters (at `effort:
  'low'`), the scorers — runs on `sonnet`. The line is "would a weaker reader miss a real defect, or
  is a wrong verdict expensive". Start the session on whichever model you want as the frontier
  tier; the choice is the session's, not the file's.
- **Refuters are scoped.** Each is told to read the cited location ±80 lines plus at most three
  greps, in about eight tool calls. The unscoped version averaged 27 tool turns per refuter —
  nearly a full review cell's worth — because "verify against the real code" sent every one of
  them through the whole 5,800-line file.
- **Raise the workflow size limit first.** The default guideline is *medium — under 15 agents*; a
  batch is 30–100 agents. Change it under `/config` → "Dynamic workflow size", or the run will be
  shaped to a budget that defeats the point.
- **`Workflow({ name: 'council' })` did not resolve** on 2026-09-13 (the registry only listed
  `deep-research`); `scriptPath` is what worked.
- **Read this file and `BACKLOG.md` first.** The known-issues list below is in the script as
  `KNOWN` and is passed to reviewers, refuters and the synthesis; keep the two in step.

## Known — do not re-report

Already recorded in `CLAUDE.md` → Open items or `BACKLOG.md`. A lens that "finds" one of these has
found the backlog:

- CI actions unpinned (no SHAs), and `actions/checkout@v4` + `actions/setup-node@v4` target the
  deprecated Node 20 runtime; `.mcp.json` runs `@latest`.
- The `deploy gate` ruleset is confirmed in force via the API but has never been proven to block a
  merge with a deliberately-red PR.
- `poster_key` is stable per group, so a colleague identified once is recognisable later — disclosed
  in-app since 2026-08-11, rotation parked.
- Calendar memoization + 16-month virtualization; `backdrop-filter` cost needs a real older-iPhone repro.
- Sync content-equality needs jsonb key-order canonicalization before comparing.
- No backups on the Supabase free tier; the 15s whole-blob poll grows with unit size.
- No second Supabase project, so audits and migrations run against real users' pay history.
- Google brand verification fails on two counts (domain not verified; home page is JS-only with no
  `<noscript>`); the consent screen still shows `mnnlgcxnvodjwlhhiphq.supabase.co`.
- `ical-proxy`'s allowlist lacks the real NurseGrid feed host; the sync confirm step is
  all-or-nothing and a local edit to a synced shift loses to the feed.
- The account menu carries `role="menuitem"` without roving-tabindex arrow keys.
- `te_swap_p2_algo.js` and `rls_audit.js` have never been in git, so their quoted figures are
  unreproducible.

## After a run

Record it in `docs/history.md`: lenses and scores, confirmed-vs-rejected counts, what was applied
versus deferred, and anything learned about the *process* — that half is the meta-goal, and it is the
half that gets dropped. The 2026-09-13 entry is the model: it records three ways a test result can
look like proof and not be, which is worth more than the feature list beside it.
