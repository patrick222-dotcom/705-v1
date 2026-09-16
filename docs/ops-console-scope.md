# The ops console — a live support and monitoring surface

**Status:** phase 1 (the feedback inbox) is **built, applied and verified** — migration 004 is live
on `mnnlgcxnvodjwlhhiphq` and all ten gate probes pass (results below). **Phase 3a shipped
2026-09-14 (migration 005) and phase 3b shipped 2026-09-16 (migration 006) — see *Phase 3b, as
built* below.** Phases 2 and 4 are scoped, not built. **Date:** 2026-09-13, amended 2026-09-16.

This is the design record for `/ops.html`, a page Patrick and Courtney can open on a phone to see
what the app's users are actually experiencing — and, later, to answer "what's wrong with *this*
nurse's account" without running SQL.

---

## Why this exists, and why the nightly artifact isn't it

There is already a dashboard: `scripts/dashboard_snapshot.sql` → `dashboard_snapshot.mjs` → a
published Claude artifact, refreshed once per nightly run. It answers the question it was built
for — how is activation trending, where do anonymous visitors abandon, which instrumented events
have never fired — and it answers it well.

It cannot answer a different question: *what just happened*. The snapshot is baked into the
artifact's HTML as a `<script id="snapdata">` block, so worst case the number on screen is 23
hours old. And it can never be otherwise, because **a claude.ai artifact cannot fetch Supabase** —
the artifact CSP blocks all outbound fetch/XHR/WebSocket; only scripts from four allow-listed CDNs
load at all. An artifact can only ever display what something else pushed into it. That is a hard
ceiling, not a tuning problem.

Courtney is about to start handing invite links to her unit. The failure mode that matters is a
nurse texting her "it says $0" and Courtney having no way to look. That is a support tool, and it
has to be live.

## Two different products, kept apart on purpose

**Monitoring** is aggregate: is anything on fire, what is the funnel doing, did errors spike.
**Support** is singular: this specific person is stuck, what can I see about her.

Support pulls hard toward identifying individuals. `user_data` is somebody's real pay history;
the swap board's anonymity is a promise enforced in Postgres (Invariant 7) and audited 29/29 on
2026-07-30. A support tool that can look up a coworker to help her can also look up a coworker.
The line is drawn in *Where the line is*, below, and it is written into the SQL rather than left
to good intentions.

---

## The read path is the whole problem

`feedback` and `events` were built insert-only with **no select policy at all** (`000_core.sql`).
That is the property that makes a leaked anon key worth nothing: it can write a row and can never
read one back. Any live dashboard has to open the first hole in that wall. The design question is
not *whether* but *how small and how auditable*.

Three shapes were considered.

**Admin-scoped SELECT policies** on `events` and `feedback`, keyed to a uid allow-list. Simple,
and RLS does the enforcement. Rejected: it makes both tables readable-in-principle through
PostgREST, so every future policy edit is a chance to widen them by accident, and the blast radius
of a mistake is the whole table.

**An Edge Function holding the service-role key**, `verify_jwt` on, shaping JSON server-side.
Precedent exists (`ical-proxy`). Rejected: the service-role key bypasses RLS entirely, so a bug in
one function is total database access. A heavier hammer than this needs.

**Security-definer Postgres functions** — chosen. The functions read the tables as owner; the
tables keep zero select policies and stay exactly as unreadable through the API as they were
yesterday; the guard is an explicit `auth.uid()` check in the function body. This is the pattern
the swap board already uses as its anonymity boundary, so it is one established and audited
pattern rather than a second new one. Cost, named honestly: a `SECURITY DEFINER` body has no RLS
behind it, so **the check inside the function is the only line of defence**. Every ops function
therefore opens with the same guard, pins `search_path`, and is granted to `authenticated` only —
never `anon`, unlike the swap RPCs, because an ops console has no anonymous use case.

