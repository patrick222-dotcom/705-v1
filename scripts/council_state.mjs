#!/usr/bin/env node
/* council_state.mjs — the council's durable state lives in git, not in a container.
 *
 * A full council run does not fit one usage window, and the session container that holds the
 * workflow cache is reclaimed between firings, so every stage's output is written into a run
 * directory (docs/council-runs/<date>/) and the next batch is built from those files:
 *
 *   node scripts/council_state.mjs args    --run docs/council-runs/2026-09-13 --upTo 1
 *       -> JSON for Workflow({scriptPath:'.claude/workflows/council.mjs', args:<that>})
 *   node scripts/council_state.mjs persist --run docs/council-runs/2026-09-13 --result <file>
 *       -> folds a batch's return value (the .output JSON, or a bare result) into the run dir
 *   node scripts/council_state.mjs status  --run docs/council-runs/2026-09-13
 *       -> counts by lens: raw, merged, confirmed / rejected / unverified, scores
 *
 * Layout of a run dir:
 *   reviews.json      {"lens:slice": {lens, slice, findings[], ranAgainst}}   every review cell
 *   raw/<lens>.json   that lens's raw findings, for the dedup agent to read
 *   dedups.json       {lens: {findings: [{id, title, severity, where, ..., slices}], merged}}
 *   findings/<id>.json  one merged finding each, for refuters and scorers to read
 *   verdicts.json     {"<id>#<angle>": {refuted, why}}
 *   scores.json, synthesis.md, confirmed.json, ranAgainst.json, status.md
 *
 * Batches (docs/council.md -> Running it): '1' = dedup + refute every critical/high;
 * '2a' = refute mediums in the money/anonymity/data lenses; '2b' = the other mediums;
 * '3' = score + synthesize. Lows are never agent-verified. `upTo` is cumulative; anything
 * already on file is skipped, so a batch only pays for its own work.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/* Mirrors LENSES/SLICES in .claude/workflows/council.mjs — only the shape is needed here. */
const LENS_SLICES = {
  'wage-math': ['wage-core','money-surfaces','pattern-lab','add-shift'],
  security: ['swap-board','data-sync','calendar-sync','telemetry-auth','infra'],
  'mobile-ux': ['money-surfaces','calendar','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
  accessibility: ['money-surfaces','calendar','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
  performance: ['boot','calendar','pattern-lab','data-sync'],
  'data-integrity': ['wage-core','data-sync','calendar-sync','infra'],
  'code-quality': ['boot','wage-core','money-surfaces','calendar','add-shift','pattern-lab','onboarding','settings-etc','swap-board','data-sync','calendar-sync','telemetry-auth','infra'],
  'product-design': ['money-surfaces','add-shift','pattern-lab','onboarding','settings-etc','swap-board'],
  'privacy-telemetry': ['calendar-sync','telemetry-auth','infra'],
  'cross-surface': ['wage-core','money-surfaces','pattern-lab'],
};
const LENSES = Object.keys(LENS_SLICES);
const CELLS = LENSES.flatMap((l) => LENS_SLICES[l].map((s) => `${l}:${s}`));

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const run = opt('--run');
if (!cmd || !run) { console.error('usage: council_state.mjs <args|persist|status> --run <dir> [--upTo b] [--result file]'); process.exit(2); }

const readJson = (p, d) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d);
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 1) + '\n');
const P = (f) => join(run, f);

/* Same rule as the workflow: two live verdicts minimum; a majority of live votes refutes. */
export function statusOf(verdicts, id) {
  const live = [0, 1, 2].map((a) => verdicts[`${id}#${a}`]).filter(Boolean);
  if (live.length < 2) return 'unverified';
  const refuted = live.filter((v) => v.refuted).length;
  return refuted * 2 >= live.length ? 'rejected' : 'confirmed';
}

function loadState() {
  const reviews = readJson(P('reviews.json'), {});
  const dedups = readJson(P('dedups.json'), {});
  const verdicts = readJson(P('verdicts.json'), {});
  const scores = readJson(P('scores.json'), null);
  return { reviews, dedups, verdicts, scores };
}

