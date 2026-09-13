-- 004_ops_console.sql — the first read path into feedback, and the admin gate that guards it.
--
-- WHY THIS EXISTS. `feedback` and `events` were built insert-only with NO select policy at all
-- (see 000_core.sql). That is not an oversight, it is the property that makes a leaked anon key
-- worth nothing: the key can write a row and can never read one back. The ops console needs to
-- read feedback, so this migration opens the first hole in that wall — and the whole design goal
-- is to make the hole as small and as auditable as possible.
--
-- WHAT IT DELIBERATELY DOES NOT DO: it adds no select policy to `feedback` or `events`. Both
-- tables stay exactly as unreadable through PostgREST as they were yesterday. The read happens
-- only inside two SECURITY DEFINER functions that check the caller against an allow-list first —
-- the same pattern the swap board already uses as its anonymity boundary (001_swap_board.sql,
-- audited adversarially 29/29 on 2026-07-30). One established pattern, not a second one.
--
-- THE COST, NAMED: a SECURITY DEFINER function bypasses RLS on everything it touches, so the
-- auth check inside the body IS the security boundary. There is no second line of defence. Every
-- function here therefore starts with the same guard, pins `search_path`, and is granted to
-- `authenticated` only — never to `anon`, unlike the swap RPCs, because an ops console has no
-- anonymous use case. They live in `public` because PostgREST only exposes `public`; that is the
-- same trade 001 made, and it is why the guard has to be airtight.
--
-- Apply with: supabase db push  (or run this SQL via the Management API after review).
-- Reverting: drop the two functions, then is_ops_admin(), then the table. The indexes are
-- independently useful and can stay.

-- ============================================================================
-- ops_admins — who may read the console. Three rows, and it should stay small.
--
-- These are the same three UUIDs `scripts/dashboard_snapshot.sql` already hardcodes as the
-- "insider" list, which is not a coincidence: the people who may read the ops console and the
-- people whose own test traffic must be excluded from the funnel are the same people. One list,
-- two jobs, so they cannot drift apart.
-- ============================================================================
create table if not exists public.ops_admins (
  uid      uuid primary key references auth.users(id) on delete cascade,
  label    text,
  added_at timestamptz not null default now()
);

-- RLS on with ZERO policies: nothing reads this table through PostgREST, ever. The only reader is
-- is_ops_admin() below, which runs as owner and therefore bypasses RLS. Belt and braces, the
-- table-level grants Supabase hands out by default are revoked too — an empty policy set already
-- denies, but a future "add a policy for convenience" then still finds no grant behind it.
alter table public.ops_admins enable row level security;
revoke all on public.ops_admins from anon, authenticated;

comment on table public.ops_admins is
  'Allow-list for the ops console (/ops.html). Read only by is_ops_admin(); no RLS policy exists '
  'on purpose, so the table is invisible through the REST API. Same three UUIDs as the insider '
  'list in scripts/dashboard_snapshot.sql.';

insert into public.ops_admins (uid, label) values
  ('d3d33371-dbf9-45e2-93f6-a212d859497f', 'patrickguthrie222@gmail.com (owner)'),
  ('4b2cd4d1-8c81-4b25-aaad-fad2260acb76', 'pghawkins222@gmail.com (owner)'),
  ('e96ea234-dffa-42f8-af99-ce4b04675fa5', 'bagwellc0387@gmail.com (Courtney)')
on conflict (uid) do nothing;

-- ============================================================================
-- is_ops_admin() — the guard, in one place.
--
-- SECURITY DEFINER because ops_admins has no select policy, so a caller-rights function would
-- read zero rows and every admin would be told no. `(select auth.uid())` rather than a bare call
-- so the planner caches it. STABLE, not VOLATILE, so it can be inlined and is not re-evaluated
-- per row.
-- ============================================================================
create or replace function public.is_ops_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ops_admins where uid = (select auth.uid())
  );
$$;

revoke all on function public.is_ops_admin() from public, anon;
grant execute on function public.is_ops_admin() to authenticated;

comment on function public.is_ops_admin() is
  'True when the calling user is on the ops allow-list. The security boundary for every ops_* '
  'function — a SECURITY DEFINER body has no RLS behind it, so this check is the only thing '
  'standing between a signed-in nurse and the feedback table.';

