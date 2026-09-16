/* The nightly gate, made reproducible.
 *
 *   node tests/smoke.mjs
 *
 * CLAUDE.md's gate has four mechanical clauses — boot happy renders, getSession hanging still
 * renders, blocking Babel shows the boot error screen, no non-network page errors — plus the
 * wage-math probes. Those numbers have been reported in the Done log for months from a rig that
 * only ever existed in session scratchpads, which means no one could reproduce them. This is that
 * rig, in git.
 */
import { chromium, devices } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, existsSync, readFileSync } from 'node:fs';
import { buildScratch, serve, isExpectedNetwork, SEEDED_STATE, STORAGE_KEY } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, '.harness-scratch');
/* The remote sandbox ships a browser at a fixed path; GitHub's runners get one from
   `npx playwright install chromium`, which playwright-core resolves on its own. Use the
   explicit path only when it actually exists so the same file runs in both places. */
const BROWSER = process.env.PW_CHROMIUM
  || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const LAUNCH = existsSync(BROWSER)
  ? { executablePath: BROWSER, args: ['--no-sandbox'] }
  : { args: ['--no-sandbox'] };

/* SMOKE_ONLY=3,4 runs just those sections. This exists for negative testing: proving an assertion
   actually fails when its invariant is broken means one full run per break, and re-running all six
   sections for a break that can only affect one burns ~10 minutes a piece. SMOKE_TIMEOUT shortens
   Playwright's 30s default so a deliberately broken build fails fast instead of waiting it out.
   Unset, both default to the full suite at normal timeouts — CI is unaffected. */
const ONLY = (process.env.SMOKE_ONLY || '').split(',').map((x) => x.trim()).filter(Boolean);
const want = (n) => !ONLY.length || ONLY.includes(String(n));
const STEP_TIMEOUT = Number(process.env.SMOKE_TIMEOUT || 0);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

const newPage = async (browser, url, { seed = true } = {}) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  /* Navigation keeps its own generous budget: setDefaultTimeout caps page.goto too, and this app
     boots through an in-browser Babel transform of ~315KB, which is nowhere near a step. */
  if (STEP_TIMEOUT) { page.setDefaultTimeout(STEP_TIMEOUT); page.setDefaultNavigationTimeout(30000); }
  const errors = [], failures = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => failures.push(`${r.url()} ${r.failure()?.errorText || ''}`));
  if (seed) {
    await page.addInitScript(([k, v]) => {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
    }, [STORAGE_KEY, SEEDED_STATE]);
  }
  return { ctx, page, errors, failures, url };
};

