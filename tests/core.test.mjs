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

/* ---- onboarding v2: personas are starting values, and Healthcare IS today's defaults ------
   The literals below are the app's defaults as of 2026-10-10 (App's useState initializers and
   resetToDefaults, before they were pointed at the preset). Written out by hand on purpose: a
   test comparing the preset to DIFF_DEFAULTS or to itself could never fail. */
const TODAY_DEFAULTS = {
  baseRate: 65.15, federalTaxRate: 12, stateTaxRate: 2.5, pretaxDeductions: 0, posttaxDeductions: 0,
  ficaType: 'standard', ficaPct: 7.65, workPeriod: '40', otMethod: 'regular-rate',
  mealBreakMins: 30, mealBreakMode: 'included',
  differentials: {
    'base':           { name: 'Day (regular)',   amount: 0,    type: 'dollar',     active: true,  color: '#9A9082' },
    'night':          { name: 'Night',           amount: 10,   type: 'dollar',     active: true,  color: '#34452A' },
    'weekday-eve':    { name: 'Weekday evening', amount: 3,    type: 'dollar',     active: false, color: '#6E665A' },
    'weekend-day':    { name: 'Weekend day',     amount: 11.5, type: 'dollar',     active: true,  color: '#B65D45' },
    'weekend-eve':    { name: 'Weekend night',   amount: 16.5, type: 'dollar',     active: true,  color: '#8C4A38' },
    'holiday':        { name: 'Holiday',         amount: 1.5,  type: 'multiplier', active: true,  color: '#D9A33C' },
    'overtime':       { name: 'Overtime (1.5×)', amount: 1.5,  type: 'multiplier', active: true,  color: '#11A86B' },
    'bonus-incentive':{ name: 'Bonus incentive', amount: 15,   type: 'dollar',     active: true,  color: '#11A86B' },
  },
};
{
  const H = C.PERSONA_PRESETS.healthcare;
  const payFields = Object.keys(TODAY_DEFAULTS);
  const picked = Object.fromEntries(payFields.map((k) => [k, H[k]]));
  ok('persona: the Healthcare preset equals today\'s defaults exactly (every pay input + every differential)',
    JSON.stringify(picked) === JSON.stringify(TODAY_DEFAULTS),
    payFields.filter((k) => JSON.stringify(H[k]) !== JSON.stringify(TODAY_DEFAULTS[k])).join(', '));
  ok('persona: the preset carries no field the pay math reads beyond those (no hidden rule)',
    Object.keys(H).filter((k) => !payFields.includes(k)).sort().join(',') === 'cards,extras,sampleMix',
    Object.keys(H).join(','));
  ok('persona: only Healthcare and Other hourly exist — no police or fire tiles yet',
    JSON.stringify(C.PERSONA_IDS) === '["healthcare","other"]' && Object.keys(C.PERSONA_PRESETS).length === 2);
  ok('persona: an unknown id falls back to Healthcare, never to undefined',
    C.personaPreset('police') === H && C.personaPreset(undefined) === H && C.personaPreset('other') === C.PERSONA_PRESETS.other);
  const O = C.PERSONA_PRESETS.other;
  ok('persona: Other hourly shares the user-level taxes (a persona never moves tax)',
    ['federalTaxRate', 'stateTaxRate', 'pretaxDeductions', 'posttaxDeductions', 'ficaType', 'ficaPct']
      .every((k) => O[k] === H[k]));
}

