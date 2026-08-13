# Reddit Insights → Personas → Crawler: Design Doc

**Status:** design (owner-approved direction 2026-08-13). Nothing here is built yet — this is the
plan the nightly crawler + an interactive session will implement in phases.

**Why:** the ScrubPay meta-goal (see `CLAUDE.md` → "Dual project goals") is to refine a reusable
multi-agent development council. Today the crawler grooms from one signal source — Supabase
`feedback` + `events` (2 real users, a handful of rows). That's thin. This pipeline adds a second,
much richer signal — real nurses talking about scheduling/swap/manager pain on Reddit — and turns
it into (a) backlog items and (b) grounded synthetic "tester" personas that exercise the app from a
nurse's point of view.

## Owner's decisions (2026-08-13)

| Fork | Decision | What it means here |
|---|---|---|
| Scope for the first session | **Design doc first** | This file. No skill/persona code shipped yet. |
| How the crawler reads Reddit | **Manual seed now** | Start from a curated seed corpus (below); wire the live Reddit API in later (Phase 3). |
| Where insights land | **Directly into `BACKLOG.md`** | The groom step auto-creates P0–P3 items from Reddit + persona signal. |
| Persona authority | **Can influence what ships** | Persona findings can drive the build queue and a deploy. |

> **The one invariant that overrides all of the above:** every build item — no matter its source
> (owner, Supabase feedback, Reddit, or a persona) — still has to pass the existing **safety gate**
> before it deploys, and still may **never** weaken boot hardening / SRI / wage-core (`CLAUDE.md` →
> "Autonomous nightly loop" rules). "Directly into backlog" and "can influence what ships" operate
> *inside* that gate, never around it. The gate is what keeps a hallucinated persona complaint or a
> noisy Reddit thread from ever gambling the live app real nurses use. This isn't walking back the
> owner's choices — it's the pre-existing rule that already governs 100% of deploys.

---

## Architecture (three stages)

```
            ┌─────────────────────┐
  Reddit    │ Stage 1             │   structured insights
  (seed →   │ Insight skill       │──────────────┐  {theme, signal, paraphrase,
   API)     │ scrubpay-reddit     │              │   mapped_feature, confidence}
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

## Stage 1 — the Reddit insight skill (`scrubpay-reddit`)

A Claude Code skill that, given the target subreddits + a query taxonomy, produces a **structured
insights digest** — not raw threads.

### Target subreddits (nurse scheduling / swap / manager pain)
Reddit has no dedicated "nurse scheduling" sub, so we keyword-filter *within* general nurse subs:

- **r/nursing** — the big one; the bulk of scheduling/manager/swap venting lives here.
- **r/AskNursing**, **r/NewToNursing / r/newgradnurse** — new-grad confusion (differentials, OT, how swaps work).
- **r/TravelNursing** — contract vs. staff pay, pickups, self-scheduling.
- **r/ICUnursing**, **r/emergencynursing** — high-differential, heavy night/weekend rotation.
- **r/nurses**, **r/CriticalCareNursing** — secondary.

### Query taxonomy (what we mine for)
1. **Shift swapping** — finding a partner, manager-approval bottleneck, swaps falling through, "no easy way to trade."
2. **Self-scheduling** — free-for-all scheduling, getting stuck with bad shifts, fairness of weekend/holiday rotation.
3. **Manager conflicts** — favoritism, last-minute changes, denied PTO/swaps, retaliation.
4. **Pay / differentials** — night/weekend/charge diff confusion, OT rules, "what's my actual take-home?", contract vs staff.
5. **Staffing / pickups** — mandatory OT, floating, picking up extra for money vs. protecting time.
6. **Tools they already use** — NurseGrid, ShiftMed/CareRev, Kronos/UKG, Smartlinx, QGenda — what they like/hate.

### Manual seed corpus (Phase 1, no Reddit access needed)
A committed `docs/reddit_seed.md` (or `.json`) capturing the well-established themes above as seed
insights, each in the Stage-1 output schema. This unblocks Stage 2 + personas immediately while the
live API is arranged. Seed entries are clearly marked `source: seed` (vs. `source: reddit-live`
later) so they can be refreshed/replaced.

### Live API path (Phase 3, needs owner action)
- **Reddit app:** owner creates a "script"-type app at reddit.com/prefs/apps → provides
  `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (+ a descriptive user-agent) into the Claude Code
  cloud **environment settings** (same pattern as the Supabase token — never committed).
