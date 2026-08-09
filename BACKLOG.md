# ScrubPay Backlog

Durable, git-tracked queue for the **autonomous nightly groom+build loop** (see CLAUDE.md →
"Autonomous nightly loop"). This file is the loop's memory — the container is ephemeral, so
anything not committed here is lost between runs.

**Each nightly run:** (1) GROOM — mine feedback/events + review the app, add/reprioritize items
below; (2) BUILD — implement the single highest-priority **unblocked, gate-safe** item
end-to-end (build → iPhone-13 Playwright harness → safety gate → deploy), then mark it done here
with a dated line in the Done log.

- **Status:** `todo` · `doing` · `done` · `deferred` · `blocked`
- **Priority:** P0 (broken/critical) · P1 (high value) · P2 (nice) · P3 (polish)
- **Safety gate (must pass before deploy):** boot happy + `hang-getsession` + `block-babel`
  error screen; no page errors; SRI hashes intact (5); boot hardening untouched; money surfaces
  legible; wage-math sanity. Never weaken boot hardening / SRI / wage-core. If an item is risky,
  ambiguous, or the gate fails → mark `deferred` with a note, take the next safe item or stop.
  **One build item per run.**

## In progress
_(none)_

## Queue

### P1
_(none)_

### P2
- [ ] **Calendar memoization** — App re-renders all ~480 month cells on every unrelated state
  change. `useCallback` on statOf/ptoStatOf/keyOf and `React.memo` on MonthSection; verify no
  stale-closure bugs and the scroll machinery (scrollMonthTo/jumpToday/hero-follow) still works.
- [ ] **Sync content-equality canonicalization** — the poll-sync anti-ping-pong guard may be
  inert. First confirm `user_data.data` column type (json vs jsonb) via Supabase MCP; if jsonb,
  canonicalize key order before compare. Delicate — exercise the poll_sync probe.

### P3
- [ ] **Calendar 16-month virtualization** — all months stay mounted; window them WITHOUT
  breaking scrollMonthTo/jumpToday/hero-follow (they need measurable rects). Careful.
- [ ] **Backdrop-filter perf pass** — reproduce jank on older-iPhone emulation FIRST; only then
  trim blur on the ~8 glass surfaces. Don't blind-remove (visual regression).
- [ ] **Swap poster_key disclosure** — stable per-group key lets a colleague recognize an
  identified person's other posts. Add copy disclosure and/or per-cycle key rotation.

## Blocked
- [ ] **Feedback → email (Resend)** — Edge Function formats each new `feedback` row + sends via
  Resend `onboarding@resend.dev` → owner email; DB webhook on `feedback` INSERT calls it.
  **BLOCKED** on a Resend API key (`re_...`) + destination email from the owner.

## Environment notes (scheduled-run limitations — as of 2026-08-09)
- **Scheduled/Routine-fired sessions CANNOT git push** to this repo: push fails 403 "repo not
  in this session's authorized repository set." This is an env-level authorization gap and was
  NOT fixed by running `/web-setup`. Interactive sessions push fine. Until resolved, the nightly
  run builds+tests but its DEPLOY step falls back to emitting a `git format-patch` in the summary;
  the owner (or an interactive session) applies + ships it. Verified across 3 scheduled runs
  (2026-08-04, and both 2026-08-09 runs).
- **Scheduled runs can't hit the Supabase Management API with auth:** a `Bearer`-header request is
  denied by the sandbox auto-mode classifier (plain unauth GET → 401 as normal). So the GROOM
  phase can't mine feedback/events from a scheduled run; grooming is code-review-only there.
  (Works fine from an interactive session.)

## Done (log)
- 2026-08-09 — **FAB overlap** (P2). Corner-anchored the fixed "Log a shift" button to
  `right:16px` (was centered `left:50%;translateX(-50%)`, which covered calendar/card content
  mid-scroll); `:active` transform simplified to `translateY(1px)`. 2-line CSS diff; safe-area
  bottom inset preserved. iPhone-13 gate 14/14, SRI intact (5). NOTE: originally built by the
  nightly scheduled run but its push was DENIED (403 "repo not in this session's authorized
  repository set"); reproduced + shipped from an interactive session. See Groom notes.
- 2026-08-04 — **Overtime × differential stacking** (P1). `isOvertime` is now an independent
  per-shift flag (own toggle in AddShiftSheet) instead of a mutually-exclusive shift-type chip;
  `shiftGross` applies `hourlyRate(base,diff)` then ×1.5 so a night/weekend OT shift keeps its
  differential (e.g. night OT = 1.5×(base+$10) rather than a flat 1.5×base that dropped it).
  Per-hour/flat bonuses stay at face value. `overtime` filtered out of the shift-type chips (key
  kept for legacy shifts + paystub classify); `sanitizeData` coerces `isOvertime` to a strict
  boolean (old shifts → false); "OT ×1.5" badge on logged shifts. iPhone-13 gate 14/14 (boot
  happy / hang-getSession / block-babel + 8 wage-math probes + sanitize coercion). SRI intact (5).
- 2026-07-30 — Liquid Glass UI; 24-item council fix pass; swap board live + 2 RLS holes closed
  (direct-INSERT anonymity bypass, status forge); tighter grid-style month calendar.

## Discovery inputs (for the GROOM phase)
- `select created_at, message, contact from public.feedback order by created_at desc;` — real user asks.
- `select name, count(*) from public.events group by name order by 2 desc;` — usage patterns.
- Competitive/parity ideas (NurseGrid-style scheduling gaps); nurse pay-planning pain points.
- Turn signal into P0–P3 items above, each with a one-line rationale. Dedupe; don't re-add
  anything already in Done or Blocked.