/* ---- seeding: today's sample fortnight is unchanged, and the funnel's shapes are input only --- */
const strip = (m) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, a]) =>
  [k, a.map(({ id, ...rest }) => rest)])));
{
  const start = '2026-10-04';   // a Sunday, so the weekend inference is exercised
  const legacy = C.buildSampleShifts(start);
  // Hand-written: what the pre-2026-10-10 buildSampleShifts returned for this start.
  const expect = {};
  [[1, 'night'], [2, 'base'], [3, 'night'], [8, 'base'], [9, 'night'], [10, 'base']].forEach(([off, t]) => {
    const d = new Date(2026, 9, 4 + off);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect[k] = [{ shiftType: t, hours: 12, bonusType: 'none', customBonus: 0, isOvertime: false, patternId: '__sample__' }];
  });
  ok('seed: buildSampleShifts(start) with no opts is exactly today\'s six 12h shifts', strip(legacy) === JSON.stringify(expect),
    strip(legacy).slice(0, 160));
  const sat = C.buildSampleShifts('2026-10-09');   // Friday start: days 1 and 9 are Saturdays
  ok('seed: the weekend inference still applies', sat['2026-10-10'][0].shiftType === 'weekend-day'
    && sat['2026-10-18'][0].shiftType === 'weekend-day', JSON.stringify(Object.values(sat).map((a) => a[0].shiftType)));
  const hc = C.buildSampleShifts(start, C.obSeedOpts(12, 'ft', C.PERSONA_PRESETS.healthcare.sampleMix, { diffs: true, holiday: true }));
  ok('seed: Healthcare · 12h · Full-time seeds today\'s fortnight, shift for shift', strip(hc) === strip(legacy));
  const hours = (m) => Object.values(m).reduce((a, arr) => a + arr.reduce((b, s) => b + s.hours, 0), 0);
  ok('seed: Full-time 3×12 is 72 hours a pay period, not 80', hours(hc) === 72, String(hours(hc)));
  const table = [];
  for (const st of C.WORK_STATUSES) for (const h of C.OB_SHIFT_LENGTHS) {
    const o = C.obSeedOpts(h, st, 'rotating', { diffs: true });
    table.push(`${st}${h}:${o.perWeek * h * 2}`);
  }
  ok('seed: hours per period across status × length match the spec table',
    table.join(' ') === 'ft8:80 ft10:80 ft12:72 pt8:48 pt10:40 pt12:48 prn8:16 prn10:20 prn12:24', table.join(' '));
  ok('seed: differentials off -> no seeded night or weekend shift (an inactive chip is still priced)',
    C.obSeedOpts(12, 'ft', 'rotating', { diffs: false }).mix === 'days'
      && Object.values(C.buildSampleShifts(start, C.obSeedOpts(12, 'ft', 'rotating', { diffs: false })))
        .every((a) => a[0].shiftType === 'base'));
  ok('seed: Other hourly seeds day shifts whatever its toggles say',
    C.obSeedOpts(8, 'pt', C.PERSONA_PRESETS.other.sampleMix, { diffs: true, evenings: true }).mix === 'days');

  /* No seeded fortnight carries overtime under the 40-hour week both presets use. */
  const days14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(2026, 9, 4 + i);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const withOt = [];
  for (const st of C.WORK_STATUSES) for (const h of C.OB_SHIFT_LENGTHS) {
    const sh = C.buildSampleShifts(start, C.obSeedOpts(h, st, 'rotating', { diffs: true }));
    const j = C.makeJob({ id: 'job-1', baseRate: 30, differentials: TODAY_DEFAULTS.differentials, workPeriod: '40' });
    const p = C.periodPaycheck({ shifts: sh, dayEvents: {}, dateKeys: days14, baseRate: 30,
      differentials: TODAY_DEFAULTS.differentials, taxInputs: taxes, job: j });
    if (p.ot.premiumCents !== 0) withOt.push(`${st}${h}`);
  }
  ok('seed: no status × length seeds overtime under the 40-hour week', withOt.length === 0, withOt.join(','));

  /* The Healthcare path's number is today's number: price the seeded fortnight once with the
     preset and once with the hand-written literals above. */
  const price = (src, sh) => {
    const j = C.makeJob({ id: 'job-1', baseRate: src.baseRate, differentials: src.differentials,
      workPeriod: src.workPeriod, otMethod: src.otMethod, mealBreakMins: src.mealBreakMins, mealBreakMode: src.mealBreakMode });
    return C.periodPaycheck({ shifts: sh, dayEvents: {}, dateKeys: days14, baseRate: src.baseRate,
      differentials: src.differentials, job: j, taxInputs: { ficaType: src.ficaType, ficaPct: src.ficaPct,
        federalTaxRate: src.federalTaxRate, stateTaxRate: src.stateTaxRate, pretaxDeductions: src.pretaxDeductions,
        posttaxDeductions: src.posttaxDeductions, customWithholdings: [] } });
  };
  const viaPreset = price(C.PERSONA_PRESETS.healthcare, hc), viaToday = price(TODAY_DEFAULTS, legacy);
  ok('seed: Healthcare preset + its seed prices to today\'s sample paycheck to the cent',
    JSON.stringify(viaPreset) === JSON.stringify(viaToday) && viaToday.net > 0, `${viaPreset.net} vs ${viaToday.net}`);
  const oth = C.buildSampleShifts(start, C.obSeedOpts(8, 'ft', 'days', {}));
  const pOther = price(C.PERSONA_PRESETS.other, oth);
  ok('seed: Other hourly full-time 8h prices to rate × 80 h before tax (its differentials cannot reach it)',
    near(pOther.gross, 25 * 80), String(pOther.gross));
}

