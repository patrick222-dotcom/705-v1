# Risk & Compliance

Owns `privacy.html`, `terms.html`, `supabase/migrations/`, `scripts/ops_gate_probe.sql`. Runs when a
merged PR touches migrations, auth, RLS, the legal pages or the swap board. Charter:
`docs/leadership.md`. Legal text always goes to Pat.

## Queue (max 5)

1. T2 `legitimacy`: draft `terms.html` — lead term: estimates, not tax or payroll advice. (D4.)
2. T2 `legitimacy`: spec the in-app account-and-data deletion path (`user_data`, `events` by
   `anon_id`, `feedback`, `ical_subscriptions`, swap rows) and its probe. First piece found 11-01:
   "Clear all data" leaves `ical_subscriptions` behind — filed to the CTO as a code fix, so the
   privacy notice becomes true without a text change.
3. Standing: `security-00` (swap-board anonymity) blocks any re-promotion of the swap board. Still
   open; the hardening migration will be `008` (006 and 007 are taken).

## Last report

2026-11-01 (cabinet): T2 stalled 20 days, no terms or deletion spec on any branch. No trigger since
10-25 (#199–#205 touch no migration, auth, RLS or legal page); #201 tightens. Advisors: no ERRORs,
no `ops_*` function anon-executable; signed-in WARN count is 13 now, not the 11 in
`docs/project-notes.md` (the two `ops_device*` functions from 006 — expected, not re-recorded).
security-00, -08, -11 still open. Verified 11-01: `clearAll` in `index.html` deletes `user_data` only.
