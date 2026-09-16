export const meta = {
  name: 'council-recheck',
  description: 'Targeted re-check after a council run: verify each applied fix against the code as it now stands, re-score every lens against its own previous score, and say what still holds each one below 8.',
  whenToUse: 'After the bucket-1 fixes from a council run have shipped. Cheaper than a full re-run: one verifier per applied fix, one scorer per lens, one short synthesis. Build args from <runDir>/recheck-args.json.',
  phases: [
    { title: 'Verify fixes', detail: 'one agent per applied synthesis entry: is the fix real in the code, is it pinned by an assertion, what residue is left' },
    { title: 'Re-score',     detail: 'each lens re-scores 1-10 against its previous score, its previous "worst", and what was applied vs routed' },
    { title: 'Synthesize',   detail: 'before/after table, what cleared, what still holds each lens below 8 and where that work now lives' },
  ],
}

/* A re-check is not a review. It does not look for new defects (that is a council run); it asks
   two narrower questions the owner actually has after a fix pass: did the fixes land, and what do
   the lenses score now that they have. Anything a verifier notices in passing goes in `residual`,
   never in a new finding list -- an unverified aside masquerading as a finding is exactly what the
   live-vote floor in council.mjs exists to prevent. */

const A = args || {}
const runDir = A.runDir || 'docs/council-runs/unnamed'
const applied = Array.isArray(A.applied) ? A.applied : []
const routed = Array.isArray(A.routed) ? A.routed : []
const before = Array.isArray(A.scoresBefore) ? A.scoresBefore : []
const BROAD = 'sonnet'
const tier = (model, effort) => ({ ...(model ? { model } : {}), ...(effort ? { effort } : {}) })
const LENSES = ['wage-math','security','mobile-ux','accessibility','performance','data-integrity','code-quality','product-design','privacy-telemetry','cross-surface']
const lensOf = (id) => id.replace(/-\d\d$/, '')

const CHECK = { type: 'object', properties: {
  landed:   { type: 'boolean', description: 'true only if the code as it stands contains the fix described, at the cited site' },
  pinned:   { type: 'boolean', description: 'true if tests/smoke.mjs holds an assertion that would fail if the fix were reverted' },
  complete: { type: 'boolean', description: 'true if every id in this entry is closed by the fix; false if the note says a half was routed or a verifier finds one open' },
  residual: { type: 'string', description: 'what this entry still leaves open, if anything -- one or two sentences, or "none"' },
  evidence: { type: 'string', description: 'the lines read (file:line ranges) and the assertion names found' },
}, required: ['landed','pinned','complete','residual','evidence'] }

const SCORE = { type: 'object', properties: {
  score:        { type: 'number', description: '1-10; 8 or above means this lens is satisfied' },
  moved:        { type: 'string', description: 'what changed between the previous score and this one, in one or two sentences' },
  worst:        { type: 'string', description: 'the single open item that most holds the score down now' },
  toReachEight: { type: 'string', description: 'what would have to change to reach 8, or "already at 8+"' },
  ranAgainst:   { type: 'string', description: 'what was actually examined for this re-score' },
}, required: ['score','moved','worst','toReachEight','ranAgainst'] }

const out = { runDir, checks: {}, scores: [], synthesis: '' }
log(`Re-check: ${applied.length} applied entries (${applied.reduce((n, a) => n + a.ids.length, 0)} finding ids), ${routed.length} routed ids, ${before.length} previous scores.`)

/* ---- Verify fixes ------------------------------------------------------------------------ */
const checks = await parallel(applied.map((a) => () =>
  agent(
    `Verify that a fix from the BadgeBudget council landed. This is a re-check, not a review: answer ` +
    `the five schema fields from the code as it stands and stop.\n\n` +
    `ENTRY #${a.via}: ${a.what}\n` +
    `FINDING IDS CLOSED BY IT: ${a.ids.join(', ')}` + (a.note ? `\nSCOPE NOTE (authoritative -- a half the note says was routed is NOT a failure here): ${a.note}` : '') + `\n\n` +
    `Each finding's original text (where, detail, failure, fix) is in ${runDir}/findings/<id>.json -- read ` +
    `every one listed. Line numbers in them predate the fix and a wage-core merge (#108) and are stale; ` +
    `grep for the identifiers instead (grep -n '<identifier>' index.html) and read the current code ` +
    `there with ~40 lines of context. Then grep tests/smoke.mjs for an assertion that pins the fix ` +
    `(the council section is 11; assertion names start with "council:" or "a11y:").\n\n` +
    `landed=true only if you saw the fix in the code. pinned=true only if you found an assertion that ` +
    `would fail without it. complete=false if any listed id is still open beyond what the scope note ` +
    `already routes. Stay within about 10 tool calls; do not run the test suite; do not read index.html ` +
    `end to end.`,
    { label: `check:#${a.via}`, phase: 'Verify fixes', schema: CHECK, ...tier(BROAD) })
    .then((c) => ({ a, c }))))
