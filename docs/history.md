# History — decisions, incidents, resolved work

Dated record of what happened and why, moved out of `CLAUDE.md` on 2026-09-02 so the operating
file stays short. Newest first. The nightly loop's per-build record is `BACKLOG.md` → Done (log);
the swap board's own audit trail is `swap-board.md`.

## 2026-09-05 — Siri bridge, Session A shipped (agent gateway Path B, #70)

Owner-directed session building the cheapest write path from a phone: a Siri Shortcut POSTs a
structured op with a per-user code to a new `siri-ingest` Edge Function, which hashes the code,
validates the op with the app's own coercions and queues one *pending* row in `ops_inbox`; the app's
15 s poll surfaces it in a "From Siri" sheet and the nurse taps Add or Skip per item, Add running
through the Add-Shift sheet's own save path. Migration 003 (`siri_tokens`, `ops_inbox`) was applied
live through the MCP — the first migration recorded in `supabase_migrations` — with owner-only RLS,
no client insert policy on the inbox and zero `anon` grants; advisors unchanged. Invariant 14 records
the model: codes are write-only, hashed at rest, revocable, and the app stays the sole writer to
`user_data`. Built against the Path B spec written earlier the same day (#69, below); the deliberate
deviations — one inbox row per op, `code_hash`, a 240-char note cap, both wire formats — are recorded
in the doc's "As built" subsection. The Shortcut itself is the owner's to build from the spec;
dictation (Claude parsing) is Session B. Two things worth
keeping from the session: the hero-equality check against the deployed build caught nothing because
nothing in the wage core moved, which is the point; and the in-page Supabase stub made the whole
signed-in path (poll, sheet, save effect, analytics) drivable in the sandbox without a live account.

## 2026-09-05 — Path B: the Siri Shortcut bridge

Same day #61 and #67 merged, the owner asked whether a preconfigured Siri Shortcut could take actions
in the app directly, so nurses aren't hinged on configuring an LLM client. Decision: yes, as an
**ops inbox** rather than a direct write — the Shortcut proposes, the app confirms and stays the sole
writer to `user_data`; Siri codes are write-only, hashed and revocable, so a leaked one can queue
shifts but never read pay. Reads stay behind OAuth (gateway step 3). The op vocabulary the inbox
accepts is the step-4 manifest written down early; the iCal Shortcuts-push idea becomes the same pipe
with a different input. Design and the action-by-action Shortcut spec: `agent-gateway-scope.md` → Path B.

## 2026-09-04 → 09-05 — pattern lab, goals on the goal, the agent-gateway thesis (#65, #68, #67)

**Pattern lab (#65)** merged on the afternoon of 09-04 from an owner-directed creative session:
design a repeating rotation from presets nurses actually describe, paint it, and read both the
paycheck it makes and the life it makes (longest stretch, longest break, weekends worked, which
weekdays stay free, or a warning that the cycle drifts across the week). It deliberately moved the
per-paycheck tax math out of `calc()` into a shared `computeNet()` so the lab and the hero cannot
drift, and proved it with a byte-identical hero/breakdown comparison against the deployed build —
the first wage-core change since the OT stacking work, and the model for how to do one. **Goals on
the goal (#68)**, the nightly's third goals increment, put "≈ N typical 12h shifts to reach this"
under each goal in Settings; the cadence-based on-track date was flagged as a design call and parked.
**Agent gateway scoping (#67, merged 09-05)**: the same session wrote `docs/agent-gateway-scope.md` — the
app as one domain with two surfaces (UI and MCP), a `core/` module inlined back into the single file
by a build step, versioned `apply_ops` instead of whole-blob writes, an MCP Edge Function
authenticated by Supabase's OAuth 2.1 server so RLS applies to the agent unchanged, and an ops
manifest that gates parity. Five owner decisions gate the first session (build step, rehearsal
project, agent swap writes, custom auth domain, create `main`).

## 2026-09-03 → 09-04 — iCal auto-sync, rename, sticky weekdays, goals (#57, #63, #64, #62, #66)

Four sessions landed in one night. **iCal auto-sync (#57, superseding #50):** a nurse pastes her
calendar's secret iCal address once and the app re-fetches it on every open through an SSRF-guarded
Edge Function (`ical-proxy`), routing everything through the existing import stepper so wage-affecting
shifts are never rewritten silently; removals, "not a shift" and "ignore" are remembered by UID. The
URL is treated as a bearer credential in its own table (`ical_subscriptions`, migration 002). The
backend was applied live on 2026-09-02. **Rejected on the way:** Google Calendar OAuth (sensitive
scopes → Google verification beyond ~100 users; refresh tokens expire in Testing mode; Supabase
discards provider tokens, so background sync would mean persisting a long-lived key to the user's
whole Google account); native Siri / App Intents (Swift-only, no PWA surface). Kept as a follow-up:
an iOS Shortcuts push (`Find Calendar Events` → POST to an ingest endpoint), which would sync while
the app is closed and is provider-agnostic via iOS Calendar, at the cost of being iOS-only.
**Rename (#64):** visible ScrubPay → BadgeBudget in `index.html`, `design-system/` and docs; storage
keys, the .ics UID scheme and the swap salt untouched; the bare `'scrubpayErrors'` literal now goes
through `ERR_KEY`; inline SVG favicon, meta description and theme-color added; header wordmark
shrunk to fit 11 characters on an iPhone 13. **Sticky weekday row (#63):** the month label and the
S M T W T F S row became one sticky unit, found by the owner while testing sync. **Savings goals:**
the MVP (#62, % of goal in the Add-Shift preview) and the "≈N shifts like this" count (#66), both
from the nightly loop. A fifth session opened #65, a "pattern lab" for designing a rotation and
seeing its paycheck and livability, which deliberately refactors the tax math into `computeNet()`.

## 2026-09-02 — custom domain, naming decision, docs split

ScrubPay → BadgeBudget (domain only; the app is still branded ScrubPay). Four domains registered at
Porkbun, DNS cut over, Supabase auth URLs updated, `CNAME` added to the Pages publish set (#58). A
13-agent adversarially-verified survey of the repo was written up as `state-brief-2026-09-02.md`
and the decision record as `session-2026-09-02-domain-and-naming.md` (#60). The same day `CLAUDE.md`
was split into a short operating file plus this `docs/` set, `BACKLOG.md` was re-shaped so `## Queue`
holds only one-run work, `README.md` was rewritten, a `.gitignore` was added, four merged branches
were deleted, and the nightly Routine's live-check URL was pointed at badgebudget.com.

## 2026-08-23 — P0: cloud saves had failed for every signed-in user since 2026-07-07 (#45)

`saveToSupabase` upserted with no conflict target. The table's PK is `id uuid default
gen_random_uuid()` while `user_id` carries a separate unique constraint, so PostgREST aimed at the
PK, generated a fresh id, hit no PK conflict, and the statement degraded into a plain INSERT that
violated `user_data_user_id_key` with 23505 — every save after the first, for every signed-in user.
Both rows in `user_data` had `updated_at` equal to `created_at`: first save created the row, nothing
written since. Fixed with `{onConflict:'user_id'}`, verified against real Postgres on a scratch table
of the same shape.

Two defects had hidden it and made it destructive, both fixed in the same PR: the failed-save
localStorage backup was only read when *no* cloud row existed, so the stale row overwrote unsent work
on every reload (now the backup carries `savedAt` and the newer copy wins; untimestamped legacy
backups are treated as newer, recovering stranded shifts); and `console.error` was not mirrored into
the error ring buffer, which caught only *thrown* errors and so stayed empty for 47 days while
PostgREST returned failures. Lesson for the council: an empty error log is not evidence of health
when the failure path *returns* errors instead of throwing them.

## 2026-08-22 — Reddit pipeline landed, harness classification, invite links (#41, #42, #43)

The pipeline design doc drafted in PR #29 (2026-08-13) had never merged, so every reference to it
was dangling and the nightly was following a spec it couldn't read; it landed rewritten, with Phase 3
(live Reddit API) declared dead — Reddit closed self-serve app registration — and replaced by
owner-mediated intake via Claude in Chrome (`reddit_intake_prompt.md`). The queue got `harness:`
tags (`drivable` / `needs-live-auth` / `unscoped`) after ten nights in which every P1–P3 item was
self-annotated as not-runnable and every build came from the candidate lists instead. Invite links
shipped the same day.

## 2026-08-16 — a deliberate no-ship, and the dev-build console diagnostic

Nothing in the queue cleared the gate, so instead of churning the run added the dev-React
console-warning diagnostic to the Testing section and ran it (clean). The lesson recorded that night —
"next high-value work needs dedicated feature builds, not one-run additive changes" — became the
`## Needs a dedicated session` split on 2026-08-22.

## 2026-08-04 / 2026-08-09 — the council's two "deferred" items shipped

Overtime × differential stacking (#24: `isOvertime` became an independent per-shift flag;
`shiftGross` applies `hourlyRate(base, diff)` then ×1.5 so night/weekend OT keeps its differential;
`sanitizeData` coerces the flag to a strict boolean) and the FAB overlap (#25: corner-anchored at
`right:16px`). Both had been listed as "deferred — needs focused work" by the 2026-07-30 council;
they are done and should not be re-opened from that list.

## 2026-07-30 — agent council run (ultracode)

Ran the multi-lens council (8 dimensions: wage-math, security, mobile-ux, accessibility,
performance, data-integrity, code-quality, product-design) as a Workflow with adversarial
verification of every finding: 30 confirmed / 2 rejected. Auto-applied the 24 confirmed-safe,
low-risk fixes (`index.html` + the two swap SQL fixes in `swap-board.md`), device-tested on iPhone-13
emulation (boot happy + hang-getsession + block-babel, wage-math, NaN-safety, Year-PTO,
delete-confirm), re-audited swap RLS (29/29 + 5/5), then deployed.

Highlights: differential-delete now confirms before silently repricing logged shifts;
`loadCloudRow` throws on transient errors (no more clobbering cloud with local on a network blip);
`sanitizeData` coerces malformed differentials (no NaN take-home); Year view includes PTO; global
`--muted-2` and calendar-amount contrast raised to WCAG AA; reduced-motion / reduced-transparency
media queries; iconbtn double-blur removed; many P3 nits (BACKUP_KEY cleanup, aria-pressed/labels,
safe-area FAB, dead code). Same day: the Liquid Glass UI pass and the `design-system/` spec pages.

Deferred by the council as real but not safe to auto-apply overnight: OT × differential stacking
(**shipped 2026-08-04**); FAB overlap (**shipped 2026-08-09**); calendar memoization + 16-month
virtualization; sync content-equality canonicalization (`user_data.data` is `jsonb` — verified
2026-09-02 — so key order must be canonicalized before comparing); broad backdrop-filter reduction
(needs a real older-iPhone perf repro). The still-open ones are parked in `BACKLOG.md` → Needs a
dedicated session.

## 2026-07-23 → 07-30 — swap board built and audited

Phase 1 (#17), Phase 2 (#18), month-first calendar (#19), schema applied live and the adversarial
RLS audit run (#20). Full trail in `swap-board.md`.

## 2026-07-19 — NurseGrid capabilities built natively (#11–#14)

The owner green-lit going native instead of integrating: shift templates + quick-fill, work-life day
events (PTO paid at base rate, education/appointment/off) + notes + shift start times, .ics export
(deterministic UIDs, no wage data), and .ics import with a grouped Intuit-style shift-type
questionnaire (re-import moves shifts and preserves assigned pay types via `shift.icsUid`).

**Research that led there (2026-07-07):** NurseGrid has no public API; it offers an iCal feed /
calendar sync and a shareable schedule link. NurseGrid was acquired by HealthStream, whose hStream
Developer Portal does expose REST APIs and webhooks (schedule-change events) with NurseGrid in its
first integration cohort — but access is a gated B2B partner program (pre-authorized hStreamID,
"Request Access" approval, hStream certification) over a health *system's* authorized data, so it
near-certainly needs contracts and a HIPAA BAA. Not reachable for a personal app; the legitimate
path to live NurseGrid sync only if this becomes a real product. The 2026-08-23 follow-up — an
auto-syncing subscription from a secret iCal URL through an SSRF-guarded proxy, with an iOS Shortcuts
push as the alternative and native App Intents ruled out — is scoped in `BACKLOG.md` and built in
PRs #50/#57.

## 2026-07-07 — sync v2, analytics, hardening backlog, iPhone sign-in verified

- **Cross-device sync v2 (poll-based).** v1's focus/visibility refetch missed the common case (an
  iPhone tab already foregrounded fires no event; iOS `window.focus` is unreliable). v2 also polls
  every 15s while the tab is visible, guarded by `updated_at` vs a `lastSeenAt` ref and a
  content-equality check so we never echo our own write, re-save identical data (which would
  ping-pong between two devices), or clobber unsaved local edits; `applyData(...,{keepPeriod:true})`
  leaves the viewed pay period alone. Still poll-based (~15s), not push.
- **Privacy-light analytics** (#10): `events` table + `track()`.
- **P1 hardening backlog done:** Pages publishes only the app files (not the whole repo); pdf.js worker
  hosted locally; SRI hashes on all 5 CDN scripts (verified byte-for-byte against the live CDNs);
  client error monitoring (`onerror` + `unhandledrejection` ring buffer + "Copy error log");
  free-tier guard (`MAX_BLOB_BYTES`). Leaked-password protection (HIBP) turned out to be Pro-only —
  the API silently ignores it on the free tier.
- Owner confirmed Google sign-in works end-to-end on a real iPhone.
- Free-tier headroom check: DB 11MB / 500MB.

## 2026-07-04 — RLS, auth URLs, first automated fix→re-review council run

RLS enabled on `user_data` with per-command policies `(select auth.uid()) = user_id` (subselect form
per the performance advisor). Supabase Auth Site URL and redirect allow list set to the github.io
address via the Management API (updated to badgebudget.com on 2026-09-02). First full council run
with the automated fix→re-review loop; its fixes are in `git log` around that date.

## Earlier

The app started as a Netlify-deployed single file, migrated to GitHub Pages (the deploy branch's
name still carries that migration), and fought a long iPhone infinite-spinner bug that produced the
boot-hardening invariants (watchdog, Supabase null-guard, 4s `getSession` race).
