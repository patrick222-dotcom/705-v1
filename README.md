# BadgeBudget — Shift Pay Planner

Take-home pay planner for bedside nurses: log shifts and differentials, see what a shift is worth
before you work it, keep your schedule in sync from a calendar's secret iCal address (or import and
export `.ics` files), track savings goals, and swap shifts anonymously within your unit.

**Live:** https://badgebudget.com — the old `patrick222-dotcom.github.io/705-v1` URL redirects there.

## How it's built

- One file. `index.html` is the whole app: React 18 + Babel standalone, JSX transformed in the
  browser, no build step. CDN dependencies are version-pinned with SRI hashes; the pdf.js worker is
  served from this repo.
- Supabase (email/password + Google sign-in) stores signed-in users' data; anonymous users stay in
  localStorage. Feedback and coarse analytics go to insert-only tables. Calendar auto-sync goes
  through a small Edge Function proxy (`supabase/functions/ical-proxy`) with its own owner-only table.
- The working agreement for humans and agents — invariants, architecture, the nightly loop, testing —
  is `CLAUDE.md`. Design notes, the swap-board security model, domain/DNS facts and the project
  history are under `docs/`.

## Deployment

GitHub Pages via `.github/workflows/deploy.yml`. A push to `claude/migrate-to-github-deploy-3F5RD`
(the deploy branch — there is no `main` yet) publishes exactly three files, `index.html`,
`pdf.worker.min.js` and `CNAME`, and is live in about a minute. `CNAME` carries the custom domain
and must stay in that list.

## Local development

Serve the directory (`python3 -m http.server`) and open `index.html`; opening the file directly also
works, apart from the same-origin pdf.js worker. The device-emulation test harness (Playwright,
iPhone 13) is described in `CLAUDE.md` → Testing.

## Backlog

`BACKLOG.md` is groomed and built from nightly by an autonomous loop; see `CLAUDE.md` → Autonomous
nightly loop for how an item gets from there to production.
