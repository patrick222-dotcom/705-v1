#!/usr/bin/env node
/* Tests for the deploy gate itself. Run: node scripts/test_check_build.mjs
 *
 * `check_build.mjs` is one of two required status checks and the only one the pre-push hook runs,
 * so it is the last thing between a broken invariant and production. Nothing was reading IT.
 * Delete a `check()` call and the suite prints "All 14 mechanical checks passed" instead of 15,
 * exits 0, and every gate downstream agrees: the PR goes green, the hook lets the push through,
 * and the invariant that check was holding is now held by nobody. That is **Invariant 4's shape
 * aimed at the gate** — a break with no signal — and it is the failure mode this repo has been
 * burned by most often.
 *
 * Both of the other script-level suites have a meta-test (`test_groom_seed.mjs` 33,
 * `test_silence_watch.mjs` 39). The gate did not.
 *
 * Two halves, and neither is sufficient alone:
 *
 *   ROSTER  — the expected (invariant, label) pairs are all present and the count matches, read
 *             off the source. Catches a deleted or renamed check. `check_build.mjs` now holds the
 *             same assertion about itself (`check('gate', …)`) so the number is compared in CI
 *             today; this suite is what proves that self-check has teeth, which it cannot do for
 *             itself.
 *   TEETH   — the gate is run as a subprocess against a scratch tree, once clean and then once
 *             per deliberate break, and must EXIT NON-ZERO and name the right invariant each
 *             time. A roster test alone would still pass if `must()` quietly became a no-op or
 *             `check()` started swallowing throws, which is the way a gate most plausibly dies.
 *
 * The breaks are applied to a COPY (`.gate-scratch/`), never the working tree — the same rule
 * `cos_check.mjs` takes its optional `root` argument for, and the rule the `harness` skill states
 * for negative tests. The scratch tree is torn down and rebuilt per break, so one break can never
 * leak into the next.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, symlinkSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = join(ROOT, '.gate-scratch');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* ---- the roster -------------------------------------------------------------------------
   The declared truth about what the gate contains. Adding a check to `check_build.mjs` without
   adding it here fails this suite ON PURPOSE: the count is the thing that was unwatched, so it
   may only move deliberately. Keep the order the source uses, so a diff of the two reads. */
const ROSTER = [
  ['build', 'JSX block parses'],
  [1, 'Boot hardening intact'],
  [2, 'SRI on all 5 CDN scripts'],
  [2, 'CSP covers every host the pages load'],
  [2, 'pdf.js worker matches its pinned library'],
  [4, "saveToSupabase upserts on {onConflict:'user_id'}"],
  [5, 'Storage keys unrenamed'],
  [6, '@scrubpay .ics sentinel, both halves'],
  [8, 'Publish set is exactly the intended files'],
  [8, 'Ops console ships nothing it should not'],
  [9, 'Deploy branch still triggers a deploy'],
  ['events', 'Unload telemetry intact'],
  ['events', 'Harness cannot write to production'],
  ['core', 'Extracted core in sync with index.html'],
  [3, 'Pay math never reads the persona'],
  [13, 'iCal feed URL: out of the blob, the log and the parser'],
  ['cos', 'Operating-committee caps'],
  ['gate', 'Every check this gate claims is still here'],
];

/* Every file the gate reads, directly or through extract_core.mjs / cos_check.mjs. A path the
   gate starts reading and this list misses makes the BASELINE assertion below fail loudly (the
   gate's `read()` throws at module load), which is the correct outcome — never a silent pass. */
const NEEDED = [
  'index.html',
  /* 1MB, and copied once per break. It is in this list because the gate reads it as of
     2026-10-31: the worker-version check below is the first thing in this repo to look inside
     the file at all. */
  'pdf.worker.min.js',
  'ops.html',
  'privacy.html',
  '.github/workflows/deploy.yml',
  'supabase/functions/ical-proxy/index.ts',
  'supabase/functions/_shared/badgebudget-core.mjs',
  'tests/harness.mjs',
  'scripts/check_build.mjs',
  'scripts/extract_core.mjs',
  'scripts/cos_check.mjs',
  'docs/cos',
];

