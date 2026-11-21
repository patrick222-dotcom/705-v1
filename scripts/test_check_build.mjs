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
 *   GREENS  — three edits that must leave the gate GREEN (added 2026-11-19, a third 2026-11-20).
 *             TEETH only ever asks
 *             "does a break go red?", and a check can be wrong in the other direction: one false
 *             positive on an ordinary edit gets the check weakened by whoever meets it. See the
 *             GREENS block at the foot of this file for what each one guards.
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
  [4, "saveToSupabase upserts on {onConflict:'user_id'}"],
  [5, 'Storage keys unrenamed'],
  [6, '@scrubpay .ics sentinel, both halves'],
  [8, 'Publish set is exactly the intended files'],
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
/* `[8]` became a shared tag the moment a third check joined it (2026-11-11) — and it had ALREADY
   been shared by two since 2026-09-13 with neither break pinning a label, so `✗ [8]` from the ops
   row would have been counted as a win for the CNAME break. That is the same hole the 2026-10-30
   run fixed for `[2]` and the 2026-11-10 run fixed for `[events]`, still open in a third band.
   All five `[8]` breaks now pin the label. */
const SRI = 'SRI on every CDN script the publish set loads';
const PUBSET = 'Publish set is exactly the intended files';
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
  ['[4] the user_data upsert loses onConflict', 'index.html',
    (s) => s.replace("{onConflict:'user_id'}", '{}'), '4'],
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
  ['[9] deploy branch removed from the triggers', '.github/workflows/deploy.yml',
    (s) => s.split('claude/migrate-to-github-deploy-3F5RD').join('claude/some-other-branch'), '9'],
  /* THREE checks share the `events` tag as of 2026-11-10, so every break below pins the label
     too — the same rule the fourteen `[2]` breaks follow, and for the same reason: `✗ [events]`
     alone would credit an inventory break to the keepalive check and count a break that failed
     the wrong row as a win. */
  ['[events] unload sender loses keepalive', 'index.html',
    (s) => s.split('keepalive: true').join('keepalive: false'), 'events', UNLOAD],
  ['[events] harness stops neutralising Supabase', 'tests/harness.mjs',
    (s) => s.split('NEUTRAL_SUPABASE_HOST').join('REAL_SUPABASE_HOST'), 'events', NEUTRAL],
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
  ['privacy.html links out to a third party with <a href>', 'privacy.html',
    (s) => s.replace('</body>', '<p><a href="https://www.irs.gov/publications/p15">IRS Pub 15</a></p>\n</body>')],
  ['privacy.html carries a data: image whose payload names a remote host', 'privacy.html',
    (s) => s.replace('</body>',
      '<img alt="" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ctitle%3Ehttps://example.com%3C/title%3E%3C/svg%3E">\n</body>')],
];

for (const [name, file, fn] of GREENS) {
  buildScratch();
  let greenPatched = true;
  try { patch(file, fn); } catch (e) { greenPatched = false; ok(`greens: ${name}`, false, e.message); }
  if (!greenPatched) continue;
  const g = runGate();
  ok(`greens: ${name} — the gate stays green`, g.code === 0,
    g.code === 0 ? '' : `exited ${g.code}: ${(g.out.match(/\u2717 .*/) || ['no red row'])[0].slice(0, 180)}`);
}

rmSync(SCRATCH, { recursive: true, force: true });

console.log(`\n${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
