#!/usr/bin/env node
/* Fold the source-of-truth track-name inventory into a SQL snapshot.
 *
 *   node scripts/dashboard_snapshot.mjs sql-result.json > snapshot.json
 *   cat sql-result.json | node scripts/dashboard_snapshot.mjs > snapshot.json
 *
 * The database can only tell you which events HAVE fired. The interesting question is the
 * opposite one — which instrumented events have never fired at all, because that is where a
 * shipped feature nobody has touched shows up. That answer lives in index.html, not Postgres,
 * so it is computed here and merged in.
 *
 * Input: whatever scripts/dashboard_snapshot.sql returned. Accepts the bare object, a
 * {snapshot:...} wrapper, or an array of either — the MCP tool and the Management API disagree
 * about the envelope, so normalize rather than making the caller care.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* ---- the instrumented surface ------------------------------------------------------------
 * Every event name the app can file. Read as an AST, and the difference from a grep is not
 * stylistic: this list is the whole basis of `dead_events`, i.e. "which shipped feature has
 * nobody touched", so a name it cannot see is a feature this tool reports on as if it had no
 * telemetry at all.
 *
 * The regex this replaced (2026-11-09) was /track\('([a-z_]+)'/ — a name had to be a bare
 * string literal spelled immediately after `track(`. By tonight the app had FOUR shapes it
 * could not see, and the production `events` table proves every one of them:
 *
 *   track(verb==='removed' ? 'rate_change_removed' : 'rate_change_added', …)  #187, 2026-10-20
 *   track(verb==='removed' ? 'pay_item_removed'    : 'pay_item_added',    …)  #191, 2026-11-01
 *   trackOb('ob_view' / 'ob_answer' / 'ob_back', …)                           #167, 2026-10-10
 *   beaconInsert([eventRow('session_end', …)])                                the unload beacon
 *
 * `ob_view` (79 rows), `ob_answer` (27), `ob_back` (1) and `session_end` (148) have all fired in
 * production while sitting outside the inventory, so `fired_count` under-reported by four. The
 * other direction is worse: the four `rate_change_*` / `pay_item_*` names have **zero** rows,
 * which makes them exactly what `dead_events` exists to print — the telemetry of the two newest
 * money features (the raise, and dated pay items) — and the list could never contain them.
 * BACKLOG.md asked "did she use the fix for the most wrong-money complaint in this file" for six
 * nights; the tool built to answer it was structurally blind to the answer.
 *
 * Rules, each one load-bearing:
 *  - FOUR callees count, because four functions reach the `events` table: `track`, `trackOb`
 *    (the onboarding whitelist wrapper), `trackDeferred` (the pending-events queue) and
 *    `eventRow` (the keepalive beacon's row builder — `session_end` rides only this).
 *  - A first argument that is a conditional or a `||` chain contributes EVERY branch, recursively.
 *  - A first argument that is a plain identifier or member expression is a FORWARDER, not a name
 *    (`track(name, …)` inside trackOb, `eventRow(name, …)` inside track): counted, never listed.
 *  - Any OTHER shape THROWS. That is the point of rewriting this at all — the failure mode being
 *    fixed is a cheap scan that quietly under-reports, so a shape this cannot resolve must stop
 *    the snapshot rather than shrink the list by one.
 *  - A resolved name must be coarse snake_case (CLAUDE.md → Analytics) or it throws.
 *  - No Babel available throws too. There is deliberately no regex fallback: a fallback that
 *    silently produces the old short list is the bug.
 */
const TRACK_CALLEES = new Set(['track', 'trackOb', 'trackDeferred', 'eventRow']);
const EVENT_NAME_RE = /^[a-z][a-z0-9_]*$/;
const BABEL_BLOCK = '<script type="text/babel" data-presets="react">';

function jsxBlock(html) {
  const open = html.indexOf(BABEL_BLOCK);
  if (open < 0) throw new Error(`dashboard_snapshot: no ${BABEL_BLOCK} in index.html — an empty inventory would read as "nothing is instrumented", which is worse than wrong`);
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  if (end < 0) throw new Error('dashboard_snapshot: the text/babel block is unterminated');
  return html.slice(start, end);
}