- **Network policy:** allowlist `oauth.reddit.com` (and `www.reddit.com` for the token endpoint) in
  the environment network settings, or the egress proxy 403s the calls (same failure mode the
  Supabase Management API had).
- **Auth:** OAuth2 client-credentials → bearer token → `GET oauth.reddit.com/r/<sub>/search`.
- **Limits/ToS:** free tier ≈ 100 req/min, non-commercial, must send a real User-Agent. Read-only,
  public posts only. **Nightly cadence is well within limits.**

### Output schema (one insight)
```json
{
  "theme": "shift-swap-approval-bottleneck",
  "category": "shift-swapping",
  "signal": "recurring",                 // one-off | occasional | recurring | loud
  "paraphrase": "Nurses can't find swap partners and manager sign-off stalls trades for days.",
  "mapped_feature": "swap-board",        // which ScrubPay surface this touches (or 'new')
  "confidence": "high",
  "source": "seed"                        // seed | reddit-live
}
```
> **Privacy/ethics:** store **paraphrased aggregate themes only** — never verbatim post text,
> usernames, or anything that identifies a Redditor. We're mining *patterns*, not people.

---

## Stage 2 — crawler integration (the nightly GROOM gains a source)

The nightly **GROOM** phase (`CLAUDE.md` → "Autonomous nightly loop") today mines Supabase only.
It gains a step:

1. Run `scrubpay-reddit` (seed corpus in Phase 1; live API in Phase 3) → insights digest.
2. **Map insights → BACKLOG items directly** (owner's choice). Each auto-added item carries:
   - a **`source:` tag** (`reddit-seed`, `reddit-live`, `persona`, `feedback`, `owner`) and a
     one-line rationale, so provenance is always visible;
   - a **priority** (P0–P3) proposed from `signal` × `mapped_feature` impact;
   - **dedupe** against existing `todo`/`Done`/`Blocked`/`deferred` items (don't re-add the swap
     features already shipped, the sync P1, etc.).
3. Selection is unchanged: the crawler still builds the **single highest-priority, unblocked,
   gate-safe** item per run. An auto-added item that's risky/ambiguous is marked `deferred` — it
   entering the backlog automatically does **not** mean it auto-builds.

**Guardrail:** the groom writes auto-added items as `todo`, but the "gate-safe" test in the build
step is the filter. Reddit noise can populate the queue; only a gate-safe item ever ships.

---

## Stage 3 — grounded persona testers

Synthetic nurse personas whose traits come from the Stage-1 insights. Each persona is a subagent
seeded with a profile + a concrete task, told to use ScrubPay *as that nurse* and report friction.

### Persona schema
```
{ name, role/unit, shift_pattern, scheduling_pain, pay_situation,
  tech_comfort, tools_used, goals, likely_complaints }
```

### Starter personas (grounded in the seed themes)
1. **Night-shift Nadia** — ICU, 3×12 nights, juggles night+weekend+charge differentials; tech-
   comfortable; NurseGrid user. *Wants:* accurate take-home projection incl. stacked differentials.
2. **Float-pool Frank** — floats across units, differentials vary by assignment, unpredictable
   schedule. *Wants:* to model "if I pick up this shift, what's it worth?"
3. **New-grad Nia** — first year, fuzzy on differentials/OT, low confidence, easily confused by
   dense UI. *Wants:* hand-holding, plain language, no jargon.
4. **Swap-savvy Sam** — trades shifts constantly, hates the manager-approval + partner-finding
   friction; heavy swap-board user. *Wants:* fast, low-friction swaps; the join-with-a-code flow.
5. **Per-diem Priya** — PRN, picks up extra for money, compares options. *Wants:* quick pay
   comparison across potential pickups.
6. **Veteran charge Val** — charge differential, weekend rotation, skeptical of new apps, zero
   patience for bugs or slow calendars. *Wants:* it to just work; will bounce on jank.

### How personas test
- **Drive the iPhone-13 Playwright harness** (same one the safety gate uses) through their flow —
  onboarding, logging shifts, checking take-home, using the swap board — seeded via `localStorage`.
- **+ heuristic walkthrough** of `index.html` for their persona's concerns (clarity, jargon, missing
  affordances).
