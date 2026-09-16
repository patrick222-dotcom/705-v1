# History — decisions, incidents, resolved work

Dated record of what happened and why, moved out of `CLAUDE.md` on 2026-09-02 so the operating
file stays short. Newest first. The nightly loop's per-build record is `BACKLOG.md` → Done (log);
the swap board's own audit trail is `swap-board.md`.

## 2026-09-16 — the test harness was the app's largest user, and abandonment had no exit row

Two findings from a review of the live console, both of the same kind: a measurement that had
looked fine for months because the thing it was wrong about was invisible.

**The harness was writing to production analytics.** `tests/harness.mjs` rewrote the five CDN
`<script>` tags and stripped SRI in the scratch copy, but never touched `SUPABASE_URL`, so
`createClient` still pointed at `mnnlgcxnvodjwlhhiphq`. In the sandbox that failed silently — there
is no route out, and `supabase.co` was in the harness's own expected-failure list, which is exactly
the assumption that made it invisible. On a GitHub Actions runner the network is open and `ci.yml`
runs `smoke` on every push and pull_request, so each run inserted real `app_open` /
`setup_completed` / `shift_saved` rows under a fresh `anon_id` (a new browser context starts with
empty localStorage). The fingerprint is unmistakable once looked for: `app_open` rows 2–3 seconds
apart in bursts of three, every one carrying Playwright's iPhone 13 profile string
the internally inconsistent pair **`iPhone OS 15_0` + `Version/18.0`** — no real iPhone reports
Safari 18 on iOS 15.0. **291 rows across 251 devices, 232 of them a single event, first seen
2026-09-07**: the day `ci.yml` was added and `gate` + `smoke` became required checks. The seven
event names present are exactly the ones `tests/smoke.mjs` drives. (Match the pair, never a WebKit
build number: `AppleWebKit/605.1.15` is on every genuine iPhone in the table, and the first draft of
migration 006 matched a build number present in zero rows, so its `synthetic` flag silently
classified nothing until it was checked against the data.)

It compounded with a second defect. `scripts/dashboard_snapshot.sql:52` reads
`case when is_mobile then 'mobile'`, so a user agent *claiming* to be a phone is classified as, in
the file's own comment, "The real users" — the engagement check is short-circuited entirely. A test
suite therefore appeared in the dashboard as the audience. Contained by pointing the scratch copies
at an RFC 2606 `.invalid` host (and widening the scratch CSP by that one host, or the requests die
before Playwright can intercept them, which would have made the new assertions unfireable).
Historical rows are flagged `synthetic`, not deleted. **The classifier is not yet fixed and every
activation figure computed since 2026-09-07 is inflated** — re-baselining is queued.

The honest cut, insiders removed via `ops_admins`: **425 public devices ever, 4 completed setup, 5
saved a shift, 1 signed in, 26 ever fired anything past `app_open` — and all 26 have `days = 1`.**
Zero second-day returns, lifetime.

**Abandonment had no exit row.** Every event said something *happened*; none said what happened
**last**, or how long she stayed. For a device whose entire lifetime was one `app_open` — 416 of
424 public devices — the trail had one step and no ending, so "where did she give up?" was not a
hard question, it was an unanswerable one. `session_end` is that exit, fired from
`pagehide`/`visibilitychange` through `fetch(..., {keepalive:true})` because supabase-js issues an
ordinary fetch and an ordinary fetch at unload is cancelled — the `AbortError: … browsing context
is going away` already in `client_error` rows was the evidence sitting in plain sight. The same
sender now flushes the error ring buffer on unload, which is what makes that channel exist for the
public at all: it previously flushed only on the *next* load, and every public device is a
one-visit device, so all 13 `client_error` rows ever recorded came from 4 insider devices.

**And the funnel's first stage had never fired.** `obMax` was seeded at `0` and `goObStep` compares
`n > obMax.current`, so step 0 was rejected; and nothing called `goObStep(0)` on arrival anyway,
because Onboarding only reports a step when the nurse *moves*. Two independent reasons, both
silent. Every historical `ob_step` row starts at 1. The welcome-screen bounce — the most common
outcome in the data — was the one stage the event existed to measure and the only one it could not
see.

