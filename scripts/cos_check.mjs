#!/usr/bin/env node
/* The operating committee's caps (docs/leadership.md), held mechanically.
 *
 * The structure's most likely failure is that it regrows the sprawl it exists to remove: a fourth
 * thread "just for now", a seat queue that quietly reaches twenty, a brief that becomes a report.
 * Prose caps lost that fight once already (BACKLOG.md reached 4,200 lines), so these fail CI.
 *
 *   node scripts/cos_check.mjs [root]     exits 1 with one line per broken cap
 *
 * check_build.mjs imports cosViolations() so the deploy gate holds the caps too. The optional root
 * exists so the caps can be negative-tested against a scratch copy, never the working tree.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const CAPS = { threads: 3, decisions: 3, seatQueue: 5, briefLines: 40 };
export const SEATS = ['cto', 'coo', 'risk', 'cfo'];

// Lines between `## <heading>` and the next `## `.
const section = (md, heading) => {
  const m = md.match(new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : null;
};

export function cosViolations(root) {
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null);
  const out = [];

  const now = read('docs/cos/now.md');
  if (now == null) return ['docs/cos/now.md is missing'];
  const threads = section(now, 'Threads');
  if (threads == null) out.push('now.md has no "## Threads" section');
  else {
    const n = (threads.match(/^### /gm) || []).length;
    if (n > CAPS.threads) out.push(`now.md has ${n} threads (cap ${CAPS.threads}) — park one or propose a swap`);
  }
  const needs = section(now, 'Needs Pat');
  if (needs == null) out.push('now.md has no "## Needs Pat" section');
  else {
    const n = (needs.match(/^- /gm) || []).length;
    if (n > CAPS.decisions) out.push(`now.md has ${n} open decisions (cap ${CAPS.decisions}) — the rest wait`);
  }

  for (const seat of SEATS) {
    const md = read(`docs/cos/seats/${seat}.md`);
    if (md == null) { out.push(`docs/cos/seats/${seat}.md is missing`); continue; }
    const q = section(md, 'Queue \\(max 5\\)');
    if (q == null) { out.push(`${seat}.md has no "## Queue (max 5)" section`); continue; }
    const n = (q.match(/^\d+\. /gm) || []).length;
    if (n > CAPS.seatQueue) out.push(`${seat}.md queue has ${n} items (cap ${CAPS.seatQueue}) — park one`);
  }

  const brief = read('docs/cos/brief.md');
  if (brief == null) out.push('docs/cos/brief.md is missing');
  else {
    const n = brief.trimEnd().split('\n').length;
    if (n > CAPS.briefLines) out.push(`brief.md is ${n} lines (cap ${CAPS.briefLines}) — one screen`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
  const v = cosViolations(root);
  if (v.length) { for (const l of v) console.error(`✗ ${l}`); process.exit(1); }
  console.log('✓ operating-committee caps hold');
}