- **Output (structured):** `{ persona, task, friction[], bugs[], feature_gaps[], severity,
  reproducible_in_harness }`.

### How persona findings "influence what ships" — safely
The owner chose to let personas influence deploys. We make that safe with a **verification gate
between a persona's opinion and the build queue** (this is the analogue of the adversarial-verify
step the council already uses on its own findings):

- A **bug** finding influences a ship only if it **reproduces in the harness** (a failing probe we
  can add to the gate). Reproducible → it becomes a real, testable backlog item.
- A **feature-gap / friction** finding influences a ship only if it's **corroborated by the Reddit
  signal** (a real nurse theme, not one persona's invention). Corroborated → backlog item.
- Un-reproducible, un-corroborated persona opinions are logged as *candidate ideas* for human
  review, not built. **This is the guard against plausible-but-wrong synthetic feedback.**
- Whatever survives still competes for the one-per-run slot and still must pass the full safety
  gate. **Wage-math and boot hardening are never persona-overridable** — a persona can *ask* for a
  differential change; only correct wage logic ships.

---

## Safety & ethics rails (apply to every stage)

- **The safety gate is the backstop for all sources.** Boot hardening / SRI / wage-core stay
  untouchable regardless of who requested the change.
- **No PII / no verbatim Reddit content** stored or committed — paraphrased aggregate themes only.
- **Reddit ToS:** live access via the official API only, real User-Agent, non-commercial, read-only.
- **Provenance on everything:** every auto-added backlog item is `source:`-tagged so a human can see
  it came from Reddit/persona vs. a real user, and weight it accordingly.
- **Medical/pay correctness is never a matter of persona opinion.** Differentials, OT, and take-home
  math change only through verified wage-core logic that passes the gate's wage-math probes.

---

## Rollout phases

- **Phase 1 — seed + backlog wiring (no external deps).** Build `docs/reddit_seed.md` (curated
  themes in the Stage-1 schema) + teach the GROOM step to turn seed insights into source-tagged
  BACKLOG items with dedupe. Ship value immediately.
- **Phase 2 — persona harness (no external deps).** Build the 6 personas + a persona-runner that
  drives the existing Playwright harness and emits structured findings, with the verification gate
  (reproduce-or-corroborate) before anything reaches the build queue. Personas run off the seed
  corpus.
- **Phase 3 — live Reddit (needs owner).** Owner provides Reddit app creds + network allowlist;
  swap the seed corpus for live API mining on the nightly cadence. Personas auto-refresh from live
  themes.

## Owner to-dos (only needed for Phase 3)
1. Create a Reddit "script" app → send `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (never commit).
2. Allowlist `oauth.reddit.com` + `www.reddit.com` in the environment network settings.
3. (Optional) confirm the persona roster — add/remove/rename to match the real unit(s) you care about.

## Open questions for the owner
- **Cadence:** mine Reddit every nightly run, or weekly (themes move slowly; weekly may be plenty)?
- **Persona count:** 6 feels right to start — want more/fewer, or specific specialties?
- **Backlog volume:** cap how many auto-added items per night (e.g. ≤3) so the queue doesn't balloon?
