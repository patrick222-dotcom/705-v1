#!/usr/bin/env node
/* Mechanical gate for the invariants in CLAUDE.md.
 *
 * There is no build step and no test stage on the deploy path: deploy.yml copies three files to
 * GitHub Pages, so a JSX syntax error reaches production in about ninety seconds. This script is
 * the door lock. It runs in CI on every pull request and, deliberately, runs identically on a
 * developer's machine — a gate whose result cannot be reproduced outside the harness that reports
 * it is not a gate.
 *
 *   node scripts/check_build.mjs
 *
 * Scope: only what a machine can check honestly. Invariants 3 (wage-core), 10 (fetch before
 * touching the deploy branch), 11 (protected branches) and 12 (registrar settings) are human
 * disciplines and are listed as UNCHECKED in the output rather than silently omitted.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const html = read('index.html');
const deploy = read('.github/workflows/deploy.yml');

const results = [];
const check = (invariant, label, fn) => {
  try {
    const detail = fn();
    results.push({ ok: true, invariant, label, detail: detail || '' });
  } catch (e) {
    results.push({ ok: false, invariant, label, detail: e.message });
  }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

/* ---- the one that actually stops a bad deploy: does the JSX parse? ---------------------- */
check('build', 'JSX block parses', () => {
  const open = html.indexOf('<script type="text/babel" data-presets="react">');
  must(open !== -1, 'could not find the Babel <script> block');
  const start = html.indexOf('>', open) + 1;
  const end = html.indexOf('</script>', start);
  must(end !== -1, 'Babel <script> block is not closed');
  const src = html.slice(start, end);
  must(src.length > 10000, `Babel block is only ${src.length} bytes — extraction is wrong`);

  /* Prefer @babel/standalone: it is the exact build index.html loads from unpkg, so the parser
     gating the JSX here is the parser that will transform it in the browser — no version drift to
     reason about. @babel/parser is an equivalent fallback. Never pass silently when neither is
     present: a gate that reports success because it could not run is worse than no gate. */
  let parsed = false;
  try {
    const Babel = require('@babel/standalone');
    Babel.transform(src, { presets: ['react'], sourceType: 'script', code: false, ast: false });
    parsed = 'standalone';
  } catch (e) {
    if (!/Cannot find module/.test(e.message)) throw e;
    try {
      require('@babel/parser').parse(src, { sourceType: 'script', plugins: ['jsx'], errorRecovery: false });
      parsed = 'parser';
    } catch (e2) {
      if (!/Cannot find module/.test(e2.message)) throw e2;
      throw new Error('no Babel available — run: npm install --no-save @babel/standalone@7.24.7');
    }
  }
  return `${src.length.toLocaleString()} bytes, ${src.split('\n').length.toLocaleString()} lines (via @babel/${parsed})`;
});

/* ---- Invariant 1: boot hardening ------------------------------------------------------- */
check(1, 'Boot hardening intact', () => {
  must(html.includes('window.__bootError'), 'boot watchdog error capture (__bootError) is gone');
  must(/\}, 8000\);/.test(html), '8s boot watchdog timer is gone');
  must(/window\.supabase && window\.supabase\.createClient/.test(html),
    'Supabase client creation is no longer null-guarded — the app will hard-fail when the CDN does');
  must(/withTimeout\(\s*supabase\.auth\.getSession\(\)\s*,\s*4000/.test(html),
    'getSession() is no longer raced against a 4s timeout (WebKit deadlock -> iPhone spinner)');
  must(html.includes('window.__logClientError'), 'client error ring buffer is gone');
  return 'watchdog + null-guard + 4s getSession race + error buffer';
});

/* ---- Invariant 2: SRI on all five CDN scripts ------------------------------------------ */
check(2, 'SRI on all 5 CDN scripts', () => {
  const n = (html.match(/integrity="sha384-/g) || []).length;
  must(n === 5, `expected 5 integrity="sha384-" attributes, found ${n}`);
  const unpinned = html.match(/<script[^>]+src="https:\/\/[^"]*@latest[^"]*"/g);
  must(!unpinned, `CDN script pinned to @latest: ${unpinned && unpinned[0]}`);
  return '5/5 pinned + hashed';
});

/* ---- Invariant 4: the upsert that silently broke sync for 47 days ---------------------- */
check(4, "saveToSupabase upserts on {onConflict:'user_id'}", () => {
  must(/\.upsert\(\s*\{\s*user_id:\s*userId,\s*data,[^)]*\},\s*\{onConflict:'user_id'\}\s*\)/.test(html),
    "the user_data upsert lost {onConflict:'user_id'} — every save after the first will 23505");
  return 'present';
});

/* ---- Invariant 5: storage keys are data, not branding ---------------------------------- */
check(5, 'Storage keys unrenamed', () => {
  const keys = ['nursingWagePlannerData', 'scrubpay_anon_id', 'scrubpay_feedback_pending',
    'scrubpay_pending_invite', 'scrubpayErrors'];
  const missing = keys.filter(k => !html.includes(k));
  must(!missing.length, `renaming orphans user data / severs analytics joins: ${missing.join(', ')}`);
  return `${keys.length}/${keys.length} intact`;
});

/* ---- Invariant 6: the .ics self-recognition sentinel ----------------------------------- */
check(6, '@scrubpay .ics sentinel, both halves', () => {
  must(/'UID:scrubpay-'\s*\+/.test(html), 'export no longer stamps scrubpay- UIDs');
  must(html.includes("indexOf('@scrubpay')"), 'import no longer drops its own UIDs — re-import will duplicate every event');
  return 'export stamps + import drops';
});

/* ---- Invariant 8/9: the deploy path itself --------------------------------------------- */
check(8, 'CNAME stays in the publish set', () => {
  must(/cp CNAME _site\//.test(deploy), 'CNAME dropped from the publish set — the site falls off badgebudget.com');
  const copies = (deploy.match(/^\s*cp \S+ _site\/$/gm) || []).map(l => l.trim());
  must(copies.length === 3, `publish set should be exactly 3 files, found ${copies.length}: ${copies.join(' | ')}`);
  return copies.join(', ');
});

check(9, 'Deploy branch still triggers a deploy', () => {
  must(deploy.includes('claude/migrate-to-github-deploy-3F5RD'),
    'the de facto default branch was removed from the push triggers — this stops ALL deploys');
  return 'claude/migrate-to-github-deploy-3F5RD present';
});

/* ---- report ---------------------------------------------------------------------------- */
const pad = (s, n) => String(s).padEnd(n);
console.log('\nBadgeBudget build gate\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${pad('[' + r.invariant + ']', 9)} ${pad(r.label, 42)} ${r.detail}`);
}
console.log('\n  UNCHECKED (human-held): 3 wage-core, 10 fetch-before-branch, 11 protected branches, 12 URL forwarding off\n');

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`${failed.length} of ${results.length} checks FAILED — do not deploy.\n`);
  process.exit(1);
}
console.log(`All ${results.length} mechanical checks passed.\n`);
