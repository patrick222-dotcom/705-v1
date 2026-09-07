-- BadgeBudget admin dashboard — one snapshot, one JSON blob.
--
--   Run it:  Supabase SQL editor, or the MCP `execute_sql` tool, or
--            curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--              https://api.supabase.com/v1/projects/mnnlgcxnvodjwlhhiphq/database/query \
--              -H 'content-type: application/json' --data-binary @<(jq -Rs '{query:.}' < scripts/dashboard_snapshot.sql)
--
-- Then pipe the result through scripts/dashboard_snapshot.mjs to fold in the
-- track-name inventory read from index.html, and paste the output into the dashboard.
--
-- WHY THE BOT SPLIT MATTERS. badgebudget.com was registered 2026-09-02 and immediately
-- picked up crawler traffic: 87 non-mobile devices, of which only 4 ever fired an event
-- other than app_open. Counting those as users understates activation by roughly 2.5x
-- and overstates the bounce rate. `cohort` classifies every device:
--   'mobile'  — any event carried an iPhone / iPad / Android user agent. The real users.
--   'crawler' — non-mobile AND never fired anything but app_open. Loaded once, left.
--   'desktop' — non-mobile but actually interacted. Small, real, worth watching.
-- The dashboard's cohort filter reads this field. It is a heuristic, not a truth:
-- a nurse on a laptop who bounces looks identical to a crawler. Named, not hidden.

