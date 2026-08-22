# Reddit Insights → Personas → Crawler: Design Doc

**Status:** live (Phases 1–2 shipped; Phase 3 re-scoped 2026-08-22). Originally drafted 2026-08-13
in PR #29 and never merged, which left every reference to this file dangling — the nightly agent was
told to follow a spec it could not read. Landed here with Phase 3 rewritten to match reality.

**Why:** the ScrubPay meta-goal (see `CLAUDE.md` → "Dual project goals") is to refine a reusable
multi-agent development council. The crawler originally groomed from one signal source — Supabase
`feedback` + `events` (a couple of real users, a handful of rows). That's thin. This pipeline adds a
second, much richer signal — real nurses talking about scheduling/swap/manager pain on Reddit — and
turns it into (a) backlog items and (b) grounded synthetic "tester" personas that exercise the app
from a nurse's point of view.

## Owner's decisions (2026-08-13)

| Fork | Decision | What it means here |
|---|---|---|
| Scope for the first session | **Design doc first** | This file. |
| How the crawler reads Reddit | **Manual seed now** | Curated seed corpus first; live API later (Phase 3). |
| Where insights land | **Directly into `BACKLOG.md`** | The groom step auto-creates P0–P3 items. |
| Persona authority | **Can influence what ships** | Persona findings can drive the build queue and a deploy. |

> **The one invariant that overrides all of the above:** every build item — no matter its source
> (owner, Supabase feedback, Reddit, or a persona) — still has to pass the existing **safety gate**
> before it deploys, and still may **never** weaken boot hardening / SRI / wage-core (`CLAUDE.md` →
> "Autonomous nightly loop" rules). "Directly into backlog" and "can influence what ships" operate
> *inside* that gate, never around it. The gate is what keeps a hallucinated persona complaint or a
> noisy Reddit thread from ever gambling the live app real nurses use.

---

## Architecture (three stages)

```
            ┌─────────────────────┐
  Reddit    │ Stage 1             │   structured insights
  (seed +   │ Insight intake      │──────────────┐  {theme, signal, paraphrase,
   owner)   │ docs/reddit_seed    │              │   mapped_feature, confidence}
            └─────────────────────┘              │
                                                 ▼
            ┌─────────────────────┐      ┌───────────────────┐
            │ Stage 3             │      │ Stage 2           │
            │ Grounded personas   │◀─────│ Crawler GROOM     │──▶ BACKLOG.md
            │ (traits from Reddit)│ seed │ (nightly)         │    P0–P3 items
            └─────────┬───────────┘      └───────────────────┘    (source-tagged)
                      │ drive the iPhone-13 harness / heuristic review
                      ▼
            findings ─▶ VERIFY (reproduce in harness OR corroborated by Reddit)
                      ─▶ BACKLOG ─▶ one-per-run BUILD ─▶ SAFETY GATE ─▶ deploy
```

---

## Stage 1 — insight intake

Produces a **structured insights digest** — never raw threads — into `docs/reddit_seed.json`.

### Target subreddits

**Corrected 2026-08-22:** the original list named two communities that don't exist (or aren't
public). Verified working set:

- **r/nursing** — the big one; the bulk of scheduling/manager/swap venting lives here.
- **r/newgradnurse** — new-grad confusion (differentials, OT, how swaps work).
- **r/TravelNursing** — contract vs. staff pay, pickups, agency payroll.
- **r/emergencynursing** — high-differential, heavy night/weekend rotation.
- **r/asknurses** (small) — replaces the non-existent r/AskNursing.
- **r/IntensiveCare** — replaces the non-existent r/ICUnursing.

### Query taxonomy (what we mine for)
1. **Shift swapping** — finding a partner, manager-approval bottleneck, swaps falling through.
2. **Self-scheduling** — free-for-all scheduling, bad-shift lottery, weekend/holiday fairness.
3. **Manager conflicts** — favoritism, last-minute changes, denied PTO/swaps.
4. **Pay / differentials** — night/weekend/charge diff confusion, OT rules, real take-home.
5. **Staffing / pickups** — mandatory OT, floating, extra shifts vs. protecting time.
6. **Tools they already use** — NurseGrid, ShiftMed/CareRev, Kronos/UKG, Smartlinx, QGenda.

### Output schema (one insight)
```json
{
  "id": "swap-channel-manager-visibility",
  "theme": "one line: what the pain is",
  "category": "shift-swapping",
  "signal": "recurring",                 // one-off | occasional | recurring | loud
  "paraphrase": "2-3 sentences in our own words",
  "mapped_feature": "swap-board",        // ScrubPay surface this touches (or 'new')
  "keywords": ["swap approval", "manager veto"],
  "confidence": "high",
  "source": "reddit-owner",              // seed | reddit-owner | reddit-live
  "observed": "how widely it was actually seen"
}
```

`observed` is required in practice for anything owner-gathered: it's what separates a real pattern
from one loud thread, and it gets rendered into the backlog line so a human can weigh it.

