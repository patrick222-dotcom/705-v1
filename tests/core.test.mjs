#!/usr/bin/env node
/* Node unit tests for the pure domain core, imported from the module scripts/extract_core.mjs
   generates out of index.html's @core regions. No browser, no network: this is the copy of the
   math the MCP gateway will import, so these tests are the gateway's wage probes.

   The first block repeats tests/smoke.mjs §1's wage probes on purpose — same inputs, same
   expected figures — so a divergence between the in-browser globals and the extracted module
   shows up as one suite green and the other red. The rest pin what only the module adds:
   periodPaycheck (the hero's figure) and keepRatioOf (the preview ratio).

   Usage: node tests/core.test.mjs
          CORE_MODULE=/path/to/copy.mjs node tests/core.test.mjs   # negative-test a mutated copy */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const modPath = process.env.CORE_MODULE
  ? resolve(process.env.CORE_MODULE)
  : join(ROOT, 'supabase/functions/_shared/badgebudget-core.mjs');
const C = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
function ok(name, cond, detail = ''){
  if(cond){ pass++; console.log(`PASS  ${name}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? '  — ' + detail : ''}`); }
}

/* ---- the smoke §1 wage probes, against the extracted module ----------------------------- */
const flat5 = { type: 'flat', amount: 5 };
ok('wage: hourlyRate base', C.hourlyRate(50, null) === 50);
ok('wage: hourlyRate multiplier 1.5x', C.hourlyRate(50, { type: 'multiplier', amount: 1.5 }) === 75);
ok('wage: hourlyRate percent +10%', near(C.hourlyRate(50, { type: 'percent', amount: 10 }), 55));
ok('wage: hourlyRate flat +$5', C.hourlyRate(50, flat5) === 55);
ok('wage: shiftGross 12h @ $50', C.shiftGross(50, null, { hours: 12, bonusType: 'none' }) === 600);
ok('wage: shiftGross 12h @ $50 + $5 diff', C.shiftGross(50, flat5, { hours: 12, bonusType: 'none' }) === 660);
{
  const ot = C.shiftGross(50, flat5, { hours: 12, bonusType: 'none', isOvertime: true });
  ok('wage: OT pays 1.5x the DIFFERENTIAL-inclusive rate', ot === 990, `expected 990, got ${ot}`);
}
ok('wage: charge bonus $3/hr stacks', C.shiftGross(50, null, { hours: 12, bonusType: 'charge' }) === 636);
ok('wage: custom bonus is flat, not per-hour',
  C.shiftGross(50, null, { hours: 12, bonusType: 'custom', customBonus: '100' }) === 700);
{
  const n = C.computeNet(1000, { ficaType: 'standard', federalTaxRate: 12, stateTaxRate: 5,
    pretaxDeductions: 100, posttaxDeductions: 50, customWithholdings: [] });
  ok('wage: computeNet FICA on gross, income tax on gross-pretax',
    near(n.fica, 76.5) && near(n.fed, 108) && near(n.st, 45) && near(n.net, 620.5),
    `fica=${n.fica} fed=${n.fed} st=${n.st} net=${n.net}`);
}

/* ---- periodPaycheck: the hero figure, hoisted out of App's calc() on 2026-10-07 --------- */
const taxes = { ficaType: 'standard', ficaPct: '', federalTaxRate: 10, stateTaxRate: 0,
  pretaxDeductions: 0, posttaxDeductions: 0, customWithholdings: [] };
const diffs = { base: { type: 'dollar', amount: 0 }, night: { type: 'dollar', amount: 5 } };
const job = C.makeJob({ id: 'job-1', baseRate: 50, differentials: diffs });
const shift = (shiftType, hours = 12, extra = {}) => ({ id: Math.random(), shiftType, hours,
  bonusType: 'none', customBonus: 0, isOvertime: false, ...extra });
// A Mon–Sun week, 2026-10-05 .. 2026-10-11, inside one 14-day period.
const week = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'];
{
  const p = C.periodPaycheck({
    shifts: { '2026-10-05': [shift('night')], '2026-10-07': [shift('night')],
              '2026-11-30': [shift('night')] },                    // outside the period: ignored
    dayEvents: { '2026-10-09': [{ kind: 'pto', hours: 8 }],
                 '2026-10-10': [{ kind: 'education', hours: 8 }] }, // not PTO: unpaid here
    dateKeys: week, baseRate: 50, differentials: diffs, taxInputs: taxes, job });
  // 2 × 12h × $55 = 1320, PTO 8h × $50 base (no differential) = 400 → gross 1720; 32h, no OT.
  // FICA 7.65% = 131.58, fed 10% = 172.00 → net 1416.42.
  ok('period: gross = in-period shifts at diff rate + PTO at base, out-of-period excluded',
    near(p.gross, 1720), `gross=${p.gross}`);
  ok('period: hours count shifts and PTO', p.hours === 32, `hours=${p.hours}`);
  ok('period: net matches computeNet on that gross', near(p.net, 1416.42) && near(p.fica, 131.58),
    `net=${p.net} fica=${p.fica}`);
  ok('period: carries the overtime record and work period', p.ot && p.ot.premiumCents === 0
    && p.otWorkPeriod === job.workPeriod, JSON.stringify(p.ot));
}
{
  // Four 12h base shifts in one FLSA week = 48h: 8h past 40 earn half the regular rate on top.
  const p = C.periodPaycheck({
    shifts: Object.fromEntries(week.slice(0, 4).map(k => [k, [shift('base')]])),
    dayEvents: {}, dateKeys: week, baseRate: 50, differentials: diffs, taxInputs: taxes, job });
  ok('period: 48h week adds the overtime premium (4×600 + 0.5×50×8 = 2600)',
    near(p.gross, 2600) && p.ot.premiumCents === 20000, `gross=${p.gross} premium=${p.ot.premiumCents}`);
}

/* ---- keepRatioOf: the preview ratio, hoisted out of App on 2026-10-07 --------------------- */
ok('keep: standard FICA + fed 10 + state 5 → 0.7735',
  near(C.keepRatioOf({ ...taxes, stateTaxRate: 5 }), 0.7735));
ok('keep: percent withholding counts, flat-dollar does not',
  near(C.keepRatioOf({ ...taxes, stateTaxRate: 5, customWithholdings: [
    { type: 'percent', amount: '2' }, { type: 'dollar', amount: '40' }] }), 0.7535));
ok('keep: never negative', C.keepRatioOf({ ...taxes, federalTaxRate: 120 }) === 0);

/* ---- sanitizeData: the gateway reads the same blob the app does --------------------------- */
{
  const d = C.sanitizeData({ shifts: { '2026-10-05': [shift('night')], bad: 'x' }, goals: 'nope' });
  ok('sanitize: keeps a valid shift day', Array.isArray(d.shifts && d.shifts['2026-10-05'])
    && d.shifts['2026-10-05'].length === 1);
  ok('sanitize: drops a non-date shift key', !(d.shifts && 'bad' in d.shifts));
}

console.log(`\n==== core: ${pass} passed / ${fail} failed ====`);
process.exit(fail ? 1 : 0);
