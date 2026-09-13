-- 000_core.sql — the three core tables that predate the swap board (001) and iCal feed (002).
--
-- WHY THIS FILE EXISTS: user_data / feedback / events were created by hand in the live project
-- long before migrations were kept in git, so until now they lived ONLY in production. This file
-- reconstructs them from the deployed schema (columns, constraints and RLS captured 2026-09-13) so
-- that:
--   1. a fresh Supabase project (e.g. a dev/test project) can be stood up with `supabase db push`
--      or by running 000 → 001 → 002 in order, and
--   2. the security model (row-level security) lives in version control, not just in the dashboard.
--
-- It is numbered 000 because these tables are the oldest. It is written idempotently
-- (`if not exists`, `drop policy if exists`) so it is safe to run against the live project too —
-- it will not clobber existing data. Apply with: supabase db push (or the Management API after review).
--
-- SECURITY MODEL, in one breath: user_data is private per-user (owner-only for every command);
-- feedback and events are INSERT-ONLY for anon + signed-in users and have NO select policy, so the
-- public anon key can write a row but can never read anyone's rows back — analytics and feedback are
-- unreadable to everyone except the owner via the dashboard/service role.

-- ============================================================================
-- user_data — one JSON blob per user (pay settings, shifts, goals, patterns, …).
-- Upserted on user_id; see Invariant 4 (the app MUST upsert with onConflict:'user_id').
-- ============================================================================
create table if not exists public.user_data (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null unique references auth.users(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_data enable row level security;

-- Owner-only for every command. `(select auth.uid())` (subselect form) is evaluated once per
-- statement — the performance advisor prefers it over a bare auth.uid() call per row.
drop policy if exists "Users can view own data"   on public.user_data;
drop policy if exists "Users can insert own data" on public.user_data;
drop policy if exists "Users can update own data" on public.user_data;
drop policy if exists "Users can delete own data" on public.user_data;
create policy "Users can view own data"   on public.user_data
  for select using ((select auth.uid()) = user_id);
create policy "Users can insert own data" on public.user_data
  for insert with check ((select auth.uid()) = user_id);
create policy "Users can update own data" on public.user_data
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete own data" on public.user_data
  for delete using ((select auth.uid()) = user_id);

-- ============================================================================
-- feedback — the 💬 widget. INSERT-ONLY for anon + authenticated; no select policy, so the anon
-- key can never read rows back. Owner reads via the dashboard / service role.
-- `page` + `user_agent` are captured for debugging and are disclosed in privacy.html.
-- ============================================================================
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  message    text not null check (char_length(message) between 1 and 4000),
  contact    text check (contact is null or char_length(contact) <= 200),
  user_id    uuid references auth.users(id) on delete set null,
  page       text check (page is null or char_length(page) <= 120),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400)
);

alter table public.feedback enable row level security;

drop policy if exists "anyone can submit feedback" on public.feedback;
create policy "anyone can submit feedback" on public.feedback
  for insert to anon, authenticated
  with check (char_length(message) between 1 and 4000);

-- ============================================================================
-- events — coarse product analytics (never wage/goal figures). INSERT-ONLY for anon +
-- authenticated; no select policy. `props` is capped so a single row can't bloat the free tier.
-- `page` + `user_agent` + a per-device anon_id are disclosed in privacy.html.
-- ============================================================================
create table if not exists public.events (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  anon_id    text check (anon_id is null or char_length(anon_id) <= 64),
  name       text not null check (char_length(name) between 1 and 64),
  props      jsonb check (props is null or pg_column_size(props) < 2000),
  page       text check (page is null or char_length(page) <= 120),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400)
);

alter table public.events enable row level security;

drop policy if exists "anyone can insert events" on public.events;
create policy "anyone can insert events" on public.events
  for insert to anon, authenticated
  with check (char_length(name) between 1 and 64);