with ua as (
  select anon_id,
         bool_or(user_agent ilike '%iphone%' or user_agent ilike '%ipad%' or user_agent ilike '%android%') as is_mobile,
         bool_or(name <> 'app_open') as engaged
  from public.events where anon_id is not null group by anon_id
),
dev as (
  select anon_id,
         case when is_mobile then 'mobile' when engaged then 'desktop' else 'crawler' end as cohort
  from ua
),
ev as (select e.*, d.cohort from public.events e left join dev d using (anon_id)),
opens as (
  select anon_id, cohort, count(*) n, min(created_at) t0, max(created_at) t1
  from ev where name='app_open' group by anon_id, cohort
),
stages(ord, stage, ev_name) as (values
  (1,'Opened the app','app_open'),
  (2,'Left the welcome screen','ob_step'),
  (3,'Finished setup','setup_completed'),
  (4,'Saved a shift','shift_saved'),
  (5,'Signed in','signed_in')
)
select json_build_object(
  'generated_at', now(),
  'source', 'scripts/dashboard_snapshot.sql',

  'totals', (select json_build_object(
      'devices',        (select count(*) from dev),
      'mobile',         (select count(*) from dev where cohort='mobile'),
      'desktop',        (select count(*) from dev where cohort='desktop'),
      'crawler',        (select count(*) from dev where cohort='crawler'),
      'events',         (select count(*) from public.events),
      'events_7d',      (select count(*) from public.events where created_at > now()-interval '7 days'),
      'feedback',       (select count(*) from public.feedback),
      'cloud_rows',     (select count(*) from public.user_data),
      'last_event_at',  (select max(created_at) from public.events))),

  -- Funnel, per cohort. Stage 2 also counts devices that reached setup without ob_step,
  -- since ob_step only started firing 2026-09-07 — otherwise the stage reads as a false cliff.
  'funnel', (select json_agg(json_build_object(
      'ord', ord, 'stage', stage,
      'all',    (select count(distinct anon_id) from ev where name=s.ev_name
                   or (s.ord=2 and name='setup_completed')),
      'mobile', (select count(distinct anon_id) from ev where cohort='mobile'
                   and (name=s.ev_name or (s.ord=2 and name='setup_completed'))))
      order by ord) from stages s),

  'returned', (select json_build_object(
      'all_multi',      (select count(*) from opens where n>1),
      'mobile_multi',   (select count(*) from opens where n>1 and cohort='mobile'),
      'all_multiday',   (select count(*) from opens where t1::date>t0::date),
      'mobile_multiday',(select count(*) from opens where t1::date>t0::date and cohort='mobile'))),

  'daily', (select coalesce(json_agg(x order by x.d),'[]'::json) from (
      select created_at::date d,
             count(*) filter (where name='app_open') opens,
             count(distinct anon_id) filter (where name='app_open') devices,
             count(distinct anon_id) filter (where name='app_open' and cohort='mobile') mobile_devices,
             count(distinct anon_id) filter (where name='app_open' and cohort='crawler') crawler_devices,
             count(*) filter (where name='shift_saved') shifts,
             count(*) filter (where name='setup_completed') setups,
             count(*) filter (where name like 'swap%') swaps,
             count(*) filter (where name='client_error') errors,
             count(*) total
      from ev group by 1) x),

  'adoption', (select coalesce(json_agg(x order by x.devices desc, x.n desc),'[]'::json) from (
      select name, count(*) n,
             count(distinct anon_id) devices,
             count(distinct anon_id) filter (where cohort='mobile') mobile_devices,
             min(created_at)::date first_seen, max(created_at)::date last_seen,
             (current_date - max(created_at)::date) days_since
      from ev group by name) x),

  -- Weekly acquisition cohorts: of the devices first seen in week W, how many came back
  -- in each later week. Mobile only — crawler cohorts are noise by construction.
  'cohorts', (select coalesce(json_agg(x order by x.cohort_week, x.week_offset),'[]'::json) from (
      with fs as (select o.anon_id, date_trunc('week', o.t0)::date cw from opens o where o.cohort='mobile'),
           act as (select distinct f.anon_id, f.cw, date_trunc('week', e.created_at)::date aw
                   from fs f join ev e using (anon_id) where e.cohort='mobile')
      select cw cohort_week,
             ((aw - cw)/7)::int week_offset,   -- date - date is an integer of days
             count(distinct anon_id) devices,
             (select count(distinct anon_id) from fs f2 where f2.cw=a.cw) cohort_size
      from act a group by cw, aw) x),

  'platforms', (select coalesce(json_agg(x order by x.devices desc),'[]'::json) from (
      select case when user_agent ilike '%iphone%' then 'iPhone'
                  when user_agent ilike '%ipad%' then 'iPad'
                  when user_agent ilike '%android%' then 'Android'
                  when user_agent ilike '%macintosh%' then 'Mac'
                  when user_agent ilike '%windows%' then 'Windows'
                  when user_agent ilike '%linux%' or user_agent ilike '%x11%' then 'Linux/X11'
                  when user_agent is null then 'unknown' else 'other' end platform,
             count(*) opens, count(distinct anon_id) devices,
             count(distinct anon_id) filter (where cohort='crawler') crawler_devices
      from ev where name='app_open' group by 1) x),

  -- Errors flushed from the boot script's ring buffer, newest first.
  'errors', (select coalesce(json_agg(x order by x.created_at desc),'[]'::json) from (
      select created_at, props, page,
             case when user_agent ilike '%iphone%' then 'iPhone'
                  when user_agent ilike '%android%' then 'Android' else 'desktop' end plat
      from public.events where name='client_error'
      order by created_at desc limit 100) x),

  -- Contact addresses are masked here on purpose: this payload is pasted into a hosted
  -- page. Read them unmasked straight from the table when you need to reply.
  'feedback', (select coalesce(json_agg(x order by x.created_at desc),'[]'::json) from (
      select created_at, left(message, 400) message,
             case when contact is null or contact='' then null
                  else left(contact,1) || '•••@' || split_part(contact,'@',2) end contact,
             (user_id is not null) signed_in, page,
             case when user_agent ilike '%iphone%' then 'iPhone'
                  when user_agent ilike '%android%' then 'Android' else 'desktop' end plat
      from public.feedback order by created_at desc limit 100) x),

  -- North-star metric: density, not DAU. A live unit = >=10 members AND >=1 confirmed
  -- swap in 30 days (docs/scaling-and-burn.md).
  'swap', (select json_build_object(
      'groups',       (select count(*) from public.swap_groups),
      'members',      (select count(*) from public.swap_members),
      'posts',        (select count(*) from public.swap_posts),
      'posts_open',   (select count(*) from public.swap_posts where status='open'),
      'matches',      (select count(*) from public.swap_matches),
      'legs',         (select count(*) from public.swap_match_legs),
      'biggest_group',(select coalesce(max(c),0) from (select count(*) c from public.swap_members group by group_id) g),
      'dense_units',  (select count(*) from (
                         select m.group_id from public.swap_members m
                         group by m.group_id having count(*) >= 10
                         and exists (select 1 from public.swap_matches x
                                     where x.group_id=m.group_id and x.created_at > now()-interval '30 days')) d))),

  'infra', (select json_build_object(
      'db_bytes',        pg_database_size(current_database()),
      'db_limit_bytes',  500*1024*1024,
      'events_bytes',    pg_total_relation_size('public.events'),
      'events_rows',     (select count(*) from public.events),
      'max_blob_bytes',  (select coalesce(max(pg_column_size(data)),0) from public.user_data),
      'blob_limit_bytes',512*1024,
      'mau',             (select count(distinct coalesce(user_id::text, anon_id)) from public.events
                            where created_at > now()-interval '30 days'),
      'mau_limit',       50000,
      'ical_subs',       (select count(*) from public.ical_subscriptions)))
) as snapshot;
