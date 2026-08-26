-- 002_ical_subscription.sql — storage for a nurse's auto-sync calendar feed.
--
-- WHY A SEPARATE TABLE (not the user_data JSON blob): a secret iCal address is a BEARER CREDENTIAL —
-- anyone holding it can read that calendar forever. The user_data blob is exported by "Export data",
-- mirrored to localStorage, and echoed through the 15s sync poll, so a secret must never live there.
-- This table is owner-only via RLS, is never selected by analytics/events, and the client only ever
-- reads it back for the signed-in owner.
--
-- Apply with: supabase db push  (or run this SQL via the Management API after review).

create table if not exists public.ical_subscriptions (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  ical_url    text not null check (char_length(ical_url) between 12 and 2048),
  provider    text,                       -- 'google' | 'nursegrid' | null (informational only)
  last_synced timestamptz,                -- client stamps this after a successful sync
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.ical_subscriptions enable row level security;

-- Per-command owner-only policies, subselect form (matches user_data; the performance advisor
-- prefers `(select auth.uid())` so the auth lookup is evaluated once per statement).
create policy ical_sub_select on public.ical_subscriptions
  for select using ((select auth.uid()) = user_id);
create policy ical_sub_insert on public.ical_subscriptions
  for insert with check ((select auth.uid()) = user_id);
create policy ical_sub_update on public.ical_subscriptions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy ical_sub_delete on public.ical_subscriptions
  for delete using ((select auth.uid()) = user_id);

-- anon must never touch this table; authenticated is gated to their own row by the policies above.
revoke all on public.ical_subscriptions from anon;
grant select, insert, update, delete on public.ical_subscriptions to authenticated;
