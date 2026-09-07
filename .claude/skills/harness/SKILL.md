---
name: harness
description: "Rebuild and drive BadgeBudget's Playwright test rig. Use when verifying a change end-to-end in a real browser, reproducing a mobile-only bug, adding a test assertion, investigating an iPhone rendering or boot problem, checking for React dev-mode warnings, or when the user says test it / drive the app / does it actually work on a phone. Also use before any deploy that touches rendering."
---

# Harness

The sandbox blocks the CDNs and Supabase but allows `registry.npmjs.org`, so the app cannot
be loaded as-is. The rig vendors the pinned packages, rewrites the five CDN `<script>` tags to
local paths **in a scratch copy only**, serves it, and drives it with Playwright's iPhone 13
profile. `index.html` is never modified, so running tests cannot damage Invariant 2 (SRI).

## Run it

```bash
npm install --no-save react@18.2.0 react-dom@18.2.0 @babel/standalone@7.24.7 \
  pdfjs-dist@3.11.174 @supabase/supabase-js@2.45.4 playwright-core@1.47.2
node tests/smoke.mjs
```

27 assertions. It resolves the sandbox browser at
`/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell` when that exists
and falls back to Playwright's own registry on a GitHub runner, so the same file runs in both
places. Override with `PW_CHROMIUM=/path/to/chrome`.

`tests/harness.mjs` holds the reusable parts: `vendor()`, `buildScratch()`, `serve()`,
`isExpectedNetwork()` and the seeded-state constants.

## What it already covers

Boot renders on an iPhone 13 profile; no non-network page errors; the wage-math probes; money
redaction on the error path; the error-buffer drain; the onboarding funnel; and both failure
modes — a hung `getSession()` still renders (the WebKit deadlock), and blocking Babel shows
the boot error screen naming Babel.

## Adding an assertion

Top-level function declarations in the Babel block become **globals**, so the real functions
are unit-testable directly:

```js
const out = await page.evaluate(() => shiftGross(50, {type:'flat',amount:5}, {hours:12, bonusType:'none'}));
ok('wage: 12h at $50 + $5 diff', out === 660);
```

Seed `localStorage['nursingWagePlannerData']` with `{setupComplete:true, baseRate:50}` to skip
onboarding — most flows are unreachable otherwise. `newPage()` does this for you; pass
`{seed:false}` to test the onboarding path itself.

**Negative-test every new assertion.** Break the thing on purpose in a scratch copy and confirm
the assertion fails. An assertion that has only ever passed proves nothing — that was the
original defect this rig was built to fix.

## Test failure modes, not just the happy path

The spinner bug was found by capturing `requestfailed`, not by looking at the screen. Every
context registers `pageerror` and `requestfailed`; `isExpectedNetwork()` filters the sandbox's
unavoidable Supabase/fonts failures so anything left is a real finding.

To simulate a dependency failing, `page.route('**/<file>', r => r.abort())`. To hang an API,
trap the global before the library assigns it — `tests/smoke.mjs` does this with a
`defineProperty` setter on `window.supabase` to make `getSession()` never resolve.

## The dev-build console diagnostic

Production React silences dev-only warnings — missing `key`, controlled/uncontrolled flips,
setState-on-unmounted, invalid nesting. Those are real defects that never surface as a
`pageerror`, so a clean smoke run does not rule them out.

`buildScratch(root, dir, {dev:true})` swaps in `react.development.js` and
`react-dom.development.js` (already vendored). Drive the real flows and capture `console`
messages of type `warning` and `error`. A clean run shows only the Babel in-browser
transformer notice and the sandbox connection resets. Last clean run: 2026-08-23.

## Still missing

The 27-assertion swap-matching suite (`te_swap_p2_algo.js`) and the RLS audit
(`rls_audit.js`, which mints throwaway confirmed users via the admin API) have never been in
git — the figures quoted for them in the Done log are not reproducible. Porting them into
`tests/` is open work. The swap board also needs live auth, so it is verified by the standard
in `docs/swap-board.md` rather than here.
