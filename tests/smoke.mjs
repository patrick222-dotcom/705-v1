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
import { rmSync, existsSync } from 'node:fs';
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
    }, [STORAGE_KEY, seed === true ? SEEDED_STATE : seed]);
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

    /* ---- job record + integer cents: the structural spine ----------------------------
       Fixtures are Courtney's real Main Line Health and Aya Healthcare stubs, reconciled to
       the cent against the printed earnings lines. See docs/pay-model-research-2026-09.md. */
    const spine = await page.evaluate(() => {
      const t0 = { ficaType: 'standard', federalTaxRate: 0, stateTaxRate: 0,
        pretaxDeductions: 0, posttaxDeductions: 0, customWithholdings: [] };
      const legacy = sanitizeData({
        setupComplete: true, baseRate: 70.81,
        shifts: { '2025-12-08': [{ id: 1, shiftType: 'night', hours: 12, bonusType: 'none' }] },
      });
      const job = (legacy.jobs || [])[0] || {};
      return {
        /* 1. the float the engine must stop producing: 70.81 x 47.10 = 3335.15 on the stub */
        floatProduct: 70.81 * 47.10,
        centsProduct: shiftGrossCents(7081, null, { hours: 47.10, bonusType: 'none' }),
        /* 2. MLH prints 872.38 for 12.50h at 69.79 — half-up at the line, not truncation */
        halfUp: shiftGrossCents(6979, null, { hours: 12.5, bonusType: 'none' }),
        /* 3. computeNet takes a taxable/non-taxable split; Aya week 5/15-5/21/2022 */
        split: computeNet({ taxable: 3096, nonTaxable: 1442 }, t0),
        /* 4. a bare number still means "all taxable" so every existing call is unchanged */
        legacyScalar: computeNet(3096, t0),
        /* 5. a legacy blob migrates to exactly one job carrying the user-level rate */
        jobCount: (legacy.jobs || []).length,
        jobRate: job.baseRate,
        workPeriod: job.workPeriod,
        payFrequency: job.payFrequency,
        jobActive: job.active,
        /* 6. every shift is stamped with that job */
        stamped: legacy.shifts['2025-12-08'][0].jobId === job.id,
        /* 7. withholding lines round to the cent, and the rows sum to the total exactly */
        withhold: computeNet(1590.94, { ficaType:'standard', federalTaxRate:11, stateTaxRate:4.25,
          pretaxDeductions:95.5, posttaxDeductions:12.75,
          customWithholdings:[{name:'Union dues',amount:2.5,type:'percent'},{name:'Parking',amount:33.33,type:'dollar'}] }),
        /* 8. hours group by job and never combine across employers */
        grouped: groupHoursByJob(
          { A: { id: 'A' }, B: { id: 'B' } },
          { '2025-12-08': [{ jobId: 'A', hours: 30, shiftType: 'base', bonusType: 'none' },
                           { jobId: 'B', hours: 30, shiftType: 'base', bonusType: 'none' }] },
          ['2025-12-08']),
      };
    });
    ok('cents: the engine no longer multiplies floats',
      spine.floatProduct !== 3335.151 && spine.centsProduct === 333515,
      `float=${spine.floatProduct} cents=${spine.centsProduct}`);
    ok('cents: a half-cent rounds up, matching the printed stub line',
      spine.halfUp === 87238, `expected 87238 (872.375 -> 872.38), got ${spine.halfUp}`);
    ok('jobs: non-taxable money is never taxed',
      near(spine.split.fica, 236.84), `fica=${spine.split.fica} (7.65% of 3096, not of 4538)`);
    ok('jobs: non-taxable money passes straight through to net',
      near(spine.split.net, spine.legacyScalar.net + 1442),
      `split.net=${spine.split.net} scalar.net=${spine.legacyScalar.net}`);
    ok('jobs: a bare gross still means all-taxable (every old call unchanged)',
      near(spine.legacyScalar.gross, 3096) && near(spine.legacyScalar.nonTaxable || 0, 0));
    ok('jobs: a legacy blob migrates to exactly one job', spine.jobCount === 1);
    ok('jobs: the migrated job carries the user-level rate', spine.jobRate === 70.81);
    ok('jobs: it defaults to the 40-hour workweek', spine.workPeriod === '40',
      `got ${spine.workPeriod}`);
    ok('jobs: and to a biweekly pay frequency', spine.payFrequency === 'biweekly');
    ok('jobs: the migrated job is active', spine.jobActive === true);
    ok('jobs: every legacy shift is stamped with it', spine.stamped);
    ok('cents: a withholding line rounds to the cent, as payroll does',
      spine.withhold.fed === 164.5, `expected 164.50 (1495.44 x 11% = 164.4984), got ${spine.withhold.fed}`);
    ok('cents: Breakdown rows sum to the deduction total exactly',
      Math.round((spine.withhold.pre + spine.withhold.fed + spine.withhold.fica + spine.withhold.st
        + spine.withhold.post + spine.withhold.cw) * 100) === Math.round(spine.withhold.ded * 100),
      `rows=${(spine.withhold.pre+spine.withhold.fed+spine.withhold.fica+spine.withhold.st+spine.withhold.post+spine.withhold.cw).toFixed(2)} ded=${spine.withhold.ded.toFixed(2)}`);
    /* ---- overtime derived from the work period ------------------------------------
       Fixture is the Main Line Health workweek reconstructed to the cent from the
       2023-09-30 stub: 24.50h at $65.15 + 16.75h at $69.79 = 41.25h, a printed FLSA
       regular rate of $67.034424, and 1.25h of overtime. MLH pays straight time on all
       hours plus a half-time premium on the regular rate, which is 29 CFR 778.115. */
    const ot = await page.evaluate(() => {
      const J = (o) => makeJob({ id: 'job-1', baseRate: 65.15, ...o });
      const diffs = { base: { type: 'dollar', amount: 0 }, eve: { type: 'dollar', amount: 4.64 } };
      const mk = (o) => ({ shiftType: 'base', bonusType: 'none', customBonus: 0, isOvertime: false, jobId: 'job-1', ...o });
      const days = (n) => Array.from({ length: n }, (_, i) => `2025-12-${String(7 + i).padStart(2, '0')}`);
      const week = days(7), fortnight = days(14);
      return {
        /* MLH: 41.25h over a 40-hour workweek */
        mlh: overtimePremiumCents(J({ differentials: diffs }), {
          '2025-12-07': [mk({ shiftType: 'base', hours: 12 }), mk({ shiftType: 'eve', hours: 4.75 })],
          '2025-12-08': [mk({ shiftType: 'base', hours: 12 }), mk({ shiftType: 'eve', hours: 12 })],
          '2025-12-09': [mk({ shiftType: 'base', hours: 0.5 })],
        }, week),
        /* TP-001 as it should have been written: $30 base + $5 diff, 48-hour week */
        tp001: overtimePremiumCents(
          J({ baseRate: 30, differentials: { night: { type: 'dollar', amount: 5 } } }),
          Object.fromEntries(days(4).map((d) => [d, [mk({ shiftType: 'night', hours: 12 })]])), week),
        tp001Straight: days(4).reduce((a, d) => a + shiftGrossCents(3000, { type: 'dollar', amount: 5 }, { hours: 12, bonusType: 'none' }), 0),
        /* three 12s = 36h: no overtime on a 40-hour week... */
        under40: overtimePremiumCents(J({ differentials: diffs }),
          Object.fromEntries(days(3).map((d) => [d, [mk({ hours: 12 })]])), week),
        /* ...but 4 hours a shift under the section 7(j) daily-8 rule */
        under40on880: overtimePremiumCents(J({ workPeriod: '8-80', differentials: diffs }),
          Object.fromEntries(days(3).map((d) => [d, [mk({ hours: 12 })]])), fortnight),
        /* a hand-flagged shift is already paid 1.5x by shiftGross; never charge it twice */
        flagged: overtimePremiumCents(J({ differentials: diffs }),
          Object.fromEntries(days(4).map((d, i) => [d, [mk({ hours: 12, isOvertime: i === 3 })]])), week),
        /* the employer that uses the common shortcut: half of BASE, not of the regular rate */
        shortcut: overtimePremiumCents(
          J({ baseRate: 30, otMethod: 'base-plus-diff', differentials: { night: { type: 'dollar', amount: 5 } } }),
          Object.fromEntries(days(4).map((d) => [d, [mk({ shiftType: 'night', hours: 12 })]])), week),
      };
    });
    ok('ot: the FLSA regular rate is straight-time remuneration over hours worked',
      Math.round(ot.mlh.periods[0].regularRateCents * 100) === 670342,
      `MLH printed $67.034424/hr; we compute $${(ot.mlh.periods[0].regularRateCents / 100).toFixed(6)}`);
    ok('ot: hours past 40 in the workweek are the overtime hours',
      ot.mlh.otHours === 1.25, `got ${ot.mlh.otHours}`);
    ok('ot: the premium is half the regular rate, straight time already paid',
      ot.mlh.premiumCents === 4190, `expected 4190 (0.5 x 67.0342 x 1.25), got ${ot.mlh.premiumCents}`);
    ok('ot: TP-001 corrected — $30 + $5 over 48h is $1,820, not the $1,830 in the findings file',
      ot.tp001.periods[0].regularRateCents === 3500 && ot.tp001Straight + ot.tp001.premiumCents === 182000,
      `rate=${ot.tp001.periods[0].regularRateCents} total=${ot.tp001Straight + ot.tp001.premiumCents}`);
    ok('ot: three 12s are not overtime on a 40-hour workweek',
      ot.under40.otHours === 0 && ot.under40.premiumCents === 0);
    ok('ot: but 8/80 makes every 12-hour shift throw 4 daily overtime hours',
      ot.under40on880.otHours === 12, `got ${ot.under40on880.otHours}`);
    ok('ot: a hand-flagged shift is never paid the premium twice',
      ot.flagged.otHours === 0, `8h over 40 all sit inside the flagged shift; got ${ot.flagged.otHours}`);
    ok('ot: base-plus-diff pays half of BASE, not half the regular rate',
      ot.shortcut.premiumCents === 12000, `expected 12000 (0.5 x $30 x 8h), got ${ot.shortcut.premiumCents}`);

    ok('jobs: hours group per job and never combine across employers',
      spine.grouped && spine.grouped.A && spine.grouped.B
        && spine.grouped.A.hours === 30 && spine.grouped.B.hours === 30,
      JSON.stringify(spine.grouped));

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

  /* ---- 8. overtime reaches the screen, and the screen explains it --------------------- */
  if (want(8)) {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date();
    const day = (n) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
    /* Four 12s inside one workweek: 48 hours at $30 + $5, the corrected TP-001 case. Straight
       time is $1,680 and the FLSA premium is $140, so gross must read $1,820. */
    const shifts = {};
    [0, 1, 2, 3].forEach((n) => { shifts[day(n)] = [{ id: n, shiftType: 'night', hours: 12, bonusType: 'none', customBonus: 0, isOvertime: false }]; });
    const seed = {
      setupComplete: true, baseRate: 30, payPeriodStart: day(0),
      federalTaxRate: 0, stateTaxRate: 0, ficaType: 'percent', ficaWithholdingPercent: 0,
      pretaxDeductions: 0, posttaxDeductions: 0,
      differentials: { night: { name: 'Night', amount: 5, type: 'dollar', active: true } },
      shifts,
    };
    const { ctx, page, errors } = await newPage(browser, url, { seed });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });
    const g = await page.evaluate(() => {
      const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
      return {
        gross: txt([...document.querySelectorAll('.hero .chip')].find((c) => /Gross/.test(c.textContent))),
        note: txt(document.querySelector('.bd-note')),
      };
    });
    ok('ot: a 48-hour week now projects overtime instead of nothing',
      g.gross === 'Gross $1,820', `got "${g.gross}" (straight time alone is $1,680)`);
    ok('ot: the breakdown says how much, over what threshold, at what rate',
      /overtime/i.test(g.note) && /8 hrs past 40 in a week/.test(g.note) && /\$35\.00\/hr/.test(g.note), g.note);
    ok('ot: and tells her employers differ, rather than asserting she is owed it',
      /check it against your stub/i.test(g.note), g.note);
    ok('ot: no page errors driving it', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();
  }

  await browser.close();
  server.close();
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log(`\n==== smoke: ${pass} passed / ${fail} failed ====${ONLY.length ? `  (sections ${ONLY.join(',')} only)` : ''}\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('harness error:', e); process.exit(1); });