const buildScratch = () => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  for (const p of NEEDED) {
    const dest = join(SCRATCH, p);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(join(ROOT, p), dest, { recursive: true });
  }
  /* @babel/standalone has to resolve from inside the scratch tree. A symlink rather than a copy:
     the package is large and this suite rebuilds the tree once per break. */
  const nm = join(SCRATCH, 'node_modules');
  if (!existsSync(nm)) symlinkSync(join(ROOT, 'node_modules'), nm, 'dir');
};

const runGate = () => {
  try {
    const stdout = execFileSync(process.execPath, [join(SCRATCH, 'scripts/check_build.mjs')],
      { cwd: SCRATCH, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: stdout };
  } catch (e) {
    /* Non-zero exit, or a crash before the report. Both are "the gate did not pass"; the tests
       below distinguish them by looking for the invariant tag in the output. */
    return { code: e.status === undefined ? -1 : e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

const patch = (p, fn) => {
  const f = join(SCRATCH, p);
  const before = readFileSync(f, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`patch for ${p} changed nothing — the break is a no-op, so the assertion below would be unfalsifiable`);
  writeFileSync(f, after);
};

const self = readFileSync(join(ROOT, 'scripts/check_build.mjs'), 'utf8');

/* ---- ROSTER ----------------------------------------------------------------------------- */

// 1. every declared check is present in the source, as a check() call with that exact label
const missing = ROSTER.filter(([inv, label]) => {
  const tag = typeof inv === 'number' ? String(inv) : `'${inv}'`;
  return !self.includes(`check(${tag}, '${label.replace(/'/g, "\\'")}'`)
      && !self.includes(`check(${tag}, "${label}"`);
});
ok('roster: every declared check is present in check_build.mjs', missing.length === 0,
  missing.map(([i, l]) => `[${i}] ${l}`).join('; '));

// 2. the COUNT matches — this is the number that printed "All 14 passed" and was compared to nothing
const declared = (self.match(/^check\(/gm) || []).length;
ok('roster: check() call count equals the declared roster', declared === ROSTER.length,
  `source has ${declared}, roster declares ${ROSTER.length}`);

// 3. the UNCHECKED roll-call still names every human-held invariant. The gate's own header calls a
//    silently-omitted invariant the thing it exists to forbid; 7 and 13 were missing from it once.
const rollcall = (self.match(/UNCHECKED \(human-held\)[\s\S]{0,400}/) || [''])[0];
const unnamed = [3, 7, 10, 11, 12, 13].filter((n) => !new RegExp(`\\b${n}\\b`).test(rollcall));
ok('roster: UNCHECKED roll-call still names 3, 7, 10, 11, 12, 13', unnamed.length === 0,
  unnamed.length ? `missing ${unnamed.join(', ')}` : rollcall.split('\n')[0].slice(0, 60) + '…');

/* ---- TEETH ------------------------------------------------------------------------------ */

// 4. BASELINE: the unmodified tree passes, exits 0, and reports exactly the roster's count.
//    Every assertion below is read against this, so it is asserted first and separately.
buildScratch();
const base = runGate();
ok('teeth: clean scratch copy passes', base.code === 0, base.code === 0 ? '' : base.out.slice(-400));
ok('teeth: clean copy reports the declared count',
  base.out.includes(`All ${ROSTER.length} mechanical checks passed.`),
  (base.out.match(/All \d+ mechanical checks passed\./) || ['no "All N passed" line'])[0]);

/* One deliberate break per check, and one per clause where a check holds several. `expect` is the
   invariant tag the gate must print on the failing row, so a break that fails the WRONG check — or
   crashes before the report — is caught rather than counted as a win.

   A fifth element pins the LABEL as well, and the fourteen `[2]` breaks all carry it. THREE checks
   now share that tag (SRI; the CSP clause added 2026-10-30; the same-origin pdf.js worker added
   2026-10-31), so the tag alone stopped being enough to say which row went red: `✗ [2]` would
   credit a CSP break to the SRI check and vice versa, and a break that fails the wrong row is
   exactly the thing `expect` exists to catch. Where a tag is unique the label is redundant and is
   left off. */
const CSP = 'CSP covers every host the pages load';
const PDFW = 'pdf.js worker matches its pinned library';
const BREAKS = [
  ['[build] JSX stops parsing', 'index.html', (s) => {
    const open = s.indexOf('<script type="text/babel" data-presets="react">');
    const at = s.indexOf('>', open) + 1;
    return s.slice(0, at) + '\nvar 0bad = ;\n' + s.slice(at);
  }, 'build'],
  ['[1] boot watchdog error capture removed', 'index.html',
    (s) => s.split('window.__bootError').join('window.__NOT_bootError'), '1'],
  /* The replacement must not itself contain `integrity="sha384-`: a first draft used
     `data-was-integrity="…"`, which still held the substring, so the count stayed 5 and the gate
     passed a "break" that broke nothing. The no-op guard cannot see that one — only the
     expected-failure assertion did. */
  ['[2] one SRI hash dropped', 'index.html',
    (s) => s.replace('integrity="sha384-', 'data-sri="sha384-'), '2', 'SRI on all 5 CDN scripts'],
  /* The CSP clause, added 2026-10-30. Five breaks because there are five separate ways it dies,
     and a group of musts negative-tested as a group only proves ONE of them has teeth. */
  ['[2] a sixth script arrives from a host the CSP does not permit', 'index.html',
    (s) => s.replace('<style>', '<script src="https://esm.sh/thing.js"></script>\n<style>'), '2', CSP],
  /* The other direction, and the likelier edit: the tag is fine and the CSP is tightened under it.
     This one blocks supabase-js, so cloud sync dies behind a boot error screen. */
  ['[2] the CSP stops permitting a host a script still uses', 'index.html',
    (s) => s.replace("'unsafe-eval' https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
      "'unsafe-eval' https://unpkg.com https://cdnjs.cloudflare.com"), '2', CSP],
  /* Anti-omission: a page whose CSP is gone must FAIL, not pass for having no directives to
     violate — the same rule check 13 takes for a renamed serializeState. */
  ['[2] ops.html ships with no CSP at all', 'ops.html',
    (s) => s.replace('<meta http-equiv="Content-Security-Policy" content="', '<meta name="was-csp" content="'), '2', CSP],
  /* privacy.html has no CSP by design; the property that replaces one is that it fetches nothing. */
  ['[2] privacy.html grows a third-party request', 'privacy.html',
    (s) => s.replace('<link rel="icon"', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">\n<link rel="icon"'), '2', CSP],
  /* No tag names a woff2, so this is the one derived assertion — and the one whose breakage is
     invisible rather than fatal: the webfont falls back and the layout moves. */
  ['[2] font-src stops permitting fonts.gstatic.com', 'index.html',
    (s) => s.replace('font-src https://fonts.gstatic.com;', "font-src 'self';"), '2', CSP],
  /* The same-origin worker, added 2026-10-31. EIGHT breaks, one per `must()`, and all eight pin
     the LABEL as well as the tag — three checks share `[2]` now, so `✗ [2]` alone would credit a
     worker break to the SRI or the CSP row. The label pin is itself negative-tested: pointing
     PDFW at the SRI label turns all eight red (measured 2026-10-31, 33 passed / 8 failed). */
  /* Anti-omission 1: the pinned version is what everything below is compared against, so it has
     to be established and not merely looked for. A second pdf.js tag leaves SRI's count at 5. */
  ['[2] a second pdf.js pin makes the version ambiguous', 'index.html',
    (s) => s.replace('<style>', '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>\n<style>'), '2', PDFW],
  ['[2] the worker file stops being the pinned pdf.js build', 'pdf.worker.min.js',
    (s) => s.replace('"3.11.174"', '"3.12.0"'), '2', PDFW],
  /* The 1MB blob in the publish set, truncated. Nothing in this repo read a byte of it before. */
  ['[2] pdf.worker.min.js is replaced by something that is not a worker', 'pdf.worker.min.js',
    () => '/* not a pdf.js worker */\n', '2', PDFW],
  /* The edit a "the worker would not load, let us serve it from the CDN" fix starts as. script-src
     permits cdnjs, so it reads as safe; the CSP has no worker-src, so default-src 'self' blocks it. */
  ['[2] workerSrc is pointed at a CDN', 'index.html',
    (s) => s.replace("GlobalWorkerOptions.workerSrc='pdf.worker.min.js'",
      "GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'"), '2', PDFW],
  /* CVE-2024-4367. The CSP carries 'unsafe-eval' for Babel, so this flag is the whole mitigation. */
  ['[2] getDocument drops isEvalSupported:false', 'index.html',
    (s) => s.replace('getDocument({data:buf, isEvalSupported:false})', 'getDocument({data:buf})'), '2', PDFW],
  /* Same-origin but not published: deploy.yml copies exactly five files, so this 404s in
     production while working perfectly from a local directory listing. */
  ['[2] workerSrc points at a file the deploy never copies', 'index.html',
    (s) => s.replace("GlobalWorkerOptions.workerSrc='pdf.worker.min.js'",
      "GlobalWorkerOptions.workerSrc='vendor/pdf.worker.min.js'"), '2', PDFW],
  /* Anti-omission 2 and 3, the rule check 13 takes for a renamed serializeState: a rewritten
     paystub reader must fail this check rather than pass by having nothing left to look at. */
  ['[2] the workerSrc assignment is renamed away', 'index.html',
    (s) => s.split('GlobalWorkerOptions.workerSrc').join('GlobalWorkerOptions.wSrc'), '2', PDFW],
  ['[2] the getDocument call is renamed away', 'index.html',
    (s) => s.split('getDocument({data:buf').join('openDocument({data:buf'), '2', PDFW],
  ['[4] the user_data upsert loses onConflict', 'index.html',
    (s) => s.replace("{onConflict:'user_id'}", '{}'), '4'],
  ['[5] a storage key renamed', 'index.html',
    (s) => s.split('scrubpay_anon_id').join('badgebudget_anon_id'), '5'],
  ['[6] import side stops dropping its own UIDs', 'index.html',
    (s) => s.split("indexOf('@scrubpay')").join("indexOf('@nothing')"), '6'],
  /* The two export stamps are asserted separately: index.html has one for shifts (~4781) and one
     for day events (~4802), and breaking only ONE of them passed all fourteen checks until
     tonight — the third hole in `[6]`, which the gate's own "both halves" label denied. */
  ['[6] only the FIRST export stamp broken', 'index.html',
    (s) => s.replace("'UID:scrubpay-'+dateKey+'-'+safeId(s.id)", "'UID:badgebudget-'+dateKey+'-'+safeId(s.id)"), '6'],
  ['[6] only the SECOND export stamp broken', 'index.html',
    (s) => s.replace("'UID:scrubpay-'+dateKey+'-'+safeId(ev.id)", "'UID:badgebudget-'+dateKey+'-'+safeId(ev.id)"), '6'],
  ['[8] CNAME dropped from the publish set', '.github/workflows/deploy.yml',
    (s) => s.split('cp CNAME _site/').join('# cp CNAME _site/'), '8'],
  ['[8] ops.html assigns innerHTML', 'ops.html',
    (s) => s.replace('</body>', '<script>document.body.innerHTML = "x";</script></body>'), '8'],
  ['[9] deploy branch removed from the triggers', '.github/workflows/deploy.yml',
    (s) => s.split('claude/migrate-to-github-deploy-3F5RD').join('claude/some-other-branch'), '9'],
  ['[events] unload sender loses keepalive', 'index.html',
    (s) => s.split('keepalive: true').join('keepalive: false'), 'events'],
  ['[events] harness stops neutralising Supabase', 'tests/harness.mjs',
    (s) => s.split('NEUTRAL_SUPABASE_HOST').join('REAL_SUPABASE_HOST'), 'events'],
  ['[core] committed core module goes stale', 'supabase/functions/_shared/badgebudget-core.mjs',
    (s) => s + '\n/* drifted */\n', 'core'],
  ['[3] a wage definition reads the persona', 'index.html',
    (s) => s.replace('function hourlyRate(base, diff){', 'function hourlyRate(base, diff, persona){'), '3'],
  ['[13] ical-proxy logs', 'supabase/functions/ical-proxy/index.ts',
    (s) => s.replace('Deno.serve(', 'console.log("dbg");\nDeno.serve('), '13'],
  /* Clause (c), added 2026-10-29: the .ics parser keeps no titles. One break per assertion,
     because a group of musts negative-tested as a group only proves that ONE of them has teeth. */
  ['[13] the parsed .ics event grows a field', 'index.html',
    (s) => s.replace('      uid: uid || null,\n      offHint,', '      uid: uid || null,\n      offHint,\n      title: uidRaw,'), '13'],
  /* The realistic shape: not storing the title, just hoisting it into a local on the way to
     icsLooksOff. That is the edit a "show her what the feed called it" feature starts as. */
  ['[13] a feed title is hoisted out of icsLooksOff', 'index.html',
    (s) => s.replace('const offHint = icsLooksOff(props.SUMMARY && props.SUMMARY.value, dtstart.allDay, hours);',
      'const rawTitle = props.SUMMARY && props.SUMMARY.value;\n    const offHint = icsLooksOff(rawTitle, dtstart.allDay, hours);'), '13'],
  /* offHint IS stored, so this one leaks the title through a field the whitelist allows. */
  ['[13] icsLooksOff returns the title instead of a boolean', 'index.html',
    (s) => s.replace("return ICS_OFF_TITLE_RE.test(String(title||'').replace(/\\\\[,;nN]/g,' '));",
      "return String(title||'');"), '13'],
  ['[13] the .ics parser is renamed away', 'index.html',
    (s) => s.split('parseICSSchedule').join('parseICSFeed'), '13'],
  ['[13] icsLooksOff is renamed away', 'index.html',
    (s) => s.split('icsLooksOff').join('icsOffGuess'), '13'],
  ['[cos] a fourth thread appears in now.md', 'docs/cos/now.md',
    (s) => s.replace(/^## Threads\s*$/m, '## Threads\n\n### T9 `extra` — a fourth thread\n'), 'cos'],
  /* The headline defect, stated as the backlog item found it: delete a whole check() call and the
     suite used to print "All 14 … passed" and exit 0. It must now be RED. */
  ['[gate] a whole check() call is deleted', 'scripts/check_build.mjs', (s) => {
    const at = s.indexOf("check(9, 'Deploy branch still triggers a deploy'");
    const end = s.indexOf('\n});', at) + 4;
    return s.slice(0, at) + s.slice(end);
  }, 'gate'],
];

for (const [name, file, fn, expect, label] of BREAKS) {
  buildScratch();
  let patched = true;
  try { patch(file, fn); } catch (e) { patched = false; ok(`teeth: ${name}`, false, e.message); }
  if (!patched) continue;
  const r = runGate();
  const red = r.code !== 0;
  /* The failing row carries the tag, so requiring it is what stops a break being credited to
     whichever check happened to fail instead. A parse break prints no report at all, so the
     [build] row is matched against the crash output too. */
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = new RegExp(`\u2717 \\[${expect}\\]\\s+${label ? esc(label) : ''}`).test(r.out);
  ok(`teeth: ${name}`, red && named,
    !red ? 'gate PASSED on a deliberately broken tree'
         : named ? '' : `exited ${r.code} but did not fail [${expect}]${label ? ` ${label}` : ''}: ${r.out.slice(-300)}`);
}

rmSync(SCRATCH, { recursive: true, force: true });

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
