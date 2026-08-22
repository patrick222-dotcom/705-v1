# Reddit intake prompt (for Claude in Chrome)

Paste the block below into **Claude in Chrome** while logged into Reddit. It reads as a human
reader in the owner's own browser — no API credential, no approval queue (see
`docs/reddit-persona-pipeline.md` → Phase 3-alt for why this replaced live API mining).

Paste whatever it returns back into a Claude Code session. The agent validates it against the
Stage-1 schema, dedupes it, and folds it into `docs/reddit_seed.json`.

**Keep the "already covered" list current** — regenerate it with:

```
node -e "console.log(JSON.parse(require('fs').readFileSync('docs/reddit_seed.json')).insights.map(i=>i.id).join(', '))"
```

---

```
You're gathering research themes for ScrubPay, a take-home-pay planner for bedside
nurses (logs shifts + differentials, projects a paycheck, has an anonymous shift-swap
board). I need to know what nurses actually complain about so the backlog reflects
real pain, not guesses.

## What to do

Browse these subreddits and read what's active — sort by top/week and hot, and use
the search box for the query terms below:

  r/nursing (the main one), r/newgradnurse, r/TravelNursing, r/emergencynursing,
  r/asknurses, r/IntensiveCare

Search across these six areas:
  1. Shift swapping — finding a partner, manager sign-off, trades falling through
  2. Self-scheduling — the login race, weekend/holiday fairness, getting stuck
  3. Manager conflicts — last-minute schedule changes, denied PTO, favoritism
  4. Pay/differentials — night/weekend/charge diff confusion, OT rules, "what's my
     actual take-home?", contract vs staff
  5. Staffing/pickups — mandatory OT, floating, is-this-shift-worth-it
  6. Tools — NurseGrid, ShiftMed, CareRev, Kronos/UKG, Smartlinx, QGenda: what they
     like and hate

Read enough threads to judge how OFTEN something comes up. One person venting is not
a theme. I care about the difference between "someone mentioned this once" and "this
is the fourth thread this week."

## Rules — these matter

- Paraphrase AGGREGATE patterns only. Never copy post or comment text verbatim.
- Never record usernames, subreddit-specific handles, hospital names, or anything
  identifying a person. I'm mining patterns, not people.
- Don't interact — no votes, comments, DMs, or joins. Read only.
- If a theme is thin, say it's thin. Don't inflate a single post into "recurring."
- If a subreddit above doesn't exist or is private, say so rather than substituting
  silently.

## Already covered — do NOT return these

Only return something genuinely NEW, or an existing theme where you saw a distinctly
different angle (say which one and how it differs):

swap-partner-discovery, swap-manager-approval-bottleneck, swap-falls-through,
self-schedule-fairness, schedule-to-paycheck-preview, last-minute-schedule-
changes, pto-denials-blackouts, differential-stacking-confusion, overtime-
rules-confusion, take-home-vs-gross, contract-vs-staff-comparison, pickup-
worth-decision, mandatory-ot-floating-tracking, nursegrid-schedule-reentry,
employer-app-fatigue-simplicity, missed-break-auto-deduction-pay-loss,
schedule-predictability-anchor-day, swap-channel-manager-visibility, swap-
eligibility-hidden-rules, employer-calendar-sync-unreliable, agency-payroll-
dispute-delay, off-duty-manager-contact-boundary

## Output

A JSON array in a code block, nothing else after it. One object per NEW theme:

{
  "id": "kebab-case-slug",
  "theme": "one line, what the pain is",
  "category": "shift-swapping | self-scheduling | manager-conflicts | pay-differentials | staffing-pickups | tools",
  "signal": "one-off | occasional | recurring | loud",
  "paraphrase": "2-3 sentences describing the pattern in your own words",
  "mapped_feature": "swap-board | paycheck-projection | shift-logging | overtime-flag | differentials | day-events-pto | ics-import | mobile-ux | new",
  "keywords": ["4+ character terms nurses actually use for this"],
  "confidence": "low | medium | high",
  "source": "reddit-owner",
  "observed": "how many distinct threads/comments you saw this in, and roughly what date range"
}

Calibrate `signal` on what you actually saw: loud = it dominates, people repeat it
constantly; recurring = multiple independent threads; occasional = a few scattered
mentions; one-off = one person. `confidence` is how sure you are the pattern is real,
not how strongly people feel.

Then, below the JSON, give me 3-4 sentences on anything notable that didn't fit the
schema — a tool I didn't ask about, a shift in how people talk about pay, a feature
someone wished existed.
```

## Note on keywords

`keywords` drive the dedupe in `scripts/groom_seed.mjs`: tokens under 4 normalized characters are
ignored, and 2+ hits against CLAUDE.md + BACKLOG.md mark a theme "already covered." Terms that are
too generic will cause a genuinely new theme to be silently swallowed — if that happens, tighten
the keywords rather than the corpus.
