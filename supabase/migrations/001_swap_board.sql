-- ============================================================================
-- ScrubPay Swap Board v1 — schema + RLS
-- Design (owner-approved defaults):
--   * Invite-code unit groups (posts visible only inside the group)
--   * Anonymous-until-matched: author identity is hidden AT THE DATABASE LAYER
--     (column-level grants — the API physically cannot return author ids to
--     other members) and revealed only via reveal_match() after ALL legs accept.
--   * v1 matching: direct swaps + 3-way cycles, computed client-side from the
--     anonymized board; proposals/accepts stored here.
--   * Finalize = "swap plan" handoff (app updates calendars + generates summary;
--     official approval stays with the unit's normal process).
-- Apply via: Supabase dashboard SQL editor, or Management API database/query.
-- ============================================================================

-- ---- profiles: display name shown ONLY after a match fully accepts ----------
create table if not exists public.swap_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  updated_at timestamptz not null default now()
);
alter table public.swap_profiles enable row level security;
drop policy if exists "own profile all" on public.swap_profiles;
create policy "own profile all" on public.swap_profiles
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update on public.swap_profiles to authenticated;

-- ---- groups -----------------------------------------------------------------
create table if not exists public.swap_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique check (invite_code ~ '^[A-Z0-9]{6}$'),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.swap_groups enable row level security;

