-- 003_siri_inbox.sql — Path B of the agent gateway: the Siri Shortcut → ops-inbox bridge.
--
-- WHY TWO TABLES (not the user_data JSON blob, not a JWT):
--   * A Siri code is a BEARER CREDENTIAL that lives inside an iOS Shortcut. It is stored here only as
--     its SHA-256: the app shows the plaintext exactly once, and the siri-ingest Edge Function hashes
--     what it receives and looks the hash up. Revocation is a timestamp, so an old code can never come
--     back. A code can do exactly one thing — queue a row here — and nothing else in the schema.
--   * Everything a code sends lands in ops_inbox as a PENDING row. The app lists pending rows in a
--     "From Siri" sheet, the nurse taps Add or Skip, and only the app writes user_data (CLAUDE.md
--     Invariant 14). The code never touches the blob, the feed URL, the swap board, or analytics.
--
-- WRITE PATHS: authenticated clients, owner-only via RLS, insert/revoke their own siri_tokens and
-- resolve (applied/rejected) their own ops_inbox rows. Clients CANNOT insert into ops_inbox — there is
-- deliberately no insert policy; only the siri-ingest Edge Function inserts, with the service role,
-- after validating the code and the op. anon has no grants on either table.
--
-- Apply with: supabase db push  (or run this SQL via the Supabase MCP `apply_migration` after review —
-- there is no rehearsal project yet, so read it twice; applied live 2026-09-05).

create table if not exists public.siri_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  code_hash     text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex of "BB-XXXX-XXXX-XXXX-XXXX"
  label         text check (label is null or char_length(label) <= 40),      -- "iPhone" — informational only
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,                                                 -- stamped by siri-ingest on every accepted call
  revoked_at    timestamptz                                                  -- set by the app's Revoke; ingest refuses the code from then on
);
-- RLS policies and the ingest lookup both filter on user_id; the unique index on code_hash serves the
-- ingest lookup itself.
create index if not exists siri_tokens_user_id_idx on public.siri_tokens (user_id);

create table if not exists public.ops_inbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token_id     uuid references public.siri_tokens(id) on delete set null,    -- which code queued it (audit)
  source       text not null default 'siri' check (source in ('siri')),
  op           text not null check (op in ('add_shift','add_day_event','set_note')),
  payload      jsonb not null check (pg_column_size(payload) < 2000),        -- validated by siri-ingest; re-validated by the app before apply
  summary      text not null check (char_length(summary) between 1 and 120), -- "Fri Sep 12 · Night · 12h" — what Siri reads back
  status       text not null default 'pending' check (status in ('pending','applied','rejected','expired')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
-- The app's poll is `where user_id = ? and status = 'pending'`; the ingest rate limit counts a user's
-- recent rows. Both are served by this composite index.
create index if not exists ops_inbox_user_status_idx on public.ops_inbox (user_id, status);
-- Foreign-key index so a token delete/cascade never scans the inbox.
create index if not exists ops_inbox_token_id_idx on public.ops_inbox (token_id);

alter table public.siri_tokens enable row level security;
alter table public.ops_inbox enable row level security;

-- siri_tokens: owner-only, per command, subselect form (matches user_data / ical_subscriptions; the
-- performance advisor prefers `(select auth.uid())` so the auth lookup is evaluated once per statement).
create policy siri_tokens_select on public.siri_tokens
  for select to authenticated using ((select auth.uid()) = user_id);
create policy siri_tokens_insert on public.siri_tokens
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy siri_tokens_update on public.siri_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ops_inbox: owner-only select + resolve. NO insert policy for clients (the Edge Function inserts
-- with the service role, which bypasses RLS); a client can only move a row it owns to applied or
-- rejected — never back to pending, and never enqueue.
create policy ops_inbox_select on public.ops_inbox
  for select to authenticated using ((select auth.uid()) = user_id);
create policy ops_inbox_update on public.ops_inbox
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and status in ('applied','rejected'));

-- Grants. Supabase's default privileges hand every new public table to anon AND authenticated, so
-- revoke both first, then grant authenticated exactly the commands the app uses. The column lists keep
-- a client from re-pointing a token (user_id / code_hash) or rewriting a queued op (op / payload).
revoke all on public.siri_tokens from anon, authenticated;
revoke all on public.ops_inbox from anon, authenticated;
grant select, insert on public.siri_tokens to authenticated;
grant update (label, revoked_at) on public.siri_tokens to authenticated;
grant select on public.ops_inbox to authenticated;
grant update (status, resolved_at) on public.ops_inbox to authenticated;
