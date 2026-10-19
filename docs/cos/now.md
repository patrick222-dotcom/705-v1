# Now

Updated 2026-10-19 by the chief of staff (nightly pass). Charter: `docs/leadership.md`. Caps (enforced by
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
- **Next:** session 4 — dated pay items. Kickoff prompt: `docs/session-2026-10-11-pay-events.md`.
- **Done when:** Law enforcement and Fire & EMS tiles are live with zero phantom overtime on the
  probed 12-hour schedules (session 5).
- **Waiting on:** a dedicated session.

## Needs Pat

_(none open)_

**D1 — Is `personas` the third thread? — DEFAULTED YES on 2026-10-19** by the nightly cos pass,
which is the rule D1 was opened with ("Default: yes. Defaults on 2026-10-19") and not a new call.
It is reversible: say the word and T3 is swapped for something else. Nothing else was open.

## Parked

See `docs/cos/inbox.md`. Everything not above lives there or in `BACKLOG.md`.