The functions live in `public` because PostgREST only exposes `public`. That is the same trade
`001_swap_board.sql` made, and it is exactly why the guard has to be airtight.

---

## Phase 1 — the wedge: a live feedback inbox

**Shipped in this change.** Reading feedback is currently a SQL session against the Management API.
The wedge turns it into a page.

`supabase/migrations/004_ops_console.sql` adds:

- `ops_admins` — the allow-list. Three rows: both owner accounts and Courtney. RLS on with **zero
  policies**, so the table is invisible through the API; only `is_ops_admin()` reads it, as owner.
  Seeded with the same three UUIDs `dashboard_snapshot.sql` already hardcodes as insiders — one
  list doing two jobs (who may read the console, whose test traffic to exclude from the funnel) so
  they cannot drift apart.
- `is_ops_admin()` — the guard, in one place.
- `ops_feedback_inbox(limit, before, before_id)` — newest-first, keyset-paginated.
- `ops_feedback_summary()` — the header counts.
- Four indexes. Not speculative: `feedback (created_at desc, id desc)` backs the inbox's exact
  order-by and cursor, and the two on `events` back access patterns `dashboard_snapshot.sql`
  already runs as sequential scans every night.

`ops.html` is the page. Deliberately plain — no React, no Babel, no build step, no fonts, nothing
third-party but supabase-js. `privacy.html` set that precedent and it is right here too: the
console has to work when the app is already misbehaving, so it must not share a failure mode with
the thing it is used to diagnose.

**Auth is borrowed, not implemented.** Same origin as the app means the same localStorage, and
supabase-js keys its session by project ref — so anyone already signed in at badgebudget.com is
already signed in at `/ops.html`. No sign-in button, no second auth path, and critically **no need
to add `/ops.html` to the Supabase OAuth redirect allow-list**. Signed out, the page says "sign in
at badgebudget.com and come back."

### What the inbox shows, and what it withholds

| Returned | Why |
|---|---|
| `message`, `contact` | The point of the tool. `contact` is what the nurse volunteered so someone could write back. |
| `kind` | Which tile was tapped. `null` passes through as null so the page can say "before the tiles shipped". |
| `signed_in` (boolean) | You cannot email a uuid, so the raw `user_id` buys a human nothing and never leaves the database. |
| `segment` | `insider` when it came from one of us testing, so builder noise is visibly separable from a real report. |
| `device` | A coarse label — "iPhone" is what you need to reproduce a bug. The 400-char user agent is a fingerprint. |

`page` is not returned at all: this is a single-page app, so it is always `/`. The useful version
is the `Where:` line the wrong-number scaffold already stamps into the message body.

### Publish set 4 → 5

`ops.html` joins `index.html`, `pdf.worker.min.js`, `privacy.html` and `CNAME`. That is an
Invariant 8 edit — `deploy.yml`, the `expected` array in `scripts/check_build.mjs`, and the
invariant's text in `CLAUDE.md`. The exact-set assertion exists in both directions specifically so
nothing ships publicly by accident; this is a door being walked through deliberately, so it comes
with new mechanical checks: `ops.html` must carry `noindex`, must not contain a `service_role`
string, must never assign `innerHTML`, and `index.html` must not link to it. All four were
negative-tested (confirmed to fail when each is broken), as was the publish-set entry.

`tests/smoke.mjs` section 7 asserts a signed-out visitor gets the gate, sees zero rows, sees zero
controls, and raises no page error. All five negative-tested — including by stubbing the RPC to
return a row, because in the sandbox Supabase is unreachable and an assertion that can never fire
is not an assertion.

---

## Phases 2–4 — scoped, not built

**Phase 2: the rest of the monitoring panels.** `ops_snapshot()` wrapping the existing 202 lines of
`dashboard_snapshot.sql` in the same admin guard — health and `client_error` rows, the activation
funnel with its cohort and insider splits, and swap-board health as **counts only** (groups,
members per group, posts, matches by state, age of open posts). The hard part is already written
and iterated on; this is mostly a wrapper.

