export const meta = {
  name: 'council',
  description: 'Multi-lens comprehensive review of BadgeBudget: every lens over every slice it owns, each finding adversarially verified, per-lens scores out of 10',
  whenToUse: 'A full council run, in batches that each fit inside a usage window. Read docs/council.md first; build args with scripts/council_state.mjs.',
  phases: [
    { title: 'Review',     detail: 'one agent per lens x slice it owns (skipped when the run dir already holds every cell)' },
    { title: 'Dedup',      detail: 'merge the same defect seen from several slices of one lens, before paying for verification' },
    { title: 'Verify',     detail: 'three perspective-diverse refuters per finding, critical/high first, lows never' },
    { title: 'Score',      detail: 'each lens scores 1-10 and states what it actually ran' },
    { title: 'Synthesize', detail: 'dedup across lenses, rank, split auto-safe from needs-a-human' },
  ],
}

/* The council reviews the app AS IT STANDS, never a diff. Reviewing a diff misses everything the
   diff didn't touch, and after 55 commits "what changed" is most of the file anyway. Slices are
   declared here rather than discovered so a run is reproducible and reviewable before it costs
   anything -- and so "what did the council look at" has an answer in git. */
const SLICES = {
  boot:            'The plain-JS boot script: 8s watchdog, Supabase null-guard, the 4s getSession race, the scrapbook error ring buffer, ERR_KEY. Plus <head>: the 5 SRI-pinned CDN scripts, the meta CSP, favicon/theme-color.',
  'wage-core':     'shiftGross, hourlyRate, computeNet, calc, statOf, ptoStatOf, patternMetrics, the BONUS table, and the rate/differential coercions in sanitizeData. Invariant 3 territory.',
  'money-surfaces':'Every place a dollar figure is rendered: the hero number and its Gross/Taxes/Keep chips, the Add-Shift live preview, the breakdown view, the pattern lab readout, the goal lines in Settings and the preview.',
  calendar:        'Month-first scrolling calendar, the year view, the scroll-following pay period, the pinned month label + weekday row, keyOf/day-key handling.',
  'add-shift':     'The Add-Shift sheet: templates, quick-fill, day events (PTO at base rate), the live preview, OT tagging.',
  'pattern-lab':   'PatternLab: PATTERN_PRESETS, the cycle/anchor editor, brushes, planPatternApply, apply/remove-by-patternId, the life-shape readout.',
  onboarding:      'Welcome screen, the base-rate step, estimateMode (rough/sample), the est-banner, SAMPLE_PATTERN_ID seeding and Clear-the-sample, the ob_step funnel.',
  'settings-etc':  'Settings, savings goals (MAX_GOALS), ShareSheet + the inline QR, the account menu (AccountMenu), and the feedback tiles (FEEDBACK_TILES / FEEDBACK_KINDS).',
  'swap-board':    'SwapsSheet, invite codes, the matching suggestions, the reveal flow, and the poster_key anonymity model enforced in Postgres.',
  'data-sync':     'The user_data jsonb blob, sanitizeData in full, the 500ms debounce, MAX_BLOB_BYTES, saveToSupabase onConflict (Invariant 4), the per-user failed-save backup, the 15s visible-tab poll and its content-equality check.',
  'calendar-sync': '.ics export (the @scrubpay UID sentinel, Invariant 6) and import, the guided questionnaire, auto-sync via the ical-proxy Edge Function, and the iCal URL as a bearer credential (Invariant 13).',
  'telemetry-auth':'track() and the events table, client_error + redactMoney, the deferred queue (scrubpay_events_pending), anon_id, and auth: Supabase email/password + Google PKCE, redirectTo, the WebKit paths.',
  infra:           'supabase/migrations 000-003, RLS policies, .github/workflows (ci.yml + deploy.yml), scripts/check_build.mjs, tests/, the publish set (Invariant 8), the branch rules (Invariants 9-11).',
}

