/* Wage-core equality against the DEPLOYED build (Invariant 3, protocol step 4).
 *
 *   node tests/wage_equality.mjs
 *
 * Probes prove the wage functions are self-consistent. They do NOT prove the *rendered* dollar
 * figures are unchanged for cases nobody thought to probe. This renders the same seeded state
 * against the working tree and against https://badgebudget.com/index.html and asserts the hero
 * figure, the Gross / Taxes / Keep-% chips, every Breakdown row and the take-home text are
 * byte-identical — or, where a change is intended, that the ONLY differences are the named ones.
 *
 * Both copies get the harness's CDN rewrite, so the comparison isolates the app's own math.
 * DEPLOYED_URL can be overridden to diff against a PR preview instead.
 */
import { chromium, devices } from 'playwright-core';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { serve, STORAGE_KEY } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, '.equality-scratch');
const DEPLOYED_URL = process.env.DEPLOYED_URL || 'https://badgebudget.com/index.html';
const BROWSER = process.env.PW_CHROMIUM
  || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const LAUNCH = existsSync(BROWSER) ? { executablePath: BROWSER, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };

const CDN = [
  ['https://unpkg.com/react@18.2.0/umd/react.production.min.js', 'react/umd/react.production.min.js'],
  ['https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js', 'react-dom/umd/react-dom.production.min.js'],
  ['https://unpkg.com/@babel/standalone@7.24.7/babel.min.js', '@babel/standalone/babel.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'pdfjs-dist/build/pdf.min.js'],
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js', '@supabase/supabase-js/dist/umd/supabase.js'],
];
const localize = (html, label) => {
  for (const [cdn, local] of CDN) {
    if (!html.includes(cdn)) throw new Error(`${label}: CDN pin moved, harness is stale: ${cdn}`);
    html = html.replace(cdn, `/node_modules/${local}`);
  }
  return html.replace(/\s+integrity="sha384-[^"]*"/g, '').replace(/\s+crossorigin="[^"]*"/g, '');
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = new Date();
const day = (n) => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));

const sh = (o) => ({ id: Math.random(), bonusType: 'none', customBonus: 0, isOvertime: false, ...o });

/* Changes we MEANT to make. A diff that matches one of these is reported as intended and does
   not fail the run; anything else does. Keeping the list here — rather than loosening the
   comparison — is the point: every accepted change to a displayed dollar figure is named, dated
   and justified in the file that checks for it. */
const INTENDED = [{
  since: '2026-09-15',
  what: 'withholding lines round to the cent',
  why: 'A payroll system cannot withhold $164.4984; it withholds $164.50. Rounding each tax '
     + 'component to whole cents is what a paycheck does, and it makes the Breakdown rows sum '
     + 'to the deduction total exactly instead of approximately. Where a component lands within '
     + 'a half-cent of a dollar boundary the ZERO-DECIMAL display can therefore move by $1 '
     + '(164.4984 renders 164; 164.50 renders 165). The cent value is the correct one.',
  matches: (localLine, deployedLine) => {
    const money = (l) => { const m = String(l).match(/\$([\d,]+)/); return m ? Number(m[1].replace(/,/g, '')) : NaN; };
    const a = money(localLine), b = money(deployedLine);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1;
  },
}];

/* The cases the #65 harness covered, plus awkward real-world rates that expose float dust. */
const CASES = {
  'pre+post-tax deductions': {
    baseRate: 50, federalTaxRate: 12, stateTaxRate: 5, ficaType: 'standard',
    pretaxDeductions: 180, posttaxDeductions: 65,
    shifts: { [day(0)]: [sh({ shiftType: 'base', hours: 12 })], [day(2)]: [sh({ shiftType: 'night', hours: 12 })] },
  },
  'custom FICA percent': {
    baseRate: 47.35, federalTaxRate: 14.5, stateTaxRate: 3.07, ficaType: 'percent', ficaWithholdingPercent: 6.2,
    pretaxDeductions: 0, posttaxDeductions: 0,
    shifts: { [day(1)]: [sh({ shiftType: 'weekend-eve', hours: 12.5 })] },
  },
  'percent + dollar custom withholdings': {
    baseRate: 61.19, federalTaxRate: 11, stateTaxRate: 4.25, ficaType: 'standard',
    pretaxDeductions: 95.5, posttaxDeductions: 12.75,
    customWithholdings: [{ name: 'Union dues', amount: 2.5, type: 'percent' }, { name: 'Parking', amount: 33.33, type: 'dollar' }],
    shifts: { [day(0)]: [sh({ shiftType: 'base', hours: 8 })], [day(3)]: [sh({ shiftType: 'holiday', hours: 12 })] },
  },
  'overtime shift': {
    baseRate: 50, federalTaxRate: 12, stateTaxRate: 5, ficaType: 'standard',
    pretaxDeductions: 0, posttaxDeductions: 0,
    shifts: { [day(0)]: [sh({ shiftType: 'night', hours: 12, isOvertime: true })] },
  },
  'PTO day at base rate': {
    baseRate: 70.81, federalTaxRate: 12, stateTaxRate: 3.07, ficaType: 'standard',
    pretaxDeductions: 80.16, posttaxDeductions: 40.08,
    shifts: { [day(0)]: [sh({ shiftType: 'base', hours: 12 })] },
    dayEvents: { [day(4)]: [{ id: 1, kind: 'pto', hours: 11.5 }] },
  },
  'awkward rates + bonuses (float dust)': {
    baseRate: 70.81, federalTaxRate: 13.33, stateTaxRate: 3.07, ficaType: 'standard',
    pretaxDeductions: 254.24, posttaxDeductions: 12.41,
    customWithholdings: [{ name: 'Corestream', amount: 1.37, type: 'percent' }],
    shifts: {
      [day(0)]: [sh({ shiftType: 'base', hours: 11.75 })],
      [day(1)]: [sh({ shiftType: 'night', hours: 12.5, bonusType: 'charge' })],
      [day(2)]: [sh({ shiftType: 'weekend-eve', hours: 4.6, bonusType: 'custom', customBonus: 115 })],
      [day(5)]: [sh({ shiftType: 'weekend-day', hours: 12.25, isOvertime: true })],
    },
  },
};

