# Agent gateway — scope (2026-09-04)

Owner-directed scoping session, written the day the pattern lab shipped. This is a design document,
not a build log: nothing below is implemented. It records the thesis, what the current codebase
actually permits, the target shape, the mechanism that keeps the app and the agent surface in
lockstep, a sequence that can be executed one session at a time, and the places the idea is most
likely to be wrong. Facts about third-party platforms were checked on 2026-09-04 and are cited;
re-verify before building on them, this space moves monthly.

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
