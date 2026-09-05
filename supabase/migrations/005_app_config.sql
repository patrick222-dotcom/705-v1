-- 005_app_config.sql — public, owner-edited configuration the clients read. Today: the two Siri
-- Shortcut install links and their shell versions (docs/siri-shortcut.md → "Version handshake").
--
-- WHY A TABLE: an iCloud Shortcut link is a frozen snapshot and an installed Shortcut has no update
-- channel, so everything that can change lives on the server. The Settings → SIRI card reads the two
-- links here (SIRI_SHORTCUT_URL in index.html goes away) and siri-ingest reads the versions per
-- request (cached ≤ 60 s): one row edit changes a link or bumps a shell version everywhere, no deploy.
--
-- RULES: public values only — never a secret in this table; the anon key can read every row.
-- anon + authenticated get SELECT and nothing else; there is deliberately no insert/update/delete
-- policy or grant for either role. The owner edits rows from the dashboard or the Management API
-- (service role bypasses RLS). The *_url check keeps a bad paste from becoming a non-https link the
-- card would render.
--
-- Applied live 2026-09-05 via MCP `apply_migration` (recorded as `app_config`), the same way 003/004 were.

create table if not exists public.app_config (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  value       text not null check (char_length(value) <= 2000),
  updated_at  timestamptz not null default now(),
  -- *_url rows are rendered as links by the app: either '' (not published yet) or an https URL.
  constraint app_config_url_https check (key not like '%\_url' escape '\' or value = '' or value ~ '^https://')
);

-- Keep updated_at honest on dashboard edits (search_path pinned per the security advisor).
create or replace function public.app_config_touch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.app_config_touch();

alter table public.app_config enable row level security;

-- One read policy for both client roles; public rows, so no row filter.
create policy app_config_select on public.app_config
  for select to anon, authenticated using (true);

-- Supabase's default privileges hand every new public table to anon AND authenticated; revoke, then
-- grant exactly SELECT. No sequence grants (text PK), no execute grant needed for the trigger.
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

-- Seed: both Shortcuts unpublished at shell version 1. The owner pastes the iCloud links later.
insert into public.app_config (key, value) values
  ('siri_shortcut_url', ''),
  ('siri_shortcut_v',   '1'),
  ('siri_plan_url',     ''),
  ('siri_plan_v',       '1')
on conflict (key) do nothing;
