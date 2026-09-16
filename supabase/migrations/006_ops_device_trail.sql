-- 006_ops_device_trail.sql — phase 3b: the support drill-down.
-- Applied to mnnlgcxnvodjwlhhiphq on 2026-09-16.
--
-- WHY. `events` has always held every touch point, keyed by a per-device `anon_id` that is
-- stable across visits and across sign-in. It has never been readable. The console shipped with
-- exactly two functions, both over `feedback`; nothing could render a trail, so "where did this
-- nurse give up, and did she come back and give up again?" was answerable only by hand-written
-- SQL against the Management API. These two functions are that answer.
--
-- SHAPE. Same pattern as 004, deliberately: security definer, `is_ops_admin()` as the first
-- statement, `search_path` pinned empty, granted to `authenticated` only and never to `anon`.
-- `events` and `feedback` keep ZERO select policies and stay exactly as unreadable through
-- PostgREST as they were before this file. The function is the only door.
--
-- WHAT IT MAY NOT SHOW (docs/ops-console-scope.md → Where the line is). Nothing from
-- `user_data` — no shift, rate, goal or pay figure in any form. Nothing joining a swap
-- `poster_key` to a person. Nothing from `ical_subscriptions`. No raw `user_id` where a boolean
-- answers the question. Read that section before adding a column here.
--
-- `props` is returned verbatim and that is the one judgement call in this file. It is safe
-- because `track()` has never been allowed to put a wage or goal figure in it, `client_error`
-- payloads go through `redactMoney()` first, and `session_end` carries a shift COUNT rather
-- than any amount. If that ever stops being true, this is the function that leaks it.
--
-- NO NEW INDEXES. 004 justified each of its four by naming a query that already ran.
-- `idx_events_anon` already backs the trail lookup and the device roll-up is a full scan over
-- ~900 rows. Revisit when the table is large enough for that to matter, not before.
--
-- Reverting: drop the two functions. Nothing else in this file changes any table or policy.

-- ---------------------------------------------------------------------------------------
-- ops_device_list() — every device that has ever touched the app, newest activity first.
--
-- One row per `anon_id`, which is one row per browser-profile, which is as close to "one
-- person" as an app with no accounts can honestly get (see the durability note in
-- docs/ops-console-scope.md — iOS evicts this after 7 idle days).
--
--   visits      — app_open count. 2+ means she came back.
--   days        — distinct calendar days seen. The retention number that actually matters.
--   stalled_at  — the LAST event name recorded. With `session_end` shipping alongside this
--                 migration that is the abandonment point; on rows predating it, it is simply
--                 the last thing she managed to do.
--   ob          — furthest onboarding step reached (0 welcome .. 4 done), null if never shown.
--   synthetic   — the test harness writing to production analytics. `tests/harness.mjs` rewrote
--                 the CDN script tags but not the Supabase URL, so every CI smoke run inserted
--                 real rows carrying Playwright's iPhone-13 user agent. The harness is fixed in
--                 the same change as this file; this flag exists to keep the ~270 rows it already
--                 wrote out of the way without deleting history. Excluded by default.
create or replace function public.ops_device_list(
  p_limit int default 100,
  p_include_synthetic boolean default false
)
returns table (
  anon_id     text,
  first_seen  timestamptz,
  last_seen   timestamptz,
  visits      bigint,
  days        bigint,
  events      bigint,
  stalled_at  text,
  ob          int,
  setup       boolean,
  signed_in   boolean,
  feedback_n  bigint,
  errors      bigint,
  segment     text,
  device      text,
  synthetic   boolean
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
  with d as (
    select
      e.anon_id as aid,
      min(e.created_at)                                              as first_seen,
      max(e.created_at)                                              as last_seen,
      count(*) filter (where e.name = 'app_open')                    as visits,
      count(distinct date_trunc('day', e.created_at))                as days,
      count(*)                                                       as events,
      max(case when e.name = 'ob_step'
               then (e.props ->> 'step')::int end)                   as ob,
      bool_or(e.name = 'setup_completed')                            as setup,
      bool_or(e.user_id is not null)                                 as signed_in,
      count(*) filter (where e.name = 'client_error')                as errors,
      bool_or(e.user_id in (select a.uid from public.ops_admins a))  as insider,
      (array_agg(e.user_agent order by e.created_at desc))[1]        as ua,
      (array_agg(e.name       order by e.created_at desc))[1]        as stalled_at
    from public.events e
    where e.anon_id is not null
    group by e.anon_id
  )
  select
    d.aid,
    d.first_seen,
    d.last_seen,
    d.visits,
    d.days,
    d.events,
    d.stalled_at,
    d.ob,
    coalesce(d.setup, false),
    coalesce(d.signed_in, false),
    (select count(*) from public.feedback f where f.anon_id = d.aid),
    d.errors,
    case when coalesce(d.insider, false) then 'insider'::text else 'public'::text end,
    case
      when d.ua is null                then 'unknown'::text
      when d.ua ilike '%iphone%'       then 'iPhone'::text
      when d.ua ilike '%ipad%'         then 'iPad'::text
      when d.ua ilike '%android%'      then 'Android'::text
      else 'Desktop'::text
    end,
    (d.ua like '%AppleWebKit/604.1.38%')
  from d
  where p_include_synthetic or d.ua is null or d.ua not like '%AppleWebKit/604.1.38%'
  order by d.last_seen desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

revoke all on function public.ops_device_list(int, boolean) from public, anon;
grant execute on function public.ops_device_list(int, boolean) to authenticated;

comment on function public.ops_device_list(int, boolean) is
  'Ops console: one row per device (anon_id) with visit/return counts and where it stopped. '
  'Admin-gated by is_ops_admin(). Returns no user_data and no raw user_id.';

-- ---------------------------------------------------------------------------------------
-- ops_device() — one device's full trail, split into visits.
--
-- `session_no` is the whole point. Events are sessionised by a 30-minute gap, so a device that
-- came back a week later and stalled in the same place reads as two numbered visits with two
-- endings, rather than one undifferentiated stream of rows. Thirty minutes is the ordinary web
-- analytics convention and is inference, not recorded fact — there is no session id on the row,
-- and adding one would buy little over the gap rule at this scale.
create or replace function public.ops_device(
  p_anon_id text,
  p_limit int default 500
)
returns table (
  session_no  bigint,
  created_at  timestamptz,
  name        text,
  props       jsonb,
  signed_in   boolean
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

  if p_anon_id is null or length(p_anon_id) = 0 then
    return;
  end if;

  return query
  with t as (
    select
      e.created_at,
      e.name,
      e.props,
      (e.user_id is not null) as signed_in,
      case
        when lag(e.created_at) over (order by e.created_at) is null                              then 1
        when e.created_at - lag(e.created_at) over (order by e.created_at) > interval '30 minutes' then 1
        else 0
      end as starts
    from public.events e
    where e.anon_id = p_anon_id
    order by e.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  )
  select
    sum(t.starts) over (order by t.created_at rows between unbounded preceding and current row),
    t.created_at,
    t.name,
    t.props,
    t.signed_in
  from t
  order by t.created_at;
end;
$$;

revoke all on function public.ops_device(text, int) from public, anon;
grant execute on function public.ops_device(text, int) to authenticated;

comment on function public.ops_device(text, int) is
  'Ops console: one device trail, sessionised on a 30-minute gap. Admin-gated by is_ops_admin(). '
  'Returns event props verbatim — those carry no wage figures by construction (see 006 header).';
