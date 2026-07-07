# ScrubPay — Nursing Wage Planner

Take-home pay planner for bedside nurses (built for the owner's wife and friends).
Live at: https://patrick222-dotcom.github.io/705-v1/

## Dual project goals

1. Ship a working, polished app.
2. **Meta-goal:** refine a reusable multi-agent "development council" process the owner
   wants to reuse on future projects. Council improvements requested: context
   preservation between agents, automated fix→re-review iteration until all agents
   score 8/10, less manual synthesis by the orchestrator, and real mobile testing
   (headless Chromium with iPhone emulation — see Testing below).

## Architecture

- **Single-file app**: everything lives in `index.html` — React 18 + Babel standalone
  (JSX transformed in-browser), no build step. Keep it single-file.
- CDN dependencies (pinned versions): React/ReactDOM 18.2.0 (unpkg), Babel standalone
  7.24.7 (unpkg), pdf.js 3.11.174 (cdnjs), supabase-js 2.45.4 (jsdelivr).
- **Data**: logged-in users → Supabase `user_data` table (one JSON blob per user,
  upserted, debounced 500ms). Anonymous users → localStorage (`nursingWagePlannerData`).
- **Auth**: Supabase email/password + Google OAuth. Project ref: `mnnlgcxnvodjwlhhiphq`.
- **Boot hardening** (do not remove): plain-JS boot watchdog in `index.html` shows an
  error screen if the app hasn't rendered in 8s; Supabase client creation is
  null-guarded (app degrades to localStorage-only if the CDN script fails);
  `getSession()` is raced against a 4s timeout (known WebKit deadlock — iPhone Chrome
  is WebKit too). These fixed a long-standing infinite-spinner bug on iPhones.

## Deployment

- GitHub Pages via `.github/workflows/deploy.yml`.
- **This repo has no `main` branch.** The de facto default branch is
  `claude/migrate-to-github-deploy-3F5RD` and it is deliberately in the workflow's
  push triggers. If you remove it before a `main` branch exists, all deploys stop
  (this happened once). When work is eventually merged to `main`, remove it.

## Supabase MCP

- `.mcp.json` runs `@supabase/mcp-server-supabase` and expects `SUPABASE_ACCESS_TOKEN`
  as an environment variable (set in the Claude Code cloud environment settings —
  never commit the token). If MCP tools are available, use them directly instead of
  giving the owner dashboard instructions.
- **Network policy must allow `api.supabase.com`** (environment network settings) or
  both the MCP server and direct Management API calls get 403 from the egress proxy.
  Env vars and network policy load at container start. If MCP started without the
  token, the Management API via `curl` works as a fallback (POST
  `/v1/projects/<ref>/database/query` for SQL, GET/PATCH `/v1/projects/<ref>/config/auth`
  for auth settings, GET `/v1/projects/<ref>/advisors/{security,performance}`).

## Pending tasks (check before starting new work)

1. ~~RLS~~ **Done 2026-07-04**: RLS enabled on `user_data` with per-command policies
   `(select auth.uid()) = user_id` (subselect form per the performance advisor).
2. ~~Supabase Auth URL config~~ **Done 2026-07-04**: Site URL set to
   `https://patrick222-dotcom.github.io/705-v1/`, redirect allow list to
   `https://patrick222-dotcom.github.io/705-v1/**` via Management API.
3. Verify Google sign-in end-to-end on a real iPhone (config is now correct; needs a
   human with a phone).
4. Rerun the improved agent council against the app (owner's standing request) —
   first full run with the automated fix→re-review loop done 2026-07-04, see
   `git log` for the fixes it produced.
5. P1 backlog: deploy only `index.html` (not the whole repo) in the Pages artifact,
   host pdf.js worker locally, SRI hashes (previous attempt broke the site — verify
   hashes carefully), error monitoring, Supabase free-tier warnings. Note: leaked
   password protection (HIBP) is Pro-plan only — the API silently ignores it on the
   free tier.

## Testing (no device needed)

Chromium + Playwright are pre-installed (`executablePath: '/opt/pw-browsers/chromium'`).
The sandbox blocks CDNs/Supabase by default, but `registry.npmjs.org` is allowed:
download the pinned packages from npm, rewrite the script tags in a scratch copy of
`index.html` to local paths, serve with `python3 -m http.server`, and drive it with
Playwright using the iPhone 13 device profile. Capture `console`, `pageerror`, and
`requestfailed` events — this is how the mobile spinner bug was found. Test failure
modes too (block a script, hang `getSession()`), not just the happy path.
