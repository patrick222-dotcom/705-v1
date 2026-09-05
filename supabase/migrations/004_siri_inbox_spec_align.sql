-- 004_siri_inbox_spec_align.sql — the additive pieces of docs/agent-gateway-scope.md → Path B that 003
-- left out (003 was written and applied on 2026-09-05 before the Path B section, PR #69, had been
-- found). Nothing here changes what Session A ships; Session B (dictation) needs `transcript`.
-- Kept as built, on purpose: `siri_tokens.code_hash` (the spec says `token_hash`; the UI calls it a
-- Siri code) and one `ops_inbox` row per op (`op` + `payload` + `summary`) rather than an `ops jsonb`
-- array, so per-item Add / Skip has a per-item status to write. See the doc's "As built" subsection.
--
-- NOT YET APPLIED (2026-09-05): the MCP apply was refused by the session's permission classifier.
-- Apply with the MCP `apply_migration`, `supabase db push`, or the Management API `database/query`.

-- source: 'ical' is the Shortcuts-push variant of the iCal follow-up, 'mcp' the gateway's write tools
-- while writes stay confirm-gated (both future; only 'siri' is produced today).
alter table public.ops_inbox drop constraint if exists ops_inbox_source_check;
alter table public.ops_inbox add constraint ops_inbox_source_check check (source in ('siri','ical','mcp'));

-- transcript: the nurse's own dictation (Session B) so the sheet can say "Siri heard: …". Never in events.
alter table public.ops_inbox add column if not exists transcript text
  check (transcript is null or char_length(transcript) <= 2000);

-- Owner may delete their own inbox rows (the spec's third client command). Still no client insert.
create policy ops_inbox_delete on public.ops_inbox
  for delete to authenticated using ((select auth.uid()) = user_id);
grant delete on public.ops_inbox to authenticated;
