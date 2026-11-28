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
 *   GREENS  — edits that must leave the gate GREEN (first added 2026-11-19, thirty-two of them now).
 *             TEETH only ever asks
 *             "does a break go red?", and a check can be wrong in the other direction: one false
 *             positive on an ordinary edit gets the check weakened by whoever meets it. See the
 *             GREENS block at the foot of this file for what each one guards. A row may also
 *             carry a predicate over the gate's OUTPUT, for a claim a green exit does not settle:
 *             the 2026-11-23 row requires a figure to stay put, because the defect it guards is
 *             a gate that passes while printing a number nothing reads.
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
  [2, 'SRI on every CDN script the publish set loads'],
  [2, 'CSP covers every host the pages load'],
  [2, 'pdf.js worker matches its pinned library'],
  [4, 'Every write to user_data carries a conflict target'],
  [5, 'Storage keys unrenamed'],
  [6, '@scrubpay .ics sentinel, both halves'],
  [8, 'Publish set is exactly the intended files, and that set is what ships'],
  [8, 'Ops console ships nothing it should not'],
  [8, 'Published pages link only to published files'],
  [9, 'Deploy branch still triggers a deploy'],
  ['events', 'Unload telemetry intact'],
  ['events', 'Harness cannot write to production'],
  ['events', 'Event inventory sees every name that reaches events'],
  ['harness', 'Harness tests the pins the app ships'],
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
  /* Imported by the gate as of 2026-11-10: the inventory check runs the real trackCallSites()
     rather than a copy of its rules, so the module has to resolve from inside the scratch tree. */
  'scripts/dashboard_snapshot.mjs',
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

/* 4c. The shared-AST cache, asserted rather than trusted (2026-11-23). Ten of the gate's checks
   are AST walks and each one used to call `Babel.transform(body, {presets:['react'], plugins:[…]})`
   for its own tree — a full parse AND a full JSX transform of the same 512KB inline script, ~550ms
   apiece, 15 times. That put the gate at ~6.0s, and THIS SUITE runs the gate once per deliberate
   break, so it multiplied by 88 and put the run at ~8 minutes — which is what turned "add one line
   to CI" into a question about CI minutes. There are four distinct sources (index.html's boot
   script, its Babel block, ops.html's inline script, and — since 2026-11-27 — tests/harness.mjs,
   which is an ES module and so the gate's only `sourceType:'module'` parse), so four parses is
   the floor and anything above it is the cache not working.
   It is asserted on the EXACT pair, not a bound: `parses` rising to 15 is the regression this
   guards, and `walks` falling is a walk that quietly stopped running — which the breaks would
   also catch, but only for whichever check lost it. A wall-clock assertion was the obvious
   alternative and is rejected on purpose: it would be flaky on a loaded runner and would report
   a slow machine as a broken cache. */
const parseLine = (base.out.match(/(\d+) AST parse\(s\) shared by (\d+) walk\(s\)\./) || []);
ok('teeth: clean copy parses each source once and shares it across every walk',
  parseLine[1] === '4' && parseLine[2] === '25',
  parseLine[0] || 'the gate printed no parse/walk line at all');

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
const UNLOAD = 'Unload telemetry intact';
const NEUTRAL = 'Harness cannot write to production';
const INVENTORY = 'Event inventory sees every name that reaches events';
const PDFW = 'pdf.js worker matches its pinned library';
/* The deploy branch, used by the sixteen `[9]` rows and eight of the GREENS. Spelled once:
   several rows build a `deploy.yml` line out of it, and two spellings would mean a break that
   patches one line and asserts about another. */
const BR = 'claude/migrate-to-github-deploy-3F5RD';
/* `[8]` became a shared tag the moment a third check joined it (2026-11-11) — and it had ALREADY
   been shared by two since 2026-09-13 with neither break pinning a label, so `✗ [8]` from the ops
   row would have been counted as a win for the CNAME break. That is the same hole the 2026-10-30
   run fixed for `[2]` and the 2026-11-10 run fixed for `[events]`, still open in a third band.
   All five `[8]` breaks now pin the label. */
const SRI = 'SRI on every CDN script the publish set loads';
const PUBSET = 'Publish set is exactly the intended files, and that set is what ships';
const OPSPAGE = 'Ops console ships nothing it should not';
const LINKS = 'Published pages link only to published files';
/* The one line in ops.html that renders a public-authored string. Every HTML-sink break below
   rewrites exactly this line, so a break that stops matching it is a no-op and `patch()` throws
   rather than scoring a silent win. */