**Phase 3b: the support drill-down.** — **SHIPPED 2026-09-16, migration 006. See below.**

> **Phase 3a — DONE 2026-09-14 (migration 005).** `feedback` had no `anon_id` column: it carried
> `user_id`, `page` and `user_agent`, nothing identifying the device, and `page` can't help because
> it is always `/` here. So an anonymous nurse's report could not be joined to her event trail —
> precisely the join the support tool exists to make. `feedback.anon_id` now mirrors
> `events.anon_id` exactly (same type, same 64-char cap, same nullability — columns that drift
> apart fail a join quietly rather than loudly), and `submitFeedback` sets it, which also covers the
> offline-queue flush since that path goes through the same function.
>
> **It only works forward, and the cost is already visible.** Rows submitted before 2026-09-14 are
> permanently unjoinable — there was never an id to backfill from. On the day it shipped that was
> all 10 existing rows, including one that arrived a few hours earlier: the first row ever tagged
> by the feedback tiles, and already untraceable. `anon_id is null` therefore reads as "before
> 2026-09-14", the same way `kind is null` reads as "before the tiles".
>
> No index, deliberately: 004 justified each of its four by naming a query that already ran, and
> nothing queries this column yet — phase 3b's lookup goes the other way (a row's own `anon_id`,
> then `idx_events_anon`). It comes with 3b, when "every report from this device" is a real query.

**Phase 4: triage state.** An inbox becomes a tool when rows can be marked handled. That needs a
write path and a column, and a write path into `feedback` is a bigger decision than a read one —
so it is deliberately last.

## Phase 3b, as built (2026-09-16)

**What it answers that nothing could before:** every touch point for one device, where that device
stopped, and whether the same device came back and stopped again — for visitors who never signed
up, which is all of them but four.

`supabase/migrations/006_ops_device_trail.sql` adds two functions, same pattern as 004
(`security definer`, `is_ops_admin()` as the first statement, `search_path` pinned empty,
`authenticated` only, never `anon`):

- **`ops_device_list(limit, include_synthetic)`** — one row per `anon_id`, newest activity first.
  `visits` (app_open count) and `days` (distinct calendar days) are the two that carry the weight:
  with no account for most visitors, `days > 1` is the *only* evidence a second visit exists.
  Also `stalled_at` (the last event name recorded — with `session_end` shipping alongside, that is
  the abandonment point), `ob`, `setup`, `signed_in`, `feedback_n`, `errors`, `segment`, `device`.
- **`ops_device(anon_id, limit)`** — that device's trail, with a `session_no` derived from a
  30-minute gap. The grouping *is* the answer to "did she come back and give up again": each block
  is one visit and the last line of each block is how that visit ended. Sessionisation is inference,
  not recorded fact — there is no session id on the row, and a gap rule buys nearly all of it.

`ops.html` gains a **Devices** tab beside Feedback, and a trail view behind each card. The page
stayed plain — no framework, no innerHTML, every value still reaching the DOM through `textContent`.
`client_error` payloads render inline in the trail (already money-redacted on the device), so a
support question no longer needs a SQL session.

**`synthetic`, and why history was not deleted.** `tests/harness.mjs` rewrote the five CDN script
tags but never `SUPABASE_URL`, so every CI smoke run on a GitHub runner inserted real rows into
production `events` under a fresh `anon_id` — **291 rows across 251 devices, 232 of them a single
event, first seen 2026-09-07**, the day `ci.yml` was added and CI became a required check. They are
identified by the internally inconsistent pair `iPhone OS 15_0` + `Version/18.0` that Playwright's
pinned iPhone 13 profile emits and no real iPhone does; matching a WebKit build number instead is a
mistake this file made in its first draft, because `AppleWebKit/605.1.15` is on every genuine iPhone
in the table and the build number I first reached for appears in zero rows, so the flag classified
nothing at all. The harness is contained in the same change; `ops_device_list()` flags those rows rather
than removing them, and hides them unless the console's "Show test traffic" toggle asks. Deleting
would have destroyed the evidence of how long it ran.

