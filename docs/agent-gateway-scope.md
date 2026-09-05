# Agent gateway — scope (2026-09-04)

Owner-directed scoping session, written the day the pattern lab shipped. This is a design document,
not a build log: Path A (the MCP gateway, everything up to "First session, concretely") is
unimplemented. **Path B** at the end of this document (added 2026-09-05) is the near-term bridge — a
Siri Shortcut writing to an ops inbox the app confirms — and its Session A shipped the same day (see
*As built* there). It records the thesis, what the current codebase actually permits, the target
shape, the mechanism that keeps the app and the agent surface in lockstep, a sequence that can be
executed one session at a time, and the places the idea is most likely to be wrong. Facts about
third-party platforms were checked on 2026-09-04 and are cited; re-verify before building on them,
this space moves monthly.

## The thesis, restated as a constraint

BadgeBudget stops being "an app with an AI feature" and becomes one domain with two surfaces. The
UI and the agent connection are peers over the same capability set. A nurse logs a shift in the
app on the unit, then asks Claude on the train home what the paycheck looks like, then tells Claude
to put next month's rotation on the calendar, then opens the app and it is there. Neither surface
is the "real" one. Any capability added to one exists on the other the same day, because the
mechanism makes it so rather than because someone remembered.

The owner's comparison is the "requires desktop" wall: software that ships a mobile app which
punts every hard feature to the browser. The equivalent failure here is an agent surface that can
read but not write, or an app that gains features the agent never learns about. The design goal is
to make that failure structurally hard to commit.

## What the research changed

Three findings materially affect the plan. All checked 2026-09-04.

