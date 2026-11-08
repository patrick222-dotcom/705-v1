# Risk & Compliance

Owns `privacy.html`, `terms.html`, `supabase/migrations/`, `scripts/ops_gate_probe.sql`. Runs when a
merged PR touches migrations, auth, RLS, the legal pages or the swap board. Charter:
`docs/leadership.md`. Legal text always goes to Pat.

## Queue (max 5)

1. T2 `legitimacy`: draft `terms.html` — lead term: estimates, not tax or payroll advice. (D4.)
2. T2 `legitimacy`: **SPEC WRITTEN 2026-11-08** — `docs/data-deletion-spec.md` (nightly build,
   D4). Two security-definer functions, one migration, an eight-probe gate, and the build order.
   It found that **`privacy.html`'s emailed account-deletion promise is unkeepable today**:
   `events.user_id` and `feedback.user_id` are `ON DELETE NO ACTION` FKs to `auth.users`, and all
   4 accounts carry such rows (455 `events`, 17 `feedback`), so deleting any account raises 23503
   by every route including the dashboard button. Step 1 of the build order — the FK half of `008`,
   alone — fixes that live false statement with no app change. **Pat's tier** (it alters
   constraints on existing data). First piece of this item shipped 11-02: "Clear all data" now
   deletes the `ical_subscriptions` row too.
3. Standing: `security-00` (swap-board anonymity) blocks any re-promotion of the swap board. Still
   open; the hardening migration will be `008` (006 and 007 are taken).

## Last report

2026-11-08 (nightly): wrote `docs/data-deletion-spec.md` (item 2). Catalog read in full on the
production project — 14 `public` tables, 12 holding her data, **7 with no client DELETE policy and
4 of those deliberately so** (a swap post is withdrawn, never deleted). Two findings beyond the
spec's own scope: (a) the 23503 account-delete blocker above; (b) **`siri_tokens`, `ops_inbox` and
`app_config` are in production and in no file under `supabase/migrations/`** — they exist only in
`docs/siri-shortcut.md` and `docs/agent-gateway-scope.md` prose, so CLAUDE.md's "000→004 stands up
a fresh project" would stand up one missing three tables, two of them holding `user_id`. Filed in
`BACKLOG.md` as a P2 migration-capture job. No new deletion function exists today: all 14 `public`
functions were listed and none deletes on a user's behalf.

2026-11-01 (cabinet): T2 stalled 20 days, no terms or deletion spec on any branch. No trigger since
10-25 (#199–#205 touch no migration, auth, RLS or legal page); #201 tightens. Advisors: no ERRORs,
no `ops_*` function anon-executable; signed-in WARN count is 13 now, not the 11 in
`docs/project-notes.md` (the two `ops_device*` functions from 006 — expected, not re-recorded).
security-00, -08, -11 still open. Verified 11-01: `clearAll` in `index.html` deletes `user_data` only.
