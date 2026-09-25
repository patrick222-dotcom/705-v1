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
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildScratch, serve, isExpectedNetwork, makeMinimalPdf, SEEDED_STATE, STORAGE_KEY } from './harness.mjs';

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
    /* ---- paystub import ------------------------------------------------------------
       Fixtures are the real HOURS AND EARNINGS rows off Courtney's two Main Line Health
       stubs, space-joined the way pdf.js hands them over (items are joined with ' ', so
       inside a page there are no line breaks to anchor on — which is why the old parser
       needed a "PD " prefix and therefore saw nothing on the 2025 format). */
    const stub = await page.evaluate(() => {
      const HDR = 'Description Rate Hours Earnings Hours Earnings ';
      const perDiem2023 = HDR
        + 'Inservice / Seminars 65.150000 3.50 228.03 46.25 3,013.21 '
        + 'PD Weekday Day 65.150000 30.00 1,954.51 510.50 33,259.28 '
        + 'PD Weekday Eve 69.790000 12.50 872.38 297.25 20,745.12 '
        + 'PD Weekend Day 65.150000 11.50 749.23 87.25 5,684.36 '
        + 'PD Weekend Eve 69.790000 16.50 1,151.54 61.75 4,309.57 '
        + 'PD Weekend Overtime Eve 67.034424 1.25 129.13 1.25 129.13 '
        + 'Hourly Unpaid Absence 0.00 24.50 0.00 '
        + 'Critical Staffing Bonus 0.00 12.00 300.00 '
        + 'Bonus-Critical Staffing 0.00 100.00 ';
      const benefited2025 = HDR
        + 'Regular 70.810000 47.10 3,335.15 1,065.65 74,092.42 '
        + '3rd Shift Differential 7.000000 20.00 140.00 485.60 3,399.20 '
        + 'DVH - Downstaff Vol Holiday 70.810000 5.90 417.78 5.90 417.78 '
        + 'SI2 - Staffing Incentive Level 25.000000 4.60 115.00 4.60 115.00 '
        + 'Superior Experience Award 0.00 187.50 '
        + 'Authorized Unpaid Absence 0.00 30.72 0.00 '
        + '2nd Shift Differential 0.00 14.90 67.06 ';
      /* Not from a stub — a column shape. Both of hers print 0.00 in the current-earnings
         column on a YTD-only row, so `rate > 0` happens to reject them and the column-count
         guard never fires. A layout that omits the blank current columns instead would hand
         the parser (rate, ytdHours, ytdEarnings) and it would import a phantom 78-hour row.
         That is what the >=5 guard is for, so it gets a case rather than going untested. */
      const ytdOnlyShape = HDR + 'Basic Leave 70.810000 78.26 5,414.03 ';
      const by = (rows, d) => rows.find((r) => r.description === d) || null;
      const a = parseEarningsRows(perDiem2023), b = parseEarningsRows(benefited2025);
      return {
        ytdOnly: parseEarningsRows(ytdOnlyShape).map((r) => r.description),
        old2023: a.map((r) => r.description),
        new2025: b.map((r) => r.description),
        weekdayDay: by(a, 'PD Weekday Day'),
        thirdShift: by(b, '3rd Shift Differential'),
        otRow: by(a, 'PD Weekend Overtime Eve'),
        /* What the app would actually WRITE into her differentials from each stub. This is
           the number that ends up on screen, so it is the one worth pinning. */
        derived2023: differentialsFromStub(a, 65.15),
        derived2025: differentialsFromStub(b, 70.81),
        classify: {
          third: classifyPaystubRow('3rd Shift Differential'),
          second: classifyPaystubRow('2nd Shift Differential'),
          si2: classifyPaystubRow('SI2 - Staffing Incentive Level'),
          dvh: classifyPaystubRow('DVH - Downstaff Vol Holiday'),
          regular: classifyPaystubRow('Regular'),
          weekendEve: classifyPaystubRow('PD Weekend Eve'),
          weekdayDay: classifyPaystubRow('PD Weekday Day'),
          night: classifyPaystubRow('Night Shift Diff'),
        },
      };
    });
    ok('stub: the 2025 format parses at all — it used to yield nothing',
      JSON.stringify(stub.new2025) === JSON.stringify(
        ['Regular', '3rd Shift Differential', 'DVH - Downstaff Vol Holiday', 'SI2 - Staffing Incentive Level']),
      JSON.stringify(stub.new2025));
    ok('stub: and names the two rows that carry her real differentials',
      stub.new2025.includes('3rd Shift Differential') && stub.new2025.includes('SI2 - Staffing Incentive Level'),
      JSON.stringify(stub.new2025));
    ok('stub: the 2023 per-diem format still parses, and the column header is not a row',
      stub.old2023.length === 6 && stub.old2023[0] === 'Inservice / Seminars'
      && stub.old2023[1] === 'PD Weekday Day', JSON.stringify(stub.old2023));
    ok('stub: rate and hours come off the row, not the header',
      stub.weekdayDay && stub.weekdayDay.rate === 65.15 && stub.weekdayDay.hours === 30,
      JSON.stringify(stub.weekdayDay));
    ok('stub: a differential row keeps its own rate, not the base rate',
      stub.thirdShift && stub.thirdShift.rate === 7 && stub.thirdShift.hours === 20,
      JSON.stringify(stub.thirdShift));
    ok('stub: YTD-only rows are skipped, not read as current activity',
      !stub.old2023.includes('Hourly Unpaid Absence') && !stub.new2025.includes('Superior Experience Award')
      && !stub.new2025.includes('2nd Shift Differential'), JSON.stringify(stub.old2023.concat(stub.new2025)));
    ok('stub: a row carrying only YTD columns is skipped even when its rate is real',
      stub.ytdOnly.length === 0, JSON.stringify(stub.ytdOnly));
    ok('stub: a row whose rate x hours does not equal earnings is flagged, not trusted',
      stub.otRow && stub.otRow.exact === false && stub.weekdayDay.exact === true,
      `ot=${JSON.stringify(stub.otRow)}`);
    ok('stub: the blended FLSA overtime rate never becomes her weekend differential',
      stub.derived2023['weekend-eve'] === 4.64,
      `PD Weekend Eve says +$4.64; got ${stub.derived2023['weekend-eve']}`);
    ok('stub: the 2023 rows she actually worked derive the rates the stub prints',
      stub.derived2023['weekday-eve'] === 4.64 && stub.derived2023['weekend-day'] === 0,
      JSON.stringify(stub.derived2023));
    ok('stub: a Rate column holding the differential alone is not subtracted from base',
      stub.derived2025['night'] === 7, `7.00 - 70.81 would be -63.81; got ${stub.derived2025['night']}`);
    ok('stub: no import can write a negative differential',
      Object.values(stub.derived2023).concat(Object.values(stub.derived2025)).every((v) => v >= 0),
      JSON.stringify([stub.derived2023, stub.derived2025]));
    ok('stub: "3rd Shift" is recognised as a night differential',
      stub.classify.third === 'night', String(stub.classify.third));
    ok('stub: "2nd Shift" is recognised as an evening differential',
      stub.classify.second === 'weekday-eve', String(stub.classify.second));
    ok('stub: "Staffing Incentive Level" is no longer read as an evening differential',
      stub.classify.si2 === null, `"Level" contains "eve"; got ${stub.classify.si2}`);
    ok('stub: a downstaffing row is not read as a holiday premium',
      stub.classify.dvh === null, String(stub.classify.dvh));
    ok('stub: existing classifications are unchanged',
      stub.classify.weekendEve === 'weekend-eve' && stub.classify.night === 'night'
      && stub.classify.weekdayDay === null && stub.classify.regular === null,
      JSON.stringify(stub.classify));

    /* ---- the unpaid meal break -----------------------------------------------------
       Main Line Health schedules a 12.5-hour block, auto-deducts 30 minutes, and pays 12.0.
       So the "12 hours" a nurse types is ALREADY net of the meal — the deduction is not
       missing from our math, it is baked into her input. What we cannot express is the
       exception: submitting "received no lunch" pays the full 12.5. That is an ADD-BACK.
       'deducted' is the other shape, where the logged hours are the scheduled block and the
       employer subtracts the meal — the arrangement behind most healthcare meal-break
       litigation. Both exist because this varies by employer; only 'included' is proven. */
    const meal = await page.evaluate(() => {
      const J = (o) => makeJob({ id: 'job-1', baseRate: 65.15, ...o });
      const mk = (o) => ({ shiftType: 'base', bonusType: 'none', customBonus: 0, isOvertime: false, jobId: 'job-1', hours: 12, ...o });
      const inc = J({}), ded = J({ mealBreakMode: 'deducted' });
      const days = (n) => Array.from({ length: n }, (_, i) => `2025-12-${String(7 + i).padStart(2, '0')}`);
      return {
        defaults: { mins: inc.mealBreakMins, mode: inc.mealBreakMode },
        /* the normal case: what she types is what she is paid, so nothing moves */
        plain: paidHoursOf(mk({}), inc),
        noLunch: paidHoursOf(mk({ noMeal: true }), inc),
        /* the other shape: the block is logged and the meal comes off it */
        dedPlain: paidHoursOf(mk({ hours: 12.5 }), ded),
        dedNoLunch: paidHoursOf(mk({ hours: 12.5, noMeal: true }), ded),
        /* a shift can never be worth less than zero hours, however the config is set */
        dedTiny: paidHoursOf(mk({ hours: 0.25 }), ded),
        /* gross follows paid hours, not logged hours */
        grossPlain: shiftGrossCents(6515, null, mk({}), inc),
        grossNoLunch: shiftGrossCents(6515, null, mk({ noMeal: true }), inc),
        /* and the extra half hour counts toward the overtime threshold */
        otWithout: overtimePremiumCents(J({ differentials: {} }),
          Object.fromEntries(days(4).map((d) => [d, [mk({})]])), days(7)),
        otWith: overtimePremiumCents(J({ differentials: {} }),
          Object.fromEntries(days(4).map((d) => [d, [mk({ noMeal: true })]])), days(7)),
      };
    });
    ok('meal: defaults are 30 minutes, already-deducted — so nothing moves by default',
      meal.defaults.mins === 30 && meal.defaults.mode === 'included',
      JSON.stringify(meal.defaults));
    ok('meal: a logged 12h shift still pays 12h', meal.plain === 12, `got ${meal.plain}`);
    ok('meal: "no lunch" pays the full 12.5h block', meal.noLunch === 12.5, `got ${meal.noLunch}`);
    ok('meal: on a deduct employer a logged 12.5h block pays 12h',
      meal.dedPlain === 12, `got ${meal.dedPlain}`);
    ok('meal: and "no lunch" cancels the deduction', meal.dedNoLunch === 12.5, `got ${meal.dedNoLunch}`);
    ok('meal: paid hours never go negative', meal.dedTiny === 0, `got ${meal.dedTiny}`);
    ok('meal: gross follows PAID hours, not logged hours',
      meal.grossPlain === 78180 && meal.grossNoLunch === 81438,
      `plain=${meal.grossPlain} noLunch=${meal.grossNoLunch} (12.5 x 65.15 = 814.375 -> 814.38)`);
    ok('meal: four 12h shifts are not overtime, but four missed lunches are',
      meal.otWithout.otHours === 8 && meal.otWith.otHours === 10,
      `without=${meal.otWithout.otHours} with=${meal.otWith.otHours} (4 x 12.5 = 50h)`);

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

  /* ---- 9. the missed lunch reaches the screen ---------------------------------------- */
  if (want(9)) {
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const t = new Date();
    const day = (n) => iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + n));
    const base = {
      setupComplete: true, baseRate: 65.15, payPeriodStart: day(0),
      federalTaxRate: 0, stateTaxRate: 0, ficaWithholdingType: 'percent', ficaWithholdingPercent: 0,
      pretaxDeductions: 0, posttaxDeductions: 0,
    };
    const shift = (extra) => ({ id: 1, shiftType: 'base', hours: 12, bonusType: 'none', customBonus: 0, isOvertime: false, ...extra });
    const read = async (seed) => {
      const { ctx, page, errors } = await newPage(browser, url, { seed });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });
      const out = await page.evaluate(() => {
        const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
        return {
          gross: txt([...document.querySelectorAll('.hero .chip')].find((c) => /Gross/.test(c.textContent))),
          hrs: txt([...document.querySelectorAll('.hero .chip')].find((c) => /hrs/.test(c.textContent))),
        };
      });
      const real = errors.filter((e) => !isExpectedNetwork(e));
      await ctx.close();
      return { ...out, errors: real };
    };
    const got = await read({ ...base, shifts: { [day(0)]: [shift({})] } });
    const missed = await read({ ...base, shifts: { [day(0)]: [shift({ noMeal: true })] } });

    ok('meal: an ordinary 12h shift is unchanged — the default moves nothing',
      got.gross === 'Gross $782' && got.hrs === '12 hrs · 1 shifts', `${got.gross} / ${got.hrs}`);
    ok('meal: a missed lunch pays the full 12.5h block',
      missed.gross === 'Gross $814' && missed.hrs === '12.5 hrs · 1 shifts', `${missed.gross} / ${missed.hrs}`);
    ok('meal: no page errors either way',
      got.errors.length === 0 && missed.errors.length === 0, (got.errors[0] || missed.errors[0] || ''));

    /* the control itself has to exist, or the flag is unreachable in the real app */
    const { ctx, page } = await newPage(browser, url, { seed: { ...base, shifts: {} } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fab', { timeout: 25000 });
    await page.locator('.fab').first().click();
    await page.waitForSelector('.sheet', { timeout: 15000 });
    const sheet = await page.evaluate(() => document.body.innerText);
    ok('meal: the Add Shift sheet offers the toggle, worded as what happened',
      /MEAL BREAK/.test(sheet) && /never got my 30-minute lunch/.test(sheet),
      (sheet.match(/never got[^\n]*/) || ['<missing>'])[0]);
    await ctx.close();
  }

  /* ---- 10. the paystub importer, driven with a real PDF ------------------------------
     Everything above about the stub parser is a unit test on a fixture string. This is the
     only place the whole path runs: a file goes into the input, pdf.js reads it, and the
     review sheet renders what would be written. Using a real PDF matters — pdf.js returns
     one text item per Tj and the app joins them with a single space, so this is what proves
     the parser survives having no line breaks to work with. */
  if (want(10)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });
    /* Her 2025 stub: base pay on its own row, and a differential row whose Rate column holds
       the premium alone. Subtracting base from that $7.00 would write -$63.81/hr. */
    const pdf = makeMinimalPdf([
      /* Laid out the way the real stub is: the Pay Rate label and its value are in different
         table columns, so everything from the employee-id block sits between them. A tidied
         fixture would have hidden the bug this section exists to pin. */
      'Pay Begin Date: 08/11/2025',
      'Pay End Date: 08/24/2025',
      'Employee ID: Department: Location: Job Title: Pay Rate:',
      '57786 B01035-System Travel Agility Team Bryn Mawr Hospital STAT Nurse 5 $70.810000 Hourly',
      'HOURS AND EARNINGS',
      'Description Rate Hours Earnings Hours Earnings',
      'Regular 70.810000 47.10 3,335.15 1,065.65 74,092.42',
      '3rd Shift Differential 7.000000 20.00 140.00 485.60 3,399.20',
      'SI2 - Staffing Incentive Level 25.000000 4.60 115.00 4.60 115.00',
      '2nd Shift Differential 0.00 14.90 67.06',
      'TAXES',
      'Description Current YTD',
      'Fed W/H 327.42 8,859.89',
      'Fed MED/EE 58.04 1,500.50',
      'Fed OASDI/EE 248.16 6,415.92',
      'PA W/H 122.49 3,166.88',
      'PA PHILADELPHIA W/H 150.37 3,890.65',
      'PA  LS Tax 2.00 52.00',
      'TOTAL GROSS FED TAXABLE GROSS TOTAL TAXES TOTAL DEDUCTIONS NET PAY',
      'Current 4,007.93 3,927.77 911.29 1,057.76 2,038.88',
    ]);
    await page.locator('.topbar .avatar, .topbar button').first().click().catch(() => {});
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, a')].find((x) => /settings/i.test(x.textContent));
      if (b) b.click();
    });
    await page.waitForTimeout(400);
    const input = page.locator('input[type=file][accept=".pdf"]').first();
    await input.setInputFiles({ name: 'stub.pdf', mimeType: 'application/pdf', buffer: pdf });
    /* Settings is itself a .modal and matches instantly, so waiting on the selector would read
       the DOM before pdf.js has finished and score a parse failure as a test failure. Wait for
       the review sheet's own heading — or for the failure sheet, so a real break still reports
       as a break rather than as a timeout. */
    await page.waitForFunction(
      () => /Review your paystub|Couldn't read that paystub/.test(document.body.innerText),
      null, { timeout: 25000 }).catch(() => {});
    const sheet = await page.evaluate(() => document.body.innerText.replace(/\u00a0/g, ' '));
    ok('import: a real PDF reaches the review sheet instead of "couldn\'t read that paystub"',
      /Review your paystub/.test(sheet) && !/Couldn't read that paystub/.test(sheet),
      (sheet.match(/Review your paystub|Couldn't read that paystub/) || ['<neither>'])[0]);
    ok('import: the differential row is listed, which the shipped build finds nothing of',
      /3rd Shift Differential/.test(sheet), (sheet.match(/DETECTED[\s\S]{0,140}/) || ['<no rows>'])[0]);
    ok('import: and previews it as +$7.00/hr of night pay, not minus sixty-three dollars',
      /Night\s*·\s*\+\$7\.00\/hr/.test(sheet) && !/-\$/.test(sheet),
      (sheet.match(/3rd Shift Differential[\s\S]{0,80}/) || ['<missing>'])[0]);
    ok('import: a staffing incentive is shown as ignored, not written in as a rate',
      /SI2[\s\S]{0,120}?Not a differential/.test(sheet),
      (sheet.match(/SI2[\s\S]{0,90}/) || ['<missing>'])[0]);
    const fields = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.modal')].find((x) => /Review your paystub/.test(x.textContent));
      if (!m) return { nums: [], date: '<no review modal>' };
      return { nums: [...m.querySelectorAll('input[type=number]')].map((i) => i.value),
        date: (m.querySelector('input[type=date]') || {}).value };
    });
    /* Read the field, not the page: $70.81 also appears in the Regular row, so a text match
       passes even when the base rate was never extracted. */
    ok('import: base pay is read off the stub, though the label is in another column',
      fields.nums[0] === '70.81', `base field "${fields.nums[0]}"`);
    ok('import: the pay period start comes across', fields.date === '2025-08-11', fields.date || '<none>');
    /* 122.49 + 150.37 + 2.00 over a $4,007.93 gross is 6.86%: state withholding, the city tax
       and the local services tax, all three. Caveat worth writing down rather than implying:
       her stub labels that last one "PA  LS Tax" with two spaces and the shipped regex wanted
       one, which is fixed here — but the double space does not survive this PDF builder, so
       this case cannot tell the two apart. It pins the sum, not the label. */
    ok('import: state, city and local services tax all reach the state rate',
      fields.nums[3] === '6.86', `state rate ${fields.nums[3]}`);
    ok('import: no page errors driving the whole path',
      errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();
  }

  /* ---- 11. council 2026-09-13, bucket 1 --------------------------------------------------
     Each block below pins one fix from docs/council-runs/2026-09-13/synthesis.md (bucket 1: nightly-
     safe, no Invariant-3 function, no displayed-dollar change). Every assertion was negative-tested
     against a copy with the fix reverted -- see docs/history.md for the run. */
  if (want(11)) {
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

  /* ---- 12. session_end: the exit row, and the funnel stage that never fired -------------
     The gap this closes: every other event says something HAPPENED; none said what happened
     last, or how long she stayed. On 2026-09-16, 416 of 424 public devices had a lifetime
     trail of exactly one app_open — one step, no ending — so "where did she give up?" had no
     answer in the data at all. These assertions are about the row existing, carrying the join
     key, and carrying nothing it must not. */
  if (want(12)) {
    const { ctx, page, errors } = await newPage(browser, url);
    const posted = [];
    await page.route('**/rest/v1/events*', async (route) => {
      try { posted.push(JSON.parse(route.request().postData() || 'null')); } catch (_) { posted.push(null); }
      await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });

    /* pagehide is the real unload signal on iOS WebKit, and it is the listener the app binds. */
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(400);

    const flat = posted.flatMap((p) => (Array.isArray(p) ? p : [p])).filter(Boolean);
    const end = flat.find((r) => r && r.name === 'session_end');
    ok('session_end: an exit row is written when the tab goes away', !!end,
      end ? '' : `saw: ${flat.map((r) => r && r.name).join(',') || 'nothing'}`);

    const devId = await page.evaluate(() => localStorage.getItem('scrubpay_anon_id'));
    ok('session_end: the exit row carries this device\'s anon_id', !!end && end.anon_id === devId,
      devId ? `${String(devId).slice(0, 8)}…` : 'no device id');

    /* The shape is the contract the ops trail reads. A missing `last` turns every abandonment
       back into "somewhere after app_open", which is the hole this whole change exists to fill. */
    ok('session_end: it says how long and what happened last',
      !!end && typeof end.props === 'object' && typeof end.props.secs === 'number' && typeof end.props.last === 'string',
      end ? JSON.stringify(end.props) : '');

    /* Invariant: `events` carries coarse names and counts, never a wage or goal figure.
       `shifts` is a COUNT and must stay one. */
    const allowed = ['secs', 'last', 'n', 'setup', 'shifts', 'ob', 'via'];
    const extra = end ? Object.keys(end.props || {}).filter((k) => !allowed.includes(k)) : ['(no row)'];
    ok('session_end: no prop outside the declared, money-free whitelist', extra.length === 0, extra.join(','));
    /* Scoped to props, which is what this change introduces. `user_agent` is a long-standing
       column and carries version numbers like AppleWebKit/605.1.15 that look money-shaped to any
       honest regex — widening this to the whole row tests the wrong thing and fails on a string
       nobody chose. */
    ok('session_end: its props contain no money-shaped figure',
      !!end && !/\$\s?\d|\d+\.\d{2}\b/.test(JSON.stringify(end.props || {})), end ? JSON.stringify(end.props) : '(no row)');

    /* An app-switching phone must not bill the free tier one row per switch. */
    const before = flat.filter((r) => r && r.name === 'session_end').length;
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.waitForTimeout(300);
    const after = posted.flatMap((p) => (Array.isArray(p) ? p : [p])).filter(Boolean)
      .filter((r) => r && r.name === 'session_end').length;
    ok('session_end: a second hide with nothing new does not write a duplicate', after === before,
      `${before} -> ${after}`);

    ok('session_end: no page error across the unload path', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();
  }

  /* ---- 13. ob_step 0, and the harness's own containment ---------------------------------- */
  if (want(13)) {
    /* Stage 0 — "saw the welcome screen, left" — was unreachable twice over: obMax started at 0
       so `n > obMax` rejected step 0, and nothing calls goObStep(0) on arrival anyway. Every
       ob_step row ever recorded starts at 1, which is why the welcome-screen bounce was
       indistinguishable from a rate-input bounce in the funnel. */
    const { ctx, page } = await newPage(browser, url, { seed: false });
    const steps = [];
    await page.route('**/rest/v1/events*', async (route) => {
      try {
        const body = JSON.parse(route.request().postData() || 'null');
        (Array.isArray(body) ? body : [body]).forEach((r) => { if (r && r.name === 'ob_step') steps.push(r.props && r.props.step); });
      } catch (_) {}
      await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    /* The app also tracks through supabase-js, which the harness cannot reach; this assertion
       reads the intercepted wire either way, so it fails loudly if the event stops firing. */
    const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
    ok('ob_step: the welcome stage is reachable at all (obMax starts below 0)',
      /const obMax = useRef\(-1\);/.test(src));
    ok('ob_step: something marks stage 0 when onboarding becomes visible',
      /if\(ready && !setupComplete\) markObStep\(0\);/.test(src));
    ok('ob_step: stage 0 actually fires for a fresh visitor', steps.includes(0),
      `saw steps: ${steps.join(',') || 'none'}`);
    await ctx.close();

    /* The harness was the app's largest "user" by two orders of magnitude: buildScratch rewrote
       the five CDN tags but not the Supabase URL, so every CI run wrote real rows into
       production `events`. This asserts the scratch copy cannot reach the project at all. */
    const scratchApp = readFileSync(join(SCRATCH, 'index.html'), 'utf8');
    const scratchOps = readFileSync(join(SCRATCH, 'ops.html'), 'utf8');
    ok('harness: the scratch app cannot reach the production Supabase project',
      !scratchApp.includes('mnnlgcxnvodjwlhhiphq.supabase.co'));
    ok('harness: the scratch ops console cannot reach it either',
      !scratchOps.includes('mnnlgcxnvodjwlhhiphq.supabase.co'));
    ok('harness: index.html itself is untouched (the rewrite is scratch-only)',
      src.includes('mnnlgcxnvodjwlhhiphq.supabase.co'));

    /* Migration 006 flags the rows the harness already wrote so they stay out of the console.
       Its predicate is a guess about a string the SQL cannot see, and the first draft guessed a
       WebKit build number that appears in ZERO rows — a flag that silently classified nothing and
       looked exactly like a flag that worked. Tie it to the real thing: the user agent this
       harness's own pinned Playwright actually emits for the iPhone 13 profile. If a Playwright
       bump changes it, this fails here rather than quietly un-flagging 251 devices. */
    const harnessUA = devices['iPhone 13'].userAgent;
    const mig = readFileSync(join(ROOT, 'supabase/migrations/006_ops_device_trail.sql'), 'utf8');
    const likes = [...mig.matchAll(/e\.user_agent like '%([^']+)%'/g)].map((m) => m[1].replace(/\\_/g, '_'));
    ok('synthetic: migration 006 has a predicate to check at all', likes.length > 0, likes.join(' + '));
    ok('synthetic: every LIKE in it matches the harness user agent this suite really sends',
      likes.length > 0 && likes.every((l) => harnessUA.includes(l)),
      `${JSON.stringify(harnessUA)} vs ${JSON.stringify(likes)}`);
    /* And the other half: it must not match a genuine iPhone. iOS 15.0 paired with Safari 18 is
       the impossible combination; either half alone is on real devices in the table. */
    const realUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';
    ok('synthetic: it does not match a real iPhone user agent from the events table',
      !likes.every((l) => realUA.includes(l)));
  }

  /* ---- 14. the feedback row links to that device's trail (migration 007) ----------------
     005 put anon_id on `feedback`, 006 built the trail, and the inbox sat between them without
     the join key — the console could show what a nurse SAID and, separately, what some device
     DID, with no way across. This drives the real render logic against a stubbed client: the
     signed-out gate (§7) means the page never reaches row() otherwise, and an assertion that
     can never fire is not an assertion. The stub lives in a THIRD scratch copy; ops.html in the
     working tree is never touched. */
  if (want(14)) {
    const opsSrc = readFileSync(join(SCRATCH, 'ops.html'), 'utf8');
    const CREATE = /var supabase = \(window\.supabase && window\.supabase\.createClient\)[\s\S]*?: null;/;
    if (!CREATE.test(opsSrc)) throw new Error('ops.html client construction moved — the §14 stub is stale');

    const ROWS = [
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', created_at: new Date().toISOString(), kind: 'broken',
        message: 'nothing to click', contact: null, signed_in: false, segment: 'public',
        device: 'iPhone', anon_id: 'dev-with-a-trail' },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', created_at: new Date().toISOString(), kind: null,
        message: 'an older report', contact: null, signed_in: true, segment: 'public',
        device: 'iPhone', anon_id: null },
    ];
    const TRAIL = [
      { session_no: 1, created_at: '2026-09-15T10:00:00Z', name: 'app_open', props: null, signed_in: false },
      { session_no: 1, created_at: '2026-09-15T10:00:20Z', name: 'session_end',
        props: { secs: 20, last: 'app_open', n: 1, setup: false, shifts: 0, ob: 0 }, signed_in: false },
      { session_no: 2, created_at: '2026-09-16T09:00:00Z', name: 'app_open', props: null, signed_in: false },
    ];
    const stub = opsSrc.replace(CREATE, `var supabase = {
      auth: { getSession: function () { return Promise.resolve({ data: { session: { user: { id: 'x' } } } }); } },
      rpc: function (name, args) {
        if (name === 'ops_feedback_summary') return Promise.resolve({ data: { total: 2, last_7d: 2, last_24h: 1 } });
        if (name === 'ops_feedback_inbox') return Promise.resolve({ data: ${JSON.stringify(ROWS)} });
        if (name === 'ops_device') return Promise.resolve({ data: ${JSON.stringify(TRAIL)}, args: args });
        if (name === 'ops_device_list') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
      }
    };`);
    writeFileSync(join(SCRATCH, 'ops-stub.html'), stub);

    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url + '/ops-stub.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.row', { timeout: 15000 });

    ok('inbox: a report with a device id offers the trail link',
      (await page.locator('.row .trace button').count()) === 1,
      `${await page.locator('.row .trace button').count()} buttons for 2 rows`);
    const none = await page.locator('.row .trace .none').first().innerText();
    ok('inbox: a pre-2026-09-14 report says why it has no link, rather than showing a dead one',
      /before the join key shipped/i.test(none), JSON.stringify(none));

    await page.locator('.row .trace button').first().click();
    await page.waitForSelector('.sess', { timeout: 15000 });
    ok('trail: tapping through renders the visits for that device',
      (await page.locator('.sess').count()) === 2, `${await page.locator('.sess').count()} visits`);
    /* The header must not print "undefined visits": an inbox row carries thinner metadata than a
       Devices card, and this is the exact seam where that shows up. */
    const head = await page.locator('.note').first().innerText();
    ok('trail: the header prints only what the inbox row actually knows',
      !/undefined|NaN/.test(head), JSON.stringify(head));
    ok('trail: session_end renders with its exit props', /secs=20/.test(await page.locator('.sess').first().innerText()));

    /* Back must return to where you came from, not always to Devices. Wait for ANY destination to
       paint, not for `.row` specifically: a hard waitForSelector on the right answer turns a wrong
       destination into a thrown timeout that kills the run, and an aborted run is not a failed
       assertion — it just stops printing. Confirmed by negative test: with back wired to Devices,
       this reports FAIL instead of taking the rest of the section down with it. */
    await page.locator('.bar button').first().click();
    await page.waitForFunction(
      () => !!document.querySelector('.row, .dev, .empty'), null, { timeout: 15000 }
    ).catch(() => {});
    const backRows = await page.locator('.row').count();
    ok('trail: back from a feedback-sourced trail returns to the inbox', backRows === 2,
      `${backRows} feedback rows after back`);

    ok('ops: the trail path raises no page error', errors.length === 0, errors[0] || '');
    await ctx.close();
  }

  /* ---- 15. wage-core, council 2026-09-13 bucket 3 ------------------------------------
     Every assertion here pins a figure a nurse reads as money. Each was negative-tested by
     reverting its fix and confirming this section reports FAIL. The pure-function probes run
     through page.evaluate against the real top-level declarations, same as the §1 wage block. */
  if (want(15)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#root > *', { timeout: 20000 });

    const wc = await page.evaluate(() => {
      const t = { ficaType: 'standard', federalTaxRate: 12, stateTaxRate: 5,
        pretaxDeductions: 0, posttaxDeductions: 0, customWithholdings: [] };
      const diffs = { base: { amount: 0, type: 'dollar', active: true },
        night: { amount: 10, type: 'dollar', active: true },
        'weekend-day': { amount: 11.5, type: 'dollar', active: true } };
      const nightOff = { ...diffs, night: { ...diffs.night, active: false } };
      return {
        // #1 -- the Add-Shift draft seeds from what is actually switched on.
        seedDefault: firstActiveShiftType(diffs),
        seedNightOff: firstActiveShiftType(nightOff),
        seedAllOff: firstActiveShiftType({ base: { amount: 0, type: 'dollar', active: false } }),
        // #1 -- and `active:false` still PAYS a shift already tagged with it: the toggle is a
        // picker filter, never a retroactive re-pricing of her logged history.
        inactiveStillPaid: shiftGross(50, nightOff.night, { hours: 12, bonusType: 'none' }),
        // #3 -- a blanked multiplier is a coefficient: 1, not 0.
        multBlank: sanitizeData({ differentials: { holiday: { amount: '', type: 'multiplier' } } })
          .differentials.holiday.amount,
        multZero: sanitizeData({ differentials: { holiday: { amount: 0, type: 'multiplier' } } })
          .differentials.holiday.amount,
        multGood: sanitizeData({ differentials: { holiday: { amount: 1.5, type: 'multiplier' } } })
          .differentials.holiday.amount,
        dollarBlank: sanitizeData({ differentials: { night: { amount: '', type: 'dollar' } } })
          .differentials.night.amount,
        // #4 -- an unknown ficaWithholdingType must not reach computeNet and zero FICA.
        ficaJunk: sanitizeData({ ficaWithholdingType: 'nonsense' }).ficaWithholdingType,
        ficaStd: sanitizeData({ ficaWithholdingType: 'standard' }).ficaWithholdingType,
        ficaPct: sanitizeData({ ficaWithholdingType: 'percent' }).ficaWithholdingType,
        // group-7 leftover -- a template-brushed cell carries its OT flag into the priced shift.
        otCell: patternCellToShift({ kind: 'fixed', shiftType: 'night', hours: 12, isOvertime: true },
          new Date(2026, 0, 5), diffs),
        plainCell: patternCellToShift({ kind: 'fixed', shiftType: 'night', hours: 12 },
          new Date(2026, 0, 5), diffs),
        otSurvivesSave: (sanitizeData({ patterns: [{ id: 1, name: 'ot', anchor: '2026-01-05',
          cells: [{ kind: 'fixed', shiftType: 'night', hours: 12, isOvertime: true },
            null, null, null, null, null, null] }] })
          .patterns[0].cells[0] || {}).isOvertime,
        // #2 -- the chip must equal what the two figures beside it imply, even when the
        // uncapped `ded` runs past gross (a paystub scan sets pretax on an empty period).
        capped: computeNet(0, { ...t, pretaxDeductions: 260 }),
      };
    });

    ok('wage-core #1: the seed helper prefers Night while Night is on', wc.seedDefault === 'night', wc.seedDefault);
    ok('wage-core #1: with nothing active it falls back to base, never undefined',
      wc.seedAllOff === 'base', String(wc.seedAllOff));
    ok('wage-core #1: an inactive differential still PAYS a shift already tagged with it',
      wc.inactiveStillPaid === 720, `expected 720 (60*12), got ${wc.inactiveStillPaid}`);
    ok('wage-core #3: a blanked multiplier coerces to 1x, not 0x', wc.multBlank === 1, String(wc.multBlank));
    ok('wage-core #3: an explicit 0x multiplier is repaired too', wc.multZero === 1, String(wc.multZero));
    ok('wage-core #3: a valid multiplier is untouched', wc.multGood === 1.5, String(wc.multGood));
    ok('wage-core #3: a blanked DOLLAR differential still means $0', wc.dollarBlank === 0, String(wc.dollarBlank));
    ok('wage-core #4: an unknown ficaWithholdingType is dropped, not passed through',
      wc.ficaJunk === undefined, String(wc.ficaJunk));
    ok('wage-core #4: both legal FICA types survive the allowlist',
      wc.ficaStd === 'standard' && wc.ficaPct === 'percent', `${wc.ficaStd}/${wc.ficaPct}`);
    ok('wage-core group-7: a template cell carries its OT flag into the priced shift',
      wc.otCell.isOvertime === true, JSON.stringify(wc.otCell));
    ok('wage-core group-7: a cell without the flag is still not OT',
      wc.plainCell.isOvertime === false, JSON.stringify(wc.plainCell));
    ok('wage-core group-7: the OT flag survives a save/reload of the pattern',
      wc.otSurvivesSave === true, String(wc.otSurvivesSave));
    ok('wage-core #2: gross-minus-net is what the chip can safely print',
      Math.max(0, Math.round(wc.capped.gross) - Math.round(wc.capped.net)) === 0 && wc.capped.ded > 0,
      `gross=${wc.capped.gross} net=${wc.capped.net} ded=${wc.capped.ded}`);

    /* #8 -- keepRatio drives the Add-Shift preview, the calendar day cells and the goal line.
       Pinned at the source: a percent custom withholding has to be in the denominator, or those
       surfaces over-promise against the hero. */
    const src15 = readFileSync(join(SCRATCH, 'index.html'), 'utf8');
    ok('wage-core #8: keepRatio folds in percent custom withholdings',
      /const keepRatio = Math\.max\(0, 1 - \(federalTaxRate\+stateTaxRate\+ficaForPreview\+pctWithholdings\)\/100\)/.test(src15));
    ok('wage-core #8: it sums only the percent-typed ones (a flat $ is not a rate)',
      /w && w\.type==='percent' \? \(parseFloat\(w\.amount\)\|\|0\) : 0/.test(src15));
    /* #6 -- one tax model. sampleNet must call computeNet rather than rebuild it. */
    ok('wage-core #6: sampleNet prices through computeNet', /const r = computeNet\(g, taxInputs\);/.test(src15));
    ok('wage-core #6: the welcome figure is derived, not a literal',
      !/\$3,951/.test(src15) && /\{fmt\(obSample\.net\)\}/.test(src15));

    ok('wage-core: no page errors across the section', errors.length === 0, errors[0] || '');
    await ctx.close();

    /* #1 END TO END -- the assertion that actually matters. Probing firstActiveShiftType() alone
       passes even with the old hard-coded useState('night') still in place (confirmed: that
       revert was MISSED until this drive existed). So switch Night OFF in the seeded blob, open
       the real Add-Shift sheet, and read what the preview prices. Bug: 12h x ($50+$10) = $720
       with no chip lit. Fixed: 12h x $50 = $600, and the lit chip matches. */
    const nightOffState = { setupComplete: true, baseRate: 50,
      differentials: { base: { name: 'Day (regular)', amount: 0, type: 'dollar', active: true, color: '#8A93A6' },
        night: { name: 'Night', amount: 10, type: 'dollar', active: false, color: '#5B4FE9' } } };
    const off = await newPage(browser, url, { seed: nightOffState });
    await off.page.goto(url, { waitUntil: 'domcontentloaded' });
    await off.page.waitForSelector('.fab', { timeout: 20000 });
    await off.page.locator('.fab').click();
    await off.page.waitForSelector('.sheet .preview', { timeout: 5000 });
    const priced = await off.page.locator('.sheet .preview .v').innerText();
    const litChips = await off.page.evaluate(() =>
      [...document.querySelectorAll('.sheet .chip-sel')].map((c) => ({ t: c.textContent.trim(), on: c.className.includes('on') })));
    const lit = litChips.filter((c) => c.on);
    ok('wage-core #1: with Night switched off the preview prices at base, not the Night rate',
      /\+\$600 gross/.test(priced), `${priced} | chips=${JSON.stringify(litChips)}`);
    ok('wage-core #1: and exactly one chip is lit, matching what is priced',
      lit.length === 1 && !/Night/.test(lit[0].t), JSON.stringify(litChips));
    ok('wage-core #1: no page error driving the Night-off sheet', off.errors.length === 0, off.errors[0] || '');
    await off.ctx.close();

    /* The welcome screen is the first money figure anyone ever sees -- drive it for real.
       Needs its own UNSEEDED context: newPage's addInitScript re-seeds STORAGE_KEY on every
       navigation, so a localStorage.clear() + reload lands back on the planner, not step 0. */
    const fresh = await newPage(browser, url, { seed: false });
    await fresh.page.goto(url, { waitUntil: 'domcontentloaded' });
    await fresh.page.waitForSelector('.ob .hero .num', { timeout: 20000 });
    const welcome = await fresh.page.locator('.ob .hero .num').innerText();
    const welcomeHrs = await fresh.page.locator('.ob .hero .lbl').innerText();
    ok('wage-core #6: the welcome screen renders a real derived figure',
      /^\$[\d,]+$/.test(welcome) && welcome !== '$3,951', welcome);
    ok('wage-core #6: its hours line is derived from the same sample', /72 hrs/.test(welcomeHrs), welcomeHrs);
    ok('wage-core #6: no page error on the welcome screen', fresh.errors.length === 0, fresh.errors[0] || '');
    await fresh.ctx.close();
  }

  /* ---- 16. the saved-pattern card tells the truth about a multi-paycheck average ---------
     patternMetrics() prices a rotation over lcm(cycle,14) days, so for any cycle that does not
     divide a fortnight the "take-home / paycheck" figure is an AVERAGE and real checks alternate
     around it. The comparison table and the edit-mode readout already say so; the YOUR PATTERNS
     card printed the same figure flat -- and that card is the one place a nurse reads it before
     she has a second pattern to compare, because the table needs two. Label only: avgNote() is
     the same helper the other two sites call, and no arithmetic moved.
     Negative-tested three ways -- reverting the card to the bare figure (A1/A2 FAIL), deleting
     the footnote (A3 FAIL), and making the qualifier unconditional (B1/B2 FAIL). Each case seeds
     exactly ONE pattern on purpose: the side-by-side table renders only at allMetrics.length>=2
     and carries a footnote of its own, so with two seeded the hint count could not tell the two
     sites apart and a "footnote present" assertion would pass with this fix reverted. */
  if (want(16)) {
    const night = () => ({ kind: 'night', hours: 12, start: '19:00' });
    /* 4 on / 4 off: lcm(8,14) = 56 days = 4 paychecks, so this one MUST be qualified. */
    const cells8 = [night(), night(), night(), night(), null, null, null, null];
    /* Three 12s a week on a 14-day cycle: a fortnight divides a fortnight, so it must NOT be. */
    const cells14 = [night(), null, night(), null, night(), null, null,
                     night(), null, night(), null, night(), null, null];
    const patSeed = (name, cells) => ({
      setupComplete: true, baseRate: 50, payPeriodStart: '2026-09-07',
      federalTaxRate: 12, stateTaxRate: 5, ficaType: 'percent', ficaWithholdingPercent: 7.65,
      pretaxDeductions: 0, posttaxDeductions: 0,
      differentials: { night: { name: 'Night', amount: 5, type: 'dollar', active: true } },
      patterns: [{ id: 'p1', name, anchor: '2026-09-07', cells }],
    });

    const readCard = async (seed, name) => {
      const { ctx, page, errors } = await newPage(browser, url, { seed });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.wrap .whatif', { timeout: 20000 });
      await page.locator('.whatif:has-text("Pattern lab") button:text-is("Open")').click();
      const opened = await page.waitForSelector('.modal[aria-label="Pattern lab"]', { timeout: 8000 })
        .then(() => true).catch(() => false);
      /* Read the DOM by pattern NAME rather than with a text locator: the preset rotations use
         .pl-card too, so a bare :has-text() would match one of those and an assertion written
         that way could still pass with the saved card missing entirely. Every field is optional-
         chained and reported -- a card that vanished must report FAIL, not throw and abort the
         section, which is the failure mode the `harness` skill warns about. */
      const got = opened ? await page.evaluate((n) => {
        const lab = document.querySelector('.modal[aria-label="Pattern lab"]');
        const card = [...lab.querySelectorAll('.pl-card')]
          .find((c) => c.querySelector('.t')?.textContent.trim() === n);
        return {
          found: !!card,
          money: card?.querySelector('.s')?.textContent.trim() || '',
          avgTitle: card?.querySelector('.avg')?.getAttribute('title') || '',
          notes: [...lab.querySelectorAll('.hint')]
            .filter((h) => /^avg\./.test(h.textContent.trim())).length,
        };
      }, name) : { found: false, money: '', avgTitle: '', notes: 0 };
      const clean = errors.filter((e) => !isExpectedNetwork(e));
      await ctx.close();
      return { opened, ...got, clean };
    };

    const a = await readCard(patSeed('Four on four off', cells8), 'Four on four off');
    ok('pattern card: the saved 8-day pattern renders on the lab list', a.opened && a.found,
      JSON.stringify({ opened: a.opened, money: a.money }));
    ok('pattern card: an 8-day cycle no longer prints its average unqualified',
      / avg\./.test(a.money) && /\/ paycheck/.test(a.money), a.money);
    ok('pattern card: the qualifier says how many paychecks it averaged',
      /avg\. over 4 paychecks/.test(a.avgTitle), a.avgTitle);
    ok('pattern card: a footnote explains "avg." where there is no hover to reveal it',
      a.notes === 1, `${a.notes} footnotes`);
    ok('pattern card: no page errors driving the lab list', a.clean.length === 0, a.clean[0] || '');

    const b = await readCard(patSeed('Three twelves', cells14), 'Three twelves');
    ok('pattern card: the saved 14-day pattern renders on the lab list', b.opened && b.found,
      JSON.stringify({ opened: b.opened, money: b.money }));
    ok('pattern card: a 14-day cycle is NOT qualified -- its check is the figure shown',
      b.found && !/avg\./.test(b.money) && /\/ paycheck/.test(b.money), b.money);
    ok('pattern card: and it gets no footnote', b.notes === 0, `${b.notes} footnotes`);
  }

  /* ---- 17. council 2026-09-18 re-check: the six fixes nothing pinned -----------------------
     The re-check (docs/council-runs/2026-09-13/recheck.json) traced all 22 synthesis entries to
     the current source and then asked the harder question: would a revert FAIL? For six of them
     the answer was no -- the code landed, the assertion never existed, and CI only ever proves
     the assertions that exist. Those six are pinned here: #9 quick-fill dropping the template's
     OT flag, #10 the pattern-lab goal line's $0 filter, #32 SwapsSheet's Escape, and the three
     #34 a11y lines (year-nav labels, the done-step name field, the apply-preview live region --
     the existing live-region check reads `.sheet .preview`, and the lab is a `.modal`).

     Each block drives the real surface. Two notes on how, because both were nearly got wrong:
     - #32 was filed "needs live auth", but `useEscape(onClose)` sits above SwapsSheet's `if(!user)`
       early return, so it runs identically for a signed-out visitor. Deleting that line fails the
       signed-out drive too -- no session to stub, and the assertion is no weaker for it.
     - #10 cannot be reached by seeding a $0 goal: `sanitizeData` drops `target<=0` on load, so the
       only way to hold one is to zero an existing goal in Settings, which is exactly the path a
       nurse takes. The drive does that.
     Every assertion negative-tested -- see the Done log for the six breaks and what each failed. */
  if (want(17)) {
    /* -- #9: quick-fill carries the template's overtime flag ------------------------------
       Nothing in this suite drove quick-fill at all, so `isOvertime:qfTemplate.isOvertime===true`
       (index.html, toggleQuickFillDay) could go back to being dropped silently. Assert on the day
       cell's own accessible name rather than on localStorage: that is where a nurse learns the
       shift is OT, and it does not depend on when the save debounce happens to fire. */
    {
      const seed = {
        setupComplete: true, baseRate: 50,
        differentials: { night: { name: 'Night', amount: 5, type: 'dollar', active: true } },
        templates: [{ id: 't-ot', name: 'OT night', shiftType: 'night', hours: 12, bonusType: 'none', isOvertime: true }],
      };
      const { ctx, page, errors } = await newPage(browser, url, { seed });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.cell[data-date]', { timeout: 20000 });
      await page.locator('button:has-text("Quick fill")').first().click();
      const chip = page.locator('.qf-chips .chip-sel:has-text("OT night")');
      const picked = await chip.waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      ok('council: quick-fill offers the saved template as a brush', picked);
      if (picked) await chip.click();
      const day = await page.locator('.cell[data-date]').first().getAttribute('data-date');
      await page.locator(`.cell[data-date="${day}"]`).click();
      const cell = page.locator(`.cell[data-date="${day}"]`);
      await page.waitForTimeout(500);
      const label = await cell.getAttribute('aria-label');
      const badge = (await cell.locator('.d').innerText()).replace(/\s+/g, '');
      ok('council: a quick-filled day really gets the shift', / 1 shift/.test(label || ''), label || '');
      ok("council: quick-fill carries the template's overtime flag to the day it fills",
        /includes overtime/.test(label || '') && /OT$/.test(badge), `${label} | badge=${badge}`);
      ok('council: no page errors driving quick-fill', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* -- #34 year nav, #10 goal line, #34 apply preview: one drive, one saved pattern ------ */
    {
      const night = () => ({ kind: 'night', hours: 12, start: '19:00' });
      const seed = {
        setupComplete: true, baseRate: 50, payPeriodStart: '2026-09-07',
        federalTaxRate: 12, stateTaxRate: 5, ficaType: 'percent', ficaWithholdingPercent: 7.65,
        pretaxDeductions: 0, posttaxDeductions: 0,
        differentials: { night: { name: 'Night', amount: 5, type: 'dollar', active: true } },
        goals: [{ id: 'g-keep', name: 'Vacation', target: 3000 }, { id: 'g-zero', name: 'New car', target: 1200 }],
        patterns: [{ id: 'p1', name: 'Four on four off', anchor: '2026-09-07',
          cells: [night(), night(), night(), night(), null, null, null, null] }],
      };
      const { ctx, page, errors } = await newPage(browser, url, { seed });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });

      /* #34a: the year-view arrows are bare chevrons -- without the labels a screen reader
         announces "button" twice and the only way to tell them apart is which side they are on. */
      await page.locator('.viewseg button:text-is("Year")').click();
      await page.waitForSelector('.calnav', { timeout: 6000 });
      const yearNav = await page.evaluate(() => [...document.querySelectorAll('.calnav button')]
        .map((b) => b.getAttribute('aria-label')));
      ok('council: the year-view arrows name the year they move to',
        yearNav.includes('Previous year') && yearNav.includes('Next year'), JSON.stringify(yearNav));
      await page.locator('.viewseg button:text-is("Month")').click();

      /* #10: zero a goal the way Settings allows (updGoalTarget floors at 0, it does not delete),
         then read the lab's goal line. Without the target>0 filter the zeroed goal reads
         "New car: 1 paycheck" -- Math.max(1, Math.ceil(0/net)) -- a promise of a goal already met. */
      await page.locator('.avatar').click();
      await page.locator('button[role="menuitem"]:has-text("Settings")').click();
      const target = page.locator('input[aria-label="New car target amount"]');
      await target.waitFor({ timeout: 8000 });
      await target.fill('0');
      await target.press('Enter');
      await page.waitForTimeout(300);
      await page.locator('.sheet-h button.back').first().click();
      await page.waitForSelector('.hero', { timeout: 8000 });

      await page.locator('.whatif:has-text("Pattern lab") button:text-is("Open")').click();
      await page.waitForSelector('.modal[aria-label="Pattern lab"]', { timeout: 8000 });
      await page.locator('.pl-card-main:has-text("Four on four off")').click();
      await page.waitForSelector('.modal[aria-label="Edit pattern"]', { timeout: 8000 });
      const money = (await page.locator('.modal .pl-money').innerText()).replace(/\s+/g, ' ');
      ok('council: the pattern-lab goal line still names a funded goal',
        /If every paycheck went to it/.test(money) && /Vacation/.test(money), money);
      ok('council: a goal zeroed out in Settings is not promised in N paychecks',
        !/New car/.test(money), money);

      /* #34b: the apply-plan preview is the only live region scoped to .modal, which is why the
         .sheet-scoped check in section 11 passed with it reverted. */
      await page.locator('.modal button:text-is("Put it on the calendar")').click();
      await page.waitForSelector('.modal .pl-apply', { timeout: 6000 });
      const live = await page.evaluate(() => {
        const p = document.querySelector('.modal .pl-apply .preview');
        return p ? { live: p.getAttribute('aria-live'), atomic: p.getAttribute('aria-atomic'),
          txt: p.textContent.trim().slice(0, 20) } : null;
      });
      ok('council: the apply-plan preview announces the plan it just recomputed',
        !!live && live.live === 'polite' && live.atomic === 'true', JSON.stringify(live));
      ok('council: no page errors across the year-nav / goal-line / apply drive',
        errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* -- #34c: the done step's name field ---------------------------------------------------
       Reached only by the long onboarding road (welcome -> rate -> differentials -> taxes); the
       short road finishes at rough and never renders this screen, which is why no drive had ever
       landed on it. The input has a placeholder and no visible <label>, so the aria-label is the
       only accessible name it has. */
    {
      const { ctx, page, errors } = await newPage(browser, url, { seed: false });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#root > *', { timeout: 20000 });
      await page.getByRole('button', { name: /get my estimate/i }).click();
      await page.getByRole('button', { name: /add my differentials/i }).click();
      await page.getByRole('button', { name: /^continue$/i }).click();
      await page.getByRole('button', { name: /see my estimate/i }).click();
      const onDone = await page.waitForSelector('h1:has-text("all set")', { timeout: 8000 })
        .then(() => true).catch(() => false);
      ok('council: the long onboarding road still ends on the done step', onDone);
      const named = await page.locator('input[aria-label="Your name"]').count();
      ok('council: the done step\'s name field has an accessible name, not just a placeholder',
        named === 1, `${named} labelled inputs`);
      ok('council: no page errors walking the long onboarding road',
        errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* -- #32: Escape closes the swap sheet -------------------------------------------------- */
    {
      const { ctx, page, errors } = await newPage(browser, url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });
      await page.locator('button:text-is("Open swap board")').click();
      const opened = await page.waitForSelector('.sheet[aria-label="Shift swaps"]', { timeout: 8000 })
        .then(() => true).catch(() => false);
      ok('council: the Settings swap-board route still opens the sheet', opened);
      await page.keyboard.press('Escape');
      const closed = await page.waitForSelector('.sheet[aria-label="Shift swaps"]',
        { state: 'detached', timeout: 5000 }).then(() => true).catch(() => false);
      ok('council: Escape closes the swap sheet', closed);
      ok('council: no page errors opening and dismissing the swap sheet',
        errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }
  }

  /* == 18. The public copy: what a crawler, a search result and a JS-disabled human see =========
     This is the most public text the product has and the least driven. Two things were wrong.
     (a) The <meta name="description"> and the <noscript> fallback both ended on "runs an anonymous
         shift-swap board" - the one promise the 2026-09-19 positioning decision says to stop
         making (growth copy leads with sync + paycheck, never swapping) and the one word
         CLAUDE.md records as untrue until the security-00 hardening session lands. The in-app
         de-emphasis work never reached the <head>, because the head carries no CTA.
     (b) The fallback was unreachable to a human anyway: #splash is fixed, opaque and z-index 9999,
         so with scripting off it covered the fallback with a spinner that can never stop. A
         crawler reading the DOM saw the text; a brand-verification reviewer looking at the page
         saw a spinner - and "your home page is behind a login page" is exactly what Google filed.
     Driven with javaScriptEnabled:false, which is the real condition, not a grep of the source. */
  if (want(18)) {
    /* -- the no-JS fallback, as a human with scripting off actually sees it ------------------ */
    {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const splashShown = await page.locator('#splash').isVisible().catch(() => false);
      ok('public copy: the splash is hidden when scripting is off, so the fallback is reachable',
        splashShown === false);

      const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      ok('public copy: a JS-disabled visitor gets real content, not an empty shell',
        body.length > 200, `${body.length} chars of visible text`);
      ok('public copy: the fallback leads with the paycheck promise',
        /take-home pay/i.test(body), body.slice(0, 80));
      ok('public copy: the fallback names calendar sync, the substitution half of the positioning',
        /syncs your nursing schedule/i.test(body));
      ok('public copy: the fallback makes no swap-board claim (positioning 2026-09-19)',
        !/swap/i.test(body), (body.match(/.{0,30}swap.{0,30}/i) || [''])[0]);
      ok('public copy: the fallback does not call the board anonymous (untrue until security-00)',
        !/anonymous/i.test(body), (body.match(/.{0,30}anonymous.{0,30}/i) || [''])[0]);

      const href = await page.locator('noscript a').first().getAttribute('href').catch(() => null);
      ok('public copy: the fallback still offers a reachable privacy notice',
        href === '/privacy.html', String(href));
      await ctx.close();
    }

    /* -- the search snippet, read off the live DOM ------------------------------------------- */
    {
      const { ctx, page, errors } = await newPage(browser, url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });

      const desc = await page.locator('meta[name="description"]').getAttribute('content');
      ok('public copy: the search snippet leads with take-home pay', /take-home pay/i.test(desc || ''), desc || '');
      ok('public copy: the search snippet makes no swap-board claim', !/swap/i.test(desc || ''));
      ok('public copy: the search snippet does not call the board anonymous', !/anonymous/i.test(desc || ''));

      /* With scripting ON the fallback must stay invisible - it sits above #root in the body, so a
         regression here would print a paragraph of marketing copy over the app on every load. */
      const fallbackShown = await page.locator('noscript div').isVisible().catch(() => false);
      ok('public copy: the fallback stays invisible when the app boots normally', fallbackShown === false);
      ok('public copy: the app still boots with the no-JS rule in the head',
        errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }
  }


  /* == 19. The in-app and privacy-notice copy, audited against the positioning decision ========
     §18 fixed the <head>. It did not ask the same question of everything else the product says
     about the swap board, and three more sites were still making the claim CLAUDE.md records as
     untrue until the security-00 hardening session lands — poster_key is reversible by any
     signed-in member of the same board, so "anonymous" is a promise the board does not keep.

     The one that matters most is not in the app at all: privacy.html said "Swap posts are
     anonymous to the rest of your unit" and "Anonymity is enforced by the database rather than
     by the app". That is a privacy notice asserting a security property a recorded critical
     finding disproves, which is a different class of wrong from marketing copy.

     What is deliberately KEPT: the reveal gate ("names shown only after everyone accepts") is
     true and stays; swapPendingCount and every route into the board are untouched; ops.html's
     "anonymous" tag (signed-in vs not, a device fact) and index.html's code comments and
     analytics wording are about ANALYTICS anonymity, which is true, and were audited and left.

     Driven off the real DOM of both pages, not grepped. PR #118 owns the dashboard card and the
     Settings subtitle (~4132/4230); this section deliberately never asserts on those lines. */
  if (want(19)) {
    /* -- the signed-out swap board, which is the pitch a first-time visitor reads -------------- */
    {
      const { ctx, page, errors } = await newPage(browser, url);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.hero', { timeout: 20000 });
      await page.locator('button:text-is("Open swap board")').click();
      const sheet = page.locator('.sheet[aria-label="Shift swaps"]');
      const opened = await sheet.waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      ok('copy audit: the swap board still opens for a signed-out visitor', opened);
      const body = opened ? (await sheet.innerText()).replace(/\s+/g, ' ') : '';
      ok('copy audit: the signed-out board pitch makes no anonymity claim',
        opened && !/anonymous/i.test(body), (body.match(/.{0,40}anonymous.{0,40}/i) || [''])[0]);
      ok('copy audit: the signed-out board still states the reveal gate, which is true',
        /only after everyone accepts/i.test(body), body.slice(0, 160));
      ok('copy audit: no page errors reading the signed-out board', errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* -- privacy.html, read off its own DOM ---------------------------------------------------
       A notice nobody drives is a notice nobody checks; this is the first assertion on it. */
    {
      const { ctx, page } = await newPage(browser, url, { seed: false });
      await page.goto(url.replace(/\/$/, '') + '/privacy.html', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('h2', { timeout: 20000 });
      const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

      ok('copy audit: the privacy notice no longer calls swap posts anonymous',
        !/posts are anonymous|anonymous to the rest/i.test(text),
        (text.match(/.{0,40}anonymous.{0,40}/i) || [''])[0]);
      ok('copy audit: the privacy notice no longer claims the database enforces anonymity',
        !/anonymity is enforced/i.test(text));
      ok('copy audit: the privacy notice still explains what the board actually does',
        /per-group handle/i.test(text) && /revealed only after everyone/i.test(text));
      ok('copy audit: the privacy notice discloses that a handle can be linked back to an account',
        /link a handle back to an account/i.test(text));
      ok('copy audit: the privacy notice keeps the stable-handle limitation it already had',
        /recognise your later posts/i.test(text));
      await ctx.close();
    }

    /* -- the two board strings that need a signed-in session -----------------------------------
       The post toast and the display-name step sit behind live auth, which this sandbox cannot
       reach (harness:needs-live-auth). Asserting them off the source is weaker than a drive and
       is named as such rather than dressed up: it catches a re-introduction, which is the actual
       risk for a string a future edit might "restore" from an older copy. */
    {
      const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
      const jsx = src.slice(src.indexOf('swap board (Phase 1'));
      ok('copy audit (source, not driven): the post toast no longer says "sees it anonymously"',
        !/sees it anonymously/i.test(jsx));
      ok('copy audit (source, not driven): the display-name step no longer says posts are anonymous',
        !/Posts are anonymous/i.test(jsx));
      /* The routes into the board and the pending badge are load-bearing for anyone mid-swap and
         are explicitly out of scope for the de-emphasis work. Assert they survived this edit. */
      ok('copy audit: the pending-swap badge survives the copy pass', /swapPendingCount>0/.test(src));
    }
  }


  /* ---- 20. the exit row keeps its device id when storage fails at unload ------------------
     Found in production, not theorised: of 994 event rows across 31 names, exactly one name has
     ever carried a null anon_id — `session_end`, 2 of its 10 rows — and both times the same
     device's `app_open` fifteen seconds earlier carried an id fine (Firefox 128 on Windows,
     2026-09-17 and 2026-09-23, byte-identical props). anon_id is the only key ops_device_list()
     and ops_device() group a trail by, so a null exit row is an ending that attaches to no
     device: the visit stops nowhere. The difference between the rows that carry an id and the
     ones that do not is where the call happens — inside a `pagehide` handler — so these drive
     exactly that: break the anon-id read at unload only, and at load only, and watch the wire. */
  if (want(20)) {
    /* -- storage fails at unload, which is the shape production actually produced ------------- */
    {
      const { ctx, page, errors } = await newPage(browser, url);
      const posted = [];
      await page.route('**/rest/v1/events*', async (route) => {
        try { posted.push(JSON.parse(route.request().postData() || 'null')); } catch (_) { posted.push(null); }
        await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
      });
      /* This listener is registered at document-start, so it runs BEFORE the app's own pagehide
         handler and the storage read is already broken by the time the exit row is built. Only
         the anon-id key throws: killing localStorage wholesale would take the app down with it
         and test boot hardening instead of this. */
      await page.addInitScript(() => {
        window.addEventListener('pagehide', () => {
          const get = localStorage.getItem.bind(localStorage);
          localStorage.getItem = (k) => {
            if (k === 'scrubpay_anon_id') throw new Error('storage unavailable at unload');
            return get(k);
          };
        });
      });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });

      /* Read the id while the page is still readable — after the dispatch below this throws. */
      const devId = await page.evaluate(() => localStorage.getItem('scrubpay_anon_id'));
      ok('anon_id: the load minted a device id to compare against', !!devId, devId ? `${String(devId).slice(0, 8)}…` : 'none');

      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.waitForTimeout(400);

      const flat = posted.flatMap((p) => (Array.isArray(p) ? p : [p])).filter(Boolean);
      const end = flat.find((r) => r && r.name === 'session_end');
      ok('anon_id: an exit row is still written when the storage read throws at unload', !!end,
        end ? '' : `saw: ${flat.map((r) => r && r.name).join(',') || 'nothing'}`);
      ok('anon_id: the exit row carries the device id anyway (it was resolved while the page was alive)',
        !!end && !!end.anon_id && end.anon_id === devId,
        end ? JSON.stringify(end.anon_id) : '(no row)');
      ok('anon_id: no page error across the broken-storage unload path',
        errors.filter((e) => !isExpectedNetwork(e)).length === 0,
        errors.filter((e) => !isExpectedNetwork(e))[0] || '');
      await ctx.close();
    }

    /* -- storage fails from the first call: a load must still join its own rows ---------------
       The other half of the finding. This used to return null for every row of the load, so a
       private-mode visit reported things happening to nobody. It now gets one id for the load,
       marked `nostore-` because it does not persist and must never be counted as a return. */
    {
      const { ctx, page } = await newPage(browser, url);
      const posted = [];
      await page.route('**/rest/v1/events*', async (route) => {
        try { posted.push(JSON.parse(route.request().postData() || 'null')); } catch (_) { posted.push(null); }
        await route.fulfill({ status: 201, contentType: 'application/json', body: '' });
      });
      await page.addInitScript(() => {
        const get = localStorage.getItem.bind(localStorage);
        const set = localStorage.setItem.bind(localStorage);
        localStorage.getItem = (k) => { if (k === 'scrubpay_anon_id') throw new Error('storage blocked'); return get(k); };
        localStorage.setItem = (k, v) => { if (k === 'scrubpay_anon_id') throw new Error('storage blocked'); return set(k, v); };
      });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.takehome', { state: 'attached', timeout: 25000 });
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.waitForTimeout(400);

      const rows = posted.flatMap((p) => (Array.isArray(p) ? p : [p])).filter((r) => r && r.name);
      const ids = [...new Set(rows.map((r) => r.anon_id))];
      ok('anon_id: a storage-blocked load still reports rows at all', rows.length > 0,
        rows.map((r) => r.name).join(',') || 'nothing');
      ok('anon_id: none of them is null, so the visit attaches to something',
        rows.length > 0 && rows.every((r) => !!r.anon_id), JSON.stringify(ids));
      ok('anon_id: every row of the load shares one id, so the trail is one visit',
        ids.length === 1, JSON.stringify(ids));
      ok('anon_id: the non-persistent id is labelled as such, so cohort counts can exclude it',
        ids.length === 1 && /^nostore-/.test(String(ids[0])), JSON.stringify(ids));
      await ctx.close();
    }
  }

  /* ---- 21. the swap board goes quiet (Positioning, 2026-09-19) ---------------------------
     The board is an Easter egg, not the growth engine: fully functional for anyone holding an
     invite link, absent from the first screen where it competed with the pattern lab and the
     pickup prompt -- the two things that work for one nurse alone. Three things have to hold at
     once, which is why this drives the real DOM rather than grepping the source: the dashboard
     card is GONE, the durable route in (Settings -> Shift swaps) still OPENS THE BOARD, and the
     word "anonymously" is gone from both entry points because poster_key is reversible until the
     hardening session lands (Invariant 7 / security-00) -- an untrue promise is worse than none. */
  if (want(21)) {
    const { ctx, page, errors } = await newPage(browser, url);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.wrap .whatif', { timeout: 20000 });

    /* Scoped to the dashboard's own cards. A bare :has-text("Shift swaps") would also match the
       Settings card and the sheet header, so a "gone" assertion written that way could never pass
       and a "still there" one could never fail. */
    const dashCards = await page.evaluate(() =>
      [...document.querySelectorAll('.wrap .whatif')].map((c) => c.querySelector('.t')?.textContent.trim() || ''));
    ok('positioning: the dashboard swap card is gone at 390px',
      !dashCards.some((t) => /Shift swaps/.test(t)), JSON.stringify(dashCards));
    /* Guard against "passing" by having removed the wrong card, or all of them. */
    ok('positioning: the pattern-lab card is still on the dashboard',
      dashCards.some((t) => /Pattern lab/.test(t)), JSON.stringify(dashCards));

    /* The durable route in still works end to end -- de-emphasised, never unreachable. NOTE: this
       card is NOT in Settings, though BACKLOG.md called it "the Settings Shift swaps card". It is a
       second dashboard card in `.dash`'s second column, which stacks BELOW the fold on a phone
       (`.col` is not desk-only). Settings contains no swap entry at all. That is still the right
       outcome -- below the fold is not the first screen -- but the test says where the thing
       actually is, because the next session reads this. */
    /* Every step below is guarded and reported, never awaited bare. Negative-testing this section
       by deleting the card outright made the first draft THROW on .innerText() and take the whole
       section with it -- an aborted run is not a failed assertion, and it would have hidden exactly
       the regression that matters here (de-emphasis that quietly became removal). */
    const card = page.locator('.dash .card:has(h3:has-text("Shift swaps"))');
    const cardCount = await card.count();
    ok('positioning: the swap card survives in the dashboard\'s second column', cardCount === 1, `${cardCount} found`);

    const cardSub = cardCount === 1 ? await card.locator('> div').first().innerText().catch(() => '') : '';
    ok('positioning: the remaining swap card no longer claims the board is anonymous',
      cardCount === 1 && !/anonymously/i.test(cardSub), cardSub);

    let opened = false;
    if (cardCount === 1) {
      const openBtn = card.locator('button:has-text("Open swap board")');
      await openBtn.scrollIntoViewIfNeeded().catch(() => {});
      await openBtn.click().catch(() => {});
      opened = await page.waitForSelector('[role="dialog"][aria-label="Shift swaps"]', { timeout: 8000 })
        .then(() => true).catch(() => false);
    }
    ok('positioning: the board is still reachable on a phone after the de-emphasis', opened);
    ok('positioning: no page errors driving the quieted board',
      errors.filter((e) => !isExpectedNetwork(e)).length === 0,
      errors.filter((e) => !isExpectedNetwork(e))[0] || '');
    await ctx.close();

    /* swapPendingCount is App state fed by SwapsSheet's onPendingCount, and SwapsSheet only mounts
       while the sheet is open -- so on a fresh load the count is 0 and no badge can render at any
       site. That makes a DOM-driven "badge still shows" assertion impossible without a live
       authenticated board, so this asserts the machinery survived at the two remaining sites
       instead (topnav + the remaining dashboard card), and says plainly that that is what it is. The
       de-emphasis must not strand someone
       mid-swap. */
    const src16 = readFileSync(join(SCRATCH, 'index.html'), 'utf8');
    const badgeSites = (src16.match(/swapPendingCount>0 && <span className="count-badge"/g) || []).length;
    ok('positioning: the pending badge survives at the topnav and the dashboard card (source)',
      badgeSites === 2, `${badgeSites} sites`);
    ok('positioning: "anonymously" is gone from both entry-point subtitles (source)',
      !/Trade with your unit, anonymously/.test(src16) && !/Trade shifts with your unit — anonymously/.test(src16));
  }

  await browser.close();
  server.close();
  rmSync(SCRATCH, { recursive: true, force: true });

  console.log(`\n==== smoke: ${pass} passed / ${fail} failed ====${ONLY.length ? `  (sections ${ONLY.join(',')} only)` : ''}\n`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => { console.error('harness error:', e); process.exit(1); });