/* Each lens owns the slices where it can actually say something. A lens pointed at a slice it has
   no purchase on returns polite nothing and costs a full agent, which is how a "comprehensive"
   run turns into a shallow one. code-quality is the exception -- it owns everything.
   scripts/council_state.mjs mirrors the lens -> slices shape; keep them in step. */
const LENSES = [
  { key: 'wage-math', slices: ['wage-core','money-surfaces','pattern-lab','add-shift'],
    brief: 'Is the arithmetic right, and does every displayed figure follow from it? OT stacks on the differential-inclusive rate; FICA is on gross while income tax uses gross-minus-pretax; custom bonus is flat, not per-hour; pre/post caps are display-only. Hunt for rounding that compounds, NaN paths, and figures that disagree between surfaces.' },
  { key: 'security', slices: ['swap-board','data-sync','calendar-sync','telemetry-auth','infra'],
    brief: 'RLS that can be bypassed, a security-definer RPC that trusts its caller, SSRF in the iCal proxy allowlist, a bearer credential that leaks into an export/log/blob, XSS via untrusted strings, and anything the anon key can read that it should not.' },
  { key: 'mobile-ux', slices: ['money-surfaces','calendar','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
    brief: 'A nurse on an iPhone, one-handed, mid-shift. Tap targets under 44px, horizontal overflow, the keyboard covering the thing being typed into, sheets that trap scroll, state lost on rotation, and anything that needs two hands.' },
  { key: 'accessibility', slices: ['money-surfaces','calendar','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
    brief: 'WCAG AA contrast on every money figure, focus order and visible focus, labels on every control, ARIA that promises behaviour the code does not implement, screen-reader sense of the calendar grid, and reduced-motion/reduced-transparency honouring.' },
  { key: 'performance', slices: ['boot','calendar','pattern-lab','data-sync'],
    brief: 'Time to first meaningful paint through an in-browser Babel transform of a 5,800-line file. Re-render storms on the calendar path (no memoization by design -- is that still defensible?), backdrop-filter cost on older iPhones, and the 15s poll that grows with unit size.' },
  { key: 'data-integrity', slices: ['wage-core','data-sync','calendar-sync','infra'],
    brief: 'Can a user lose data? Last-writer-wins on a whole blob with no version, two devices, a flaky network. Does sanitizeData drop anything it should keep or keep anything malformed? Does a re-sync clobber a local edit? What happens at MAX_BLOB_BYTES?' },
  { key: 'code-quality', slices: Object.keys(SLICES),
    brief: 'Dead code, duplicated logic that will drift apart, the two god components (App ~1,180 lines, SwapsSheet ~820), error handling that swallows, comments that no longer match the code. Judge maintainability by whether the NEXT change is safe, not by style.' },
  { key: 'product-design', slices: ['money-surfaces','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
    brief: 'Does the app keep its promise -- know what a shift is worth BEFORE working it, with no surprises? Hold the no-nudge rule hard: state arithmetic, never judgement; no streaks, no "behind", no manufactured urgency. Flag anything that qualifies a number too weakly or too loudly.' },
  { key: 'privacy-telemetry', slices: ['calendar-sync','telemetry-auth','infra'],
    brief: 'What is collected vs what privacy.html discloses. Wage and goal figures must NEVER reach events. Is redactMoney actually sufficient on every path that logs? Does page/user_agent collection match the notice? Can the iCal URL or a shift title escape anywhere?' },
  { key: 'cross-surface', slices: ['wage-core','money-surfaces','pattern-lab'],
    brief: 'Three surfaces now compute dollars -- the hero, the Add-Shift preview, and the pattern lab readout. Seeded identically, do they AGREE? Find any input where two of them disagree, and say which one is wrong. This lens has never run before.' },
]

/* Model tiers (2026-09-13, after two runs died on the session usage limit). "Frontier" is the
   session's model and is passed as no `model` at all, so the choice stays the session's
   (docs/council.md). It goes where a weaker reader would miss a real defect or a wrong verdict is
   expensive: the four lenses over money, anonymity and data loss -- their reviewers AND their
   refuters -- plus the synthesis. Everything else runs on `sonnet`: the six broad review lenses,
   dedup, the other lenses' refuters, and the scorers. */
const BROAD = 'sonnet'
const MONEY_LENSES = new Set(['wage-math', 'cross-surface', 'security', 'data-integrity'])
const tier = (model, effort) => ({ ...(model ? { model } : {}), ...(effort ? { effort } : {}) })
const reviewTier = (lens) => MONEY_LENSES.has(lens) ? {} : tier(BROAD)
const refuteTier = (lens) => MONEY_LENSES.has(lens) ? {} : tier(BROAD, 'low')

/* Already in CLAUDE.md -> Open items or BACKLOG.md. Refuters and the synthesis are told to treat
   "found one of these" as "found the backlog". */
const KNOWN = [
  'CI actions unpinned (no SHAs); actions/checkout@v4 + setup-node@v4 on the deprecated Node 20 runtime; .mcp.json runs @latest.',
  'The deploy gate ruleset is confirmed in force but has never been proven to block a merge with a deliberately-red PR.',
  'poster_key is stable per group, so a colleague identified once is recognisable later -- disclosed in-app since 2026-08-11, rotation parked.',
  'Calendar memoization + 16-month virtualization; backdrop-filter cost needs a real older-iPhone repro.',
  'Sync content-equality needs jsonb key-order canonicalization before comparing.',
  'No backups on the Supabase free tier; the 15s whole-blob poll grows with unit size.',
  'No second Supabase project, so audits and migrations run against real users pay history.',
  'Google brand verification fails on two counts (domain not verified; home page is JS-only with no <noscript>); the consent screen still shows mnnlgcxnvodjwlhhiphq.supabase.co.',
  'ical-proxy allowlist lacks the real NurseGrid feed host; the sync confirm step is all-or-nothing and a local edit to a synced shift loses to the feed.',
  'The account menu carries role="menuitem" without roving-tabindex arrow keys.',
  'te_swap_p2_algo.js and rls_audit.js have never been in git, so their quoted figures are unreproducible.',
  'Feedback rows carry page + user_agent, undisclosed until 2026-09-02; keep-or-strip is an open product call.',
  'Swap board de-emphasis until there are users (Courtney, 2026-09-12) is an OWNER DECISION already in BACKLOG.md; a "shifts to afford X by DATE" calculator is already filed as wage-core work.',
]

const FINDING_PROPS = {
  title:    { type: 'string' },
  severity: { type: 'string', enum: ['critical','high','medium','low'] },
  where:    { type: 'string', description: 'file:line or function name' },
  detail:   { type: 'string' },
  failure:  { type: 'string', description: 'concrete inputs or state -> wrong behaviour a user would notice' },
  fix:      { type: 'string' },
  wageCore: { type: 'boolean', description: 'true if the fix would touch Invariant 3 wage-core code' },
}
const FINDING_REQ = ['title','severity','where','detail','failure','fix','wageCore']
const FINDINGS = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object', properties: FINDING_PROPS, required: FINDING_REQ } },
  ranAgainst: { type: 'string', description: 'what was actually read or run -- name functions and line ranges, not "the codebase"' },
}, required: ['findings','ranAgainst'] }
const MERGED = { type: 'object', properties: {
  findings: { type: 'array', items: { type: 'object',
    properties: { ...FINDING_PROPS, slices: { type: 'array', items: { type: 'string' }, description: 'every slice that reported this same defect' } },
    required: [...FINDING_REQ, 'slices'] } },
  merged: { type: 'number', description: 'how many raw findings were folded into another' },
}, required: ['findings','merged'] }
const VERDICT = { type: 'object', properties: { refuted: { type: 'boolean' }, why: { type: 'string' } }, required: ['refuted','why'] }
const SCORE = { type: 'object', properties: {
  score:       { type: 'number', description: '1-10; 8 or above means this lens is satisfied' },
  ranAgainst:  { type: 'string', description: 'what this lens actually examined -- a score without this is a badge, not a result' },
  worst:       { type: 'string', description: 'the single finding that most holds the score down' },
  toReachEight:{ type: 'string', description: 'what would have to change to reach 8, or "already at 8+"' },
}, required: ['score','ranAgainst','worst','toReachEight'] }

/* ---- batch plumbing -------------------------------------------------------------------- */
const A = args || {}
const runDir = A.runDir || 'docs/council-runs/unnamed'
const STEPS = ['review', 'dedup', '1', '2a', '2b', '3']
const upTo = STEPS.includes(String(A.upTo)) ? String(A.upTo) : '1'
const wants = (step) => STEPS.indexOf(step) <= STEPS.indexOf(upTo)
const RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const batchOf = (lens, sev) => RANK[sev] <= 1 ? '1' : RANK[sev] === 2 ? (MONEY_LENSES.has(lens) ? '2a' : '2b') : null
const known = (v) => v !== undefined && v !== null
const CELLS = LENSES.flatMap((l) => l.slices.map((s) => ({ lens: l, slice: s })))
const out = { runDir, upTo, reviews: {}, dedups: {}, verdicts: {}, scores: [], synthesis: '', summary: {} }

log(`Council: ${LENSES.length} lenses over ${Object.keys(SLICES).length} slices = ${CELLS.length} review cells. Run dir ${runDir}, upTo=${upTo}.`)

/* ---- Review (a from-scratch run only) --------------------------------------------------- */
if (!A.haveReviews) {
  const missing = A.unreviewed && A.unreviewed.length ? new Set(A.unreviewed) : null
  const todo = CELLS.filter((c) => !missing || missing.has(`${c.lens.key}:${c.slice}`))
  log(`Review: ${todo.length} cells to run.`)
  const results = await parallel(todo.map((c) => () =>
    agent(
      `You are the ${c.lens.key} lens of the BadgeBudget development council, reviewing ONE slice.\n\n` +
      `SLICE: ${c.slice}\n${SLICES[c.slice]}\n\n` +
      `YOUR LENS: ${c.lens.brief}\n\n` +
      `Read the real code in index.html (and the named files) before claiming anything. Report only ` +
      `defects you can point at with a file:line and a concrete failure a user would notice -- no ` +
      `style preferences, no "consider refactoring", no findings you could have written without ` +
      `opening the file. An empty findings list is a fine and honest result for a clean slice. ` +
      `Set wageCore true if the fix would touch shiftGross/hourlyRate/computeNet/calc/statOf/` +
      `ptoStatOf/patternMetrics or the rate coercions in sanitizeData.\n\n` +
      `KNOWN, already in the backlog -- do not re-report these:\n- ${KNOWN.join('\n- ')}\n\n` +
      `In ranAgainst, name the functions and line ranges you actually read.`,
      { label: `${c.lens.key}:${c.slice}`, phase: 'Review', schema: FINDINGS, ...reviewTier(c.lens.key) })
      .then((r) => ({ c, r }))))
  let done = 0
  for (const { c, r } of results.filter(Boolean)) if (r) { out.reviews[`${c.lens.key}:${c.slice}`] = { lens: c.lens.key, slice: c.slice, findings: r.findings, ranAgainst: r.ranAgainst }; done++ }
  log(`Review: ${done} of ${todo.length} cells returned. Persist with scripts/council_state.mjs, then run the next batch.`)
  out.summary = { reviewed: done, attempted: todo.length }
  return out
}

/* ---- Dedup ------------------------------------------------------------------------------ */
const merged = {}   /* lens -> [{id,title,severity,where,wageCore, detail?...}] : from args, or from this run */
for (const [lens, list] of Object.entries(A.dedups || {})) merged[lens] = list
const needDedup = LENSES.filter((l) => !merged[l.key])
if (wants('dedup') && needDedup.length) {
  log(`Dedup: ${needDedup.length} lenses (${needDedup.map((l) => l.key).join(', ')}).`)
  const res = await parallel(needDedup.map((l) => () => {
    const raw = (A.rawCounts || {})[l.key] || 0
    if (!raw) return Promise.resolve({ l, m: { findings: [], merged: 0 } })
    return agent(
      `Merge duplicate findings from the ${l.key} lens of the BadgeBudget council. The lens reviewed ` +
      `${l.slices.length} slices independently, so the same defect often appears more than once with ` +
      `different titles. First read ${runDir}/raw/${l.key}.json -- it holds every raw finding, grouped by ` +
      `slice (${raw} in total). Fold two findings together ONLY when they are the same root cause at the ` +
      `same code site (e.g. three slices each noticing that keepRatio omits percent custom withholdings); ` +
      `keep the sharpest statement, union the slices, and do not soften severity. Different symptoms of ` +
      `one root cause are one finding. When in doubt, keep both -- a missed merge costs three refuters, ` +
      `a wrong merge loses a defect. Do not add, re-judge or rewrite findings; this is a merge, not a ` +
      `review. Drop nothing except true duplicates. Return every surviving finding in full.`,
      { label: `dedup:${l.key}`, phase: 'Dedup', schema: MERGED, ...tier(BROAD) })
      .then((m) => ({ l, m }))
  }))
  for (const { l, m } of res.filter(Boolean)) {
    if (!m || !Array.isArray(m.findings)) { log(`${l.key}: dedup did not return; this lens waits for the next batch.`); continue }
    const raw = (A.rawCounts || {})[l.key] || 0
    if (raw && m.findings.length > raw) { log(`${l.key}: dedup returned MORE findings than it was given (${m.findings.length} > ${raw}); discarded.`); continue }
    const list = m.findings.map((f, i) => ({ ...f, id: `${l.key}-${String(i).padStart(2, '0')}` }))
    merged[l.key] = list
    out.dedups[l.key] = { findings: list, merged: m.merged }
    log(`${l.key}: ${raw} raw -> ${list.length} after dedup`)
  }
}

/* ---- Verify ------------------------------------------------------------------------------ */
const flags = { ...(A.verdicts || {}) }      /* "id#angle" -> refuted boolean, on file or from this run */
const ANGLES = [
  'Read the surrounding code. Is this already handled somewhere the finding did not look? Also check the KNOWN list: a finding that restates something already recorded there is refuted -- it found the backlog, not a defect.',
  'Is the failure path actually reachable in the shipped app, given how the UI constrains input?',
  'Granting the mechanism, is the described outcome genuinely wrong -- or is it intended behaviour this project documents?',
]
/* Deterministic order: severity, then lens order, then id -- so a killed window leaves the
   important verdicts in the journal and the next batch does not depend on timing. */
const queue = []
for (const sev of ['critical', 'high', 'medium']) for (const l of LENSES) for (const f of (merged[l.key] || []))
  if (f.severity === sev) { const b = batchOf(l.key, sev); if (b && wants(b)) queue.push({ lens: l.key, f }) }
const pending = queue.filter(({ f }) => [0, 1, 2].some((a) => !known(flags[`${f.id}#${a}`])))
const lowsSkipped = LENSES.reduce((n, l) => n + (merged[l.key] || []).filter((f) => f.severity === 'low').length, 0)
log(`Verify: ${queue.length} findings in scope for upTo=${upTo}, ${pending.length} still need refuters; ${lowsSkipped} lows are not agent-verified by design.`)
if (pending.length) {
  const judged = await parallel(pending.map(({ lens, f }) => () =>
    parallel(ANGLES.map((angle, i) => () => {
      if (known(flags[`${f.id}#${i}`])) return Promise.resolve({ refuted: flags[`${f.id}#${i}`], why: '(on file)', onFile: true })
      const body = f.detail
        ? `CLAIM: ${f.detail}\nCLAIMED FAILURE: ${f.failure}\nPROPOSED FIX: ${f.fix}`
        : `The full finding (claim, concrete failure, proposed fix) is in ${runDir}/findings/${f.id}.json -- read it first.`
      return agent(
        `Refute this ${lens} finding about BadgeBudget. Default to refuted=true when uncertain; a ` +
        `plausible-sounding finding that wastes the owner's time is worse than a missed nit.\n\n` +
        `ANGLE: ${angle}\n\n` +
        `KNOWN (already in the backlog -- a finding that restates one of these is refuted):\n- ${KNOWN.join('\n- ')}\n\n` +
        `FINDING ${f.id} [${f.severity}]${f.title ? ': ' + f.title : ''}\nWHERE: ${f.where || 'given in the finding file'}\n${body}\n\n` +
        `Scope: read ONLY the cited location(s) with roughly 80 lines of context each side (sed -n 'A,Bp' ` +
        `index.html), plus at most three targeted greps for identifiers the finding names. Do not read ` +
        `index.html end to end, do not run the test suite. A verdict from the cited code and its immediate ` +
        `neighbourhood is what is asked for; stay within about 8 tool calls.`,
        { label: `refute:${f.id}#${i}`, phase: 'Verify', schema: VERDICT, ...refuteTier(lens) })
    })).then((votes) => {
      votes.forEach((v, i) => { if (v && !v.onFile) { out.verdicts[`${f.id}#${i}`] = { refuted: !!v.refuted, why: v.why }; flags[`${f.id}#${i}`] = !!v.refuted } })
      return { id: f.id }
    })))
  log(`Verify: ${judged.filter(Boolean).length} findings judged this batch, ${Object.keys(out.verdicts).length} new verdicts.`)
}
const statusOf = (id) => {
  const live = [0, 1, 2].map((a) => flags[`${id}#${a}`]).filter(known)
  if (live.length < 2) return 'unverified'
  return live.filter(Boolean).length * 2 >= live.length ? 'rejected' : 'confirmed'
}
const tally = { confirmed: 0, rejected: 0, unverified: 0, low: lowsSkipped, notInScope: 0 }
for (const l of LENSES) for (const f of (merged[l.key] || [])) {
  if (f.severity === 'low') continue
  const b = batchOf(l.key, f.severity); if (!wants(b)) { tally.notInScope++; continue }
  tally[statusOf(f.id)]++
}
out.summary = tally
log(`So far: ${tally.confirmed} confirmed, ${tally.rejected} rejected, ${tally.unverified} unverified, ${tally.notInScope} medium+ not yet in scope, ${tally.low} lows unverified.`)

/* ---- Score + Synthesize (batch 3) ------------------------------------------------------- */
if (wants('3')) {
  const unreviewed = A.unreviewed || []
  const scores = await parallel(LENSES.map((l) => () => {
    const mine = (merged[l.key] || [])
    const conf = mine.filter((f) => f.severity !== 'low' && statusOf(f.id) === 'confirmed')
    const rej = mine.filter((f) => f.severity !== 'low' && statusOf(f.id) === 'rejected')
    const unv = mine.filter((f) => f.severity !== 'low' && statusOf(f.id) === 'unverified')
    const lows = mine.filter((f) => f.severity === 'low')
    const missing = unreviewed.filter((c) => c.startsWith(l.key + ':'))
    const line = (f) => `- ${f.id} [${f.severity}]` + (f.title ? ` ${f.title}` : '') + (f.where ? ` (${f.where})` : '')
    return agent(
      `You are the ${l.key} lens of the BadgeBudget council. Score this lens 1-10 for the app as it ` +
      `stands; 8 is the bar the council holds.\n\n` +
      `Titles and locations for every id below are in ${runDir}/index.json (read it first); the full text of any finding is ${runDir}/findings/<id>.json. ` +
      `The status lists in THIS prompt are authoritative: any status field inside index.json or confirmed.json may lag behind the verdicts this run just produced.\n\n` +
      `CONFIRMED after adversarial review (${conf.length}):\n${conf.map(line).join('\n') || '(none)'}\n\n` +
      `REJECTED by the refuters (${rej.length}) -- these do not count against the app:\n${rej.map((f) => `- ${f.id} ${f.title}`).join('\n') || '(none)'}\n\n` +
      `UNVERIFIED (${unv.length}) -- refuters did not complete; count as open, not confirmed:\n${unv.map(line).join('\n') || '(none)'}\n\n` +
      `LOW severity, not agent-verified by design (${lows.length}) -- backlog candidates, weigh lightly:\n${lows.map(line).join('\n') || '(none)'}\n\n` +
      (missing.length ? `Slices this lens owns that were NOT reviewed: ${missing.join(', ')}. Coverage is incomplete; say so and score accordingly.\n\n` : '') +
      `What each reviewed slice actually read is in ${runDir}/ranAgainst.json under "${l.key}:<slice>" -- read it. ` +
      `Zero findings is NOT automatically a 10: if a slice you own was not examined, say so. In ranAgainst, ` +
      `state what was actually examined; a score without that is a badge, not a result.`,
      { label: `score:${l.key}`, phase: 'Score', schema: SCORE, ...tier(BROAD) })
      .then((s) => s && ({ ...s, lens: l.key, confirmed: conf.length, rejected: rej.length, unverified: unv.length, lows: lows.length }))
  }))
  out.scores = scores.filter(Boolean)
  const allIds = (st) => LENSES.flatMap((l) => (merged[l.key] || []).filter((f) => f.severity !== 'low' && statusOf(f.id) === st).map((f) => f.id))
  const lowIds = LENSES.flatMap((l) => (merged[l.key] || []).filter((f) => f.severity === 'low').map((f) => f.id))
  const synthesis = await agent(
    `Synthesize a BadgeBudget council run into what the owner should do next.\n\n` +
    `AUTHORITATIVE STATUS (this run's verdicts; status fields inside index.json / confirmed.json on disk may lag and must not override this list):\n` +
    `CONFIRMED (${allIds('confirmed').length}): ${allIds('confirmed').join(', ') || 'none'}\n` +
    `REJECTED (${allIds('rejected').length}): ${allIds('rejected').join(', ') || 'none'}\n` +
    `UNVERIFIED (${allIds('unverified').length}): ${allIds('unverified').join(', ') || 'none'}\n` +
    `LOW, never agent-verified (${lowIds.length}): ${lowIds.join(', ') || 'none'}\n\n` +
    `Every finding's full text (lens, severity, where, detail, failure, fix, wageCore) is in ${runDir}/findings/<id>.json; ` +
    `titles and locations for all of them are in ${runDir}/index.json. Read every CONFIRMED finding in full. ` +
    `Rejected and low findings are backlog candidates, not action items.\n\n` +
    `LENS SCORES:\n${JSON.stringify(out.scores, null, 2)}\n\n` +
    `COVERAGE GAPS: ${unreviewed.length ? unreviewed.join(', ') : 'none -- all 56 cells reviewed'}\n\n` +
    `KNOWN, already in the backlog -- anything that restates one of these goes in a "found the backlog" bucket, not the action list:\n- ${KNOWN.join('\n- ')}\n\n` +
    `Merge findings that are the same defect seen through different lenses -- keep the sharpest ` +
    `statement and note which lenses saw it. Rank by what would actually hurt a nurse relying on ` +
    `this app for her pay. Split into: (1) safe to auto-apply now, (2) needs a dedicated session, ` +
    `(3) wage-core -- which NEVER auto-applies regardless of how safe it looks, because patternMetrics ` +
    `and computeNet now feed three surfaces. Say plainly which lenses are below 8 and what it takes ` +
    `to clear them. Do not pad: if the app is in good shape, say that.`,
    { label: 'synthesis', phase: 'Synthesize' })
  out.synthesis = synthesis || ''
}

return out