create table if not exists public.swap_members (
  group_id uuid not null references public.swap_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.swap_members enable row level security;

-- membership helper (security definer dodges RLS recursion between the two tables)
create or replace function public.is_swap_member(g uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from swap_members where group_id = g and user_id = auth.uid()) $$;

drop policy if exists "members see their groups" on public.swap_groups;
create policy "members see their groups" on public.swap_groups
  for select to authenticated using (public.is_swap_member(id));
drop policy if exists "anyone can create a group" on public.swap_groups;
create policy "anyone can create a group" on public.swap_groups
  for insert to authenticated with check ((select auth.uid()) = created_by);

drop policy if exists "see co-members" on public.swap_members;
create policy "see co-members" on public.swap_members
  for select to authenticated using (public.is_swap_member(group_id));
drop policy if exists "join self" on public.swap_members;
create policy "join self" on public.swap_members
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "leave self" on public.swap_members;
create policy "leave self" on public.swap_members
  for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert on public.swap_groups to authenticated;
grant select, insert, delete on public.swap_members to authenticated;

-- join-by-code without exposing the group list: security definer RPC
create or replace function public.join_swap_group(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select id into g from swap_groups where invite_code = upper(trim(code));
  if g is null then raise exception 'invalid_code'; end if;
  insert into swap_members(group_id, user_id) values (g, auth.uid())
    on conflict do nothing;
  return g;
end $$;
revoke all on function public.join_swap_group(text) from public;
grant execute on function public.join_swap_group(text) to authenticated;

-- ---- posts: the anonymous board --------------------------------------------
-- kind 'give'  = "I can give this shift up"   (shift_date + shift_meta)
-- kind 'want'  = "I want a shift on this day" (shift_date, meta optional)
-- kind 'avail' = "I could work any of these"  (avail_dates)
create table if not exists public.swap_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.swap_groups(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('give','want','avail')),
  shift_date date,
  shift_meta jsonb check (shift_meta is null or pg_column_size(shift_meta) < 500),
  avail_dates date[] check (avail_dates is null or array_length(avail_dates,1) <= 31),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'open' check (status in ('open','matched','withdrawn')),
  created_at timestamptz not null default now(),
  check (kind <> 'avail' or avail_dates is not null),
  check (kind = 'avail' or shift_date is not null)
);
alter table public.swap_posts enable row level security;

drop policy if exists "group members read posts" on public.swap_posts;
create policy "group members read posts" on public.swap_posts
  for select to authenticated using (public.is_swap_member(group_id));
drop policy if exists "insert own posts" on public.swap_posts;
create policy "insert own posts" on public.swap_posts
  for insert to authenticated
  with check ((select auth.uid()) = author and public.is_swap_member(group_id));
drop policy if exists "update own posts" on public.swap_posts;
create policy "update own posts" on public.swap_posts
  for update to authenticated
  using ((select auth.uid()) = author) with check ((select auth.uid()) = author);

-- ANONYMITY CORE: members may read the board but the author column is not
-- grantable — API queries selecting `author` (or `select *`) fail for others.
-- `is_mine` (via RPC below) lets the UI mark the caller's own posts.
revoke all on public.swap_posts from authenticated;
grant select (id, group_id, kind, shift_date, shift_meta, avail_dates, note, status, created_at)
  on public.swap_posts to authenticated;
grant insert (group_id, author, kind, shift_date, shift_meta, avail_dates, note, status)
  on public.swap_posts to authenticated;
grant update (status, note, shift_date, shift_meta, avail_dates)
  on public.swap_posts to authenticated;

-- board fetch that also flags "mine" without exposing anyone else's identity
create or replace function public.swap_board(g uuid)
returns table (id uuid, kind text, shift_date date, shift_meta jsonb,
               avail_dates date[], note text, status text, created_at timestamptz,
               is_mine boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.kind, p.shift_date, p.shift_meta, p.avail_dates, p.note,
         p.status, p.created_at, (p.author = auth.uid()) as is_mine
  from swap_posts p
  where p.group_id = g and public.is_swap_member(g)
$$;
revoke all on function public.swap_board(uuid) from public;
grant execute on function public.swap_board(uuid) to authenticated;

-- ---- matches: proposed cycles (2 or 3 legs) ---------------------------------
create table if not exists public.swap_matches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.swap_groups(id) on delete cascade,
  proposed_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'proposed'
    check (status in ('proposed','confirmed','declined','expired')),
  created_at timestamptz not null default now()
);
create table if not exists public.swap_match_legs (
  match_id uuid not null references public.swap_matches(id) on delete cascade,
  post_id uuid not null references public.swap_posts(id) on delete cascade,
  leg_user uuid not null references auth.users(id) on delete cascade,
  accepted boolean not null default false,
  primary key (match_id, post_id)
);
alter table public.swap_matches enable row level security;
alter table public.swap_match_legs enable row level security;

create or replace function public.is_match_party(m uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from swap_match_legs where match_id = m and leg_user = auth.uid()) $$;

drop policy if exists "parties see matches" on public.swap_matches;
create policy "parties see matches" on public.swap_matches
  for select to authenticated using (public.is_match_party(id));
drop policy if exists "members propose matches" on public.swap_matches;
create policy "members propose matches" on public.swap_matches
  for insert to authenticated
  with check ((select auth.uid()) = proposed_by and public.is_swap_member(group_id));
-- any party may decline a still-proposed match (that's the only status change
-- allowed directly; confirmation happens exclusively inside reveal_match)
drop policy if exists "parties decline matches" on public.swap_matches;
create policy "parties decline matches" on public.swap_matches
  for update to authenticated
  using (public.is_match_party(id) and status = 'proposed')
  with check (status = 'declined');

drop policy if exists "parties see own legs" on public.swap_match_legs;
create policy "parties see own legs" on public.swap_match_legs
  for select to authenticated using (public.is_match_party(match_id));
drop policy if exists "proposer inserts legs" on public.swap_match_legs;
create policy "proposer inserts legs" on public.swap_match_legs
  for insert to authenticated
  with check (exists(select 1 from public.swap_matches m
                     where m.id = match_id and m.proposed_by = (select auth.uid())
                       and m.status = 'proposed'));
drop policy if exists "accept own leg" on public.swap_match_legs;
create policy "accept own leg" on public.swap_match_legs
  for update to authenticated
  using (leg_user = (select auth.uid())) with check (leg_user = (select auth.uid()));

revoke all on public.swap_matches from authenticated;
grant select (id, group_id, status, created_at), insert (id, group_id, proposed_by, status),
  update (status)
  on public.swap_matches to authenticated;
revoke all on public.swap_match_legs from authenticated;
grant select (match_id, post_id, accepted), insert (match_id, post_id, leg_user), update (accepted)
  on public.swap_match_legs to authenticated;

-- proposer must name the leg users — but can't read authors. Resolve server-side:
create or replace function public.propose_swap(g uuid, post_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare m uuid; pid uuid; a uuid;
begin
  if not public.is_swap_member(g) then raise exception 'not_a_member'; end if;
  if array_length(post_ids,1) not between 2 and 3 then raise exception 'bad_size'; end if;
  insert into swap_matches(group_id, proposed_by) values (g, auth.uid()) returning id into m;
  foreach pid in array post_ids loop
    select author into a from swap_posts
      where id = pid and group_id = g and status = 'open';
    if a is null then raise exception 'post_unavailable'; end if;
    insert into swap_match_legs(match_id, post_id, leg_user) values (m, pid, a);
    -- proposer's own legs start accepted
    if a = auth.uid() then
      update swap_match_legs set accepted = true where match_id = m and post_id = pid;
    end if;
  end loop;
  return m;
end $$;
revoke all on function public.propose_swap(uuid, uuid[]) from public;
grant execute on function public.propose_swap(uuid, uuid[]) to authenticated;

-- reveal: names unlock ONLY when every leg has accepted
create or replace function public.reveal_match(m uuid)
returns table (post_id uuid, display_name text)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_match_party(m) then raise exception 'not_a_party'; end if;
  if exists(select 1 from swap_match_legs where match_id = m and not accepted) then
    raise exception 'not_fully_accepted';
  end if;
  update swap_matches set status = 'confirmed' where id = m and status = 'proposed';
  -- retire the traded posts so they leave the open board
  update swap_posts set status = 'matched'
    where id in (select post_id from swap_match_legs where match_id = m)
      and status = 'open';
  return query
    select l.post_id, coalesce(pr.display_name, 'A colleague')
    from swap_match_legs l left join swap_profiles pr on pr.user_id = l.leg_user
    where l.match_id = m;
end $$;
revoke all on function public.reveal_match(uuid) from public;
grant execute on function public.reveal_match(uuid) to authenticated;

-- housekeeping indexes
create index if not exists idx_swap_posts_group on public.swap_posts (group_id, status, created_at desc);
create index if not exists idx_swap_legs_user on public.swap_match_legs (leg_user);
create index if not exists idx_swap_members_user on public.swap_members (user_id);