Shipped alongside: migration 006 (`ops_device_list()`, `ops_device()`) and the ops console's
**Devices** tab, which is the surface that finally answers the original question — every touch
point for one device, where it stopped, and whether the same device came back and stopped again,
split into numbered visits by a 30-minute gap. Design record: `docs/ops-console-scope.md` → *Phase
3b, as built*.

## 2026-09-16 — the council ran, in batches: 85 confirmed, 14 rejected, every lens below 8

The first full development council since 2026-07-30, and the first run of the committed workflow.
The run itself took four days, three usage windows and four rewrites of the script, and most of
what belongs here is about the process — that half is the meta-goal and the half that gets
dropped. The findings live in `docs/council-runs/2026-09-13/` (`synthesis.md` is the owner's
read; `status.md` the counts; `findings/<id>.json` every verified claim with its refuters' reasoning).

**The numbers.** 56 review cells (all 13 slices × the lenses that own them), 153 raw findings,
133 after per-lens dedup. Every one of the 99 medium-or-worse findings got three refuters: **85
confirmed, 14 rejected, 0 unverified**; the 34 lows were never agent-verified, by a stated rule.
Rejection rate 14% against the 2026-07-30 baseline's 6% (2 of 32), and the rejections were the
right ones — five of the seven data-integrity sync-race claims died because they restate the
documented last-writer-wins design.

| lens | confirmed | rejected | lows | score |
|---|---|---|---|---|
| wage-math | 6 | 0 | 9 | 4 |
| security | 9 | 0 | 6 | 2 |
| mobile-ux | 11 | 0 | 3 | 3 |
| accessibility | 25 | 0 | 2 | 2 |
| performance | 2 | 2 | 1 | 4 |
| data-integrity | 1 | 6 | 0 | 5 |
| code-quality | 17 | 6 | 8 | 4 |
| product-design | 8 | 0 | 1 | 3 |
| privacy-telemetry | 3 | 0 | 0 | 4 |
| cross-surface | 3 | 0 | 4 | 4 |

Every lens is below the 8 bar. Read the scores as "how much verified work is queued", not as a
verdict on the wage math: no confirmed finding shows `shiftGross` or `computeNet` producing a
wrong number for any input the UI can create. What the council found is five *surfaces* that
disagree with `computeNet` or present an averaged figure as certain (the hero "Taxes &
deductions" chip is uncapped; Add-Shift defaults to a differential she switched off; the pattern
lab averages across paychecks without saying so; a blanked multiplier coerces to 0×; the welcome
screen's sample figure is a literal that disagrees with `sampleNet()`), the swap board's anonymity
promise false as deployed (`poster_key` is recomputable from readable columns plus the committed
salt; `propose_swap` never checks the caller is a party), and three claims in `CLAUDE.md` the
council proved wrong: Google sign-in is the implicit flow, not PKCE; `ical-proxy` runs for the
public anon key, so it is an open proxy for allowlisted hosts; the swap board's anonymity is not
what the audit said it was. Plus a large, cheap accessibility and tap-target cleanup.

**Applied vs deferred.** Nothing applied yet, by the owner's choice: the synthesis goes to them
first ("review and adjust"). The synthesis splits the work into nightly-safe fixes, a
swap-board/infra hardening session, one wage-core session under the Invariant 3 protocol, and
three product calls. `BACKLOG.md` gets the wage-core items when the owner has read it.

### What the process taught

1. **A dead refuter is not a vote.** The first run lost every refuter to the usage limit and, because
   the script counted only refutes, reported all 25 findings as confirmed with an empty dissent
   list — a run that verified nothing, reporting 25 confirmations. The live-vote floor (two live
   verdicts or `unverified`) came from that.
2. **A full council does not fit one usage window, and the window is the account's.** The 56 review
   cells alone were one window (~9M subagent tokens, 3 hours on the two-slot box). Verification at
   three refuters per finding would have been three more. The owner uses the same account for chat
   and Cowork, so a full run is a spike that caps everything else. The answer was a ladder: batches
   sized to a fraction of a window, one per night.
3. **Batch state has to live in git.** The workflow's resume cache replays only an unchanged prefix
   of the call sequence (identical-content cells got different keys after a restructure), and the
   container that holds it is reclaimed between firings. Every stage now writes to
   `docs/council-runs/<date>/` and the next batch reads it back through `scripts/council_state.mjs`.
   Nothing was bought twice across four firings and two container generations.
4. **An unscoped refuter costs a review cell.** "Verify against the real code" sent each one through
   the 5,800-line file: 27 tool turns on average, against 45 for a full review cell. Scoped to the
   cited lines ±80 and three greps, the same refuters averaged four tool calls with no loss of
   rejections.
5. **Derived files lag inside a run.** `confirmed.json` is regenerated by `persist`, after the run.
   The first synthesis read the previous batch's 42-item file while its own run had just confirmed
   85, decided the scorers had over-counted, and ranked without everything batch 2b confirmed. The
   scorers had been fed the live verdicts and were right. Every stage now gets the authoritative
   id-by-status list inline; files are for finding *text* only. The synthesis was re-run once (11
   agents) with that fix.
6. **Frontier where a verdict is expensive, not everywhere.** Sonnet reviewers found the mobile and
   accessibility clusters fine; frontier refuters are what killed the plausible-but-wrong
   data-integrity claims and fought hardest over the wage-math ones (the paystub finding survived
   2–1 against a refuter that argued from the parser's single-stub design). The tier line is the
   four money/anonymity/data lenses plus the synthesis.
7. **Slot the batches by the account's rhythm, not the clock.** The 03:00 UTC slot sat on the tail
   of the owner's evening; batch 2a tripped the limit at 03:30 with a reset at 06:50. 07:00 UTC ran
   clean. The 08:00 nightly, a useful control, fired normally through all of it and shipped #109
   mid-ladder.
8. **Per-lens dedup bought less than expected** (153 → 133): the real duplicates were cross-lens —
   the hero chip was seen by three lenses — and those merge at synthesis, which is where the
   verified count should be read (85 verdicts, fewer distinct defects).
9. `Workflow({ name: 'council' })` did not resolve; `scriptPath` did. The charter says so now.

**What it cost.** Run 1 (as committed, all frontier): 5 agents, 0.96M tokens, died at 5 of 56 cells.
Run 2 (tiered): 76 agents, 9.0M, all 56 cells then died in verification. Batch 1: 105 agents,
8.3M, 45 min. Batch 2a: 34 of 44 agents, 3.0M, 28 min, cut off by the limit. Batch 2b+3: 171
agents, 12.1M, 40 min. Synthesis re-run: 11 agents. Roughly 400 completed agents and 34M raw
subagent tokens, the raw figure counting cached context re-reads at full weight (every agent carries
`CLAUDE.md`), so it overstates cost; the honest unit is "a batch fit in a window and the nightly
still ran".

## 2026-09-13 — account menu, feedback tiles, and three ways a test result can lie

Shipped in #96 (details in `BACKLOG.md` → Done): the avatar became the account menu at every width,
the feedback sheet grew four scaffolding tiles, and `feedback.kind` landed as migration 003. What
belongs *here* rather than in the Done log is the methodology, because the meta-goal is a reusable
review process and this session found three failure modes that produce results which look like proof
and are not. All three were caught only because the numbers were re-read rather than trusted.

**1. A run that aborts is not an assertion that failed.** The first instinct when negative-testing
"an outside tap closes the menu" is to delete the backdrop. That makes the test's own click target
vanish, so the run dies on a timeout. The rig scored it as caught; it proved only that the test
needs the element to exist, not that the assertion would notice a backdrop that is present and
inert. Every deletion-shaped break was redone as *present but broken* — backdrop with a no-op
`onClick`, Settings row wired to `pick(()=>{})`. Same trap in CSS: forcing `.topbar{min-width:600px}`
globally perturbed earlier steps at 390px and aborted, so the 360px overflow break had to live
*inside* the `≤360px` media query the assertion actually exercises.

**2. A timeout knob can invalidate every result at once.** `page.setDefaultTimeout()` caps
`page.goto`, not just element steps. A 4s step budget — chosen to make broken builds fail fast —
aborted the run on a *clean* build, and 16 breaks all reported "aborted". That reads like 16 catches
and is really zero. The tell was running the same timeout against an unbroken build; it failed too.
Navigation now carries its own 30s budget. **Rule: before believing a negative-test run, run the rig
once against a build with nothing broken and confirm it passes.**

**3. The rig must not patch the working tree.** The first version edited `index.html` in place, so
the repo was dirty for the whole run and any commit landing in that window would have captured a
deliberately broken build. It also could not be interrupted cleanly: a `SIGINT` was swallowed inside
`subprocess.run`, a force-kill skipped the `finally` that restores the file, and recovery was a
`git checkout` plus re-verifying content markers by hand. The `harness` skill *already said* "break
the thing on purpose in a scratch copy" — the guidance existed and was not followed. It now patches
an isolated `git archive HEAD` export, and the skill says why.

The enabling fix was making `tests/smoke.mjs` section-filterable (`SMOKE_ONLY=3,4`). One break went
from ~10 minutes to seconds, which is the whole difference between 31 assertions individually proven
and 3 proven with the rest waved through — the first draft of the Done log claimed "all 28
negative-tested" when the real number was 3, and that line was corrected before the commit, not
after. **For the council: a lens that reports a score without saying what it ran is reporting a
badge, not a result.**

Also of note: the deploy branch moved three commits mid-review and #98 put a share icon in the exact
`.top-actions` block #96 rewrites. They composed (both are new behaviour; the icons the menu replaced
live inside it), but resolving the conflict meant hand-editing the line #98's behaviour depends on —
so a new assertion proves the share icon still opens its sheet. A green suite for your own feature
does not protect the feature you merged past.

## 2026-09-13 — hStream ruled out for good; positioning is "build it better"

The owner closed the hStream question, which had sat as a conditional "revisit if this becomes a real
product" since 2026-07-07: **no.** The reasoning is worth keeping because it reframes the goal.

The original interest was never in a partnership for its own sake — it was the hope that HealthStream
published open docs and integrations so a nurse could *connect her own NurseGrid account* and move
between the two apps easily. That is not what hStream is. It is a gated B2B program over a health
system's authorized data, sold to health systems rather than to nurses, so the thing that would have
made it worth pursuing does not exist at any level of effort or spend. Waiting on it would have meant
blocking a feature on a business relationship.

Positioning instead: **be the better place for nurses to track shifts and trade them**, with the swap
board as the wedge — pseudonymous cross-nurse matching with anonymity enforced at the database layer
(column-level grants + security-definer RPCs) is something NurseGrid does not do at all.

**Do NOT read this as "no NurseGrid interop."** The two are different things and only one is dead:

| | Status |
|---|---|
| **hStream / HealthStream partner API** | **Dead.** Needs certification, contracts and a HIPAA BAA. Not being pursued. Don't re-scope it. |
| **NurseGrid `.ics` secret-URL feed** | **Live and shipped** (#50/#57). Needs no partnership — the nurse pastes her own feed address. The allowlist TODO for the NurseGrid feed host in `ical-proxy` is still wanted. |

Also settled the same day: BadgeBudget stores wage rates, shift schedules and PTO — a nurse's own
employment data, **not PHI**. No BAA is needed now or at scale, which is what made the email-provider
choice free of compliance constraints (see below). This holds only while the app never ingests a
health system's data — which is exactly what ruling out hStream guarantees.

**Founder email.** `pat@` and `courtney@badgebudget.com` on Migadu (~$19/yr, unlimited addresses
across all four domains, full IMAP) rather than Google Workspace ($168/yr for two seats). Workspace's
one real differentiator at this scale was that it signs a HIPAA BAA on every paid plan; with hStream
ruled out that stopped mattering. Three rules recorded with the choice: the Porkbun login stays on a
personal address (never `pat@badgebudget.com` — a domain whose DNS is broken cannot receive the
password reset that fixes it); there is exactly one SPF TXT record and a second one breaks SPF
entirely, so a new sender is merged into the existing line; and transactional mail (the Resend
feedback notifications) goes out from a `send.` subdomain so a spam-flagged blast can never damage
deliverability for the founders' own mail.

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
