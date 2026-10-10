-- BadgeBudget onboarding v2 funnel — one query, one JSON blob.
--
--   Run it:  the Supabase MCP `execute_sql` tool (read-only is enough), the SQL editor, or
--            curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--              https://api.supabase.com/v1/projects/mnnlgcxnvodjwlhhiphq/database/query \
--              -H 'content-type: application/json' --data-binary @<(jq -Rs '{query:.}' < scripts/onboarding_funnel.sql)
--
-- What it reads: the events onboarding v2 added on 2026-10-10 (docs/onboarding-funnel-spec.md) —
-- ob_view {screen}, ob_answer {q,a}, ob_back {from} — plus setup_completed {mode}. `since` below
-- is the day they began; nothing before it can carry ob_view, and ob_step's indices 2+ meant
-- different screens before that date, so this query never reads ob_step at all.
--
-- What it EXCLUDES, and why each one is here (counts come back under `excluded`, so a reader can
-- see what was removed rather than trust it):
--   synthetic — the Playwright harness's iPhone 13 profile, identified by the internally
--               inconsistent pair `iPhone OS 15_0` + `Version/18.0` (no real iPhone reports
--               Safari 18 on iOS 15.0). Match the PAIR, never a WebKit build number. Same rule as
--               ops_device_list() in migration 006. The harness is contained (.invalid host)
--               since 2026-09-16, so this should read 0 — a non-zero is a regression to report.
--   nostore   — `nostore-<uuid>` ids are one page load whose storage was blocked; never a device.
--   insider   — any anon_id ever seen signed in as a builder account (same list as
--               dashboard_snapshot.sql). The owner tests the live app constantly.
--   crawler   — non-mobile AND never acted. "Acted" is redefined here on purpose: the dashboard's
--               old test, "fired anything besides app_open", stopped separating humans from bots
--               on 2026-09-16, because ob_step 0 (and now ob_view landing) fire on ARRIVAL. A bot
--               that runs JavaScript fires both. So the automatic rows are listed and everything
--               else counts as a person doing something.
--   It is a heuristic and says so: a mobile-UA bot that never acts is still counted, and a nurse
--   on a laptop who bounces off the landing is dropped as a crawler.

with params as (select timestamptz '2026-10-10 00:00:00+00' as since),
insiders(uid) as (values
  ('d3d33371-dbf9-45e2-93f6-a212d859497f'::uuid),   -- patrickguthrie222@gmail.com (owner)
  ('4b2cd4d1-8c81-4b25-aaad-fad2260acb76'::uuid),   -- pghawkins222@gmail.com (owner)
  ('e96ea234-dffa-42f8-af99-ce4b04675fa5'::uuid)    -- bagwellc0387@gmail.com (Courtney)
),
insider_anon as (
  select distinct anon_id from public.events
  where user_id in (select uid from insiders) and anon_id is not null
),
dev as (
  select e.anon_id,
         bool_or(e.user_agent ilike '%iphone%' or e.user_agent ilike '%ipad%' or e.user_agent ilike '%android%') as is_mobile,
         bool_or(e.user_agent like '%iPhone OS 15_0 %' and e.user_agent like '%Version/18.0 %')   as synthetic,
         bool_or(not (e.name in ('app_open','session_end','client_error')
                      or (e.name = 'ob_step' and e.props->>'step' = '0')
                      or (e.name = 'ob_view' and e.props->>'screen' = 'landing')))             as acted
  from public.events e, params p
  where e.created_at >= p.since and e.anon_id is not null
  group by e.anon_id
),
kept as (
  select anon_id from dev
  where not synthetic
    and anon_id not like 'nostore-%'
    and anon_id not in (select anon_id from insider_anon)
    and (is_mobile or acted)
),
ev as (
  select e.* from public.events e, params p
  where e.created_at >= p.since and e.anon_id in (select anon_id from kept)
),
screens(ord, screen, q) as (values
  (0,'landing',null), (1,'persona','persona'), (2,'shift','shift'), (3,'status','status'),
  (4,'union','union'), (5,'pay','pay'), (6,'extras',null)
),
finished as (select distinct anon_id from ev where name = 'setup_completed'),
reach as (   -- the furthest screen each device was shown
  select e.anon_id, max(s.ord) as ord
  from ev e join screens s on s.screen = e.props->>'screen'
  where e.name = 'ob_view'
  group by e.anon_id
)
select json_build_object(
  'generated_at', now(),
  'since',        (select since from params),
  'source',       'scripts/onboarding_funnel.sql',

  'excluded', (select json_build_object(
      'synthetic', count(*) filter (where synthetic),
      'nostore',   count(*) filter (where anon_id like 'nostore-%'),
      'insider',   count(*) filter (where anon_id in (select anon_id from insider_anon)),
      'crawler',   count(*) filter (where not is_mobile and not acted and not synthetic),
      'kept',      (select count(*) from kept)) from dev),

  -- One row per screen, in funnel order. `stopped_here` = devices whose furthest screen this was
  -- and that never finished: the number to read first.
  'screens', (select json_agg(json_build_object(
      'ord', s.ord, 'screen', s.screen,
      'viewed',       (select count(distinct anon_id) from ev where name = 'ob_view' and props->>'screen' = s.screen),
      'answered',     case when s.q is null then null else
                      (select count(distinct anon_id) from ev where name = 'ob_answer' and props->>'q' = s.q) end,
      'backed_out',   (select count(distinct anon_id) from ev where name = 'ob_back' and props->>'from' = s.screen),
      'stopped_here', (select count(*) from reach r where r.ord = s.ord and r.anon_id not in (select anon_id from finished)))
    order by s.ord) from screens s),

  -- The answer mix. Values are enumerated by obEventProps() in the app, so this is a closed set;
  -- anything unexpected here means a sender bypassed the whitelist.
  'answers', (select coalesce(json_agg(json_build_object('q', q, 'a', a, 'devices', n) order by q, a), '[]'::json) from (
      select props->>'q' as q, props->>'a' as a, count(distinct anon_id) as n
      from ev where name = 'ob_answer' group by 1, 2) x),

  'completed', (select coalesce(json_agg(json_build_object('mode', mode, 'devices', n) order by mode), '[]'::json) from (
      select props->>'mode' as mode, count(distinct anon_id) as n
      from ev where name = 'setup_completed' group by 1) x)
) as funnel;