const OPS_SAFE_WRITE = '    if (text != null) n.textContent = text;   // never innerHTML: this is public-authored text';
const BREAKS = [
  ['[build] JSX stops parsing', 'index.html', (s) => {
    const open = s.indexOf('<script type="text/babel" data-presets="react">');
    const at = s.indexOf('>', open) + 1;
    return s.slice(0, at) + '\nvar 0bad = ;\n' + s.slice(at);
  }, 'build'],
  ['[1] boot watchdog error capture removed', 'index.html',
    (s) => s.split('window.__bootError').join('window.__NOT_bootError'), '1'],
  /* ---- Invariant 1's twenty-two, added 2026-11-25 ----------------------------------------
     The clause these replaced was five substrings over the whole 580KB file, and it was measured
     before the rewrite: SEVEN realistic edits left the gate printing `All 21 mechanical checks
     passed` while THREE behaviour-neutral ones turned it RED. Green on every edit that breaks the
     app, red on every edit that does not. One break per `must()`, because a group of musts broken
     as a group only proves that one of them has teeth; `[1]` is held by a single check, so no row
     needs a label pin.

     Seven of the rows below are those seven measured edits. They are marked MEASURED, and that
     word means it: each one was applied to a scratch copy and the gate run against it, with the
     old clause in place, before any of this was written. */
  ['[1] ring buffer entry point renamed', 'index.html',
    (s) => s.split('window.__logClientError').join('window.__NOT_logClientError'), '1'],
  ['[1] a third inline script appears, which this check would not read', 'index.html',
    (s) => s.replace('<div id="root"></div>', '<div id="root"></div>\n<script>/* analytics shim */</script>'), '1'],
  /* Anti-vacuity: no setTimeout in the boot script at all. A walk that resolves nothing must fail
     rather than report a clean sweep — the rule Invariant 5's derivation and the ops.html sink
     walk both take. */
  ['[1] the watchdog setTimeout is gone entirely', 'index.html',
    (s) => s.replace('  setTimeout(function(){\n    var root = document.getElementById(\'root\');',
      '  void (function(){\n    var root = document.getElementById(\'root\');'), '1'],
  /* The timer survives and no longer writes the error screen, so there is no watchdog to find.
     This is why the watchdog is identified by the screen it writes and not by its delay. */
  ['[1] the watchdog stops writing the error screen', 'index.html',
    (s) => s.replace('    splash.innerHTML =\n', '    splash.textContent =\n'), '1'],
  /* The upper bound on the same must(): TWO timers that write a screen, so the check can no
     longer say which one is the watchdog. A `>= 1` test would pass this. */
  ['[1] a second screen-writing timer makes the watchdog ambiguous', 'index.html',
    (s) => s.replace("  setTimeout(function(){\n    var root = document.getElementById('root');",
      "  setTimeout(function(){\n    var slow = document.getElementById('splash');\n    if(slow) slow.innerHTML = '<em>still loading…</em>';\n  }, 4000);\n  setTimeout(function(){\n    var root = document.getElementById('root');"), '1'],
  /* MEASURED (b). The timer fires, `}, 8000);` still matches, and the splash is never replaced —
     the infinite iPhone spinner this invariant was created to fix, restored verbatim. */
  ['[1] the watchdog callback returns before writing the screen', 'index.html',
    (s) => s.replace("    var root = document.getElementById('root');\n    var splash = document.getElementById('splash');",
      "    return;\n    var root = document.getElementById('root');\n    var splash = document.getElementById('splash');"), '1'],
  /* MEASURED (f). The old regex was unanchored over the whole document, so it never cared WHICH
     timer carried 8000 — any future 8-second toast re-arms it permanently. */
  ['[1] watchdog bumped to 30s with an unrelated 8s timer elsewhere', 'index.html',
    (s) => s.replace('  }, 8000);', '  }, 30000);')
      .replace('const sleepMs = ms => new Promise(r=>setTimeout(r, ms));',
        'const autoDismissToast = (fn) => setTimeout(() => {\n  fn();\n}, 8000);\nconst sleepMs = ms => new Promise(r=>setTimeout(r, ms));'), '1'],
  /* Anti-vacuity on the client half: no createClient call to guard. */
  ['[1] createClient is spelled some other way', 'index.html',
    (s) => s.replace('  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)',
      '  ? window.supabase.makeClient(SUPABASE_URL, SUPABASE_ANON_KEY)'), '1'],
  /* MEASURED (c). Three of the five old clauses were substring tests over the whole file, so a
     COMMENT satisfied them. The app now hard-fails whenever the CDN does. */
  ['[1] createClient called unguarded, the guard left as a comment', 'index.html',
    (s) => s.replace("const supabase = (window.supabase && window.supabase.createClient)\n  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)\n  : null;",
      "/* was: (window.supabase && window.supabase.createClient) ? … : null */\nconst supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);"), '1'],
  /* A conditional that is not a null-guard: shaped right, testing the wrong thing. */
  ['[1] the client guard tests something other than window.supabase', 'index.html',
    (s) => s.replace('const supabase = (window.supabase && window.supabase.createClient)',
      "const supabase = (typeof SUPABASE_URL === 'string')"), '1'],
  ['[1] the client guard falls back to undefined instead of null', 'index.html',
    (s) => s.replace('  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)\n  : null;',
      '  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)\n  : undefined;'), '1'],
  /* The guard stays perfect and a SECOND call is added outside it — the shape a feature takes
     when it needs its own client, and invisible to any check that only inspects the guard. */
  ['[1] a second createClient call sits outside the guard', 'index.html',
    (s) => s.replace('  : null;\n',
      '  : null;\nconst supabaseAlt = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);\n', 1), '1'],
  ['[1] the withTimeout helper is renamed', 'index.html',
    (s) => s.replace('const withTimeout = (p, ms, label) => Promise.race([',
      'const raceWithTimeout = (p, ms, label) => Promise.race(['), '1'],
  /* MEASURED (a), and the most dangerous of the seven: one line, the shape anyone reaches for
     while debugging, and it removes the race from getSession AND every other call site at once.
     The old regex matched the CALL, so it still matched. */
  ['[1] withTimeout neutered to the identity function', 'index.html',
    (s) => s.replace('const withTimeout = (p, ms, label) => Promise.race([',
      'const withTimeout = (p, ms, label) => p;\nconst __unusedWithTimeout = (p, ms, label) => Promise.race(['), '1'],
  ['[1] getSession is spelled some other way', 'index.html',
    (s) => s.replace("await withTimeout(supabase.auth.getSession(), 4000, 'auth check')",
      "await withTimeout(supabase.auth.fetchSession(), 4000, 'auth check')"), '1'],
  /* MEASURED (g). */
  ['[1] the getSession race dropped at the call site, shape left in a comment', 'index.html',
    (s) => s.replace("        const {data:{session}} = await withTimeout(supabase.auth.getSession(), 4000, 'auth check');",
      "        /* was withTimeout(supabase.auth.getSession(), 4000, 'auth check') */\n        const {data:{session}} = await supabase.auth.getSession();"), '1'],
  ['[1] __logClientError assigned something that is not a function', 'index.html',
    (s) => s.replace('  window.__logClientError = function(msg, src, line, stack){',
      '  var noopLogger = function(msg, src, line, stack){')
      .replace('  /* console.error mirror.', '  window.__logClientError = noopLogger;\n  /* console.error mirror.'), '1'],
  /* MEASURED (d). CLAUDE.md names this exact edit as the dangerous direction for the console
     mirror — "a mirror that drops categories of message is how the 47-day sync outage stayed
     invisible" — and the old clause could not see it. */
  ['[1] __logClientError no-opped with a leading return', 'index.html',
    (s) => s.replace('  window.__logClientError = function(msg, src, line, stack){',
      '  window.__logClientError = function(msg, src, line, stack){ return; /* too noisy */'), '1'],
  /* It accepts every message and persists none, so the buffer is empty on the next load — which
     is how the 2026-08-23 sync investigation opened with an empty error log. */
  ['[1] __logClientError stops persisting the buffer', 'index.html',
    (s) => s.replace('      localStorage.setItem(ERR_KEY, JSON.stringify(buf));',
      '      void JSON.stringify(buf);'), '1'],
  /* MEASURED (e). */
  ['[1] __bootError assignments removed, the name left in comments', 'index.html',
    (s) => s.replace("    if(!window.__bootError) window.__bootError = e.message || String(e.error||'');",
      '    /* window.__bootError no longer set here */')
      .replace('    if(!window.__bootError) window.__bootError = m;',
        '    /* window.__bootError no longer set here either */'), '1'],
  /* Written and never read: the watchdog screen silently degrades to "Unknown startup error."
     for every failed boot, which is the one string a nurse would be asked to report. */
  ['[1] nothing reads __bootError any more', 'index.html',
    (s) => s.replace("(window.__bootError || 'Unknown startup error.')",
      "('Unknown startup error.')"), '1'],
  /* The replacement must not itself contain `integrity="sha384-`: a first draft used
     `data-was-integrity="…"`, which still held the substring, so the count stayed 5 and the gate
     passed a "break" that broke nothing. The no-op guard cannot see that one — only the
     expected-failure assertion did. */
  ['[2] one SRI hash dropped', 'index.html',
    (s) => s.replace('integrity="sha384-', 'data-sri="sha384-'), '2', SRI],
  /* The ops.html clauses, added 2026-11-20. The publish set ships a SIXTH SRI-bearing script and
     the count above never covered it. All four of these were measured against the OLD clause
     first; THREE of them left the gate printing `All 21 mechanical checks passed`, which is the
     finding as evidence rather than prose. (The fourth, a version bump in the url, already
     failed — but via the harness-pin check, which reads that url only because buildOpsScratch
     finds the row by substring. The url was held by a check that does not care about it; the
     hash was held by nobody.) One break per clause, because a group of musts broken as a group
     only proves that one of them has teeth. */
  ['[2] ops.html and index.html pin the same url with different hashes', 'ops.html',
    (s) => s.replace('sha384-GFr3yTh5', 'sha384-AAAAyTh5'), '2', SRI],
  /* The copied-from-the-wrong-row shape, and the realistic one: bump supabase-js in index.html,
     update its hash, and leave the console's second copy of the pin alone. The hash below is
     React's, taken verbatim from index.html, so it is a VALID sha384 in the right syntax — a
     break that only malformed the string would not prove the comparison runs. */
  ['[2] ops.html carries a real hash from the wrong row', 'ops.html',
    (s) => s.replace('sha384-GFr3yTh5lJznCbZfpTtXnwboFsxqtTQoeTZCRHhE0579KrRmlCzen5AA8ohaB5ug',
      'sha384-tMH8h3BGESGckSAVGZ82T9n90ztNXxvdwvdM6UoR56cYcf+0iGXBliJ29D+wZ/x8'), '2', SRI],
  /* The one that fails OPEN. A wrong hash blocks the script and kills the console for two
     admins; a missing attribute loads a third party's JavaScript unverified into the origin that
     holds user_data and the auth session. */
  ['[2] ops.html drops its integrity attribute entirely', 'ops.html',
    (s) => s.replace(/ integrity="sha384-[^"]*"/, ''), '2', SRI],
  ['[2] ops.html pins a script index.html does not load', 'ops.html',
    (s) => s.replace('<script crossorigin', '<script crossorigin="anonymous" integrity="sha384-'
      + 'tMH8h3BGESGckSAVGZ82T9n90ztNXxvdwvdM6UoR56cYcf+0iGXBliJ29D+wZ/x8" '
      + 'src="https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js"></script>\n<script crossorigin'), '2', SRI],
  /* Anti-vacuity: the walk must find a tag. With the script gone there is nothing to disagree
     with index.html about, so every clause above is trivially satisfied and a check that only
     asked them would sweep clean on a console that loads nothing. */
  ['[2] ops.html loads no remote script at all', 'ops.html',
    (s) => s.replace(/<script\b[^>]*\bsrc="https:[^>]*><\/script>/, ''), '2', SRI],
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
  /* privacy.html's self-containment, rewritten 2026-11-19. The clause it replaced was
     `/\b(?:src|href)="https?:\/\/[^"]+"/` — two attribute spellings of one scheme — and it
     printed `privacy.html self-contained`. All SIX of these breaks were measured against the old
     clause first and all six left the gate printing `All 21 mechanical checks passed`, which is
     the finding stated as evidence rather than as prose. One break per route, because the routes
     are different regexes and a group of them broken as a group only proves that one has teeth. */
  ['[2] privacy.html loads a webfont through CSS url()', 'privacy.html',
    (s) => s.replace('  *{box-sizing:border-box}',
      '  @font-face{font-family:Inter;src:url(https://fonts.gstatic.com/s/inter/v13/x.woff2) format("woff2")}\n  *{box-sizing:border-box}'), '2', CSP],
  ['[2] privacy.html @imports a third-party stylesheet', 'privacy.html',
    (s) => s.replace('<style>', '<style>\n  @import url("https://fonts.googleapis.com/css2?family=Inter");'), '2', CSP],
  /* The bad one: an analytics script on the privacy notice, on a page with no CSP to block it.
     SINGLE-QUOTED, which is the whole reason the old clause could not see it. */
  ['[2] privacy.html grows a single-quoted remote script', 'privacy.html',
    (s) => s.replace('</head>', "<script src='https://plausible.io/js/script.js'></script>\n</head>"), '2', CSP],
  ['[2] privacy.html grows a protocol-relative tracking pixel', 'privacy.html',
    (s) => s.replace('</body>', '<img src="//tracker.example.com/pixel.gif" alt="">\n</body>'), '2', CSP],
  /* Clause (c) on its own: an INLINE script has no src, so the attribute walk above cannot see
     it, and it can fetch whatever it likes at runtime. */
  ['[2] privacy.html grows an inline script with no src', 'privacy.html',
    (s) => s.replace('</body>', '<script>fetch("https://x.example.com/?r="+document.referrer)</script>\n</body>'), '2', CSP],
  /* Anti-vacuity: a page with nothing in it must FAIL rather than sweep clean. */
  ['[2] privacy.html stops yielding anything to walk', 'privacy.html',
    () => 'privacy notice text only, no markup at all\n', '2', CSP],
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
  /* Invariant 4, rewritten as a derivation 2026-11-22. Until then this check was ONE regex over
     the whole file and ONE break — the row immediately below. Measured against that old clause
     before anything was written, SIX realistic edits, every one of them 23505-forever, left the
     gate printing `All 21 mechanical checks passed`: both halves of the raw keepalive POST's
     guard (breaks `[4] raw …` below), two new supabase-js write paths, a new raw POST, and
     `saveToSupabase` renamed out from under a check whose own label named it. Two of the six are
     caught at runtime by `tests/smoke.mjs` §33, which intercepts the unload flush's real
     request; the other four were caught by nothing.

     ELEVEN breaks now, one per `must()` and one per detector feeding the shared one — the rule
     the ops.html sink walk took, because a group of detectors broken as a group only proves that
     one of them has teeth. No label pin on any of them: `[4]` is a tag held by a single check.

     One clause has deliberately no break here: the "expected 2 inline scripts" floor is the same
     one the storage-key derivation holds, it is broken there, and the same edit reds both rows —
     a second copy would prove nothing this suite does not already know. */
  ['[4] the user_data upsert loses onConflict', 'index.html',
    (s) => s.replace("{onConflict:'user_id'}", '{}'), '4'],
  /* The conflict target is PRESENT and wrong, which is the subtler half of the same must(): the
     table's PK is a generated `id`, so targeting it generates a fresh id, fires no conflict, and
     degrades to exactly the INSERT that 23505s. A check testing only for the option's presence
     would pass this. */
  ['[4] onConflict targets the PK instead of user_id', 'index.html',
    (s) => s.replace("{onConflict:'user_id'}", "{onConflict:'id'}"), '4'],
  /* The raw keepalive path, which Invariant 4's own text names as the second write path and the
     old regex could not see at all. Its success is unobservable by construction — the document is
     gone — so a 23505 here is silent even to the error ring buffer. §33 asserts these two off the
     intercepted request at runtime; the gate now asserts them at the source, which is the one
     place every write path shares. */
  ['[4] raw POST url loses ?on_conflict=user_id', 'index.html',
    (s) => s.replace("'/rest/v1/user_data?on_conflict=user_id'", "'/rest/v1/user_data'"), '4'],
  ['[4] raw POST Prefer header loses resolution=merge-duplicates', 'index.html',
    (s) => s.replace("Prefer: 'return=minimal,resolution=merge-duplicates'",
      "Prefer: 'return=minimal'"), '4'],
  /* The three NEW write paths. These are the shape the derivation exists for: the question moved
     from "is the one upsert we know about still right?" to "is every write to this table right?",
     and none of these three touches the line the old regex read. */
  ['[4] a second supabase-js upsert to user_data with no options argument', 'index.html',
    (s) => s.replace('async function saveToSupabase(userId, data){',
      "async function saveMeta(userId, data){\n  return supabase.from('user_data')"
      + '.upsert({user_id:userId, data});\n}\nasync function saveToSupabase(userId, data){'), '4'],
  ['[4] a second write path uses .insert, which takes no conflict target', 'index.html',
    (s) => s.replace('async function saveToSupabase(userId, data){',
      "async function saveMeta(userId, data){\n  return supabase.from('user_data')"
      + '.insert({user_id:userId, data});\n}\nasync function saveToSupabase(userId, data){'), '4'],
  ['[4] a second raw POST to user_data carrying neither guard', 'index.html',
    (s) => s.replace('function beaconSaveUserData(userId, data){',
      "function beaconV2(userId, data){\n  fetch(SUPABASE_URL + '/rest/v1/user_data', "
      + "{method:'POST', keepalive:true, headers:{apikey:SUPABASE_ANON_KEY}, "
      + 'body:JSON.stringify({user_id:userId, data})}).catch(()=>{});\n}\n'
      + 'function beaconSaveUserData(userId, data){'), '4'],
  /* Pass by omission, the rule check 13 takes for a renamed serializeState. Under the old regex
     this edit was INVISIBLE: the upsert line moved with the rename and still matched, so the
     check kept passing while the function its label named no longer existed. */
  ['[4] saveToSupabase is renamed away', 'index.html',
    (s) => s.split('saveToSupabase').join('persistBlob'), '4'],
  /* No regex fallback: a table name this walk cannot read could be user_data, and a check that
     shrugs at what it cannot read is the hole (the storage-key derivation's identical rule). */
  ['[4] the table name stops being a literal', 'index.html',
    (s) => s.replace(".from('user_data')\n      .upsert(",
      '.from(tableFor(userId))\n      .upsert('), '4'],
  /* Three anti-vacuity floors, one per path and one for the client binding. The old regex would
     also have passed a file with no user_data write in it at all, and a derivation that resolves
     nothing must FAIL rather than report a clean sweep. The client floor is what stops
     `.from()` being read as a table selector everywhere: without it `Array.from({length:n})`
     reads as an unresolvable table name, and with the binding unresolved every real write
     becomes invisible. */
  ['[4] the supabase-js upsert to user_data is gone', 'index.html',
    (s) => s.replace("{onConflict:'user_id'});", ");").replace(
      '.upsert({user_id:userId, data, updated_at:updatedAt}, ', ".select('user_id'"), '4'],
  ['[4] the raw POST to user_data is gone', 'index.html',
    (s) => s.replace("'/rest/v1/user_data?on_conflict=user_id'", "'/rest/v1/events'"), '4'],
  ['[4] no createClient binding resolves', 'index.html',
    (s) => s.replace('const supabase = (window.supabase && window.supabase.createClient)\n'
      + '  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)\n  : null;',
      'function makeSb(){ return (window.supabase && window.supabase.createClient)\n'
      + '  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)\n  : null; }\n'
      + 'const supabase = makeSb();'), '4'],
  ['[5] a storage key renamed', 'index.html',
    (s) => s.split('scrubpay_anon_id').join('badgebudget_anon_id'), '5'],
  /* The derivation clause, added 2026-11-14. SEVEN more breaks, one per `must()`, because
     the check printed "6/6 intact" for nine weeks while the app used eight keys — a group of
     musts negative-tested as a group only proves that ONE of them has teeth, and the one with
     teeth here was the presence test above. No label pin on any of them: `[5]` is still a tag
     held by a single check, which is why the derivation was folded into it rather than split off
     into a twenty-second row. */
  /* Anti-omission 1: the walk reads BOTH inline scripts, because the keys are split across them
     (the boot script owns scrubpayErrors). A third inline script would be scanned by nothing. */
  ['[5] a third inline script appears', 'index.html',
    (s) => s.replace('<style>', '<script>var later = 1;</script>\n<style>'), '5'],
  /* Anti-omission 2: a derivation that resolves nothing must FAIL rather than report a clean
     sweep. This is the shape check 3 and check 13 both guard for a renamed function. */
  ['[5] the walk finds no storage call sites at all', 'index.html',
    (s) => s.split('localStorage.getItem').join('lsGet').split('localStorage.setItem').join('lsSet')
      .split('localStorage.removeItem').join('lsDel'), '5'],
  /* A key built at runtime is a key nothing can guard, so it must throw rather than be skipped.
     There is deliberately no fallback — that is the hole this whole clause closes. */
  ['[5] a storage key is built from an unresolvable expression', 'index.html',
    (s) => s.replace("localStorage.getItem(ANON_ID_KEY)", "localStorage.getItem('scrubpay_' + 'anon_id')"), '5'],
  /* The builder is recognised by NAME, so a second one cannot ride in behind BACKUP_KEY. */
  ['[5] a second key builder arrives', 'index.html',
    (s) => s.replace('localStorage.setItem(BACKUP_KEY(uid)', 'localStorage.setItem(OTHER_KEY(uid)'), '5'],
  /* Invariant 5 names `nursingWagePlannerData::<uid>` and nothing checked the `::` until tonight.
     Change the separator and every signed-in user's failed-save backup orphans — the copy that
     held their data through Invariant 4's 47-day outage. */
  ['[5] the per-user backup separator changes', 'index.html',
    (s) => s.replace("STORE_KEY + '::' + uid", "STORE_KEY + ':' + uid"), '5'],
  /* The completeness assertion itself: a NEW key the lists do not name. This is the break that
     would have fired in October for scrubpay_ical_cta_dismissed and never did, because the check
     could not see a key it had not been told about. */
  ['[5] a new storage key the invariant does not name', 'index.html',
    (s) => s.replace("localStorage.getItem(ANON_ID_KEY)",
      "(localStorage.getItem('scrubpay_brand_new') , localStorage.getItem(ANON_ID_KEY))"), '5'],
  /* The other direction: a declared key whose storage access moves behind a wrapper this walk
     cannot see. The literal survives in the source, so the presence test above stays green and
     only the derivation notices — which is the whole point of having both. */
  ['[5] a declared key stops being reached through localStorage', 'index.html',
    (s) => s.split('localStorage.setItem(ICAL_CTA_KEY').join('wrapStore.setItem(ICAL_CTA_KEY')
      .split("localStorage.getItem(ICAL_CTA_KEY").join("wrapStore.getItem(ICAL_CTA_KEY"), '5'],
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
    (s) => s.split('cp CNAME _site/').join('# cp CNAME _site/'), '8', PUBSET],
  /* ---- the publish set's ten, added 2026-11-28 ------------------------------------------
     The row above was the WHOLE of this check's teeth, and it is the one case the old clause was
     written for. That clause was `/cp CNAME _site\//` plus two more of the same shape plus one
     anchored `matchAll`, and it was MEASURED before the rewrite: SEVEN of these eleven edits left
     the gate printing `All 21 mechanical checks passed`, and TWO behaviour-neutral ones turned it
     RED (both are GREENS at the foot of this file).

     Row A is the one that matters most and the reason this became a build item. The staging
     script can be perfect and `path:` can still point at the repository root, which publishes
     BACKLOG.md, CLAUDE.md, docs/cos/, supabase/migrations/ and scripts/ops_gate_probe.sql on
     badgebudget.com — and NOTHING else in this repo would notice: no suite drives deploy.yml, and
     `deploy_watch.mjs` hashes the five known files, so it reads `LIVE` while the whole repo is
     served beside them. The old clause read only the `cp` lines, which row A does not touch.

     Every row pins the label: `[8]` is shared by three checks. */
  ['[8] the uploaded artifact path is the repo root, not _site', '.github/workflows/deploy.yml',
    (s) => s.replace("path: '_site'", "path: '.'"), '8', PUBSET],
  ['[8] the uploaded artifact path is some other directory', '.github/workflows/deploy.yml',
    (s) => s.replace("path: '_site'", "path: 'docs'"), '8', PUBSET],
  /* Not every way to publish a file is a `cp`. A redirect was invisible to a check that matched
     one command name, and `# robots.txt while we are here` is an ordinary thing to add. */
  ['[8] an extra file is published by a redirect rather than a cp', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp CNAME _site/',
      '          cp CNAME _site/\n          echo "User-agent: *" > _site/robots.txt'), '8', PUBSET],
  /* `cp (\S+) _site/` needs exactly ONE token between, so `-r docs` never matched at all — the
     old regex did not fail to judge this line, it never saw it. */
  ['[8] an extra DIRECTORY is published by cp -r', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp CNAME _site/',
      '          cp CNAME _site/\n          cp -r docs _site/'), '8', PUBSET],
  ['[8] an extra file is published at a subpath of _site', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp CNAME _site/',
      '          cp CNAME _site/\n          mkdir -p _site/legal && cp docs/council.md _site/legal/'), '8', PUBSET],
  /* No `path:` at all is not a missing option: upload-pages-artifact then defaults to the
     repository root, so this is row A reached by deleting a line instead of editing one. */
  ['[8] the upload step names no path at all', '.github/workflows/deploy.yml',
    (s) => s.replace("          path: '_site'\n", ''), '8', PUBSET],
  ['[8] the Pages upload step is gone entirely', '.github/workflows/deploy.yml',
    (s) => s.replace(/      - name: Upload artifact\n        uses: actions\/upload-pages-artifact@v3\n        with:\n          path: '_site'\n/, ''), '8', PUBSET],
  /* A published file renamed on the way in is not in the set this check compares. The old
     anchored regex caught this one incidentally, by the COUNT falling to four — not by reading
     the destination, which is why the message it printed named the wrong file. */
  ['[8] a page is renamed on the way into _site', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp ops.html _site/', '          cp ops.html _site/admin.html'), '8', PUBSET],
  ['[8] staging done with rsync, which this check must classify rather than ignore', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp index.html _site/', '          rsync -a index.html _site/'), '8', PUBSET],
  /* "Whatever matches" is the opposite of an exact publish set: a glob ships the next .html file
     anyone drops in the repo root. Intended friction, the same rule the storage-key set takes. */
  ['[8] the publish set becomes a glob', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp privacy.html _site/', '          cp *.html _site/'), '8', PUBSET],
  /* The HTML-injection clause, rewritten as a walk 2026-11-21. This break predates the rewrite
     and is kept because it is the only one that adds a SECOND inline script: a walk wired to
     `inline[0]` would pass it. */
  ['[8] ops.html assigns innerHTML', 'ops.html',
    (s) => s.replace('</body>', '<script>document.body.innerHTML = "x";</script></body>'), '8', OPSPAGE],
  /* Six breaks, one per detector, and all six were MEASURED against the old one-spelling regex
     first: every one of them left the gate printing `All 21 mechanical checks passed`
     (2026-11-21). They are kept in that measured order.

     The anchor is the one line in ops.html that renders public-authored text — `el()`'s
     `n.textContent = text`. Each break turns that single safe write into an unsafe one, which is
     the edit this clause exists to stop, rather than appending a contrived script somewhere. */
  ['[8] ops.html appends with .innerHTML += (one character past the old regex)', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, '    if (text != null) n.innerHTML += text;'), '8', OPSPAGE],
  ['[8] ops.html assigns outerHTML', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, '    if (text != null) n.outerHTML = text;'), '8', OPSPAGE],
  ['[8] ops.html calls insertAdjacentHTML', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, "    if (text != null) n.insertAdjacentHTML('beforeend', text);"), '8', OPSPAGE],
  ['[8] ops.html reaches innerHTML through a computed property', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, "    if (text != null) n['innerHTML'] = text;"), '8', OPSPAGE],
  ['[8] ops.html calls document.write', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, '    if (text != null) document.write(text);'), '8', OPSPAGE],
  /* No member assignment anywhere in this one: Object.assign reaches the same setter through an
     object key, so a walk that only inspects AssignmentExpressions passes it. */
  ['[8] ops.html sets innerHTML through an object key', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, '    if (text != null) Object.assign(n, { innerHTML: text });'), '8', OPSPAGE],
  /* The two anti-vacuity floors. A clause that reads an empty string reports a clean sweep, which
     is the failure mode shared by checks 2, 5 and 13 — and by this one, since the regex it
     replaced would also have passed a page with no script at all. */
  ['[8] ops.html ships no inline script at all', 'ops.html', (s) => {
    const a = s.indexOf('<script>\n(function');
    const b = s.indexOf('</script>', a) + '</script>'.length;
    return s.slice(0, a) + s.slice(b);
  }, '8', OPSPAGE],
  ['[8] the ops walk resolves no property assignment', 'ops.html', (s) => {
    const a = s.indexOf('<script>\n(function');
    return s.slice(0, a + '<script>'.length) + '\nvar x = 1;\n' + s.slice(s.indexOf('</script>', a));
  }, '8', OPSPAGE],
  /* Added 2026-11-23 with the shared-AST walk. ops.html is parsed as PLAIN JavaScript — no `jsx`
     plugin — and that is a guard rather than an implementation detail: this page's only remote
     script is supabase-js, so it loads no Babel, and a JSX element in here is a SyntaxError the
     two admins' browsers hit at load, after which the feedback inbox renders nothing at all. The
     page has no suite of its own and the harness only republishes a copy of it, so the gate is
     the only thing that would ever say so. Before the walk shared one AST per source this was
     unreachable: every walk ran `presets:['react']`, so JSX here PARSED and the gate passed. */
  ['[8] ops.html grows a JSX element, which it loads no Babel to transform', 'ops.html',
    (s) => s.replace(OPS_SAFE_WRITE, '    const badge = <span>ops</span>;\n' + OPS_SAFE_WRITE),
    '8', OPSPAGE],
  /* The published-link clause, added 2026-11-11. Four breaks, one per `must()`, because a group of
     musts negative-tested as a group only proves that ONE of them has teeth.

     The first break is not hypothetical: it is PR #209's diff reduced to one line. That PR adds a
     Settings link to `terms.html`, copies the file into the harness tree so all 922 smoke
     assertions can drive it, and never adds it to deploy.yml — so it is green everywhere and a
     404 on badgebudget.com. Measured against the real PR head, this check is the only thing in
     the repo that goes red on it. */
  ['[8] index.html links to a page the deploy never copies', 'index.html',
    (s) => s.replace('<a href="privacy.html" target="_blank" rel="noopener"',
      '<a href="terms.html">Terms</a>\n        <a href="privacy.html" target="_blank" rel="noopener"'), '8', LINKS],
  /* The loop has to walk every published page, not just the app. ops.html is the second one, and
     a break that only ever fired on index.html would pass a check that reads one file. */
  ['[8] ops.html links to a page the deploy never copies', 'ops.html',
    (s) => s.replace('</body>', '<a href="admin-notes.html">notes</a></body>'), '8', LINKS],
  /* A computed attribute is invisible to a tag walk — the CSP check's blind spot and the reason
     the pdf.js worker needed a check of its own. Intended friction rather than a silent gap. */
  ['[8] a published page builds its href dynamically', 'index.html',
    (s) => s.replace('<a href="privacy.html" target="_blank" rel="noopener"',
      '<a href={PRIVACY_URL} target="_blank" rel="noopener"'), '8', LINKS],
  /* Anti-omission, the rule checks 2, 13 and the harness pin all take: a page whose attribute
     shape moves out from under the regex must FAIL, not pass for having nothing left to walk. */
  ['[8] a published page stops yielding attributes this walk can see', 'privacy.html',
    (s) => s.replace(/\b(href|src)="([^"]*)"/g, "$1='$2'"), '8', LINKS],
  /* ---- Invariant 9, rewritten 2026-11-24 ------------------------------------------------
     The check was ONE unanchored `deploy.includes('claude/migrate-to-github-deploy-3F5RD')` over
     the whole workflow file, printing the word `present`, and this suite held ONE break against
     it: rename the branch everywhere. Measured against that clause before the rewrite, FIVE
     realistic edits that stop every deploy left the gate printing `All 21 mechanical checks
     passed` — the branch line commented out, `branches:` turned into `branches-ignore:`, `push:`
     turned into `pull_request:`, a `paths:` filter added, and the `on:` block gutted to
     `workflow_dispatch:` with the name surviving in a job-level `if:`. Only the sixth, deleting
     the line outright, was caught, which is the one case the clause was written for.

     Fifteen breaks now, one per `must()` in the rewritten check, because a group of musts broken
     as a group only proves that ONE of them has teeth. `[9]` is held by a single check, so no
     break needs a label pin. Four of the fifteen are shapes the parser must REFUSE rather than
     guess at: there is deliberately no substring fallback, so an `on:` block written in a form
     this cannot read fails and gets classified on purpose. */
  ['[9] deploy branch renamed throughout the workflow', '.github/workflows/deploy.yml',
    (s) => s.split('claude/migrate-to-github-deploy-3F5RD').join('claude/some-other-branch'), '9'],
  /* The likeliest edit of all fifteen, and the old clause's worst miss: commenting a YAML list
     entry is how anyone cautiously "removes" one, and the comment directly above this line in the
     real file tells the reader to "Remove it from this list once work is merged into main." */
  ['[9] branch line commented out rather than deleted', '.github/workflows/deploy.yml',
    (s) => s.replace(`      - ${BR}`, `      # - ${BR}`), '9'],
  /* The only one that fails OPEN in the dangerous direction: the name is still in the file and is
     now explicitly EXCLUDED, so the old clause reported a branch as triggering a deploy while the
     workflow said the opposite. */
  ['[9] branches: becomes branches-ignore:', '.github/workflows/deploy.yml',
    (s) => s.replace('    branches:', '    branches-ignore:'), '9'],
  ['[9] push trigger becomes pull_request', '.github/workflows/deploy.yml',
    (s) => s.replace('  push:\n', '  pull_request:\n'), '9'],
  /* The break that proves the check no longer reads the branch name from ANYWHERE in the file:
     the triggers are gone and the name survives in a job-level `if:`, which is exactly what the
     old `includes()` keyed on. */
  ['[9] on: gutted to workflow_dispatch, name surviving in a job if:', '.github/workflows/deploy.yml',
    (s) => s.replace(/^on:\n[\s\S]*?  workflow_dispatch:\n/m, 'on:\n  workflow_dispatch:\n')
      .replace('    runs-on: ubuntu-latest', `    if: github.ref == 'refs/heads/${BR}'\n    runs-on: ubuntu-latest`), '9'],
  ['[9] a paths filter added under push', '.github/workflows/deploy.yml',
    (s) => s.replace(`      - ${BR}\n`, `      - ${BR}\n    paths:\n      - 'src/**'\n`), '9'],
  ['[9] push.branches keeps its key but loses every entry', '.github/workflows/deploy.yml',
    (s) => s.replace(/    branches:\n(      [-#].*\n)+/, '    branches:\n'), '9'],
  ['[9] push: becomes a sequence instead of a mapping', '.github/workflows/deploy.yml',
    (s) => s.replace(/  push:\n(    .*\n|      .*\n)+/, '  push:\n    - main\n'), '9'],
  /* Anti-omission, the rule every derived check in this gate takes: a missing subject FAILS, it
     never passes for having nothing left to read. */
  ['[9] the on: key removed entirely', '.github/workflows/deploy.yml',
    (s) => s.replace(/^on:\n([ ].*\n)+/m, ''), '9'],
  ['[9] on: written as a scalar this check will not guess at', '.github/workflows/deploy.yml',
    (s) => s.replace(/^on:\n([ ].*\n)+/m, 'on: push\n'), '9'],
  ['[9] a branch list written in flow style', '.github/workflows/deploy.yml',
    (s) => s.replace(/    branches:\n(      [-#].*\n)+/, `    branches: [main, ${BR}]\n`), '9'],
  ['[9] a line in the on: block that is not a mapping key', '.github/workflows/deploy.yml',
    (s) => s.replace('  workflow_dispatch:', '  garbage\n  workflow_dispatch:'), '9'],
  ['[9] content in the on: block at an indent this walk cannot place',
    '.github/workflows/deploy.yml',
    (s) => s.replace(`      - ${BR}\n`, `      - ${BR}\n     stray: value\n`), '9'],
  /* The structural half of the 2026-10-06..09 Pages stall — 72 hours, nine merged green commits
     unshipped — and the property NOTHING in this repo read until tonight. */
  ['[9] pages concurrency back to cancel-in-progress: false', '.github/workflows/deploy.yml',
    (s) => s.replace('cancel-in-progress: true', 'cancel-in-progress: false'), '9'],
  ['[9] the concurrency block deleted', '.github/workflows/deploy.yml',
    (s) => s.replace(/^concurrency:\n(  .*\n)+/m, ''), '9'],
  ['[9] concurrency written as a scalar, so cancel-in-progress is unreadable',
    '.github/workflows/deploy.yml',
    (s) => s.replace(/^concurrency:\n(  .*\n)+/m, 'concurrency: pages\n'), '9'],
  /* THREE checks share the `events` tag as of 2026-11-10, so every break below pins the label
     too — the same rule the fourteen `[2]` breaks follow, and for the same reason: `✗ [events]`
     alone would credit an inventory break to the keepalive check and count a break that failed
     the wrong row as a win. */
  ['[events] unload sender loses keepalive', 'index.html',
    (s) => s.split('keepalive: true').join('keepalive: false'), 'events', UNLOAD],
  /* ---- the unload telemetry's SEVENTEEN, added 2026-11-26 -------------------------------
     The clause these replaced was four unanchored regexes over the whole file, and it was wrong
     in BOTH directions: measured before the rewrite, seven of eight realistic breaks left the
     gate printing `All 21 mechanical checks passed` and all three behaviour-neutral edits turned
     it RED. One break per `must()` below, plus one per detector feeding a shared must — the two
     keepalive senders share one assertion and either can lose the flag alone, which is precisely
     how one regex came to stand for two mechanisms.

     Row "the senders are reached through window.fetch" is the odd one and belongs here on
     purpose: `window.fetch(…)` is behaviour-identical, so it is not a defect — but it is a shape
     this walk cannot resolve, and the check's stated rule is that anything unresolvable THROWS
     rather than reporting keepalive intact on a file it could not read. It is the anti-vacuity
     floor's break. */
  ['[events] the pagehide/visibilitychange listeners are never registered', 'index.html',
    (s) => s.replace(`    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return ()=>{ window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', onVis); };`,
      '    return ()=>{};'), 'events', UNLOAD],
  ['[events] endSession is never called from the unload flush', 'index.html',
    (s) => s.replace(`        endSession(uid, { setup: !!(d && d.setupComplete), shifts: nShifts,
                          ob: obMax.current >= 0 ? obMax.current : null });`,
      '        /* endSession(uid, …) — temporarily disabled */'), 'events', UNLOAD],
  ['[events] the unload flush stops flushing the error buffer', 'index.html',
    (s) => s.replace('        flushClientErrors(uid, true);\n', ''), 'events', UNLOAD],
  ['[events] the unload error flush drops its beacon flag', 'index.html',
    (s) => s.replace('flushClientErrors(uid, true);', 'flushClientErrors(uid);'), 'events', UNLOAD],
  /* Each sender alone. The pre-existing row above flips BOTH at once, which is exactly the
     grouping that let one regex pass for two mechanisms. */
  ['[events] the user_data unload flush alone loses keepalive', 'index.html',
    (s) => s.replace(`    fetch(SUPABASE_URL + '/rest/v1/user_data?on_conflict=user_id', {
      method: 'POST',
      keepalive: true,`, `    fetch(SUPABASE_URL + '/rest/v1/user_data?on_conflict=user_id', {
      method: 'POST',`), 'events', UNLOAD],
  ['[events] the events beacon alone loses keepalive', 'index.html',
    (s) => s.replace(`    fetch(SUPABASE_URL + '/rest/v1/events', {
      method: 'POST',
      keepalive: true,`, `    fetch(SUPABASE_URL + '/rest/v1/events', {
      method: 'POST',`), 'events', UNLOAD],
  ['[events] both unload senders are reached through window.fetch', 'index.html',
    (s) => s.split("    fetch(SUPABASE_URL + '/rest/v1/").join("    window.fetch(SUPABASE_URL + '/rest/v1/"),
    'events', UNLOAD],
  ['[events] flushClientErrors is renamed and a caller is missed', 'index.html',
    (s) => s.replace('function flushClientErrors(userId, viaBeacon){', 'function flushErrorBuffer(userId, viaBeacon){'),
    'events', UNLOAD],
  ['[events] flushClientErrors loses its beacon parameter', 'index.html',
    (s) => s.replace('function flushClientErrors(userId, viaBeacon){', 'function flushClientErrors(userId){'),
    'events', UNLOAD],
  ['[events] viaBeacon no longer gates beaconInsert', 'index.html',
    (s) => s.replace(`    if(viaBeacon) beaconInsert([eventRow('client_error', props, userId)]);
    else track('client_error', props, userId);`, "    track('client_error', props, userId);"),
    'events', UNLOAD],
  ['[events] endSession is renamed and a caller is missed', 'index.html',
    (s) => s.replace('function endSession(userId, extra){', 'function endLoad(userId, extra){'), 'events', UNLOAD],
  ['[events] session_end is renamed, the old name left in a comment', 'index.html',
    (s) => s.replace("    beaconInsert([eventRow('session_end', props, userId)]);",
      "    /* was 'session_end' */\n    beaconInsert([eventRow('session_exit', props, userId)]);"),
    'events', UNLOAD],
  ['[events] endSession returns before it sends the exit row', 'index.html',
    (s) => s.replace('function endSession(userId, extra){\n  try{', 'function endSession(userId, extra){\n  return;\n  try{'),
    'events', UNLOAD],
  ['[events] the ob_step event is renamed', 'index.html',
    (s) => s.replace("track('ob_step', {step:n}, null)", "track('ob_stage', {step:n}, null)"), 'events', UNLOAD],
  ['[events] markObStep loses its furthest-step guard', 'index.html',
    (s) => s.replace("    if(typeof n === 'number' && n > obMax.current){ obMax.current = n; track('ob_step', {step:n}, null); }",
      "    if(typeof n === 'number'){ obMax.current = n; track('ob_step', {step:n}, null); }"), 'events', UNLOAD],
  ['[events] the ob_step guard compares against a literal floor', 'index.html',
    (s) => s.replace("if(typeof n === 'number' && n > obMax.current){ obMax.current = n;",
      "if(typeof n === 'number' && n > 0){ obMax.current = n;"), 'events', UNLOAD],
  ['[events] the ob_step ref stops being a useRef binding', 'index.html',
    (s) => s.replace('  const obMax = useRef(-1);', '  const obMax = {current:-1};'), 'events', UNLOAD],
  /* The 2026-09-16 defect verbatim: step 0 becomes the one stage of the funnel that can never
     fire. The old clause DID catch this one — it pinned the declaration's exact text — which is
     why it also went red on hoisting the sentinel to a constant (a GREEN below). */
  ['[events] the ob_step ref is seeded at 0, not -1', 'index.html',
    (s) => s.replace('const obMax = useRef(-1);', 'const obMax = useRef(0);'), 'events', UNLOAD],
  /* ---- the harness neutraliser, derived 2026-11-27 ------------------------------------------
     Seven breaks, one per `must()`. The clause these replaced was two unanchored regexes over
     the whole file plus two literal call-site matches, and ALL SEVEN were measured GREEN against
     it (2026-11-27) while the three GREENS below were measured RED. This is the one property in
     the repo whose violation has already shipped: from 2026-09-07 to 09-16 every CI run inserted
     real rows into production `events`, and CLAUDE.md still records every activation figure since
     as inflated by that cohort. */
  ['[events] the harness neutraliser is neutered to the identity function', 'tests/harness.mjs',
    (s) => s.replace('function neutralizeSupabase(html, what) {',
      'function neutralizeSupabase(html, what) {\n  return html;'), 'events', NEUTRAL],
  /* One line, the shape anyone reaches for while debugging a scratch copy, and it restores the
     2026-09-07 defect verbatim. The swap is still in the tree and is now dead code, which is why
     the check needs a reachability clause rather than a search for the rewrite. */
  ['[events] the host swap is dropped, the connect-src widening kept', 'tests/harness.mjs',
    (s) => s.replace('    .split(REAL_SUPABASE_HOST).join(NEUTRAL_SUPABASE_HOST)\n', ''),
    'events', NEUTRAL],
  /* The old clause's sharpest miss: `/\.invalid'/` matched the EXPECTED_NETWORK list 100 lines
     further down, so repointing the neutral host at the real project was green. A whole-file
     regex cannot tell which occurrence it is standing on. */
  ['[events] the neutral host is repointed at the real project', 'tests/harness.mjs',
    (s) => s.replace("const NEUTRAL_SUPABASE_HOST = 'https://harness-must-never-write.invalid';",
      "const NEUTRAL_SUPABASE_HOST = 'https://mnnlgcxnvodjwlhhiphq.supabase.co';"), 'events', NEUTRAL],
  /* The call site the old clause pinned survives character for character; the bytes on disk are
     the production ones. Ordering is a property only a reader of the function can have. */
  ['[events] the index.html scratch page is written before it is neutralised', 'tests/harness.mjs',
    (s) => s.replace("  html = neutralizeSupabase(html, 'index.html');\n\n  writeFileSync(join(outDir, 'index.html'), html);",
      "  writeFileSync(join(outDir, 'index.html'), html);\n  html = neutralizeSupabase(html, 'index.html');"),
    'events', NEUTRAL],
  /* `includes()` over the whole file, so a COMMENT satisfied the old clause — Invariant 1's
     break (c) one file over, on the page that borrows the app's session. */
  ['[events] the ops.html scratch page stops being neutralised', 'tests/harness.mjs',
    (s) => s.replace("  html = neutralizeSupabase(html, 'ops.html');",
      "  /* html = neutralizeSupabase(html, 'ops.html'); */"), 'events', NEUTRAL],
  /* The two self-guards are what make the rewrite falsifiable at all: without them a moved host
     or a renamed CSP directive turns it into a no-op that reports success, which is how this
     went unnoticed for nine days of CI runs the first time. */
  ['[events] the neutraliser stops throwing when the production host is absent', 'tests/harness.mjs',
    (s) => s.replace(`  if (!html.includes(REAL_SUPABASE_HOST)) {
    throw new Error(\`\${what}: Supabase host not found — the harness can no longer prove it is offline\`);
  }
`, ''), 'events', NEUTRAL],
  ['[events] the neutraliser stops throwing when connect-src is missing', 'tests/harness.mjs',
    (s) => s.replace(`  if (!/connect-src /.test(html)) {
    throw new Error(\`\${what}: no connect-src in the meta CSP — the rewrite below would silently no-op\`);
  }
`, ''), 'events', NEUTRAL],
  /* The three anti-vacuity floors get their own breaks, because the clause this replaced would
     also have passed a harness with no functions in it at all. The third and fourth rows are
     CLASSIFICATION failures on purpose, not accusations of a bug: a write this check cannot
     resolve, or a module it cannot parse, is intended friction — the same rule Invariant 5's
     derivation takes for a storage key built from an unresolvable expression. */
  ['[events] harness.mjs is truncated to its constants, resolving no functions', 'tests/harness.mjs',
    (s) => s.slice(0, s.indexOf('function neutralizeSupabase')), 'events', NEUTRAL],
  ['[events] a scratch-page write goes through a local alias this check cannot resolve',
    'tests/harness.mjs',
    (s) => s.replace("  writeFileSync(join(outDir, 'ops.html'), html);",
      "  const wf = writeFileSync;\n  wf(join(outDir, 'ops.html'), html);"), 'events', NEUTRAL],
  ['[events] harness.mjs stops parsing, so the check must throw rather than shrug',
    'tests/harness.mjs',
    (s) => s.replace('function neutralizeSupabase(html, what) {',
      'function neutralizeSupabase(html, what) { var 0bad = ;'), 'events', NEUTRAL],
  /* The inventory check, added 2026-11-10. Five breaks, one per `must()` (counting the resolve
     clause's throw), because a group of musts negative-tested as a group only proves that ONE of
     them has teeth. Two of the five patch `scripts/dashboard_snapshot.mjs` rather than the app:
     the clause they cover is about the TOOL losing its sight, which is what happened in the
     first place. */
  ['[events] a tracking call gets a name the inventory cannot resolve', 'index.html',
    (s) => s.replace("track('app_open', appOpenProps(), null)", "track('app'+'_open', appOpenProps(), null)"), 'events', INVENTORY],
  ['[events] an events row is assembled inline instead of by eventRow', 'index.html',
    (s) => s.replace('supabase.from(\'events\').insert(eventRow(name, props, userId))',
      "supabase.from('events').insert({name:String(name).slice(0,64), props:props||null, user_id:userId||null, anon_id:anonId()})"), 'events', INVENTORY],
  /* Anti-omission, both directions: a renamed write path must FAIL, never pass by leaving the
     clause nothing to inspect. */
  ['[events] the supabase events writer is renamed away', 'index.html',
    (s) => s.replace("supabase.from('events').insert(eventRow(name, props, userId))",
      "supabase.from(EVENTS_TABLE).insert(eventRow(name, props, userId))"), 'events', INVENTORY],
  ['[events] the keepalive events writer is renamed away', 'index.html',
    (s) => s.split('beaconInsert(').join('beaconSend('), 'events', INVENTORY],
  /* The one with no other home in CI: the walk reverts to a bare-literal scan, the eight names
     the two newest money features file go missing, and dead_events starts lying again. */
  ['[events] the inventory stops walking the wrapper callees', 'scripts/dashboard_snapshot.mjs',
    (s) => s.replace("new Set(['track', 'trackOb', 'trackDeferred', 'eventRow'])", "new Set(['track', 'trackDeferred'])"), 'events', INVENTORY],
  /* The harness-pin check, added 2026-11-01. FIVE breaks, one per `must()` group, because a group
     of musts negative-tested as a group only proves that ONE of them has teeth. The tag is unique
     so no label pin is needed — the convention the eight `[2]` worker breaks follow in reverse. */
  /* (2) the quiet one: the url says one version, PKGS installs another, and the MAP target carries
     no version at all, so the scratch copy serves the installed build and 883 assertions pass
     against code the app does not ship. This is the break the whole check exists for. */
  ['[harness] PKGS installs a different version than the pin it serves', 'tests/harness.mjs',
    (s) => s.replace("'react@18.2.0',", "'react@18.3.1',"), 'harness'],
  /* (1) forward direction: a bumped CDN pin with a stale MAP. buildScratch throws on this, which
     ABORTS the suite — an aborted run is not a failed assertion, so the gate must say it. */
  ['[harness] a MAP url is no longer the one index.html loads', 'tests/harness.mjs',
    (s) => s.replace('https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js',
      'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'), 'harness'],
  /* (4) a sixth remote script that MAP never rewrites keeps its real CDN url, loses its integrity
     attribute to the blanket strip, and is fetched from the open internet on any runner with a
     network. buildScratch's `n < MAP.length` count cannot see it. */
  ['[harness] a sixth CDN script escapes the rewrite', 'index.html',
    (s) => s.replace('<style>', '<script src="https://unpkg.com/dayjs@1.11.13/dayjs.min.js"></script>\n<style>'), 'harness'],
  /* (3) ops.html is the second page the harness builds and finds its row by substring. */
  ['[harness] ops.html stops loading the supabase pin the harness rewrites', 'ops.html',
    (s) => s.replace('@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
      '@supabase/supabase-js@2.45.5/dist/umd/supabase.min.js'), 'harness'],
  /* Anti-omission, the rule checks 2 and 13 both take: a renamed table must FAIL, not pass by
     leaving nothing to compare. */
  ['[harness] the MAP table is renamed away', 'tests/harness.mjs',
    (s) => s.replace('\nconst MAP = [', '\nconst REWRITES = [').split('of MAP)').join('of REWRITES)'), 'harness'],
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

/* ---- GREENS: the direction a false positive hides in -----------------------------------
   Added 2026-11-19 with the privacy.html self-containment rewrite. Every assertion above asks
   "does a break go red?", and a check can be wrong in the other direction too: one false positive
   on an ordinary edit gets the check WEAKENED by whoever meets it, which is how a mechanism with
   teeth acquires a carve-out. Three edits that must leave the gate GREEN, each of them something the
   new walk could plausibly have flagged:

     1. An outbound link. A privacy notice linking to a third party's page is normal and makes no
        request — `<a href>` fetches nothing, and the exemption is named in the check's comment.
        Flagging it would invent a rule the claim "makes no third-party requests" does not make.
     2. A `data:` URI whose PAYLOAD contains an absolute URL. The live favicon already carries
        `http://www.w3.org/2000/svg` as an XML namespace, which is an identifier and never a
        fetch, so a blanket grep for `http` would fail on today's clean page — and the repair
        someone would reach for, exempting w3.org, is worse than the hole it closed. The rule is
        that a URL is classified by how its value STARTS; this adds a second such URI so the
        favicon is not passing by some accident of its own position.

     3. ops.html writing its script attributes in a different order (added 2026-11-20 with the
        ops.html SRI clauses). The tempting implementation of "the console's pin is a row the app
        also ships" is a string match on the whole tag, which is green today because both files
        happen to write `crossorigin integrity src` in that order, and red the first time anyone
        reformats either one. It was negative-tested the opposite way from the other two: swap
        the comparison for `html.includes(r.tag)` and this row goes red while all five ops.html
        breaks still pass (measured 2026-11-20, 75 passed / 1 failed). This is the only row in
        the suite that catches it.

   All three were negative-tested, and the first one earns its place on a measurement rather than
   on the argument: an implementation that counts `<a href>` as a fetch PASSES today's clean page
   (measured 2026-11-19 — `All 21 mechanical checks passed`, because the live notice links only to
   a mailto: and "/"), so the `teeth: clean scratch copy passes` baseline cannot see it, and it
   goes red the first time anyone links out to the IRS. Green 1 is the only row in this suite that
   catches that. Green 2's own over-reject — a blanket `https?:` test on the whole value — is
   coarser and fails the baseline too, which is why it is labelled a control and not a clause.

   What neither control can do: catch a walk wired to the wrong file, or one that reads an empty
   string and reports a clean sweep. The breaks above cover both. */
const GREENS = [
  /* ---- Invariant 9's seven, added 2026-11-24 ---------------------------------------------
     The clause these replaced was a bare `includes()`, so it was green on literally every edit;
     a structural read can be wrong in the OTHER direction, and that is the direction that gets a
     check weakened by whoever meets it. Each row below is a behaviour-neutral edit to the deploy
     workflow that an obvious implementation of this check would have flagged.

     Row 4 is the most valuable: the obvious way to hold `cancel-in-progress: true` is
     `deploy.includes('cancel-in-progress: true')`, which is red the moment anyone quotes the
     value — and quoting a YAML boolean is exactly what a linter suggests.

     Row 7 is earned by a MEASUREMENT taken in this session rather than by an argument: the first
     draft of the rewritten check parsed the whole file from the root and went RED on the real,
     unedited workflow, because `jobs:` holds sequences-of-mappings and `run: |` block scalars it
     makes no claim about. The fix was to scope the parse to the `on:` and `concurrency:` regions.
     The clean baseline above cannot see that class of mistake once it is fixed; this row can. */
  ['the branch list is reordered', '.github/workflows/deploy.yml',
    (s) => s.replace(/    branches:\n      - main\n      - master\n((?:      #.*\n)*)      - claude\/migrate-to-github-deploy-3F5RD\n/,
      `    branches:\n      - ${BR}\n      - main\n      - master\n`)],
  ['the branch name is quoted', '.github/workflows/deploy.yml',
    (s) => s.replace(`      - ${BR}`, `      - '${BR}'`)],
  /* The inverse of the commented-out break: a comment INSIDE the list is ordinary, and a walk
     that counted comment lines as entries — or read entries by line offset — would flag it. */
  ['a comment is added inside the branch list', '.github/workflows/deploy.yml',
    (s) => s.replace('    branches:\n', '    branches:\n      # deploy targets, longest-lived first\n')],
  ['cancel-in-progress is written as a quoted boolean', '.github/workflows/deploy.yml',
    (s) => s.replace('cancel-in-progress: true', 'cancel-in-progress: "true"')],
  ['the concurrency block is moved above the on: block', '.github/workflows/deploy.yml',
    (s) => {
      const blk = s.match(/^concurrency:\n(?:  .*\n)+/m)[0];
      return s.replace(blk, '').replace(/^on:/m, blk + '\non:');
    }],
  ['an unrelated top-level key is added to the workflow', '.github/workflows/deploy.yml',
    (s) => s.replace(/^permissions:/m, 'env:\n  TZ: UTC\n\npermissions:')],
  ['a step is added to the jobs: block', '.github/workflows/deploy.yml',
    (s) => s.replace('      - name: Upload artifact',
      '      - name: Echo\n        run: echo hi\n\n      - name: Upload artifact')],
  /* `on` is a YAML 1.1 boolean, so yamllint's `truthy` rule suggests writing it as `"on":`. A
     check that looked for the literal line `on:` would read that as a workflow with no triggers
     at all and fail on a file that deploys perfectly well. Caught in review of this very
     rewrite: the first version compared the whole line with `startsWith('on:')` after stripping
     only the outer quotes, so `"on":` became `on":` and did not match. */
  ['the on: key is quoted, as a YAML linter suggests', '.github/workflows/deploy.yml',
    (s) => s.replace(/^on:/m, '"on":')],
  /* Added 2026-11-20 with the ops.html SRI clauses. Those compare index.html's row to ops.html's
     by url and hash, and the tempting implementation is a string match on the whole tag — which
     would be green today (both files write the attributes in the same order) and red the first
     time anyone reformats one of the two. So the rows are read attribute by attribute, and this
     is the only row in the suite that says so: `src` moved to the front, same url, same hash. */
  ['ops.html writes its script attributes in a different order', 'ops.html',
    (s) => s.replace(/<script crossorigin="anonymous" integrity="(sha384-[^"]*)" src="([^"]*)">/,
      '<script src="$2" integrity="$1" crossorigin="anonymous">')],
  /* Added 2026-11-21 with the ops.html HTML-sink walk. Both guard the same false positive from
     two sides: the tempting repair for "the regex only knew one spelling" is a wider regex, and
     a wider regex reads PROSE. The clean baseline cannot catch that — ops.html already says
     "never innerHTML" in a `//` comment on the very line being guarded, so a naive grep is red
     before either of these edits exists. What it cannot see is a grep that strips `//` comments
     first, which is green today and red on both of these. An AST sees neither. */
  ['ops.html documents the rule in a block comment naming every sink', 'ops.html',
    (s) => s.replace('  function el(tag, cls, text) {',
      '  /* Renders with textContent only: never innerHTML, never outerHTML, never\n'
      + '     insertAdjacentHTML, never document.write. */\n  function el(tag, cls, text) {')],
  /* The StringLiteral detector is the one most likely to over-reject, because it is the only one
     that reads a value rather than a shape. It is anchored for exactly this: a sink NAME standing
     alone can index into the setter, a sentence mentioning one cannot. */
  ['ops.html shows a visible note whose text mentions innerHTML', 'ops.html',
    (s) => s.replace("sub.textContent = '';",
      "sub.textContent = '';\n    main.appendChild(el('p', 'empty', 'rendered with textContent, never innerHTML'));")],
  /* Added 2026-11-22 with the Invariant 4 derivation. The first two are the false positives the
     OLD clause actually had: its regex pinned the upsert payload's property ORDER and the
     options object's exact spacing, so both of these edits — which change no behaviour at all —
     turned the gate red with the message "the user_data upsert lost {onConflict:'user_id'}".
     That is the direction that gets a check weakened: anyone who formats this file meets a false
     accusation about the one invariant with a live production signal, and the obvious repair is
     to loosen the pattern. Negative-tested the opposite way: put the old regex back and both of
     these go red while ten of the eleven `[4]` breaks go green. The clean baseline cannot see
     either of them, which is the whole reason they are rows. */
  ['the user_data upsert payload writes its keys in a different order', 'index.html',
    (s) => s.replace('.upsert({user_id:userId, data, updated_at:updatedAt}',
      '.upsert({updated_at:updatedAt, data, user_id:userId}')],
  ['the upsert options are written with ordinary spacing', 'index.html',
    (s) => s.replace("{onConflict:'user_id'}", "{ onConflict: 'user_id' }")],
  /* A raw REST READ of user_data. The tempting shortcut for the raw half is "any fetch whose url
     mentions /rest/v1/user_data must carry ?on_conflict=user_id", which is green today because
     the only raw call this app makes to that table is the keepalive POST — so the baseline
     cannot see it, and it would go red the first time anyone reads the row over raw REST (which
     the hydrate path has reason to: supabase-js cannot be trusted inside an unload handler, and
     the same argument applies to a cold-load race). A conflict target is a property of a WRITE;
     the method is what decides. */
  ['user_data is READ over raw REST with no conflict target', 'index.html',
    (s) => s.replace('function beaconSaveUserData(userId, data){',
      'function peekUserData(){\n'
      + "  return fetch(SUPABASE_URL + '/rest/v1/user_data?select=updated_at', "
      + '{headers:{apikey:SUPABASE_ANON_KEY}});\n}\n'
      + 'function beaconSaveUserData(userId, data){')],
  ['privacy.html links out to a third party with <a href>', 'privacy.html',
    (s) => s.replace('</body>', '<p><a href="https://www.irs.gov/publications/p15">IRS Pub 15</a></p>\n</body>')],
  ['privacy.html carries a data: image whose payload names a remote host', 'privacy.html',
    (s) => s.replace('</body>',
      '<img alt="" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ctitle%3Ehttps://example.com%3C/title%3E%3C/svg%3E">\n</body>')],
  /* Added 2026-11-23 with the shared-AST walk, and this one guards a FIGURE rather than a verdict.
     Every walk in the gate used to get its tree from `Babel.transform(…, presets:['react'])`, and
     under that preset a call inside a JSX attribute is visited TWICE — once in the JSX tree, once
     again after the transform re-inserts the same expression as an argument to
     `React.createElement`. Invariant 5's check tallied visitor invocations, so it printed
     `45 sites` for the eight nights after the derivation shipped while index.html holds exactly
     35 (`grep -cE '(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(' index.html`
     → 35). Nothing could see it: the figure is not a verdict, the gate passed either way, and no
     row in this suite read it.
     The fix is not "parse without the preset" — that would make the number right today and leave
     it one preset away from wrong again. Sites are keyed on their node's own offset, so the count
     is right however many passes a future walk makes. This row proves exactly that: it puts the
     old react-preset transform BACK inside walk(), which restores the double-visit, and requires
     the figure to stay 35. Measured 2026-11-23 — under the pre-fix tally this same edit printed
     45. The clean baseline cannot see any of it, which is why it is a row. */
  ['walk() goes back to a react-preset transform, double-visiting every JSX attribute',
    'scripts/check_build.mjs',
    /* The whole helper goes back, because the double-visit is caused by the visitor being
       registered AS A BABEL PLUGIN during the transform — the preset's passes then run it again
       over the nodes the JSX transform rewrote. Traversing a transformed AST separately does NOT
       reproduce it, and a first draft of this row did exactly that and passed with the fix
       reverted, which is the kind of unfalsifiable assertion this file exists to refuse. */
    (s) => s.replace(
      /const walk = \(code, visitor, plugins = \['jsx'\], sourceType = 'script'\) => \{[\s\S]*?\n\};/,
      "const walk = (code, visitor, plugins = ['jsx'], sourceType = 'script') => {\n"
      + "  require('@babel/standalone').transform(code, { sourceType, code: false,\n"
      + "    ast: false, presets: plugins.includes('jsx') ? ['react'] : [],\n"
      + "    plugins: [() => ({ visitor })] });\n"
      + "  parses += 1;\n  walks += 1;\n};"),
    { claim: 'the storage-site figure stays 35, so it counts sites and not visits',
      row: /\[5\].*$/m,
      test: (out) => /\[5\][^\n]*\b35 sites\b/.test(out) }],
  /* ---- Invariant 1's three, added 2026-11-25 ---------------------------------------------
     All three are MEASURED false positives of the clause this check replaced: each one is
     behaviour-neutral and each one turned the old gate RED. That is the direction that gets a
     check weakened by whoever meets it, and a linter will suggest all three. */
  /* ---- the unload telemetry's three, added 2026-11-26 ------------------------------------
     All three were RED against the clause this replaced, and each is an edit a reviewer or a
     linter suggests. They are the whole reason the rewrite is not simply "widen the regexes":
     the old clause pinned a local variable's NAME, an argument list's exact text and a
     declaration's exact spelling including its semicolon, so the three cheapest readability
     edits on this path all accused the one check standing for the exit row.

     Row 3 is the subtle one. `flushClientErrors(uid, true)` is a positional boolean, and
     annotating it is the standard remedy — but the old clause matched the call site's literal
     text, so the remedy was a gate failure saying "the error buffer no longer flushes on
     unload", about a line that still flushes it. */
  ['the unload flush renames its local uid to userId', 'index.html',
    (s) => s.replace('        const uid = (snap && snap.user) ? snap.user.id : null;',
      '        const userId = (snap && snap.user) ? snap.user.id : null;')
      .replace('        endSession(uid, { setup:', '        endSession(userId, { setup:')
      .replace('        flushClientErrors(uid, true);', '        flushClientErrors(userId, true);')],
  ['the ob_step ref sentinel is hoisted to a named constant', 'index.html',
    (s) => s.replace('  const obMax = useRef(-1);', '  const OB_STEP_NONE = -1;\n  const obMax = useRef(OB_STEP_NONE);')],
  ['the viaBeacon positional boolean gets a name comment', 'index.html',
    (s) => s.replace('        flushClientErrors(uid, true);', '        flushClientErrors(uid, /* viaBeacon */ true);')],
  ['the boot watchdog delay is hoisted to a named constant', 'index.html',
    (s) => s.replace('  window.__bootError = null;', '  window.__bootError = null;\n  var BOOT_WATCHDOG_MS = 8000;')
      .replace('  }, 8000);', '  }, BOOT_WATCHDOG_MS);')],
  /* Optional chaining is the modern spelling of this exact guard, and behaviour-identical here:
     `window.supabase?.createClient` is falsy by the same two routes the `&&` form is. */
  ['the client null-guard is written with optional chaining', 'index.html',
    (s) => s.replace('const supabase = (window.supabase && window.supabase.createClient)',
      'const supabase = (window.supabase?.createClient)')],
  ['the 4s getSession timeout is hoisted to a named constant', 'index.html',
    (s) => s.replace('const sleepMs = ms => new Promise(r=>setTimeout(r, ms));',
      'const AUTH_CHECK_TIMEOUT_MS = 4000;\nconst sleepMs = ms => new Promise(r=>setTimeout(r, ms));')
      .replace("withTimeout(supabase.auth.getSession(), 4000, 'auth check')",
        "withTimeout(supabase.auth.getSession(), AUTH_CHECK_TIMEOUT_MS, 'auth check')")],
  /* ---- the harness neutraliser's three, added 2026-11-27 ---------------------------------
     Two of these were MEASURED red against the clause the derived check replaced, which is the
     whole argument for the row: the old clause is green on today's clean file, so nothing but a
     GREEN can see it come back. A check that pins the constant's NAME flags the first, and one
     that pins the call site's literal text flags the second — and the second is the same shape
     as the 11-26 `uid` → `userId` row, one file over. */
  ['the neutral-host constant is renamed', 'tests/harness.mjs',
    (s) => s.split('NEUTRAL_SUPABASE_HOST').join('OFFLINE_SUPABASE_HOST')],
  ['the scratch page local is renamed html → doc in buildOpsScratch', 'tests/harness.mjs',
    (s) => {
      const i = s.indexOf('export function buildOpsScratch');
      const j = s.indexOf('const MIME =', i);
      return s.slice(0, i) + s.slice(i, j).replace(/(?<![.\w])html\b/g, 'doc') + s.slice(j);
    }],
  /* `split(x).join(y)` and `replaceAll(x, y)` are the same operation for a plain string with no
     `$` in the replacement. A check that pinned the method would flag the modern spelling. */
  ['the host swap is spelled with replaceAll instead of split/join', 'tests/harness.mjs',
    (s) => s.replace(`    .split(REAL_SUPABASE_HOST).join(NEUTRAL_SUPABASE_HOST)
    .split('connect-src ').join(\`connect-src \${NEUTRAL_SUPABASE_HOST} \`);`,
      `    .replaceAll(REAL_SUPABASE_HOST, NEUTRAL_SUPABASE_HOST)
    .replaceAll('connect-src ', \`connect-src \${NEUTRAL_SUPABASE_HOST} \`);`)],
  /* ---- the publish set's six, added 2026-11-28 -------------------------------------------
     Two of these are not hypothetical: they are MEASURED false positives of the clause this
     replaced. `cp -v index.html _site/` and consolidating the five near-identical lines to
     `cp index.html CNAME _site/` both turned the old gate RED, and the second one printed
     `CNAME dropped from the publish set — the site falls off badgebudget.com` about a line that
     copies CNAME. That is the shape that gets a check weakened by whoever meets it, and it broke
     the SIBLING check at the same time, because that one held a second copy of the same regex.

     Negative-tested in both directions and both measured (2026-11-28): neuter the derivation and
     all eleven `[8]`-pubset breaks stop failing while all six of these stay green (0 still red,
     6/6); restore the old regex and seven of the eleven breaks pass a deliberately broken
     workflow while EXACTLY the two rows below go red (4 still red, 4/6 green). The clean
     baseline cannot see either of those two, which is the whole reason they are rows. */
  ['a flag is added to one cp line', '.github/workflows/deploy.yml',
    (s) => s.replace('          cp index.html _site/', '          cp -v index.html _site/')],
  ['the five near-identical cp lines are consolidated', '.github/workflows/deploy.yml',
    (s) => s.replace(/          cp index\.html _site\/\n/, '')
      .replace('          cp CNAME _site/', '          cp index.html CNAME _site/')],
  ['the cp lines are reordered', '.github/workflows/deploy.yml',
    (s) => s.replace(/          cp index\.html _site\/\n          cp pdf\.worker\.min\.js _site\/\n/,
      '          cp pdf.worker.min.js _site/\n          cp index.html _site/\n')],
  /* The artifact path is a YAML scalar, so its quoting is the author's choice and a trailing
     slash on a directory is idiomatic. A check that compared the raw text would flag both. */
  ['the artifact path is written unquoted', '.github/workflows/deploy.yml',
    (s) => s.replace("path: '_site'", 'path: _site')],
  ['the artifact path carries a trailing slash', '.github/workflows/deploy.yml',
    (s) => s.replace("path: '_site'", "path: '_site/'")],
  /* The same YAML 1.1 truthy trap Invariant 9's rewrite hit: this check shares that tokeniser
     now, so the quoted spelling has to stay green here too. Both checks read the same file, and a
     reader that only one of them survives is a reader with two behaviours. */
  ['`on:` is quoted, as yamllint suggests', '.github/workflows/deploy.yml',
    (s) => s.replace('\non:\n', '\n"on":\n')],
];

for (const [name, file, fn, also] of GREENS) {
  buildScratch();
  let greenPatched = true;
  try { patch(file, fn); } catch (e) { greenPatched = false; ok(`greens: ${name}`, false, e.message); }
  if (!greenPatched) continue;
  const g = runGate();
  ok(`greens: ${name} — the gate stays green`, g.code === 0,
    g.code === 0 ? '' : `exited ${g.code}: ${(g.out.match(/\u2717 .*/) || ['no red row'])[0].slice(0, 180)}`);
  /* A green exit is not always the whole claim. Where an edit must also leave a FIGURE alone,
     the row carries a predicate over the gate's output: "it still passed" would be satisfied by
     a gate that passed while printing a number nothing reads. */
  if (also) ok(`greens: ${name} — ${also.claim}`, also.test(g.out),
    (g.out.match(also.row) || ['that row was not printed'])[0].trim().slice(0, 160));
}

rmSync(SCRATCH, { recursive: true, force: true });

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