/* ---- the pay screen's inputs ----------------------------------------------------------------- */
ok('pay: salary converts on a 2,080-hour year, to the cent',
  C.salaryToHourly(91234) === 43.86 && C.salaryToHourly('85000') === 40.87, `${C.salaryToHourly(91234)} ${C.salaryToHourly('85000')}`);
ok('pay: a blank, negative or junk salary is no rate at all',
  C.salaryToHourly('') === 0 && C.salaryToHourly(-5) === 0 && C.salaryToHourly('abc') === 0 && C.salaryToHourly(Infinity) === 0);
{
  const on = C.obExtrasOn(C.PERSONA_PRESETS.healthcare.differentials);
  const onO = C.obExtrasOn(C.PERSONA_PRESETS.other.differentials);
  ok('extras: Healthcare starts with differentials and holiday on (today\'s defaults)', on.diffs && on.holiday, JSON.stringify(on));
  ok('extras: Other hourly starts with evenings + holiday on, weekends off', onO.evenings && onO.holiday && !onO.weekend, JSON.stringify(onO));
  const partial = { ...C.DIFF_DEFAULTS, 'weekend-eve': { ...C.DIFF_DEFAULTS['weekend-eve'], active: false } };
  ok('extras: an extra is on only when every differential it governs is active', C.obExtrasOn(partial).diffs === false);
}

/* ---- the three new saved fields go through the sanitizer's whitelist ----------------------- */
{
  const good = C.sanitizeData({ persona: 'other', workStatus: 'prn', union: 'unsure' });
  ok('sanitize: keeps a whitelisted persona, work status and union answer',
    good.persona === 'other' && good.workStatus === 'prn' && good.union === 'unsure', JSON.stringify(good));
  const bad = C.sanitizeData({ persona: 'police', workStatus: 'FT', union: true });
  ok('sanitize: drops anything off the whitelist rather than coercing it',
    !('persona' in bad) && !('workStatus' in bad) && !('union' in bad), JSON.stringify(bad));
  const odd = C.sanitizeData({ persona: { toString: () => 'healthcare' }, workStatus: ['ft'], union: 'constructor' });
  ok('sanitize: an object, array or prototype key is not an answer',
    !('persona' in odd) && !('workStatus' in odd) && !('union' in odd));
  ok('sanitize: a blob without them stays without them (never defaults to Healthcare)',
    !('persona' in C.sanitizeData({ baseRate: 40 })));
}

/* ---- the funnel's analytics whitelist -------------------------------------------------------- */
{
  const E = C.obEventProps;
  ok('events: every enumerated answer passes, exactly as sent',
    Object.entries(C.OB_ANSWERS).every(([q, as]) => as.every((a) => JSON.stringify(E('ob_answer', { q, a })) === JSON.stringify({ q, a }))));
  ok('events: a numeric shift length is sent as its enumerated string', JSON.stringify(E('ob_answer', { q: 'shift', a: 12 })) === '{"q":"shift","a":"12"}');
  ok('events: a typed rate, salary or dollar figure is never an answer',
    E('ob_answer', { q: 'pay', a: '43.21' }) === null && E('ob_answer', { q: 'pay', a: 91234 }) === null
      && E('ob_answer', { q: 'rate', a: 'hourly' }) === null && E('ob_answer', { q: 'shift', a: '$12' }) === null);
  ok('events: prototype keys are not questions', E('ob_answer', { q: 'constructor', a: 'on' }) === null
    && E('ob_answer', { q: '__proto__', a: 'on' }) === null && E('ob_answer', { q: 'toString', a: 'on' }) === null);
  ok('events: extra keys are stripped, not forwarded',
    JSON.stringify(E('ob_answer', { q: 'status', a: 'ft', rate: 43.21 })) === '{"q":"status","a":"ft"}'
      && JSON.stringify(E('ob_view', { screen: 'pay', net: 1234 })) === '{"screen":"pay"}');
  ok('events: ob_view / ob_back only name one of the seven screens',
    C.OB_SCREENS.every((s) => E('ob_view', { screen: s }) && E('ob_back', { from: s }))
      && E('ob_view', { screen: 'done' }) === null && E('ob_back', { from: 'Pay' }) === null && E('ob_view', null) === null);
  ok('events: obEventProps refuses every other event name', E('setup_completed', { mode: 'rough' }) === null);
}