const run = async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  buildScratch(ROOT, SCRATCH);
  const { server, url } = await serve(ROOT, SCRATCH);
  const browser = await chromium.launch(LAUNCH);

  /* ---- 1. boot happy path ------------------------------------------------------------- */
  if (want(1)) {
    const { ctx, page, errors, failures } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15000 }).catch(() => {});
    const rendered = await page.locator('#root').evaluate((n) => n.childElementCount > 0);
    ok('boot: app renders on iPhone 13', rendered);

    const real = errors.filter((e) => !isExpectedNetwork(e));
    ok('boot: no non-network page errors', real.length === 0, real.join(' | '));
    const badNet = failures.filter((f) => !isExpectedNetwork(f) && !f.includes('favicon'));
    ok('boot: no unexpected request failures', badNet.length === 0, badNet.slice(0, 2).join(' | '));

    /* ---- wage-math probes: top-level declarations are globals ------------------------ */
    const wage = await page.evaluate(() => ({
      base: hourlyRate(50, null),
      mult: hourlyRate(50, { type: 'multiplier', amount: 1.5 }),
      pct: hourlyRate(50, { type: 'percent', amount: 10 }),
      flat: hourlyRate(50, { type: 'flat', amount: 5 }),
      plain: shiftGross(50, null, { hours: 12, bonusType: 'none' }),
      withDiff: shiftGross(50, { type: 'flat', amount: 5 }, { hours: 12, bonusType: 'none' }),
      ot: shiftGross(50, { type: 'flat', amount: 5 }, { hours: 12, bonusType: 'none', isOvertime: true }),
      charge: shiftGross(50, null, { hours: 12, bonusType: 'charge' }),
      custom: shiftGross(50, null, { hours: 12, bonusType: 'custom', customBonus: '100' }),
      net: computeNet(1000, { ficaType: 'standard', federalTaxRate: 12, stateTaxRate: 5,
        pretaxDeductions: 100, posttaxDeductions: 50, customWithholdings: [] }),
    }));
    ok('wage: hourlyRate base', wage.base === 50);
    ok('wage: hourlyRate multiplier 1.5x', wage.mult === 75);
    ok('wage: hourlyRate percent +10%', near(wage.pct, 55));
    ok('wage: hourlyRate flat +$5', wage.flat === 55);
    ok('wage: shiftGross 12h @ $50', wage.plain === 600);
    ok('wage: shiftGross 12h @ $50 + $5 diff', wage.withDiff === 660);
    ok('wage: OT pays 1.5x the DIFFERENTIAL-inclusive rate', wage.ot === 990,
      `expected 990 (55*1.5*12), got ${wage.ot}`);
    ok('wage: charge bonus $3/hr stacks', wage.charge === 636);
    ok('wage: custom bonus is flat, not per-hour', wage.custom === 700);
    ok('wage: computeNet FICA on gross, income tax on gross-pretax',
      near(wage.net.fica, 76.5) && near(wage.net.fed, 108) && near(wage.net.st, 45) && near(wage.net.net, 620.5),
      `fica=${wage.net.fica} fed=${wage.net.fed} st=${wage.net.st} net=${wage.net.net}`);

    /* ---- new: money redaction on the error path -------------------------------------- */
    const red = await page.evaluate(() => ({
      dollars: redactMoney('take-home $1,234.56 for the period'),
      bare: redactMoney('parsed 3951.22 from the stub'),
      code: redactMoney('duplicate key 23505 on line 4703'),
      nul: redactMoney(null),
    }));
    ok('errors: $ figures redacted', !/1,234\.56/.test(red.dollars), red.dollars);
    ok('errors: bare money figures redacted', !/3951\.22/.test(red.bare), red.bare);
    ok('errors: postgres codes and line numbers survive',
      red.code.includes('23505') && red.code.includes('4703'), red.code);
    ok('errors: null is safe', red.nul === '');

    /* ---- new: the ring buffer is actually drained on load ---------------------------- */
    const drained = await page.evaluate(() => {
      localStorage.setItem('scrubpayErrors', JSON.stringify(
        [{ t: 1, msg: 'seeded failure $900.00', src: 'https://badgebudget.com/index.html', line: 12 }]));
      const taken = window.__takeErrorLog();
      return { took: taken.length, leftBehind: localStorage.getItem('scrubpayErrors'), second: window.__takeErrorLog().length };
    });
    ok('errors: __takeErrorLog reads the buffer', drained.took === 1);
    ok('errors: and clears it, so a failed send never resends', drained.leftBehind === null && drained.second === 0);

    /* Deferred events exist because the Google redirect races a plain track(). The queue must
       survive being written, and drain exactly once. */
    const deferred = await page.evaluate(() => {
      localStorage.removeItem('scrubpay_events_pending');
      trackDeferred('sign_in_attempted', { method: 'google' });
      const stored = JSON.parse(localStorage.getItem('scrubpay_events_pending') || '[]');
      const sent = [];
      const orig = window.track;
      window.track = (n, p) => { sent.push([n, p]); };
      flushDeferredEvents(null);
      window.track = orig;
      return { stored, sent, leftBehind: localStorage.getItem('scrubpay_events_pending') };
    });
    ok('deferred: sign_in_attempted is stored synchronously',
      deferred.stored.length === 1 && deferred.stored[0].name === 'sign_in_attempted'
      && deferred.stored[0].props.method === 'google', JSON.stringify(deferred.stored));
    ok('deferred: queue drains on the next load and clears',
      deferred.sent.length === 1 && deferred.sent[0][0] === 'sign_in_attempted'
      && deferred.leftBehind === null, JSON.stringify(deferred.sent));

    const flushed = await page.evaluate(() => {
      localStorage.setItem('scrubpayErrors', JSON.stringify([{ t: 1, msg: 'x', src: 'y', line: 1 }]));
      flushClientErrors(null);
      return localStorage.getItem('scrubpayErrors');
    });
    ok('errors: flushClientErrors consumes the buffer', flushed === null);
    await ctx.close();
  }

  /* ---- 2. onboarding funnel instrumentation ------------------------------------------- */
  if (want(2)) {
    const { ctx, page } = await newPage(browser, url, { seed: false });
    const tracked = [];
    await page.addInitScript(() => { window.__tracked = []; });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15000 }).catch(() => {});
    /* track() fires into a Supabase the sandbox can't reach, so intercept the function itself. */
    await page.evaluate(() => { const o = window.track; window.track = (n, p) => { window.__tracked.push([n, p]); }; void o; });
    const cta = page.getByRole('button', { name: /get my estimate/i });
    const sawWelcome = await cta.isVisible().catch(() => false);
    ok('onboarding: welcome screen is the first paint', sawWelcome);
    if (sawWelcome) {
      await cta.click();
      await page.waitForTimeout(300);
      const ev = await page.evaluate(() => window.__tracked);
      tracked.push(...ev);
      ok('onboarding: leaving the welcome screen emits ob_step',
        ev.some(([n, p]) => n === 'ob_step' && p && p.step === 1), JSON.stringify(ev));
      await page.evaluate(() => { window.__tracked = []; });
      /* Going back and forward again must not re-count: it is a funnel, not a click counter. */
      await page.getByRole('button', { name: '‹' }).click().catch(() => {});
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: /get my estimate/i }).click().catch(() => {});
      await page.waitForTimeout(300);
      const again = await page.evaluate(() => window.__tracked);
      ok('onboarding: re-reaching a step does not double count',
        !again.some(([n, p]) => n === 'ob_step' && p && p.step === 1), JSON.stringify(again));
    }
    await ctx.close();
  }

  /* ---- 3. account menu: the avatar is the only Settings/sign-out route on a phone ------- */
  if (want(3)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.topbar', { timeout: 15000 }).catch(() => {});

    /* The gear and sign-out icons folded into the avatar on 2026-09-13, leaving share (#98, which
       landed on the deploy branch while this was in review) and feedback. Feedback stays an icon
       deliberately — burying it would fight the whole point of the feedback tiles. */
    const iconBtns = await page.locator('.top-actions .iconbtn').count();
    ok('account: top bar carries only the share + feedback icons', iconBtns === 2, `${iconBtns} .iconbtn`);
    ok('account: no standalone Settings gear in the top bar',
      await page.locator('.top-actions [title="Settings"]').count() === 0);

    const avatar = page.locator('.avatar');
    ok('account: avatar is a menu trigger, not decoration',
      await avatar.evaluate((n) => n.tagName === 'BUTTON' && n.getAttribute('aria-haspopup') === 'menu'));
    ok('account: menu starts closed', await page.locator('.acct-menu').count() === 0);
    /* The reason the avatar may never be hidden by a breakpoint again. */
    ok('account: .topnav is display:none at phone width',
      await page.locator('.topnav').evaluate((n) => getComputedStyle(n).display === 'none'));

    await avatar.click();
    await page.waitForSelector('.acct-menu', { timeout: 4000 }).catch(() => {});
    const menuText = await page.locator('.acct-menu').innerText().catch(() => '');
    ok('account: tapping the avatar opens the menu', /Settings/.test(menuText), menuText.replace(/\n/g, ' / '));
    ok('account: signed out shows no Sign out row', !/Sign out/.test(menuText));
    ok('account: aria-expanded tracks the menu', (await avatar.getAttribute('aria-expanded')) === 'true');

    await page.keyboard.press('Escape');
    ok('account: Escape closes the menu', await page.locator('.acct-menu').count() === 0);

    await avatar.click();
    await page.waitForSelector('.acct-menu', { timeout: 4000 }).catch(() => {});
    await page.locator('.acct-scrim').click({ position: { x: 5, y: 5 } });
    ok('account: an outside tap closes the menu', await page.locator('.acct-menu').count() === 0);

    await avatar.click();
    await page.locator('.acct-menu button', { hasText: 'Settings' }).click();
    const settings = await page.waitForSelector('.sheet-h .t:text-is("Settings")', { timeout: 4000 }).catch(() => null);
    ok('account: Settings opens from the menu', !!settings);
    ok('account: choosing an item closes the menu', await page.locator('.acct-menu').count() === 0);
    await page.locator('.modal .back').click();   // Settings is a .modal; the feedback sheet is a .sheet

    /* iPhone SE. This block used to hide the avatar as decorative; now that it carries Settings
       and Sign out, hiding it would strand an SE with neither — and the bar still must not
       scroll sideways, which is what the rule was written for. */
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForTimeout(120);
    ok('account: avatar survives at 360px (iPhone SE)', await avatar.isVisible());
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    ok('account: top bar does not overflow at 360px', wide <= 360, `scrollWidth ${wide}`);

    /* #98's top-bar share icon shares this bar, and resolving the merge meant rewriting the exact
       line both changes touched — so prove its behaviour survived the resolution, not just its
       markup. openShare('topbar') tags the event surface; the sheet opening is the observable half. */
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('button[aria-label="Share BadgeBudget"]').click();
    const shareSheet = await page.waitForSelector('.sheet-h .t:text-is("Share BadgeBudget")', { timeout: 4000 }).catch(() => null);
    ok('account: #98 share icon still opens the share sheet after the merge', !!shareSheet);

    ok('account: no page errors driving the menu', errors.filter((e) => !isExpectedNetwork(e)).length === 0);
    await ctx.close();
  }

  /* ---- 4. feedback tiles: pick the shape, get a scaffold ------------------------------- */
  if (want(4)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.topbar', { timeout: 15000 }).catch(() => {});

    /* Must match the CHECK in supabase/migrations/003_feedback_kind.sql exactly: a value the DB
       rejects comes back 23514 and loses the whole submission. */
    const kinds = await page.evaluate(() => FEEDBACK_KINDS);
    ok('feedback: client kinds mirror the DB CHECK',
      JSON.stringify(kinds) === JSON.stringify(['wrong_number', 'broken', 'confused', 'wish', 'other']),
      String(kinds));

    const openSheet = async () => {
      await page.locator('button[aria-label="Send feedback"]').click();
      await page.waitForSelector('.fb-tiles', { timeout: 4000 });
    };
    await openSheet();
    ok('feedback: four tiles offered', await page.locator('.fb-tile').count() === 4);
    /* No autoFocus any more: on a phone it raised the keyboard over the tiles before she could
       read them, which is exactly the choice the tiles exist to offer. */
    ok('feedback: the box does not steal focus on open',
      await page.evaluate(() => document.activeElement && document.activeElement.id !== 'fb-msg'));

    const box = page.locator('#fb-msg');
    ok('feedback: box starts empty', (await box.inputValue()) === '');

    await page.locator('.fb-tile', { hasText: 'A number looks wrong' }).click();
    let v = await box.inputValue();
    ok('feedback: the wrong-number tile scaffolds the box', /What I see:/.test(v) && /What I expected:/.test(v), JSON.stringify(v));
    ok('feedback: and stamps the surface it was opened from', /Where: Planner \(month view\)$/.test(v), v.split('\n').pop());

    await page.locator('.fb-tile', { hasText: 'I wish it could' }).click();
    ok('feedback: switching tiles replaces an untouched scaffold', (await box.inputValue()) === 'I wish it could: ');

    await box.fill('the night differential is missing on Sundays');
    await page.locator('.fb-tile', { hasText: "Something didn't work" }).click();
    ok('feedback: switching tiles never eats words she typed',
      (await box.inputValue()) === 'the night differential is missing on Sundays');
    ok('feedback: but still re-tags the report',
      /didn.t work/.test(await page.locator('.fb-tile.on').innerText()));

    /* Re-open clean to test the toggle and the blank-scaffold guard. */
    await page.locator('.sheet .back').click();
    await openSheet();
    await page.locator('.fb-tile', { hasText: 'A number looks wrong' }).click();
    await page.locator('.fb-tile.on').click();
    ok('feedback: tapping the active tile clears back to the open box',
      (await box.inputValue()) === '' && await page.locator('.fb-tile.on').count() === 0);

    await page.locator('.fb-tile', { hasText: 'A number looks wrong' }).click();
    await page.locator('.sheet .btn-primary').click();
    const refused = await page.waitForSelector('text=/Fill in a line or two/i', { timeout: 3000 }).catch(() => null);
    ok('feedback: an untouched scaffold is refused, not filed as a row of prompts', !!refused);

    /* Opened from Settings, the scaffold says Settings — the pathname never could, since this is
       a single-page app and `page` is always '/'. */
    await page.locator('.sheet .back').click();
    await page.locator('.avatar').click();
    await page.locator('.acct-menu button', { hasText: 'Settings' }).click();
    await page.waitForSelector('.sheet-h .t:text-is("Settings")', { timeout: 4000 });
    await page.locator('.modal button', { hasText: 'Send feedback' }).click();
    await page.waitForSelector('.fb-tiles', { timeout: 4000 });
    await page.locator('.fb-tile', { hasText: 'A number looks wrong' }).click();
    ok('feedback: opened from Settings, the scaffold says Settings',
      /Where: Settings$/.test(await box.inputValue()), (await box.inputValue()).split('\n').pop());

    /* The row must carry anon_id, or an anonymous nurse's report can never be tied to what her
       device actually did (migration 005). `page` cannot stand in — it is always '/' here — and
       `user_id` is null when she is not signed in, so this column is the only join key there is.
       Intercepting the real insert rather than stubbing the client means this asserts what
       genuinely goes over the wire, not what we believe the code builds. */
    let resolveSent;
    const sentP = new Promise((r) => { resolveSent = r; });
    await page.route('**/rest/v1/feedback*', async (route) => {
      resolveSent(route.request().postData());
      await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
    });
    await box.fill('The take-home number looks too low on my night shifts.');
    await page.locator('.sheet .btn-primary').click();
    const sent = await Promise.race([sentP, new Promise((r) => setTimeout(() => r(null), 8000))]);
    const parsed = sent ? JSON.parse(sent) : null;
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    const devId = await page.evaluate(() => localStorage.getItem('scrubpay_anon_id'));
    ok('feedback: the submitted row carries anon_id', !!(row && row.anon_id),
      row ? Object.keys(row).join(',') : 'no insert was captured');
    ok('feedback: and it is this device id, so the row joins to the event trail',
      !!devId && !!row && row.anon_id === devId, devId ? `${String(devId).slice(0, 8)}…` : 'no device id');
    await page.unroute('**/rest/v1/feedback*');

    ok('feedback: no page errors driving the tiles', errors.filter((e) => !isExpectedNetwork(e)).length === 0);
    await ctx.close();
  }

  /* ---- 5. failure mode: getSession() hangs (the WebKit deadlock) ----------------------- */
  if (want(5)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.addInitScript(() => {
      let real;
      Object.defineProperty(window, 'supabase', {
        configurable: true,
        get() { return real; },
        set(v) {
          if (v && v.createClient) {
            const orig = v.createClient.bind(v);
            v.createClient = (...a) => {
              const c = orig(...a);
              try { c.auth.getSession = () => new Promise(() => {}); } catch (_) {}
              return c;
            };
          }
          real = v;
        },
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 15000 }).catch(() => {});
    const rendered = await page.locator('#root').evaluate((n) => n.childElementCount > 0);
    ok('failure mode: app still renders when getSession() never resolves', rendered);
    ok('failure mode: hung getSession raises no page error', errors.filter((e) => !isExpectedNetwork(e)).length === 0);
    await ctx.close();
  }

  /* ---- 6. failure mode: Babel blocked -> the boot error screen ------------------------- */
  if (want(6)) {
    const { ctx, page } = await newPage(browser, url);
    await page.route('**/babel.min.js', (r) => r.abort());
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    const screen = await page.waitForSelector('text=/couldn.t start/i', { timeout: 20000 }).catch(() => null);
    ok('failure mode: blocking Babel shows the boot error screen, not a spinner', !!screen);
    if (screen) {
      const named = await page.locator('#splash').innerText();
      ok('failure mode: the error screen names what failed to load', /Babel/.test(named), named.split('\n').slice(0, 3).join(' / '));
    }
    await ctx.close();
  }

  /* ---- 7. ops console: the signed-out gate ---------------------------------------------
     ops.html is published to a guessable public URL. Everything that makes that safe is on the
     server (ops_feedback_inbox raises 42501 for anyone off the allow-list), but the page must
     also never render feedback to a visitor who is not signed in at all — and in the sandbox,
     where Supabase is unreachable, "no session" is exactly the state a stranger arrives in. */
  if (want(7)) {
    const { ctx, page, errors } = await newPage(browser, url, { seed: false });
    await page.goto(url + '/ops.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.gate, .row', { timeout: 15000 }).catch(() => {});

    const gated = await page.locator('.gate h2').innerText().catch(() => '');
    ok('ops: a signed-out visitor gets the sign-in gate', /sign in first/i.test(gated), gated);
    ok('ops: no feedback rows render without a session', (await page.locator('.row').count()) === 0);
    ok('ops: no inbox controls render without a session', (await page.locator('button').count()) === 0);

    const body = await page.locator('body').innerText();
    ok('ops: the gate leaks no row content', !/Reply to:/.test(body));
    ok('ops: gate raises no page error', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();
  }

  /* ---- 8. council 2026-09-13, bucket 1 --------------------------------------------------
     Each block below pins one fix from docs/council-runs/2026-09-13/synthesis.md (bucket 1: nightly-
     safe, no Invariant-3 function, no displayed-dollar change). Every assertion was negative-tested
     against a copy with the fix reverted -- see docs/history.md for the run. */
  if (want(8)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hero', { timeout: 20000 });

    /* mobile-ux-00 (#29): the two hero footer links carried className="hero more linklike", so each
       inherited the whole .hero card rule -- a 59px dark pill apiece, ~120px of dead first screen. */
    const heroCount = await page.evaluate(() => document.querySelectorAll('.hero').length);
    ok('council: exactly one .hero card renders on the dashboard', heroCount === 1, `${heroCount} .hero`);
    const links = await page.evaluate(() => [...document.querySelectorAll('.hero .more')].map((b) => ({
      h: Math.round(b.getBoundingClientRect().height), bg: getComputedStyle(b).backgroundColor })));
    ok('council: hero footer links are inline links, not cards',
      links.length === 2 && links.every((l) => l.h < 40 && /rgba\(0, 0, 0, 0\)|transparent/.test(l.bg)), JSON.stringify(links));

    /* mobile-ux-09 (#31): ShareSheet was the one sheet left out of the body-scroll lock effect. */
    await page.locator('button[aria-label="Share BadgeBudget"]').click();
    await page.waitForSelector('.sheet-h .t:text-is("Share BadgeBudget")', { timeout: 4000 });
    const lockedOpen = await page.evaluate(() => document.body.style.overflow);
    ok('council: opening the share sheet locks body scroll', lockedOpen === 'hidden', `overflow=${JSON.stringify(lockedOpen)}`);
    await page.locator('.sheet-h button[aria-label="Close"]').click();
    await page.waitForSelector('.sheet-h .t:text-is("Share BadgeBudget")', { state: 'detached', timeout: 4000 });
    const lockedClosed = await page.evaluate(() => document.body.style.overflow);
    ok('council: closing the share sheet releases body scroll', lockedClosed === '', `overflow=${JSON.stringify(lockedClosed)}`);

    /* mobile-ux-12 (#31): the first-run create/join inputs on the swap board lacked the Enter-to-submit
       their "another board" siblings have. The zero-groups screen needs a live session the sandbox
       cannot mint, so this half is pinned at the source: both inputs carry an Enter handler. */
    const src = readFileSync(join(SCRATCH, 'index.html'), 'utf8');
    const firstRun = src.slice(src.indexOf("<h3>Create your unit's board</h3>"), src.indexOf('<h3>Join with a code</h3>') + 1200);
    ok('council: first-run board-name input submits on Enter', /aria-label="Board name"[^>]*onKeyDown=\{e=>\{ if\(e\.key==='Enter'\) doCreateGroup\(\)/.test(firstRun));
    ok('council: first-run invite-code input submits on Enter', /aria-label="Invite code"[^>]*onKeyDown=\{e=>\{ if\(e\.key==='Enter'\) doJoinGroup\(\)/.test(firstRun));

    ok('council: no page errors in the bucket-1 section', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();

    /* code-quality-00 = security-09 (#24) and code-quality-11: the manual sign-out path claimed to
       mirror the SIGNED_OUT branch but never cleared the calendar subscription (Invariant 13 -- the
       feed URL is a bearer credential) or the onboarding step. The sandbox cannot mint a session, so
       the client is stubbed the way section 5 stubs getSession(): A is signed in, signOut() resolves,
       onAuthStateChange never fires SIGNED_OUT (the stalled case the manual path exists for), and
       window.__fireAuth lets the test sign B in afterwards through the app's own callback. */
    const fakeAuth = async (seed, cloud = false) => {
      const { ctx, page, errors } = await newPage(browser, url, { seed });
      await page.addInitScript((withCloud) => {
        const A = { user: { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' }, access_token: 'a', refresh_token: 'a' };
        let real;
        Object.defineProperty(window, 'supabase', {
          configurable: true,
          get() { return real; },
          set(v) {
            if (v && v.createClient) {
              const orig = v.createClient.bind(v);
              v.createClient = (...a) => {
                const c = orig(...a);
                try {
                  c.auth.getSession = async () => ({ data: { session: A }, error: null });
                  c.auth.onAuthStateChange = (cb) => { window.__fireAuth = (ev, sess) => cb(ev, sess); return { data: { subscription: { unsubscribe() {} } } }; };
                  c.auth.signOut = async () => ({ error: null });
                  if (withCloud) {
                    /* A thenable query chain: selects answer "no row" (PGRST116, the first-run case),
                       inserts succeed, upserts are counted and fail with 23514 while window.__failSave
                       is set. Enough for hydration to complete and for a save to be made to fail. */
                    c.from = () => {
                      const q = { _op: 'select' };
                      for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle', 'single']) q[m] = () => q;
                      q.insert = () => { q._op = 'insert'; return q; };
                      q.upsert = () => { q._op = 'upsert'; window.__upserts = (window.__upserts || 0) + 1; return q; };
                      q.then = (res, rej) => Promise.resolve(
                        q._op === 'upsert' ? (window.__failSave ? { error: { code: '23514', message: 'stub' } } : { error: null })
                        : q._op === 'insert' ? { error: null }
                        : { data: null, error: { code: 'PGRST116', message: 'no row' } }).then(res, rej);
                      return q;
                    };
                  }
                } catch (_) {}
                return c;
              };
            }
            real = v;
          },
        });
      }, cloud);
      return { ctx, page, errors };
    };
    const signOutViaMenu = async (page) => {
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Sign out")').click();
      await page.locator('.btn-primary:has-text("Sign out")').click();
      await page.waitForSelector('button:has-text("Sign in")', { timeout: 6000 }).catch(() => {});
    };
    {
      const { ctx, page, errors } = await fakeAuth(true);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.avatar', { timeout: 20000 });
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      const ical = page.locator('input[aria-label="Calendar iCal address"]');
      await ical.fill('https://calendar.google.com/calendar/ical/SECRET-A/basic.ics');
      await page.locator('.sheet-h button.back').first().click();
      await signOutViaMenu(page);
      await page.evaluate(() => window.__fireAuth('SIGNED_IN', { user: { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' }, access_token: 'b', refresh_token: 'b' }));
      await page.waitForSelector('.avatar:has-text("B")', { timeout: 6000 }).catch(() => {});
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      const after = await ical.inputValue().catch(() => '(no input)');
      ok("council: a manual sign-out clears the previous account's iCal URL before the next sign-in", after === '', JSON.stringify(after));
      ok('council: no page errors across the sign-out drive', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }
    {
      /* A user who signed up without ever using the app anonymously finishes onboarding signed in;
         signing out then re-rendered onboarding at the last step reached instead of the welcome. */
      const { ctx, page } = await fakeAuth(false);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#root > *', { timeout: 20000 });
      await page.getByRole('button', { name: /get my estimate/i }).click();
      await page.getByRole('button', { name: /see my estimate/i }).click();
      await page.waitForSelector('.avatar', { timeout: 10000 });
      await signOutViaMenu(page);
      await page.waitForTimeout(600);
      const welcome = await page.getByRole('button', { name: /get my estimate/i }).count();
      const rateStep = await page.locator('.q:has-text("base hourly rate")').count();
      ok('council: sign-out returns onboarding to the welcome screen, not the last step reached', welcome === 1 && rateStep === 0, `welcome=${welcome} rateStep=${rateStep}`);
      await ctx.close();
    }

    /* privacy-telemetry-00/-01/-02 (#37): privacy.html is static and in the publish set, so it is
       pinned at the source. Each check names a fact the notice used to get wrong. */
    {
      const pv = readFileSync(join(ROOT, 'privacy.html'), 'utf8');
      const account = pv.slice(pv.indexOf('<h3>Your account</h3>'), pv.indexOf('<h2>What is never collected</h2>'));
      ok('council: privacy notice discloses the email/password sign-in path', /email address and password/i.test(account) && /hashed/.test(account));
      const analytics = pv.slice(pv.indexOf('<h2>Usage analytics</h2>'), pv.indexOf('<h2>Error reports</h2>'));
      ok('council: privacy notice no longer claims the device id is never linked to you',
        !/not linked to your name/.test(analytics) && /account id/.test(analytics) && /associated with your account/.test(analytics));
      const feedback = pv.slice(pv.indexOf('<h2>Feedback</h2>'), pv.indexOf('<h2>Calendar sync</h2>'));
      ok('council: privacy notice says signed-in feedback carries the account id regardless of contact',
        /carries\s+your account id/.test(feedback) && /whether or not you fill in a contact/.test(feedback));
    }

    /* data-integrity-00 (#23), security-05 client half (#19), security-12 (#22). */
    {
      const { ctx, page, errors } = await fakeAuth(true, true);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.avatar', { timeout: 20000 });
      await page.waitForTimeout(1500);   // let hydration and any debounced save settle while saves still succeed
      const UID = '11111111-1111-4111-8111-111111111111';
      const flush = await page.evaluate((uid) => {
        localStorage.removeItem('nursingWagePlannerData::' + uid);
        window.__failSave = true;
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return new Promise((r) => setTimeout(() => r({ backup: localStorage.getItem('nursingWagePlannerData::' + uid) !== null, upserts: window.__upserts || 0 }), 400));
      }, UID);
      ok('council: a failed pagehide flush keeps the per-user backup', flush.backup === true, JSON.stringify(flush));

      const size = await page.evaluate(async (uid) => {
        const before = window.__upserts || 0;
        window.__failSave = false;
        const ts = await saveToSupabase(uid, { pad: 'x'.repeat(MAX_BLOB_BYTES + 1) });
        return { ts, upsertsDuring: (window.__upserts || 0) - before };
      }, UID);
      ok('council: saveToSupabase refuses an oversize blob before it reaches the network', size.ts === null && size.upsertsDuring === 0, JSON.stringify(size));

      const budget = await page.evaluate(() => {
        const entries = Array.from({ length: 8 }, (_, i) => ({ t: i, msg: ('E' + i + ' ').padEnd(300, 'x'), src: 'x'.repeat(90) + '.js', line: 100 + i }));
        localStorage.setItem('scrubpayErrors', JSON.stringify(entries));
        let captured = null; const realTrack = window.track;
        window.track = (name, props) => { captured = { name, props }; };
        try { flushClientErrors(null); } finally { window.track = realTrack; }
        return captured && { name: captured.name, len: JSON.stringify(captured.props).length, kept: captured.props.errors.length, n: captured.props.n, newestKept: captured.props.errors[captured.props.errors.length - 1].msg.slice(0, 2) };
      });
      ok('council: client_error batch stays under the events.props size CHECK and keeps the newest entries',
        !!budget && budget.name === 'client_error' && budget.len <= 1700 && budget.kept >= 1 && budget.kept < 8 && budget.n === 8 && budget.newestKept === 'E7', JSON.stringify(budget));
      ok('council: no page errors across the save-path drive', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* mobile-ux-00/-01/-02/-03/-05/-06/-08/-10 (#30): the tap-target pass. The app's own convention
       is 44px (33 explicit minHeight:44 sites, .iconbtn's ::after hit-slop); these were the controls
       under it. Hit-slop is proven with elementFromPoint just outside the visible box, not by
       reading the stylesheet. */
    {
      const { ctx, page, errors } = await newPage(browser, url);
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
        [STORAGE_KEY, { ...SEEDED_STATE, estimateMode: 'rough' }]);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });
      /* The boot splash (#splash, fixed, z-index 9999) fades for 350ms after the app paints and
         intercepts elementFromPoint until it is gone -- wait it out before any hit test. */
      await page.waitForSelector('#splash', { state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(150);

      const av = await page.evaluate(() => {
        const a = document.querySelector('.avatar'); const r = a.getBoundingClientRect();
        const hit = document.elementFromPoint(r.right + 1, r.top + r.height / 2);
        return { w: Math.round(r.width), outside: !!(hit && hit.closest('.avatar')) };
      });
      ok('council: avatar hit area extends past its 40px circle', av.outside, JSON.stringify(av));

      const eb = await page.evaluate(() => [...document.querySelectorAll('.est-banner button')].map((b) => Math.round(b.getBoundingClientRect().height)));
      ok('council: est-banner buttons are 44px tap targets', eb.length >= 2 && eb.every((h) => h >= 44), JSON.stringify(eb));

      const pp = await page.evaluate(() => {
        const c = document.querySelector('.pp-chip'); if (!c) return { count: 0 };
        c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.bottom + 4);
        return { count: 1, h: Math.round(r.height), below: !!(hit && hit.closest('.pp-chip')) };
      });
      ok('council: pay-period chip reaches a 44px hit area', pp.count === 1 && pp.h + 12 >= 44 && pp.below, JSON.stringify(pp));

      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(300);
      const vs = await page.evaluate(() => Math.round(document.querySelector('.cal-vscroll').getBoundingClientRect().height));
      ok('council: calendar scroll box fits a landscape viewport', vs <= 240, `${vs}px tall at a 390px viewport`);
      await page.setViewportSize({ width: 360, height: 780 });
      await page.waitForTimeout(300);

      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      await page.waitForSelector('.drow .amt input', { timeout: 5000 });
      const st = await page.evaluate(() => ({
        amt: [...document.querySelectorAll('.drow .amt input')].map((i) => Math.round(i.getBoundingClientRect().height)),
        del: [...document.querySelectorAll('.drow .danger-link')].map((b) => Math.round(b.getBoundingClientRect().height)) }));
      ok('council: Settings amount inputs are 44px tap targets', st.amt.length >= 1 && st.amt.every((h) => h >= 44), JSON.stringify(st.amt));
      ok('council: Settings Del links are 44px tap targets', st.del.length >= 1 && st.del.every((h) => h >= 44), JSON.stringify(st.del));
      await page.locator('.sheet-h button.back').first().click();
      await page.waitForSelector('.drow', { state: 'detached', timeout: 4000 }).catch(() => {});

      await page.locator('.fab').click();
      await page.waitForSelector('.chip-sel', { timeout: 5000 });
      const cs = await page.evaluate(() => [...document.querySelectorAll('.chip-sel')].map((b) => Math.round(b.getBoundingClientRect().height)));
      ok('council: shift-type chips are 44px tap targets', cs.length >= 1 && cs.every((h) => h >= 44), JSON.stringify(cs));
      await page.mouse.click(8, 8);   // the scrim closes the sheet
      await page.waitForSelector('.chip-sel', { state: 'detached', timeout: 4000 }).catch(() => {});

      /* The fixed "+ Log a shift" button overlaps the card's Open button when the card sits at the
         bottom of a 360px viewport; centre it first so the click lands on the button, not the fab. */
      const openLab = page.locator('.whatif:has-text("Pattern lab") button:text-is("Open")');
      await openLab.evaluate((b) => b.scrollIntoView({ block: 'center' }));
      await openLab.click();
      await page.locator('.pl-card-main').first().click();   // the lab opens on its preset list; a preset draws the grid
      await page.waitForSelector('.pl-cell', { timeout: 8000 });
      const pl = await page.evaluate(() => [...document.querySelectorAll('.pl-cell')].slice(0, 7).map((c) => Math.round(c.getBoundingClientRect().width)));
      ok('council: pattern-grid cells clear 44px at 360px wide', pl.length === 7 && pl.every((w) => w >= 44), JSON.stringify(pl));

      ok('council: no page errors across the tap-target sweep', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* accessibility-00/-02/-03/-05/-06/-08/-09/-10/-11/-12/-14/-16/-18/-19/-21/-22/-23/-24 and the
       Escape halves of -13/-25/-26 (#32-#34, #36 partial): the a11y pass. Dialog semantics and
       Escape are asserted by opening each sheet for real; the one Escape handler is a stack, so a
       confirm dialog on top of Settings is closed by Escape while Settings stays -- proven, not
       assumed. Colours are read back from the stylesheet with getComputedStyle. */
    {
      const { ctx, page, errors } = await newPage(browser, url, { seed: false });
      const today = new Date(); const tk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
        [STORAGE_KEY, { ...SEEDED_STATE, estimateMode: 'rough',
          shifts: { [tk]: [{ id: 'ot1', shiftType: 'base', hours: 12, bonusType: 'none', customBonus: 0, isOvertime: true, start: '07:00' }] } }]);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });
      await page.waitForSelector('#splash', { state: 'hidden', timeout: 5000 }).catch(() => {});
      const gone = (sel) => page.waitForSelector(sel, { state: 'detached', timeout: 4000 }).then(() => true).catch(() => false);
      const has = (sel) => page.evaluate((q) => !!document.querySelector(q), sel);

      /* share sheet */
      await page.locator('button[aria-label="Share BadgeBudget"]').click();
      await page.waitForSelector('.sheet-h .t:text-is("Share BadgeBudget")', { timeout: 4000 });
      ok('a11y: share sheet is a labelled dialog', await has('.sheet[role="dialog"][aria-modal="true"][aria-label="Share BadgeBudget"]'));
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes the share sheet', await gone('.sheet[aria-label="Share BadgeBudget"]'));

      /* breakdown */
      await page.locator('.hero button:has-text("See the full breakdown")').click();
      await page.waitForSelector('.sheet-h .t:text-is("Your paycheck math")', { timeout: 4000 });
      ok('a11y: breakdown is a labelled dialog with a named close button',
        await has('.modal[role="dialog"][aria-label="Your paycheck math"] .sheet-h button.back[aria-label="Close"]'));
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes the breakdown', await gone('.modal[aria-label="Your paycheck math"]'));

      /* settings, and the Escape stack under a confirm dialog */
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      await page.waitForSelector('.drow .danger-link', { timeout: 5000 });
      ok('a11y: Settings is a labelled dialog with a named close button',
        await has('.modal[role="dialog"][aria-label="Settings"] .sheet-h button.back[aria-label="Close"]'));
      const dels = await page.evaluate(() => [...document.querySelectorAll('.drow .danger-link')].map((b) => b.getAttribute('aria-label') || ''));
      ok('a11y: every Settings Del button names what it deletes', dels.length >= 2 && dels.every((l) => /^Delete .+ differential$|^Delete .+ goal$/.test(l)) && new Set(dels).size === dels.length, JSON.stringify(dels));
      ok('a11y: differential name inputs carry an accessible name', await has('.drow input.nm[aria-label="Differential name"]'));
      const dangerRgb = await page.evaluate(() => getComputedStyle(document.querySelector('.drow .danger-link')).color);
      ok('a11y: danger red is the darker AA-safe token', dangerRgb === 'rgb(176, 61, 46)', dangerRgb);
      await page.locator('.drow .danger-link').first().click();
      await page.waitForSelector('.cdlg', { timeout: 4000 });
      await page.keyboard.press('Escape');
      const confirmGone = await gone('.cdlg');
      const settingsStill = await has('.modal[aria-label="Settings"]');
      ok('a11y: Escape closes only the confirm dialog on top, Settings stays open', confirmGone && settingsStill, `confirmGone=${confirmGone} settingsStill=${settingsStill}`);
      await page.keyboard.press('Escape');
      ok('a11y: a second Escape closes Settings', await gone('.modal[aria-label="Settings"]'));

      /* add-shift sheet: dialog, live region, OT tag colour, Remove names */
      await page.locator('.fab').click();
      await page.waitForSelector('.sheet .preview', { timeout: 5000 });
      ok('a11y: add-shift sheet is a labelled dialog', await has('.sheet[role="dialog"][aria-modal="true"][aria-label="Add a shift"]'));
      ok('a11y: add-shift preview is a polite live region', await has('.sheet .preview[aria-live="polite"]'));
      const ot = await page.evaluate(() => { const t = document.querySelector('.sheet .ot-tag'); return t ? getComputedStyle(t).color : '(no tag)'; });
      ok('a11y: OT tag uses the AA-safe money-ink colour', ot === 'rgb(11, 93, 60)', ot);
      const rm = await page.evaluate(() => [...document.querySelectorAll('.sheet .danger-link')].map((b) => b.getAttribute('aria-label') || ''));
      ok('a11y: Remove buttons name the shift they remove', rm.length >= 1 && rm.every((l) => /^Remove .+ ×\d+h shift$/.test(l)), JSON.stringify(rm));
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes the add-shift sheet', await gone('.sheet[aria-label="Add a shift"]'));

      /* calendar: view control, today, scroll box */
      const cal = await page.evaluate(() => ({
        tablist: !!document.querySelector('.viewseg[role="tablist"], .viewseg [role="tab"]'),
        pressed: [...document.querySelectorAll('.viewseg button')].map((b) => b.getAttribute('aria-pressed')),
        today: (document.querySelector('.cell.today') || {}).getAttribute ? document.querySelector('.cell.today').getAttribute('aria-label') : '(no today cell)',
        tab: (document.querySelector('.cal-vscroll') || {}).getAttribute ? document.querySelector('.cal-vscroll').getAttribute('tabindex') : null }));
      ok('a11y: the Month/Year control no longer claims a tablist it never implemented', !cal.tablist && cal.pressed.includes('true') && cal.pressed.includes('false'), JSON.stringify(cal.pressed));
      ok("a11y: today's cell says so in its accessible name", /, today$/.test(cal.today), cal.today);
      ok('a11y: the month scroll box is keyboard-focusable', cal.tab === '0', `tabindex=${cal.tab}`);

      /* est-banner dismiss hands focus to the hero */
      await page.locator('.est-banner button:has-text("Got it")').click();
      await page.waitForSelector('.est-banner', { state: 'detached', timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(80);
      const focused = await page.evaluate(() => (document.activeElement && document.activeElement.className) || '(body)');
      ok('a11y: dismissing the estimate banner moves focus to the hero', /\bhero\b/.test(focused), focused);

      /* pattern lab */
      const openLab = page.locator('.whatif:has-text("Pattern lab") button:text-is("Open")');
      await openLab.evaluate((b) => b.scrollIntoView({ block: 'center' }));
      await openLab.click();
      await page.waitForSelector('.sheet-h .t:text-is("Pattern lab")', { timeout: 5000 });
      ok('a11y: pattern lab is a labelled dialog', await has('.modal[role="dialog"][aria-modal="true"][aria-label="Pattern lab"]'));
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes the pattern lab from its list', await gone('.modal[aria-label="Pattern lab"]'));
      await openLab.evaluate((b) => b.scrollIntoView({ block: 'center' }));
      await openLab.click();
      await page.locator('.pl-card-main').first().click();
      await page.waitForSelector('.pl-money', { timeout: 8000 });
      ok('a11y: the pattern readout is a polite live region', await has('.modal[aria-label="New pattern"] .pl-money[aria-live="polite"]'));
      /* A dirty draft must not vanish on a keypress: Escape goes through the same discard confirm
         the backdrop tap uses, and Escape on that confirm cancels it, leaving the draft intact. */
      await page.keyboard.press('Escape');
      await page.waitForSelector('.cdlg', { timeout: 4000 }).catch(() => {});
      const asked = await has('.cdlg');
      await page.keyboard.press('Escape');
      const kept = (await gone('.cdlg')) && (await has('.modal[aria-label="New pattern"]'));
      ok('a11y: Escape on a dirty pattern asks before discarding, and Escape on the ask keeps the draft', asked && kept, `asked=${asked} kept=${kept}`);
      await page.keyboard.press('Escape');
      await page.locator('.cdlg .btn-danger').click();
      ok('a11y: confirming the discard closes the pattern lab', await gone('.modal[role="dialog"]'));

      /* auth modal (signed out) */
      await page.locator('.topbar button:has-text("Sign in")').first().click();
      await page.waitForSelector('.sheet-h .t:text-is("Sign in")', { timeout: 5000 });
      ok('a11y: the sign-in modal is a labelled dialog with a named close button',
        await has('.modal[role="dialog"][aria-label="Sign in"] .sheet-h button.back[aria-label="Close"]'));
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes the sign-in modal', await gone('.modal[aria-label="Sign in"]'));

      /* feedback: Escape never eats typed words */
      await page.locator('button[aria-label="Send feedback"]').click();
      await page.waitForSelector('.sheet[aria-label="Send feedback"] textarea', { timeout: 5000 });
      await page.locator('.sheet[aria-label="Send feedback"] textarea').fill('my own words');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
      ok('a11y: Escape leaves a feedback sheet with typed words open', await has('.sheet[aria-label="Send feedback"]'));
      await page.locator('.sheet[aria-label="Send feedback"] textarea').fill('');
      await page.keyboard.press('Escape');
      ok('a11y: Escape closes an empty feedback sheet', await gone('.sheet[aria-label="Send feedback"]'));

      /* the ESTIMATED tag token, read off the stylesheet */
      const est = await page.evaluate(() => { const t = document.createElement('span'); t.className = 'tag est'; document.body.appendChild(t); const c = getComputedStyle(t).color; t.remove(); return c; });
      ok('a11y: the ESTIMATED tag colour clears AA on its pill', est === 'rgb(138, 90, 5)', est);

      /* reduced motion: the stepper's scroll animation jumps instead of animating */
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const rm1 = await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'height:100px;overflow:auto'; d.innerHTML = '<div style="height:1000px"></div>'; document.body.appendChild(d); animateScrollTop(d, 100); const v = d.scrollTop; d.remove(); return v; });
      ok('a11y: animateScrollTop jumps synchronously under prefers-reduced-motion', rm1 === 100, `scrollTop=${rm1}`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const rm0 = await page.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'height:100px;overflow:auto'; d.innerHTML = '<div style="height:1000px"></div>'; document.body.appendChild(d); animateScrollTop(d, 100); const v = d.scrollTop; d.remove(); return v; });
      ok('a11y: ...and still animates when no preference is set (control)', rm0 === 0, `scrollTop=${rm0}`);

      ok('a11y: no page errors across the a11y sweep', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }
    {
      /* onboarding: real headings and a named back button */
      const { ctx, page } = await newPage(browser, url, { seed: false });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#root > *', { timeout: 20000 });
      ok('a11y: the welcome title is a heading', await page.evaluate(() => !!document.querySelector('.ob h1.display')));
      await page.getByRole('button', { name: /get my estimate/i }).click();
      await page.waitForSelector('.ob .q', { timeout: 5000 });
      const ob = await page.evaluate(() => ({ h1: !!document.querySelector('.ob h1.q'), back: (document.querySelector('.ob button.back') || {}).getAttribute ? document.querySelector('.ob button.back').getAttribute('aria-label') : null,
        m: getComputedStyle(document.querySelector('.ob .q')).marginTop }));
      ok('a11y: each onboarding question is an h1 with no stray margin', ob.h1 && ob.m === '0px', JSON.stringify(ob));
      ok('a11y: the onboarding back button has an accessible name', ob.back === 'Back', JSON.stringify(ob.back));
      const doneLine = src.slice(src.indexOf('hrs · 6 shifts · gross') - 120, src.indexOf('hrs · 6 shifts · gross'));
      ok("a11y: the done screen's gross line uses the 5.7:1 grey", /#9A9DAB/.test(doneLine) && !/#7E8290/.test(doneLine));
      await ctx.close();
    }

    /* #7, #9, #10, #11, #12, #18, #27, #28 (product-design-02/-04/-07, wage-math-10, code-quality-05/
       -07/-09/-13/-22/-24, security-03): the last bucket-1 group. Driven where the surface exists;
       validShiftMeta and the templates sanitizer are unit-tested as the globals they are; the two
       one-line catch/filter edits and the ref cleanup are pinned at the source. */
    {
      const { ctx, page, errors } = await newPage(browser, url, { seed: false });
      await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
        [STORAGE_KEY, { ...SEEDED_STATE,
          templates: [{ id: 't1', name: 'Charge day', shiftType: 'base', hours: 8, bonusType: 'none', customBonus: 0, isOvertime: true }],
          goals: [{ id: 'g1', name: 'House', target: 1000 }, { id: 'g2', name: 'Trip', target: 500 }] }]);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });
      await page.waitForSelector('#splash', { state: 'hidden', timeout: 5000 }).catch(() => {});
      const gone = (sel) => page.waitForSelector(sel, { state: 'detached', timeout: 4000 }).then(() => true).catch(() => false);
      const has = (sel) => page.evaluate((q) => !!document.querySelector(q), sel);

      const san = await page.evaluate(() => sanitizeData({ templates: [
        { id: 'x', name: 'OT', shiftType: 'night', hours: 12, bonusType: 'none', isOvertime: true },
        { id: 'y', name: 'No', shiftType: 'night', hours: 12, bonusType: 'none' } ] }).templates.map((t) => t.isOvertime));
      ok('council: the templates sanitizer keeps the OT flag (#9)', JSON.stringify(san) === '[true,false]', JSON.stringify(san));

      const vm = await page.evaluate(() => [
        validShiftMeta({ shiftType: 'base', hours: '12' }), validShiftMeta({ shiftType: 'night', hours: 12, start: '19:00' }),
        validShiftMeta({ shiftType: 'base', hours: 'abc' }), validShiftMeta({ shiftType: 7, hours: 12 }), validShiftMeta({ shiftType: 'base', hours: 0 }),
        validShiftMeta({ shiftType: 'base', hours: 25 }), validShiftMeta({ shiftType: 'base', hours: 12, start: '99:99' }), validShiftMeta(['base']), validShiftMeta(null)]);
      ok("council: another member's shift_meta is validated before it becomes her shift (#18)",
        JSON.stringify(vm) === '[true,true,false,false,false,false,false,false,false]', JSON.stringify(vm));

      /* #9 + #12: quick-tap an OT template, then "Save as template" must capture that shift */
      await page.locator('.fab').click();
      await page.waitForSelector('.sheet[aria-label="Add a shift"]', { timeout: 5000 });
      const tplBtn = page.locator('.sheet .chip-sel:has-text("Charge day")');
      ok('council: a template row shows its OT flag (#9)', /· OT/.test(await tplBtn.innerText()));
      await tplBtn.click();
      await page.waitForSelector('.sheet .row-item .ot-tag', { timeout: 4000 }).catch(() => {});
      ok('council: a quick-tapped OT template lands as an OT shift (#9)', await has('.sheet .row-item .ot-tag'));
      await page.locator('.sheet button:has-text("Save as template")').click();
      await page.locator('.sheet input[aria-label="Template name"]').fill('Copy of charge');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.sheet .chip-sel:has-text("Copy of charge")', { timeout: 4000 }).catch(() => {});
      const copy = await page.locator('.sheet .chip-sel:has-text("Copy of charge")').innerText().catch(() => '(not saved)');
      ok('council: "Save as template" right after a quick-tap captures the tapped shift, OT included (#12, #9)', /×8h · OT/.test(copy), JSON.stringify(copy));
      await page.keyboard.press('Escape');
      await gone('.sheet[aria-label="Add a shift"]');

      /* #10: a goal edited to $0 leaves the preview, and Del asks first */
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      const house = page.locator('input[aria-label="House target amount"]');
      await house.fill('0'); await house.press('Tab');
      await page.keyboard.press('Escape');
      await gone('.modal[aria-label="Settings"]');
      await page.locator('.fab').click();
      await page.waitForSelector('.sheet .preview', { timeout: 5000 });
      const goalLine = await page.evaluate(() => { const ks = [...document.querySelectorAll('.sheet .preview .k')].map((k) => k.textContent); return ks.find((t) => /toward your/.test(t)) || '(no goal line)'; });
      ok('council: a $0 goal is left out of the shift preview instead of printing Infinity% (#10)', !/Infinity|NaN|House/.test(goalLine) && /Trip/.test(goalLine), goalLine);
      await page.keyboard.press('Escape');
      await gone('.sheet[aria-label="Add a shift"]');
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      await page.locator('button[aria-label="Delete Trip goal"]').click();
      const asked = await page.waitForSelector('.cdlg', { timeout: 4000 }).then(() => true).catch(() => false);
      const stillThere = await has('button[aria-label="Delete Trip goal"]');
      ok('council: deleting a goal asks first (#10)', asked && stillThere, `asked=${asked} stillThere=${stillThere}`);
      if (asked) await page.locator('.cdlg .btn-danger').click();
      ok('council: confirming removes the goal (#10)', await gone('button[aria-label="Delete Trip goal"]'));
      await page.keyboard.press('Escape');
      await gone('.modal[aria-label="Settings"]');

      /* #7 / #11 / #28 in the pattern lab */
      const openLab = page.locator('.whatif:has-text("Pattern lab") button:text-is("Open")');
      await openLab.evaluate((b) => b.scrollIntoView({ block: 'center' }));
      await openLab.click();
      await page.locator('.pl-card-main:has-text("4 on, 4 off")').click();
      await page.waitForSelector('.pl-money', { timeout: 8000 });
      const k8 = await page.locator('.pl-money .k').innerText();
      ok('council: an 8-day cycle says its paycheck figure is an average (#7)', /avg\. over 4 paychecks/.test(k8), JSON.stringify(k8));
      await page.keyboard.press('Escape');
      await page.waitForSelector('.cdlg', { timeout: 4000 }).catch(() => {});
      await page.locator('.cdlg .btn-danger').click().catch(() => {});
      await gone('.modal[role="dialog"]');
      await openLab.evaluate((b) => b.scrollIntoView({ block: 'center' }));
      await openLab.click();
      await page.locator('.pl-card-main:has-text("Mon–Wed nights")').click();
      await page.waitForSelector('.pl-money', { timeout: 8000 });
      const k7 = await page.locator('.pl-money .k').innerText();
      ok('council: a 7-day cycle carries no average caption (#7 control)', !/avg\./.test(k7), JSON.stringify(k7));

      await page.locator('.pl-brushes .chip-sel:has-text("Charge day")').click();
      const hint = await page.evaluate(() => [...document.querySelectorAll('.modal .hint')].map((h) => h.textContent).find((t) => /Tap a day/.test(t)) || '(no hint)');
      ok('council: the grid hint is honest about template cells (#11)', /Template cells/.test(hint) && !/pick up your weekend differentials automatically/.test(hint), JSON.stringify(hint));
      await page.locator('.pl-cell').first().click();
      const fx = await page.evaluate(() => { const c = document.querySelector('.pl-cell.on .fx'); return c ? c.closest('.pl-cell').getAttribute('aria-label') : '(no marker)'; });
      ok('council: a template-painted cell is marked and says its pay type is fixed (#11)', /template/.test(fx), JSON.stringify(fx));

      await page.locator('.modal button:has-text("Put it on the calendar")').click();
      const startInput = page.locator('.pl-apply input[type="date"]');
      await startInput.fill('2026-10-05');
      await page.locator('input[aria-label="Cycle start date"]').fill('2026-09-21');
      const startAfter = await startInput.inputValue();
      ok('council: editing the cycle anchor leaves a customised apply-start alone (#28)', startAfter === '2026-10-05', JSON.stringify(startAfter));

      ok('council: runIcalSync logs a failed background sync (#27)', /catch\(e\)\{\n\s*console\.error\('ical sync failed:'/.test(src));
      ok('council: manual .ics re-import counts only changed matches (#27)', /setIcsImport\(\{ groups, toUpdate:plan\.toUpdate\.filter\(u=>u\.changed\)/.test(src));
      ok('council: month section refs are dropped on unmount (#28)', /else delete monthSecRefs\.current\[mo\.key\]/.test(src));

      ok('council: no page errors across the group-7 drive', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }
  }

  await browser.close();
  server.close();
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log(`\n==== smoke: ${pass} passed / ${fail} failed ====${ONLY.length ? `  (sections ${ONLY.join(',')} only)` : ''}\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('harness error:', e); process.exit(1); });
