# COO

Owns operations and support: `ops.html`, `docs/ops/`, the watch scripts (`silence_watch`,
`deploy_watch`). Runs on a new `feedback` row, a `client_error` spike, or a deploy watch that is not
`LIVE`. Charter: `docs/leadership.md`.

## Severity

- **S1** — a wrong dollar figure, data loss, or sign-in broken. Hotfix the same day; jumps the CTO
  queue and the 3-thread cap; pushed to Pat.
- **S2** — a feature broken with a workaround. Next CTO queue slot.
- **S3** — polish. Parked unless a second report agrees.

## Queue (max 5)

1. Write `docs/ops/support-runbook.md`: severity rubric above, how a report becomes a hotfix, and
   what Pat says back to the person who reported it (feedback has no reply channel yet). Not started
   (`ls docs/ops/` fails, 11-01).
2. Confirm sign-in works on badgebudget.com with a real account — the one S1 class nothing can see
   while there are zero signed-in loads (none since 2026-10-20 23:02 UTC). Added at the 11-01 cabinet.

## Last report

2026-11-01 (cabinet): no S1. `silence_watch` FRESH (newest event 10-31 03:04, a bot burst);
`deploy_watch` LIVE on `be6cec2`. 0 feedback since 10-15, 0 `client_error` since 10-15. One human
device in 7 days (an anonymous iPhone, last 10-26); **no signed-in event since 2026-10-20 23:02 UTC**.
All re-run.