/* Derived files that other stages read. Regenerated on every persist so they never go stale. */
function writeDerived({ reviews, dedups, verdicts }) {
  mkdirSync(P('raw'), { recursive: true });
  mkdirSync(P('findings'), { recursive: true });
  const ranAgainst = {};
  for (const lens of LENSES) {
    const cells = Object.values(reviews).filter((r) => r.lens === lens);
    if (cells.length) writeJson(P(`raw/${lens}.json`), cells.map((c) => ({ slice: c.slice, findings: c.findings })));
    for (const c of cells) ranAgainst[`${c.lens}:${c.slice}`] = c.ranAgainst;
  }
  writeJson(P('ranAgainst.json'), ranAgainst);
  const confirmed = [];
  for (const lens of LENSES) {
    for (const f of (dedups[lens]?.findings || [])) {
      writeJson(P(`findings/${f.id}.json`), f);
      const status = statusOf(verdicts, f.id);
      if (status === 'confirmed') {
        const votes = [0, 1, 2].map((a) => verdicts[`${f.id}#${a}`]).filter(Boolean);
        confirmed.push({ ...f, lens, status, dissent: votes.filter((v) => v.refuted).map((v) => v.why) });
      }
    }
  }
  writeJson(P('confirmed.json'), confirmed);
  /* index.json: one compact row per merged finding, with its current status -- what the scorers
     read for titles and locations, so the workflow args stay small. */
  const index = [];
  for (const lens of LENSES) for (const f of (dedups[lens]?.findings || []))
    index.push({ id: f.id, lens, severity: f.severity, wageCore: !!f.wageCore, title: f.title, where: f.where,
      status: f.severity === 'low' ? 'low-unverified' : statusOf(verdicts, f.id) });
  writeJson(P('index.json'), index);
}

function summarize({ reviews, dedups, verdicts, scores }) {
  const rows = [];
  for (const lens of LENSES) {
    const cells = Object.values(reviews).filter((r) => r.lens === lens);
    const raw = cells.reduce((n, c) => n + c.findings.length, 0);
    const merged = dedups[lens]?.findings || [];
    const st = { confirmed: 0, rejected: 0, unverified: 0, low: 0 };
    for (const f of merged) { if (f.severity === 'low') { st.low++; continue; } st[statusOf(verdicts, f.id)]++; }
    const sc = scores && scores.find((s) => s.lens === lens);
    rows.push({ lens, cells: `${cells.length}/${LENS_SLICES[lens].length}`, raw, merged: dedups[lens] ? merged.length : '-', ...st, score: sc ? sc.score : '-' });
  }
  return rows;
}

if (cmd === 'args') {
  const upTo = opt('--upTo', '1');
  const { reviews, dedups, verdicts } = loadState();
  const haveReviews = CELLS.every((c) => reviews[c]);
  const unreviewed = CELLS.filter((c) => !reviews[c]);
  const rawCounts = Object.fromEntries(LENSES.map((l) => [l, Object.values(reviews).filter((r) => r.lens === l).reduce((n, c) => n + c.findings.length, 0)]));
  /* Compact on purpose: a full index with titles and locations is ~50KB, which is too large to pass
     as Workflow args by hand. Refuters and scorers read findings/<id>.json and index.json instead. */
  const index = Object.fromEntries(Object.entries(dedups).map(([lens, d]) => [lens,
    d.findings.map(({ id, severity, wageCore }) => ({ id, severity, wageCore }))]));
  const flags = Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, !!v.refuted]));
  process.stdout.write(JSON.stringify({ runDir: run, upTo, haveReviews, unreviewed, rawCounts, dedups: index, verdicts: flags }) + '\n');
}

else if (cmd === 'persist') {
  const file = opt('--result');
  if (!file) { console.error('--result <file> required'); process.exit(2); }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const res = raw.result && typeof raw.result === 'object' && !raw.findings ? raw.result : raw;
  const state = loadState();
  let n = { reviews: 0, dedups: 0, verdicts: 0 };
  if (res.reviews) for (const [label, r] of Object.entries(res.reviews)) { if (r) { state.reviews[label] = r; n.reviews++; } }
  if (res.dedups) for (const [lens, d] of Object.entries(res.dedups)) { if (d) { state.dedups[lens] = d; n.dedups++; } }
  if (res.verdicts) for (const [k, v] of Object.entries(res.verdicts)) { if (v) { state.verdicts[k] = v; n.verdicts++; } }
  if (res.scores && res.scores.length) { state.scores = res.scores; writeJson(P('scores.json'), res.scores); }
  if (res.synthesis) writeFileSync(P('synthesis.md'), String(res.synthesis) + '\n');
  writeJson(P('reviews.json'), state.reviews);
  writeJson(P('dedups.json'), state.dedups);
  writeJson(P('verdicts.json'), state.verdicts);
  writeDerived(state);
  const rows = summarize(state);
  writeFileSync(P('status.md'), '| lens | cells | raw | merged | confirmed | rejected | unverified | low (not verified) | score |\n|---|---|---|---|---|---|---|---|---|\n' +
    rows.map((r) => `| ${r.lens} | ${r.cells} | ${r.raw} | ${r.merged} | ${r.confirmed} | ${r.rejected} | ${r.unverified} | ${r.low} | ${r.score} |`).join('\n') + '\n');
  console.log(`persisted: +${n.reviews} reviews, +${n.dedups} dedups, +${n.verdicts} verdicts` + (res.scores ? ', scores' : '') + (res.synthesis ? ', synthesis' : ''));
  console.table(rows);
}

else if (cmd === 'status') {
  const state = loadState();
  writeDerived(state);
  console.table(summarize(state));
}

else { console.error(`unknown command ${cmd}`); process.exit(2); }
