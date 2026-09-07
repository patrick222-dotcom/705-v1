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

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`); }
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

const newPage = async (browser, url, { seed = true } = {}) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
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
  {
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

    const flushed = await page.evaluate(() => {
      localStorage.setItem('scrubpayErrors', JSON.stringify([{ t: 1, msg: 'x', src: 'y', line: 1 }]));
      flushClientErrors(null);
      return localStorage.getItem('scrubpayErrors');
    });
    ok('errors: flushClientErrors consumes the buffer', flushed === null);
    await ctx.close();
  }

  /* ---- 2. onboarding funnel instrumentation ------------------------------------------- */
  {
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

  /* ---- 3. failure mode: getSession() hangs (the WebKit deadlock) ----------------------- */
  {
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

  /* ---- 4. failure mode: Babel blocked -> the boot error screen ------------------------- */
  {
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

  await browser.close();
  server.close();
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log(`\n==== smoke: ${pass} passed / ${fail} failed ====\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('harness error:', e); process.exit(1); });
