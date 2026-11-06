# Now

Updated 2026-11-06 by the chief of staff (nightly pass). Charter: `docs/leadership.md`. Caps (enforced by
`scripts/cos_check.mjs`): 3 threads, 3 decisions.

## Threads

### T1 `gateway` — the MCP gateway
- **Seat:** CTO
- **Where:** step 1 of 8 done (the pay math is an importable module, 2026-10-07, #156). Steps 2–8
  not started; no MCP server exists (`ls supabase/functions/`, 11-01). Plan:
  `docs/agent-gateway-scope.md` → *Revised sequence*.
- **Next:** step 2 — read-only gateway + Supabase OAuth on production (approved 2026-10-12;
  the rehearsal project is required from step 4, the first write).
- **Done when:** Pat's Claude connects and `get_paycheck` returns the same figure as the app's hero.
- **Waiting on:** a dedicated session.

### T2 `legitimacy` — terms and data deletion
- **Seat:** Risk & Compliance
- **Where:** `privacy.html` is live. No terms page, no deletion spec, on any branch (11-01). Stalled
  20 days: the seat runs only when a merge touches its files, and drafting is not a trigger.
  **The Risk seat's first find is FIXED and live, 11-02:** "Clear all data" used to leave the
  `ical_subscriptions` row (the feed URL, a bearer credential) behind — `clearAll` now deletes it
  before signing out, pinned by `tests/smoke.mjs` §56. The notice is true without touching its text.
  **`terms.html` is drafted, driven and OPEN for review as #209, 11-06** (nightly build; 16 assertions in
  `tests/smoke.mjs` §58). Ready, auto-merge OFF — legal text is Pat's tier. It cannot merge as it
  stands: three one-line changes listed in the PR body must land in the same merge, one of them
  `cp terms.html _site/` in `deploy.yml`, which agents cannot edit here.
- **Next:** Pat merges or closes #209 — and sooner rather than later, because it sits on
  the nightly's own working branch, which tomorrow's run force-pushes. Then the deletion spec as a
  doc PR (`docs/cos/seats/risk.md` item 2).
- **Done when:** terms live and linked from Settings; deletion works end to end in the harness;
  `privacy.html` says how to delete.
- **Waiting on:** Pat's review of #209 plus his three one-line changes; legal text never
  merges without him.

### T3 `personas` — beyond nurses
- **Seat:** CTO
- **Where:** sessions **1–4** of 6 shipped. **#191 merged and LIVE at `8e099cb`, verified 11-02**
  (`deploy_watch` → LIVE) — the twelve-day stall is over; equality re-read 34 identical / 0
  unintended / 5 of 5 named before the merge.
- **Next:** session 5 — the Law enforcement and Fire & EMS tiles. It is a **dedicated session**,
  not a nightly item: it moves dollar figures, so `wage-core` protocol and Pat's tier.
- **Done when:** Law enforcement and Fire & EMS tiles are live with zero phantom overtime on the
  probed 12-hour schedules (session 5).
- **Waiting on:** a dedicated session for session 5. Nothing else; zero open PRs (11-02).

## Needs Pat

**The terms PR, #209 (open 2026-11-06).** Review the text, then three one-line changes in the same merge:
`cp terms.html _site/` in `deploy.yml`; `terms.html` in the `expected` array of
`check_build.mjs`'s publish-set check; that file's self-containment clause extended to it.
Merging the `cp` alone turns the gate red, and merging the page without it ships a Settings link to
a 404. It also sits on the nightly's working branch, so tomorrow's run rewrites that branch.

Nothing else open. **D3 approved and D4 approved by Pat, 2026-11-01** ("go with your
recommendations") — recorded in `docs/history.md`.

## Parked

See `docs/cos/inbox.md`. Everything not above lives there or in `BACKLOG.md`. Resolved decisions
(D1 defaulted 10-19, D2 approved 10-20, D3 and D4 approved 11-01) are in `docs/history.md`.