**`props` is returned verbatim, and that is the one judgement call in 006.** It is safe because
`track()` has never been allowed to carry a wage or goal figure, `client_error` goes through
`redactMoney()` on the device, and `session_end` carries a shift COUNT rather than an amount. If
that ever stops being true, `ops_device()` is the function that leaks it.

**No new indexes.** 004 justified each of its four by naming a query that already ran.
`idx_events_anon` backs the trail lookup; the device roll-up is a full scan over ~900 rows.

**Gate probes (2026-09-16), all six pass:**

| # | Probe | Expected | Result |
|---|---|---|---|
| 1 | `ops_device_list()` as a signed-in non-admin | 42501 | **ERROR 42501: not authorized** |
| 2 | `ops_device()` as a signed-in non-admin | 42501 | **ERROR 42501: not authorized** |
| 3 | `ops_device_list()` as `anon` | denied at EXECUTE | **permission denied for function** |
| 4 | `ops_device()` as `anon` | denied at EXECUTE | **permission denied for function** |
| 5 | both over the real REST API with the **public anon key** | 42501 | **42501 both** |
| 6 | `events` / `feedback` still unreadable with that key | 42501 | **42501 both** |

Probes 5 and 6 were run over the deployed network with the exact key `index.html` ships, not
simulated with `set local role` — the same discipline 004 used, and for the same reason.

## The gate, as actually verified (2026-09-13)

Migration 004 applied clean. `scripts/ops_gate_probe.sql` run in full against the live project —
every block rolled back, nothing written:

| # | Probe | Expected | Result |
|---|---|---|---|
| 1a | `is_ops_admin()` as a signed-in non-admin | false | **false** |
| 1b | `select from ops_admins` as a non-admin | denied or 0 rows | **ERROR: permission denied for table ops_admins** |
| 1c | `ops_feedback_inbox()` as a non-admin | 42501 | **ERROR 42501: not authorized** |
| 1d | `ops_feedback_summary()` as a non-admin | 42501 | **ERROR 42501: not authorized** |
| 2a | `ops_feedback_inbox()` as `anon` | denied at EXECUTE | **ERROR: permission denied for function** |
| 2b | `ops_feedback_summary()` as `anon` | denied at EXECUTE | **ERROR: permission denied for function** |
| 3a | `is_ops_admin()` as the owner | true | **true**, 9 of 9 rows visible |
| 3b | `is_ops_admin()` as Courtney | true | **true**, 9 of 9 rows visible |
| 3c | declared return columns | the 8 promised, no more | **id, created_at, kind, message, contact, signed_in, segment, device** |
| 4 | revocation takes effect immediately | true → false | **true → false**, no cache, no deploy |

### Verified over the real network, not just simulated

The probes above use `set local role authenticated`, which is the right simulation of how PostgREST
presents a caller — but it is a simulation. The deployed REST API was therefore hit directly with
the **public anon key**, exactly what any visitor to badgebudget.com holds, after the deploy:

```
GET  /rest/v1/feedback            -> 42501 permission denied for table feedback
GET  /rest/v1/events              -> 42501 permission denied for table events
GET  /rest/v1/ops_admins          -> 42501 permission denied for table ops_admins
GET  /rest/v1/user_data           -> []          (policy is scoped to auth.uid(), null for anon)
POST /rest/v1/rpc/ops_feedback_inbox   -> 42501 permission denied for function
POST /rest/v1/rpc/ops_feedback_summary -> 42501 permission denied for function
POST /rest/v1/rpc/is_ops_admin         -> 42501 permission denied for function
```

