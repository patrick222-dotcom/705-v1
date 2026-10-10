/* Invariant 3, step 4: the equality assertion against the DEPLOYED build.
 *
 * The wage-core skill requires this and it was previously done ad hoc, in whichever session ran
 * it (CLAUDE.md -> Testing notes the #65 harness did exactly this and left nothing behind). This
 * is that step, reusable.
 *
 * What it does: fetches https://badgebudget.com/index.html, builds a scratch copy of it the same
 * way tests/harness.mjs builds one of the working tree, serves both, and renders identical seeded
 * state against each -- then diffs the hero figure, every hero chip and every Breakdown row.
 *
 *   node tests/equality.mjs
 *
 * NEEDS NETWORK to badgebudget.com, so it is deliberately NOT part of `node tests/smoke.mjs` and
 * not a CI job: a wage change must be verified against what is actually live, which a runner with
 * no egress cannot do. Run it by hand in the wage-core session, before shipping.
 *
 * Reading the output: every case should print IDENTICAL. A case that DIFFERS is either the change
 * you intended -- name it in the session notes BEFORE running, per the skill -- or the bug. There
 * is no third reading, and "probably rounding" is not one of them.
 */
import { chromium, devices } from 'playwright-core';
import { buildScratch, serve, STORAGE_KEY } from './harness.mjs';
import { existsSync, rmSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SP = join(tmpdir(), 'badgebudget-equality');
const LIVE = process.env.EQUALITY_URL || 'https://badgebudget.com/index.html';
const shell = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const LAUNCH = { args: ['--no-sandbox'], ...(existsSync(shell) ? { executablePath: shell } : {}) };

/* Anchor the pay period on TODAY so every seeded shift is inside the fortnight the hero shows --
   the first pass put 2 of 3 shifts outside it, so the OT and PTO cases silently priced nothing. */
const iso = (d) => d.toISOString().slice(0, 10);
const TODAY = new Date();
const PPS = iso(TODAY);
const plus = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() + n); return iso(d); };
const SHIFTS = (extra = {}) => ({
  [plus(1)]: [{ id: 1, shiftType: 'night', hours: 12, bonusType: 'none', ...extra }],
  [plus(3)]: [{ id: 2, shiftType: 'night', hours: 12, bonusType: 'none', bonusType: 'charge' }],
  [plus(5)]: [{ id: 3, shiftType: 'weekend-day', hours: 8, bonusType: 'none' }],
  [plus(8)]: [{ id: 4, shiftType: 'holiday', hours: 12, bonusType: 'none' }],
});
const base = (extra) => ({ setupComplete: true, baseRate: 50, payPeriodStart: PPS, shifts: SHIFTS(), ...extra });
const WEEK48 = Object.fromEntries([0, 1, 2, 3].map((n) => [plus(n), [{ id: 10 + n, shiftType: 'night', hours: 12, bonusType: 'none' }]]));

/* The cases the #65 harness covered, plus the two my changes actually touch. */
const CASES = [
  ['plain', base()],
  ['pre+post tax', base({ pretaxDeductions: 200, posttaxDeductions: 75 })],
  ['custom FICA %', base({ ficaWithholdingType: 'percent', ficaWithholdingPercent: 6.2 })],
  ['$ withholding', base({ customWithholdings: [{ name: 'Union', type: 'dollar', amount: 40 }] })],
  ['% withholding', base({ customWithholdings: [{ name: '403b', type: 'percent', amount: 5 }] })],
  ['% AND $ withholding', base({ customWithholdings: [{ name: '403b', type: 'percent', amount: 5 }, { name: 'Union', type: 'dollar', amount: 40 }] })],
  ['overtime', { ...base(), shifts: SHIFTS({ isOvertime: true }) }],
  ['PTO day', base({ dayEvents: { [plus(2)]: [{ kind: 'pto', hours: 12 }] } })],
  ['everything at once', base({ pretaxDeductions: 200, posttaxDeductions: 75,
    ficaWithholdingType: 'percent', ficaWithholdingPercent: 6.2,
    customWithholdings: [{ name: '403b', type: 'percent', amount: 5 }, { name: 'Union', type: 'dollar', amount: 40 }],
    dayEvents: { [plus(2)]: [{ kind: 'pto', hours: 12 }] } })],
  ['deductions exceed gross', { setupComplete: true, baseRate: 50, payPeriodStart: PPS, shifts: {}, pretaxDeductions: 260 }],
  /* Session 2 (configurable work period, 2026-10-10). A 48-hour week crosses 40, so every rule
     below prices it differently -- which is what makes these cases able to see a change. */
  ['48-hour week, 40-hour rule', { ...base(), shifts: WEEK48 }],
  ['48-hour week, 8/80', { ...base(), shifts: WEEK48, workPeriod: '8-80' }],
  ['48-hour week, base-plus-diff', { ...base(), shifts: WEEK48, otMethod: 'base-plus-diff' }],
  ['stray custom fields on the 40-hour rule', { ...base(), shifts: WEEK48, otPeriodHours: 10, otPeriodDays: 7, otPeriodStart: PPS }],
  /* INTENDED differences, named before the first run: the deployed build does not know these two
     values, its sanitizer drops them, and it prices both as the 40-hour week. */
  ['48-hour week, only overtime I mark', { ...base(), shifts: WEEK48, workPeriod: 'flagged' },
    'intended: deployed adds the 40-hour premium; local adds none and says why'],
  ['48-hour week, 86 in 14 days', { ...base(), shifts: WEEK48, workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14, otPeriodStart: PPS },
    'intended: deployed adds the 40-hour premium; local adds none (48 h is under 86)'],
];


