# Scaling, burn and transferability (2026-09-07)

Owner-directed strategy session. This document answers three questions that turned out to be one
question: how far can BadgeBudget scale at zero or near-zero cost with no revenue and no capital;
what has to be true for it to survive being handed to someone else; and what a realistic exit looks
like if one ever presents itself.

The organizing principle is **transferability, not acquisition**. An acquirer, a successor
maintainer, and the owner returning after six months away all need the same things: the code builds
and deploys reproducibly, the data is lawfully held and lawfully transferable, ownership is
unambiguous, and the numbers that describe the product's health are computed rather than
remembered. Building for a buyer that may never come and building for your own future self are the
same work. That is why this document does not have an "exit prep" phase — the exit-readiness items
are the sustainability items, and they get done because the project needs them either way.

Facts about third-party platform limits were checked on 2026-09-07 and are cited. Re-verify before
acting on them; free-tier terms move.

## Where we actually are

Measured 2026-09-07 against the live project (`mnnlgcxnvodjwlhhiphq`):

| Metric | Value |
|---|---|
| `user_data` rows | 3 |
| Blob size, avg / max | 1,340 B / 1,434 B |
| `events` rows (since 2026-07-07) | 391, avg 249 B/row |
| Distinct devices (`anon_id`) | 123 |
| Devices active on more than one day | 7 |
| Devices still active 7+ days after first touch | 5 |
| Avg active days / app opens per device | 1.22 / 1.72 |
| Total database size | 12 MB |
| Auth users / 30-day MAU | 3 / 3 |

**Read the retention numbers honestly.** They are contaminated three ways: the owner's own testing,
the nightly Playwright harness, and the 2026-09-02 domain cutover, which minted a fresh `anon_id`
on every device and inflates the distinct-device count. So this is not evidence that the product
fails to retain. It is evidence that **there is no signal yet** — no stranger has demonstrably come
back a second time, and the sample is too small and too dirty to conclude anything either way. Every
projection below is arithmetic about capacity, not a forecast of demand. Do not confuse the two.

The blob is the other number worth absorbing: 1.4 KB against a `MAX_BLOB_BYTES` cap of 512 KB. Real
per-user data is roughly 0.3% of the guard. A mature user with two years of shifts, eight patterns
and a dozen goals might reach 20–40 KB. Everything downstream — egress, database growth, cost —
scales off that number, and it is tiny.

## What free actually buys, and what breaks first