/* @babel/standalone is the build index.html itself loads, so the parser reading these call sites
   is the parser that transforms them in the browser. @babel/parser is an equivalent fallback. */
function parseJsx(src) {
  let standalone = null;
  try { standalone = require('@babel/standalone'); } catch { /* fall through */ }
  if (standalone) return standalone.transform(src, { sourceType: 'script', presets: ['react'], code: false, ast: true }).ast;
  let parser = null;
  try { parser = require('@babel/parser'); } catch { /* fall through */ }
  if (parser) return parser.parse(src, { sourceType: 'script', plugins: ['jsx'], errorRecovery: false });
  throw new Error('dashboard_snapshot: no Babel available — run: npm install --no-save @babel/standalone@7.24.7');
}

/* A generic walk rather than @babel/traverse: it works identically on either parser's output. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walk(child, visit); return; }
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    walk(node[key], visit);
  }
}

const FORWARDER = Symbol('forwarder');

function namesIn(arg, where) {
  if (!arg) throw new Error(`dashboard_snapshot: a tracking call with no event name at ${where}`);
  if (arg.type === 'StringLiteral') return [arg.value];
  if (arg.type === 'Literal' && typeof arg.value === 'string') return [arg.value];
  if (arg.type === 'ConditionalExpression') return [...namesIn(arg.consequent, where), ...namesIn(arg.alternate, where)];
  if (arg.type === 'LogicalExpression') return [...namesIn(arg.left, where), ...namesIn(arg.right, where)];
  if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) return [arg.quasis.map((q) => q.value.cooked).join('')];
  if (arg.type === 'Identifier' || arg.type === 'MemberExpression') return [FORWARDER];
  throw new Error(`dashboard_snapshot: cannot resolve the event name of a tracking call at ${where} (first argument is a ${arg.type}). Resolve it statically or teach namesIn() the shape — do NOT let the inventory lose a name silently.`);
}

/* Both halves of what the walk found, so a test can assert the forwarders were recognised AS
   forwarders rather than merely absent from the names. */
export function trackCallSites(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  const ast = parseJsx(jsxBlock(html));
  const names = new Set();
  let forwarders = 0, calls = 0;
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (!callee || callee.type !== 'Identifier' || !TRACK_CALLEES.has(callee.name)) return;
    calls += 1;
    const where = `${callee.name}() line ${(node.loc && node.loc.start.line) || '?'}`;
    for (const n of namesIn(node.arguments[0], where)) {
      if (n === FORWARDER) { forwarders += 1; continue; }
      if (!EVENT_NAME_RE.test(n)) throw new Error(`dashboard_snapshot: '${n}' at ${where} is not a coarse snake_case event name (CLAUDE.md -> Analytics)`);
      names.add(n);
    }
  });
  if (!names.size) throw new Error('dashboard_snapshot: found no event names at all — the inventory is the basis of dead_events, so an empty one must fail rather than report "nothing is instrumented"');
  return { names: [...names].sort(), forwarders, calls };
}

/* Every event name the app can file, which is the full instrumented surface. */
export function instrumentedEvents(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  return trackCallSites(html).names;
}

const read = (p) => JSON.parse(p ? readFileSync(p, 'utf8') : readFileSync(0, 'utf8'));

/* The two queries can be handed over separately or already merged; flatten either way. */
function normalize(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw]).map((r) => r?.snapshot ?? r?.rest ?? r);
  return Object.assign({}, ...parts);
}

function build(raw) {
  const snap = normalize(raw);
  const sites = trackCallSites();
  const instrumented = sites.names;
  const fired = new Set((snap.adoption || []).map((a) => a.name));

  /* health_check rows are owner probes, not an app event — exclude from "never fired". */
  const dead = instrumented.filter((n) => !fired.has(n));

  return {
    ...snap,
    instrumented,
    dead_events: dead,
    instrumented_count: instrumented.length,
    /* Relay call sites whose name is an identifier (trackOb -> track -> eventRow). They carry no
       name of their own, so they are counted rather than listed: the number moving means someone
       added a new routing layer, which is the one change that could hide a name from the list. */
    instrumented_forwarders: sites.forwarders,
    fired_count: instrumented.filter((n) => fired.has(n)).length,
    built_at: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(build(read(process.argv[2])), null, 2) + '\n');
}
export { build };
