# BadgeBudget — Shift Pay Planner

Take-home pay planner for bedside nurses, built for the owner's wife and her unit. Logs shifts +
differentials, shows what a shift is worth *before* it's worked, imports/exports .ics schedules, and
plans toward savings goals. It also carries an anonymous shift-swap board, kept deliberately quiet —
see Positioning.

- **Live:** https://badgebudget.com (custom domain since 2026-09-02). The old
  `https://patrick222-dotcom.github.io/705-v1/` URL 301-redirects there. **Verify deploys against
  badgebudget.com.**
- **Naming:** renamed from ScrubPay on 2026-09-04 (#64), visible strings only — the storage keys, the
  .ics UID scheme and the swap salt still say `scrubpay` on purpose (Invariants 5–7). The `scrubpay.*`
  domains belong to other parties; never present them as ours. Why the name changed:
  `docs/session-2026-09-02-domain-and-naming.md`.
- **Positioning (owner decision, 2026-09-19).** One sentence: **replace NurseGrid for schedule,
  then do the thing NurseGrid never did — tell her what the paycheck will be and whether the goal is
  reachable.** Calendar sync is the *substitution* half (she stops opening NurseGrid); the pay
  estimate and goal planning are the half nothing else on her phone does. Both are single-nurse value
  and need no colleague to adopt anything, which is why they lead.
  **The swap board is an Easter egg, not the growth engine.** It is the one feature that needs a
  critical mass of her unit before it is worth anything, and density has been zero since it shipped;
  Courtney asked for it off entirely. The call is to *quiet its CTAs*, not delete it: the board keeps
  working for anyone holding an invite link, and it stops competing for attention on the first screen
  with the two things that work for one nurse alone. Practical consequences, all load-bearing:
  (a) growth copy and any invite/QR framing lead with sync + paycheck, never with swapping — **and
      that includes the copy with no CTA attached to it**: the `<meta name="description">` search
      snippet and the `<noscript>` fallback both still ended on "runs an anonymous shift-swap board"
      four days after the decision, because the de-emphasis work went looking for buttons. Fixed
      2026-09-23 and pinned by `tests/smoke.mjs` §18;
  (b) `security-00` stops being a ship-blocker and becomes a **promotion-blocker** — the hardening
  session must land before the board is ever re-emphasised or its invite links go out at scale, and
  in-app copy may not call the board anonymous until it does — the last four such strings, the
  post toast `Posted — your unit sees it anonymously.` among them, were removed 2026-09-24 and
  pinned by `tests/smoke.mjs` §19, along with `privacy.html`'s claim that the database enforces
  the anonymity (it enforces the *reveal gate*, which is a different and true thing);
  (c) a lens that scores the app down for under-serving the swap board is scoring against a recorded
  decision — see `docs/council.md` and the council-charter item in `BACKLOG.md`;
  (d) **the NurseGrid host is confirmed (2026-09-28)** — the owner generated a real feed from the
  app (Calendar Settings → Generate Nursegrid Calendar Feed) and it serves from `app.nursegrid.com`,
  which the existing allowlist regex already matched: the guess was right. The regex is deliberately
  **not** narrowed to that exact host yet — one account is one sample, and a narrow pin that misses
  Courtney's subdomain would break the one user this app exists for. Narrow it when a second real
  feed agrees. What "no more need for NurseGrid" still lacks is **one end-to-end sync on a real
  phone**.
  **Corrected 2026-09-29:** this line used to end "everything up to that point is now verified",
  which was one step too generous. That real phone *did* try to sync, and it **failed six times** —
  NurseGrid hands out `webcal://app.nursegrid.com/…`, and `webcal:` is a non-special scheme whose
  `protocol` setter cannot be reassigned to `https:`, so `ical-proxy` rejected every feed with
  `400 https_only`. **No real NurseGrid feed had ever synced** since the subscription shipped on
  2026-09-03. What 09-28 verified was the feed's *host and shape*, not that the app could read it.
  Fixed in the app 2026-09-29 (`normalizeFeedUrl`, pinned by `tests/smoke.mjs` §23); the deployed
  Edge Function still carries the broken line but can no longer be reached by it, because the app is
  its only caller and now normalizes first.
  **The gap closed 2026-09-29 at 11:53 UTC, confirmed by the 09-30 groom: a real NurseGrid feed
  synced end to end on a real phone.** `ics_sync_done {events:3}` → `ics_import_done {added:3}`,
  the device's `session_end` shift count 7 → 10, and `POST 200` twice in the function's edge log
  with **zero 400s**, 3h18m after the fix deployed. So the substitution half of the positioning is
  real, the import stepper's pay-type questionnaire has been driven against a real NurseGrid feed,
  and the owner checked the result on 2026-10-03: **the synced shift is correct** (Wed Oct 14,
  12:15 AM, 12.5h, inferred *Night Shift* — matching NurseGrid's own shift screen side by side), and
  **removals propagate** (he deleted 2 of the 3 shifts in NurseGrid and they left BadgeBudget;
  `ics_sync_result {up_to_date, nursegrid}` at 12:49 UTC, zero `client_error`). Scope of that claim:
  **one shift, one account, owner's eyes** — not a test, and the dollar figure rests on his word
  rather than a probe. Before then this line said "do not upgrade until checked"; the 09-29
  correction above is what over-claiming here looked like.
  **A separate fault survives the fix and is NOT transient:** the first proxy call of a load has
  returned `422 not_a_calendar` on both real sessions (09-28 12:26:32, 09-29 11:53:07), each time
  followed by a retry that succeeded 24s later. Hypothesis (**unverified**): NurseGrid serves an
  HTML interstitial on the first hit. Legible from `client_error` from 2026-09-30 on — see below —
  so read one more real occurrence before building a retry against a guess. `BACKLOG.md` → P2.
  **Since 2026-09-30 a failed sync says why.** `icalFailureDetail` puts the HTTP status and the
  proxy's own `{error}` code in the ring buffer, so the four proxy failures are four distinct
  `client_error` rows instead of supabase-js's one generic sentence. The code is **whitelisted** to
  a short snake_case token, never trusted: an HTML body or a URL in the `error` field degrades to
  the bare status, because the feed URL is a bearer credential (Invariant 13). Pinned by
  `tests/smoke.mjs` §24. This exists because diagnosing the two failures above required the Edge
  Function's edge log, **which retains 24 hours** — the 09-29 groom read it with 4h11m to spare and
  the 09-30 groom with 4h42m. Two consecutive nights one bad night away from losing the evidence.
- **Beyond nurses (owner decision, 2026-10-10).** The nurse positioning above still leads.
  The app broadens through **persona presets on one engine**: Healthcare, Law enforcement,
  Fire & EMS, Other hourly. A persona sets starting values and which cards show. **It is never
  read by the pay math**: every dollar figure still comes from `periodPaycheck`. Union is a
  follow-up question, not a persona. Extra employers are **jobs** (the dormant spine), not
  "sub-accounts". Healthcare and Other hourly ship first on today's math. **Law enforcement and
  Fire & EMS appear only after the configurable work period lands**: on 12-hour schedules today's
  40-hour and 8/80 rules add +4.8% to +16.7% phantom overtime. There is no waitlist.
  **Session 1 shipped 2026-10-10** (`docs/onboarding-funnel-spec.md`): a seven-screen funnel, the
  presets in `@core:begin personas` (Healthcare **is** today's defaults — App's first-run state
  reads it, `tests/core.test.mjs` pins it), and `ob_view`/`ob_answer`/`ob_back`.
  `check_build.mjs` now fails if a wage-core definition so much as names a persona.
  **Session 2 (configurable work period) shipped 2026-10-10** (#168, owner-merged). It adds "only the shifts I mark as overtime" and N hours in a D-day period (7–28,
  straddling paychecks). That makes zero phantom overtime possible on every 12-hour schedule
  probed — the gate on the Law enforcement and Fire & EMS tiles, which are session 5.
  **Session 3 (pay events) shipped 2026-10-12** (#174, owner-merged, LIVE at `97f8e86`; `docs/pay-events-spec.md`):
  a marked shift can pay 2×/2.5×/any 1.5–4×, and court / call-back / report pay is max(worked,
  minimum). Hours a minimum pays but she did not work never count toward overtime (29 CFR
  778.221(b)). Tracking stays
  first-party (`track()` → `events`); PostHog was considered and deferred. Plan and reasons:
  `docs/session-2026-10-10-pay-patterns-and-onboarding.md`; the queue is the first item under
  "Needs a dedicated session" in `BACKLOG.md`.
  **Effective-dated rates shipped 2026-10-20** (#187, owner-merged, LIVE at `a103682`;
  `docs/effective-dated-rates-spec.md`): "New rate from [date]" in Settings, each shift priced by
  the rate on the day it starts.
  **Session 4 (dated pay items) shipped 2026-11-01** (#191, built 2026-10-20, approved by Pat
  2026-11-01 off its before → after card, merged after the deploy branch was brought into it and
  `tests/equality.mjs` re-read 34 identical / 0 unintended / 5 of 5 named against badgebudget.com;
  `docs/dated-pay-items-spec.md`): money that lands in one particular check — longevity, holiday
  cash, a ratification lump — as a `payItems` list on the job, never on a shift, in the pay period
  whose dates hold its date. It never enters that period's overtime (29 CFR 778.209(a)); a "bonus"
  item is withheld at the flat 22% (IRS Pub 15 §7). This is what lets goal math see December and
  January money: `periodPaycheck` carries it. Session 5 (the Law enforcement and Fire & EMS tiles)
  is next.
- **Two goals:** (1) ship a polished app; (2) **meta-goal** — refine a reusable multi-agent
  "development council" process: context preservation between agents, automated fix→re-review
  until every lens scores 8/10, less manual synthesis by the orchestrator, real mobile testing.
  The council became reusable on 2026-09-13 — charter in `docs/council.md`, runnable in
  `.claude/workflows/council.mjs`; before that it lived only in whichever session ran it. Review is
  automated, **fixes are still applied serially by the orchestrator** (workflow scripts have no
  filesystem access, and parallel edits to one 5,800-line file would conflict anyway), so the
  "automated fix→re-review" half of this goal is genuinely unmet.
  Council history lives in `docs/history.md`; the latest full run (2026-09-13 → 16: 56 cells, 85
  confirmed, three doc claims disproved) is in `docs/council-runs/2026-09-13/`.

## Operating committee (owner decision, 2026-10-12)

Pat starts more than he can track, so a chief of staff keeps **one page true:
`docs/cos/now.md`** — at most 3 threads and 3 open decisions, enforced by `scripts/cos_check.mjs` in
the gate. Four seats sit under it, each owning its own files so they never collide in `index.html`:
**CTO** (the only writer of `index.html`; the nightly loop is its hands), **COO** (ops, support,
S1 hotfixes), **Risk & Compliance** (legal pages, migrations, access) and **CFO** (cost, exit
readiness, monthly). Seats run when a trigger fires, not on a timer; the chief of staff re-runs
every cited check before a claim reaches Pat. Charter and approval tiers: `docs/leadership.md`.
The `cos` skill is the chief of staff (`/cos` for a brief, an idea, a decision, or the intro).
**Every session:** the SessionStart hook lists the threads. Work on one ends each commit with a
`Thread: <id>` trailer; work on none is fine and adds one line to `docs/cos/inbox.md`.

## How to talk to me (owner: Pat)

Applies to every session in this repo — nightly loop, council run, ad-hoc, subagent summaries.

- **Be direct. Keep answers short, in everyday language, unless I ask for detail.** No preamble, no
  restating my question, no closing recap — first sentence is the answer or the recommendation. Past
  ~200 words, give the short version and offer the long one. "Explain", "detail", "stress-test",
  "explore" or "vision" are the switches that turn depth on; until one of those, assume I'm
  executing, not studying.
- **Plain words over repo jargon.** This file is dense on purpose, but a *reply* shouldn't be. Say
  "the deploy check" before `check_build.mjs`, "the pay math" before Invariant 3 — name the file or
  invariant once for precision, then keep going in English.
- **Anything I need to do goes in a numbered "Next steps" list at the end.** Max 5, concrete, the
  first one doable right now. Tasks buried in paragraphs get lost.
  **Tag every step with who does it** — start each with **(You)** or **(Me)** — so an action of
  mine is never mistaken for one of his (owner request, 2026-10-03).
- **When there are options, pick one and say why in a sentence.** Don't survey. If you need a decision
  from me, ask at most one clarifying question, and only if you genuinely can't proceed on a stated
  assumption — otherwise state the assumption and keep going.
- **No sycophancy, no validation, no hedging.** Disagree when I'm wrong and say so plainly. If a
  finding is uncertain, say "unverified" and name what would verify it — this repo has been burned by
  confident doc claims that turned out false (three of them in the 2026-09-13 council run).

## Where things are

| Path | What |
|---|---|
| `index.html` | the whole app: CSS, a plain-JS boot script, one Babel-transformed JSX block |
| `pdf.worker.min.js` | pdf.js worker, served same-origin next to `index.html` |
| `CNAME` | `badgebudget.com` — load-bearing, see Deployment |
| `ops.html` | the ops console — a live feedback inbox for the two admins, served at `/ops.html`. In the publish set. Plain JS, no React/Babel/fonts, supabase-js only (same SRI pin as the app — **asserted since 2026-11-20**, not just stated: the gate requires every remote script here to be a row `index.html` also ships, same url and same hash, because this was a second copy of that pin that nothing read and deleting its `integrity` attribute left all 21 checks green). Borrows the app's session (same origin = same localStorage), so it has no auth UI of its own. `noindex`, and deliberately **unlinked from the app** — the gate is `is_ops_admin()` in Postgres, not this page. It renders everything through `textContent` and **that is gated since 2026-11-21** by a parsed walk of its inline script rather than by the one-spelling regex that preceded it (Invariant 8). Design: `docs/ops-console-scope.md` |
| `privacy.html` | the privacy notice, served at `/privacy.html`. In the publish set. Self-contained — no fonts, scripts or styles from anywhere else, so it can't break and makes no third-party requests. Linked from Settings. Served by the harness (copied verbatim) and asserted off its own DOM since 2026-09-24 — `tests/smoke.mjs` §19. **Its self-containment is gated since 2026-11-19** — the gate's `[2]` CSP check walks the page's content rather than two attribute spellings of one scheme: every attribute the browser fetches, every `url()`/`@import` in its CSS, and no `<script>`/`<iframe>`/`<object>`/`<embed>` tag at all, inline included. The old clause passed a `@font-face` webfont, an `@import`, a single-quoted remote `<script>` and a protocol-relative tracking pixel, all four measured |
| `.github/workflows/deploy.yml` | the deploy workflow: 5-file publish to GitHub Pages. (`ci.yml` is the PR gate — see Deployment) |
| `docs/project-notes.md` | the mechanisms, history and figures moved out of this file on 2026-09-27 — Architecture detail, analytics event list, ops dashboard, nightly-loop history, Supabase, Testing, Open items |
| `.claude/settings.json` + `scripts/hooks/pre_push_gate.mjs` | the harness hooks — see Harness hooks |
| `BACKLOG.md` | the nightly loop's durable memory: queue, parked items, blocked, Done log |
| `docs/leadership.md` + `docs/cos/` | the operating committee: charter and approval tiers; `now.md` (the one page Pat reads), `brief.md` (weekly), `inbox.md` (ideas and off-plan work), `seats/` (one queue per seat, max 5). Caps held by `scripts/cos_check.mjs` |
| `supabase/migrations/` | `000_core.sql` (`user_data`/`feedback`/`events` + RLS, captured 2026-09-13), `001_swap_board.sql`, `002_ical_subscription.sql` (the iCal feed table), `003_feedback_kind.sql` (the feedback tile tag), `004_ops_console.sql` (the `ops_admins` allow-list + the admin-gated ops RPCs + the first indexes on `events`/`feedback`; applied 2026-09-13, gate probed 10/10), `005_feedback_anon_id.sql` (the device join key on `feedback`; applied 2026-09-14), `006_ops_device_trail.sql` (phase 3b — `ops_device_list()` + `ops_device()`, the per-device touch-point trail; applied 2026-09-16, gate probed 6/6 including over the real REST API with the public anon key), `007_feedback_inbox_anon_id.sql` (adds `anon_id` to `ops_feedback_inbox()` so a report links to that device's trail; applied 2026-09-16 — a DROP and recreate, because Postgres cannot add an OUT column with CREATE OR REPLACE, with the grants and the `anon` denial re-probed after). 000→004 in order stands up a fresh project; 000 is a snapshot of the schema *before* `kind`, so it is never back-edited |
| `supabase/functions/ical-proxy/index.ts` | SSRF-guarded Edge Function that fetches a nurse's secret iCal feed (deployed, `verify_jwt` on) |
| `scripts/groom_seed.mjs` + `scripts/test_groom_seed.mjs` | Reddit-seed groom tooling + its 33-assertion suite |
| `scripts/check_build.mjs` | the mechanical invariant gate — parses the JSX and asserts Invariants 1, 2, 4, 5, 6, 8, 9, plus that the extracted core below is in sync, (since 2026-10-10) that no wage-core definition names a persona, (since 2026-10-12) the operating committee's caps, and (since 2026-10-26, a third since 2026-10-29) three of Invariant 13's five clauses — no feed field in `serializeState`, no logging in `ical-proxy`, no title kept by the .ics parser — (since 2026-10-30) that **every host the published HTML loads is permitted by its own CSP**, the forward direction only — plus, since 2026-11-19, that **`privacy.html` really is self-contained**, which that same check had been asserting with a regex over two attribute spellings of one scheme while printing the word for the whole property (a webfont through CSS `url()`, an `@import`, a single-quoted remote `<script>` and a protocol-relative tracking pixel all passed it, measured) — and (since 2026-10-31) that **the same-origin `pdf.worker.min.js` is the build the CDN pin names**, which is the sixth script the app loads and the one none of the other mechanisms can see, and (since 2026-11-01) that **the test harness installs and rewrites exactly the pins `index.html` ships** — `tests/harness.mjs` holds the five CDN versions a second time, in `PKGS` and `MAP`, and a disagreement makes the 910-assertion suite pass against a different build than production runs, and (since 2026-11-22) that **every write to `user_data` carries a conflict target** —
Invariant 4's check was one unanchored regex printing the word `present`, and six realistic
23505-forever edits left the gate green while two behaviour-neutral formatting edits turned it
red, because it pinned the payload's property order and the options object's spacing; the set of
write sites is derived now, which brings the keepalive unload POST the invariant's own text names
into the gate for the first time — and (since 2026-11-21) that **`ops.html` hands no string to the HTML parser**, which that check had been asserting with a regex over one spelling of one sink — `.innerHTML +=`, `outerHTML`, `insertAdjacentHTML`, a computed `['innerHTML']`, `document.write` and `Object.assign({innerHTML})` all passed it, measured, on the one published page that renders text typed by the public into an admin's same-origin session — and (since 2026-10-27) **its own roster** — the last check declares the others by label and fails if the count moves, because "All N passed" was a number nothing compared, and (since 2026-11-14) that **the storage-key set is DERIVED from the file, not declared beside it** — Invariant 5's check was a hardcoded list of six whose figure read `6/6 intact` while the app used eight keys, so it answered "are these still here?" and could never answer "are these all of them?", and (since 2026-11-10) that **the ops dashboard's event inventory can still see every name that reaches `events`** — it resolves every `track()` shape, every row written to the table is built by `eventRow` (the four callees the inventory walks), and the eight names only an AST can resolve are still in the list, which is the "simplify this back to a grep" guard moved out of a suite CI does not run, and (since 2026-11-11) that **every same-origin link in a published page points at a file the deploy actually copies** — the publish-set check asserts the set is exactly five files and never that those five are *enough*, so a Settings link to a page deploy.yml never copies is green in the gate, drivable in the harness and a 404 in production (PR #209 is the live instance) — and (since 2026-11-23) that **it parses each source ONCE and shares the tree across every walk**, which is a speed change that turned out to be a correctness one. Ten of its checks are AST walks and each called `Babel.transform(body, {presets:['react'], plugins:[{visitor}]})` for its own tree: a full parse AND a full JSX transform of the same 512KB inline script, ~550ms apiece, **15 times**, which is 5.5 of the gate's 6.0 seconds. Under that preset a visitor registered as a plugin sees a call inside a JSX attribute **twice** — once in the JSX tree, once again after the transform re-inserts the same expression as an argument to `React.createElement` — and Invariant 5's check tallied visitor invocations, so it printed **`45 sites`** for the eight nights after its derivation shipped while `index.html` holds exactly **35** (`grep -cE '(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(' index.html` → 35). Nothing could see it: a figure is not a verdict, the gate passed either way, and no row in the meta-test read it. Sites are keyed on their node's own offset now, so the count is right however many passes a future walk makes — the fix is the dedupe, **not** the parser choice, because "parse without the preset" is one preset away from wrong again. The walks also no longer read 69% synthesized nodes (3,482 CallExpressions in the source against 11,090 after the react preset), which matters because several of these checks use a node count as an anti-vacuity floor. Gate 6.03s → **2.65s**; the meta-test ~8min → **4m7s**. The summary now prints `3 AST parse(s) shared by 15 walk(s)` so the cache is asserted rather than claimed. 21 checks |
| `scripts/test_check_build.mjs` | the gate's own meta-test (104 — 100 until the shared-AST walk added one break and the ninth GREEN 2026-11-23, 86 until Invariant 4's derivation added eleven breaks and the sixth, seventh and eighth GREENS 2026-11-22, 76 until the ops.html HTML-sink walk added eight breaks and the fourth and fifth GREENS 2026-11-21, 70 until the ops.html SRI clauses added five breaks and a third GREEN 2026-11-20, 62 until privacy.html's self-containment added six breaks and the first two GREENS 2026-11-19, 55 until Invariant 5's derivation clause added seven breaks 2026-11-14, 51 until the published-link check's four breaks 2026-11-11, 46 until the event-inventory check's five breaks 2026-11-10, 41 until the harness-pin check's five breaks 2026-11-01, 33 until the pdf.js-worker check's eight breaks 2026-10-31, 28 until the CSP clause's five 2026-10-30, 23 until the parser clause's five 2026-10-29) — the roster, plus **88 deliberate breaks covering all twenty-one checks** and, since 2026-11-19, **nine GREENS — edits that must leave the gate GREEN**, because every other assertion in the file asks only "does a break go red?" and one false positive on an ordinary edit gets a check *weakened* by whoever meets it (the first is negative-tested on a measurement rather than an argument: a walk that counts `<a href>` as a fetch passes today's clean page, so the clean baseline cannot see it), each run against a `.gate-scratch/` copy and required to exit non-zero AND name the right invariant. A check holding several clauses gets one break per clause, because a group of `must()`s broken as a group only proves that *one* of them has teeth. **Since 2026-10-30 a break may pin the failing check's LABEL as well as its tag**, and the nineteen `[2]` breaks do: **three** checks share that tag now (SRI, the CSP, and the pdf.js worker), so `✗ [2]` alone would credit a CSP break to the SRI check and count a break that failed the wrong row as a win. **`events` became the second shared tag on 2026-11-10** (unload telemetry, the harness neutraliser, the event inventory) and the two pre-existing `[events]` breaks had carried no pin — the same hole, quietly reappeared in a band nobody had revisited; all seven now pin the label. The pin is negative-tested like any assertion — pointing it at the wrong label turns all five CSP breaks red (measured 2026-10-30) and all eight worker breaks red (measured 2026-10-31, 33 passed / 8 failed). A check with a tag of its own needs no label pin, which is why the five `[harness]` breaks added 2026-11-01 carry none; they were negative-tested the other way instead — neutering the check to `return` turns all five red (measured 2026-11-01, 41 passed / 5 failed). The five `[events]` inventory breaks were negative-tested the first way: pointing their pin at a different real label turns all five red (measured 2026-11-10, 46 passed / 5 failed). **`8` became the THIRD shared tag on 2026-11-11** (the publish set, the ops console, the published-link walk) — and unlike the other two it had been shared by two checks since 2026-09-13 with *neither* break pinned, so the hole predates the rule rather than reappearing after it; all five `[8]` breaks pin the label now, negative-tested the same way (measured 2026-11-11, 51 passed / 4 failed). **The six privacy.html breaks added 2026-11-19 were negative-tested the second way and the two GREENS the opposite way**: neutering the self-containment walk turns all **seven** privacy breaks red while both controls stay green (63 passed / 7 failed), and over-rejecting turns the two controls red (66 / 4) — and the neutered run is also where the label pin earned itself again, reporting the empty-page break as a wrong-row failure because with the walk gone it fails `[8]` instead of `[2]`. **The five ops.html SRI breaks added 2026-11-20 were negative-tested the second way and the new GREEN the opposite way**: neutering the ops half of the check turns all five red while all three controls stay green (71 passed / 5 failed) — and that run is the *third* time the label pin earned itself, reporting the no-remote-script break as a wrong-row failure because with the ops walk gone it fails `[harness]` instead of `[2]` — while swapping the url+hash comparison for a whole-tag string match turns the new control red and leaves all five breaks passing (75 / 1). **The eight ops.html HTML-sink breaks added 2026-11-21 were negative-tested both ways too, and the second direction is the one that earned its place**: neutering the sink half turns all **nine** `[8]`-ops rows red — the eight new ones plus the pre-existing innerHTML break — while all five GREENS stay green (77 passed / 9 failed), and swapping the AST walk for a widened regex that strips `//` comments first turns **exactly** the two new GREENS red while all 76 breaks stay green (84 / 2). That second run is the whole argument for having GREENS: the naive repair is green on the clean baseline, so nothing else in the suite can see it. **The 2026-11-23 rows were negative-tested three ways, and one of them caught a bad assertion of its own**: neuter the AST cache and the parse-count row goes red alone (103 / 1, `15 AST parse(s)` where 3 is the floor); revert the site dedupe to a tally and **only** the ninth GREEN goes red, reporting `45 sites` while the clean baseline still reads 35 (103 / 1) — the clean page cannot see this one, which is the whole reason it is a row; and take the tempting repair for the new `[8]` break (parse `ops.html` *with* the jsx plugin) and that break passes a deliberately broken tree (103 / 1). The caught mistake: the GREEN's first draft reverted `walk()` to a transform and then traversed the resulting AST **separately**, which does not reproduce the double-visit at all — it passed with the fix reverted. The double-visit needs the visitor registered **as a Babel plugin**, so the row replaces the whole helper. An assertion that only ever passes is what this file exists to refuse, and it nearly shipped one. Why both halves: a gate whose `must()` is neutered to a no-op still prints "All 19 mechanical checks passed", and the roster half passes it completely — only the breaks catch it (measured 2026-10-27: 16 of 23 fail). **Not in CI yet** — the `gate` job needs one line, and editing a workflow file is blocked for agent sessions |
| `scripts/extract_core.mjs` + `supabase/functions/_shared/badgebudget-core.mjs` + `tests/core.test.mjs` | the pure domain core (wage math, pay-period paycheck, sanitizer, patterns, stub parser) sliced out of `index.html`'s `/* @core:begin … */` regions into an importable ES module — **generated, committed, never hand-edited** — and its Node unit tests (175 — 135 until dated pay items 2026-10-20, 116 until effective-dated rates 2026-10-17, 111 until the manual-sync preference 2026-10-16, 83 until the pay events 2026-10-11, 71 until the FICA health-premium split 2026-10-11, 51 until the configurable work period, 20 until onboarding v2's presets and whitelist, both 2026-10-10). One copy of the math, two callers: the app and the MCP gateway (2026-10-07) |
| `tests/harness.mjs` + `tests/smoke.mjs` | the Playwright rig, in git since 2026-09-07; **1,012 assertions** on an iPhone 13 profile, plus first-gen iPhone SE in §30 and §38 (read "1,002" until §62’s worker-bytes check 2026-11-17, "985" until §61’s sync-plan-size check 2026-11-16, "962" until §60’s SRI-hash-vs-bytes check 2026-11-15, "935" until §59's access-watch classifier 2026-11-13, "922" until §58's roll-call 2026-11-12 — **the suite's own roster**: 61 declared sections, and the run fails if one never ran, if one ran and asserted **nothing**, or if the roster and the file's `want(n)` guards disagree in either direction. It sits **outside `want()`** on purpose, because the run it most needs to speak up on is a narrowed one; adding a section costs one line in `SECTIONS`, which is the same friction `check_build.mjs`'s roster took and is the point — a roster derived from the file it checks cannot catch the file. "910" until §57's Babel-note filter 2026-11-03, "902" until §56's Clear-all-data feed delete 2026-11-02, "883" until §55's dated pay items landed with #191 2026-11-01, "869" until §54's feed-credential redaction 2026-10-28, "860" until §53's browser resolver 2026-10-25, "852" until §52's .ics round trip 2026-10-24, "850" until §30's webfont-guarded wordmark fit 2026-10-23, "832" until the stepper sync opt-out 2026-10-22, "817" until the banner sync opt-out 2026-10-21, "802" until effective-dated rates 2026-10-20, "791" until the empty-day save 2026-10-18, "786" until the paystub empty-parse counter 2026-10-17, "772" until the manual-sync switch 2026-10-16, "765" until the planner-delete uid memory 2026-10-15, "757" until the paystub photo refusal 2026-10-14, "751" until the paystub-reader failure 2026-10-13, "736" until the pay events 2026-10-11/12 merged, "725" until the anon-id freshness flag 2026-10-12, "694" until the FICA health-premium split 2026-10-11, "682" until the configurable work period 2026-10-10, "633" until onboarding v2 2026-10-10, "632" until the core-extraction probe 2026-10-10, "591" until the re-sync dismissal 2026-10-10, "571" until the import-update disclosure 2026-10-09, "555" until the exhausted-load banner 2026-10-07, "539" until the cloud-load retry 2026-10-06, "518" until the unload-save keepalive 2026-10-05, "496" until the time-off repair path 2026-10-04, "467" until the hero-stats change 2026-10-03, "456" until time-off entries got their own default 2026-10-03, "455" until the weekend-pickup card was hidden 2026-10-03, "450" before the second 2026-10-03 change, "437" before that — regenerate the figure from a run, don't trust the line). `buildScratch` emits a local copy of `ops.html` too, so the console's gate is drivable. **The browser is discovered, never pinned** (2026-10-25): `chromiumLaunch()` in `harness.mjs` is the one resolver all three Playwright entrypoints share — newest headless shell, then `/opt/pw-browsers/chromium`, then the newest full build, then **`null`** so playwright-core resolves its own on CI. A pinned path that has moved kills the suite with Playwright's "just installed or updated" banner, which is a **harness error, not a failed assertion** — the gate reads un-run rather than red. Pinned by `tests/smoke.mjs` §53, which runs *before* `chromium.launch` so that break prints a FAIL instead of only an exception |
| `scripts/ops_gate_probe.sql` | the adversarial probe set for the ops console's guard — non-admin, `anon`, revocation, and the positive control. Run it before trusting `/ops.html`; the SQL editor's default session is a superuser and both obvious probes lie |
| `scripts/silence_watch.mjs` + `scripts/test_silence_watch.mjs` | is the app silent because nobody came, or because telemetry is broken? Four verdicts (`FRESH` / `SILENT_BUT_HEALTHY` / `SILENT_AND_UNHEALTHY` / `UNKNOWN`), always saying which side it could establish. Reports rather than alarms — only a silence *with* a failed health check exits non-zero. Needs network + `SUPABASE_ACCESS_TOKEN`, so like `tests/equality.mjs` it is not in CI; its 39-assertion classifier suite is |
| `scripts/access_watch.mjs` | is production's ACCESS posture still what the invariants claim? Reads `pg_class`, `pg_policies` and `pg_proc` and grades **16 rules**: `ical_subscriptions` owner-only with **no `anon` grant** (Invariant 13's RLS clause, whose own `Verify` line said `rls_audit.js` is *not in git, so currently unreproducible* — this is that check, in git), `user_data` owner-gated (Invariant 4's table, where `anon` DOES hold grants so RLS is the only barrier), `events`/`feedback` with no SELECT for `anon` or `authenticated`, `ops_admins` still at **zero** policies, and the five `ops_*`/`is_ops_admin` functions not executable by `anon` and still SECURITY DEFINER. Four verdicts (`TIGHT` / `LOOSE` / `UNKNOWN` / `UNREACHABLE`); only `LOOSE` exits 1. Two asymmetries are the reason it is not a grep: a **null `relacl` is owner-only** (tight) while a **null `proacl` is `PUBLIC EXECUTE`** (loose — a new `ops_*` function is anon-callable the moment it exists unless something revokes it), and a grant to `PUBLIC` reaches `anon` without the word "anon" appearing. A missing subject is `UNKNOWN`, never a pass by omission. **It is not a probe** — it never connects as `anon`, so a policy owner-gated in shape and wrong in logic passes; `scripts/ops_gate_probe.sql` is still the thing that exercises the gate. Read it as "nothing has been loosened". Needs network + `SUPABASE_ACCESS_TOKEN`, so the live half is not in CI; its classifier is, as `tests/smoke.mjs` §59 (27 assertions, eight measured breaks) — deliberately inside the suite CI runs rather than a fourth orphan suite |
| `docs/onboarding-funnel-spec.md` + `scripts/onboarding_funnel.sql` | onboarding v2's spec (every screen, the field each answer sets, the event it fires) and its funnel query — devices per screen, answer mix, back-outs, completion, with the harness pair, `nostore-`, insiders and crawlers excluded |
| `scripts/dashboard_snapshot.sql` + `.mjs` + `scripts/test_dashboard_snapshot.mjs` | one query → one JSON blob for the ops dashboard; the `.mjs` folds in the event-name inventory read from `index.html`, which is the whole basis of `dead_events` — *which instrumented event has never fired*, i.e. which shipped feature nobody has touched. **An AST walk since 2026-11-09, never a grep.** It had been `/track\('([a-z_]+)'/`, so a name had to be a bare literal immediately after `track(`, and four shapes had grown past it: the ternary `track(verb==='removed' ? … : …)` the raise (#187) and dated pay items (#191) both use, `trackOb` (the onboarding whitelist wrapper), and `eventRow` (the keepalive beacon, which is the only route `session_end` takes). Eight names missing — `ob_view`/`ob_answer`/`ob_back`/`session_end` were firing from outside the list, and the four `rate_change_*`/`pay_item_*` names have **zero rows**, which is exactly what `dead_events` prints and could never contain. So the tool for "has anyone used this" was blind to the two newest money features; the 10-20 backlog claim that the raise shipped with *no* telemetry was false for six nights for the same reason. Four callees count, conditionals resolve per branch, relays are counted as forwarders rather than named, and **anything unresolvable throws** — there is deliberately no regex fallback, because a fallback that returns the old short list is the bug. 63 names, was 55. Its suite: 44 assertions, nine measured breaks, one of which runs the old regex and requires it to come back short — and since 2026-11-10 `check_build.mjs` holds the same guard, because that suite is not in CI |
| `scripts/deploy_watch.mjs` + `scripts/test_deploy_watch.mjs` | is what is MERGED actually LIVE? Hashes four of the publish set's five files against the deploy branch's git blobs — `deploy.yml` copies them verbatim, so a sha256 match is conclusive and needs no marker string. Five verdicts (`LIVE` / `BEHIND` / `NOT_THE_APP` / `UNKNOWN_BUILD` / `UNREACHABLE`); `BEHIND` names the commit actually being served and how many changes are unshipped. **It fetches the deploy ref before judging anything against it** (2026-10-19) — on 2026-10-11 it printed `LIVE` 24 seconds after a merge, naming the *pre-merge* commit, because the local clone was behind origin and `history[0]` was not the tip; a fetch it cannot complete now degrades `LIVE` to `UNKNOWN_BUILD` rather than printing a warning, because the verdict word is the part that gets read. **And it no longer names a commit a shallow clone cannot know** (2026-11-06) — containers here clone shallow (Invariant 10), a shallow boundary commit is parentless so `git log -- <path>` reports it as the commit that *added* every file in its tree, and for `privacy.html`/`ops.html` — unchanged since 2026-09-24, every real change below the boundary — the walk returned that one entry and the watch printed it as the commit being served. That figure drifted with the clone depth and eight consecutive grooms wrote a paragraph calling it an artefact. It is `history[0]`-is-not-the-tip through a door the fetch guard cannot cover: that guard proves the ref is *current*, not that the history behind it is *complete*. The **verdict is deliberately unchanged** — the newest commit the walk can see carries the tip's blob either way, so `behind: 0` still proves the bytes are current, and downgrading two files nightly in a clone shape that is normal here would be crying wolf; the attribution was what was false, so the attribution is what changed. **And since 2026-11-18 it reads `pdf.worker.min.js` too, which is the live half of Invariant 2's newest clause.** It had been excluded for being "a megabyte that has never changed" — the same sentence as "nothing in this repo has ever read a byte of the copy real users execute". `tests/smoke.mjs` §62 (2026-11-17) proved the *committed* worker is byte-identical to `pdfjs-dist@3.11.174`'s `build/` file and said in as many words that it never fetches badgebudget.com; the live half was **one hand-run curl on one night**, which that band filed as "the natural home is `deploy_watch.mjs`". The two join through the property this whole file rests on: `deploy.yml` copies the publish set verbatim. Graded like `privacy.html`/`ops.html` — 200, not empty, then the hash, which is where all the work is — and in this container its walk hits the shallow boundary, so it prints the truncation sentence and reads LIVE. **It can also fail the run**, which is the point: a pin bumped in `index.html` with the file left behind kills the paystub reader outright (pdf.js compares the two versions itself and throws), and that is now a `BEHIND` instead of a silence. **Every file is hashed from BYTES now, not from `res.text()`** — the comparison was never of the served bytes, it was of a re-encoding of a decode of them, which is lossy for anything not valid UTF-8; measured 2026-11-18 the live worker is 1,087,212 bytes against 1,087,181 characters and index.html 579,910 against 578,622, so the two reads were never the same question even where they agreed. Stated in the direction it actually runs: a re-encode can only ever **miss** a blob it should have matched, so what this removes is a permanent false `UNKNOWN_BUILD`, never a false `LIVE`. The decoded string still feeds the shape guards, because a character floor and an SRI count are questions about text. Needs network, so like `silence_watch.mjs`'s live probes it is not in CI; its 121-assertion classifier suite is (98 until the worker clause 2026-11-18, 84 until the truncation clause 2026-11-06) |
| `docs/reddit-persona-pipeline.md`, `reddit_seed.json`, `reddit_personas.json`, `reddit_intake_prompt.md` | Reddit insights → backlog candidates → persona testers |
| `docs/ops-console-scope.md` | the ops console design record — why an artifact can never be live, the three read-path shapes and why security-definer functions won, the wedge that shipped, phases 2–4, and the written-down line on what the console may never show |
| `docs/swap-board.md` | swap-board design, anonymity model, audit history, verification standard |
| `docs/data-deletion-spec.md` | the account-and-data deletion design record (2026-11-08, spec only, nothing built) — the twelve tables that hold a signed-in user's data and which six have no client DELETE policy, the two security-definer functions, the eight-probe gate, and the **finding that `privacy.html`'s emailed account-deletion promise is unkeepable today**: `events.user_id` and `feedback.user_id` are `ON DELETE NO ACTION` FKs to `auth.users`, so deleting any of the 4 accounts raises 23503 by every route |
| `docs/domains.md` | registrar, DNS, renewals, OAuth consent-screen limitation |
| `docs/council.md` | the council charter — the 13×10 lens/slice matrix, the ≥8/10 standard, adversarial verification, and what a run deliberately does not do. Runnable form: `.claude/workflows/council.mjs` |
| `docs/history.md` | dated log of decisions, incidents and resolved work (council runs, the sync P0, NurseGrid research) |
| `docs/state-brief-2026-09-02.md` | adversarially-verified repo survey + a 23-item prioritized cleanup list |
| `docs/agent-gateway-scope.md` | the "one domain, two surfaces" (UI + MCP) design: core extraction, versioned ops, an MCP Edge Function on Supabase OAuth, an ops manifest. Design only — nothing implemented |
| `docs/scaling-and-burn.md` | capacity + cost ladder to 100k users, the pre-scoped infra levers with trigger thresholds, the density/retention metric definitions (runnable SQL), and the transferability checklist. Strategy only |
| `docs/pay-rule-patterns.md` | 30 public contracts (21 police, 4 nurse, 5 other hourly): the pay-rule patterns, the pay model broken into primitives, probes of phantom overtime by schedule, 12 missing primitives ranked, and why no records request is needed. Research only. Its Upper Darby predecessor: `docs/police-pay-rules-draft.md` |
| `docs/session-2026-10-10-pay-patterns-and-onboarding.md` | decision record for the multi-persona onboarding plan: personas as presets, PRN/part-time, first-party funnel tracking, and the six-session build order |
| `docs/session-2026-10-10-onboarding-v2-and-work-period.md` | handoff for the session that shipped sessions 1–2 (#167, #168) and the field evidence (#169): decisions, findings, and the order from here (FICA health-premium fix next) |
| `docs/pay-events-spec.md` + `docs/session-2026-10-11-pay-events.md` | session 3's wage-core spec (per-shift overtime multiplier, court/call-back/report minimums, the 29 CFR 778.221 threshold ruling) and its session log, which ends with the ready-to-paste kickoff prompt for session 4 (dated pay items) |
| `design-system/` | 12 static HTML spec pages + `cards.json` from the 2026-07-29 Liquid Glass pass. Reference only: not deployed, not loaded by the app, may lag `index.html` |
| `.mcp.json`, `.agents/skills/`, `skills-lock.json` | Supabase MCP server config + vendored Supabase skills (symlinked, hash-pinned) |
| `.claude/skills/{ship,wage-core,harness}/` | the project's own skills — the deploy ritual, the Invariant 3 protocol, and the test rig. See Skills |

## Invariants — never weaken, never rename

`scripts/check_build.mjs` gates **1, 2, 4, 5, 6, 8 and 9** on every PR. **7, 10, 11 and 12 are
human-held** — no machine sees them. **3 and 13 are PARTLY gated and the gate says which part:** 3's
persona rule only (2026-10-10), and 13's three mechanical clauses — the feed field staying out
of `serializeState` and `ical-proxy` logging nothing (2026-10-26), and the .ics parser keeping no
titles (2026-10-29). Everything else in 3 and 13 is
human-held, and the gate's roll-call keeps naming it: "13 is checked" would be a worse claim than
"13 is not".

Each one carries a `↳` trailer in a fixed shape: **Detect** (what would tell you it is *already*
broken in production), **Blast** (what breaks, and how widely, when it is) and **Verify** (the
command that proves it holds right now). The prose is for a reader; the trailer is a fixed shape so
it can be parsed later instead of re-excavated from the history — it is the remediation graph in
denormalized form, so don't strip it as decoration. `Detect: none` is not a hole in the notes, it
is the finding: **exactly one invariant (4) has a live production signal**, and it was added *after*
the 47-day outage it exists to catch.

1. **Boot hardening** in the plain-JS boot script: 8s watchdog error screen; Supabase client creation
   null-guarded (app degrades to localStorage-only if the CDN script fails); `getSession()` raced
   against a 4s timeout (WebKit deadlock — iPhone Chrome is WebKit too). These fixed a long-standing
   iPhone infinite spinner.
   ↳ **Detect** none — a device that never boots never fires `app_open` and never flushes the error
   buffer, so the spinner was invisible in analytics for its entire life. **Blast** every WebKit
   device including iPhone Chrome; app unusable, silently. **Verify** `node scripts/check_build.mjs`
   plus `tests/smoke.mjs` §1 (boots), §5 (`getSession` hangs), §6 (Babel blocked).
2. **SRI on all 5 CDN scripts** (`grep -c 'integrity="sha384-' index.html` → 5), exact pinned versions.
   ↳ **Detect** none — SRI *working* is a blocked script, which surfaces as the watchdog screen,
   indistinguishable from a CDN outage. **Blast** without it a CDN compromise runs arbitrary JS with
   the whole `user_data` blob in reach. **Verify** the grep above; gated by `check_build.mjs`.
   **The grep above is `index.html`, and the publish set ships a SIXTH pinned script — gated
   since 2026-11-20.** `ops.html` loads supabase-js from jsDelivr with its own `integrity`
   attribute: a second copy of the app's pin, in a different file, on the same origin, and the
   gate's `[2]` check counted five attributes in one of the two files. Measured against that
   clause before anything was written, **three** edits to `ops.html` left the gate printing
   `All 21 mechanical checks passed` — corrupting its hash, pasting React's hash into its row,
   and **deleting its `integrity` attribute outright**. A fourth, bumping the version in its url,
   did fail, but incidentally: the harness-pin check reads that url only because
   `buildOpsScratch` finds the row by substring, so the url was held by a check that does not
   care about it and the hash was held by nobody. The missing-attribute case is the one that
   matters, because it is the only one that fails **open** — a wrong hash blocks the script and
   kills the console for its two admins, while a missing one loads a third party's JavaScript
   unverified into the origin that holds `user_data` and the auth session, which is this
   invariant's own stated blast radius arriving on the one page in the publish set the count
   never covered (`ops.html` borrows the app's session precisely because it is same-origin). The
   rule gated is **identity, not a second byte check**: every remote `<script>` in `ops.html`
   must carry a sha384 pin and must be a row `index.html` also ships, same url and same hash.
   That closes the chain without duplicating work — `tests/smoke.mjs` §60 proves index.html's
   five hashes match the bytes, and the gate proves the console carries one of those five
   verbatim — and it is deliberately strict: a library only the console needs has to be pinned
   there on purpose, the same intended friction the publish set and the storage-key set take.
   The check's label was `SRI on all 5 CDN scripts` and is now **`SRI on every CDN script the
   publish set loads`**, because leaving a number in it that counts the wrong set is the defect
   being fixed. No bad hash was found; both copies agree today. Five deliberate breaks in
   `scripts/test_check_build.mjs`, one per clause including the anti-vacuity floor, and a
   **third GREEN** — `ops.html` writing its attributes in a different order must leave the gate
   green, because the obvious implementation is a whole-tag string match that is green today
   only because both files happen to use the same attribute order.
   **Two sibling controls now sit in the same `[2]` check band.** The first is the `<meta>` CSP,
   gated since 2026-10-30: SRI pins *which file*, the CSP permits *which host*, and the CSP is the
   one that fires first — a host it does not list means the script is never fetched, so its hash is
   never compared and the count still reads 5. The second, since 2026-10-31, is the **same-origin**
   `pdf.worker.min.js`: the sixth script this app loads, which SRI cannot cover (a worker takes no
   `integrity` attribute) and the CSP check cannot see (it walks tags; this one is a URL in
   JavaScript). See Architecture for what each of the three does and does not check.
   **Its BYTES are compared too, since 2026-11-17, by `tests/smoke.mjs` §62 — and that closed the
   last script in this app that ran with no integrity check of any kind.** The same overstatement
   §60 found in the SRI row was sitting one file over: the `[2]` worker check reads **two
   substrings** out of 1,087,212 bytes — pdf.js's own `does not match the Worker version` guard
   and the literal `"3.11.174"` — and printed `worker agrees`. Both are satisfied by two short
   strings anywhere inside a megabyte of otherwise arbitrary code, and **nothing in this repo had
   compared the shipped worker to the build its pin names**. The demonstration is mundane and it
   is re-run on every CI pass: `pdfjs-dist` ships **two** worker builds at every version, `build/`
   and the ES5-transpiled `legacy/build/`, and at 3.11.174 they differ by **46,448 bytes** while
   the legacy file carries *both* strings. Measured 2026-11-17: swap it in and the gate prints
   **All 21 mechanical checks passed**. It also passes §10, which drives a real PDF end to end,
   because the legacy worker *works* — so the two mechanisms that touched this file caught a
   worker that was broken or a version behind, and neither could tell one 3.11.174 build from
   another. No bad byte was found; the shipped worker is byte-identical to npm's today, so this is
   a regression guard like §54, not a fix. Why it matters more than its size suggests: the worker
   is **65% of the executable weight this site serves** (1,087,212 against index.html's 579,910),
   SRI structurally cannot cover it, the CSP declares no `worker-src` so `default-src 'self'` is
   an *origin* check rather than a content one, and it is the code that actually parses the one
   input this app takes from outside itself — a paystub PDF she picks, which is the very threat
   model `isEvalSupported:false` is gated for. Ten assertions, **six measured breaks**; the two
   anti-vacuity rows are labelled CONTROLS and the comment states what they cannot do (neither
   catches a miswiring that hashes one file twice — the breaks cover that), while break 6 confirms
   what they can: a `sha256` neutered to a constant fails **both**. The gate now prints which of
   the two questions it is answering.
   **§62 reads the REPO's copy; `deploy_watch.mjs` reads production's, nightly, since
   2026-11-18.** §62 hashes the working tree against `node_modules` and never fetches
   badgebudget.com, so on its own it establishes that the *committed* worker is the pinned build
   and not that the bytes real users execute are. Those are different claims and the deploy path
   is what joins them. For one night the live half was a hand-run `curl` — one fetch, one
   agent's eyes, nothing re-checking it — which is now `pdf.worker.min.js` being the fourth file
   in the publish set that `deploy_watch` hashes against its git blob. So the chain is closed at
   both ends on every nightly: npm's pinned build = the committed file (§62, in CI) = the bytes
   badgebudget.com serves (the watch). The watch is **not** in CI, because it needs network; see
   its row in *Where things are*.
   **And since 2026-11-15 the hash itself is compared to the BYTES, by `tests/smoke.mjs` §60 —
   not by the gate, and the reason is worth keeping.** The grep above counts *attributes*; the
   `[2]` check counted five of them and printed `5/5 pinned + hashed`, and the second word was
   false — nothing in this repo had ever read a byte of those five files. Copy a hash from the
   wrong row, or bump a pin and leave the hash, and the browser fetches the file, the digest
   disagrees, the script **never runs**, and Invariant 1's watchdog shows the boot error screen to
   every visitor with `Detect: none`. The suite that boots the app was blind to it **by
   construction**: `buildScratch` strips every `integrity` attribute (`harness.mjs`:95) and
   rewrites the five CDN urls to `node_modules`, so the one place the app actually runs is the one
   place SRI is guaranteed not to be enforced. §60 lives in the smoke suite rather than
   `check_build.mjs` for a practical reason too: CI's `gate` job installs `@babel/standalone`
   alone, while the `smoke` job vendors all five pins, so it is the only required check that *has*
   the bytes. **Four of the five verify exactly** — unpkg and cdnjs serve the npm tarball file
   unchanged. The fifth cannot and the exemption is **asserted, not assumed**: jsDelivr
   *generates* `supabase.min.js`, which `@supabase/supabase-js` does not ship (`dist/umd/` holds
   only `supabase.js`), so the rule is that exactly one row may be exempt, it must be a jsDelivr
   url whose basename is the `.min.js` of its local counterpart, and **npm must still not ship
   that file** — if it ever starts, §60 fails and the exemption gets re-read instead of outliving
   its reason. 23 assertions, twelve measured breaks, every row covered by at least one. The gate
   now prints what it actually checks.
3. **Wage-core** (`shiftGross`, `hourlyRate`, `computeNet` — the per-paycheck tax model shared by the
   hero and the pattern lab since #65, with two pre-tax buckets since 2026-10-11: retirement is FICA
   wages, Section 125 health premiums are not — `calc` and the **`periodPaycheck`** it calls, **`keepRatioOf`**
   (both hoisted out of `App` 2026-10-07 so the gateway prices with the same function), `statOf`/`ptoStatOf`, `patternMetrics`,
   `patternCellToShift`, **`sampleNet`**, **`keepRatio`**, `firstActiveShiftType`,
   **`workPeriodRule`** / `workPeriodChunks` (which hours count toward overtime, and in which
   paycheck — since 2026-10-10), **`otMultOf`** / **`minHoursOf`** / **`minimumTopUpCents`** (the
   per-shift multiplier and the court/call-back minimum — since 2026-10-11), **`rateOn`** /
   `rateEntryOn` / `sanitizeRateChanges` (which rate a date is priced at — a raise takes effect on a
   date, and **a shift carries no rate**; since 2026-10-17), the
   rate/differential coercions in `sanitizeData`, the `BONUS`/`BONUS_LABEL` tables, and the helpers
   the public names wrap — `shiftGrossCents`, `hourlyRateCents`, `paidHoursOf`,
   `overtimePremiumCents`, `toCents`/`fromCents`/`roundCents`. The list is examples; the test is
   whether a change can move a displayed dollar figure, including arithmetic in a UI component
   that prints one): touch only in a dedicated session, with the
   wage-math probes **and the hero/breakdown equality assertion against the deployed build**, never in
   a nightly build. Adding a sanitizer branch for a *new* data shape (as #62 did for `goals`) is fine
   in a nightly if it comes with a unit test and the existing probes stay green.
   ↳ **Detect** none automated — a wrong take-home figure throws no error, so the *A number looks
   wrong* feedback tile (2026-09-13) is the only channel, and it is opt-in and human. **Blast** every
   displayed dollar figure, i.e. the one thing the app is for. **Verify** the `wage-core` skill:
   baseline probes, a new assertion for the changed behaviour, then the equality check against the
   **deployed** build. Probes live in `tests/smoke.mjs` §1; `check_build.mjs` reports this UNCHECKED
   on purpose — except one rule inside it, gated since 2026-10-10: no wage-core definition may name
   a persona, work status, union answer or the preset table (a persona sets starting values only),
   and since 2026-10-11 nor the `payEvent` label (court / call-back / report — the hours are the pay).
4. **Every write to `user_data` carries a conflict target.** `saveToSupabase` upserts with
   `{onConflict:'user_id'}`: the table's PK is a generated `id` and
   `user_id` carries a separate unique constraint; without the option every save after the first fails
   with 23505. That silently broke cloud sync for every signed-in user from 2026-07-07 to 2026-08-23.
   Companion rules from the fix: the per-user failed-save backup carries `savedAt` and wins when newer
   than the cloud row; `console.error` is mirrored into the error ring buffer.
   **The rule is about the TABLE, not about that one function, and the gate said otherwise until
   2026-11-22.** This entry used to be titled `saveToSupabase upserts with {onConflict:'user_id'}`
   and its check was a single regex over the whole file that printed the word `present`. There are
   **two** write paths: the supabase-js upsert above, and the keepalive unload flush
   (`beaconSaveUserData`, 2026-10-05), where the same rule is spelled `?on_conflict=user_id` +
   `Prefer: resolution=merge-duplicates` — stated three lines further down this file as *"or it is
   a plain INSERT and 23505s forever"* and held by nothing in the gate. Measured against the old
   clause before the rewrite, **six realistic edits left it printing `All 21 mechanical checks
   passed`**: the raw url losing its query param; its `Prefer` header losing
   `resolution=merge-duplicates`; a second supabase-js `.upsert()` with no options argument; a
   second path using `.insert()`, which takes no conflict target at all; a second raw POST
   carrying neither guard; and **`saveToSupabase` renamed**, where the regex matched the moved
   line and the check kept passing while the function its own label named no longer existed.
   `tests/smoke.mjs` §33 catches the first two at runtime off the intercepted request, so
   production was never exposed on those; the other four were caught by **nothing**, because §33
   asserts the one request it drives and a write path it does not drive is unseen.
   **It was also wrong in the other direction, which is the half that gets a check weakened.** The
   regex pinned the upsert payload's property *order* and the options object's exact spacing, so
   two edits that change no behaviour — reordering the payload's keys, writing
   `{ onConflict: 'user_id' }` with ordinary spaces — turned the gate **red** with the message
   *"the user_data upsert lost {onConflict:'user_id'}"*. Anyone who formats this file met a false
   accusation about the one invariant with a live production signal, and the obvious repair is to
   loosen the pattern. Both are GREENS in `scripts/test_check_build.mjs` now.
   The set is **derived** since 2026-11-22, the shape Invariant 5's check took on 2026-11-14 and
   for the same reason: a hardcoded pattern answers *"is this one still here?"* and can never
   answer *"are these all of them?"*. The walk resolves the supabase-js client from
   `createClient()` rather than assuming the name `supabase` (without that, `Array.from({length:n})`
   reads as a table this check cannot resolve), then requires every `.from('user_data')` write to
   be an `upsert` carrying `onConflict:'user_id'` — `.insert()`/`.update()` are rejected on
   purpose — and every raw POST to `/rest/v1/user_data` to carry both guards. A method other than
   POST is a read or a targeted write and needs neither; a conflict target is a property of a
   write. Three anti-vacuity floors (one per path, one for the client binding), and anything
   unresolvable **throws** — no regex fallback, because a check that shrugs at what it cannot read
   is the hole. Scope is `user_data` alone: `ical_subscriptions` and `swap_profiles` are both
   upserted in this file and neither is this invariant's table, because both have `user_id` as
   their PRIMARY KEY, so PostgREST infers the target and a bare upsert is correct (read off the
   live catalog 2026-11-22). No live defect was found — both paths are correct today — so this is
   a regression guard like §54 and §62, not a fix. **Twelve deliberate breaks** in
   `scripts/test_check_build.mjs`, one per `must()` and one per detector feeding the shared one,
   plus **three GREENS**, falsifiable in both directions and both measured 2026-11-22: neuter the
   check and all twelve breaks stop failing while the three GREENS stay green (88 passed / 12
   failed), and restore the old regex and **exactly** the two formatting GREENS go red while nine
   of the twelve breaks go green (89 / 11). That second run is the argument for the GREENS: the
   old clause is green on today's clean page, so nothing but those two rows can see it come back.
   ↳ **Detect** 23505 → error ring buffer → `client_error`, live since 2026-09-07 — *that channel did
   not exist during the outage, which is why it ran 47 days.* **Blast** every signed-in user, silent;
   cloud sync dead, data surviving only in the per-user localStorage backup. **Verify**
   `check_build.mjs`'s `[4]` check, which since 2026-11-22 derives every `user_data` write site
   from the file rather than grepping for one known line; `tests/smoke.mjs` §33 for the raw
   keepalive body at runtime; end-to-end, save twice and reload on a second device.
5. **Storage keys are data, not branding.** Renaming any of them orphans user data or severs analytics
   joins: `nursingWagePlannerData` (anonymous users' data — contains no brand string, so a
   ScrubPay→BadgeBudget find/replace misses it) and `nursingWagePlannerData::<uid>` (per-user
   failed-save backup); `scrubpay_anon_id`; `scrubpay_feedback_pending`; `scrubpay_pending_invite`;
   `scrubpayErrors` (`ERR_KEY` in the boot script; every read goes through it since #64);
   `scrubpay_events_pending` (deferred analytics events awaiting the next load).
   **Two more keys exist and are deliberately a SEPARATE tier** (named here since 2026-11-14,
   because the gate now derives the set and a key it cannot classify fails it):
   `scrubpay_ical_cta_dismissed` and `scrubpay_ics_longreview_dismissed`, the "Not now" on the
   NurseGrid connect card and on the long-shift repair card. Renaming one **re-shows a card she
   dismissed** — real, but not this invariant's blast radius, so do not read them as load-bearing.
   ↳ **Detect** none — a rename orphans data silently; the symptom is a returning user seeing an empty
   app and not saying so. **Blast** anonymous users lose everything (localStorage is the only copy);
   signed-in users lose the failed-save backup; `anon_id` joins break historically. **Verify**
   `check_build.mjs` asserts each key literal **and, since 2026-11-14, derives the set from the
   file** — it AST-walks both inline scripts for every `localStorage`/`sessionStorage`
   get/set/remove, resolves each key argument, and fails on one the lists above do not name. That
   second half is why this entry grew: the check printed `6/6 intact` for nine weeks while the
   app used **eight** keys. The two above shipped with features on 2026-10-01 and 2026-10-04,
   neither reached the list, and **nothing in this repo could have said so** — a hardcoded
   allowlist answers "are these still here?" and can never answer "are these all of them?". The
   keys it found are cosmetic; the defect was that the figure read like completeness. Same shape
   as Invariant 13's five-field parser whitelist and Invariant 8's exact publish set: a new key is
   intended friction, and it is classified in the same commit that adds it.
   Three further clauses the derivation carries, each with its own measured break: a key built
   from an unresolvable expression **throws** (no regex fallback — a check that shrugs at what it
   cannot read is the hole); the per-user backup builder must still be
   `STORE_KEY + '::' + uid`, because this invariant names `nursingWagePlannerData::<uid>` and
   **nothing had ever checked the `::`** — change the separator and every signed-in user's
   failed-save backup orphans, which is the copy that held their data through Invariant 4's
   47-day outage; and a walk that resolves **nothing** fails rather than reporting a clean sweep.
   supabase-js's own `sb-…auth-token` keys are recognised by shape and are not ours to name.
   Eight deliberate breaks in `scripts/test_check_build.mjs`, falsifiable in both directions:
   neutering the derivation turns the seven new ones red and leaves the presence break green
   (measured 2026-11-14, 55 passed / 7 failed). Folded into the existing check rather than split
   into a twenty-second, because it is one question asked from both ends and the misleading figure
   was that check's own output — so `[5]` stays a tag held by one check and its breaks need no
   label pin.
   **That figure was wrong for its first eight nights, and the derivation was not what was wrong**
   (found and fixed 2026-11-23). It printed **`45 sites`** while `index.html` holds exactly **35**
   (`grep -cE '(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(' index.html` → 35).
   The *keys* were always right — they go into a Set, which dedupes — but `sites` was a tally of
   **visitor invocations**, and every walk in the gate used to get its tree from
   `Babel.transform(…, presets:['react'])` with the visitor registered as a plugin. Under that
   preset a call inside a JSX attribute is visited **twice**: once in the JSX tree, and again
   after the transform re-inserts the same expression as an argument to `React.createElement`.
   Ten of this app's storage calls live in JSX attributes, which is the whole of the 45 − 35.
   Sites are keyed on the node's own offset now, so the figure is right **however many passes any
   future walk makes** — the fix is deliberately the dedupe and not "parse without the preset",
   which would be correct today and one preset away from wrong again. Nothing could have caught
   it: a figure is not a verdict, the gate passed either way, and no row in the meta-test read it
   until the ninth GREEN, which puts the old transform back and requires the number to stay 35.
   The anti-vacuity floor (`>= 25`) was met by either number, so it was never load-bearing here.
6. **`@scrubpay` is the .ics self-recognition sentinel**: export stamps UIDs as
   `scrubpay-<date>-<id>@scrubpay`, import drops any UID containing `@scrubpay`. Change either half and
   every previously exported event re-imports as a duplicate.
   ↳ **Detect** none — the symptom is duplicate shifts after a re-import, visible to the nurse and
   reported nowhere. **Blast** every previously exported shift duplicates, inflating hours and every
   wage figure downstream of them. **Verify** `check_build.mjs`'s `[6]` check is labelled "both
   halves" and, since 2026-10-27, guards both: it counts the **two** export stamps exactly (shifts
   at ~`index.html`:4781, day events at ~4802) as well as the import-side drop, so breaking either
   stamp alone now fails it. That precision was the point — measured 2026-10-24 the check guarded
   **one** half, all 14 checks passing on a build whose export stamped `@badgebudget`, and the
   2026-10-26 groom then found a **third** hole of the same kind: the old regex needed one match
   while the file has two stamp sites, so the time-off export could stop being self-recognised with
   the gate still green. All three breaks are now pinned in `scripts/test_check_build.mjs`
   (`[6]` import, `[6]` first stamp, `[6]` second stamp). The one hole left is the one the gate
   never claimed: a UID that drops its **date** still passes, which `tests/smoke.mjs` §52 catches
   off the real bytes. The
   round trip itself is pinned since 2026-10-24 by `tests/smoke.mjs` §52: it exports a real file
   from a seeded blob, asserts every UID off those bytes, feeds the file back through the picker,
   and confirms the import offers nothing and writes nothing. The assertion that carries it is the
   one after a **confirm** — a build with the sentinel broken offers the duplicates through the
   stepper and writes nothing until she taps, so a blob read before that point is unfalsifiable and
   was deleted for it. One event with a **foreign** UID rides in the same file, because every
   "nothing to import" assertion above it would also pass on a build whose import is simply broken.
7. **`'scrubpay-swaps'` is a live md5 salt** deriving `poster_key` in the deployed `swap_board()`
   function. It is the swap board's anonymity model, not a string — **and, as of 2026-09-13, a
   known-broken one** (`security-00`, critical): the hash's other inputs are readable by any
   `authenticated` member (`swap_members.user_id`, `swap_groups.created_by`) and the salt is a
   constant in a public repo, so one select plus md5 maps every key on a board to a uuid. The
   invariant still holds — rotating the salt breaks the reveal linkage without fixing the leak; the
   fix is the hardening session in `BACKLOG.md` (revoke the grants, then a per-group secret read
   inside `swap_board()`).
   ↳ **Detect** none, and nothing in this repo *can* see it — the salt lives in the deployed Postgres
   function, not in `index.html`, so `check_build.mjs` is blind to it by construction; the
   reversibility was found by a council lens reading the grants, not by any probe. **Blast**
   rotating it re-derives every `poster_key`, silently breaking the identity linkage the reveal step
   depends on and changing the anonymity model with no visible error; leaving it as is leaves every
   board pseudonymous to a lazy colleague and transparent to a curious one. **Verify** the swap-UI
   standard in `docs/swap-board.md`; `rls_audit.js` — **not in git**, so currently unreproducible —
   and when it is ported, two new probes: as a member, selecting `user_id` from `swap_members` and
   `created_by` from `swap_groups` must both be denied.
8. **The publish set is load-bearing** (`cp … _site/` in `deploy.yml`): `index.html`,
   `pdf.worker.min.js`, `privacy.html`, `ops.html`, `CNAME`. Pages reads the custom domain from `CNAME` in the
   deployed artifact, so a deploy without it knocks the site off badgebudget.com. `privacy.html`
   backs the URL on the Google OAuth consent screen — drop it and `/privacy.html` 404s, which breaks
   consent-screen publishing and leaves the app with no reachable privacy notice. `ops.html` joined
   the set 2026-09-13; because it ships to a public URL, `check_build.mjs` also asserts it carries
   `noindex`, contains no `service_role` string, hands no string to the HTML parser (every string
   it renders was typed by the public into a feedback box), and is not linked from `index.html`.
   **That third clause was a regex over ONE spelling of one sink until 2026-11-21**, and it
   printed `no innerHTML` while CLAUDE.md printed "never assigns `innerHTML`": the test was
   `!/\.innerHTML\s*=/.test(ops)`. Six realistic edits were measured against it before anything
   was written and **all six left the gate printing `All 21 mechanical checks passed`** —
   `n.innerHTML += text` (one character past the regex, and the likeliest edit on this page:
   appending a row), `n.outerHTML = text`, `n.insertAdjacentHTML('beforeend', text)`,
   `n['innerHTML'] = text`, `document.write(text)` and `Object.assign(n, {innerHTML: text})`. The
   page's own header states the property the clause was standing for — *"NOTHING HERE IS TRUSTED
   TO BE SAFE TO RENDER AS HTML. Every value that came out of the database was typed by a member
   of the public into a feedback box."* It is now a **walk** of every inline `<script>`, parsed,
   over four detectors: an assignment to a sink property under **any** operator, a call to a sink
   method, a sink as an object key (`Object.assign` reaches the same setter with no assignment
   expression anywhere), and a **bare** sink name as a string (a computed property is
   unresolvable by shape, so the name is caught instead — anchored, so a sentence mentioning one
   is not a hit). Plus two anti-vacuity floors: no inline script found **fails**, and a walk that
   resolves zero property assignments **fails**, because the regex it replaced would also have
   passed a page with no script at all. The blast radius is Invariant 2's own arriving by the one
   door nothing covered: `ops.html` is same-origin **on purpose** so it can borrow the app's
   session, so script injected here runs in the origin holding `user_data` and the auth token,
   its two readers are the two admins, and the injected string is attacker-supplied **by design**
   — anyone on the internet can POST to `feedback`. No live sink was found; the page renders
   through `textContent` today, so this is a regression guard like §54 and §62, not a fix.
   The tempting repair — widen the regex to the other sink words — is **red on today's clean
   page**, which already says "never innerHTML" in a comment on the very line being guarded;
   two GREENS in `scripts/test_check_build.mjs` pin the subtler version of the same mistake (a
   grep that strips `//` comments first is green today and red on an ordinary block comment or a
   visible note). Scope is `ops.html` deliberately: `index.html`:748–749 writes
   `splash.innerHTML` on purpose, with its own `esc()` helper, for the boot watchdog's error
   screen. Eight deliberate breaks, one per detector and one per floor, falsifiable in both
   directions.
   **A ninth break joined it 2026-11-23, and it guards a property the page had no check for at
   all:** `ops.html`'s script is parsed as **plain JavaScript**, with no `jsx` plugin. That is a
   guard, not an implementation detail — the console's only remote script is supabase-js, so it
   loads **no Babel**, and a JSX element in there is a `SyntaxError` the two admins' browsers hit
   at load, after which the inbox renders nothing. This page has no suite of its own and the
   harness only republishes a copy of it, so the gate is the only thing that would ever say so,
   and the failure is rethrown with what it means rather than leaving Babel's bare parser message
   in the row. It was unreachable before the shared-AST walk: every walk ran `presets:['react']`,
   so JSX here *parsed* and the gate passed. Negative-tested against the repair that makes the
   message go away — add the `jsx` plugin and the break passes a deliberately broken tree
   (measured 2026-11-23, 103 / 1).
   ↳ **Detect** derivable but unwatched — a missing `CNAME` takes the site off the domain within one
   deploy and `events` goes silent; nothing watches for that silence. **Blast** total outage on
   badgebudget.com; a missing `privacy.html` 404s the consent-screen URL. `ops.html` ships to a
   public URL, so its six page-level assertions are defence in depth behind the real gate
   (`is_ops_admin()` in Postgres) — except the `service_role` one, where a shipped key bypasses RLS
   outright and is a breach, not a weakened layer. **Verify** `check_build.mjs` asserts the set
   exactly in both directions and runs the six ops-console checks, then
   `curl -sI https://badgebudget.com/index.html?cb=N` per the `ship` skill.
   **A third question joined the gate 2026-11-11: is the set SUFFICIENT?** The exact-set check
   says what ships; it never said whether what ships is enough for what the pages *reference*. A
   same-origin link to a file deploy.yml does not copy is green in the gate, green in CI, drivable
   in the harness — `buildScratch` copies pages by name, so the test rig publishes what the deploy
   does not — and a 404 only on badgebudget.com. `Published pages link only to published files`
   walks every `href`/`src` in every published HTML page against the set derived from deploy.yml,
   fails on a dynamically built attribute (a tag walk cannot resolve one; that is intended
   friction, not a gap) and fails on a page that yields no attributes at all. Adding a file to the
   publish set takes **two** edits in one commit — the `cp` line and `expected` in the gate — and
   nothing said so until this check named it in its failure message.
9. **No `main` branch.** `claude/migrate-to-github-deploy-3F5RD` is the de facto default and deploy
   branch, deliberately in the workflow's push triggers. Add `main` to the triggers *before* removing
   it, never in the same commit — removing it first stopped all deploys once.
   ↳ **Detect** derivable but unwatched — deploys stop while pushes keep succeeding, so nothing fails
   loudly; the signal is an empty Actions tab. **Blast** everything merged after that point sits
   unshipped while looking merged. **Verify** `check_build.mjs` asserts the branch is still in the
   triggers; confirm a run actually appears in Actions after the merge.
10. **Fetch before touching the deploy branch.** Fresh checkouts are shallow and have been seen 14
    commits behind origin. Always `git fetch origin claude/migrate-to-github-deploy-3F5RD` and branch
    from `origin/…`, never from the local ref.
    ↳ **Detect** none — a stale branch is a valid branch, so the PR merges green while quietly
    reverting recent commits. **Blast** up to N commits of other people's work reverted on merge; 14
    observed. **Verify** `git merge-base --is-ancestor origin/claude/migrate-to-github-deploy-3F5RD
    HEAD` before you push. UNCHECKED in the gate.
11. **Don't delete `claude/clause-md-review-9tqlj8`** (the nightly's working branch) or the head of any
    open PR. Merged heads are fair game (see Open items for the current list).
    ↳ **Detect** none — a deleted branch is noticed only the next time something needs it, which for
    the nightly is the next 04:0x ET run. **Blast** deleting the nightly's branch stops the loop
    silently; deleting an open PR's head closes the PR and loses the work. **Verify** cross-check
    `git branch -r` against open PRs before any delete. UNCHECKED in the gate.
12. **URL Forwarding stays OFF on badgebudget.com at Porkbun** — it overrides the A records entirely.
    ↳ **Detect** none — registrar state sits outside every check in this repo, and the failure
    presents as a Pages problem. **Blast** total site outage; the A records are ignored wholesale.
    **Verify** `dig +short badgebudget.com` → the 4 GitHub Pages A records, and
    `curl -sI https://badgebudget.com` → 200 from Pages, not a 301 to a Porkbun redirector. UNCHECKED
    in the gate.
13. **The iCal feed URL is a bearer credential.** It lives only in `ical_subscriptions` (owner-only RLS,
    no `anon` grants), **goes when she clears her data** — `clearAll` deletes that row, and deletes it
    **before** `signOutClient()`, because owner-only RLS refuses a delete issued after the session is
    gone and refuses it *silently*; guarded and timed out so a failure can never block the sign-out
    and reload (2026-11-02, pinned by `tests/smoke.mjs` §56, which asserts the op order and not just
    the call) — is absent from `serializeState` so it never enters the `user_data` blob (which
    is exported, mirrored to localStorage and echoed by the sync poll), never goes into `events`, and
    is never logged by `ical-proxy`. The parser stores dates, times, hours and UIDs — never titles. It *reads* `SUMMARY` once, at
    parse time, to set the boolean `offHint` (time off vs. shift), and keeps nothing else from it.
    ↳ **Detect** none, and a leak is silent by construction — nothing observable changes when a bearer
    credential escapes. **Blast** anyone holding the URL reads the nurse's whole calendar
    indefinitely; the only revocation is the calendar provider reissuing it. **Verify** `check_build.mjs`'s
    `[13]` check gates three clauses mechanically. Since 2026-10-26 the first two: it parses
    `serializeState` as an AST and fails on any key matching `/ical|webcal|feed|basic\.ics/i` — and
    fails if it cannot *find* `serializeState`, so a renamed serializer can't turn it into a pass by
    omission — and it fails on any `console.*` in `ical-proxy`, because the next edit to that file
    is the likeliest one to add a debug log (the first-call `422` is still unexplained). Four
    deliberate breaks plus a false-positive control, measured. **Since 2026-10-29 the third:
    the parser keeps no titles** — the clause whose promise was made twice in prose (here, and at
    `index.html`:~1145, "read HERE and only here, reduced to this one boolean") and held by
    nobody. Four assertions, because there are four separate ways it dies: the per-event object
    pushed by `parseICSSchedule` may carry only `dateKey`/`start`/`hours`/`uid`/`offHint` (a new
    key is intended friction, added on purpose); a text-bearing VEVENT property —
    `SUMMARY`/`DESCRIPTION`/`LOCATION`/`COMMENT`/`CATEGORIES`/`CONTACT`/`ATTENDEE`/`ORGANIZER` —
    may be read *only* inside an `icsLooksOff(…)` argument, so **hoisting it into a local fails
    before anything stores it**, which is the shape the edit actually takes; `icsLooksOff` must
    return a boolean-valued expression, because `offHint` IS stored and `return title` would ride
    the whitelist unchanged; and both functions must be **found**, so a rename cannot make it a
    pass by omission. Five deliberate breaks, one per assertion, each measured to fail `[13]` with
    its own message. The blast path is (a)'s from the other end: a parsed event becomes a shift,
    and a shift is in the blob that is exported, mirrored and polled. **The other two clauses stay
    UNCHECKED in the gate**: the table's owner-only RLS and absent `anon` grants, and the absence
    from `events` — which has the runtime redaction below rather than a gate.
    `tests/smoke.mjs` §33 covers the outgoing keepalive
    body at runtime; the gate covers the one source every write path shares, including the `.json`
    export, which nothing scanned before.
    **The RLS clause got a nightly READ on 2026-11-13, which is not a gate and must not be
    described as one.** `scripts/access_watch.mjs` reads the production catalog and fails LOOSE if
    `ical_subscriptions` loses row security, gains a policy that is not `auth.uid() = user_id`,
    loses one of its four, or picks up any grant reaching `anon` — including via `PUBLIC`. It ran
    for the first time on 2026-11-13 and the clause **holds**: RLS on, four owner-gated policies,
    and `authenticated` is the only role in the ACL, so even a broken policy would meet a table
    `anon` cannot address. That is the first time anything in this repo established it. It stays
    UNCHECKED in `check_build.mjs` on purpose — the gate parses files and cannot see a deployed
    database — so the roll-call still says "13: RLS and events are not".
    **The `events` clause got a mechanism on 2026-10-28, and it is a redaction rather than a
    gate.** It had been held at exactly ONE call site: `icalFailureDetail` whitelists the proxy's
    error code to a snake_case token (§24 pins that thoroughly), but that helper guards one
    `console.error` — and the boot script mirrors **every** `console.error` in the app into the
    error ring buffer, which `flushClientErrors` ships to `events` as a `client_error` row. So the
    clause rested on every present and future console.error formatting its arguments carefully, and
    one debug line (`console.error('sync', url)`) would have put a bearer credential in a shared
    table permanently with nothing observable changing. `redactUrlPaths` now sits beside
    `redactMoney` at that choke point — one place, every path, the same shape `serializeState`
    carries for the blob half. **A URL keeps its scheme and host and loses its path, query and
    fragment**: the host is the whole diagnostic value of these rows (a blocked CDN script is
    Invariant 2's only live signal), and the path is where the secret lives. Deliberately **not**
    applied to the ring buffer itself — `scrubpayErrors` is her own localStorage (Invariant 5)
    holding a URL she typed into Settings, and the watchdog's "Copy error log" hands her that
    buffer verbatim for a bug report. **No live leak was found**: no `console.error` in the app
    formats the feed URL today, so this is a regression guard on a silent-by-construction
    invariant, not a fix for an observed escape. Pinned by `tests/smoke.mjs` §54, off the real row
    the app hands the client rather than a helper's return value, and **falsifiable in both
    directions** — four measured breaks: dropping the scrub (7 fails), over-redacting the host away
    (4), dropping the money scrub (1), and matching only `https?:` so `webcal:` slips through (5),
    which is the realistic one, because `webcal://` is what NurseGrid actually hands out.

**What this shape surfaced (2026-09-13).** Filling in `Detect` for all thirteen showed that only #4
has a live production signal; #8 and #9 have one that exists in the data but nothing watches. The
other ten fail silently. Detection, not remediation, is the thin layer here — a plan for fixing a
break is worth nothing against a break nobody sees, and the 47-day sync outage is the proof.

## Architecture — the rules (mechanisms and history: `docs/project-notes.md` → Architecture)

- **Single file, no build step.** React 18 + Babel standalone, JSX transformed in-browser; keep it
  single-file. Two god components, `App` and `SwapsSheet`. CDN deps are pinned with SRI
  (React/ReactDOM 18.2.0, Babel 7.24.7, pdf.js 3.11.174 with `isEvalSupported:false`, supabase-js
  2.45.4); the `<meta>` CSP must cover every runtime host.
  **That CSP rule is gated since 2026-10-30, in the forward direction only.** SRI asks "is this the
  exact file we pinned?"; the CSP asks the earlier question, "may the browser fetch it from that
  host at all?", and a host missing from it is a *silent total outage* — the script is blocked,
  React or Babel never defines, and Invariant 1's watchdog shows the boot error screen to every
  visitor, which Invariant 1's `Detect` records as invisible (a device that never boots never fires
  `app_open`). `check_build.mjs` asserts every host a **tag** loads from is permitted by the
  matching directive in `index.html` and `ops.html`, that a page with no CSP meta **fails** rather
  than passing by omission, that a Google Fonts stylesheet implies `font-src https://fonts.gstatic.com`
  (no tag names a woff2, and a silent fallback moves the layout — the wordmark has 13px of
  headroom at 320pt), and that **`privacy.html`, which ships with no CSP, fetches nothing remote
  at all** — the property that makes the absence safe.
  **That last clause was a regex over two attribute spellings of one scheme until 2026-11-19**,
  and it printed the word `self-contained` for the whole property. Four realistic edits were
  measured against it and all four left the gate printing `All 21 mechanical checks passed`: a
  `@font-face` webfont through CSS `url()`, an `@import` of a third-party stylesheet, a
  **single-quoted** `<script src='https://plausible.io/…'>` and a protocol-relative
  `<img src="//tracker…/pixel.gif">`. It now walks the content in four clauses — every attribute
  the browser *fetches* (any quoting, any scheme, `srcset` split; `<a href>` exempt, because a
  link is a navigation and not a request), every `url()`/`@import` in a `<style>` block or
  `style=""`, **no `<script>`/`<iframe>`/`<object>`/`<embed>` tag at all** (an inline script has
  no `src` to read and can fetch anything at runtime), and an anti-vacuity floor so an empty page
  fails rather than sweeping clean. A URL is classified by how its value **starts**, never by
  searching inside it: the favicon is a `data:` URI whose payload carries the literal
  `http://www.w3.org/2000/svg`, so a blanket grep would fail on today's clean page and the repair
  anyone would reach for — exempting w3.org — is worse than the hole it closed. No remote
  reference was found; this is a regression guard, not a fix. The reverse direction is deliberately
  **not** checked: `connect-src` carries hosts no tag can reveal and `img-src` is `https:`
  wholesale, so flagging an unused permission would be coverage theatre.
  **The app loads a SIXTH script, from its own origin, and it is gated separately since
  2026-10-31.** `pdf.worker.min.js` is fetched at runtime by pdf.js, and none of the three
  mechanisms above reach it: SRI cannot (a worker takes no `integrity` attribute, and it is not a
  tag at all — it is a string assigned to `GlobalWorkerOptions.workerSrc`), the CSP check cannot
  (it walks tags; this is a URL in JavaScript), and Invariant 8's publish-set check names the
  *file* — nothing in this repo read a byte inside it until 2026-10-31, and nothing compared
  those bytes to the pinned build until `tests/smoke.mjs` §62 on 2026-11-17 (Invariant 2 carries
  that story: the gate's two substring reads are satisfied by the same-version `legacy/build/`
  worker, which differs by 46,448 bytes and left the gate printing `All 21 mechanical checks
  passed`). Four properties, eight
  assertions, one deliberate break each: the worker's embedded version must equal the version in
  the CDN pin (**pdf.js compares them itself and throws** `The API version "X" does not match the
  Worker version "Y"`, so a bumped pin with the old worker beside it kills the paystub reader
  outright — and `paystub_failed` has never fired for any reason, so nothing would report it);
  `workerSrc` must stay a bare filename that is in the publish set (the CSP declares no
  `worker-src`, so `default-src 'self'` blocks a CDN worker **even though `script-src` permits
  that host** — which makes "serve the worker from the CDN instead" the edit that looks right,
  passes every other check, and kills the feature); and `getDocument` must still be passed
  `isEvalSupported:false`, the CVE-2024-4367 mitigation for pdf.js < 4.2.0. That last one is
  load-bearing in a way the pin is not: the CSP carries `'unsafe-eval'` because Babel standalone
  needs it, so the flag is the only thing between a malicious paystub PDF — a file *she* picks,
  the one input this app takes from outside itself — and arbitrary JS in the origin holding
  `user_data` and the auth session.
  **The gate reads this file as it is WRITTEN, not as Babel rewrites it** (2026-11-23). Its ten
  AST walks share one parse per source instead of each running its own
  `Babel.transform(…, presets:['react'])`, which is 6.03s → 2.65s and, more to the point, stops
  the walks seeing 69% synthesized nodes (11,090 CallExpressions after the react preset against
  **3,482** in the source). That preset also made a plugin visitor fire **twice** on anything
  inside a JSX attribute, which is how Invariant 5's check came to print `45 sites` against a
  true 35. The `build` check keeps its real `transform` on purpose and pays the full cost once:
  its whole job is to prove the JSX *transforms* under the exact Babel build the browser loads,
  and a parse-only check there would pass on JSX that parses and then fails to transform in front
  of a visitor.
  **The core is marked, not moved** (2026-10-07): the pure math lives in `/* @core:begin <name> */ …
  /* @core:end */` regions of `index.html`, and `scripts/extract_core.mjs` slices them into
  `supabase/functions/_shared/badgebudget-core.mjs` for Node tests and the MCP gateway. The app stays
  one file with no build step. **Edit a marked region → re-run `node scripts/extract_core.mjs` and
  commit both**, or the gate fails. A marked region may reference nothing outside the core
  (`window`, `localStorage`, `supabase`…); the extractor refuses to emit one that does.
- **Data.** Signed-in → Supabase `user_data`, one `jsonb` blob per user, whole-blob last-writer-wins,
  debounced 500ms, capped at `MAX_BLOB_BYTES` (512KB); anonymous → localStorage. Every array goes
  through `sanitizeData` on load. Cross-device sync is a 15s visible-tab poll guarded by
  `updated_at` + content equality; `applyData(...,{keepPeriod:true})` leaves the viewed period alone.
  **The unload flush rides `keepalive`, not supabase-js** (2026-10-05): an ordinary fetch started in
  a `pagehide`/`visibilitychange` handler is cancelled as the document is discarded — three real
  loads logged `AbortError: Promise was rejected because the browsing context is going away` on
  2026-10-03 — so the flush sends a raw `keepalive` POST (`beaconSaveUserData`) instead. **Invariant
  4 applies to the raw call**: `?on_conflict=user_id` + `Prefer: resolution=merge-duplicates`, or it
  is a plain INSERT and 23505s forever. It cannot ride the anon key (`user_data` is owner-only RLS),
  so the access token is cached in module scope by `rememberAuthToken` — armed at sign-in, re-armed
  on `TOKEN_REFRESHED`, cleared on sign-out; **never read auth state inside an unload handler**.
  Success is unobservable there, so the flush writes the per-user backup **every time**, stamped with
  the `updated_at` it sent: `backupWins` is a strict `>`, so an equal stamp leaves the cloud
  authoritative and the backup wins only when the write never landed. Pinned by `tests/smoke.mjs`
  §33 — which also records one assertion deleted for being unfalsifiable (both clock reads land in
  the same millisecond, so the equality check passed with the fix broken; it is pinned at the source
  instead).
- **A failed cloud load retries, because it used to sink the whole load silently** (2026-10-06).
  `hydratedForUser` staying unset on a load failure is correct — it is what stops default or stale
  state overwriting her real blob — but every write path is gated on it, so the debounced save, the
  unload flush, the 15s poll and the iCal auto-sync all go quiet together and **her edits reach
  neither the cloud nor localStorage**, with no UI saying so (`syncError` is set by a failed *save*,
  never a failed *load*). `Load error: TypeError: Load failed` was 10 of 22 `client_error` rows at
  the 2026-10-06 groom, across 3 real devices. `hydrateWithRetry` awaits attempt 1 and **schedules**
  the rest (`HYDRATE_RETRY_MS`, 1500/4000ms), plus a `visibilitychange` re-attempt
  (`HYDRATE_RETRY_MIN_MS`, 5s). **Never await the retry chain** — `init` holds the splash until that
  call returns and Invariant 1's watchdog replaces the app at 8s. **Never write the per-user backup
  from the failed path** — it would mirror the state hydration failed to replace, win the next load
  by being newer, and clobber her real cloud row. Pinned by `tests/smoke.mjs` §34, which asserts the
  boot bound *causally* (when the splash goes, exactly one attempt has happened) after a stopwatch
  version let a partially-awaited chain through. **When all three attempts fail she is told, since 2026-10-07**:
  one `cloudLoad` state (`null`/`'failed'`/`'retrying'`), a `role="alert"` banner above the
  greeting, and a button calling `hydrateWithRetry`. Deliberately **not** `syncError` — its string
  says "saved on this device", which on this path is false, and its `retrySync` is itself gated on
  `hydratedForUser`, so it would render an affordance that does nothing. `'failed'` is raised only
  by an **exhausted** chain, never the first failure (that flashes a red panel for one 1500ms
  backoff), and only a landed load retires it. Pinned by `tests/smoke.mjs` §35, whose own first
  draft held two unfalsifiable assertions: a transient-blip check that read after the retry landed,
  and a no-sideways-scroll check subtracting `window.innerWidth`, which **grows with the overflow**
  — compare against `clientWidth`.
- **Analytics.** `track(name, props)` → `events`, insert-only. Coarse `snake_case`
  `<surface>_<verb>` names only — **never wage or goal figures**. The onboarding funnel's `ob_*`
  events go through the core's `obEventProps` whitelist (enumerated values only, a `null` is never
  sent), so nothing she types can ride one. `session_end` goes through
  `beaconInsert()` (keepalive fetch), not `track()`, and the row to read is the LAST per load.
  `nostore-<uuid>` anon_ids are visits, never returning devices — exclude them from device counts.
  `client_error` is one row per load, money- **and URL-path-**redacted, read-and-clear — a URL in an
  error message keeps its scheme and host and loses its path, query and fragment (`redactUrlPaths`,
  2026-10-28), because every `console.error` in the app is mirrored into that buffer and the iCal
  feed URL is a bearer credential (Invariant 13).
  **Exactly ONE message is dropped before it ever reaches that buffer, and the count matters more
  than the message** (2026-11-03): Babel standalone's code generator `console.error`s a *note* about
  its own output formatting once per load when the inline script passes **500,000 bytes**, and ours
  crossed that at `8e099cb` (#191, live 2026-11-01) — 497,329 → 510,998, and **511,887** today, so
  it is over the threshold permanently and shrinking back under it is not a goal. The note is
  harmless ("deoptimised the styling" = Babel stopped pretty-printing its output; the app runs
  identically), but the mirror is indiscriminate, so from that commit **every load filed a
  `client_error` row** — two reached production `events` (2026-11-02 17:23:15, 2026-11-03 04:04:11)
  from clean first loads with nothing wrong. The cost is not noise, it is that `client_error` is the
  only channel here that fires on a real fault: Invariant 4's 23505s and Invariant 2's blocked CDN
  script surface in it **and nowhere else**, both carry `Detect: none` otherwise, and "a
  `client_error` row exists" had stopped meaning anything. Filtered at the **mirror**, not at
  `flushClientErrors`, so it never enters the ring buffer either — `__copyErrorLog` hands that
  buffer to her verbatim for a bug report. Both halves of Babel's string must match and the prefix
  is anchored at position 0; **never widen it into a prefix test, a substring test or a list**, and
  never add a second entry — a mirror that drops categories of message is how the 47-day sync
  outage stayed invisible, which is the reason this mirror exists. Pinned by `tests/smoke.mjs` §57,
  falsifiable in both directions: six measured breaks, including the mirror muted entirely (the
  direction that passes every leak check in §54 while blinding all of them) and the filter moved to
  the flush (which pins the placement, not just the predicate). The host is kept on purpose: "which host failed"
  is the whole diagnostic value of these rows, and a blocked CDN script is Invariant 2's only live
  signal. Pinned by `tests/smoke.mjs` §54, which fails in both directions.
  **`app_open` says whether the load MINTED its `anon_id` or read one back** (2026-10-12):
  `fresh:true` when minted, **absent** otherwise — never `false`, because months of rows predate the
  key and a null has to keep meaning "not known". `nostore-` only labels the loud failure, where
  storage *throws*; the quiet one (an in-app webview, incognito) lets the write succeed and discards
  it, so one phone filed four plain uuids in the six days to 2026-10-12 while an established device
  on the same user-agent kept its id across five visits. `fresh:true` twice from one `anon_id` is
  the proof its storage is ephemeral, and those loads can be dropped from a cohort instead of
  guessed at from the user-agent. A `nostore-` load is `fresh` too — the flag means "minted on this
  load", one rule rather than two. **`anonIdWasMinted()` resolves the id before reading the flag**:
  props are built by the caller, so without that the flag is `false` on a load where nothing has
  touched `anonId()` yet and every row silently reports a return visit. Pinned by
  `tests/smoke.mjs` §41; this is **half** of the device classifier — harness and crawler rows still
  inflate every activation figure. Full event list and funnel
  queries: notes → Architecture → Analytics.
- **Feedback.** Insert-only for `anon`+`authenticated`; rows carry `kind`, `page`, `user_agent` and
  (since migration 005) `anon_id`, set inside `submitFeedback` so the offline queue carries it.
- **Auth.** Supabase email/password + Google OAuth, **implicit flow, not PKCE** (`security-11`;
  switching is a dedicated session). Google consent screen is **In production**. Testing the sign-in
  wall needs an account that has never signed in.
- **Swap board is deliberately quiet** (Positioning). No new CTAs, no "anonymous" copy until the
  `security-00/01/02` hardening session lands; names are revealed only after every leg accepts.
- **`active:false` on a differential means "don't offer me this", never "stop paying it".** The lit
  chip is always what is priced (`tests/smoke.mjs` §15).
- **Top bar.** The avatar is the only route to Settings and Sign out below 920px — never hide it at
  any width.
- **Calendar sync** never silently rewrites wage-affecting shifts: feed results go through the same
  import stepper. `ical-proxy` is host-allowlisted (Google + `nursegrid.com`, confirmed 2026-09-28).
  **A feed URL is normalized to `https:` in the app before the proxy ever sees it** (2026-09-29):
  `webcal://` and `webcals://` are swapped on the *string*, because `webcal:` is a non-special scheme
  and the WHATWG `protocol` setter refuses to reassign it — Node and Deno enforce that, **Chromium
  does not**, so a browser test of the setter passes while production returns `400`. Never rely on
  the setter; `tests/smoke.mjs` §23 pins both engines.
  **A removal is bounded by the feed's own reach, never by the parser's window** (2026-10-03):
  absence from a fetch means "deleted" only on or after **today**, or earlier than today where the
  feed demonstrably reaches that far (it carries some event on or before that date). The window
  alone was wrong because it starts **60 days back** while a forward-only feed — NurseGrid's
  apparent shape — carries nothing before today, so every shift she had already worked was offered
  up for deletion through the import stepper. The bound is a **union on purpose**: the obvious
  "never remove anything before the feed's first event" is a regression, because cancelling the
  *nearest* shift moves the feed's first event past it and the cancellation would never propagate.
  Being a union is also what makes it provider-independent, so it needed no answer to "how far
  back does NurseGrid publish?" — that question is still open and now gates nothing. Pinned by
  `tests/smoke.mjs` §28.
  **Every sync says how it ended** (2026-10-02): one `ics_sync_result {result, provider}` per sync
  that reaches the proxy — `changes` / `up_to_date` / `empty` / `unparseable` / `failed` — tracked
  from `finally` with `failed` as the initialiser, so a new early return cannot be silent. Before
  it, four of the five states wrote nothing anywhere and a background sync against an unparseable
  feed was invisible forever (Invariant 4's shape in the sync path, and the one branch
  `icalFailureDetail` cannot see). `ics_sync_done` still means **"found changes"**, not "sync
  completed" — don't count it as a success rate. `provider` is on all three ics events now
  (`google`/`nursegrid`/`file`/`null`). Pinned by `tests/smoke.mjs` §27.
  **Field-verified 2026-10-04:** 20 rows in 48h, all `provider:'nursegrid'` — 19 `up_to_date` and
  one `changes`. The foreground re-sync makes `ics_sync_result` the dominant row in `events` from
  here on, so read funnel counts with that in mind.
  **And since 2026-11-16 the sync row says how big the PLAN is, not just the feed** —
  `ics_sync_done {events:N}` is `parsed.events.length`, the size of the **feed**, and it had been
  read as the size of the **plan** (what she is asked to confirm) in six places across this file
  and `index.html`. They are different sets, and the one production load carrying both numbers
  disproves the substitution: `events:127` on 2026-10-10 against an `ics_import_done
  {shown:6, skipped:46}` the same morning — **52 items, not 127**, because 75 of the feed's events
  were already known and unchanged and never reached a card. The plan can also **exceed** the
  feed, since a removal is a shift the feed does not carry at all. So every judgement about how
  heavy the stepper is — the thing the 10-21 banner switch and the 10-22 stepper switch were both
  designed around — was made off a count of the wrong set, and nothing in `events` could tell a
  3-change sheet from a 109-change one. The row now carries `pending` (the variable the code
  already computed and threw away), `cards` (how many classify cards she taps through — groups
  collapse same-shape events, which is the figure the "one copy per group" note needed),
  `classify`, `updates` and `removals`, with **`pending === classify + updates + removals`** so a
  reader can check the row against itself. `events` is deliberately unchanged: months of rows are
  keyed on it meaning the feed. Counts only — no title, no URL, no date, no wage figure
  (Invariant 13 + the analytics rules). Pinned by `tests/smoke.mjs` §61, whose fixture is built so
  **no two of the six counts coincide and `pending` (9) exceeds `events` (4)** — a build reporting
  the feed count under `pending` then fails on magnitude, not merely on identity. 17 assertions,
  eight measured breaks; the four rows with no independent break are named as controls rather than
  counted as clauses.
  **The feed re-syncs on foreground, quietly** (2026-10-01): the cold-load sync runs once per page
  load, and a phone never page-loads, so a `visibilitychange` re-sync was added — throttled to
  `ICAL_RESYNC_MIN_MS` (10 min) and **quiet**, parking the plan in a banner rather than opening the
  import stepper. Never make it a modal: it fires when she returns to the app. The cold-load sync
  still opens the stepper. Pinned by `tests/smoke.mjs` §25.
  **And "Not now" on that banner means "not this", not "ask me again in ten minutes"**
  (2026-10-10): quiet was never the whole problem. Dismissing the banner cleared its state and
  remembered nothing, so the next foreground re-sync rebuilt the identical plan from the identical
  feed — the one real NurseGrid account declined the same plan **three times in 47
  minutes of one page load** (its feed carried 127 events; how many of those reached a card was
  not recorded until 2026-11-16 — see *the sync row says how big the plan is* below), with zero `ics_import_done`, while hand-editing shifts in the gaps
  (135 → 112). `icsPlanFingerprint` digests every field the stepper would write (uid, dateKey,
  hours coerced, start, time-off flag, and which bucket) and sorts it, so neither feed order nor
  `Object.keys` order can move it; a match tracks `ics_resync_suppressed` and stays silent.
  **Never widen that into a mute** — anything differing by one field must raise the banner again,
  because a suppressed removal leaves a cancelled shift inflating her estimate, and `"Review"`
  clears the memory (looking is not declining). `ics_sync_result` still says `changes` on a
  suppressed sync: the five-state contract is about the feed, not the UI, so `found + suppressed`
  is how often the feed differed and `found` alone is how often she was asked. The memory is a
  ref, not localStorage, on purpose: a cold load opens the stepper anyway. Pinned by
  `tests/smoke.mjs` §37.
  **And she can turn the automatic half off entirely** (2026-10-16): a Settings switch, *Only sync
  when I tap "Sync now"*, backed by `syncManualOnly` in the blob, default `false`. When on, neither
  automatic door opens — the once-per-load cold sync and the `visibilitychange` re-sync both stand
  down — while "Sync now" and the saved link are untouched, because this is a **preference, not a
  disconnect**. The guard sits inside `runIcalSync` (`if(!manual && syncManualOnly) return`) as
  well as in both callers, so a future auto trigger cannot quietly reintroduce the behaviour.
  **Never gate the `manual` path with it** — a version written `if(syncManualOnly)` swallowed
  "Sync now" too and turned the setting into a broken sync. No `ics_sync_result` row: a sync that
  never started is not one of the five outcomes; the skip is `ics_autosync_off`, one row per load
  rather than per foreground return. The field is deliberately **not** named `ical*` — §33's
  Invariant 13 check scans the whole outgoing blob for `/ical|webcal|basic\.ics/i` and the guard is
  worth more blunt than the name is worth tidy. The Settings copy is conditional for the same
  reason the labels in §26 are asserted off the DOM: it used to promise unconditionally that
  BadgeBudget "checks it each time you open the app", which the switch makes false. Courtney asked
  for this twice in 28 hours, the second time **39 seconds** after a cold-load sync re-proposed the
  plan off a 126-event feed she had already declined. Pinned by `tests/smoke.mjs` §46.
  **And the switch is offered on the re-sync banner, because she never found it in Settings**
  (2026-10-21): it shipped 10-16 under the iCal section, and her first three loads after it —
  2026-10-20 20:15, 22:26 and 23:02 UTC — were three more `ics_sync_result {changes}` carrying 125
  events each, with zero `ics_import_done` (last fired 10-10) and **`ics_autosync_pref` at zero
  rows from any device, ever**. So the banner that is asking now carries the answer: a third,
  quieter affordance under "Review" / "Not now", worded **identically to the Settings switch** so
  she meets one setting and not two. It sets the same `syncManualOnly` and fires the same
  `ics_autosync_pref`, with `src:'banner'` — a row with **no** `src` came from Settings. It
  deliberately does **not** fire `ics_resync_dismissed`: that row is the complaint proxy this whole
  thread was read off (she dismissed at 08:54:05 on 10-14 and filed *"it keeps asking me to
  approve"* 81 seconds later), and a tap meaning "thank you, stop" is the opposite of one meaning
  "ask me again". **Never let it replace "Not now"** — "not this plan" is the common answer and
  must stay the easy one. The import stepper (the cold-load door, 2 of her 3 loads) does **not**
  carry it yet; that is a separate surface and `BACKLOG.md` → P1. Pinned by `tests/smoke.mjs` §50,
  whose own first draft aborted the run instead of failing when the button was removed — the
  regression it exists to catch — because a locator matching nothing times out at 30s.
  **And since 2026-10-22 the import stepper carries it too, which is the door that actually
  matters** — the banner fired on **one** of her three 10-20 loads; the other two were cold loads,
  and a cold load opens the stepper by design, so on two thirds of her visits she met the confirm
  sheet for a 125-event feed with no way to stop the asking. Same wording, same `syncManualOnly`, same
  `ics_autosync_pref` with `src:'stepper'`. Two properties are load-bearing and pinned, not
  incidental: it renders on the **confirm card only** (on the classify cards it would be one copy
  per group, and the group count for her feed was unknowable until `cards` shipped 2026-11-16),
  and **it does not dismiss the sheet**. That second one is
  where it deliberately differs from the banner's copy: the banner's job is "ask me later", but
  this sheet's plan may hold changes she wants, so a tap meaning "stop asking" must not also throw
  the plan away — it sets the preference, acknowledges itself in place, and leaves Confirm working.
  It sits below the primary row and is narrower than it, because a mis-tap on the sheet that
  confirms wage-affecting changes is the one real risk here. Offered only when a feed subscription
  exists — a file import has nothing to stop. Pinned by `tests/smoke.mjs` §51, whose own first
  draft repeated §50's mistake one layer down: the dismiss-on-tap break printed a single failure
  and then **aborted** on a detached-locator timeout, so the sheet-open check is captured once and
  guards every read after it.
  **The sync is now offered, not just available** (2026-10-01): it shipped 2026-09-03 and lived at
  the bottom of Settings behind a label that assumed a feed URL was already in hand — the owner's
  own first real sync took a hand-held walkthrough. A home-screen card ("Want to sync your
  NurseGrid calendar to load shifts?") opens a sheet carrying NurseGrid's six steps **in
  NurseGrid's own on-screen wording** (`Enable Calendar Sharing` → `Generate Nursegrid Calendar
  Feed` → worksite toggle → `Share` → `Copy`), with its own paste field wired to the same
  `onSaveIcalUrl` handler Settings uses. **The labels are the feature** — a rewrite into friendlier
  copy is a regression, which is why `tests/smoke.mjs` §26 mounts the sheet and asserts them off
  the rendered DOM rather than grepping the source. **No screenshots**: the publish set is exactly
  five files (Invariant 8), so an image would have to ride inline as base64 inside the file every
  visitor downloads, to illustrate a sheet most of them never open. The card is gated to a
  signed-in nurse with no subscription yet and one "Not now" retires it on that device
  (`scrubpay_ical_cta_dismissed` — cosmetic, deliberately not in the synced blob); Settings keeps
  the same walkthrough reachable for anyone who waved it off.
  **Time off defaults to "Not a shift"** (2026-10-03): NurseGrid puts vacation and unavailable
  days in the same feed as shifts, often as 24-hour blocks, and the stepper used to pre-select every
  card as a paid shift — Courtney's first sync priced 13 of them, 312 phantom hours. An entry that is
  all-day, ≥20h, or titled like time off (`ICS_OFF_TITLE_RE`; "holiday" deliberately excluded) now
  defaults to "Not a shift" on its own card. A default, not a filter: she still sees every card.
  Pinned by `tests/smoke.mjs` §29.
  **That default is forward-only, so the already-imported ones get a repair path** (2026-10-04):
  `longSyncedShifts` re-finds them from the *saved* blob — titles are never stored (Invariant 13)
  and `allDay` is not a field on a shift, so **duration is the only signal that survives an
  import**, at the same 20h floor and scoped to `icsUid`-bearing shifts so a long day she typed in
  herself is untouched. A dashboard card appears only while suspects exist and opens a sheet where
  "Not a shift" makes exactly the stepper's two `skip` writes (drop the shift, remember the uid in
  `icsIgnored`). **Never add a "remove all"** — a batch button on a list she has not read deletes
  shifts she actually worked. It shipped because the 10-03 claim that her 13 were "cleaned up by
  hand" was **false**: both her devices still reported `session_end {shifts:165}` eight hours after
  #145 deployed. Pinned by `tests/smoke.mjs` §32.
  **An update says what it is about to change, not just how many** (2026-10-09): removals have
  been spelled out by date since the stepper shipped, and updates were one clause —
  `Update 128 that changed?`. On 2026-10-08 that is exactly what one real sync showed: 128 of her
  131 synced shifts had their date, hours or start rewritten, and `ics_import_done` landed **1.8
  seconds** after the stepper opened, because with no new events to classify the stepper opens
  straight on the confirm card and there was nothing on it to read. An update is as wage-affecting
  as a removal — the date picks the paycheck, hours and start pick the differential — so the card
  now carries the kind of change (`3 move to a different day, 125 change time or length.`) and the
  first four spelled out before → after (`Oct 12 → Oct 14; Nov 2, 12h → 24h, 7:00 AM → 7:00 PM
  +124 more`). `icsPlanFromExisting` carries `prevHours`/`prevStart` for this and **nothing
  applies them** — the shift is still rewritten from `hours`/`start`. The kind line comes first on
  purpose: it is the only part that stays readable at 128. **Why those 128 changed is still open**
  (`BACKLOG.md` → P1, unverified) — the disclosure is right under either answer. Pinned by
  `tests/smoke.mjs` §36, whose own overflow assertion was unfalsifiable in its first draft for a
  **second** reason beyond §35's: the sheet is `position:fixed`, so an overflowing child never
  reaches `documentElement.scrollWidth` at all. Measure the block against the sheet.
  **A feed's times are converted to the viewer's clock** (2026-09-28): a trailing `Z` is UTC and a
  `TZID=` names a zone, both converted; a bare value is floating per RFC 5545 §3.3.5 and left as
  written; an unknown zone falls back to as-written rather than dropping the shift. It did not used
  to — "no timezone math" was the written spec, which is correct only when a feed's times already
  sit in the viewer's zone. NurseGrid's do not, so every synced shift landed 4 hours late and the
  error surfaced as a wrong take-home figure. Pinned by `tests/smoke.mjs` §22, which sets its own
  `timezoneId` because CI runners are UTC, where the conversion is the identity.

## Skills

Three project skills encode the rituals that were previously carried in prose here, so an agent
picks them up without being told. Invoke by name (`/ship`) or let the description match the task.

- **`ship`** — deploying. Fetch-before-branch (Invariant 10), run all three suites, PR to the deploy
  branch, then **verify with a marker against badgebudget.com** — the old github.io URL 301s with an
  empty 162-byte body, so anything grepping it for content can never see the change. Also the
  deployed-bytes-vs-branch diff, and the Invariant 11 branch rules.
- **`wage-core`** — anything touching a displayed dollar figure. Names the five decisions inside the
  math (OT stacks on the differential-inclusive rate; FICA on gross while income tax uses
  gross-minus-pretax; custom bonus is flat; display-only pre/post caps), then the protocol: baseline
  probes, a new assertion for the changed behaviour, and the equality assertion against the
  *deployed* build. Refuses the nightly loop.
- **`cos`** — the chief of staff: the brief, capturing an idea, recording a decision, the intro to
  the committee, and the nightly and Sunday-cabinet passes. See Operating committee.
- **`harness`** — driving the app for real. Rebuild, run, add an assertion, and the rule that every
  new assertion is negative-tested — plus the three ways that check lies (an aborted run is not a
  failed assertion; a short timeout caps `page.goto` and fakes a clean sweep; patch a copy, never
  the working tree) and `SMOKE_ONLY` for re-running just the affected sections. Covers the dev-build console diagnostic and what is still missing.

## Ops dashboard (detail: `docs/project-notes.md` → Ops dashboard)

`/ops.html` is the live console (feedback inbox + Devices tab), gated by `is_ops_admin()` in
Postgres. The nightly also republishes the batched dashboard artifact
`https://claude.ai/code/artifact/1dc2d599-258e-4cd9-bf0c-8cc1f0ae3f0e` after GROOM
(`dashboard_snapshot.sql` → `.mjs`; carry the `db`+`downloads` capabilities forward). **Every
activation figure computed since 2026-09-07 is inflated** by harness and bot rows until the device
classifier is fixed — re-baseline before quoting one. Exclude Playwright's `iPhone OS 15_0` +
`Version/18.0` pair and `nostore-%` ids.

## Deployment

- GitHub Pages via `deploy.yml`, on push to the deploy branch (and to `main`/`master`, which don't
  exist yet). The publish set is exactly `index.html`, `pdf.worker.min.js`, `privacy.html`, `ops.html`, `CNAME`
  — anything else silently 404s, and `check_build.mjs` asserts the set exactly (in both directions:
  a missing file 404s, an accidental one ships publicly). **CI** (`.github/workflows/ci.yml`, added 2026-09-07) gates pull requests — a
  `gate` job running `scripts/check_build.mjs` (Babel-parses the JSX block and mechanically asserts
  Invariants 1, 2, 4, 5, 6, 8 and 9) plus `scripts/test_groom_seed.mjs`, and a `smoke` job running
  `tests/smoke.mjs` on an iPhone 13 profile. **Both are required status checks** as of 2026-09-07
  via the `deploy gate` ruleset (Settings → Rules), which targets `claude/migrate-to-github-deploy-3F5RD`
  and also restricts deletion and non-fast-forward pushes. A red run now blocks the merge, and because
  required checks apply to pushes too, a direct push of an unchecked commit to the deploy branch is
  rejected — the "a JSX error ships live" hole is closed. Repository admin is on the bypass list, so
  the owner keeps an emergency override. **Auto-merge is enabled** repo-wide: a PR with auto-merge
  turned on lands itself the moment both checks go green.
- **Custom domain** badgebudget.com at Porkbun; `badgebudget.app`, `shiftstogo.com` and
  `shiftstogo.app` redirect to it. DNS is 4 A + 4 AAAA records to GitHub Pages plus a `www` CNAME.
  Registrar details, renewals, kept records: `docs/domains.md`.
- Deploy branch `claude/migrate-to-github-deploy-3F5RD`. Ship = PR → squash-merge → ~1–2 min → confirm
  at `https://badgebudget.com/index.html?cb=N` with a marker unique to the change.
- **Agents merge their own PRs.** Open PRs to the deploy branch **ready (never draft)** and enable
  **auto-merge (squash)** in the same step — this overrides the platform's draft-PR default. Never
  ask the owner to merge; the two required checks are the gate. **Pay-math, database and security
  changes merge by tier** (owner decision 2026-10-12, replacing 10-03's "they all wait for him"):
  on their own when the change moves no dollar figure (equality check green), is additive (RLS on,
  probe passing) or tightens access; to him when it moves a figure — with a before → after card of
  3 example paychecks in the PR body — or drops/rewrites data, or loosens access. Legal text always
  goes to him. Classification is by rule: a diff inside an `@core` region is number-moving until
  the equality check proves otherwise. Table: `docs/leadership.md` → *Approval tiers*.
- Delete merged branches; never the open PR heads or the two protected branches (Invariant 11).
- **A merge is not a deploy. From 2026-10-06 to 2026-10-09 that was literal, and it cost four
  nights.** **RESOLVED 2026-10-09 12:02:47 UTC**: the owner cancelled run 168, run **177**
  (`b468e5d`) completed `success` **18 seconds later** at 12:03:05, and `deploy_watch.mjs` reads
  `LIVE` — all **ten** merged-but-unshipped commits (#150 through #160) shipped in that one
  deploy. **And the thing that made it possible is now fixed too**, 2026-10-09 13:28 UTC: the
  owner set `cancel-in-progress: true` on the `pages` concurrency group (`f1aa7a6`, #162), so the
  next merge cancels a stuck holder and deploys itself — a stall costs one cycle instead of every
  deploy after it. **That does not retire the operating rule — treat every merge as unshipped
  until `node scripts/deploy_watch.mjs` says `LIVE`**; `cancel-in-progress` bounds how long a
  stall lasts, it does not make a merge a deploy, and the live check, not the green check, is what
  caught this on night one and every night after. (The expectation below that the commit carrying
  the flip would itself self-clear the queue was never tested: run 168 was cancelled eighty-one
  minutes before #162 merged, so the queue was already empty.) The history below is kept
  because the lesson is the four-night detection gap and the three nights of guessing, not the
  button that ended it. Run **168** (`a64348b`,
  PR #150) had sat `status:"waiting"` with its one `deploy` job `waiting` since 2026-10-06 08:49:27
  — the status Actions uses for a **deployment protection rule** on the `github-pages` environment,
  which the job declares. Because `concurrency: group:"pages"` holds the group, everything merged
  behind it is stuck too: runs 169 and 170 `cancelled`, run 171 `pending` with zero jobs created.
  As of 2026-10-07 badgebudget.com serves the pre-#150 bytes and **four merged, green changes are
  unshipped**. Nothing in this repo can clear it. **2026-10-09, fourth night: run 168 has now been
  `waiting` for ~72 hours and NINE merged green commits are unshipped** (#150, #151, #152, #153,
  #154, #155, #157, #158, #159), two of which change `index.html`. Run 176 (`078a4d8`) is
  `pending` with zero jobs; 169–175 are all `cancelled`. `deploy_watch.mjs` places the live
  `index.html` at `41d2549` (2026-10-05) with `privacy.html`, `ops.html` and `CNAME` all current,
  so the site is healthy and only stale. The owner step is
  unchanged and is one click: **Cancel workflow on run 168.**
  **The cause was read from the API on 2026-10-08 and it is NOT what the three nights before it
  guessed.** `GET /actions/runs/37438695953/pending_deployments` returns `wait_timer: 0` and
  `reviewers: []` — **no required reviewer, no wait timer**. So there is nothing to approve and no
  *Review deployments* button to press; the earlier advice in this file to approve it, or to remove
  a reviewer under Settings → Environments, was wrong and pointed at a control that does not exist.
  (The environments REST API is 403 through this session's proxy, which is why it stayed a guess
  for three nights; `pending_deployments` is an Actions path and is permitted — reach for that one.)
  It is an **orphaned pending deployment**: a run holding the `pages` concurrency group that can
  never start and can never be released. **The fix is to CANCEL run 168**, which frees the group;
  the next run then checks out the branch head and ships everything at once.
  **The structural fix is `cancel-in-progress: true`** on `deploy.yml`'s `pages` concurrency group.
  `false` (GitHub's starter default, written for busy repos with slow production deploys) makes any
  stuck run a permanent blocker of every deploy after it. With `true` the next merge cancels the
  holder and deploys itself, so a stall costs one cycle instead of all of them. What is given up is
  small here — the job is `cp` of five files plus the Pages upload, ~20s end to end, and anything
  interrupted is redone by the newer run seconds later. **Applied 2026-10-09 by the owner** (`f1aa7a6`, #162) — it needed
  him because editing a workflow file is blocked for agent sessions in this sandbox. Written down here rather than left in `BACKLOG.md` because it is now a
  standing property of this repo's deploy path and it is **Invariant 9's blast shape arriving by a
  different door** — everything merged after that point sits unshipped while looking merged. Treat
  every merge as unshipped until a live check against badgebudget.com says otherwise; that step,
  not the green check, is what caught this.
  **Since 2026-10-08 that check is one command: `node scripts/deploy_watch.mjs`.** It replaces the
  per-change `curl … | grep -c <marker>` ritual, which only ever worked when you already knew which
  string was new, said nothing at all on a night that shipped no new string, and "passed" against
  the ~162-byte github.io redirect body. Because `deploy.yml` copies the publish set verbatim the
  served file is byte-for-byte a git blob, so the watch sha256s `index.html`, `privacy.html`,
  `ops.html` and — since 2026-11-18 — `pdf.worker.min.js` against the deploy branch's own history
  and reports which commit is live — `BEHIND`
  names it and counts the unshipped changes. `UNKNOWN_BUILD` is deliberately **not** green: a
  build it cannot place is a check that could not be established, the same rule `silence_watch`'s
  `UNKNOWN` encodes. It also checks `CNAME`, the one Invariant 8 failure that is a total outage
  rather than a stale page.

## Autonomous nightly loop

**Routine** `BadgeBudget nightly (fresh session, fail-loud)` — id `trig_016Q4eZdanDoaVWzydPcGKpZ`,
cron `0 8 * * *` UTC (≈04:0x ET), model pinned to `claude-opus-5`, **rebuilt 2026-09-20**. It fires
a **fresh session per run** and carries `notifications: {push, email}` at the Routine level. Its
prompt says to read this file and `BACKLOG.md` first, so keep both self-sufficient.

The Routine was rebuilt after its predecessor sat silently disabled for three days; the design
reasons (fresh session for Routine-level notifications, commit every night as the heartbeat, verify
against badgebudget.com, run the committed suites) are in `docs/project-notes.md` → Autonomous
nightly loop. It refuses wage core by name, never re-adds a swap-board CTA or "anonymously" copy,
skips a queue item that overlaps an open PR's region of `index.html`, and honours `DRY RUN` in the
fire input by stopping after the gate.

Each run is **groom → build → gate → deploy → notify**:

1. **Groom.** Read `feedback` + `events` (Supabase MCP `execute_sql`, or the Management API fallback
   below) and run `node scripts/silence_watch.mjs` — a gap in `events` is ambiguous between "no
   visitors" and "telemetry broken", and the groom hand-ran that distinction three nights running
   (09-23, 09-25, 09-26) before it was written down. Quote its verdict, not a guess.
   **Then `node scripts/access_watch.mjs`** (since 2026-11-13) and quote that verdict too: a
   loosened grant or policy on `ical_subscriptions`, `user_data`, `events`, `feedback` or the
   `ops_*` functions is silent by construction, so the nightly read is the only thing that would
   ever notice. `TIGHT` is one line; anything else stops the run and goes in the report. Review the app, add/reprioritize P0–P3 in `BACKLOG.md` with a one-line rationale, dedupe
   against Done/Blocked. Run `node scripts/groom_seed.mjs --apply` to refresh the source-tagged
   "Reddit-seeded candidates" managed block (`docs/reddit-persona-pipeline.md`): those are candidates
   to promote with judgment, never auto-built. Seed sources: `seed` (curated 2026-08-13);
   `reddit-owner` (the owner browsing Reddit via Claude in Chrome with `docs/reddit_intake_prompt.md`;
   each theme carries an `observed` field — weight thin ones accordingly); `reddit-live` is
   **unavailable** (Reddit closed self-serve API registration — don't send the owner to
   reddit.com/prefs/apps). **Known dedupe defect:** coverage is keyword presence across CLAUDE.md +
   BACKLOG.md, so a theme merely narrated as *deferred* counts as covered (`self-schedule-fairness`);
   pinned by a test — don't "fix" it by trimming the Done log, that resurrects shipped themes. When
   the queue runs dry, a persona pass (`docs/reddit_personas.json`, 6 personas driven as subagents)
   replenishes it; a persona finding ships only if it reproduces in the harness or is corroborated by
   a Reddit theme. **Then the chief-of-staff pass** (`cos` skill → *nightly*, since 2026-10-12):
   the git and session capture nets, the seat triggers, `now.md`, and the dead-man's switch — a
   `docs/cos/brief.md` older than 8 days puts **CABINET MISSED** in this run's notify line.
2. **Build.** `git fetch origin claude/migrate-to-github-deploy-3F5RD && git checkout -B
   claude/clause-md-review-9tqlj8 origin/claude/migrate-to-github-deploy-3F5RD`, then implement the
   **single** highest-priority unblocked, gate-safe item from `## Queue`.
3. **Gate** — all must pass: boot happy renders; `hang-getsession` still renders; `block-babel` shows
   the boot error screen; zero non-network page errors; SRI intact (5); boot hardening + wage-core
   untouched; wage-math probes pass; money surfaces legible on iPhone 13.
4. **Deploy** only on green: commit with the dated Done-log line, push the work branch
   (`--force-with-lease`), PR to the deploy branch, squash-merge, then confirm live with
   `node scripts/deploy_watch.mjs` — a `LIVE` verdict, not a green check, is what counts as shipped.
   If push is denied, put `git format-patch` output in the summary rather than losing the work.
5. **Notify** — push + email fire from the Routine itself now; the run still ends with 1–2 lines
   saying what shipped (or why not) and the live-confirmation result.

**Queue shape.** `## Queue` holds only work one run can finish *and verify*. Anything needing a live
repro, a design call, or delicate surgery lives under `## Needs a dedicated session (NOT for the
nightly loop)` — don't pull from there, and move an item there with a one-line reason rather than
re-deferring it nightly. Every open item carries a harness tag: `harness:drivable` (verifiable
end-to-end in the iPhone-13 sandbox — every build since 2026-08-17), `harness:needs-live-auth`
(authenticated swap board; verify by the swap-UI standard in `docs/swap-board.md` instead),
`harness:unscoped` (no existing surface — a feature to design). Within a band, `drivable` first.

**Rules.** Full autonomy, gate-limited. One build item per run. Risky or ambiguous → mark `deferred`
with a note and take the next safe item or stop; never deploy a failing gate. `BACKLOG.md` is the
durable memory — commit everything. Scheduled-run quirks: `BACKLOG.md` → Environment notes.


## Harness hooks

`.claude/settings.json` runs `scripts/hooks/pre_push_gate.mjs` before any `git push` an agent
issues. It blocks (exit 2) unless HEAD contains `origin/claude/migrate-to-github-deploy-3F5RD`
(Invariant 10, fetched fresh — a failed fetch blocks too) and `scripts/check_build.mjs` passes.
A fresh container has no Babel, so the first push is blocked with the install line
(`npm install --no-save @babel/standalone@7.24.7`); run it and push again. Branch deletions pass
through. It sees only agent pushes; CI stays the binding gate.

A **SessionStart** hook (`scripts/hooks/session_start_cos.mjs`, since 2026-10-12) prints the
operating committee's live threads into every new session, with the `Thread:` trailer and inbox
rule. It never blocks; a missing `docs/cos/now.md` prints nothing.

## Supabase (detail: `docs/project-notes.md` → Supabase)

- Project `mnnlgcxnvodjwlhhiphq`, free tier, **the only project** — it holds real users' pay
  history, so audits and migrations run against production. Every table is RLS-enabled.
- `ops_admins` has RLS with **zero policies by design** — don't "fix" the advisor INFO by adding one.
  The `ops_*` functions must never appear in the advisor's `anon`-executable list.
- `ical-proxy` accepts the public anon key (`security-08`) — an open relay until the handler checks
  `role === 'authenticated'` (hardening session).
- MCP: `.mcp.json` runs `@supabase/mcp-server-supabase@0.13.0` over stdio with `SUPABASE_ACCESS_TOKEN`
  from the environment, **pinned and `--read-only`** (2026-10-01): every session can query
  production, none can write to it by accident. Read-only blocks writes, **not RLS bypass** — queries
  run as `supabase_read_only_user`, which is not a superuser but has `rolbypassrls` and
  `pg_read_all_data` (checked 2026-10-03: sees every `user_data` row), so they can't show what a user
  sees; use `scripts/ops_gate_probe.sql` for that. Writes (migrations, function patches) go through the Management API (`database/query`,
  `config/auth`, `advisors/*`) in a dedicated session; Node fetch needs
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`. Bump the pin deliberately.
- Re-read headroom figures before quoting them; old ones in the notes have drifted before.

## Testing (detail: the `harness` skill and `docs/project-notes.md` → Testing)

`node scripts/check_build.mjs` (gate, 21 checks, ~2.6s — it parses each source once and shares
the tree across all 15 walks, and the summary prints that count), `node scripts/test_check_build.mjs` (104, the
gate's own meta-test — roster + 88 deliberate breaks + 9 GREENS that must stay green, one per check and one per `must()` where a
check holds several, with the failing check's label pinned where checks share a tag, and a row may
also pin a FIGURE in the gate's output; ~4min, not in CI yet),
`node scripts/test_groom_seed.mjs` (33),
`node scripts/test_dashboard_snapshot.mjs` (44, the ops dashboard's event inventory — pure logic,
no browser, no network, **not in CI yet** for the same one-line reason as the gate meta-test; nine
measured breaks, and case 30 runs the regex it replaced and requires it to come back short, so
"simplify this back to a grep" fails there rather than silently dropping eight event names),
`node tests/core.test.mjs` (175, the extracted core, no browser), `node tests/smoke.mjs` (Playwright, 1012,
iPhone 13 — §58 is its own roll-call: 61 declared sections, and a section that never ran or
asserted nothing fails the suite). `tests/equality.mjs` is the wage-core check against
the **deployed** build — by hand only, needs network. Every new assertion is negative-tested. Scratch
copies point `SUPABASE_URL` at `.invalid` so the harness can never write to production analytics.
Not in git: the swap-matching suite and `rls_audit.js`, so those Done-log figures are unreproducible.

## Open items

`BACKLOG.md` is the work queue. The older narrative list (agent gateway, scaling, open PRs, merged
branches to delete, consent-screen payoff) is in `docs/project-notes.md` → Open items.
