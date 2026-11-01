# CTO

Owns the build lane: `index.html` (only writer), `supabase/functions/`, `tests/`, the `BACKLOG.md`
queue. Charter: `docs/leadership.md`. The nightly loop is this seat's hands.

## Queue (max 5)

1. Gate check: a diff inside an `@core` region counts as number-moving unless `tests/equality.mjs`
   is green against it (pre-mortem failure mode 6). Changes `check_build.mjs`. Not built
   (`grep -c -iE 'equality|number-moving' scripts/check_build.mjs` → 0, 11-01).
2. T3 `personas` — rebase PR #191 onto the deploy branch: 4 conflicts (`tests/smoke.mjs`,
   `BACKLOG.md`, `CLAUDE.md`, `docs/cos/now.md`), renumber its smoke section past §54, re-run core,
   smoke and `tests/equality.mjs` against badgebudget.com, push to the same head, **do not merge**.
   Dedicated session (added at the 11-01 cabinet).
3. T1 `gateway` step 2 — dedicated session.
4. T2 `legitimacy` — "Clear all data" also deletes the `ical_subscriptions` row. Nightly-buildable;
   in `BACKLOG.md` → Queue (filed by Risk at the 11-01 cabinet).

## Last report

2026-11-01 (cabinet): build lane blocked on #191, which no longer merges (4 conflicts, 14 behind —
re-run `git merge-tree --write-tree --name-only origin/claude/migrate-to-github-deploy-3F5RD c41b8cc`).
T1 unchanged since 10-07. Nightly healthy (last commit `bb1d8f1`, 11-01) but nine nights of
gate-only builds because `## Queue` held nothing unblocked. Gate green, 19 of 19. All re-run.