-- ============================================================================
-- ops_feedback_inbox() — the wedge. Reading feedback is currently a SQL session; this makes it a
-- page Courtney can open on her phone.
--
-- WHAT IT RETURNS AND WHAT IT WITHHOLDS, deliberately:
--   message, contact  — the point of the tool. `contact` is what the nurse volunteered so someone
--                       could write back; withholding it would make the inbox unactionable.
--   kind              — which tile was tapped. null means "before the tiles shipped 2026-09-13"
--                       and is passed through as null rather than coerced, so the page can say so.
--   signed_in         — a boolean, NOT the user_id. The raw uuid buys a human nothing (you cannot
--                       email a uuid) and is an identifier, so it does not leave the database.
--   segment           — 'insider' when the row came from one of us testing, so builder noise is
--                       visibly separable from a real nurse's report.
--   device            — a coarse label, not the 400-char user agent. "iPhone" is what a person
--                       needs to reproduce a bug; the full UA string is a fingerprint.
--   (page is not returned at all — this is a single-page app, so it is always '/'. The useful
--    version is the `Where:` line the wrong-number scaffold stamps into the message itself.)
--
-- NEVER returned, and there is no code path here that could: anything from user_data, any swap
-- board identity, anything from ical_subscriptions. Those are Invariants 7 and 13 and they die
-- quietly if an ops function gets casually widened later.
--
-- Keyset pagination on (created_at, id) rather than OFFSET: O(1) at any depth, and the id
-- tiebreaker keeps the page boundary stable when two rows share a timestamp.
-- ============================================================================
create or replace function public.ops_feedback_inbox(
  p_limit     int         default 50,
  p_before    timestamptz default null,
  p_before_id uuid        default null
)
returns table (
  id         uuid,
  created_at timestamptz,
  kind       text,
  message    text,
  contact    text,
  signed_in  boolean,
  segment    text,
  device     text
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
    end
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
  'Ops console feedback inbox, newest first, keyset-paginated. Admin-only. Returns the message and '
  'the contact the nurse volunteered; withholds user_id, the raw user agent, and everything from '
  'user_data / the swap board / ical_subscriptions.';

-- ============================================================================
-- ops_feedback_summary() — the header numbers, so the page can say "4 total, 2 this week" without
-- pulling every row down to count them client-side.
-- ============================================================================
create or replace function public.ops_feedback_summary()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return json_build_object(
    'generated_at', now(),
    'total',        (select count(*) from public.feedback),
    'last_7d',      (select count(*) from public.feedback where created_at > now() - interval '7 days'),
    'last_24h',     (select count(*) from public.feedback where created_at > now() - interval '24 hours'),
    'newest_at',    (select max(created_at) from public.feedback),
    'by_kind',      (select coalesce(json_agg(x), '[]'::json) from (
                       select coalesce(kind, 'pre_tiles') as kind, count(*) as n
                       from public.feedback group by 1 order by 2 desc
                     ) x)
  );
end;
$$;

revoke all on function public.ops_feedback_summary() from public, anon;
grant execute on function public.ops_feedback_summary() to authenticated;

comment on function public.ops_feedback_summary() is
  'Ops console header counts for the feedback inbox. Admin-only. Aggregates only — no row content.';

-- ============================================================================
-- Indexes. `events` and `feedback` have had none since 000_core.sql. At 270 events that is
-- invisible; the point of adding them now is that the nightly dashboard snapshot ALREADY runs
-- these exact access patterns as sequential scans, and the console is about to run them on a
-- poll. Cheap now, and not speculative — every one of them backs a query that exists today.
-- ============================================================================

-- ops_feedback_inbox()'s order-by and keyset cursor, exactly.
create index if not exists idx_feedback_created_id
  on public.feedback (created_at desc, id desc);

-- dashboard_snapshot.sql groups events by anon_id in three separate CTEs, and the phase-2
-- per-device drill-down is a lookup on this column.
create index if not exists idx_events_anon
  on public.events (anon_id);

-- The adoption/funnel blocks filter by name and window by created_at.
create index if not exists idx_events_name_created
  on public.events (name, created_at desc);

-- feedback.user_id is a foreign key with no index; the segment join above uses it.
create index if not exists idx_feedback_user
  on public.feedback (user_id);

-- VERIFY THE GATE BEFORE TRUSTING IT: run `scripts/ops_gate_probe.sql`, one block at a time.
-- Do NOT just call these functions from the SQL editor and conclude anything: that session is
-- `postgres`, a superuser, so RLS does not apply and auth.uid() is null — ops_admins returns all
-- three rows (looks like a leak, isn't) and the RPCs raise 42501 (looks like the gate working,
-- but it refused a NULL uid, not a user). The probe file assumes a real identity first, covers
-- the anon role and revocation, and includes the positive control that tells a working gate
-- apart from one that refuses everybody.
