export const meta = {
  name: 'council',
  description: 'Multi-lens comprehensive review of BadgeBudget: every lens over every slice it owns, each finding adversarially verified, per-lens scores out of 10',
  whenToUse: 'A full council run. Reviews the app as it stands, not a diff. Read docs/council.md first.',
  phases: [
    { title: 'Review',     detail: 'one agent per lens x slice it owns' },
    { title: 'Verify',     detail: 'three perspective-diverse refuters per finding' },
    { title: 'Score',      detail: 'each lens scores 1-10 and states what it actually ran' },
    { title: 'Synthesize', detail: 'dedup, rank, split auto-safe from needs-a-human' },
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
   run turns into a shallow one. code-quality is the exception -- it owns everything. */
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

const FINDINGS = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object',
      properties: {
        title:    { type: 'string' },
        severity: { type: 'string', enum: ['critical','high','medium','low'] },
        where:    { type: 'string', description: 'file:line or function name' },
        detail:   { type: 'string' },
        failure:  { type: 'string', description: 'concrete inputs or state -> wrong behaviour a user would notice' },
        fix:      { type: 'string' },
        wageCore: { type: 'boolean', description: 'true if the fix would touch Invariant 3 wage-core code' },
      }, required: ['title','severity','where','detail','failure','fix','wageCore'] } },
    ranAgainst: { type: 'string', description: 'what was actually read or run -- name functions and line ranges, not "the codebase"' },
  },
  required: ['findings','ranAgainst'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    why:     { type: 'string' },
  },
  required: ['refuted','why'],
}

const SCORE = {
  type: 'object',
  properties: {
    score:      { type: 'number', description: '1-10; 8 or above means this lens is satisfied' },
    ranAgainst: { type: 'string', description: 'what this lens actually examined -- a score without this is a badge, not a result' },
    worst:      { type: 'string', description: 'the single finding that most holds the score down' },
    toReachEight:{ type: 'string', description: 'what would have to change to reach 8, or "already at 8+"' },
  },
  required: ['score','ranAgainst','worst','toReachEight'],
}

/* Every lens x slice it owns. Not every lens over every slice -- see the LENSES comment. */
const CELLS = LENSES.flatMap(l => l.slices.map(s => ({ lens: l.key, brief: l.brief, slice: s, scope: SLICES[s] })))

log(`Council: ${LENSES.length} lenses over ${Object.keys(SLICES).length} slices = ${CELLS.length} review cells.`)
log('Reviewing the app as it stands, not a diff. Read docs/council.md for the standard.')

/* Review and verify as a pipeline: a cell's findings go straight into verification while other
   cells are still reading. No barrier -- there is nothing a verifier needs from another lens. */
const reviewed = await pipeline(
  CELLS,
  cell => agent(
    `You are the ${cell.lens} lens of the BadgeBudget development council, reviewing ONE slice.\n\n` +
    `SLICE: ${cell.slice}\n${cell.scope}\n\n` +
    `YOUR LENS: ${cell.brief}\n\n` +
    `Read the real code in index.html (and the named files) before claiming anything. Report only ` +
    `defects you can point at with a file:line and a concrete failure a user would notice -- no ` +
    `style preferences, no "consider refactoring", no findings you could have written without ` +
    `opening the file. An empty findings list is a fine and honest result for a clean slice. ` +
    `Set wageCore true if the fix would touch shiftGross/hourlyRate/computeNet/calc/statOf/` +
    `ptoStatOf/patternMetrics or the rate coercions in sanitizeData.\n\n` +
    `In ranAgainst, name the functions and line ranges you actually read.`,
    { label: `${cell.lens}:${cell.slice}`, phase: 'Review', schema: FINDINGS }),

  (review, cell) => {
    if (!review || !review.findings.length) return []
    /* Perspective-diverse refuters, not three identical ones: a finding can be wrong because the
       code already handles it, because the path is unreachable, or because the "failure" is not
       one. Three angles catch what three copies of the same skeptic cannot. */
    const ANGLES = [
      'Read the surrounding code. Is this already handled somewhere the finding did not look?',
      'Is the failure path actually reachable in the shipped app, given how the UI constrains input?',
      'Granting the mechanism, is the described outcome genuinely wrong -- or is it intended behaviour this project documents?',
    ]
    return parallel(review.findings.map(f => () =>
      parallel(ANGLES.map((angle, i) => () =>
        agent(
          `Refute this ${cell.lens} finding about BadgeBudget. Default to refuted=true when uncertain; ` +
          `a plausible-sounding finding that wastes the owner's time is worse than a missed nit.\n\n` +
          `ANGLE: ${angle}\n\n` +
          `TITLE: ${f.title}\nWHERE: ${f.where}\nCLAIM: ${f.detail}\nCLAIMED FAILURE: ${f.failure}\n\n` +
          `Verify against the real code before answering.`,
          { label: `refute:${f.title.slice(0, 40)}#${i}`, phase: 'Verify', schema: VERDICT })))
        .then(votes => {
          const live = votes.filter(Boolean)
          const refuted = live.filter(v => v.refuted).length
          return refuted >= 2 ? null : { ...f, lens: cell.lens, slice: cell.slice, dissent: live.filter(v => v.refuted).map(v => v.why) }
        })))
  },
)

const confirmed = reviewed.flat().filter(Boolean)
log(`${confirmed.length} findings survived adversarial verification.`)

/* Barrier is correct here: a lens cannot score itself until all of its own cells are verified. */
const scores = await parallel(LENSES.map(l => () => {
  const mine = confirmed.filter(f => f.lens === l.key)
  return agent(
    `You are the ${l.key} lens of the BadgeBudget council. Your verified findings after adversarial ` +
    `review:\n\n${mine.length ? JSON.stringify(mine, null, 2) : '(none survived verification)'}\n\n` +
    `Score this lens 1-10 for the app as it stands. 8 is the bar the council holds. Zero findings is ` +
    `NOT automatically a 10 -- if you could not examine something your lens owns, say so and score ` +
    `accordingly. In ranAgainst, state what was actually examined; a score without that is a badge, ` +
    `not a result.`,
    { label: `score:${l.key}`, phase: 'Score', schema: SCORE })
    .then(s => s && ({ ...s, lens: l.key, findingCount: mine.length }))
}))

const synthesis = await agent(
  `Synthesize a BadgeBudget council run into what the owner should do next.\n\n` +
  `VERIFIED FINDINGS:\n${JSON.stringify(confirmed, null, 2)}\n\n` +
  `LENS SCORES:\n${JSON.stringify(scores.filter(Boolean), null, 2)}\n\n` +
  `Merge findings that are the same defect seen through different lenses -- keep the sharpest ` +
  `statement and note which lenses saw it. Rank by what would actually hurt a nurse relying on ` +
  `this app for her pay. Split into: (1) safe to auto-apply now, (2) needs a dedicated session, ` +
  `(3) wage-core -- which NEVER auto-applies regardless of how safe it looks, because patternMetrics ` +
  `and computeNet now feed three surfaces. Say plainly which lenses are below 8 and what it takes ` +
  `to clear them. Do not pad: if the app is in good shape, say that.`,
  { label: 'synthesis', phase: 'Synthesize' })

return { cells: CELLS.length, confirmed, scores: scores.filter(Boolean), synthesis }
