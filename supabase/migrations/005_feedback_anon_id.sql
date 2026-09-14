-- 005_feedback_anon_id.sql — the join key that makes feedback traceable to a device.
--
-- WHY: `feedback` carries `user_id`, `page` and `user_agent` and nothing that identifies the
-- device. `page` cannot help — this is a single-page app, so it is always '/'. So when an
-- ANONYMOUS nurse taps "A number looks wrong" and submits, there is no way to connect that row to
-- her event trail in `events`, which is precisely the join the support console exists to make.
-- One of the 9 rows on the day this shipped was already in that state.
--
-- THIS ONLY WORKS GOING FORWARD. Every row submitted before this ships stays permanently
-- unjoinable — the id was never captured, so there is nothing to backfill from. That is the whole
-- reason this is worth doing early rather than alongside the rest of phase 3: each day it waits is
-- another day of reports that can never be traced. `anon_id is null` therefore means "submitted
-- before 2026-09-14", exactly as `kind is null` means "before the tiles shipped".
--
-- SHAPE MIRRORS events.anon_id DELIBERATELY (000_core.sql): same type, same 64-char cap, same
-- nullability. It is the same identifier from the same `localStorage['scrubpay_anon_id']` key, and
-- a join between two columns that drifted apart in type or length would fail quietly rather than
-- loudly.
--
-- NOT A NEW DISCLOSURE CATEGORY, BUT A NEW DISCLOSURE: the per-device identifier was already
-- described in privacy.html under Usage analytics. It was not described under Feedback, because
-- feedback did not carry it. privacy.html ships in the same change (Invariant 8 — it is in the
-- publish set), so the notice and the behaviour move together.
--
-- NO RLS CHANGE NEEDED: feedback's insert-only policies are per-command, not per-column, so they
-- already cover this column. Nobody can read it back through the anon key, and the ops console
-- reads feedback only through `ops_feedback_inbox()` (004), which does not return this column —
-- phase 3b is what adds a drill-down worth returning it for.
--
-- NO INDEX, DELIBERATELY. 004 justified each of its four indexes by naming a query that already
-- runs. There is no query on `feedback.anon_id` yet: the phase-3b lookup goes the other way
-- (a feedback row's own anon_id, then `idx_events_anon` for the trail). Adding one now for a query
-- that does not exist would break the standard set one migration ago. Add it with phase 3b, when
-- "every report from this device" becomes a real query.
--
-- Apply with: supabase db push  (or run this SQL via the Management API after review).

alter table public.feedback
  add column if not exists anon_id text;

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard it explicitly to keep the migration
-- re-runnable. Added as VALID: every existing row is null, which passes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_anon_id_check'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_anon_id_check
      check (anon_id is null or char_length(anon_id) <= 64);
  end if;
end $$;

comment on column public.feedback.anon_id is
  'Per-device id from localStorage[''scrubpay_anon_id''] — the same identifier events.anon_id '
  'carries, so a feedback row can be joined to that device''s event trail. null = submitted before '
  '2026-09-14, when this column shipped; those rows are permanently unjoinable.';

-- Owner read — what the join finally makes possible:
--   select f.created_at, f.kind, f.message, f.anon_id,
--          (select count(*) from public.events e where e.anon_id = f.anon_id) as events_from_device
--     from public.feedback f order by f.created_at desc;