**The mobile custom-connector gap is closed for use, open only for configuration.** Remote MCP
custom connectors are configured on claude.ai and are then brokered through the account, so they
work in the mobile apps; the only thing a phone cannot do is *add* a server. That removes the
reason the owner had been deferring the home-server play: a nurse configures the connector once
on the web and uses it from her phone from then on. Sources: the Anthropic help-center article on
custom connectors ([support.claude.com/…/11175166](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp))
and a community write-up of the mobile flow
([dev.to](https://dev.to/zhizhiarv/how-to-set-up-remote-mcp-on-claude-iosandroid-mobile-apps-3ce3)).
Free plans get one connector; Pro and up are unrestricted.

**Supabase Auth is now an OAuth 2.1 authorization server built for exactly this.** Public beta
since November 2025: discovery metadata at
`https://<ref>.supabase.co/.well-known/oauth-authorization-server/auth/v1`, dynamic client
registration switchable in the dashboard, PKCE mandatory, and the tokens it issues are ordinary
Supabase access tokens, so **the existing RLS policies apply to the agent unchanged**. That is the
single most important fact in this document: the agent is the user, at the database, with no new
trust boundary. Sources: [OAuth 2.1 Server docs](https://supabase.com/docs/guides/auth/oauth-server),
[MCP authentication guide](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication),
[launch post](https://supabase.com/blog/oauth2-provider).

**Edge Functions host MCP servers over streamable HTTP with the official SDK.** The Supabase guide
uses `@modelcontextprotocol/sdk` with `WebStandardStreamableHTTPServerTransport` behind Hono, SSE
responses, deployed with the CLI. The guide's own auth story says "coming soon" and deploys with
`--no-verify-jwt`, but we do not need their auth layer: the function validates the bearer token
against the project's JWKS itself and builds a per-request supabase-js client with that token,
which is the same pattern `ical-proxy` already uses with `verify_jwt` on. Sources:
[Deploy MCP servers](https://supabase.com/docs/guides/ai-tools/byo-mcp),
[mcp-lite example](https://supabase.com/docs/guides/functions/examples/mcp-server-mcp-lite).

One caution from the spec side. The MCP specification's current stable revision is **2026-07-28**:
stateless request/response, method and tool names in `Mcp-Method` / `Mcp-Name` headers, Client ID
Metadata Documents (CIMD) replacing dynamic client registration, RFC 9207 issuer validation, and
multi-round-trip requests for in-call confirmations
([spec blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). Supabase's OAuth server is
DCR-based today and has an open discussion about CIMD
([discussion #41695](https://github.com/orgs/supabase/discussions/41695)). Claude's clients
negotiate protocol versions, so DCR still works, but build the gateway stateless from day one and
expect to flip the registration mode when Supabase ships CIMD. Do not design anything that depends
on sessions.

## What the codebase permits today

Read before designing, because two facts about the current app dominate everything downstream.

**The domain logic is trapped in the page.** Everything lives in `index.html` (5,405 lines) and
is transformed by Babel in the browser. The pure functions the gateway needs already exist and are
already pure: `sanitizeData`, `shiftGross`, `hourlyRate`, `computeNet`, `patternMetrics`,
`planPatternApply`, `icsPlanFromExisting`, `computeSwapSuggestions`, `periodStartOf`. But there is
no way to `import` them from a Deno function. Today the only way an agent could price a shift is
to reimplement the wage math, which is precisely the drift this whole effort exists to prevent.
The pattern-lab work already moved the tax model into a shared function for the *same reason
inside one file*; the gateway is the same move across a process boundary.

**The data model is one JSON blob per user, overwritten whole.** `user_data` holds
`{user_id, data, updated_at}`; the app serializes its entire state and upserts it 500 ms after any
change, and polls every 15 s to pull other devices' writes. Writes are last-writer-wins with no
version. That is survivable for one nurse on two devices because the writer is always a human
typing slowly. It is not survivable once an agent can write: Claude adds twelve shifts while the
app has a debounced save pending, and one side silently erases the other. This is the "version
control issue" the owner named, and it is in the data before it is in the code.

The swap board is the counter-example already in the repo: proper tables, per-command RLS,
security-definer RPCs, column-level grants for anonymity. That is the shape the rest of the data
needs to grow toward, without a big-bang migration of live wage data.

## Target shape

Five layers, bottom up. Each is independently shippable and each is useful before the next.

### 1. Domain core as a real module

Move the pure functions out of `index.html` into `core/*.js` as plain ES modules with no DOM, no
React, no Supabase. `index.html` keeps shipping as one file: a build script inlines the core into
the page at deploy time, so the *deployed artifact* stays single-file and the boot hardening, SRI
and CSP story are untouched, while the *source* is finally modular. The Edge Function imports the
same files. One implementation of the money, two consumers.

This is the only place the plan breaks a stated principle ("no build step"), so be explicit about
the trade. What we lose: editing the live file directly in a browser tab. What we gain: the wage
core becomes unit-testable in Node in milliseconds without Playwright, the gateway cannot drift
from the app, and the nightly loop gets a fast pre-gate. The build is a forty-line script that
concatenates files and writes `index.html`; the deploy workflow runs it before the existing
`cp index.html _site/`. The Playwright gate keeps running against the built file exactly as today.

Gate for this layer: the built `index.html` is functionally identical to the current one. The
existing wage-equality harness assertion (hero, chips, breakdown, take-home byte-identical against
the deployed build) is the acceptance test, and it already exists.

### 2. Operations, not overwrites

Replace whole-blob writes with semantic operations behind one Postgres RPC:

```
apply_ops(ops jsonb, expected_version int) returns (data jsonb, version int)
```

`user_data` gains a `version` integer. The RPC runs as the caller (RLS applies), checks
`expected_version` matches, applies each op to the blob inside the transaction, bumps the version,
and returns the new state. A mismatch returns a conflict; the caller re-reads and retries. The op
vocabulary is the app's own handler list: `add_shift`, `remove_shift`, `set_day_events`,
`set_note`, `upsert_template`, `upsert_goal`, `delete_goal`, `upsert_pattern`, `delete_pattern`,
`apply_pattern`, `remove_pattern_shifts`, `set_pay_settings`. Op payloads are validated with the
same `sanitizeData` rules the client uses, run in the database, so a malformed agent write cannot
reach the blob any more than a malformed import can today.

The app changes from "serialize everything and upsert" to "send the op I just performed". Its
optimistic local state stays as is; the debounced save becomes a debounced op flush. The 15 s poll
is replaced by a Supabase Realtime subscription on the user's row (already listed as the future
upgrade in CLAUDE.md), so an agent write lands in the open app within a second. That subscription
is the async bridge between the two surfaces.

Keeping the blob as the storage unit is deliberate. It avoids migrating live wage history into
normalized tables, keeps export/import trivially compatible, and keeps `MAX_BLOB_BYTES` as the
free-tier guard. Normalizing shifts into a table is a later, optional step that the op layer makes
safe, because by then every writer already goes through one door.

### 3. The gateway

One Edge Function, `supabase/functions/mcp/`, an MCP server over streamable HTTP. It is an OAuth
resource server whose authorization server is the project's own Supabase Auth. It serves protected
resource metadata pointing at the Supabase discovery document, validates the bearer JWT against
the project JWKS, and for every call constructs a supabase-js client carrying that token, so every
read and write hits PostgREST as the user. There is no service key in the gateway. There is
nothing the agent can do that the user could not do in the app.

Tools mirror the op vocabulary one-to-one, plus reads:

| Tool | Maps to |
|---|---|
| `get_paycheck({period_start?})` | the hero + breakdown for a period, via `computeNet` |
| `list_shifts({from,to})`, `get_day({date})` | reads of the blob |
| `preview_shift({date, shiftType, hours, ...})` | the Add-Shift preview: gross, net, per-hour, goal fraction |
| `add_shift`, `remove_shift`, `set_day_events`, `set_note` | ops |
| `list_patterns`, `pattern_metrics({pattern})`, `apply_pattern`, `remove_pattern_shifts` | pattern lab, same pure functions |
| `list_goals`, `upsert_goal`, `delete_goal` | goals |
| `swap_board({group})`, `post_swap`, `withdraw_swap` | existing security-definer RPCs, anonymity preserved |
| `export_ics()` | resource, not tool: the same .ics the app emits |

Prompts ship alongside: "what is tonight worth", "compare these two rotations", "what did I make
last period". They are the agent-side equivalents of the dashboard cards.

Two constraints carry over verbatim from the app. The no-nudge rule: tools return facts and never
editorialize toward more shifts, and no prompt encourages picking up. The analytics rule: the
gateway logs `tool_called {name}` to `events`, counts only, never arguments.

### 4. The parity contract

This is the mechanism that answers "if I make an app update, the same CRUD is in the agent
tools." Discipline does not scale; a manifest does.

`core/ops.manifest.json` declares every operation and read: name, input schema, output schema,
which surfaces expose it, and its version. Three things are generated or checked from it:

- the `apply_ops` validator in Postgres refuses any op name not in the manifest;
- the gateway's tool list is generated from the manifest at build time, so a tool cannot exist
  without an op and an op cannot exist without a tool;
- a test in the gate asserts every op in the manifest has a handler in the app source and a tool in
  the gateway, and fails the build if either is missing.

Adding a feature then has one shape: add the pure function to `core/`, add the op to the manifest,
wire the UI handler, and the tool appears. The nightly loop can be taught that shape. Version
control stops being the hard part because there is exactly one place a capability is declared.

### 5. Repo shape and release

```
core/            pure domain (wage math, patterns, sanitizer, ics, swaps)   — Node tests
app/             UI source (the React in index.html, split by component)
build/           inline core + app -> index.html (the deployed artifact)
supabase/
  functions/mcp/ the gateway (Deno, imports ../../core)
  migrations/    003_versioned_ops.sql (version column + apply_ops)
tests/           the Playwright gate (committed, run in Actions on every PR)
docs/            this file, the state briefs
```

Two repo problems get fixed as part of this, because they are already costing time. First, the
repo has no `main`; the deploy branch is a `claude/` branch that lives in the workflow triggers by
accident. Create `main` from the deploy tip, add it to the trigger first, remove the old branch
second (never the same commit). Second, the gate lives in scratchpads and is unreproducible from
the repo, which the state brief already flagged. Commit it under `tests/` and run it in Actions on
pull requests, so the "123/123" claims become checks a reviewer can see.

The manifest carries a version. Ops are additive only; a breaking change is a new op name. The app
and the gateway both pin the manifest version they were built from, and the gate refuses a deploy
where the two differ. That is the whole versioning story, and it is enough at this scale.

## Sequence

Each step is one focused session, ships on its own, and has a gate. Order is chosen so the
riskiest change to live wage data (step 2) happens after the fast unit tests exist and before any
agent can write.

1. **Extract the core.** `core/` + build script + Node tests for the pure functions; deploy
   workflow runs the build. Zero behavior change. Gate: wage-equality assertion against the
   previous deploy; full Playwright gate green; SRI count 5.
2. **Versioned ops.** Migration 003, `apply_ops`, app writes through it, Realtime replaces the
   poll. Rehearse on the second Supabase project the backlog already wants (free tier allows two),
   then apply live. Gate: two-device concurrent-write test in the harness (two contexts, interleaved
   writes, no lost update); the 2026-08-23 upsert-bug scenario re-run.
3. **Read-only gateway.** The Edge Function with `get_paycheck`, `list_shifts`, `preview_shift`,
   `pattern_metrics`, `list_goals`, Supabase OAuth wired, dynamic registration on, connected as a
   Claude custom connector on the owner's account. Immediately useful, cannot corrupt anything.
   Gate: a curl/Inspector transcript of the OAuth flow and each tool; an RLS probe that a second
   user's token cannot read the first user's blob through the gateway.
4. **Write tools + manifest.** The remaining ops, the manifest, the generated tool list, the
   parity test in the gate. Gate: manifest parity test; an agent-adds-shift → app-shows-it
   end-to-end drive with Realtime.
5. **Dogfood.** Connector on the wife's account. The first real question is whether she reaches
   for Claude or the app for a given task, and the honest metric is the split of `tool_called` vs
   `shift_saved` events over a month.

Steps 1 and 3 can run in parallel if step 3 temporarily duplicates the read math, but that
duplication is exactly the thing the plan exists to end, so prefer 1 → 3.

## Where this is probably wrong

**The blob might not survive contact with an agent's write patterns.** An agent that calls
`add_shift` twelve times in a loop makes twelve versioned round-trips; a batch op fixes that, but
an agent that reads the whole blob to answer "what did I make in March" pays the full blob every
call. At a few KB per user this is nothing. If a user's history grows past a few hundred KB the
read tools should query a `shifts` table instead, which is the normalization step the op layer
makes possible later. Watch `MAX_BLOB_BYTES` warnings in the error log.

**OAuth consent is the user-facing seam and it is ugly today.** The consent screen still shows
`mnnlgcxnvodjwlhhiphq.supabase.co`, the same problem Google sign-in has, and the only fix is the
Pro plan custom domain. For the wife-and-friends audience this is tolerable; for a product it is
the first thing to fix, and it is a money decision not a code one.

**Supabase's DCR-based OAuth versus the spec's CIMD direction.** Works now; may need a
registration-mode change when Supabase and the Claude clients move. Cost is small if the gateway
is stateless, large if it is not. Build stateless.

**Swap board writes through an agent are a policy question, not a code one.** The anonymity model
was audited for a human clicking a UI. An agent posting on a nurse's behalf is the same identity at
the database, but it changes the social contract of the board ("did she post that or did her
assistant"). Ship swap *reads* in step 3, hold swap writes until the owner decides.

**The single-file principle is doing more work than it looks.** It is why the app boots on an
iPhone with a flaky connection and why the deploy is three files. The build step keeps the
artifact single-file, but it is a new place for a nightly run to break. Mitigation: the build is
deterministic and the built file is committed, so a failed build is visible as a diff, not as a
missing deploy.

**The thesis itself.** The bet is that nurses will prefer talking to their pay planner over
tapping it, at least for some tasks. Nothing in the analytics says that yet, because there is no
agent surface to measure. Step 3 is cheap enough to be the experiment: if `tool_called` stays at
zero for a month after the wife has the connector, the app was the product and the agent was the
owner's preference. That is a fine outcome to learn early.

## Decisions the owner has to make

- Build step, yes or no. Everything downstream assumes yes.
- Second Supabase project for rehearsal before touching `user_data` live (the backlog already asks).
- Swap-board writes via agent: allowed, or reads only until further notice.
- Whether to pay for the custom auth domain before the connector reaches anyone outside the family.
- Create `main` now, as part of step 1, or keep deferring.

## First session, concretely

Step 1 only. Create `core/` with `wage.js` (hourlyRate, shiftGross, computeNet), `patterns.js`,
`sanitize.js`, `ics.js`, `swaps.js`, `dates.js`, each exporting what `index.html` defines today,
byte-for-byte bodies. Write `build/inline.mjs` that reads `app/index.template.html`, replaces a
single marker with the concatenated core, and writes `index.html`. Add `tests/core.test.mjs` with
the seventeen pure-math assertions the pattern-lab gate already runs in-browser, ported to Node.
Change one line in `deploy.yml` to run the build before staging. Run the Playwright gate against
the built file; the wage-equality check must pass against the previous deploy. Commit the gate
under `tests/`. Open the PR. That session leaves the app unchanged for users and leaves the repo
ready for a gateway to import the money.

---

## Path B — the Siri Shortcut bridge (added 2026-09-05)

Owner's question that produced this: *"What if we made a link to a Siri Shortcut that we preconfigure
to take actions directly in the app, so it's not hinged on how to configure various LLM clients?"*
The answer is yes, on one condition that turns it from a detour into an early arrival of step 2: **the
Shortcut never writes to `user_data`.** It writes to an inbox; the app stays the only writer.

### Why this shape

The gateway plan (steps 1–5 above) parks writes behind versioned ops because the app's save path is
whole-blob, last-writer-wins, 500 ms debounced. A second writer can silently erase what the nurse just
typed. An inbox sidesteps that entirely: the Shortcut enqueues a *proposed* op, the app's existing 15 s
poll notices it, and the nurse confirms it in a sheet that applies the op through the exact handler a
finger tap would use. No concurrency, no version column, no wage math server-side.

It also shrinks the credential problem to something acceptable. A Shortcut can only persist a secret as
plaintext (a file in its iCloud folder), and Shortcuts get shared. So the Siri code is **write-only and
confirm-gated**: a leaked code can queue shifts the owner still has to approve; it can never read a pay
figure. Reads ("what's my paycheck?") stay out of this path on purpose and arrive with step 3, behind
OAuth, where the token is short-lived and the identity is real.

What it does **not** do: it is not a conversation. Siri prompts for each input, or takes one dictation;
there is no follow-up question. It is iOS-only (the unit is all iPhones today). It bridges *"how do I
connect an action"*, not *"how do I talk to my planner"*. The gateway remains the destination; this path
builds its op vocabulary and its first real client.

### Shape

```
  Shortcut (phone) ── POST {code, op | transcript} ──▶ Edge Function `siri-ingest`
                                                          │ hash(code) → siri_tokens → user_id
                                                          │ validate op against the allowlist
                                                          │ (dictation: Claude parses → ops, same validation)
                                                          ▼
                                                     ops_inbox (pending)
                                                          │
  app (already polling every 15 s) ◀──────────────────────┘
      └─ "From Siri" confirm sheet: per-item Add / Skip → existing handlers → user_data
```

**Migration `003_siri_inbox.sql`.**

- `siri_tokens(id uuid pk, user_id uuid → auth.users on delete cascade, token_hash text unique,
  label text, created_at, last_used_at, revoked_at)`. RLS owner-only for `authenticated`
  (`user_id = (select auth.uid())`), no `anon` grants. The app stores only `sha256(code)`; the plaintext
  is shown once.
- `ops_inbox(id uuid pk, user_id uuid → auth.users, source text check in ('siri','ical','mcp'),
  ops jsonb, transcript text, status text default 'pending' check in ('pending','applied',
  'rejected','expired'), created_at, resolved_at)`. RLS: owner-only `select`/`update`/`delete` for
  `authenticated`; **no client `insert`** — rows are created only by the Edge Function with the
  service role after it has resolved the code to a user. Index on `(user_id, status)`.
- `transcript` is the nurse's own dictation, kept so the confirm sheet can say "Siri heard: …" and
  deleted with the row on apply/reject. It never goes to `events`.

**Edge Function `siri-ingest`** (`verify_jwt` **off** — callers hold a Siri code, not a JWT, so the
function is public and must defend itself):

1. Body `{code, mode:'form'|'dictation', op?, transcript?, today?, tz?}`. Hash the code, look it up,
   reject 401 if missing or revoked. Never log the code; never echo it.
2. Rate-limit: reject 429 if the user has more than 10 inbox rows in the last 60 s or more than 20
   pending. Expire pending rows older than 7 days on the way through.
3. `form` mode: validate `op` against the allowlist — `add_shift {date, shiftType, hours, start?}`,
   `add_day_event {date, kind, hours?}`, `set_note {date, text}` — same coercions as `sanitizeData`
   (finite positive hours ≤ 24, ISO date within ±400 days, enum shift types, note ≤ 500 chars).
   Anything else is 400.
4. `dictation` mode (second increment): call Claude with a JSON schema (tool use, forced) that returns
   `{ops:[…], unresolved?:string}` given the transcript, `today` and `tz`. Validate the result through
   the *same* allowlist; drop anything invalid; enqueue what survives. The model is a small fast one,
   chosen from the `claude-api` reference at build time, key in Supabase secrets. The transcript is
   the nurse's own words, so prompt-injection exposure is low, but the schema + allowlist mean the
   worst outcome of a bad parse is a wrong proposal she declines.
5. Insert one `ops_inbox` row (service role), `last_used_at = now()`, return
   `{ok:true, queued:n, summary:"Fri Sep 12 · Night · 12h"}` for the Shortcut to speak.

**App (`index.html`).**

- Settings → **SIRI** card (signed-in only — the inbox is per `user_id`): "Connect Siri" generates a
  code with WebCrypto (`BB-XXXX-XXXX-XXXX-XXXX`, ~80 bits), shows it once with Copy, inserts the hash
  into `siri_tokens`; lists codes with Revoke; a "Get the Shortcut" link to the iCloud URL
  (`SIRI_SHORTCUT_URL`, owner-provided after the Shortcut is built).
- Inbox: the existing 15 s `refetch` also selects pending `ops_inbox` rows for the signed-in user. If
  any, a **"From Siri"** sheet lists each proposed op in plain language ("Fri Sep 12 · Night · 12h",
  with "Siri heard: …" when a transcript exists) with **per-item Add / Skip** — a deliberate
  improvement on the iCal confirm step, which is all-or-nothing. Add applies through the existing
  Add-Shift save path (so sanitization, OT rules and the pay-type inference all run); Skip marks the
  row `rejected`. Nothing is ever applied silently.
- Analytics, coarse only: `siri_connected`, `siri_op_confirmed {n}`, `siri_op_rejected {n}`. Never the
  transcript, never amounts.
- Boot hardening, SRI and wage-core untouched; the inbox is additive UI over existing handlers.

**Invariant to add when it ships (Invariant 14):** *Siri codes are write-only and hashed at rest; the
inbox is the only table they can touch; the app remains the sole writer to `user_data`.*

### How it relates to the five steps

The op vocabulary the ingest function accepts (`add_shift`, `add_day_event`, `set_note`, …) **is the
ops manifest of step 4, written down for the first time and exercised by a real client.** When the MCP
gateway exists, its write tools emit the same ops — into this inbox while writes stay confirm-gated,
or into `apply_ops` once step 2 lands. The iCal "iOS Shortcuts push" alternative already in the
backlog is the same pipe with `Find Calendar Events` as the input action and `source:'ical'`. One
endpoint, three sources. Nothing here requires the build step, so it can run before step 1.

### Sequence

- **Session A — shipped 2026-09-05 (#70), see *As built* below.** Migration 003 (rehearse on the dev project if it exists by
  then, otherwise apply live via the Management API as 002 was), `siri-ingest` in `form` mode, the
  Settings SIRI card, the inbox confirm sheet, analytics, harness probes (token hash round-trip,
  401/429/400 paths, a seeded pending row renders the sheet, Add applies through the real handler,
  Skip marks rejected, wage-core equality untouched). Ships with the Shortcut link constant empty.
- **Owner (≈1 hour):** build the Shortcut from the spec below in the Shortcuts app, test against the
  live function with your own code, share → Copy iCloud Link, paste into `SIRI_SHORTCUT_URL` (one-line
  PR), send the link to Courtney.
- **Session B:** `dictation` mode (Claude parse, schema-validated), the dictation variant of the
  Shortcut, and the `siri_*` events review after a week of use.

### As built — Session A (2026-09-05, #70)

Shipped against the spec above on the day it was written. The deviations, all deliberate:

- **One row per op.** `ops_inbox` carries `op text`, `payload jsonb`, `summary text` and `token_id`
  instead of an `ops jsonb` array, because per-item Add / Skip needs a per-item `status` to write. A
  dictation that parses into three ops will insert three rows sharing one `transcript` (that column,
  the wider `source` check and the owner delete policy are migration 004, written but not yet applied).
- **`siri_tokens.code_hash`** is the spec's `token_hash` — the UI calls it a Siri code, so the column
  does too. Same SHA-256 of the canonical dashed string, agreed byte-for-byte by app and function.
- **Wire format.** The function accepts `op` as the spec's `{type, date, shiftType, hours, start?}`
  object (what the Shortcut's Dictionary builds) and, equally, a flat `{op:"add_shift", date, …}` or
  `{op, args:{…}}`, so a hand-built Shortcut cannot get it wrong. Friendly shift-type aliases ("Day",
  "Weekend night"), `hours` omitted → 12, `start` as `19:00` or `7:00 PM`, an ISO datetime truncated to
  its date. Success `{ok:true, queued:1, summary}`; errors `{ok:false, error, message}` with `error` ∈
  `invalid_code` (401) · `bad_op | bad_date | bad_hours | bad_shift_type | bad_start | bad_kind |
  bad_text | bad_json | bad_mode` (400) · `rate_limited | too_many_pending` (429) ·
  `mode_not_available` (501, dictation until Session B) · `method_not_allowed` (405) · `too_large`
  (413). `message` is safe for Siri to speak and never contains the code.
- **Note cap 240, not 500** — the app's `MAX_NOTE_LEN`; `saveDayShifts` slices to it, so 500 would
  accept text the Add step then silently truncates.
- **Analytics carry the op name:** `siri_op_confirmed {n, op}`, `siri_op_rejected {n, op}` — still
  never the payload, the note text or the summary.
- **Add resolves the pay type** with the pattern lab's `patternCellShiftType`, so "Night" on a Saturday
  lands as Weekend night when that differential is on; explicit weekend/holiday types are kept while
  active.
- **Verification.** Migration 003 applied live through the MCP (the first entry in
  `supabase_migrations`; 5 policies, column-level update grants, zero `anon` grants, advisors
  unchanged). Function proven with curl on a throwaway user (401 / 400 per field / 501 / 200 for all
  three ops and the nested wire format / 429 on a burst), then deleted. iPhone-13 gate 74/74 with the
  hero byte-identical to the previous deploy; the signed-in path was driven against an in-page
  Supabase stub, not a live account.

### The Shortcut, action by action (v1 — form)

Build in the Shortcuts app; name it **"Log a shift"** (the name is the Siri phrase). Keep every piece of
logic server-side so this artifact rarely changes — a changed Shortcut means a new link and everyone
re-adding it.

| # | Action | Configuration |
|---|---|---|
| 1 | Get File | Service: Shortcuts folder · Path `BadgeBudget/siri-code.txt` · Show Document Picker **off** · Error If Not Found **off** → variable `Code` |
| 2 | If | `Code` **has no value** |
| 3 | ↳ Ask for Input | Type Text · Prompt "Paste your BadgeBudget Siri code (open the app → Settings → Siri)" |
| 4 | ↳ Save File | Service: Shortcuts folder · Destination `BadgeBudget/siri-code.txt` · Overwrite **on** · Ask Where to Save **off** |
| 5 | ↳ Set Variable | `Code` ← Provided Input · **End If** |
| 6 | Ask for Input | Type **Date** · Prompt "Which day?" · Default Current Date → `Day` |
| 7 | Choose from Menu | Prompt "What kind of shift?" · items: `Day 12h`, `Night 12h`, `Day 8h`, `Night 8h`, `Other…` |
| 8 | ↳ each branch | two **Text** actions → Set Variable `Type` (`day` / `night`) and `Hours` (`12` / `8`). `Other…`: Ask for Input (Number) "How many hours?" → `Hours`; Choose from Menu "Day or night?" → `Type` · **End Menu** |
| 9 | Format Date | `Day` · Format **Custom** · `yyyy-MM-dd` → `DateKey` |
| 10 | Dictionary | `code`: Code · `mode`: `form` · `op`: {Dictionary} `type`: `add_shift`, `date`: DateKey, `shiftType`: Type, `hours`: Hours (Number) |
| 11 | Get Contents of URL | URL `https://mnnlgcxnvodjwlhhiphq.supabase.co/functions/v1/siri-ingest` · Method **POST** · Headers `Content-Type: application/json` · Request Body **JSON** = the Dictionary |
| 12 | Get Dictionary Value | key `ok` from Contents of URL → `OK` |
| 13 | If | `OK` **is** `true` → Get Dictionary Value `summary` → **Show Result** / **Speak Text**: "Queued: [summary]. Open BadgeBudget to confirm." |
| 14 | Otherwise | Get Dictionary Value `error` → Show Result "BadgeBudget: [error]". If `error` is `invalid_code`: **Delete Files** `BadgeBudget/siri-code.txt` (Ask Before Deleting **off**) so the next run re-prompts · **End If** |

Settings on the Shortcut: Show in Share Sheet off; add to Home Screen optional; map to the Action
Button if she wants one-press. Siri: "Hey Siri, log a shift" → steps 6–7 as spoken prompts.

**v2 — dictation** (Session B): replace 6–9 with **Dictate Text** (or accept **Shortcut Input** so Siri
passes the sentence) → `Transcript`; the Dictionary becomes `code`, `mode`: `dictation`, `transcript`,
`today`: Format Date(Current Date, `yyyy-MM-dd`), `tz`: Format Date(Current Date, `VV`) — verify on
device that `VV` yields an IANA zone id; fall back to a fixed `America/New_York` if not. The function
returns one summary line per parsed op; the confirm sheet in the app does the rest.

### Owner decisions for this path

- ~~Go / no-go on Path B ahead of step 1~~ — went; Session A shipped 2026-09-05.
- ~~Apply migration 003 live or wait for the rehearsal project~~ — applied live 2026-09-05 (tables were
  empty; advisors unchanged). Migration 004 (transcript, wider `source`, owner delete) is written and
  waits for an owner-approved apply.
- ~~Whether `add_day_event` and `set_note` ship in v1~~ — all three shipped in v1.
