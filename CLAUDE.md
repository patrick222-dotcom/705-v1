# BadgeBudget — Shift Pay Planner

Take-home pay planner for bedside nurses, built for the owner's wife and her unit. Logs shifts +
differentials, shows what a shift is worth *before* it's worked, imports/exports .ics schedules, and
hosts an anonymous shift-swap board.

- **Live:** https://badgebudget.com (custom domain since 2026-09-02). The old
  `https://patrick222-dotcom.github.io/705-v1/` URL 301-redirects there. **Verify deploys against
  badgebudget.com.**
- **Naming:** renamed from ScrubPay on 2026-09-04 (#64), visible strings only — the storage keys, the
  .ics UID scheme and the swap salt still say `scrubpay` on purpose (Invariants 5–7). The `scrubpay.*`
  domains belong to other parties; never present them as ours. Why the name changed:
  `docs/session-2026-09-02-domain-and-naming.md`.
- **Two goals:** (1) ship a polished app; (2) **meta-goal** — refine a reusable multi-agent
  "development council" process: context preservation between agents, automated fix→re-review
  until every lens scores 8/10, less manual synthesis by the orchestrator, real mobile testing.
  Council history lives in `docs/history.md`.

## Where things are

| Path | What |
|---|---|
| `index.html` | the whole app: CSS, a plain-JS boot script, one Babel-transformed JSX block |
| `pdf.worker.min.js` | pdf.js worker, served same-origin next to `index.html` |
| `CNAME` | `badgebudget.com` — load-bearing, see Deployment |
| `.github/workflows/deploy.yml` | the only workflow: 3-file publish to GitHub Pages, no CI gate |
| `BACKLOG.md` | the nightly loop's durable memory: queue, parked items, blocked, Done log |
| `supabase/migrations/` | `001_swap_board.sql` (swap board), `002_ical_subscription.sql` (the iCal feed table) and `003_siri_inbox.sql` + `004_siri_inbox_spec_align.sql` (`siri_tokens` + `ops_inbox`, the Siri bridge); `user_data`/`feedback`/`events` still exist only in the live project |
| `supabase/functions/ical-proxy/index.ts` | SSRF-guarded Edge Function that fetches a nurse's secret iCal feed (deployed, `verify_jwt` on) |
| `supabase/functions/siri-ingest/index.ts` | The Siri Shortcut's ingest endpoint: hashes the Siri code, validates one `form`-mode op, queues one `ops_inbox` row with the service role (deployed, `verify_jwt` **off** by design — it authenticates by code; see Invariant 14) |
| `scripts/groom_seed.mjs` + `scripts/test_groom_seed.mjs` | Reddit-seed groom tooling + its 33-assertion suite (the only tracked tests) |
| `docs/reddit-persona-pipeline.md`, `reddit_seed.json`, `reddit_personas.json`, `reddit_intake_prompt.md` | Reddit insights → backlog candidates → persona testers |
| `docs/swap-board.md` | swap-board design, anonymity model, audit history, verification standard |
| `docs/domains.md` | registrar, DNS, renewals, OAuth consent-screen limitation |
| `docs/history.md` | dated log of decisions, incidents and resolved work (council runs, the sync P0, NurseGrid research) |
| `docs/state-brief-2026-09-02.md` | adversarially-verified repo survey + a 23-item prioritized cleanup list |
| `docs/agent-gateway-scope.md` | the "one domain, two surfaces" (UI + MCP) design: core extraction, versioned ops, an MCP Edge Function on Supabase OAuth, an ops manifest (Path A, design only) — plus **Path B**, the Siri Shortcut → ops inbox bridge, whose Session A shipped 2026-09-05 (its "As built" subsection is the record) |
| `design-system/` | 12 static HTML spec pages + `cards.json` from the 2026-07-29 Liquid Glass pass. Reference only: not deployed, not loaded by the app, may lag `index.html` |
| `.mcp.json`, `.agents/skills/`, `.claude/skills/`, `skills-lock.json` | Supabase MCP server config + vendored Supabase skills (symlinked, hash-pinned) |

## Invariants — never weaken, never rename

The nightly safety gate checks 1–3 mechanically; a human has to hold the rest.

1. **Boot hardening** in the plain-JS boot script: 8s watchdog error screen; Supabase client creation
   null-guarded (app degrades to localStorage-only if the CDN script fails); `getSession()` raced
   against a 4s timeout (WebKit deadlock — iPhone Chrome is WebKit too). These fixed a long-standing
   iPhone infinite spinner.
2. **SRI on all 5 CDN scripts** (`grep -c 'integrity="sha384-' index.html` → 5), exact pinned versions.
3. **Wage-core** (`shiftGross`, `hourlyRate`, `computeNet` — the per-paycheck tax model shared by the
   hero and the pattern lab since #65 — `calc`, `statOf`/`ptoStatOf`, `patternMetrics`, and the
   rate/differential coercions in `sanitizeData`): touch only in a dedicated session, with the
   wage-math probes **and the hero/breakdown equality assertion against the deployed build**, never in
   a nightly build. Adding a sanitizer branch for a *new* data shape (as #62 did for `goals`) is fine
   in a nightly if it comes with a unit test and the existing probes stay green.
4. **`saveToSupabase` upserts with `{onConflict:'user_id'}`.** The table's PK is a generated `id` and
   `user_id` carries a separate unique constraint; without the option every save after the first fails
   with 23505. That silently broke cloud sync for every signed-in user from 2026-07-07 to 2026-08-23.
   Companion rules from the fix: the per-user failed-save backup carries `savedAt` and wins when newer
   than the cloud row; `console.error` is mirrored into the error ring buffer.
5. **Storage keys are data, not branding.** Renaming any of them orphans user data or severs analytics
   joins: `nursingWagePlannerData` (anonymous users' data — contains no brand string, so a
   ScrubPay→BadgeBudget find/replace misses it) and `nursingWagePlannerData::<uid>` (per-user
   failed-save backup); `scrubpay_anon_id`; `scrubpay_feedback_pending`; `scrubpay_pending_invite`;
   `scrubpayErrors` (`ERR_KEY` in the boot script; every read goes through it since #64).
6. **`@scrubpay` is the .ics self-recognition sentinel**: export stamps UIDs as
   `scrubpay-<date>-<id>@scrubpay`, import drops any UID containing `@scrubpay`. Change either half and
   every previously exported event re-imports as a duplicate.
7. **`'scrubpay-swaps'` is a live md5 salt** deriving `poster_key` in the deployed `swap_board()`
   function. It is the swap board's anonymity model, not a string.
8. **`CNAME` stays in the publish set** (`cp CNAME _site/` in `deploy.yml`). Pages reads the custom
   domain from the deployed artifact; a deploy without it knocks the site off badgebudget.com.
9. **No `main` branch.** `claude/migrate-to-github-deploy-3F5RD` is the de facto default and deploy
   branch, deliberately in the workflow's push triggers. Add `main` to the triggers *before* removing
   it, never in the same commit — removing it first stopped all deploys once.
10. **Fetch before touching the deploy branch.** Fresh checkouts are shallow and have been seen 14
    commits behind origin. Always `git fetch origin claude/migrate-to-github-deploy-3F5RD` and branch
    from `origin/…`, never from the local ref.
11. **Don't delete `claude/clause-md-review-9tqlj8`** (the nightly's working branch) or the head of any
    open PR. Merged heads are fair game (see Open items for the current list).
12. **URL Forwarding stays OFF on badgebudget.com at Porkbun** — it overrides the A records entirely.
13. **The iCal feed URL is a bearer credential.** It lives only in `ical_subscriptions` (owner-only RLS,
    no `anon` grants), is absent from `serializeState` so it never enters the `user_data` blob (which
    is exported, mirrored to localStorage and echoed by the sync poll), never goes into `events`, and
    is never logged by `ical-proxy`. The parser stores dates, times, hours and UIDs — never titles.
14. **Siri codes are write-only, hashed at rest, revocable — and the app stays the sole writer to
    `user_data`.** A code (`BB-XXXX-XXXX-XXXX-XXXX`) is shown once, stored only as its SHA-256 in
    `siri_tokens`, and refused by `siri-ingest` once `revoked_at` is set. The only table a code can
    touch is `ops_inbox`, and only by inserting a *pending* row through the Edge Function (there is no
    client insert policy on `ops_inbox`; the function inserts with the service role after validating
    the op). A queued op reaches the calendar — and therefore the `user_data` blob — only when the nurse
    taps **Add** in the "From Siri" sheet, which runs `saveDayShifts`, the Add-Shift sheet's own write
    point. `siri-ingest` never logs or echoes the code; the app never stores the plaintext. Don't add an
    insert policy, don't let the function write anything but `ops_inbox`, don't hash with anything but
    SHA-256 of the canonical dashed string (the app and the function must agree byte-for-byte).

## Architecture

- **Single file, no build step.** React 18 + Babel standalone, JSX transformed in-browser. Keep it
  single-file. Two god components: `App` (~1,180 lines) and `SwapsSheet` (~820 lines). No
  memoization on the calendar path (a parked item; stabilizing `keyOf` alone is a no-op).
- **CDN deps** (pinned + SRI): React/ReactDOM 18.2.0 (unpkg), Babel standalone 7.24.7 (unpkg), pdf.js
  3.11.174 (cdnjs), supabase-js 2.45.4 (jsdelivr). Google Fonts (Bricolage Grotesque + Plus Jakarta
  Sans) is a fourth external vendor — stylesheet only, no SRI possible, graceful fallback. pdf.js
  `getDocument` uses `isEvalSupported:false` (CVE-2024-4367). The `<meta>` CSP covers every runtime
  host; `frame-ancestors` can't be set via meta and Pages sends no `X-Frame-Options`, so clickjacking
  protection is simply unavailable on this host. The `<head>` also carries an inline SVG data-URI
  favicon, a meta description and a theme-color (#64) — head-only, so the 3-file publish set holds.
- **Data.** Signed-in → Supabase `user_data`: one `jsonb` blob per user, upserted on `user_id`,
  debounced 500ms, capped at `MAX_BLOB_BYTES` = 512KB (free-tier guard). The blob holds pay settings,
  shifts, differentials, templates, day events, notes, `goals` (≤ `MAX_GOALS` 12) and `patterns`
  (≤ `MAX_PATTERNS` 8); every array goes through `sanitizeData` on load. Anonymous → localStorage.
  Writes are whole-blob, last-writer-wins, no version — fine for one human on two devices, not for an
  agent writing concurrently (the agent-gateway scoping doc, PR #67, starts from this fact).
  Cross-device sync is a 15s poll while the tab is visible, guarded by `updated_at` vs `lastSeenAt`
  and a content-equality check so two devices never ping-pong writes; `applyData(...,{keepPeriod:true})`
  leaves the viewed pay period alone. Not push: Realtime would need the table in the
  `supabase_realtime` publication plus `wss://*.supabase.co` in the CSP.
- **Feedback.** Widget (top-bar 💬 + Settings) → `feedback` table, insert-only RLS for
  `anon`+`authenticated` (nobody can read back via the anon key). Offline submissions queue in
  localStorage and flush on next load. **Each row also carries `page` (pathname, ≤120 chars) and
  `user_agent` (≤400 chars)** — undisclosed until 2026-09-02; keep-or-strip is an open product call.
  Owner read: `select created_at, message, contact, user_id, page, user_agent from public.feedback
  order by created_at desc;`
- **Analytics.** `track(name, props)` → `events` (insert-only RLS). Coarse names only — **never wage or
  goal figures** — plus the same `page` + `user_agent` columns and a stable per-device `anon_id`.
  Naming: `snake_case`, `<surface>_<verb>`. Regenerate the list with
  `grep -o "track('[a-z_]*'" index.html | sort -u`; currently 36: `app_open`, `setup_completed`,
  `signed_in`, `view_changed` `{view}`, `today_jump`, `shift_saved`, `note_saved`,
  `day_event_added/removed`, `template_saved/applied/tap`, `paystub_imported`, `ics_exported`,
  `ics_import_parsed/done`, `ics_sync_done`, `pattern_lab_opened`, `pattern_saved` `{cycle}`,
  `pattern_applied` `{shifts,weeks}`, `pattern_shifts_removed` `{n}`, `feedback_submitted`, `swap_group_created/joined`,
  `swap_invite_shared/opened`, `swap_posted`, `swap_withdrawn`,
  `swap_match_proposed/accepted/declined/confirmed`, `swap_plan_applied`, `siri_connected`,
  `siri_op_confirmed` `{n,op}`, `siri_op_rejected` `{n,op}` (op name only — never the payload, the
  note text or the summary). (`health_check` rows in the table are owner probes.) Owner read: `select name, count(*) from public.events group by name order
  by 2 desc;`
- **Auth.** Supabase email/password + Google OAuth (PKCE; `redirectTo` = `origin + pathname`, so the
  domain move needed no code change). Site URL `https://badgebudget.com/`; the allow list also keeps
  `www.` and the github.io URL so in-flight links resolve. Google's consent screen names
  `mnnlgcxnvodjwlhhiphq.supabase.co` — unfixable without a paid Supabase custom domain; the free
  improvement is app name + logo on the GCP consent screen (not yet done).
- **Swap board.** Invite-code unit groups, anonymous posts, client-computed
  pickup/handoff/trade/3-cycle suggestions, names revealed only after every leg accepts. Anonymity is
  enforced in Postgres (column grants + security-definer RPCs) and was audited adversarially
  (29/29 + 5/5, 2026-07-30). Invite links `https://badgebudget.com/?join=CODE` go through the native
  share sheet; the recipient always confirms; the code survives the OAuth redirect via a 1h
  localStorage stash. The 🛠️ "not set up yet" screen (`tablesMissing`) is a defensive fallback,
  unreachable in normal operation and not doc-sized to remove. Known gap by design: `poster_key` is
  stable per group, so a colleague identified via one confirmed match can recognize that person's
  later posts (disclosed in-app since 2026-08-11; key rotation parked). Everything else:
  `docs/swap-board.md`.
- **Product surfaces.** Month-first scrolling calendar with a scroll-following pay period; a hero
  take-home figure with Gross / Taxes / Keep-% chips; an Add-Shift sheet with shift templates,
  quick-fill, day events (PTO paid at base rate) and a live preview — gross, take-home, ≈$/hr
  take-home, OT tag — so a nurse can judge whether picking up an extra shift is worth it *before*
  working it; savings goals (Settings, capped at `MAX_GOALS`=12, stored in the same blob) shown in
  that preview as "% of goal (≈N shifts)" and on each goal in Settings as "≈ N typical 12h shifts to
  reach this" (#68); a month-first calendar whose month label + weekday row stay pinned while scrolling
  (#63); a breakdown view; paystub PDF import (parsed on-device, never
  uploaded); Settings.
- **Pattern lab (#65, 2026-09-04).** Top-nav "Patterns", a dashboard card and the empty-state CTA open
  a modal lab: presets nurses actually describe (Mon–Wed nights, 3/1/3/7, 2-2-3 Pitman, 4 on/4 off,
  Fri–Sun weekend program) or a blank 7/8/14/28/custom-day cycle anchored on a date; paint cells with
  Day/Night 12h/8h brushes or a saved template (weekend cells resolve to the weekend differential at
  apply time, same inference as .ics import). Readout: take-home per paycheck via `computeNet()`
  over `lcm(cycle,14)` days (`patternMetrics()`), gross, hours, ≈/yr, the reverse goal view, and the
  life shape — shifts/cycle, hrs/wk, longest stretch and break (cyclic), weekends worked, which
  weekdays are always off, or a "drifts across the week" warning when the cycle doesn't divide 7.
  Saved patterns compare side by side with no "best" highlighting (no-nudge rule). "Put it on the
  calendar" previews adds/skips and never clobbers existing shifts unless the replace switch is on;
  placed shifts carry `patternId` so "Remove them" pulls back only what the pattern added. Shape:
  `patterns:[{id,name,anchor,cells:[cell|null]}]`, presets in `PATTERN_PRESETS`.
- **Schedule import/export (calendar sync).** .ics export (deterministic UIDs, no wage data) and
  .ics import with a guided shift-type questionnaire; re-import moves shifts and preserves pay types via
  `shift.icsUid`. **Auto-sync (#57, 2026-09-03):** Settings → CALENDAR SYNC takes a calendar's *secret
  iCal address* (signed-in users only); the app re-fetches it through `ical-proxy` once per app open
  and on "Sync now", and routes the result through the same import stepper, so auto-sync never
  silently rewrites wage-affecting shifts. Re-sync lifecycle: matched-by-UID shifts move and keep their
  pay type; shifts that vanished from the feed are proposed for removal only inside the fetched window
  (60 days back, 366 forward) and never when the 200-event cap truncated the feed; "Not a shift" files a
  wage-neutral day-event chip and "Ignore these" hides it, both remembered by UID. Proxy: host allowlist
  (Google Calendar hosts only so far — the NurseGrid feed host is still a TODO), https only, no
  redirects, 2MB cap, 8s timeout. Known limits: the confirm step is all-or-nothing, and a local edit to a
  synced shift's hours loses to the feed on the next sync.
- **Siri bridge (agent gateway Path B, Session A — 2026-09-05).** Settings → SIRI (signed-in only):
  "Connect Siri" mints a code with `crypto.getRandomValues`, shows it once with Copy, stores only its
  `crypto.subtle` SHA-256 in `siri_tokens`; codes list with Revoke; "Get the Shortcut" is bound to
  `SIRI_SHORTCUT_URL` and renders disabled + "coming soon" while that constant is empty. The 15s
  signed-in poll also selects pending `ops_inbox` rows; when new ones arrive and no other overlay is
  open, a **"From Siri"** sheet lists each op in plain language (`siriOpLine`) with per-item **Add /
  Skip**. Add builds the shift with `siriShiftFromOp` (the pattern lab's weekend / active-differential
  inference, so "Night" on a Saturday becomes Weekend night) and commits through `saveDayShifts`; Skip
  marks the row `rejected`. Ops: `add_shift{date,shiftType,hours,start?}`, `add_day_event{date,kind,
  hours?}`, `set_note{date,text}` — `form` mode only; dictation / Claude parsing is Session B. The
  spec, the Shortcut build steps and the sequence: `docs/agent-gateway-scope.md` → Path B.

## Deployment

- GitHub Pages via `deploy.yml`, on push to the deploy branch (and to `main`/`master`, which don't
  exist yet). The publish set is exactly `index.html`, `pdf.worker.min.js`, `CNAME` — anything else
  silently 404s. There is no CI: a JSX syntax error ships live, so the harness gate is the only check.
- **Custom domain** badgebudget.com at Porkbun; `badgebudget.app`, `shiftstogo.com` and
  `shiftstogo.app` redirect to it. DNS is 4 A + 4 AAAA records to GitHub Pages plus a `www` CNAME.
  Registrar details, renewals, kept records: `docs/domains.md`.
- Deploy branch `claude/migrate-to-github-deploy-3F5RD`. Ship = PR → squash-merge → ~1–2 min → confirm
  at `https://badgebudget.com/index.html?cb=N` with a marker unique to the change.
- Delete merged branches; never the open PR heads or the two protected branches (Invariant 11).

## Autonomous nightly loop

**Routine** `ScrubPay nightly (dedicated lean session)` — id `trig_019zkn8Z6Xu18t1B46iNMuwP`, cron
`0 8 * * *` UTC (≈04:0x ET). It fires into a **persistent, authorized session**
(`session_01GGWUJsjTww44sqB58U5Ahp`) where `git push` and the Supabase MCP both work — *not* a fresh
session per fire, which is why every nightly commit carries the same `Claude-Session:` trailer.
Nothing in the repo represents the Routine; delete it and the loop stops silently. Its prompt says
to read this file and `BACKLOG.md` first, so keep both self-sufficient.

Each run is **groom → build → gate → deploy → notify**:

1. **Groom.** Read `feedback` + `events` (Supabase MCP `execute_sql`, or the Management API fallback
   below), review the app, add/reprioritize P0–P3 in `BACKLOG.md` with a one-line rationale, dedupe
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
   a Reddit theme.
2. **Build.** `git fetch origin claude/migrate-to-github-deploy-3F5RD && git checkout -B
   claude/clause-md-review-9tqlj8 origin/claude/migrate-to-github-deploy-3F5RD`, then implement the
   **single** highest-priority unblocked, gate-safe item from `## Queue`.
3. **Gate** — all must pass: boot happy renders; `hang-getsession` still renders; `block-babel` shows
   the boot error screen; zero non-network page errors; SRI intact (5); boot hardening + wage-core
   untouched; wage-math probes pass; money surfaces legible on iPhone 13.
4. **Deploy** only on green: commit with the dated Done-log line, push the work branch
   (`--force-with-lease`), PR to the deploy branch, squash-merge, confirm live at badgebudget.com. If
   push is denied, put `git format-patch` output in the summary rather than losing the work.
5. **Notify** the owner by push with 1–2 lines.

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

## Supabase

- Project `mnnlgcxnvodjwlhhiphq`, free tier, and **the only project** — it holds real users' pay
  history while RLS audits and migrations run against it (a dev project is a parked item). Tables,
  all RLS-enabled: `user_data`, `feedback`, `events`, `ical_subscriptions` (migration 002, applied
  2026-09-02; 4 per-command policies, `anon` unlisted), `siri_tokens` + `ops_inbox` (migrations 003 + 004,
  applied 2026-09-05 via MCP `apply_migration` — the first migrations recorded in
  `supabase_migrations`; owner-only `authenticated` policies, **no** client insert policy on
  `ops_inbox`, column-level update grants, owner delete, `anon` has zero grants), `swap_profiles`, `swap_groups`,
  `swap_members`, `swap_posts`, `swap_matches`, `swap_match_legs`. Two Edge Functions: `ical-proxy`
  (ACTIVE, `verify_jwt` on — an unauthenticated POST is 401, so it is not an open proxy) and
  `siri-ingest` (ACTIVE, `verify_jwt` **off** — it authenticates by hashed Siri code, rate-limits 10/min
  and 20 pending per user, expires pending rows after 7 days; Invariant 14).
- **MCP.** `.mcp.json` runs `@supabase/mcp-server-supabase` over stdio with `SUPABASE_ACCESS_TOKEN`
  from the environment (uppercase; set in the cloud environment settings, never committed). Network
  policy must allow `api.supabase.com`. Prefer the typed tools (`execute_sql`, `get_advisors`,
  `list_tables`) over dashboard instructions. PR #57 replaces this with the hosted HTTP/OAuth server;
  revert that hunk when merging — OAuth can't complete in the nightly's headless container.
- **Management API fallback.** `curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN"
  https://api.supabase.com/v1/projects/<ref>/…` — `database/query` (POST, SQL), `config/auth`
  (GET/PATCH), `advisors/{security,performance}`, `usage`. Node fetch needs
  `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- **Advisor state (2026-09-04, unchanged by migration 002).** No ERRORs. 16 WARNs that the 8 swap security-definer functions are
  executable by `anon`/`authenticated` — expected: those RPCs *are* the anonymity boundary and gate on
  membership/party checks inside (audited 2026-07-30). Plus "leaked password protection disabled" —
  HIBP is Pro-only; the API silently ignores it on free.
- **Headroom.** 3 `user_data` rows, 4 feedback, ~270 events; DB far under 500MB. Watch MAU (50k cap)
  and DB size; `MAX_BLOB_BYTES` and the feedback length caps bound per-row growth.

## Testing (no device needed)

Browsers are pre-installed under `/opt/pw-browsers/` (the nightly launches
`chromium_headless_shell-1194/chrome-linux/headless_shell` with `--no-sandbox`). The sandbox blocks
CDNs and Supabase but allows `registry.npmjs.org`, so the harness is rebuilt per session:

1. Vendor the pinned packages from npm (react, react-dom, @babel/standalone, pdfjs-dist,
   @supabase/supabase-js, playwright-core@1.47.2).
2. Scratch-copy `index.html`; rewrite the 5 CDN `<script>` tags to the local paths and strip
   `integrity`/`crossorigin` **in the scratch copy only**.
3. Serve with `python3 -m http.server`; drive with Playwright's iPhone 13 device profile; capture
   `console`, `pageerror` and `requestfailed` (that is how the spinner bug was found).
4. Top-level function declarations are globals, so unit-test the real `shiftGross`/`hourlyRate`/
   `sanitizeData` via `page.evaluate`. Seed `localStorage['nursingWagePlannerData']` with
   `{setupComplete:true, baseRate:50}` to skip onboarding. For any wage-core change, also render the
   same seed against the *deployed* build and assert the hero, chips, breakdown rows and take-home
   text are byte-identical (the #65 harness did this with pre/post-tax deductions, custom FICA %,
   percent + dollar withholdings, OT and PTO). A `makeMinimalPdf(text)` builder that emits a
   structurally valid PDF drives the paystub path.
5. Test failure modes, not just the happy path: block Babel (expect the boot error screen), hang
   `getSession()` (expect the app to render anyway).

**Dev-build console diagnostic.** Production React silences dev-only warnings (missing `key`,
controlled/uncontrolled flips, setState-on-unmounted, invalid nesting) — real defects that never
surface as a `pageerror`. Make a second scratch copy pointing at `react.development.js` +
`react-dom.development.js` (already in the vendored packages), drive the real flows, and capture
`warning`/`error` console messages. A clean run shows only the Babel in-browser transformer notice
and the sandbox `ERR_CONNECTION_RESET`s. Last run 2026-08-23: clean.

**The harness is not in git.** The Playwright rig, the 27-assertion swap-matching suite
(`te_swap_p2_algo.js`) and the RLS audit (`rls_audit.js`, which mints throwaway confirmed users via
the admin API) only ever lived in session scratchpads, so the "N/N" figures in the Done log are not
reproducible from the repo. Committing them under `tests/` is an open item.

## Open items (state as of 2026-09-05 — the work queue itself is `BACKLOG.md`)

- **Agent gateway** (`docs/agent-gateway-scope.md`, merged 2026-09-05 via #67): the scoping design for
  "one domain, two surfaces" — extract the wage core into `core/` with a build step that inlines it
  back; versioned `apply_ops` instead of whole-blob writes; an MCP Edge Function authenticated by
  Supabase's OAuth 2.1 server so RLS applies to the agent unchanged; an ops manifest that gates UI/tool
  parity. **Path A (the MCP gateway) is unbuilt.** Five owner decisions gate its first session: build
  step yes/no, rehearsal project, agent swap-board writes, custom auth domain, create `main`. The doc's
  own advice: step 1 (core extraction, zero behavior change) then step 3 (read-only gateway) is the
  cheapest route to a connector on a real phone; writes wait for step 2 (versioned ops). **Path B (Siri
  Shortcut → ops inbox) Session A shipped 2026-09-05**: migration 003, `siri-ingest`, the SIRI card and
  the "From Siri" sheet. Still open: the owner builds the Shortcut from the doc's spec, tests it with
  their own code, pastes the iCloud link into `SIRI_SHORTCUT_URL`; Session B adds dictation.
- **Open PRs.** #46 — ten lines of AuthModal copy naming supabase.co before Google does (still says
  "ScrubPay"; rebase + rename before merging, or close it in favour of the GCP consent-screen branding).
- **iCal sync, owner-side.** The proxy allowlist still lacks the real NurseGrid feed host (marked TODO;
  Google Calendar works); do a smoke test with a real secret address. Follow-ups (per-item confirm,
  "locally edited" protection for synced shifts, the iOS Shortcuts push alternative) are in `BACKLOG.md`.
- **Merged branches to delete** (delete pushes are 403 from agent sessions — do it in the GitHub UI):
  `claude/reddit-agent-personas-threads-q3mobt`, `claude/reddit-seed-phase1`,
  `docs/reddit-persona-pipeline`, `crawler-pushtest`, `claude/scrubpay-domain-purchase-j9cqf6`,
  `claude/ical-subscription-sync`, `claude/ical-branch-progress-4x2baj`,
  `claude/rename-scrubpay-badgebudget-5jesy5`.
- **Google consent screen** still names `mnnlgcxnvodjwlhhiphq.supabase.co`; set the app name + logo on
  the GCP OAuth consent screen (free). The nightly Routine's prompt still curls the github.io URL for
  its live check (a 301 with no body) — change it to `https://badgebudget.com/index.html?cb=N`.
- **Anonymous users and the domain move:** checked 2026-09-02 — no device that saved a shift or
  completed setup without also signing in, so nobody lost data. Every phone did mint a fresh `anon_id`
  on the new origin, so distinct-device counts are inflated across the cutover.
- **Feedback → email** (Resend Edge Function + DB webhook on `feedback` INSERT): blocked on the owner's
  `re_...` key + destination address. Spec in `BACKLOG.md` → Blocked.
- **Second Supabase project for dev/test** (free plan allows two) so audits and migrations stop
  touching real data. `BACKLOG.md` → Needs a dedicated session.
- **Commit the harness and add a CI job** (`node scripts/test_groom_seed.mjs` + a Babel parse of the
  JSX block) so a syntax error can't ship; pin the four actions to SHAs and `.mcp.json` off `@latest`.
- **Capture `user_data`/`feedback`/`events` DDL + RLS** as `supabase/migrations/000_core.sql`.
- **Council rerun** (owner's standing request) — last full run 2026-07-30, `docs/history.md`.
- **Parked engineering** (calendar memoization + virtualization; sync content-equality
  canonicalization — `user_data.data` is `jsonb`, so canonicalize key order before comparing;
  backdrop-filter perf; poster_key rotation; swap handoff redesign): `BACKLOG.md` → Needs a
  dedicated session.
