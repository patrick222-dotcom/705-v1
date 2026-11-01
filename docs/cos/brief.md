# Brief — 2026-11-01

Oldest open decision: D3, merge PR #191 (dated pay items), 12 days, no default — and it no longer merges.
Courtney has not opened the app signed in since 10-20, the night it asked her to approve 125 shifts three times.
Every thread is stalled: nothing moved on gateway, legitimacy or personas in 12 days.
The weekly cabinet has run before but could not push its brief; that, not a missed Sunday, is the "CABINET MISSED".
Site is up and current (LIVE on be6cec2); no feedback, no errors, no S1 this week.

## Threads
- **T1 gateway** — step 1 of 8, unchanged since 10-07. Waits on a dedicated session. (`ls supabase/functions/` → no MCP server)
- **T2 legitimacy** — no terms page, no deletion spec; stalled 20 days because drafting is not a seat trigger. D4 fixes that.
- **T3 personas** — session 4 sits in #191: 4 conflicts, 14 commits behind (`git merge-tree`). A yes cannot land until it is rebased.

## Red flags
1. **The one real signed-in user went quiet.** Last signed-in event 2026-10-20 23:02 UTC; no calendar sync since. The
   "only sync when I tap" switch built for her has never been turned on by anyone (`ics_autosync_pref`: 0 rows, ever).
   One anonymous iPhone is the only other human, last seen 10-26. Unverified why — only asking her settles it.
2. **The cabinet routine cannot push.** Its 10-25 run wrote the brief and got a 403: the repo is not in its sources.
   Today's brief was written by hand. Until the routine has the repo, every Sunday repeats this.
3. **The nightly has had nothing to build for 9 nights** and has spent them on test-gate checks. Useful, but no thread moved.
4. **New, verified:** "Clear all data" leaves the calendar-feed link (a credential) in the database until the sign-in
   account is deleted (`index.html` clearAll deletes `user_data` only). Filed as tonight's nightly item — a tightening.

## Needs Pat
- **D3** — merge #191? No default (moves figures). Recommend yes; I rebase it first so your yes is one click.
- **D4** — let the nightly draft T2 (terms + deletion spec) as PRs for your review when the queue is empty? Default **yes on 11-08**.

## Inbox
All 21 open items given outcomes (13 were past 7 days): 18 parked as shipped, 3 attached. Inbox is empty.

## Off-plan this week
7 nightly gate-hardening merges (#199–#205), no thread. CFO's first page: `docs/finance/2026-11.md` — $4.34/mo, no trigger crossed.
Monthly spot check: #201's feed-URL redaction is live (served bytes = `be6cec2`; live function strips a `webcal://` path).
