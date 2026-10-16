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
  baseRate: 65.15, federalTaxRate: 12, stateTaxRate: 2.5, pretaxDeductions: 0, pretaxHealth: 0, posttaxDeductions: 0,
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
    ['federalTaxRate', 'stateTaxRate', 'pretaxDeductions', 'pretaxHealth', 'posttaxDeductions', 'ficaType', 'ficaPct']
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

/* ---- syncManualOnly: the manual-sync preference (2026-10-16) ------------------------------- */
{
  /* A strict === true, not a truthy coercion. Everything that is not a literal true has to read
     as "leave auto-sync on", because that is what every blob written before 2026-10-16 means --
     and the failure direction matters: reading a stale or hostile blob as manual-only would
     silently stop a nurse's schedule syncing with nothing on screen to say so. */
  ok('sanitize: a literal true is kept', C.sanitizeData({ syncManualOnly: true }).syncManualOnly === true);
  ok('sanitize: a blob that never heard of the field reads as auto-sync on',
    C.sanitizeData({ baseRate: 40 }).syncManualOnly === false);
  const truthy = ['true', 1, 'yes', {}, [], 'manual'].map((v) => C.sanitizeData({ syncManualOnly: v }).syncManualOnly);
  ok('sanitize: nothing truthy-but-not-true turns auto-sync off',
    truthy.every((x) => x === false), JSON.stringify(truthy));
  ok('sanitize: and false stays false', C.sanitizeData({ syncManualOnly: false }).syncManualOnly === false);
  /* It is a preference, never a pay input: the same blob must price identically either way. */
  const base = { baseRate: 44, federalTaxRate: 12, stateTaxRate: 3.07, ficaWithholdingType: 'standard' };
  const a = C.sanitizeData({ ...base, syncManualOnly: true });
  const b = C.sanitizeData({ ...base, syncManualOnly: false });
  const strip = (o) => JSON.stringify({ ...o, syncManualOnly: null });
  ok('sanitize: the preference moves nothing else in the blob', strip(a) === strip(b), strip(a));
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

/* ---- FICA on pre-tax health premiums (2026-10-11, docs/fica-health-premium-spec.md) ---------
   Section 125 health/dental/vision premiums skip Social Security and Medicare; 401(k)/403(b)/
   457(b) deferrals do not. pretaxDeductions stays the retirement bucket; pretaxHealth is new. */
{
  const t0 = { ficaType: 'standard', federalTaxRate: 0, stateTaxRate: 0, pretaxDeductions: 0,
    posttaxDeductions: 0, customWithholdings: [] };
  /* The California police stub, period 2024-11-11..24 (docs/pay-rule-patterns.md (g)): a
     Medicare-only department, so FICA is a custom 1.45%. The printed line is $138.53. */
  const ca = { ...t0, ficaType: 'percent', ficaPct: 1.45 };
  const stub = C.computeNet(9820.04, { ...ca, pretaxHealth: 266.03 });
  ok('fica: the California stub\'s Medicare to the cent — 1.45% × ($9,820.04 − $266.03) = $138.53',
    stub.fica === 138.53, `got ${stub.fica}`);
  const wrongBucket = C.computeNet(9820.04, { ...ca, pretaxDeductions: 266.03 });
  ok('fica: the same $266.03 in the retirement bucket stays FICA wages ($142.39, the old figure)',
    wrongBucket.fica === 142.39, `got ${wrongBucket.fica}`);

  const ret = C.computeNet(1000, { ...t0, federalTaxRate: 10, stateTaxRate: 5, pretaxDeductions: 100 });
  ok('fica: retirement money is still FICA-taxed (7.65% of $1,000), income tax on $900',
    ret.fica === 76.5 && ret.fed === 90 && ret.st === 45 && ret.net === 688.5,
    `fica=${ret.fica} fed=${ret.fed} st=${ret.st} net=${ret.net}`);
  const hl = C.computeNet(1000, { ...t0, federalTaxRate: 10, stateTaxRate: 5, pretaxHealth: 100 });
  ok('fica: a health premium skips both — FICA on $900 ($68.85), income tax on $900',
    hl.fica === 68.85 && hl.fed === 90 && hl.st === 45 && hl.net === 696.15 && hl.health === 100 && hl.pre === 0,
    `fica=${hl.fica} fed=${hl.fed} st=${hl.st} net=${hl.net} health=${hl.health}`);
  const both = C.computeNet(2000, { ...t0, federalTaxRate: 10, pretaxDeductions: 150, pretaxHealth: 200,
    customWithholdings: [{ type: 'percent', amount: 2 }] });
  /* FICA base 1,800; income-tax base 1,650: the two bases stay apart. */
  ok('fica: both buckets at once keep two bases — FICA on gross−health, income tax on gross−both',
    both.fica === 137.7 && both.fed === 165 && both.cw === 33 && both.pre === 150 && both.health === 200,
    `fica=${both.fica} fed=${both.fed} cw=${both.cw} pre=${both.pre} health=${both.health}`);
  ok('fica: a negative premium can never raise a base',
    JSON.stringify(C.computeNet(1000, { ...t0, pretaxHealth: -500 })) === JSON.stringify(C.computeNet(1000, t0)));

  /* An existing blob prices identically. Each literal is the pre-change computeNet output for the
     fixture, captured from the extracted module at 3532234 before any edit, written out by hand
     so the comparison cannot be against itself. The only new key is `health`, and it is 0. */
  const BEFORE = [
    [1000, { ficaType: 'standard', federalTaxRate: 12, stateTaxRate: 5, pretaxDeductions: 100, posttaxDeductions: 50, customWithholdings: [] },
      {"gross":1000,"nonTaxable":0,"total":1000,"fica":76.5,"fed":108,"st":45,"cw":0,"ded":379.5,"net":620.5,"pre":100,"post":50,"pct":62}],
    [1590.94, { ficaType:'standard', federalTaxRate:11, stateTaxRate:4.25, pretaxDeductions:95.5, posttaxDeductions:12.75, customWithholdings:[{type:'percent',amount:2.5},{type:'dollar',amount:33.33}] },
      {"gross":1590.94,"nonTaxable":0,"total":1590.94,"fica":121.71,"fed":164.5,"st":63.56,"cw":70.72,"ded":528.74,"net":1062.2,"pre":95.5,"post":12.75,"pct":67}],
    [2600, { ficaType:'percent', ficaPct:6.2, federalTaxRate:12, stateTaxRate:3, pretaxDeductions:200, posttaxDeductions:75, customWithholdings:[{type:'percent',amount:5}] },
      {"gross":2600,"nonTaxable":0,"total":2600,"fica":161.2,"fed":288,"st":72,"cw":120,"ded":916.2,"net":1683.8,"pre":200,"post":75,"pct":65}],
    [0, { ficaType:'standard', federalTaxRate:12, stateTaxRate:2.5, pretaxDeductions:260, posttaxDeductions:40, customWithholdings:[] },
      {"gross":0,"nonTaxable":0,"total":0,"fica":0,"fed":0,"st":0,"cw":0,"ded":300,"net":0,"pre":0,"post":0,"pct":0}],
    [{taxable:3096, nonTaxable:1442}, { ficaType:'standard', federalTaxRate:10, stateTaxRate:3, pretaxDeductions:150, posttaxDeductions:0, customWithholdings:[] },
      {"gross":3096,"nonTaxable":1442,"total":4538,"fica":236.84,"fed":294.6,"st":88.38,"cw":0,"ded":769.82,"net":3768.18,"pre":150,"post":0,"pct":83}],
  ];
  const moved = [];
  BEFORE.forEach(([g, t, want], i) => {
    // through the sanitizer too, as a saved blob would arrive: no pretaxHealth key at all
    const s = C.sanitizeData({ ...t, ficaWithholdingType: t.ficaType, ficaWithholdingPercent: t.ficaPct });
    const got = C.computeNet(g, { ...t, pretaxHealth: s.pretaxHealth });
    const extra = Object.keys(got).filter((k) => !(k in want));
    if (Object.keys(want).some((k) => got[k] !== want[k]) || extra.join() !== 'health' || got.health !== 0)
      moved.push(`#${i}: ${JSON.stringify(got)}`);
  });
  ok('fica: a blob saved before the field existed prices identically, key for key (5 fixtures)',
    moved.length === 0, moved.join(' | '));

  /* The Breakdown still sums when the deductions run past what gross can absorb. */
  /* $300 gross: FICA on $100 = $7.65, no income tax; $292.35 is left for the flat rows, so
     retirement shows $150, health is capped at $142.35 and post-tax at $0. */
  const cap = C.computeNet(300, { ...t0, federalTaxRate: 10, pretaxDeductions: 150, pretaxHealth: 200, posttaxDeductions: 100 });
  const rows = Math.round((cap.pre + cap.health + cap.post + cap.fica + cap.fed + cap.st + cap.cw + cap.net) * 100);
  ok('fica: capped rows (retirement, health, post-tax) + taxes + net = gross',
    rows === 30000 && cap.pre === 150 && cap.health === 142.35 && cap.post === 0 && cap.fica === 7.65, JSON.stringify(cap));

  /* The sanitizer: finite and >= 0 only. */
  const sv = (v) => C.sanitizeData({ pretaxHealth: v }).pretaxHealth;
  ok('sanitize: keeps a premium (number or numeric string)', sv(266.03) === 266.03 && sv('50') === 50 && sv(0) === 0);
  ok('sanitize: drops a negative, NaN, junk or infinite premium',
    [-5, NaN, 'abc', Infinity].every((v) => sv(v) === undefined), [-5, NaN, 'abc', Infinity].map(sv).join(','));
  ok('sanitize: a blob without the field carries no premium', !('pretaxHealth' in C.sanitizeData({ pretaxDeductions: 100 })));
  ok('fica: keepRatioOf stays rates-only — a premium does not move the preview ratio',
    C.keepRatioOf({ ...t0, federalTaxRate: 12, stateTaxRate: 3, pretaxHealth: 266 }) === C.keepRatioOf({ ...t0, federalTaxRate: 12, stateTaxRate: 3 }));
}

/* ---- pay events: per-shift multiplier + minimum hours (session 3, 2026-10-11) -------------
   docs/pay-events-spec.md. Every figure below is hand-computed in the comment beside it. */
{
  const ev = (hours, extra = {}) => ({ shiftType: 'base', hours, bonusType: 'none', customBonus: 0, isOvertime: false, ...extra });
  const g = (rate, s) => C.shiftGross(rate, null, s);
  // 1 h in court on a 3 h minimum at 1.5x, $45: 3 x 45 x 1.5 = 202.50 (logged at actual: 67.50)
  ok('events: court 1 h worked, 3 h minimum, 1.5x pays 3 h', g(45, ev(1, { isOvertime: true, minHours: 3, payEvent: 'court' })) === 202.5,
    String(g(45, ev(1, { isOvertime: true, minHours: 3, payEvent: 'court' }))));
  // Portland court, 5 h minimum (43.6.4): 5 x 45 x 1.5 = 337.50
  ok('events: Portland court, 5 h minimum', g(45, ev(1, { isOvertime: true, minHours: 5, payEvent: 'court' })) === 337.5);
  // Cleveland call-in, 4 h minimum (10 ¶14f), 2 h worked at $40: 4 x 40 x 1.5 = 240.00
  ok('events: Cleveland call-in, 4 h minimum, 2 h worked', g(40, ev(2, { isOvertime: true, minHours: 4, payEvent: 'callback' })) === 240);
  // Philadelphia court at 2.5x, 2 h minimum, 1 h worked, $44.52: 2 x 44.52 x 2.5 = 222.60
  ok('events: Philadelphia court at 2.5x', g(44.52, ev(1, { isOvertime: true, otMult: 2.5, minHours: 2, payEvent: 'court' })) === 222.6,
    String(g(44.52, ev(1, { isOvertime: true, otMult: 2.5, minHours: 2, payEvent: 'court' }))));
  // worked past the minimum: 5 h on a 3 h minimum pays the 5 h, 5 x 45 x 1.5 = 337.50
  ok('events: hours worked past the minimum are paid as worked', g(45, ev(5, { isOvertime: true, minHours: 3 })) === 337.5);
  // a minimum at straight time (not marked overtime): 4 x 40 = 160
  ok('events: a minimum at straight time', g(40, ev(1, { minHours: 4, payEvent: 'callback' })) === 160);
  // the multiplier alone: 12 h at 2x, $50 + $5 night = 12 x 55 x 2 = 1320
  ok('events: 2x on the differential-inclusive rate', C.shiftGross(50, flat5, { hours: 12, bonusType: 'none', isOvertime: true, otMult: 2 }) === 1320);
  // per-hour add-ons stay on hours worked: court 1 h on 3 h min + charge $3/h = 202.50 + 3 = 205.50
  ok('events: a per-hour add-on is paid on hours worked, not the minimum',
    g(45, ev(1, { isOvertime: true, minHours: 3, bonusType: 'charge' })) === 205.5);
  // otMult without isOvertime does nothing: 12 x 50 = 600
  ok('events: a multiplier on an unmarked shift is ignored', g(50, ev(12, { otMult: 2.5 })) === 600);
  // out-of-range multipliers read as 1.5 at price time, too (the draft is unsanitized)
  ok('events: an out-of-range multiplier prices as 1.5x', [1.2, 4.5, 'x', NaN, -2].every((m) => g(50, ev(12, { isOvertime: true, otMult: m })) === 900));
  ok('events: the top-up figure is the minimum beyond hours worked (202.50 - 67.50)',
    C.minimumTopUpCents(4500, null, ev(1, { isOvertime: true, minHours: 3 })) === 13500
    && C.minimumTopUpCents(4500, null, ev(5, { isOvertime: true, minHours: 3 })) === 0
    && C.minimumTopUpCents(4500, null, ev(1, { isOvertime: true })) === 0);

  /* (b) 29 CFR 778.221(b)'s own week: $12/h, overtime past 40, 8 h Mon-Fri, 1 h overtime Monday,
     then a call-back on Friday: 2 h worked on a 3 h minimum at time and one-half. "the 43 actual
     hours (not 44) are counted as working time". Pay: 480 + 18 + 54 = $552, no further premium. */
  const mon = ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'];
  const cfrWeek = (markMonday) => {
    const sh = {};
    mon.slice(0, 5).forEach((k) => { sh[k] = [ev(8)]; });
    sh[mon[0]].push(ev(1, { isOvertime: markMonday }));
    sh[mon[4]].push(ev(2, { isOvertime: true, minHours: 3, payEvent: 'callback' }));
    return sh;
  };
  const cfrJob = C.makeJob({ id: 'job-1', baseRate: 12, differentials: {}, workPeriod: '40' });
  const t0 = { ficaType: 'none', federalTaxRate: 0, stateTaxRate: 0, pretaxDeductions: 0, posttaxDeductions: 0, customWithholdings: [] };
  const run = (sh) => C.periodPaycheck({ shifts: sh, dayEvents: {}, dateKeys: mon, baseRate: 12, differentials: {}, taxInputs: t0, job: cfrJob });
  const a = run(cfrWeek(true));
  ok('events (b): 778.221(b) week — $552, 43 hours, no derived premium',
    a.gross === 552 && a.hours === 43 && a.ot.premiumCents === 0 && a.ot.otHours === 0, JSON.stringify([a.gross, a.hours, a.ot.premiumCents]));
  // 778.221(b): "plus an extra sum of $18 paid by reason of the provision for minimum call-back pay"
  ok('events (b): the call-back minimum shows as the regulation\'s $18 extra sum, on one shift',
    a.minTopUp.cents === 1800 && a.minTopUp.shifts === 1, JSON.stringify(a.minTopUp));
  /* Same week with Monday's extra hour left unmarked: 43 h worked, 2 marked, so 1 derived hour,
     at half the regular rate. The regular rate is 516 / 43 = $12.00 -> premium $6.00. Counting the
     unworked hour would make it 2 derived hours ($12); putting the $12 top-up in the regular rate
     would make it 528 / 43 / 2 = $6.14. */
  const b = run(cfrWeek(false));
  ok('events (b): with a derived hour, premium is exactly $6.00 at a $12.00 regular rate',
    b.ot.premiumCents === 600 && b.ot.otHours === 1 && b.ot.periods[0].regularRateCents === 1200,
    JSON.stringify([b.ot.premiumCents, b.ot.otHours, b.ot.periods[0] && b.ot.periods[0].regularRateCents]));

  /* (c) a 2.5x hour is never also given a derived premium: four 10 h days + one 12 h shift marked
     2.5x = 52 h under the 40-hour week. 40 x 45 + 12 x 45 x 2.5 = 1800 + 1350 = 3150, premium 0. */
  const cj = C.makeJob({ id: 'job-1', baseRate: 45, differentials: {}, workPeriod: '40' });
  const csh = {}; mon.slice(0, 4).forEach((k) => { csh[k] = [ev(10)]; }); csh[mon[4]] = [ev(12, { isOvertime: true, otMult: 2.5 })];
  const c = C.periodPaycheck({ shifts: csh, dayEvents: {}, dateKeys: mon, baseRate: 45, differentials: {}, taxInputs: t0, job: cj });
  ok('events (c): a 2.5x shift in a 52 h week adds no derived premium for its hours',
    c.gross === 3150 && c.ot.premiumCents === 0, JSON.stringify([c.gross, c.ot.premiumCents]));

  /* The sanitizer: shifts, templates and pattern cells. Out of range is DROPPED, never clamped. */
  const sh1 = (x) => C.sanitizeData({ shifts: { '2026-10-05': [{ ...ev(1), ...x }] } }).shifts['2026-10-05'][0];
  const k1 = sh1({ isOvertime: true, otMult: 2.5, minHours: '3', payEvent: 'court' });
  ok('sanitize events: keeps an in-range multiplier, minimum (string coerced) and kind',
    k1.otMult === 2.5 && k1.minHours === 3 && k1.payEvent === 'court', JSON.stringify(k1));
  ok('sanitize events: rounds to 2 dp', sh1({ isOvertime: true, otMult: 1.8749, minHours: 2.333 }).otMult === 1.87
    && sh1({ minHours: 2.333 }).minHours === 2.33);
  ok('sanitize events: drops a multiplier on an unmarked shift', !('otMult' in sh1({ isOvertime: false, otMult: 2 })));
  ok('sanitize events: drops a multiplier at or below 1.5, above 4, or junk',
    [1.5, 1.2, 0, 4.01, 'abc', NaN, Infinity, null].every((m) => !('otMult' in sh1({ isOvertime: true, otMult: m }))));
  ok('sanitize events: keeps 4x, the top of the range', sh1({ isOvertime: true, otMult: 4 }).otMult === 4);
  ok('sanitize events: drops a minimum at or below 0, above 24, or junk',
    [0, -3, 24.5, 'abc', NaN, Infinity].every((h) => !('minHours' in sh1({ minHours: h }))));
  ok('sanitize events: drops an unknown kind', ['police', 'Court', 1, null].every((k) => !('payEvent' in sh1({ payEvent: k }))));
  ok('sanitize events: a shift without the fields gains none',
    ['otMult', 'minHours', 'payEvent'].every((f) => !(f in sh1({ isOvertime: true }))));
  const tp = C.sanitizeData({ templates: [{ id: 't1', name: 'Court', shiftType: 'base', hours: 1, bonusType: 'none', isOvertime: true, otMult: 2.5, minHours: 3, payEvent: 'court' },
    { id: 't2', name: 'Bad', shiftType: 'base', hours: 1, bonusType: 'none', isOvertime: false, otMult: 2.5, minHours: 99, payEvent: 'x' }] }).templates;
  ok('sanitize events: templates carry the three fields, and drop bad ones',
    tp[0].otMult === 2.5 && tp[0].minHours === 3 && tp[0].payEvent === 'court'
    && !('otMult' in tp[1]) && !('minHours' in tp[1]) && !('payEvent' in tp[1]), JSON.stringify(tp));
  const pc = C.sanitizeData({ patterns: [{ id: 'p', name: 'x', anchor: '2026-10-05',
    cells: [{ kind: 'fixed', shiftType: 'base', hours: 1, isOvertime: true, otMult: 2.5, minHours: 2 }, null] }] }).patterns[0].cells[0];
  ok('sanitize events: pattern cells carry the multiplier and minimum', pc.otMult === 2.5 && pc.minHours === 2, JSON.stringify(pc));
  const cs = C.patternCellToShift(pc, new Date(2026, 9, 5), {});
  ok('events: a painted cell prices like its template (2 h x 44.52 x 2.5 = 222.60)', C.shiftGross(44.52, null, cs) === 222.6, JSON.stringify(cs));

  /* Identity: shifts without the fields price exactly as the pre-change module did. Literals
     captured from 81c1954's extracted core (the deployed build) by running the same fixtures. */
  const idDiffs = { base: { type: 'dollar', amount: 0 }, night: { type: 'dollar', amount: 5 }, pct: { type: 'percent', amount: 10 }, mult: { type: 'multiplier', amount: 1.25 } };
  const S = [
    { shiftType: 'night', hours: 12, bonusType: 'none', isOvertime: true },
    { shiftType: 'pct', hours: 8.5, bonusType: 'charge', isOvertime: true },
    { shiftType: 'mult', hours: 12, bonusType: 'custom', customBonus: '75', isOvertime: false, noMeal: true },
    { shiftType: 'base', hours: 1, bonusType: 'preceptor', isOvertime: true },
    { shiftType: 'night', hours: 16, bonusType: 'oncall', isOvertime: false },
  ];
  const meal = C.makeJob({ mealBreakMins: 30, mealBreakMode: 'deducted' });
  const gotS = JSON.stringify(S.map((x) => [C.shiftGross(47.13, idDiffs[x.shiftType], x), C.shiftGross(47.13, idDiffs[x.shiftType], x, meal)]));
  ok('events identity: five shifts without the fields, with and without a meal rule', gotS === '[[938.34,899.24],[686.5,646.12],[781.95,781.95],[72.7,36.35],[914.08,885.52]]', gotS);
  const idTax = { ficaType: 'standard', ficaPct: '', federalTaxRate: 12, stateTaxRate: 3.07, pretaxDeductions: 120, posttaxDeductions: 15, customWithholdings: [] };
  const idKeys = Array.from({ length: 14 }, (_, i) => `2026-10-${String(4 + i).padStart(2, '0')}`);
  const idSh = {}; idKeys.forEach((k, i) => { if (i % 7 !== 3) idSh[k] = [{ ...S[i % 5], id: i }]; });
  const WANT = { '40': [8374.08, 6354.57, 121, 3011, 1], '8-80': [8343.97, 6331.3, 121, 0, 0], flagged: [8343.97, 6331.3, 121, 0, 0], custom: [8343.97, 6331.3, 121, 0, 0] };
  const movedP = Object.keys(WANT).filter((wp) => {
    const j = C.makeJob({ baseRate: 47.13, differentials: idDiffs, workPeriod: wp, otPeriodDays: 14, otPeriodHours: 86, mealBreakMins: 30 });
    const r = C.periodPaycheck({ shifts: idSh, dayEvents: {}, dateKeys: idKeys, baseRate: 47.13, differentials: idDiffs, taxInputs: idTax, job: j });
    return JSON.stringify([r.gross, r.net, r.hours, r.ot.premiumCents, r.ot.otHours]) !== JSON.stringify(WANT[wp]) || r.minTopUp.cents !== 0;
  });
  ok('events identity: a fortnight without the fields, under all four work periods', movedP.length === 0, movedP.join(','));
}

console.log(`\n==== core: ${pass} passed / ${fail} failed ====`);
process.exit(fail ? 1 : 0);