/* ---- the configurable work period (session 2, 2026-10-10) --------------------------------------
   docs/pay-rule-patterns.md (c) priced one fortnight of each common police schedule at $45/h with
   NO overtime actually worked, and found the two settings that existed both invent some. Those
   ten cells are pinned first, exactly as the doc printed them, because '40' and '8-80' were not
   supposed to move by a cent. Then the point of the session: under "only overtime I mark" and
   under the 14-day law-enforcement 7(k) period, all five schedules carry zero. */
{
  const S = '2026-10-04';   // a Sunday, like the doc's fortnight
  const K = (n, from = S) => Array.from({ length: n }, (_, i) => { const d = C.parseISODate(from);
    return C.keyOfDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)); });
  const SCHED = {
    '8h 5-2':      [8, 8, 8, 8, 8, 0, 0, 8, 8, 8, 8, 8, 0, 0],
    '4/10':        [10, 10, 10, 10, 0, 0, 0, 10, 10, 10, 10, 0, 0, 0],
    '3/3 10.5h':   [10.5, 10.5, 10.5, 0, 0, 0, 10.5, 10.5, 10.5, 0, 0, 0, 10.5, 10.5],
    '12h + Kelly': [12, 12, 12, 12, 0, 0, 0, 12, 12, 8, 0, 0, 0, 0],
    '12h Pitman':  [0, 12, 12, 0, 0, 12, 12, 12, 0, 0, 12, 12, 0, 0],
  };
  const shiftsOf = (hrs, from = S, flagIdx = -1) => { const k = K(hrs.length, from); const o = {};
    hrs.forEach((h, i) => { if (h) o[k[i]] = [{ id: i, shiftType: 'base', hours: h, bonusType: 'none', customBonus: 0, isOvertime: i === flagIdx }]; });
    return o; };
  const noTax = { ficaType: 'standard', ficaPct: 7.65, federalTaxRate: 0, stateTaxRate: 0, pretaxDeductions: 0, posttaxDeductions: 0, customWithholdings: [] };
  const pay = (shifts, jobOpts, keys = K(14)) => C.periodPaycheck({ shifts, dayEvents: {}, dateKeys: keys, baseRate: 45,
    differentials: {}, taxInputs: noTax, job: C.makeJob({ id: 'job-1', baseRate: 45, differentials: {}, ...jobOpts }) });
  const pct = (p, hrs) => (p.ot.premiumCents / 100 / (hrs.reduce((a, b) => a + b, 0) * 45) * 100).toFixed(1);

  const DOC = { '8h 5-2': ['0.0', '0.0'], '4/10': ['0.0', '10.0'], '3/3 10.5h': ['2.4', '11.9'],
    '12h + Kelly': ['5.0', '15.0'], '12h Pitman': ['4.8', '16.7'] };
  const got = Object.entries(SCHED).map(([n, h]) => `${n}:${pct(pay(shiftsOf(h), { workPeriod: '40' }), h)}/${pct(pay(shiftsOf(h), { workPeriod: '8-80' }), h)}`);
  const want = Object.entries(DOC).map(([n, [a, b]]) => `${n}:${a}/${b}`);
  ok('work period: the two old settings still invent exactly the phantom overtime pay-rule-patterns (c) measured',
    got.join(' ') === want.join(' '), got.join(' '));

  /* None of the five reaches 8/80's PERIOD half -- its daily half always wins -- so pin that half
     on its own: eleven 8-hour days is 88 h with no day over 8. */
  const elevenEights = [8, 8, 8, 8, 8, 8, 0, 8, 8, 8, 8, 8, 0, 0];
  const e880 = pay(shiftsOf(elevenEights), { workPeriod: '8-80' });
  ok('work period: 8/80\'s 80-hour half still counts on its own (eleven 8 h days = 8 h over)',
    e880.ot.otHours === 8 && e880.ot.premiumCents === 18000, `${e880.ot.otHours} h ${e880.ot.premiumCents}c`);

  const zero = (opts) => Object.entries(SCHED).filter(([, h]) => pay(shiftsOf(h), opts).ot.premiumCents !== 0).map(([n]) => n);
  ok('work period: "only overtime I mark" adds zero on 12 h Pitman, 12 h + Kelly, 3/3 10.5 h, 4/10 and 8 h 5-2',
    zero({ workPeriod: 'flagged' }).length === 0, zero({ workPeriod: 'flagged' }).join(','));
  ok('work period: so does the 14-day law-enforcement 7(k) period, 86 hours in 14 days',
    zero({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14 }).length === 0,
    zero({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14 }).join(','));

  /* A threshold is a threshold: a 7-day 7(k) period (43 h) on the Pitman's 48-hour week is REAL
     overtime under that contract -- 5 h at half of $45 -- not a phantom. */
  const k7 = pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: 'custom', otPeriodHours: 43, otPeriodDays: 7 });
  ok('work period: a custom period uses its own threshold (Pitman under 43 in 7 = 5 h, $112.50)',
    k7.ot.otHours === 5 && k7.ot.premiumCents === 11250, `${k7.ot.otHours} h, ${k7.ot.premiumCents}c`);
  ok('work period: periodPaycheck reports the rule it priced with',
    JSON.stringify(k7.otRule) === JSON.stringify({ id: 'custom', days: 7, hours: 43, daily: null, anchor: null }), JSON.stringify(k7.otRule));

  /* A hand-marked shift is still paid 1.5x inside shiftGross under 'flagged'. */
  const fl = pay(shiftsOf(SCHED['12h Pitman'], S, 1), { workPeriod: 'flagged' });
  ok('work period: under "flagged", a marked shift is still paid 1.5x and nothing else is added',
    fl.ot.premiumCents === 0 && Math.round(fl.gross * 100) === (72 * 4500 + 12 * 6750), `gross ${fl.gross}`);

  /* 28 days: the period straddles two paychecks. Pitman twice is 168 h, under 171; one extra
     12-hour tour on a day off makes it 180, so 9 h at half of $45 -- and it lands in the
     paycheck whose dates hold the period's LAST day, reaching back for the first fortnight's hours. */
  const p28 = [...SCHED['12h Pitman'], ...SCHED['12h Pitman']];
  const extra = p28.slice(); extra[14] = 12;
  const job28 = { workPeriod: 'custom', otPeriodHours: 171, otPeriodDays: 28, otPeriodStart: S };
  const k28 = K(28);
  const a1 = pay(shiftsOf(p28), job28, k28.slice(0, 14)), a2 = pay(shiftsOf(p28), job28, k28.slice(14));
  ok('work period: Pitman on 171 in 28 days has no overtime in either paycheck',
    a1.ot.premiumCents === 0 && a2.ot.premiumCents === 0);
  const b1 = pay(shiftsOf(extra), job28, k28.slice(0, 14)), b2 = pay(shiftsOf(extra), job28, k28.slice(14));
  ok('work period: an extra tour inside a 28-day period is 9 h of overtime, in the paycheck that closes it',
    b1.ot.premiumCents === 0 && b2.ot.otHours === 9 && b2.ot.premiumCents === 20250 && b2.ot.periods[0].hours === 180,
    `first ${b1.ot.premiumCents}c, second ${b2.ot.otHours} h ${b2.ot.premiumCents}c over ${b2.ot.periods.map((x) => x.hours)}`);
  /* The same period read from a start date one fortnight earlier: now it closes in the FIRST
     paycheck of these 28 days, and the second has an open period that contributes nothing yet. */
  const shifted = { ...job28, otPeriodStart: K(1, '2026-09-20')[0] };
  const c1 = pay(shiftsOf(extra), shifted, k28.slice(0, 14)), c2 = pay(shiftsOf(extra), shifted, k28.slice(14));
  ok('work period: the start date decides which paycheck a period lands in',
    c1.ot.periods.length === 1 && c2.ot.periods.length === 0 && c2.ot.premiumCents === 0,
    `${c1.ot.periods.length} / ${c2.ot.periods.length}`);

  /* Without a start date a period that divides the fortnight lines up with it, like the 40-hour
     week always has: 80 in 14 days with no daily rule is 8/80 minus its daily half. */
  const c80 = pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: 'custom', otPeriodHours: 80, otPeriodDays: 14 });
  ok('work period: 80 in 14 days has no daily rule -- Pitman is 4 h over, not 8/80\'s 28',
    c80.ot.otHours === 4, String(c80.ot.otHours));

  /* Flagged is at least as generous as the 7(k) period in the case the session doc asked about:
     a 12-hour officer working one extra tour. Marked, it earns 0.5 x 12 h on top of straight time;
     under 86 in 14 it earns 0.5 x 10 h. So "only overtime I mark" can ship on its own. */
  const pit = SCHED['12h Pitman'].slice(); pit[0] = 12;
  const marked = pay(shiftsOf(pit, S, 0), { workPeriod: 'flagged' });
  const k14 = pay(shiftsOf(pit), { workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14 });
  ok('work period: an extra tour marked as overtime pays at least what 86-in-14 would ($4,590 vs $4,545)',
    Math.round(marked.gross * 100) === 459000 && Math.round(k14.gross * 100) === 454500, `${marked.gross} vs ${k14.gross}`);

  /* Safe defaults: an incomplete custom period is the 40-hour week -- never "no overtime". */
  const rules = [
    C.workPeriodRule(C.makeJob({ workPeriod: 'custom' })),
    C.workPeriodRule(C.makeJob({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 6 })),
    C.workPeriodRule(C.makeJob({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 29 })),
    C.workPeriodRule(C.makeJob({ workPeriod: 'custom', otPeriodHours: 200, otPeriodDays: 7 })),
    C.workPeriodRule(C.makeJob({ workPeriod: 'bogus' })),
  ].map((r) => r && r.id);
  ok('work period: a custom period missing or out of range falls back to the 40-hour week',
    rules.join(',') === '40,40,40,40,40', rules.join(','));
  ok('work period: "flagged" is the only rule with no derived overtime', C.workPeriodRule(C.makeJob({ workPeriod: 'flagged' })) === null);
  ok('work period: a bad start date is ignored, not guessed at',
    C.workPeriodRule(C.makeJob({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14, otPeriodStart: '2026-02-30' })).anchor === null);

  /* Stray custom numbers on a '40' or '8-80' blob change nothing: the old settings ignore them. */
  const stray = { otPeriodHours: 10, otPeriodDays: 7, otPeriodStart: '2026-10-07' };
  ok('work period: custom fields are inert unless the work period is custom',
    JSON.stringify(pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: '40', ...stray })) === JSON.stringify(pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: '40' }))
      && JSON.stringify(pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: '8-80', ...stray })) === JSON.stringify(pay(shiftsOf(SCHED['12h Pitman']), { workPeriod: '8-80' })));

  /* The sanitizer: whitelisted, dropped (never coerced) when out of range. */
  const keep = C.sanitizeData({ workPeriod: 'custom', otPeriodHours: '171', otPeriodDays: 28, otPeriodStart: '2026-09-20' });
  ok('sanitize: keeps a custom work period and its three numbers',
    keep.workPeriod === 'custom' && keep.otPeriodHours === 171 && keep.otPeriodDays === 28 && keep.otPeriodStart === '2026-09-20', JSON.stringify(keep));
  const drop = C.sanitizeData({ workPeriod: '7k', otPeriodHours: -4, otPeriodDays: 14.5, otPeriodStart: '2026-13-01' });
  ok('sanitize: drops an unknown work period and out-of-range numbers',
    !('workPeriod' in drop) && !('otPeriodHours' in drop) && !('otPeriodDays' in drop) && !('otPeriodStart' in drop), JSON.stringify(drop));
  ok('sanitize: "flagged" survives the whitelist', C.sanitizeData({ workPeriod: 'flagged' }).workPeriod === 'flagged');
  ok('sanitize: a pre-jobs blob\'s migrated job carries the custom period',
    C.sanitizeData({ workPeriod: 'custom', otPeriodHours: 86, otPeriodDays: 14 }).jobs[0].otPeriodHours === 86);
}

console.log(`\n==== core: ${pass} passed / ${fail} failed ====`);
process.exit(fail ? 1 : 0);
