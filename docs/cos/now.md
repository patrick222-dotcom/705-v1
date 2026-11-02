# Now

Updated 2026-11-02 by the chief of staff (nightly pass). Charter: `docs/leadership.md`. Caps (enforced by
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
- **Next:** the nightly drafts `terms.html` (lead term: an estimate, not tax or payroll advice)
  and the deletion spec as PRs for Pat whenever `## Queue` has nothing unblocked (D4, approved
  2026-11-01).
- **Done when:** terms live and linked from Settings; deletion works end to end in the harness;
  `privacy.html` says how to delete.
- **Waiting on:** the nightly's `terms.html` draft — next in `## Queue` now that 11-02 cleared the
  item above it — then Pat's review; legal text never merges without him.

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

Nothing open. **D3 approved and D4 approved by Pat, 2026-11-01** ("go with your recommendations") —
recorded in `docs/history.md`.

## Parked

See `docs/cos/inbox.md`. Everything not above lives there or in `BACKLOG.md`. Resolved decisions
(D1 defaulted 10-19, D2 approved 10-20, D3 and D4 approved 11-01) are in `docs/history.md`.
