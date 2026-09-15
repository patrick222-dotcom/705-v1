# Council run 2026-09-13 — process notes (for docs/history.md)

## Run 1 (as committed, all agents on the session model claude-fable-5-1)
- Launched via scriptPath: `Workflow({name:'council'})` did not find the committed file (registry only listed deep-research).
- Concurrency cap is CPU-derived: min(16, CPUs-2) = 2 on the 4-core box. Not in the charter's prerequisites.
- Died after 21m40s on "You've hit your session limit · resets 5:30am (UTC)": 142 agents launched, 5 done, 137 errored.
  Done: wage-math x4 (wage-core, money-surfaces, add-shift, pattern-lab) + security:swap-board. 25 raw findings. ~962k subagent tokens.
- SCRIPT BUG found by the failure: refuters that die return null; `refuted >= 2 ? null : {...}` counted zero live votes as
  "not refuted" -> all 25 findings returned as confirmed with dissent:[]. A run that verified nothing reported 25 confirmations.
- Duplicates: 4 wage-math cells reported keepRatio-omits-percent-withholdings 3x, hero Taxes chip 2x, year-view gross 2x,
  toggled-off differential 3 facets (hourlyRate ignores `active`). Per-cell verification = 9 refuters for 2-3 findings.
- Session model was Fable for every agent; the owner's standing tiering instruction (small models retrieve, frontier judges)
  was not written anywhere in the repo, so the script could not have known it.

## Changes to council.mjs (after run 1, before resume)
1. Model tiers: frontier (= session model, passed as no `model`) for wage-math/cross-surface/security reviewers, refuters on
   medium+ findings, synthesis. `sonnet` for the 7 broad lenses, dedup, low-severity refuters, scorers.
2. Live-vote floor: <2 live verdicts => status 'unverified'; majority of live votes refutes => 'rejected'; else 'confirmed'.
   Rejected findings are now returned (history needs the count), not discarded.
3. Per-lens dedup barrier (sonnet) between Review and Verify; falls back to raw findings if the dedup agent dies.
4. Coverage reporting: `unreviewed` cells and `lensesLost` returned and logged; scorers told which slices were not reviewed.
5. KNOWN list (charter's do-not-re-report) passed to refuters (angle 0) and synthesis — NOT to reviewers, to keep the review
   prompt byte-identical for cache replay.

## Resume observations
- 4 wage-math cells replayed from cache (no journal entry for cached calls). security:swap-board did NOT replay despite an
  identical prompt/opts — key differed (534e… vs c2cb…). Cache appears sequence-sensitive; restructuring after a partial run
  forfeits cache past the first divergence. Rule: do not restructure a script between resumes of the same run.

## Run 2 (resume with the tiered script, 12:19–15:20 UTC)
- All 56 review cells completed (52 live: 44 sonnet + 8 frontier; 4 wage-math replayed from cache). dedup:wage-math (19 -> 15)
  and 19 refuters completed; then the limit hit again ("resets 6pm UTC"): 448 agents errored — 9 dedups, ~330 refuters, 10 scorers,
  synthesis. 9.0M subagent tokens, 3h00. So: the review phase alone is one full window on this account.
- Per-agent transcripts: a sonnet review cell ~45 tool turns, a frontier one ~50; a refuter ~27 turns (nearly a review cell)
  because "verify against the real code" sent each one through the 5,800-line file. Frontier agents emit ~10-45x the output
  tokens of sonnet ones for the same role.
- Cache keys: identical-content review cells got DIFFERENT keys between run 1 and run 2 (cross-surface:wage-core,
  security:data-sync) while the first four (wage-math) matched -> the resume cache replays an unchanged PREFIX of the call
  sequence, not content. Restructuring after a partial run forfeits everything past the first divergence.
- The container that holds the cache is reclaimed between firings, so the cache cannot be the durable state anyway.

## Decision (owner, 2026-09-13 18:xx UTC): ladder, don't spike
- The usage limit is per account, shared with chat/Cowork. A full run is a spike that caps everything else for the window.
- Rebuilt as git-persisted batches (docs/council-runs/<date>/ + scripts/council_state.mjs + council.mjs `upTo`), one batch per
  night at 03:00 UTC via one-shot Routines into this session: batch 1 (09-14), 2a (09-15), 2b+3 (09-16). Sized 20-35% of a
  window each. Lows never agent-verified (stated deviation). Refuters scoped to the cited code. Frontier tier = the four
  money/anonymity/data lenses + synthesis.
- After batch 3: synthesis + scores go to the owner for review BEFORE any fix is applied (owner's ask: "review and adjust").

## For the history entry
- Counts so far: 56/56 cells, 153 raw findings (1 critical, 35 high, 79 medium, 44 low at raw), 11 flagged wageCore.
- Run 1 verified nothing but reported 25 confirmations (dead refuters counted as assent) — the live-vote floor came from that.
- Three things a run can look like and not be: a clean result with dead agents behind it; a cached replay that silently
  isn't; a "confirmed" finding nobody refuted because nobody was alive to.
