-- 007_feedback_inbox_anon_id.sql — close the loop from a report to what the device actually did.
-- Applied to mnnlgcxnvodjwlhhiphq on 2026-09-16.
--
-- WHY. 005 put `anon_id` on `feedback`; 006 built `ops_device()` to render a device's trail. The
-- inbox sat between them returning eight columns, none of which was the join key — so the console
-- could show what a nurse SAID and, separately, what some device DID, with no way to get from one
-- to the other. docs/ops-console-scope.md called this out explicitly: "`ops_feedback_inbox()` does
-- not return `anon_id` yet; that belongs with 3b, when there is a drill-down worth linking to."
-- There is one now.
--
-- WHY A DROP. Postgres cannot change a function's OUT parameters with CREATE OR REPLACE — adding a
-- column to a `returns table (...)` is an error, not a replacement. The drop and recreate happen in
-- one transactional migration, so the function is never missing from a live console for longer than
-- this file takes to run. The body is otherwise IDENTICAL to 004's: same guard, same keyset
-- pagination, same eight columns in the same order, with `anon_id` appended last.
--
-- WHAT `anon_id` IS AND IS NOT. It is the same opaque per-device id `events.anon_id` carries — a
-- random uuid minted in localStorage, tied to a browser profile, not to a person and not to any
-- identity. It is already returned by `ops_device_list()`, so this exposes no new class of data to
-- the console; it makes an existing key reachable from a second surface. The line in
-- docs/ops-console-scope.md is unchanged and still holds: no `user_data`, no swap `poster_key`
-- linkage, no `ical_subscriptions`, and no raw `user_id` where a boolean answers the question —
-- `signed_in` stays a boolean here for exactly that reason.
--
-- IT ONLY WORKS FORWARD. `anon_id is null` means the row was submitted before 2026-09-14, when 005
-- shipped. All 11 rows in the table today are null, so on the day this migration lands the link is
-- live and has nothing to point at. That is not a bug to design around; it is the cost of a join
-- key added after the fact, already recorded in 005 and in CLAUDE.md, and the console says so in
-- words rather than rendering a dead control.
--
-- Reverting: re-run the 004 definition of this function verbatim. Nothing else changes.

drop function if exists public.ops_feedback_inbox(int, timestamptz, uuid);

create or replace function public.ops_feedback_inbox(
  p_limit int default 50,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id         uuid,
  created_at timestamptz,
  kind       text,
  message    text,
  contact    text,
  signed_in  boolean,
  segment    text,
  device     text,
  anon_id    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    f.id,
    f.created_at,
    f.kind,
    f.message,
    f.contact,
    (f.user_id is not null) as signed_in,
    case when f.user_id in (select a.uid from public.ops_admins a) then 'insider'::text else 'public'::text end,
    case
      when f.user_agent is null            then 'unknown'::text
      when f.user_agent ilike '%iphone%'   then 'iPhone'::text
      when f.user_agent ilike '%ipad%'     then 'iPad'::text
      when f.user_agent ilike '%android%'  then 'Android'::text
      else 'Desktop'::text
    end,
    f.anon_id
  from public.feedback f
  where p_before is null
     or (f.created_at, f.id) < (p_before, coalesce(p_before_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by f.created_at desc, f.id desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.ops_feedback_inbox(int, timestamptz, uuid) from public, anon;
grant execute on function public.ops_feedback_inbox(int, timestamptz, uuid) to authenticated;

comment on function public.ops_feedback_inbox(int, timestamptz, uuid) is
  'Ops console: newest-first feedback, keyset-paginated. Admin-gated by is_ops_admin(). Returns '
  'anon_id (007) so a report links to that device''s trail via ops_device(); never a raw user_id.';