Platform limits as of 2026-09-07: [Supabase Free](https://supabase.com/pricing) gives 500 MB
database, 5 GB egress, 50,000 MAU, 500K Edge Function invocations, no backups, and pauses a project
after a week of inactivity; Pro is $25/mo for 8 GB, 250 GB egress, 100,000 MAU, 2M invocations and
7-day backups, with overage priced at $0.125/GB database, $0.09/GB egress, $0.00325/MAU and
$2 per additional million invocations. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
is 1 GB site size and a **soft** 100 GB/month bandwidth limit. [Cloudflare Pages](https://developers.cloudflare.com/pages/platform/limits/)
free is 500 builds/month, 100 custom domains, 20,000 files, 25 MiB max asset, and does not meter
bandwidth or requests.

Modelling roughly one signed-in user per three total (anonymous users touch nothing but a 340 KB
static page load; `pdf.worker.min.js` is lazy — `index.html:3127` — so it is not in the base cost):

| Scale | What it needs | Monthly |
|---|---|---|
| Today | free everything | **$0** + ~$4 domains |
| 1,000 MAU | free works; Pro bought for backups, not capacity | **$0–25** |
| 10,000 MAU | Pro — or free, if L1 and L4 below are pulled | **$0–25** |
| 50,000 MAU | Pro + off GitHub Pages | **$25** |
| 100,000 MAU | Pro + ~$2 Edge Function overage | **~$30** |

**Roughly $400/year, domains included, to serve a hundred thousand nurses.** That is the real shape
of a static file plus a 1.4 KB blob. Cash burn is not a constraint on this project and will not
become one. Any effort spent optimising for cost below 10,000 users is misallocated.

Four things break before money does.

**Egress, from one design decision.** `index.html:2363` polls `loadCloudRow()` every 15 seconds
while the tab is visible and pulls the *entire row* each time — 240 full-blob fetches per tab-hour,
~2.5 KB each with overhead, ~600 KB per tab-hour per signed-in user. Free's 5 GB/month is therefore
~8,300 tab-hours, or roughly 800–1,000 signed-in users at 10 hours of app-open per month. At a
mature 20 KB blob that collapses to about 100 users. `index.html:4703` runs a second 15-second poll
returning the whole group board, so a 40-nurse unit is 40 tabs each re-fetching 40 people's posts
four times a minute — traffic that grows with the square of unit size, on precisely the subsystem
density strategy depends on.

**The failure mode is worse than the number.** On Free, exceeding a quota *restricts* the project
rather than billing for it. The app goes down on its best day — the day a post lands somewhere and
a thousand nurses arrive at once. Grassroots growth arrives clustered, which makes this more likely,
not less.

**No CI.** CLAUDE.md states it plainly: a JSX syntax error ships live. At 100 users that is
embarrassing; at 10,000 it is how the project ends, at 4am, from a nightly build whose gate did not
catch it. This is the single largest operational risk in the system and it is uncorrelated with
scale — it is equally true today.

**No backups.** Free tier holds real nurses' pay history with no point-in-time recovery. The $25 is
insurance against the only failure that is genuinely unrecoverable, and it should be bought long
before capacity requires it.

## Levers, with trigger thresholds

Each lever is cheap, pre-scoped, and pullable in an afternoon. The point of listing them with
triggers is that none of them should be *invented* under load. Carnegie's actual edge was not the
Bessemer converter — it was building capacity during downturns so it existed when demand arrived.
Three users and unlimited time is the downturn.

| # | Lever | Buys | Effort | Pull when |
|---|---|---|---|---|
| L0 | Cloudflare Pages instead of GitHub Pages | unmetered bandwidth; real response headers (fixes the `frame-ancestors` gap CLAUDE.md calls unavailable); control over cache policy | ~1 hr | before 50 GB/mo, or before any revenue (GitHub Pages ToS bars commercial/SaaS use) |
| L1 | Poll `updated_at` only; fetch the blob on change | ~100× egress cut; makes egress a non-issue permanently | ~1 hr | >200 signed-in DAU, or egress >2 GB/mo |
| L2 | Swap board: Realtime, or exponential backoff on an idle board | kills the O(n²) unit-size spike | ~half day (needs `wss://*.supabase.co` in CSP + table in `supabase_realtime`) | any group reaches 15 members |
| L3 | Supabase Pro | backups, 50× egress, 16× database | $25/mo | **>50 real users** — buy for recovery, not capacity |
| L4 | `pg_cron` retention/rollup on `events` | bounds the only unbounded table | ~1 hr | database >300 MB |
| L5 | Self-host the 5 CDN scripts | removes 4 external vendors and the SRI fragility; faster cold load | ~2 hrs (after L0) | any CDN incident, or before a density push |
| L6 | Cloudflare in front + Supabase rate limits | survives a traffic spike instead of being restricted by one | ~2 hrs | before any deliberate distribution attempt |

L0 and L1 together are about two hours and move the free-tier ceiling from ~1,000 signed-in users
to a number large enough that MAU and human support bind first. They are the highest-leverage work
in this document.

## Density is the metric, not DAU

The wage calculator is a feature, not a company. Any funded team — HealthStream, an earned-wage-access
player, a nurse staffing marketplace — reproduces the hero number in a sprint. Nothing about
`shiftGross`/`computeNet` is defensible, and volume of calculator users is therefore close to
worthless as an asset.

The one thing here that money cannot buy on demand is the swap board's **unit graph**: verified
nurses who actually work together, on identified units, with real swap liquidity. That is a
cold-start problem, and cold-start problems are what acquirers pay for. It follows that 20,000
nurses scattered across 5,000 hospitals is worth very little, while 2,000 nurses across 40 units
with live swap activity is worth a conversation.

This inverts the usual read on grassroots growth. Unit-by-unit spread through a group chat produces
density by construction; broad marketing produces breadth, which is the less valuable kind of growth
for this asset. The unpredictability of grassroots is a load-shape problem (see L2), not a strategy
problem.

**North-star metric: units with ≥10 members and ≥1 confirmed swap in the last 30 days.** As of
2026-09-07 that number is zero, and it is the entire thesis. Measured baseline: two groups exist
("riddle er 3-3's", created 2026-07-30, 2 members; "Courtney hosptial", created 2026-08-11, 1 member),
one active poster each, and **zero confirmed swaps ever**. Nothing about the density thesis has been
tested yet — a single real unit reaching ten members and closing one swap would be the first evidence
either way, and is worth more than any amount of calculator growth.

Computable today, owner-side, from the live schema (both queries below were run against the live
project on 2026-09-07 and return rows):

```sql
-- Density: group size, active posters, and confirmed swaps in the last 30 days.
with members as (
  select group_id, count(*) as members
  from public.swap_members group by group_id
),
posters as (
  select group_id, count(distinct author) as active_posters_30d
  from public.swap_posts
  where created_at > now() - interval '30 days'
  group by group_id
),
confirms as (
  select group_id, count(*) as confirmed_30d
  from public.swap_matches
  where status = 'confirmed' and created_at > now() - interval '30 days'
  group by group_id
)
select g.id, g.name, g.created_at::date as created,
       m.members,
       coalesce(p.active_posters_30d, 0) as active_posters_30d,
       coalesce(c.confirmed_30d, 0)      as confirmed_30d
from public.swap_groups g
join members m  on m.group_id = g.id
left join posters p on p.group_id = g.id
left join confirms c on c.group_id = g.id
order by m.members desc;
```

```sql
-- Liquidity: do proposed matches actually close? A board that proposes and never
-- confirms is a demo, not a market.
select status, count(*) from public.swap_matches
where created_at > now() - interval '90 days' group by status;
```

Two supporting metrics matter almost as much. **Time-to-first-confirmed-swap** for a new group is
the real onboarding metric — a unit that joins and never completes a swap has churned even if its
members still open the app. And the **confirmed/proposed ratio** distinguishes a working market from
a board where the matching algorithm suggests things nobody accepts.

One instrumentation gap, and it is deliberate: `events` carries no `group_id`, and it should not —
that would link a device to a unit and weaken the anonymity model documented in `docs/swap-board.md`.
Per-group activity therefore has to come from the swap tables themselves, as above, read owner-side.
Do not "fix" this by adding a group dimension to analytics.

## Retention: the thing you cannot reconstruct later

`events` carries both `user_id` and `anon_id` alongside `created_at`, so cohort retention is
computable from data already being collected. Nothing needs to be built. What is missing is the
retention itself, and the discipline of looking at it.

```sql
-- Weekly cohorts by first touch, with return rates. Exclude owner/harness traffic
-- before reading this seriously.
with first_seen as (
  select anon_id, min(created_at) as d0 from public.events
  where anon_id is not null group by anon_id
),
activity as (
  select f.anon_id, date_trunc('week', f.d0)::date as cohort,
         max((e.created_at::date - f.d0::date)) as last_day_offset,
         count(distinct e.created_at::date) as active_days
  from first_seen f join public.events e using (anon_id)
  group by 1, 2
)
select cohort,
       count(*) as devices,
       round(100.0 * count(*) filter (where last_day_offset >= 1)  / count(*), 1) as pct_d1_plus,
       round(100.0 * count(*) filter (where last_day_offset >= 7)  / count(*), 1) as pct_d7_plus,
       round(100.0 * count(*) filter (where last_day_offset >= 30) / count(*), 1) as pct_d30_plus,
       round(avg(active_days), 2) as avg_active_days
from activity group by cohort order by cohort;
```

Baseline run 2026-09-07, recorded so later runs have something to compare against:

| Cohort (week of) | Devices | D1+ | D7+ | D30+ | Avg active days |
|---|---|---|---|---|---|
| 2026-07-06 | 2 | 100.0% | 50.0% | 0.0% | 2.50 |
| 2026-07-13 | 2 | 100.0% | 100.0% | 50.0% | 8.00 |
| 2026-07-20 | 4 | 0.0% | 0.0% | 0.0% | 1.00 |
| 2026-07-27 | 6 | 16.7% | 16.7% | 0.0% | 1.83 |
| 2026-08-17 | 9 | 11.1% | 11.1% | 0.0% | 1.44 |
| 2026-08-24 | 5 | 0.0% | 0.0% | 0.0% | 1.00 |
| 2026-08-31 | 87 | 2.3% | 0.0% | 0.0% | 1.02 |
| 2026-09-07 | 10 | 0.0% | 0.0% | 0.0% | 1.00 |

The shape is the point, not the percentages. The July cohorts are tiny and almost certainly the owner
and close testers — they retain well because they are not strangers. The 87-device 2026-08-31 cohort
is the domain cutover: existing devices re-minted an `anon_id` on the new origin and mostly never
produced a second day, which is what drags the lifetime aggregate to 5.7%. **Neither end of that
range is a real retention rate.** The first honest reading of this table comes from a cohort of
strangers who arrived after 2026-09-02 and were never counted twice.

Two caveats to record with any reading of this. `anon_id` resets on origin change (the 2026-09-02
cutover is a discontinuity — cohorts before and after it are not comparable) and on cleared site
data, so device-level retention is a floor, not a true rate. Signed-in retention via `user_id` is
the honest number once there are enough signed-in users to compute it.

The reason this belongs in a scaling document: retention cannot be reconstructed retroactively. If
`events` rows are ever aggressively pruned by L4, **retention history is destroyed with them.** Any
retention job must roll up to daily per-cohort aggregates before deleting raw rows. That constraint
is the reason L4 is written as "retention/rollup" and not "delete."

## The handoff test

The question that governs every item below: *if this had to be handed to someone else on Monday —
a buyer, a maintainer, or you after six months on something else — what would be missing?*

**Reproducibility.** The harness is not in git. The Playwright rig, the 27-assertion swap-matching
suite and the RLS audit lived only in session scratchpads, which means the pass rates in the Done
log cannot be reproduced from the repository by anyone, including the owner. `supabase/migrations/`
is missing `000_core.sql` — the DDL and RLS for `user_data`, `feedback` and `events` exist only in
the live project, so the schema cannot be rebuilt from source. Both are already noted as open items
in CLAUDE.md; framed as transferability they are not housekeeping, they are the difference between
an asset and a running instance nobody can recreate. Commit the harness under `tests/`, add a CI job
running `node scripts/test_groom_seed.mjs` plus a Babel parse of the JSX block, capture the core
DDL, pin the four GitHub Actions to SHAs, and take `.mcp.json` off `@latest`.

**Ownership.** This is a personal repository built by an employee of a large bank. Invention-assignment
and outside-activity language in financial-services employment agreements is typically broad, and a
buyer's diligence finds this on day one. This is not legal advice and nothing here substitutes for
reading the actual agreement and, before any transaction, getting a lawyer's read on it. The point
for planning purposes is narrow: it costs nothing to know the answer now, and an unresolved
ownership question discovered late is the kind of thing that silently ends a deal rather than
repricing it. Resolve it before density work makes the project visible, not after.

**Lawful, transferable data.** The app collects wage figures, pathnames, user agents, a persistent
device identifier and, for signed-in users, an account — with no privacy policy and no terms of
service posted. CLAUDE.md already records that the `page` and `user_agent` columns on `feedback`
were undisclosed until 2026-09-02 and that keep-or-strip is an open product call. Two consequences.
Operationally, users cannot make an informed choice about data they do not know is collected.
Structurally, a buyer may be unable to lawfully receive user data that was collected without a
policy permitting transfer — and the user data *is* the asset. A short, honest privacy policy and
terms (what is collected, what is never collected, where it lives, how to delete it, that it may
transfer with the project) is a couple of hours of work and is the cheapest asset-protection
available. Include a working account-and-data deletion path; "email the owner" is not one at scale.

**Operational legibility.** CLAUDE.md and BACKLOG.md are genuinely strong here and are most of the
reason this project is handoff-able at all. The gap is that the nightly Routine
(`trig_019zkn8Z6Xu18t1B46iNMuwP`) exists nowhere in the repository — delete it and the loop stops
silently, and a successor would have no way to know it ever existed. Record the Routine's prompt and
configuration in the repo as documentation, even though the repo cannot recreate it.

**Concentration risk.** Everything runs through one Supabase project, one GitHub account, one
registrar, and one person's credentials. A second Supabase project for dev/test is already a parked
item; the broader version is knowing which single accounts, if lost, would end the project, and
whether recovery for each is documented somewhere other than one person's head.

## What an exit could realistically look like

The nearest comp is the one this repo already researched: HealthStream acquired NurseGrid in March
2020 for [$25M in cash](https://www.geekwire.com/2020/healthstream-pays-25m-acquire-portland-startup-nursegrid-maker-mobile-app-nurses/),
with [roughly 260,000 nurses as monthly actives](https://www.businesswire.com/news/home/20200309005857/en/HealthStream-Acquires-NurseGrid-1-Rated-and-Top-Downloaded-App-for-Nurses)
— about $96 per MAU.

**That multiple does not transfer, and anchoring on it is the main way to be wrong about this.**
NurseGrid sold a company: a team, a brand, the top App Store position among nurses, and critically a
second product (NurseGrid Enterprise) that handed the buyer a B2B wedge into nurse managers. A solo
web app with no entity, no team, no enterprise surface and no revenue trades at a fraction — call it
$5–25/MAU with demonstrated retention, and more realistically it is structured as an acqui-hire where
the number attached to the asset is small and the number attached to the person is a salary.

Plausible acquirer sets, for orientation only: HealthStream (already owns NurseGrid, so more likely
to copy than buy); earned-wage-access companies (DailyPay, Payactiv, Branch), for whom a take-home-pay
calculator is literally top-of-funnel; nurse staffing marketplaces (IntelyCare, Incredible Health,
Trusted, ShiftKey); and workforce-management vendors (QGenda, symplr, UKG).

The honest expected value of an acquisition is low, and the correct posture is the one the owner
already articulated from the conference: an exit plan is not a prediction, it is the discipline that
keeps the asset from decaying into something nobody can take over — including you. Sustainability
*is* the exit. Everything in the handoff test above pays for itself in a world where no buyer ever
appears, which is the most likely world.

## Non-goals

Recorded so they do not get re-litigated every session, and so a future reader knows they were
chosen rather than overlooked.

No revenue and no capital raising. Revenue is what would create the employer conflict, force an
entity, break GitHub Pages' terms, and convert a learning project into an obligation — for a sum of
money that is immaterial. No B2B or hospital sales motion, for the same reason plus the sales
capacity it would require. No infrastructure work justified by scale that has not arrived: the
levers above are scoped so they can be pulled on demand, and pulling them early is waste. No paid
marketing. And no change to the anonymity model in service of measurement.

## Sequencing

**Now, at three users** — the two-hour block that removes the operational cliff: commit the harness
and add the CI job; capture `000_core.sql`; write the privacy policy and terms; resolve the ownership
question. None of this depends on growth and all of it is harder later.

**Before any deliberate distribution** — L0 (Cloudflare Pages), L1 (conditional fetch), L6
(rate limits), and L3 ($25 for backups). Roughly a day, and it converts "we go down on our best day"
into "we survive our best day."

> **This trigger has already fired.** #75 (merged 2026-09-07, hours after this document was drafted)
> shipped the grassroots funnel: a reachable sign-in for returning users, a shareable QR in Settings
> with `navigator.share` and copy fallbacks, `?via=qr` / `?via=link` arrival tagging on `app_open`,
> and a base-rate-first onboarding path that reaches a real number without a full tax profile. That
> is a deliberate distribution mechanism, and it is live. The lever block above moved from "someday"
> to overdue the moment it merged — the app can now be handed to a stranger faster than it can
> survive a hundred of them arriving at once. **L3 in particular: the funnel exists, the backups do
> not.**
>
> One upside worth naming: arrival tagging means future cohorts can be segmented by acquisition
> channel, so the retention queries below can finally distinguish a nurse who scanned a colleague's
> QR from one who wandered in. That is exactly the cohort of strangers this document says is missing,
> and #75 is what makes it measurable.

**At the first real unit** — L2 before any group reaches 15 members, and start reading the density
and liquidity queries weekly. Time-to-first-confirmed-swap is the number that says whether the thesis
is real.

**At 10,000 users** — L4 with rollup-before-delete, L5, and a hard look at whether one person can
still hold support and swap-board moderation. That is the point where the constraint stops being
technical and becomes human, and it is worth deciding in advance what happens there.

## Where this is most likely wrong

The egress model assumes 10 tab-hours per signed-in user per month, which is a guess. If nurses leave
the app open through a shift, it is off by an order of magnitude in the expensive direction — which
only strengthens the case for L1.

The one-in-three sign-in ratio is invented. If the swap board drives sign-in (it requires auth), a
density strategy pushes that ratio much higher, and signed-in users are the only ones that cost
anything.

The density thesis assumes swap liquidity is achievable at unit scale at all. It may be that a
40-nurse unit simply does not generate enough overlapping give/want pairs to produce confirmed swaps
regularly, in which case the unit graph never becomes valuable and the whole acquisition frame
collapses. Time-to-first-confirmed-swap in a single real unit resolves this cheaply, and it should be
resolved before any effort is spent on exit readiness that is not also justified by sustainability.

And the retention baseline may be worse than the contaminated sample suggests rather than better. The
correct response to that is the same either way: measure it properly, and let the number decide how
much more to invest.

Finally, a maintenance note: the `index.html` line references in this document were correct at the
merge commit that introduced it and are cited to make the claims checkable, not because the numbers
are stable. They moved once already (#75 shifted all three within hours). Re-locate them by content —
`setInterval(refetch, 15000)`, `setInterval(load, 15000)`, `GlobalWorkerOptions.workerSrc` — rather
than trusting the numbers.
