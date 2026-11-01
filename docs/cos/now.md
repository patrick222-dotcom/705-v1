# Now

Updated 2026-11-01 by the chief of staff (Sunday cabinet). Charter: `docs/leadership.md`. Caps (enforced by
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
  **New, verified 11-01:** "Clear all data" deletes `user_data` but leaves the `ical_subscriptions`
  row (the feed URL) until the sign-in account is deleted — filed to `BACKLOG.md` → Queue as P1.
- **Next:** D4 — the nightly drafts `terms.html` (lead term: an estimate, not tax or payroll advice)
  and the deletion spec as PRs for Pat when `## Queue` is empty.
- **Done when:** terms live and linked from Settings; deletion works end to end in the harness;
  `privacy.html` says how to delete.
- **Waiting on:** D4, then Pat's review — legal text never merges without him.

### T3 `personas` — beyond nurses
- **Seat:** CTO
- **Where:** sessions 1–3 of 6 shipped. Session 4 is PR #191, head `c41b8cc` unchanged since
  2026-10-20, now **4 conflicts and 14 commits behind** (`git merge-tree --write-tree`, 11-01) —
  a yes cannot land as it stands.
- **Next:** rebase #191 (CTO dedicated session; no merge), Pat's yes (D3), then session 5 — the Law
  enforcement and Fire & EMS tiles.
- **Done when:** Law enforcement and Fire & EMS tiles are live with zero phantom overtime on the
  probed 12-hour schedules (session 5).
- **Waiting on:** the rebase, then D3.

## Needs Pat

**D3 — Merge PR #191, session 4 (dated pay items)? — opened 2026-10-20, no default.** Owner tier:
it moves dollar figures, so no agent may merge it. Twelve days open. Recommendation: **yes** — the
before → after card is in the PR body. Whatever the answer, it has to be rebased before it can
merge, and that rebase is the CTO's next dedicated session, so a yes becomes one click.

**D4 — When the nightly's `## Queue` is empty, may it draft T2 (`terms.html`, then the deletion
spec) as PRs for your review? — opened 2026-11-01, default YES on 2026-11-08.** Reversible. The
nightly has had nothing app-side to build for nine nights and T2 has had no trigger for twenty days;
this points the idle loop at the stalled thread. Nothing it drafts merges without you — legal text
is always your tier.

## Parked

See `docs/cos/inbox.md`. Everything not above lives there or in `BACKLOG.md`. Resolved decisions
(D1 defaulted 10-19, D2 approved 10-20) are in `docs/history.md`.
