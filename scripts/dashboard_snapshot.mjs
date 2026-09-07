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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Every track('name') call site in the app, which is the full instrumented surface. */
export function instrumentedEvents(html = readFileSync(join(ROOT, 'index.html'), 'utf8')) {
  return [...new Set([...html.matchAll(/track\('([a-z_]+)'/g)].map((m) => m[1]))].sort();
}

const read = (p) => JSON.parse(p ? readFileSync(p, 'utf8') : readFileSync(0, 'utf8'));

/* The two queries can be handed over separately or already merged; flatten either way. */
function normalize(raw) {
  const parts = (Array.isArray(raw) ? raw : [raw]).map((r) => r?.snapshot ?? r?.rest ?? r);
  return Object.assign({}, ...parts);
}

function build(raw) {
  const snap = normalize(raw);
  const instrumented = instrumentedEvents();
  const fired = new Set((snap.adoption || []).map((a) => a.name));

  /* health_check rows are owner probes, not an app event — exclude from "never fired". */
  const dead = instrumented.filter((n) => !fired.has(n));

  return {
    ...snap,
    instrumented,
    dead_events: dead,
    instrumented_count: instrumented.length,
    fired_count: instrumented.filter((n) => fired.has(n)).length,
    built_at: new Date().toISOString(),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(build(read(process.argv[2])), null, 2) + '\n');
}
export { build };