**Known gap in this verification:** the production page was never rendered in a real browser from
the build container — its egress relay resets Chromium's TLS tunnel, so `page.goto` cannot reach
badgebudget.com from here (curl can; Chromium cannot). What stands in for it: the deployed bytes
were diffed against the branch and are byte-identical to the file that passes all five signed-out
gate assertions in `tests/smoke.mjs` section 7, and the database side was probed independently both
ways above. The untested leg is the RPC round-trip from a signed-in browser, which is worth one
manual look on a phone before handing the URL to anyone.

**The best result was an error I did not plan for.** Probe 3 initially failed with *permission denied
for table feedback* — as the owner, on the allow-list. That is the design working: an ops admin
cannot read `feedback` directly at all. The function is the only door, and being on the allow-list
does not open the table, only the door. Confirmed after the fact: `feedback` and `events` each still
carry **zero** SELECT policies, and `feedback` still has exactly one policy, the original
`INSERT: anyone can submit feedback`.

All three functions are `SECURITY DEFINER` with `search_path=""` and are executable by
`authenticated` and `service_role` only — **not `anon`, and not `public`**.

**Advisor delta.** No ERRORs. The three new functions appear under the *signed-in* security-definer
WARN (11 now: the 8 swap RPCs plus these three) and — unlike the swap RPCs — under **none** of the 8
`anon`-executable WARNs. One new INFO: `ops_admins` has RLS enabled with no policy. That is the
design, not a defect: the table is meant to be invisible through the API and readable only by
`is_ops_admin()` running as owner. Expect it to stay, and don't "fix" it by adding a policy.

## Where the line is

Written down now, in the doc and in the SQL, rather than defended case-by-case later.

**The console may show:** feedback content and the contact the nurse volunteered; coarse device
type; aggregate counts; a device's own event trail and errors; swap-board counts.

**The console may never show:** anything from `user_data` — shifts, rates, goals, pay history, in
any form, aggregate or not; anything joining a swap `poster_key` to a person, or any two swap
posts to each other as the same person; anything from `ical_subscriptions` beyond a count, not
even a URL prefix (Invariant 13 — that address is a bearer credential); a raw `user_id` where a
boolean answers the question.

There is no code path in `004_ops_console.sql` that could return any of these. Adding one should
require re-reading this section and saying why.

## What the owner has to do

1. **Apply `004_ops_console.sql`** to project `mnnlgcxnvodjwlhhiphq`. Additive — a new table, two
   new functions, one helper, four indexes. It changes no existing policy and touches no existing
   column. Reverting is dropping the functions and the table.
2. **Verify the gate actually gates** — run `scripts/ops_gate_probe.sql`, one block at a time.
   A security-definer guard that has only ever been tested by someone it lets through has not been
   tested; one tested from the SQL editor's default session has not been tested either, because
   that session is a superuser with a null `auth.uid()` and both of the obvious probes return
   misleading answers. The file assumes a real identity first (`request.jwt.claims` +
   `set local role authenticated`, exactly how PostgREST presents a signed-in user), and covers the
   non-admin, the anon role, revocation, and the positive control — a gate that refuses everybody
   is broken too, and the negative probes alone cannot tell the two apart.
3. **Deploy**, then confirm `https://badgebudget.com/ops.html?cb=N` shows the sign-in gate in a
   private window and the inbox when signed in.

## Open questions

- **Does the nightly artifact survive?** Once `ops_snapshot()` exists, the live page can compute
  trends too — `events` *is* the history. The artifact's only remaining advantage is being readable
  without signing in. The recommendation is to keep it running as an archival record and stop
  investing in it, rather than maintaining two surfaces that answer the same questions.
- **Is `ops_admins` the right shape at four people?** It is a table so Courtney can be added
  without a migration. If the list ever grows past a handful, the allow-list stops being the
  boundary and roles start being the boundary.
- **Should errors push rather than pull?** A `client_error` spike is the one thing worth waking
  somebody for, and a polled page only helps someone already looking at it.
