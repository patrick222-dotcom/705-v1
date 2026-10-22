# Now

Updated 2026-10-22 by the chief of staff (nightly pass). Charter: `docs/leadership.md`. Caps (enforced by
`scripts/cos_check.mjs`): 3 threads, 3 decisions.

## Threads

### T1 `gateway` — the MCP gateway
- **Seat:** CTO
- **Where:** step 1 of 8 done (the pay math is an importable module, 2026-10-07, #156). Steps 2–8
  not started; no MCP server exists. Plan: `docs/agent-gateway-scope.md` → *Revised sequence*.
- **Next:** step 2 — read-only gateway + Supabase OAuth on production (approved 2026-10-12;
  the rehearsal project is required from step 4, the first write).
- **Done when:** Pat's Claude connects and `get_paycheck` returns the same figure as the app's hero.
- **Waiting on:** a dedicated session.

### T2 `legitimacy` — terms and data deletion
- **Seat:** Risk & Compliance
- **Where:** `privacy.html` is live. No terms page. No in-app way to delete an account and its data
  (open since 2026-09-07, `BACKLOG.md` → *Transferability groundwork*).
- **Next:** draft `terms.html` (lead term: an estimate, not tax or payroll advice) and a spec for the
  in-app deletion path.
- **Done when:** terms live and linked from Settings; deletion works end to end in the harness;
  `privacy.html` says how to delete.
- **Waiting on:** the draft (Risk), then Pat's review — legal text never merges without him.

### T3 `personas` — beyond nurses
- **Seat:** CTO
- **Where:** sessions 1–3 of 6 shipped (onboarding v2, configurable work period, pay events #174).
  Session 4 is **built and open as PR #191**, waiting on Pat since 2026-10-20 (it moves figures) —
  **three nights** as of tonight.
- **Next:** Pat merges #191 (D3 below), then session 5 — the Law enforcement and Fire & EMS tiles.
- **Done when:** Law enforcement and Fire & EMS tiles are live with zero phantom overtime on the
  probed 12-hour schedules (session 5).
- **Waiting on:** a dedicated session.

## Needs Pat

**D3 — Merge PR #191, session 4 (dated pay items)? — opened 2026-10-20, no default.** It is the
owner tier: it moves dollar figures, so the loop may not merge it. **Three nights open**, which
is now exactly as long as the raise PR (D2) waited — and in that window she deleted 42 of her own
shifts. That is the cost of a slow read on this tier, not an argument to lower it. Nothing in the
PR has changed since it opened; it needs a yes or a no, not more review.

**CABINET MISSED (third night).** `docs/cos/brief.md` is **10.0 days** old and still reads *"No
cabinet has run yet. The first runs Sunday 2026-10-18."* Exactly **one** Sunday has passed without
a cabinet — 2026-10-18 — and the next is **2026-10-25**. (The 10-19 and 10-21 groom notes call
10-19 "the second Sunday"; 2026-10-19 was a Monday, so that count was wrong and is corrected here
rather than carried forward.) The nightly cannot clear this — writing the brief is the Sunday
cabinet pass's job — so the notify line carries it until a cabinet runs.

**D1 — Is `personas` the third thread? — DEFAULTED YES on 2026-10-19** by the nightly cos pass,
which is the rule D1 was opened with ("Default: yes. Defaults on 2026-10-19") and not a new call.
It is reversible: say the word and T3 is swapped for something else. Nothing else was open.

**D2 — Merge the raise PR (effective-dated rates)? — APPROVED by Pat on 2026-10-20** ("looks good,
merge and push"); merged as #187. Session 4 (dated pay items) is next on T3.

## Parked

See `docs/cos/inbox.md`. Everything not above lives there or in `BACKLOG.md`.
