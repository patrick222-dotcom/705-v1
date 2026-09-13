-- ops_gate_probe.sql — prove the ops console's guard actually refuses a non-admin.
--
-- WHY THIS FILE EXISTS, AND WHY THE OBVIOUS CHECK IS WORSE THAN NOTHING.
--
-- The Supabase SQL editor runs as `postgres`, a superuser. RLS does not apply to a superuser and
-- `auth.uid()` is null for one. So probing the gate from a default editor session gives you two
-- results that both look like answers and are neither:
--
--   select * from public.ops_admins;            -- returns all 3 rows. Looks like a leak. Isn't:
--                                                  superusers bypass RLS by definition.
--   select * from public.ops_feedback_inbox();  -- raises 42501. Looks like the gate working.
--                                                  Isn't: it refused a NULL uid, not a real user.
--
-- A guard that has only ever been tested by someone it lets through has not been tested — and one
-- tested by a superuser has not been tested either. So every probe below assumes an identity
-- first: a `request.jwt.claims` setting plus `set local role authenticated`, which is exactly how
-- PostgREST presents a signed-in user to Postgres.
--
-- HOW TO RUN: one block at a time, in the SQL editor. They are separate blocks on purpose —
-- several are expected to ERROR, and an error aborts the whole transaction it is in, so batching
-- them would hide every probe after the first failure. Every block ends in ROLLBACK; nothing here
-- writes anything.
--
-- PASS means every block matches its EXPECT line. One mismatch means do not deploy /ops.html.

-- ============================================================================
-- PROBE 1 — a signed-in nurse who is not on the allow-list.
-- The uid below is fabricated; that is the point. This is the case that matters.
-- ============================================================================

-- 1a  EXPECT: f  (a FALSE here is the gate saying no)
begin;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  set local role authenticated;
  select public.is_ops_admin() as should_be_false;
rollback;

-- 1b  EXPECT: ERROR "permission denied for table ops_admins" — or 0 rows.
--     Either is a pass (the grant is revoked AND the RLS policy set is empty, so both layers
--     refuse). A count of 3 is a FAIL: the allow-list would be readable by any signed-in user.
begin;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  set local role authenticated;
  select count(*) as should_be_zero_or_denied from public.ops_admins;
rollback;

-- 1c  EXPECT: ERROR 42501 "not authorized"
begin;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  set local role authenticated;
  select * from public.ops_feedback_inbox();
rollback;

-- 1d  EXPECT: ERROR 42501 "not authorized"
begin;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
  set local role authenticated;
  select public.ops_feedback_summary();
rollback;

-- ============================================================================
-- PROBE 2 — the anon role, i.e. anybody at all holding the public anon key.
-- These functions are granted to `authenticated` only, so this should fail one step earlier:
-- at EXECUTE permission, before the guard in the body is even reached.
-- ============================================================================

-- 2a  EXPECT: ERROR "permission denied for function ops_feedback_inbox"
begin;
  set local role anon;
  select * from public.ops_feedback_inbox();
rollback;

-- 2b  EXPECT: ERROR "permission denied for function ops_feedback_summary"
begin;
  set local role anon;
  select public.ops_feedback_summary();
rollback;

-- ============================================================================
-- PROBE 3 — the positive control. A gate that refuses everybody is not a working gate,
-- it is a broken one, and probes 1 and 2 cannot tell the two apart on their own.
-- Substitute Courtney's uid (e96ea234-…) and run it again before telling her it works.
-- ============================================================================

-- 3a  EXPECT: t
begin;
  set local request.jwt.claims = '{"sub":"d3d33371-dbf9-45e2-93f6-a212d859497f","role":"authenticated"}';
  set local role authenticated;
  select public.is_ops_admin() as should_be_true;
rollback;

-- 3b  EXPECT: the same count as `select count(*) from public.feedback` — every row, no more.
begin;
  set local request.jwt.claims = '{"sub":"d3d33371-dbf9-45e2-93f6-a212d859497f","role":"authenticated"}';
  set local role authenticated;
  select count(*) as should_equal_feedback_rowcount from public.ops_feedback_inbox(200);
rollback;

-- 3c  EXPECT: columns id, created_at, kind, message, contact, signed_in, segment, device —
--     and NOTHING else. If a user_id, a raw user_agent, or anything from user_data / the swap
--     board / ical_subscriptions appears here, the function has been widened past what
--     docs/ops-console-scope.md → "Where the line is" permits.
begin;
  set local request.jwt.claims = '{"sub":"d3d33371-dbf9-45e2-93f6-a212d859497f","role":"authenticated"}';
  set local role authenticated;
  select * from public.ops_feedback_inbox(3);
rollback;

-- ============================================================================
-- PROBE 4 — revocation. Removing someone from the allow-list must take effect immediately,
-- with no cache to wait on and no deploy to do. Rolled back, so nobody is actually removed.
-- ============================================================================

-- 4a  EXPECT: t, then f
begin;
  set local request.jwt.claims = '{"sub":"e96ea234-dffa-42f8-af99-ce4b04675fa5","role":"authenticated"}';
  set local role authenticated;
  select public.is_ops_admin() as before_removal;
  reset role;
  delete from public.ops_admins where uid = 'e96ea234-dffa-42f8-af99-ce4b04675fa5';
  set local role authenticated;
  select public.is_ops_admin() as after_removal;
rollback;   -- <- puts Courtney back. Do not swap this for COMMIT.
