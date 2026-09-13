-- 003_feedback_kind.sql — a shape tag on each feedback row.
--
-- WHY: the widget was a single open textarea, so every submission arrived as undifferentiated prose
-- and the nurse had to do the categorising work herself ("is this a bug? a wrong number? a wish?").
-- Four one-tap tiles now pre-fill the box with a scaffold and set this column, so the owner read can
-- group four rows into four kinds instead of re-reading them.
--
-- NULLABLE ON PURPOSE: `kind is null` means "submitted before 2026-09-13, when the tiles shipped".
-- Every row written by the current client carries a kind — the open box writes 'other' explicitly —
-- so null is a clean legacy marker rather than an ambiguous "untagged".
--
-- NO RLS CHANGE NEEDED: feedback's insert-only policies for anon+authenticated are per-command, not
-- per-column, so they already cover this column. Nobody can read it back through the anon key.
--
-- The CHECK is the reason this is a column and not a `[kind]` prefix inside `message`: it keeps the
-- value set closed, so a typo or a stale client can't invent a sixth bucket that silently splits the
-- owner's group-by. Adding a fifth tile later means a migration — that is the intended cost.
--
-- Apply with: supabase db push  (or run this SQL via the Management API after review).

alter table public.feedback add column if not exists kind text;

-- ADD CONSTRAINT has no IF NOT EXISTS form, so guard it explicitly to keep the migration re-runnable.
-- Added as VALID (not NOT VALID): the table is tiny and every existing row is null, which passes.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'feedback_kind_check'
      and conrelid = 'public.feedback'::regclass
  ) then
    alter table public.feedback
      add constraint feedback_kind_check
      check (kind is null or kind in ('wrong_number','broken','confused','wish','other'));
  end if;
end $$;

comment on column public.feedback.kind is
  'Which feedback tile the user tapped. null = submitted before the tiles shipped (2026-09-13).';

-- Owner read, now groupable:
--   select kind, count(*) from public.feedback group by kind order by 2 desc;
--   select created_at, kind, message, contact, user_id, page, user_agent
--     from public.feedback order by created_at desc;