for (const { a, c } of checks.filter(Boolean)) if (c) out.checks[`#${a.via}`] = { ids: a.ids, what: a.what, ...c }
const landed = Object.values(out.checks).filter((c) => c.landed).length
const pinned = Object.values(out.checks).filter((c) => c.pinned).length
const complete = Object.values(out.checks).filter((c) => c.complete).length
log(`Verify fixes: ${Object.keys(out.checks).length} of ${applied.length} entries checked -- ${landed} landed, ${pinned} pinned, ${complete} complete.`)

/* ---- Re-score ---------------------------------------------------------------------------- */
const closedIds = new Set(applied.flatMap((a) => a.ids))
const scores = await parallel(LENSES.map((lens) => () => {
  const prev = before.find((s) => s.lens === lens) || {}
  const mine = Object.entries(out.checks).filter(([, c]) => c.ids.some((id) => lensOf(id) === lens))
  const myRouted = routed.filter((r) => lensOf(r.id) === lens)
  const line = ([k, c]) => `- ${k} ${c.what}\n    ids: ${c.ids.filter((id) => lensOf(id) === lens).join(', ')} | landed=${c.landed} pinned=${c.pinned} complete=${c.complete}` + (c.residual && c.residual !== 'none' ? `\n    residual: ${c.residual}` : '')
  return agent(
    `You are the ${lens} lens of the BadgeBudget council, re-scoring after a fix pass. Score 1-10 for the ` +
    `app as it stands; 8 is the bar the council holds. Score the app, not the effort: a lens whose ` +
    `remaining confirmed findings all wait on a dedicated session is still held down by them if they ` +
    `would hurt a nurse relying on the app for her pay -- say so precisely rather than rounding up. ` +
    `Equally, do not hold a score down for work that verifiably landed.\n\n` +
    `YOUR PREVIOUS SCORE: ${prev.score ?? '?'}/10\nYOUR PREVIOUS "WORST": ${prev.worst || '(none recorded)'}\nWHAT YOU SAID WOULD REACH 8: ${prev.toReachEight || '(none recorded)'}\n\n` +
    `APPLIED AND JUST VERIFIED (${mine.length} entries touching your findings):\n${mine.map(line).join('\n') || '(none of your findings were in bucket 1)'}\n\n` +
    `ROUTED, NOT APPLIED (${myRouted.length}) -- each carries where it now lives:\n${myRouted.map((r) => `- ${r.id} ${r.title} -> ${r.to}`).join('\n') || '(none)'}\n\n` +
    `Every finding's full text is in ${runDir}/findings/<id>.json; your previous score record is in ${runDir}/scores.json; ` +
    `the synthesis that ranked them is ${runDir}/synthesis.md. Spot-check at most three of the applied ` +
    `entries in index.html yourself (grep, then read ~40 lines) before scoring; do not re-review the app. ` +
    `In ranAgainst say what you actually looked at.`,
    { label: `rescore:${lens}`, phase: 'Re-score', schema: SCORE, ...tier(BROAD) })
    .then((s) => s && ({ ...s, lens, before: prev.score ?? null }))
}))
out.scores = scores.filter(Boolean)
log(`Re-score: ${out.scores.map((s) => `${s.lens} ${s.before ?? '?'}->${s.score}`).join(', ')}`)

/* ---- Synthesize -------------------------------------------------------------------------- */
const synthesis = await agent(
  `Write the closing note for a BadgeBudget council re-check, for docs/history.md. Under 60 lines.\n\n` +
  `SHIPPED: ${A.shipped || '(not stated)'}\n\n` +
  `FIX CHECKS (one per applied synthesis entry):\n${JSON.stringify(out.checks, null, 1)}\n\n` +
  `SCORES BEFORE -> AFTER:\n${JSON.stringify(out.scores.map((s) => ({ lens: s.lens, before: s.before, after: s.score, moved: s.moved, worst: s.worst, toReachEight: s.toReachEight })), null, 1)}\n\n` +
  `ROUTED WORK AND WHERE IT LIVES:\n${routed.map((r) => `- ${r.id} -> ${r.to}`).join('\n')}\n\n` +
  `Produce: (1) a markdown table lens | before | after | what still holds it below 8 (or "cleared"); ` +
  `(2) any applied entry that did NOT land or is NOT pinned, by name -- these are defects in the fix ` +
  `pass and go first; (3) for each lens still below 8, the one session in BACKLOG.md that clears it, ` +
  `named the way the routed list names it; (4) two or three sentences on whether the re-check itself ` +
  `earned its cost -- what a full re-run would have found that this could not, honestly. No padding, ` +
  `no praise, no restating the fix list.`,
  { label: 'recheck-synthesis', phase: 'Synthesize' })
out.synthesis = synthesis || ''
return out
