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
   outcome is actually intended — and the finding dies on a 2-of-3 refute. Three copies of the same
   skeptic is redundancy, not verification. The 2026-07-30 run's credibility came from exactly this:
   30 confirmed, 2 rejected. A run that rejects nothing did not verify anything.
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

```
Workflow({ name: 'council' })
```

Prerequisites, in order of how likely they are to bite:

- **Raise the workflow size limit first.** The default guideline is *medium — under 15 agents*. A
  full run is ~56 review agents, ~3 verifiers per surviving finding, 10 scorers and 1 synthesis:
  realistically 150–300 agents. Change it under `/config` → "Dynamic workflow size", or the run will
  be shaped to a budget that defeats the point.
- **Start the session on whichever model you want the lenses to use.** Agents inherit the session
  model; the script deliberately hard-codes no model, so the choice is the session's, not the file's.
- **Read this file and `BACKLOG.md` first.** The known-issues list below exists so lenses spend their
  attention on what nobody has found yet.

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