/* Every money surface the dashboard renders, as one comparable string.
   Seeding goes through addInitScript, not a post-load write + reload: the app boots, writes its
   own first-run state, and a reload then races the debounced save. Seeding before any script
   runs is the only way the blob is the one the app actually hydrates from. A fresh context per
   render also stops one case's localStorage bleeding into the next. */
async function surfaces(browser, url, seed) {
  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx.addInitScript(([k, v]) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {}
  }, [STORAGE_KEY, seed]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.dash', { state: 'attached', timeout: 25000 });
  await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });
  const out = await page.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '<missing>');
    const rows = [...document.querySelectorAll('.bd-row')].map((r) => txt(r.querySelector('.lh')));
    return [
      'HERO      ' + txt(document.querySelector('.hero .num')),
      'CHIPS     ' + [...document.querySelectorAll('.hero .chip')].map((c) => txt(c)).join(' | '),
      ...rows.map((r, i) => 'ROW' + String(i).padStart(2, '0') + '     ' + r),
      'TAKEHOME  ' + txt(document.querySelector('.takehome')),
    ].join('\n');
  });
  await ctx.close();
  if (errs.length) throw new Error(`page error while rendering: ${errs[0]}`);
  return out;
}

(async () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(join(SCRATCH, 'local.html'), localize(readFileSync(join(ROOT, 'index.html'), 'utf8'), 'local'));

  process.stdout.write(`fetching ${DEPLOYED_URL} ...`);
  const res = await fetch(`${DEPLOYED_URL}?cb=${Date.now()}`);
  if (!res.ok) throw new Error(`deployed fetch failed: HTTP ${res.status}`);
  const deployedHtml = await res.text();
  console.log(` ${deployedHtml.length} bytes`);
  writeFileSync(join(SCRATCH, 'deployed.html'), localize(deployedHtml, 'deployed'));

  const { server, url } = await serve(ROOT, SCRATCH);
  const browser = await chromium.launch(LAUNCH);

  let same = 0; const diffs = []; const intended = [];
  for (const [name, seed] of Object.entries(CASES)) {
    seed.setupComplete = true; seed.payPeriodStart = day(0);
    const a = await surfaces(browser, `${url}/local.html`, seed);
    const b = await surfaces(browser, `${url}/deployed.html`, seed);
    if (a === b) { same++; console.log(`SAME  ${name}`); }
    else {
      const la = a.split('\n'), lb = b.split('\n');
      const lines = []; let allIntended = true;
      for (let i = 0; i < Math.max(la.length, lb.length); i++) {
        if (la[i] === lb[i]) continue;
        const rule = INTENDED.find((r) => r.matches(la[i], lb[i]));
        if (!rule) allIntended = false;
        lines.push(`      local    ${la[i] ?? '<none>'}\n      deployed ${lb[i] ?? '<none>'}`
          + (rule ? `\n      -> intended (${rule.since}): ${rule.what}` : '\n      -> UNEXPECTED'));
      }
      if (allIntended) { intended.push(name); console.log(`INTENDED  ${name}\n${lines.join('\n')}`); }
      else { diffs.push(name); console.log(`DIFF  ${name}\n${lines.join('\n')}`); }
    }
  }

  await browser.close(); server.close();
  console.log(`\n==== equality: ${same} identical / ${intended.length} intended / ${diffs.length} unexpected ====`);
  if (intended.length) console.log('intended:', intended.join(', '));
  if (diffs.length) { console.log('UNEXPECTED:', diffs.join(', ')); process.exit(1); }
})().catch((e) => { console.error('equality error:', e.message); process.exit(1); });