const readMoney = async (page) => page.evaluate(() => {
  const t = (s) => { const n = document.querySelector(s); return n ? n.textContent.trim() : null; };
  return {
    hero: t('.hero .num'),
    chips: [...document.querySelectorAll('.hero .chip')].map((c) => c.textContent.trim()),
  };
});

const openBreakdown = async (page) => page.evaluate(() => {
  const b = [...document.querySelectorAll('button, .linklike, a')]
    .find((x) => /breakdown|see the math|where it goes/i.test(x.textContent || ''));
  if (b) b.click();
  return !!b;
});

/* Pull the live build and stand it up as a root buildScratch can consume. */
const fetchDeployed = async () => {
  const root = join(SP, 'deployed-root');
  mkdirSync(root, { recursive: true });
  const res = await fetch(LIVE + (LIVE.includes('?') ? '&' : '?') + 'cb=' + Date.now());
  if (!res.ok) throw new Error(`could not fetch ${LIVE}: HTTP ${res.status}`);
  const html = await res.text();
  /* The old github.io URL 301s to an empty 162-byte body, so a short response means the check is
     pointed at the redirect and would "pass" against nothing. See the `ship` skill. */
  if (html.length < 50000) throw new Error(`${LIVE} returned ${html.length} bytes — pointed at the 301, not the app?`);
  const sri = (html.match(/integrity="sha384-/g) || []).length;
  if (sri !== 5) throw new Error(`deployed build has ${sri} SRI scripts, expected 5 — not the app`);
  writeFileSync(join(root, 'index.html'), html);
  /* Everything else buildScratch needs beside index.html. privacy.html joined that list on
     2026-09-24 and this one did not, which broke the equality check silently -- it is not in
     CI by design, so nothing ran it until the next wage-core session went looking. */
  for (const f of ['pdf.worker.min.js', 'ops.html', 'privacy.html']) copyFileSync(join(ROOT, f), join(root, f));
  console.log(`fetched ${LIVE} — ${html.length} bytes, ${sri} SRI scripts\n`);
  return root;
};

const run = async () => {
  const deployedRoot = await fetchDeployed();
  const localScratch = SP + '/eq-local', depScratch = SP + '/eq-deployed';
  rmSync(localScratch, { recursive: true, force: true });
  rmSync(depScratch, { recursive: true, force: true });
  buildScratch(ROOT, localScratch);
  buildScratch(deployedRoot, depScratch);
  const a = await serve(ROOT, localScratch);
  const b = await serve(ROOT, depScratch);
  const browser = await chromium.launch(LAUNCH);

  const grab = async (url, seed) => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }, [STORAGE_KEY, seed]);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hero .num', { timeout: 25000 });
    const money = await readMoney(page);
    let rows = null;
    if (await openBreakdown(page)) {
      await page.waitForTimeout(600);
      rows = await page.evaluate(() => [...document.querySelectorAll('.bd-row')]
        .map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 24));
    }
    await ctx.close();
    return { ...money, rows };
  };

  let diffs = 0, intendedSame = 0;
  for (const [name, seed, intended] of CASES) {
    const L = await grab(a.url, seed);
    const D = await grab(b.url, seed);
    const same = JSON.stringify(L) === JSON.stringify(D);
    console.log(`\n--- ${name} --- ${same ? 'IDENTICAL' : 'DIFFERS'}${intended ? `  (${intended})` : ''}`);
    /* A case named as an intended difference that comes back IDENTICAL is a failure too: the
       change it was meant to show did not reach the screen. */
    if (intended && same) intendedSame++;
    if (!same && intended) {
      console.log('  deployed:', JSON.stringify(D));
      console.log('  local   :', JSON.stringify(L));
    } else if (!same) {
      diffs++;
      console.log('  deployed:', JSON.stringify(D));
      console.log('  local   :', JSON.stringify(L));
    } else {
      console.log('  ', JSON.stringify(L.hero), JSON.stringify(L.chips));
    }
  }
  await browser.close(); a.server.close(); b.server.close();
  const named = CASES.filter((c) => c[2]).length;
  console.log(`\n==== equality: ${CASES.length - named - diffs} identical / ${diffs} differ unintended / ${named - intendedSame} of ${named} named differences seen ====`);
  console.log(diffs || intendedSame
    ? 'FAIL: an unnamed case moved, or a named difference did not reach the screen.'
    : 'No unnamed figure moved against the live build, and every named difference showed.');
  process.exitCode = diffs || intendedSame ? 1 : 0;
};
run().catch((e) => { console.error('equality harness error:', e); process.exit(1); });