> **Privacy/ethics:** store **paraphrased aggregate themes only** — never verbatim post text,
> usernames, hospital names, or anything that identifies a Redditor. We're mining *patterns*, not
> people. Read-only: no votes, comments, DMs, or joins.

---

## Stage 2 — crawler integration

The nightly **GROOM** phase runs `node scripts/groom_seed.mjs --apply`, which:

1. Validates every insight against the schema (bad signal/source/id/keywords fail loudly).
2. Dedupes each theme against the **known corpus** (CLAUDE.md + BACKLOG.md, with its own managed
   block stripped so last night's candidates don't match themselves and erode to nothing).
3. Rewrites the idempotent managed block with source-tagged, priority-proposed candidates
   (`loud`→P1, `recurring`→P2, `occasional`/`one-off`→P3).

Selection is unchanged: the crawler still builds the **single highest-priority, unblocked,
gate-safe** item per run. Entering the backlog automatically does **not** mean it auto-builds.

**Known defect (open, pinned by a test):** coverage is decided by keyword hits against the whole
known corpus, so a theme merely *narrated in the Done log as deferred* counts as covered and
silently drops out of the candidate set. `self-schedule-fairness` is the live example. The obvious
fix — reduce the Done log to its bolded shipped titles — regresses genuinely-shipped themes
(`swap-partner-discovery` reappears), so this needs real thought, not a quick patch.

---

## Stage 3 — grounded persona testers

Synthetic nurse personas whose traits come from the Stage-1 insights, in
`docs/reddit_personas.json` (6 personas, curated 2026-08-17). Each seeds a subagent that uses
ScrubPay *as that nurse* and reports friction.

### How personas test
- **Drive the iPhone-13 Playwright harness** (the same one the safety gate uses) through their flow.
- **+ heuristic walkthrough** of `index.html` for that persona's concerns.
- **Output:** `{ persona, task, friction[], bugs[], feature_gaps[], severity, reproducible_in_harness }`.

### The verification gate — how persona findings influence a ship, safely
- A **bug** finding influences a ship only if it **reproduces in the harness**.
- A **feature-gap / friction** finding influences a ship only if it's **corroborated by the Reddit
  signal** (a real nurse theme, not one persona's invention).
- Un-reproducible, un-corroborated persona opinions are logged as *candidate ideas*, not built.
  **This is the guard against plausible-but-wrong synthetic feedback.**
- **Wage-math and boot hardening are never persona-overridable.**

Track record: passes on 2026-08-17 and 2026-08-21 produced six shipped items.

---

## Phase 3 — live Reddit (RE-SCOPED 2026-08-22)

**The original plan is dead.** It assumed the owner could self-register a "script" app at
reddit.com/prefs/apps and drop `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` into the environment.
Reddit closed self-serve registration under its **Responsible Builder Policy** (introduced Nov 2025,
updated June 2026). All new Data API access now requires a manually-reviewed support ticket:
approval takes weeks, can be denied without a stated reason, and there is no appeal. The
`/prefs/apps` page now routes developers toward Devvit, which builds apps that run *inside* Reddit
and cannot be called from a container.

Verified from this environment 2026-08-22: egress to Reddit is **not** the blocker —
`www.reddit.com/api/v1/access_token` returns 401 (Reddit answering, no creds) and unauthenticated
`search.json` returns 403 (Reddit blocking datacenter IPs). Credentials are the only gap, and they
are gated behind approval.

### Phase 3-alt — owner-mediated intake (ACTIVE, this is how it works now)

The owner browses Reddit in their own logged-in browser using **Claude in Chrome**, which reads as a
human reader rather than a server-side scraper. It returns paraphrased aggregate themes in the
Stage-1 schema, tagged `source: reddit-owner` with an `observed` count. Those are folded into
`docs/reddit_seed.json` and the nightly groom picks them up with no further work.

The reusable browser prompt lives in `docs/reddit_intake_prompt.md`. First run (2026-08-22) returned
7 new themes across swapping, self-scheduling, pay, tools, and manager conflicts.

**Why this is the right shape anyway:** a human decides what's worth reading, and the agent only
ever sees paraphrases. No credential to leak, no approval queue, no ToS ambiguity about automated
collection — and the `observed` field makes signal strength auditable in a way a raw API count isn't.

**If Phase 3 proper is ever wanted:** file the non-commercial Data API request describing ScrubPay
as a personal, non-commercial tool, and if approved swap the intake for `oauth.reddit.com` mining on
a weekly cadence. Nothing downstream changes — `reddit-live` is already a valid source.

---

## Open questions for the owner
- **Cadence:** how often to run the browser intake? Themes move slowly; monthly may be plenty.
- **Backlog volume:** cap auto-added items per run (e.g. ≤3) so the queue doesn't balloon? The queue
  currently holds 18 unbuilt candidates, so this is becoming real.
- **Persona roster:** 6 personas — add/remove to match the units you care about?
