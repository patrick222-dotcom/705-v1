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
 * Scope: only what a machine can check honestly. Six invariants are human-held and are listed as
 * UNCHECKED in the output rather than silently omitted: 3 (wage-core), 7 (the swap salt, which
 * lives in a deployed Postgres function this repo cannot see), 10 (fetch before touching the
 * deploy branch), 11 (protected branches), 12 (registrar settings) and 13 (the iCal feed URL as a
 * bearer credential). 7 and 13 were missing from that roll-call until 2026-09-13 — neither checked
 * nor declared, which is the silent omission this comment exists to forbid.
 *
 * 3 and 13 are PARTLY gated, and both say which part: 3's persona rule (2026-10-10), and 13's
 * three mechanical clauses — the feed field staying out of the single serializer and the proxy
 * logging nothing (2026-10-26), and the .ics parser keeping no titles (2026-10-29). The clauses a
 * machine cannot honestly check stay human-held, and the roll-call keeps naming them, because
 * "13 is checked" would be a worse claim than "13 is not".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { buildCore, OUT as CORE_OUT } from './extract_core.mjs';
import { cosViolations } from './cos_check.mjs';
import { trackCallSites } from './dashboard_snapshot.mjs';

const require = createRequire(import.meta.url);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const html = read('index.html');
const ops = read('ops.html');
const deploy = read('.github/workflows/deploy.yml');
/* Invariant 13's second clause lives in the Edge Function, not in the app. */
const proxy = read('supabase/functions/ical-proxy/index.ts');

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

/* ---- one AST per source, shared by every walking check --------------------------------------
   Ten of the checks below are AST WALKS, and each one used to call
   `Babel.transform(body, { presets:['react'], plugins:[{visitor}] })` to get its tree. That is
   a full parse AND a full JSX transform per check, of the same 512KB inline script, measured at
   ~550ms each — so the gate spent ~5.5 of its 6.0 seconds re-deriving a tree it already had.
   `scripts/test_check_build.mjs` runs the gate once per deliberate break, so that multiplied by
   88 and put the gate's own meta-test at ~8 minutes, which is the figure that turned "add one
   line to CI" into a question about CI minutes.

   Parsing once and traversing the cached tree is not only cheaper, it is more HONEST about what
   these checks walk. `presets:['react']` rewrites every JSX element into a `React.createElement`
   call before the visitor runs, so the old trees carried 11,090 CallExpressions where the source
   has 3,482 — 69% of the nodes every walk visited were Babel's output, not the app's source.
   That is harmless today (a synthesized `createElement` call does not look like
   `localStorage.getItem` or `.from('user_data')`), but several of these checks count nodes as an
   anti-vacuity floor, and a floor that counts synthesized nodes is a floor that can be met by
   JSX alone. The walks now see the file as written.

   NOT used by the `build` check above, deliberately: its whole job is to prove the JSX really
   TRANSFORMS under the exact Babel build the browser loads, so it must stay a real `transform`
   and pay the full cost once. A parse-only check there would pass on JSX that parses and then
   fails to transform in front of a visitor.

   The cache is keyed on the source AND the parser options, because a future walk that needs a
   different plugin set must not be handed this one's tree. `parses` is printed in the summary so
   the saving is asserted rather than claimed — `test_check_build.mjs` pins it. */
let parses = 0, walks = 0;
const astCache = new Map();
const walk = (code, visitor, plugins = ['jsx'], sourceType = 'script') => {
  const key = `${sourceType}\u0000${plugins.join(',')}\u0000${code}`;
  let ast = astCache.get(key);
  if (!ast) {
    const { parser } = require('@babel/standalone').packages;
    ast = parser.parse(code, { sourceType, plugins, errorRecovery: false });
    astCache.set(key, ast);
    parses += 1;
  }
  const traverse = require('@babel/standalone').packages.traverse;
  (traverse.default || traverse)(ast, visitor);
  walks += 1;
};

/* ---- the two inline scripts, sliced identically everywhere ------------------------------------
   `index.html` holds exactly two: the plain-JS boot script (Invariant 1's watchdog, null-guard
   and ring buffer) and the Babel-transformed JSX block. Three checks need them, and they must be
   sliced the same way by all three — the AST cache above is keyed on the source STRING, so a
   second spelling of this loop would silently double the parse count the summary asserts. */
const inlineScripts = () => {
  const inline = [];
  for (let at = html.indexOf('<script'); at !== -1; at = html.indexOf('<script', at + 1)) {
    const tagEnd = html.indexOf('>', at);
    const tag = html.slice(at, tagEnd + 1);
    if (/\ssrc=/.test(tag)) continue;              // the 5 CDN scripts — Invariant 2's business
    inline.push({ tag, body: html.slice(tagEnd + 1, html.indexOf('</script>', tagEnd)) });
  }
  return inline;
};

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
/* ---- Invariant 1: boot hardening, READ rather than grepped -------------------------------
   This check was five substrings standing in for the four properties that make the app boot at
   all, and its label printed all four as words: `watchdog + null-guard + 4s getSession race +
   error buffer`. Invariant 1 is the one with `Detect: none` — a device that never boots never
   fires `app_open` and never flushes the error buffer, so the iPhone spinner these three
   mechanisms were written to kill was invisible in analytics for its entire life — and its blast
   radius is every WebKit device, iPhone Chrome included, app unusable and silent.

   Measured 2026-11-25 against the old clause, before any of this was written. SEVEN realistic
   edits left the gate printing `All 21 mechanical checks passed`, and THREE behaviour-neutral
   ones turned it RED. That is the worst available shape — green on every edit that breaks the
   app, red on every edit that does not — and the red half is the half that gets a check
   weakened by whoever meets it.

   The seven that passed:
   (a) `withTimeout` neutered to `(p, ms, label) => p`. One line, the shape anyone reaches for
       while debugging, and it removes the race from getSession AND from all 30-odd other call
       sites at once. The old regex matched the CALL, so it still matched; the WebKit deadlock it
       exists to bound was simply gone. The single most dangerous of the seven.
   (b) `return;` at the top of the watchdog callback. The 8s timer still fires, `}, 8000);` still
       matches, and the splash is never replaced — which is the infinite spinner this invariant
       was created to fix, restored verbatim with the gate green.
   (c) `createClient` called unguarded with the old guard left behind as a comment. Three of the
       five clauses were `includes()`/regex over the whole 580KB file, so a COMMENT satisfied
       them: the app now hard-fails whenever the CDN does, which is the degradation the
       null-guard is the entire defence against.
   (d) `window.__logClientError` no-opped with a leading `return`. The substring still matched the
       assignment. CLAUDE.md names this exact edit as the dangerous direction for the console
       mirror — "a mirror that drops categories of message is how the 47-day sync outage stayed
       invisible" — and the gate could not see it.
   (e) `window.__bootError`'s assignments removed, the name surviving in a comment.
   (f) the watchdog bumped to 30s with an unrelated 8-second timer added elsewhere in the file.
       `/\}, 8000\);/` is unanchored over the whole document, so it never cared WHICH timer it
       found; any future 8s toast re-arms the clause permanently.
   (g) the getSession race dropped at the call site, its shape surviving in a comment.

   The three that failed, all behaviour-neutral: hoisting the watchdog delay to a named constant,
   writing the null-guard as `window.supabase?.createClient`, and hoisting the 4s timeout to a
   named constant. Optional chaining is the modern spelling of that exact guard and a linter will
   suggest all three.

   So the four properties are read from the two inline scripts' ASTs instead. A comment cannot
   satisfy an AST walk, which is most of the fix; the rest is that each property is now asserted
   where it actually lives. `withTimeout` must BE a race, not merely be called. The watchdog is
   identified by the error screen it writes rather than by its delay, so the delay can then be
   resolved through a constant binding and compared. Anything unresolvable THROWS: there is no
   substring fallback, because a check that shrugs at a boot script it cannot read is the hole
   being replaced.

   The two cheap presence tests are KEPT on purpose, ahead of the walks: they are substring tests
   over the whole file and they fire even if the derivation below is defeated by a shape it
   cannot read. They are not what holds the invariant any more, and the label no longer implies
   they are. */
check(1, 'Boot hardening intact', () => {
  /* (0) presence — unchanged, deliberately a substring test, and no longer load-bearing. */
  must(html.includes('window.__bootError'), 'boot watchdog error capture (__bootError) is gone');
  must(html.includes('window.__logClientError'), 'client error ring buffer is gone');

  const inline = inlineScripts();
  must(inline.length === 2,
    `expected 2 inline scripts (the boot script and the Babel block), found ${inline.length} — ` +
    'this check reads both, so a third would be scanned by nothing');
  const boot = inline[0].body;
  const app = inline[1].body;

  /* Numeric bindings per script, so hoisting a delay to a named constant stays behaviour-neutral
     — two of the three false positives above were exactly that edit. */
  const numbersIn = (code) => {
    const nums = new Map();
    walk(code, {
      VariableDeclarator(p) {
        const { id, init } = p.node;
        if (id.type === 'Identifier' && init && init.type === 'NumericLiteral') nums.set(id.name, init.value);
      },
    });
    return nums;
  };
  const resolveNum = (node, nums) => {
    if (!node) return null;
    if (node.type === 'NumericLiteral') return node.value;
    if (node.type === 'Identifier' && nums.has(node.name)) return nums.get(node.name);
    return null;
  };
  /* Offsets, so containment is a range test instead of a nested traversal. */
  const within = (node, range) => node.start >= range.start && node.end <= range.end;

  /* ---- (a) the 8s watchdog ----------------------------------------------------------------
     Identified by the error screen it WRITES (an assignment to `.innerHTML`), never by its
     delay — identifying it by the delay is what let break (f) re-arm the clause with an
     unrelated timer. Once it is identified, the delay is resolved and compared. */
  const bootNums = numbersIn(boot);
  let timers = 0;
  const watchdogs = [];
  walk(boot, {
    CallExpression(p) {
      const c = p.node;
      if (!(c.callee.type === 'Identifier' && c.callee.name === 'setTimeout')) return;
      timers += 1;
      const fn = c.arguments[0];
      if (!fn || (fn.type !== 'FunctionExpression' && fn.type !== 'ArrowFunctionExpression')) return;
      if (fn.body.type !== 'BlockStatement') return;
      let writesScreen = false;
      p.traverse({
        AssignmentExpression(q) {
          const l = q.node.left;
          if (l.type === 'MemberExpression' && l.property.type === 'Identifier'
            && l.property.name === 'innerHTML') writesScreen = true;
        },
      });
      if (!writesScreen) return;
      /* An unconditional `return` among the callback's own statements makes the write
         unreachable — break (b). The real callback's two returns are consequents of `if`s, so
         they are not direct children of this block. */
      const deadAt = fn.body.body.findIndex((s) => s.type === 'ReturnStatement');
      watchdogs.push({ delay: resolveNum(c.arguments[1], bootNums), raw: c.arguments[1],
        dead: deadAt !== -1, body: { start: fn.start, end: fn.end } });
    },
  });
  must(timers > 0, 'the boot script contains no setTimeout at all — this walk resolved nothing, '
    + 'so it cannot report the watchdog as intact');
  must(watchdogs.length === 1,
    `expected exactly 1 boot watchdog (a setTimeout whose callback writes the error screen), found `
    + `${watchdogs.length} — the 8s watchdog that replaces the spinner is gone, or there are now two `
    + 'and this check cannot say which one is it');
  const [wd] = watchdogs;
  must(!wd.dead, 'the boot watchdog callback returns before it writes the error screen — the timer '
    + 'still fires and the splash is never replaced, which is the infinite iPhone spinner this '
    + 'invariant exists to fix');
  must(wd.delay === 8000,
    'the boot watchdog no longer fires at 8s (CLAUDE.md: "8s watchdog error screen") — resolved to '
    + `${wd.delay === null ? `an expression this check cannot read (${(wd.raw || {}).type})` : wd.delay}`);

  /* ---- (b) the Supabase client null-guard -------------------------------------------------
     Every `createClient` call must sit inside the guarded conditional, so break (c) — an
     unguarded call with the guard left behind as a comment — fails on the call rather than on
     the presence of the guard's text. */
  let guard = null;
  const createCalls = [];
  const appNums = numbersIn(app);
  walk(app, {
    VariableDeclarator(p) {
      if (p.node.id.type === 'Identifier' && p.node.id.name === 'supabase') guard = p.node;
    },
    CallExpression(p) {
      const ce = p.node.callee;
      if (ce.type === 'MemberExpression' && ce.property.type === 'Identifier'
        && ce.property.name === 'createClient') createCalls.push(p.node);
    },
  });
  must(createCalls.length > 0,
    'no createClient() call found in the app script — the Supabase client is built somewhere this '
    + 'check cannot see, so the null-guard is held by nobody');
  must(guard, 'the module-scope `supabase` binding is gone — a rename must fail here rather than '
    + 'turn this clause into a pass by omission');
  must(guard.init && guard.init.type === 'ConditionalExpression',
    'Supabase client creation is no longer a guarded conditional — the app will hard-fail when the '
    + `CDN does (init is ${(guard.init || {}).type || 'absent'})`);
  let guardReadsWindowSupabase = false;
  const testRange = { start: guard.init.test.start, end: guard.init.test.end };
  walk(app, {
    MemberExpression(p) {
      const m = p.node;
      if (!within(m, testRange)) return;
      if (m.object.type === 'Identifier' && m.object.name === 'window'
        && m.property.type === 'Identifier' && m.property.name === 'supabase') guardReadsWindowSupabase = true;
    },
  });
  must(guardReadsWindowSupabase,
    'the Supabase client guard no longer tests window.supabase — it cannot be a null-guard against '
    + 'the CDN script failing to load');
  must(guard.init.alternate.type === 'NullLiteral',
    'the Supabase client guard no longer falls back to null — the app degrades to localStorage-only '
    + 'by the `supabase` binding being null, so a different fallback changes boot '
    + `(got ${guard.init.alternate.type})`);
  const consequent = { start: guard.init.consequent.start, end: guard.init.consequent.end };
  const unguarded = createCalls.filter((c) => !within(c, consequent));
  must(!unguarded.length,
    `${unguarded.length} of ${createCalls.length} createClient() call(s) sit OUTSIDE the null-guard `
    + '— the app will hard-fail when the CDN does, whatever the guard beside them still says');

  /* ---- (c) the 4s getSession race ---------------------------------------------------------
     TWO halves, because the old clause only had the second. `withTimeout` must BE a race: break
     (a) neutered it to `(p, ms) => p` in one line, which removes the WebKit bound from every
     call site while leaving every call text intact. */
  let withTimeoutDecl = null;
  const raceCalls = [];
  const getSessionCalls = [];
  const timeoutCalls = [];
  walk(app, {
    VariableDeclarator(p) {
      if (p.node.id.type === 'Identifier' && p.node.id.name === 'withTimeout') withTimeoutDecl = p.node;
    },
    CallExpression(p) {
      const c = p.node;
      const ce = c.callee;
      if (ce.type === 'MemberExpression' && ce.object.type === 'Identifier' && ce.object.name === 'Promise'
        && ce.property.type === 'Identifier' && ce.property.name === 'race') raceCalls.push(c);
      if (ce.type === 'MemberExpression' && ce.property.type === 'Identifier'
        && ce.property.name === 'getSession') getSessionCalls.push(c);
      if (ce.type === 'Identifier' && ce.name === 'withTimeout') timeoutCalls.push(c);
    },
  });
  must(withTimeoutDecl && withTimeoutDecl.init,
    'the `withTimeout` helper is gone — every Supabase call in this app is bounded by it, starting '
    + 'with the getSession() race that stops the WebKit deadlock');
  const wtRange = { start: withTimeoutDecl.init.start, end: withTimeoutDecl.init.end };
  must(raceCalls.some((c) => within(c, wtRange)),
    'withTimeout no longer races its promise against a timeout (no Promise.race in its body) — it '
    + 'returns the un-bounded promise, so getSession() can deadlock on WebKit exactly as it did '
    + 'before this invariant existed, with every call site still reading as if it were timed out');
  must(getSessionCalls.length > 0,
    'no getSession() call found in the app script — the auth check this clause bounds is gone or '
    + 'is spelled in a way this check cannot read');
  const unraced = getSessionCalls.filter((g) => !timeoutCalls.some((t) => {
    const first = t.arguments[0];
    return first && within(g, { start: first.start, end: first.end })
      && resolveNum(t.arguments[1], appNums) === 4000;
  }));
  must(!unraced.length,
    `${unraced.length} of ${getSessionCalls.length} getSession() call(s) are not raced against a `
    + '4s timeout (WebKit deadlock -> iPhone spinner)');

  /* ---- (d) the error ring buffer ----------------------------------------------------------
     The buffer must still WRITE. Break (d) left the assignment in place and put a `return` at
     the top of the function, which every substring test in the old clause passed. */
  let logFn = null;
  let bootErrWrites = 0;
  let bootErrReads = 0;
  let screenReadsBootErr = false;
  walk(boot, {
    AssignmentExpression(p) {
      const l = p.node.left;
      if (l.type !== 'MemberExpression' || l.object.type !== 'Identifier' || l.object.name !== 'window') return;
      if (l.property.type !== 'Identifier') return;
      if (l.property.name === '__logClientError') logFn = p.node.right;
      if (l.property.name === '__bootError' && p.node.right.type !== 'NullLiteral') bootErrWrites += 1;
    },
    MemberExpression(p) {
      const m = p.node;
      if (m.object.type === 'Identifier' && m.object.name === 'window'
        && m.property.type === 'Identifier' && m.property.name === '__bootError'
        && !(p.parent.type === 'AssignmentExpression' && p.parent.left === m)) {
        bootErrReads += 1;
        if (within(m, wd.body)) screenReadsBootErr = true;
      }
    },
  });
  must(logFn && (logFn.type === 'FunctionExpression' || logFn.type === 'ArrowFunctionExpression'),
    'window.__logClientError is no longer assigned a function — the ring buffer behind "Copy error '
    + 'log" and every client_error row is gone');
  must(logFn.body.type === 'BlockStatement' && logFn.body.body.findIndex((s) => s.type === 'ReturnStatement') === -1,
    'window.__logClientError returns before it writes — the ring buffer is muted, which blinds '
    + 'client_error, the only channel in this repo that fires on a real fault (Invariant 4\'s '
    + '23505s and Invariant 2\'s blocked CDN script surface there and nowhere else)');
  let logWrites = false;
  walk(boot, {
    CallExpression(p) {
      const ce = p.node.callee;
      if (!within(p.node, { start: logFn.start, end: logFn.end })) return;
      if (ce.type === 'MemberExpression' && ce.object.type === 'Identifier' && ce.object.name === 'localStorage'
        && ce.property.type === 'Identifier' && ce.property.name === 'setItem') logWrites = true;
    },
  });
  must(logWrites,
    'window.__logClientError no longer writes the ring buffer to localStorage — it accepts every '
    + 'message and persists none, so the buffer is empty on the next load exactly as it was during '
    + 'the 47-day sync outage');
  must(bootErrWrites >= 2,
    `window.__bootError is assigned a real value in ${bootErrWrites} place(s), expected both the `
    + 'error and unhandledrejection listeners — the watchdog screen falls back to "Unknown startup '
    + 'error" and the actual failure is lost');
  /* Deliberately scoped to the WATCHDOG CALLBACK, not to the file. A first draft asserted
     `bootErrReads >= 1` over the whole boot script and was vacuous in the direction that
     matters: two of the three reads are the `if(!window.__bootError)` guards in the two
     listeners, which exist only to keep the FIRST error, so deleting the error screen's own read
     still left the count at 2. Caught by its own row in test_check_build.mjs — the break passed
     a deliberately broken tree. The property is that the SCREEN shows what went wrong. */
  must(screenReadsBootErr,
    `window.__bootError is written (${bootErrWrites}x) and read (${bootErrReads}x) but the watchdog `
    + 'screen no longer reads it — every failed boot silently degrades to "Unknown startup error.", '
    + 'which is the one string a nurse would be asked to report');

  return `watchdog ${wd.delay}ms writes the screen, ${createCalls.length} createClient guarded, `
    + `${getSessionCalls.length} getSession raced via Promise.race, buffer writes + `
    + `${bootErrWrites} __bootError writes/${bootErrReads} reads, screen reads it`;
});

/* ---- Invariant 2: SRI on every CDN script the publish set loads ------------------------
   The label used to say "all 5 CDN scripts" and this check counted `integrity=` attributes in
   `index.html`. The publish set ships a SIXTH, in `ops.html`: the same supabase-js pin, on the
   same origin, enforced by the same browser. Nothing read it.

   Measured 2026-11-20 against the clause below, before any of this was written. Three edits to
   `ops.html` left the gate printing `All 21 mechanical checks passed`: corrupting its hash,
   pasting React's hash into its row, and DELETING its `integrity` attribute outright. Only a
   version bump in its url failed, and incidentally — the harness-pin check reads that url
   because `buildOpsScratch` finds the row by substring, so the url was held by a check that does
   not care about it and the hash was held by nobody.

   The missing-attribute case is the one that matters. ops.html borrows the app's session from
   the same origin, so an unpinned script there reaches the same `user_data` blob and the same
   auth token as an unpinned script in the app — which is Invariant 2's own stated blast radius,
   on the one page in the publish set the count never covered. A WRONG hash fails closed (dead
   console, two admins); a MISSING one fails open.

   The rule is identity, not a second byte check: every remote script `ops.html` loads must be a
   row `index.html` also ships, same url and same hash. That is deliberately strict — a library
   only the console needs would have to be pinned here on purpose, the same intended friction the
   publish set and the storage-key set take. It also closes the chain at both ends without
   duplicating work: `tests/smoke.mjs` §60 proves index.html's five hashes match the bytes, and
   this proves ops.html carries one of those five verbatim. */
check(2, 'SRI on every CDN script the publish set loads', () => {
  const n = (html.match(/integrity="sha384-/g) || []).length;
  must(n === 5, `expected 5 integrity="sha384-" attributes, found ${n}`);
  const unpinned = html.match(/<script[^>]+src="https:\/\/[^"]*@latest[^"]*"/g);
  must(!unpinned, `CDN script pinned to @latest: ${unpinned && unpinned[0]}`);

  /* The rows index.html ships, as (url -> hash). Attribute order varies, so read each tag's
     attributes rather than matching the tag as a string. */
  const rowsOf = (page) => [...page.matchAll(/<script\b[^>]*\bsrc="(https:\/\/[^"]+)"[^>]*>/g)]
    .map((m) => ({ tag: m[0], url: m[1], sri: (m[0].match(/\bintegrity="([^"]*)"/) || [])[1] }));
  const appRows = new Map(rowsOf(html).map((r) => [r.url, r.sri]));

  const opsRows = rowsOf(ops);
  /* Anti-vacuity: a walk that finds nothing must fail rather than report a clean sweep. ops.html
     loads supabase-js and nothing else; a zero here means the tag moved or the walk broke, and
     either way this clause stopped asking its question. */
  must(opsRows.length > 0,
    'found no remote <script> in ops.html — the console loads supabase-js, so either the tag '
    + 'changed shape or this walk is broken; a sweep that reads nothing must not pass');
  for (const r of opsRows) {
    must(r.sri && r.sri.startsWith('sha384-'),
      `ops.html loads ${r.url} with no integrity attribute. ops.html ships to a public URL and `
      + "borrows the app's session from the same origin, so an unpinned script there reaches the "
      + 'same user_data blob and auth token an unpinned script in the app would');
    must(appRows.has(r.url),
      `ops.html pins ${r.url}, which index.html does not load. Every remote script in the publish `
      + 'set must be a row index.html also ships, so smoke §60 checks its hash against the bytes; '
      + 'a library only the console needs has to be pinned here on purpose');
    must(appRows.get(r.url) === r.sri,
      `ops.html and index.html pin ${r.url} with DIFFERENT hashes (ops: ${r.sri}, app: `
      + `${appRows.get(r.url)}). One of the two blocks the script in every browser, and the url `
      + 'being identical is what makes this invisible to every other check');
  }
  return `index.html 5 attributes, none @latest; ops.html ${opsRows.length} pinned, all matching `
    + 'the app row by url+hash (the HASHES are checked against the bytes in smoke §60)';
});

/* ---- Invariant 2's sibling: the CSP that decides whether those five scripts run at all --
   SRI answers "is this the exact file we pinned?". The <meta> CSP answers the earlier question,
   "may the browser fetch it from that host at all?", and nothing in this repo was reading it.
   CLAUDE.md -> Architecture states the rule ("the <meta> CSP must cover every runtime host") and
   it was held by nobody.

   The break this catches is the worst shape in the file: swap a CDN host, or add a sixth script
   from a new one, and leave the CSP alone. The browser blocks the script, React or Babel never
   defines, and Invariant 1's watchdog replaces the app with the boot error screen for EVERY
   visitor — and Invariant 1's own Detect trailer says that is invisible: a device that never
   boots never fires app_open and never flushes its error buffer. Same silence as the 47-day
   upsert outage, reached in one edit.

   Only the honest direction is gated. Every host a TAG loads from must be permitted; a permitted
   host nothing loads is NOT reported, because connect-src carries hosts no tag can reveal
   (https://*.supabase.co, accounts.google.com) and img-src is a wildcard. A reverse check would
   have to either whitelist those by name or flag them forever, and neither is a machine honestly
   checking anything.

   font-src gets the one derived assertion, because no tag names a font file: Google Fonts
   stylesheets fetch their woff2 from fonts.gstatic.com, so a page that loads the css2 stylesheet
   must permit that host or the webfont silently falls back to a system face. Silently is the
   problem — the 2026-10-23 band measured the real Bricolage needing 96px of 109px of room on a
   320pt screen, so a fallback is a layout change nothing would report.

   privacy.html is checked from the other end. It ships to a public URL with NO CSP, and what
   makes that safe is the property CLAUDE.md records as load-bearing: it is self-contained, so it
   "can't break and makes no third-party requests". That is exactly one regex, and it is the
   assertion that keeps the missing CSP honest rather than merely absent. */
check(2, 'CSP covers every host the pages load', () => {
  /* 'self' deliberately satisfies nothing here: these are remote hosts, and the page's own
     origin is badgebudget.com. A bare scheme ('https:') and a wildcard host ('https://*.foo')
     do satisfy, because the CSP spec says so and the app relies on the second for Supabase. */
  const allows = (sources, host) => sources.some((s) => {
    if (s === '*' || s === 'https:' || s === 'https://*') return true;
    const m = /^https:\/\/(\*\.)?([^/:]+)/.exec(s);
    if (!m) return false;
    return m[1] ? host === m[2] || host.endsWith(`.${m[2]}`) : host === m[2];
  });
  const directives = (page, name) => {
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(page);
    must(meta, `${name} has no <meta http-equiv="Content-Security-Policy"> — a deleted CSP must ` +
      'fail this check, not turn it into a pass by omission');
    const out = {};
    for (const part of meta[1].split(';')) {
      const [dir, ...src] = part.trim().split(/\s+/);
      if (dir) out[dir] = src;
    }
    return out;
  };
  const hostOf = (url) => { const m = /^https?:\/\/([^/:"]+)/.exec(url); return m && m[1]; };

  let gated = 0;
  for (const [name, page] of [['index.html', html], ['ops.html', ops]]) {
    const dirs = directives(page, name);
    const src = (d) => dirs[d] || dirs['default-src'] || [];

    /* script-src: the five pinned CDN scripts, and anything a later edit adds beside them. */
    for (const tag of page.match(/<script\b[^>]*>/g) || []) {
      const url = /\bsrc="([^"]+)"/.exec(tag);
      const host = url && hostOf(url[1]);
      if (!host) continue;
      must(allows(src('script-src'), host),
        `${name} loads a script from ${host}, which its own CSP script-src does not permit ` +
        `(${src('script-src').join(' ') || 'nothing'}) — the browser will block it and Invariant ` +
        "1's watchdog will replace the app with the boot error screen, silently, for everyone");
      gated++;
    }

    /* style-src: stylesheet <link>s only. preconnect and dns-prefetch are not fetches and no CSP
       fetch directive governs them, so counting them here would invent a rule the browser does
       not enforce. */
    for (const tag of page.match(/<link\b[^>]*>/g) || []) {
      if (!/\brel="stylesheet"/.test(tag)) continue;
      const url = /\bhref="([^"]+)"/.exec(tag);
      const host = url && hostOf(url[1]);
      if (!host) continue;
      must(allows(src('style-src'), host),
        `${name} loads a stylesheet from ${host}, which its own CSP style-src does not permit ` +
        `(${src('style-src').join(' ') || 'nothing'})`);
      gated++;
      if (host === 'fonts.googleapis.com') {
        must(allows(src('font-src'), 'fonts.gstatic.com'),
          `${name} loads a Google Fonts stylesheet but its CSP font-src does not permit ` +
          'fonts.gstatic.com, where that stylesheet fetches every woff2 — the webfont would fall ' +
          'back to a system face with nothing anywhere reporting it');
        gated++;
      }
    }
  }

  /* privacy.html: no CSP by design, so the property that replaces one is that there is nothing
     to constrain — and until 2026-11-19 that question was asked of TWO ATTRIBUTE SPELLINGS OF
     ONE SCHEME. The clause was `/\b(?:src|href)="https?:\/\/[^"]+"/`, and it printed
     `privacy.html self-contained`, which is a claim about the page's content rather than about
     double-quoted http(s) attributes. The page's own comment makes the same claim in words —
     "no fonts, scripts, or styles from anywhere else" — and nothing held it.

     Four realistic edits were measured against the old clause on 2026-11-19, and all four left
     the gate printing `All 21 mechanical checks passed` and `privacy.html self-contained`:

       1. `@font-face{src:url(https://fonts.gstatic.com/…woff2)}` inside the <style> block — the
          likeliest edit of all, because matching the app's type is the obvious polish, and a
          CSS url() is not an attribute.
       2. `@import url("https://fonts.googleapis.com/css2?family=Inter")` — a whole stylesheet
          from a third party, same reason.
       3. `<script src='https://plausible.io/js/script.js'></script>` — SINGLE-QUOTED, so the
          regex misses it. This is the bad one: an analytics script on the privacy notice, on a
          page with no CSP to block it.
       4. `<img src="//tracker.example.com/pixel.gif">` — protocol-relative, so there is no
          `https?:` to match. A tracking pixel is exactly this shape.

     Why it matters more than a doc nit: this page backs the URL on the Google OAuth consent
     screen, it ships with no CSP at all, and "it cannot break when a CDN does" is the stated
     reason it needs none. One remote reference makes that false in both directions — the page
     hands a third party the visitor's IP and the referring URL (which is the privacy notice),
     while explaining what BadgeBudget does not collect.

     So the question is asked of the content, in four parts, each with its own break:

     (a) Every attribute the browser FETCHES while rendering must be local. Any quoting, any
         scheme, `srcset` candidate lists split. `<a href>` and `<area href>` are deliberately
         EXEMPT and the exemption is named: a link is a navigation the reader chooses, not a
         request the page makes, and failing one would invent a rule the claim does not make.
     (b) Every `url(…)` and `@import` in a <style> block or a style="" attribute must be local.
     (c) No `<script>`, `<iframe>`, `<object>` or `<embed>` tag AT ALL. (a) covers a remote
         script's src; this covers an INLINE script, which can fetch anything at runtime and
         which no static attribute walk can see. There is no reason for one on this page.
     (d) The walk must find something. A page that yields no tags, or no local reference at all,
         fails rather than passing by omission — the same rule Invariant 5's derivation and
         Invariant 13's parser whitelist take.

     The false positive this must NOT have: the favicon is a `data:` URI whose SVG payload
     contains the literal `http://www.w3.org/2000/svg`. That is an XML namespace identifier and
     is never fetched, so a URL is classified by how its value STARTS, never by searching for
     `http` inside it. A blanket grep would fail on today's clean page, and the obvious repair —
     exempting w3.org — would be worse than the hole it closed. */
  const priv = read('privacy.html');
  /* Local: a relative path, a fragment, or a scheme that does not reach the network as a page
     resource. Remote: http(s), protocol-relative `//host`, or any other scheme (`webcal:`,
     `ftp:`) — unknown schemes fail loudly rather than being waved through. */
  const isRemote = (raw) => {
    const v = String(raw || '').trim();
    if (!v) return false;
    if (/^(?:data:|mailto:|tel:|#)/i.test(v)) return false;
    if (/^\/\//.test(v)) return true;                 /* protocol-relative */
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return true;  /* any explicit scheme */
    return false;                                      /* "/", "page.html", "./x" */
  };
  const privTags = priv.match(/<[a-zA-Z][^>]*>/g) || [];
  must(privTags.length > 0,
    'privacy.html yielded no tags to walk — this check cannot pass by finding nothing');

  /* (a) fetch-on-load attributes, on the tags that fetch them. */
  const FETCHERS = /^<(script|link|img|image|iframe|object|embed|video|audio|source|track|input|use)\b/i;
  const ATTRS = /\b(src|srcset|href|poster|data|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  const privRefs = [];
  for (const tag of privTags) {
    if (!FETCHERS.test(tag)) continue;   /* <a href> / <area href> navigate; they do not fetch */
    for (const m of tag.matchAll(ATTRS)) {
      const name = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? '';
      const parts = name === 'srcset'
        ? value.split(',').map((c) => c.trim().split(/\s+/)[0])
        : [value];
      for (const p of parts) privRefs.push({ name, value: p, tag: tag.slice(0, 60) });
    }
  }
  const privRemote = privRefs.filter((r) => isRemote(r.value));
  must(!privRemote.length,
    `privacy.html is published with no CSP because it is self-contained, and a tag now fetches ` +
    `${privRemote.length} remote URL(s): ${privRemote[0] && privRemote[0].value} ` +
    `(${privRemote[0] && privRemote[0].tag}…) — either drop it or give that page a CSP`);

  /* (b) CSS, which carries no attributes at all: url() and @import, in <style> and in style="". */
  const privCss = [
    ...(priv.match(/<style\b[^>]*>([\s\S]*?)<\/style>/gi) || []),
    ...[...priv.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2] ?? ''),
  ].join('\n');
  const cssRefs = [
    ...[...privCss.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\)/gi)]
      .map((m) => (m[1] ?? m[2] ?? m[3] ?? '').trim()),
    ...[...privCss.matchAll(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)')/gi)]
      .map((m) => (m[1] ?? m[2] ?? '').trim()),
  ];
  const cssRemote = cssRefs.filter(isRemote);
  must(!cssRemote.length,
    `privacy.html's CSS reaches a third party: ${cssRemote[0]} — a webfont or an @import is a ` +
    'remote request the old attribute-only clause could never see, and this page ships with no CSP');

  /* (c) no executable or embedding tag, inline included. */
  const privExec = privTags.filter((t) => /^<(script|iframe|object|embed)\b/i.test(t));
  must(!privExec.length,
    `privacy.html carries a ${privExec[0]}… tag — it is published with no CSP and no script of ` +
    'any kind, inline included: inline JS can fetch whatever it likes at runtime, which no ' +
    'attribute walk can see');

  /* (d) the page really is referencing things locally, so (a) is reading something. */
  must(privRefs.length > 0,
    'privacy.html yielded no fetchable attributes at all — the self-containment walk found ' +
    'nothing to check, which is not the same as finding nothing wrong');

  return `${gated} tag hosts permitted, privacy.html self-contained `
    + `(${privTags.length} tags, ${privRefs.length} refs, ${cssRefs.length} css urls, no script)`;
});

/* ---- Invariant 2's sixth script: the one the app loads from its OWN origin ---------------
   Invariant 2 is "SRI on all 5 CDN scripts, exact pinned versions". The app loads a SIXTH
   script, and none of the three mechanisms above can see it. `pdf.worker.min.js` is fetched at
   runtime by pdf.js, from this origin, and:

     - SRI does not reach it. A worker script takes no `integrity` attribute, and it is not a
       `<script>` tag at all — it is a string assigned to `GlobalWorkerOptions.workerSrc`.
     - The CSP check above does not reach it either, by construction: that check walks TAGS, and
       this is a URL in JavaScript. (The CSP has no `worker-src`, so the browser falls back to
       `default-src 'self'` — which is why pointing `workerSrc` at cdnjs to "fix" a worker that
       would not load produces a worker the browser refuses, even though `script-src` permits
       that host. The edit looks right, passes every check in this file, and kills the feature.)
     - Invariant 8's publish-set check names the FILE. Nothing has ever read a byte inside it.

   Four assertions, because there are four separate ways this dies:

   (a) The pinned version is found at all. One pdf.js CDN script, version extractable.
   (b) The worker is the matching build. pdf.js compares the two itself and throws
       `The API version "X" does not match the Worker version "Y"` — the message is a literal in
       the worker file, so this check requires both the guard (proof the 1MB blob really is a
       pdf.js worker, and not truncated or replaced) and the pinned version inside it. Bumping
       the CDN pin is a deliberate act because SRI forces a new hash; replacing the worker file
       beside it is a SEPARATE act, and forgetting it breaks the paystub reader completely with
       nothing in `events` to say so (`paystub_failed` has never fired for any reason).
   (c) `workerSrc` stays a bare same-origin filename that is in the publish set. An absolute or
       protocol-relative URL fails: see the CSP note above, and the in-source comment at the
       assignment already promises this ("no third-party CDN in the paystub path").
   (d) `isEvalSupported:false` is still passed to `getDocument`. This is the documented
       CVE-2024-4367 mitigation for pdf.js < 4.2.0, and 3.11.174 is pinned. The app's CSP carries
       `'unsafe-eval'` because Babel standalone needs it, so that flag is the ONLY thing standing
       between a malicious PDF and arbitrary JS in this origin — where the whole `user_data` blob
       and the auth session live. The input is a file she picks, which is the one input this app
       takes from outside itself.

   (a) and the "found" halves of (c) and (d) are anti-omission, the same rule check 13 takes for
   a renamed `serializeState`: a renamed function or a deleted assignment must FAIL rather than
   turn this into a pass by omission. */
check(2, 'pdf.js worker matches its pinned library', () => {
  const pins = html.match(/src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/([^/]+)\/pdf(?:\.min)?\.js"/g) || [];
  must(pins.length === 1,
    `expected exactly one pinned pdf.js CDN script in index.html, found ${pins.length} — the ` +
    'version this check compares the same-origin worker against cannot be established');
  const pinned = /pdf\.js\/([^/]+)\//.exec(pins[0])[1];

  const worker = read('pdf.worker.min.js');
  must(worker.includes('does not match the Worker version'),
    'pdf.worker.min.js no longer contains pdf.js\'s own API/worker version guard — the file in ' +
    'the publish set is not a pdf.js worker build (truncated, replaced, or empty), and nothing ' +
    'else in this repo reads a byte of it');
  must(worker.includes(`"${pinned}"`),
    `index.html pins pdf.js ${pinned} but pdf.worker.min.js does not carry that version — ` +
    'pdf.js will throw `The API version … does not match the Worker version …` on every ' +
    'paystub, and paystub_failed has never fired for any reason, so nothing would report it');

  const srcAssign = /GlobalWorkerOptions\.workerSrc\s*=\s*'([^']*)'/.exec(html);
  must(srcAssign,
    "could not find the GlobalWorkerOptions.workerSrc assignment — a renamed or deleted worker " +
    'path must fail this check, not turn it into a pass by omission');
  const workerSrc = srcAssign[1];
  must(!/^(https?:)?\/\//.test(workerSrc),
    `workerSrc is a remote URL (${workerSrc}) — the paystub worker must load from this origin. ` +
    'The CSP declares no worker-src, so default-src \'self\' blocks it; SRI cannot cover a ' +
    'worker; and nothing else in this file looks at a script URL that is not a tag');
  /* Read from deploy.yml rather than restating the list check 8 holds: duplicating it here would
     make the publish set true in two places, and the workflow is the one that decides. */
  const copies = [...deploy.matchAll(/^\s*cp (\S+) _site\/$/gm)].map((m) => m[1]);
  must(copies.includes(workerSrc),
    `workerSrc is '${workerSrc}', which deploy.yml never copies into _site — it publishes ` +
    `[${copies.join(', ')}], so this 404s in production while working from a local directory`);

  const getDoc = /getDocument\(\{([^}]*)\}\)/.exec(html);
  must(getDoc,
    'could not find the pdf.js getDocument({…}) call — same anti-omission rule: a rewritten ' +
    'paystub reader must fail this check rather than silently drop the hardening below');
  must(/isEvalSupported\s*:\s*false/.test(getDoc[1]),
    'getDocument() no longer passes isEvalSupported:false — that is the CVE-2024-4367 mitigation ' +
    `for pdf.js < 4.2.0 and ${pinned} is pinned. The CSP carries 'unsafe-eval' for Babel, so ` +
    'this flag is the only thing between a malicious paystub PDF and arbitrary JS in the origin ' +
    'holding user_data and the auth session');

  /* "worker agrees" is what this used to print, and it was the same overstatement the `[2]` SRI
     row made until 2026-11-15: the two assertions above read TWO SUBSTRINGS out of a megabyte,
     so they establish that the file is a pdf.js worker carrying this version — not that it is
     the build the pin names. `pdfjs-dist` ships a same-version `legacy/build/` worker that
     passes both of them and differs by 46,448 bytes. The digest comparison lives in
     `tests/smoke.mjs` §62, because CI's `gate` job installs @babel/standalone alone and has no
     pdfjs-dist bytes to compare against, while the `smoke` job vendors all five pins. Say which
     of the two this check is. */
  return `${pinned} pinned, worker carries it (BYTES compared in smoke §62), same-origin, isEvalSupported:false`;
});

/* ---- Invariant 4: the upsert that silently broke sync for 47 days ---------------------- */
check(4, 'Every write to user_data carries a conflict target', () => {
  /* This check was ONE regex over the whole file, and it printed the word `present`:
   *
   *   /\.upsert\(\s*\{\s*user_id:\s*userId,\s*data,[^)]*\},\s*\{onConflict:'user_id'\}\s*\)/
   *
   * It answered "does a string of this exact shape appear ANYWHERE in index.html?" — and the
   * label said `saveToSupabase upserts on {onConflict:'user_id'}`, which is a claim about one
   * named function, and the invariant says something broader still. Invariant 4's own text names
   * TWO write paths to `user_data`: the supabase-js upsert in `saveToSupabase`, and the raw
   * keepalive POST in `beaconSaveUserData` (`?on_conflict=user_id` + `Prefer:
   * resolution=merge-duplicates`, added 2026-10-05, "or it is a plain INSERT and 23505s forever").
   * The regex could not see the second one at all, and could not see a THIRD if one were added.
   *
   * Measured against the old clause before this was written — six realistic edits, every one of
   * them 23505-forever, and SIX left the gate printing `All 21 mechanical checks passed`:
   *   (1) the raw beacon's url loses `?on_conflict=user_id`;
   *   (2) its `Prefer` header loses `resolution=merge-duplicates`;
   *   (3) a second supabase-js write path, `.from('user_data').upsert({…})` with no options arg;
   *   (4) a second path using `.insert(…)`, which cannot carry a conflict target at all;
   *   (5) `saveToSupabase` renamed — the regex matched the moved line, so the check kept passing
   *       while the function its own label named no longer existed (pass by omission);
   *   (6) a second raw POST to `/rest/v1/user_data` with neither the query param nor the header.
   * (1) and (2) are caught at runtime by `tests/smoke.mjs` §33, which intercepts the unload
   * flush's real request, so production was never exposed on those two. (3)–(6) were caught by
   * NOTHING: §33 asserts the one request it drives, so a write path it does not drive is unseen.
   *
   * And it was wrong in the other direction too, which is the half that gets a check WEAKENED
   * rather than bypassed. The regex pins the payload's property ORDER (`user_id: userId, data,`)
   * and the options object's exact spacing, so two edits that change no behaviour whatsoever turn
   * the gate RED with the message "the user_data upsert lost {onConflict:'user_id'}": reordering
   * the payload's keys, and writing `{ onConflict: 'user_id' }` with ordinary spaces. Anyone who
   * formats this file meets a false accusation, and the obvious repair is to loosen the regex.
   * Both are GREENS in `scripts/test_check_build.mjs` now.
   *
   * So the set is DERIVED instead of declared, the same shape Invariant 5's check took on
   * 2026-11-14 and for the same reason: a hardcoded pattern answers "is this one still here?"
   * and can never answer "are these all of them?". This invariant is the one that most deserves
   * the second question — it is the only one of the thirteen with a live production signal, and
   * it earned that signal by running 47 days undetected across every signed-in user.
   *
   * `[4]` is held by this check alone, so the breaks below need no label pin.
   *
   * Scope is `user_data` only. `ical_subscriptions` and `swap_profiles` are both upserted
   * elsewhere in this file and neither is Invariant 4's table: both have `user_id` as their
   * PRIMARY KEY, so PostgREST infers the conflict target and a bare upsert is correct (checked
   * against the live catalog 2026-11-22). `user_data` is the only one whose PK is a generated
   * `id` with `user_id` carrying a separate UNIQUE — which is the whole mechanism of the outage. */


  /* Pass-by-omission guard, clause (5) above and the rule Invariant 13's check follows: the
     function this invariant is written about must be FOUND, not merely echoed by a line that
     happens to survive a rename. */
  must(/async function saveToSupabase\(/.test(html),
    'saveToSupabase is gone or renamed — Invariant 4 is written about that function by name, and ' +
    'a check that only greps for the upsert line keeps passing while the function does not exist');

  /* Both inline scripts, for the same reason the storage-key derivation reads both: today every
     user_data write is in the Babel block, and a write moved into the boot script must not land
     somewhere this walk cannot see. */
  const inline = [];
  for (let at = html.indexOf('<script'); at !== -1; at = html.indexOf('<script', at + 1)) {
    const tagEnd = html.indexOf('>', at);
    const tag = html.slice(at, tagEnd + 1);
    if (/\ssrc=/.test(tag)) continue;              // the 5 CDN scripts — Invariant 2's business
    inline.push(html.slice(tagEnd + 1, html.indexOf('</script>', tagEnd)));
  }
  must(inline.length === 2,
    `expected 2 inline scripts, found ${inline.length} — this check reads both, so a third would ` +
    'be scanned by nothing');

  /* The names the supabase-js client is bound to, derived from createClient() rather than
     assumed to be `supabase`. Without this, `.from()` matches `Array.from({length:n})` and
     every one of those reads as a table name this check cannot resolve. */
  const clients = new Set();
  for (const body of inline) {
    walk(body, {
      VariableDeclarator(p) {
        if (p.node.id.type !== 'Identifier' || !p.node.init) return;
        const src = body.slice(p.node.init.start, p.node.init.end);
        if (/\bcreateClient\s*\(/.test(src)) clients.add(p.node.id.name);
      },
    });
  }
  must(clients.size >= 1,
    'no supabase-js client binding found — this check reads .from() calls on the names bound from ' +
    'createClient(), so with none resolved every table write would be invisible to it');

  const upserts = [];       // supabase-js upserts to user_data, with their options
  const rawPosts = [];      // raw PostgREST POSTs to user_data
  const otherOps = [];      // selects, deletes, updates — not 23505 risks, counted so the output says so
  const unresolved = [];    // anything this walk cannot read: a hole, so it throws

  /* A string an expression resolves to, or null. Handles the two shapes this file uses: a bare
     literal, and `SUPABASE_URL + '/rest/v1/…'` — a `+` chain whose literal parts are what matter,
     since the host is irrelevant to which table and which query params are in play. */
  const literalParts = (node, bound) => {
    if (!node) return null;
    if (node.type === 'StringLiteral') return node.value;
    if (node.type === 'Identifier') return bound.has(node.name) ? bound.get(node.name) : null;
    if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked).join('\u0000');
    if (node.type === 'BinaryExpression' && node.operator === '+') {
      const l = literalParts(node.left, bound);
      const r = literalParts(node.right, bound);
      if (l === null && r === null) return null;
      return (l === null ? '\u0000' : l) + (r === null ? '\u0000' : r);
    }
    return null;
  };

  /* The string value of an object property, when it is a plain literal. */
  const propString = (obj, name, bound) => {
    if (!obj || obj.type !== 'ObjectExpression') return undefined;
    for (const pr of obj.properties) {
      if (pr.type !== 'ObjectProperty') continue;
      const k = pr.key.name || pr.key.value;
      if (k !== name) continue;
      const v = literalParts(pr.value, bound);
      return v === null ? null : v;     // null = present but unresolvable, undefined = absent
    }
    return undefined;
  };

  for (const body of inline) {
    const bound = new Map();
    walk(body, {
      VariableDeclarator(p) {
        if (p.node.id.type !== 'Identifier') return;
        const v = p.node.init;
        if (v && v.type === 'StringLiteral') bound.set(p.node.id.name, v.value);
      },
    });

    walk(body, {
      CallExpression(p) {
        const callee = p.node.callee;

        /* ---- (a) the supabase-js route: supabase.from('user_data').<verb>(…) ---------- */
        if (callee.type === 'MemberExpression'
            && (callee.property.name || callee.property.value) === 'from'
            && callee.object.type === 'Identifier' && clients.has(callee.object.name)) {
          const arg = p.node.arguments[0];
          const table = literalParts(arg, bound);
          if (table === null) {
            /* A table name this walk cannot read could be user_data, and there is deliberately
               no fallback — see the storage-key derivation's identical rule. */
            unresolved.push(`.from(<${arg ? arg.type : 'no argument'}>) — table is not a literal`);
            return;
          }
          if (table !== 'user_data') return;

          /* Walk the fluent chain forward collecting its verbs, so `.upsert(…)` is found
             whether it is first or buried behind `.select().eq()`. */
          const verbs = [];
          let cur = p;
          for (;;) {
            const mem = cur.parentPath;
            if (!mem || !mem.isMemberExpression() || mem.node.object !== cur.node) break;
            const call = mem.parentPath;
            if (!call || !call.isCallExpression() || call.node.callee !== mem.node) break;
            verbs.push({ name: mem.node.property.name || mem.node.property.value, path: call });
            cur = call;
          }
          const write = verbs.find((v) => /^(upsert|insert|update)$/.test(String(v.name)));
          if (!write) {
            otherOps.push(verbs.map((v) => v.name).join('.') || '(no verb)');
            return;
          }
          if (write.name !== 'upsert') {
            /* `.insert()` takes no conflict target, so it IS the 47-day outage. `.update()`
               cannot 23505 but silently no-ops when the row is absent, which is a different
               bug reaching the same place; both are rejected on purpose, so a save path that
               stops being an upsert is a deliberate edit to this check. */
            upserts.push({ bad: `.${write.name}() to user_data`, why:
              `user_data is written with .${write.name}(), not .upsert() — the table's PK is a ` +
              'generated id with user_id merely UNIQUE, so an INSERT violates ' +
              'user_data_user_id_key on every save after the first (23505, forever)' });
            return;
          }
          const opts = write.path.node.arguments[1];
          if (!opts) {
            upserts.push({ bad: 'upsert with no options argument', why:
              "the user_data upsert has no second argument, so it carries no onConflict — " +
              'PostgREST targets the PK, a fresh id is generated, no conflict fires, and the ' +
              'statement degrades to the INSERT that 23505s forever' });
            return;
          }
          const oc = propString(opts, 'onConflict', bound);
          if (oc === undefined || oc === null || oc !== 'user_id') {
            upserts.push({ bad: `onConflict is ${oc === undefined ? 'absent' : JSON.stringify(oc)}`, why:
              "the user_data upsert's onConflict is not 'user_id' — that option is the whole " +
              'fix for the 2026-07-07 to 2026-08-23 outage; without it every save after the ' +
              'first fails with 23505, silently, for every signed-in user' });
            return;
          }
          upserts.push({ ok: true, verbs: verbs.map((v) => v.name).join('.') });
          return;
        }

        /* ---- (b) the raw PostgREST route: fetch(SUPABASE_URL + '/rest/v1/user_data…') --- */
        if (callee.type === 'Identifier' && callee.name === 'fetch') {
          const url = literalParts(p.node.arguments[0], bound);
          if (url === null) {
            unresolved.push('fetch(<unresolvable url>) — a url this check cannot read could be '
              + 'a user_data write');
            return;
          }
          if (!url.includes('/rest/v1/user_data')) return;
          const init = p.node.arguments[1];
          const method = String(propString(init, 'method', bound) || 'GET').toUpperCase();
          if (method !== 'POST') { otherOps.push(`fetch ${method} user_data`); return; }
          if (init && init.type !== 'ObjectExpression') {
            unresolved.push(`fetch POST to user_data with a <${init.type}> init — this check `
              + 'cannot read its headers');
            return;
          }
          const missing = [];
          if (!/[?&]on_conflict=user_id(&|$)/.test(url)) missing.push('?on_conflict=user_id in the url');
          const headers = (init ? init.properties : []).find(
            (pr) => pr.type === 'ObjectProperty' && (pr.key.name || pr.key.value) === 'headers');
          const prefer = headers ? propString(headers.value, 'Prefer', bound) : undefined;
          if (prefer === null) {
            unresolved.push('fetch POST to user_data with an unresolvable Prefer header');
            return;
          }
          if (!/resolution=merge-duplicates/.test(String(prefer || ''))) {
            missing.push('resolution=merge-duplicates in the Prefer header');
          }
          if (missing.length) {
            rawPosts.push({ bad: `raw POST to user_data missing ${missing.join(' and ')}`, why:
              'a POST to /rest/v1/user_data without both of those is a plain INSERT: it ' +
              'violates user_data_user_id_key and 23505s on every unload flush after the ' +
              "first, forever. Invariant 4's own text names this as the raw-PostgREST spelling " +
              'of the same rule, and the unload path is the one whose success is unobservable' });
            return;
          }
          rawPosts.push({ ok: true });
          return;
        }
      },
    });
  }

  must(!unresolved.length,
    `user_data write sites this check cannot resolve: ${unresolved.join('; ')} — there is ` +
    'deliberately no regex fallback, because a check that shrugs at what it cannot read is the ' +
    'hole. Name the table or the url through a string constant, or add its shape here on purpose.');

  const broken = [...upserts, ...rawPosts].filter((w) => w.bad);
  must(!broken.length, broken.map((w) => `${w.bad} — ${w.why}`).join(' // '));

  /* Anti-vacuity floors, one per write path, because a walk that resolves NOTHING must fail
     rather than report a clean sweep — the old regex would also have passed a file with no
     user_data write in it at all. Both paths are named in Invariant 4, so losing either is a
     deliberate edit that belongs here and in CLAUDE.md. */
  must(upserts.length >= 1,
    'no supabase-js upsert to user_data found — that write is what Invariant 4 was written ' +
    'about, so a walk that cannot see it would pass this check by omission');
  must(rawPosts.length >= 1,
    'no raw PostgREST POST to user_data found — the keepalive unload flush (beaconSaveUserData, ' +
    '2026-10-05) is the SECOND write path this invariant names, and it is the one whose success ' +
    'cannot be observed at runtime');

  return `${upserts.length} supabase-js upsert (onConflict:'user_id'), ${rawPosts.length} raw POST ` +
    `(on_conflict + merge-duplicates), ${otherOps.length} non-write user_data ops`;
});

/* ---- Invariant 5: storage keys are data, not branding ---------------------------------- */
check(5, 'Storage keys unrenamed', () => {
  /* Two questions, and until 2026-11-14 this check only ever answered the first.
   *
   * (a) "Are the keys we named still here?" — a hardcoded list, each asserted present. That is
   *     the rename guard, and it works.
   * (b) "Is that list ALL of them?" — never asked. The check printed `6/6 intact`, which reads
   *     like completeness and was really "the six I was told about". Two keys had grown past it
   *     unnoticed: `scrubpay_ical_cta_dismissed` (the connect card's "Not now", 2026-10-01) and
   *     `scrubpay_ics_longreview_dismissed` (the long-shift repair card's, 2026-10-04). Both
   *     shipped with a feature, neither reached this list, and nothing could have said so.
   *
   * Those two are COSMETIC — renaming one re-shows a dismissed card, it does not orphan data —
   * so the value here is not that they are now guarded. It is that the set is DERIVED from the
   * file instead of declared beside it, so the NEXT key cannot be added without being classified,
   * and the next one may well be load-bearing. Same shape as Invariant 13's five-field parser
   * whitelist and Invariant 8's exact publish set: a new entry is intended friction.
   *
   * Kept as one check rather than split into a twenty-second, because it is one question asked
   * from both ends and the misleading figure was this check's own output. `[5]` therefore stays a
   * tag held by a single check, so the breaks in test_check_build.mjs need no label pin. */

  /* A rename of one of these orphans real data, silently — see the invariant's Detect: none. */
  const LOAD_BEARING = [
    'nursingWagePlannerData',       // anonymous users' ONLY copy, and the per-user backup's prefix
    'scrubpay_anon_id',             // the analytics join key; a rename breaks every join historically
    'scrubpay_feedback_pending',    // feedback queued offline, awaiting a connection
    'scrubpay_pending_invite',      // a swap invite held across sign-in
    'scrubpayErrors',               // the error ring buffer; "Copy error log" hands her this
    'scrubpay_events_pending',      // deferred analytics awaiting the next load
  ];
  /* A rename of one of these re-shows a card she dismissed. Named so the derivation can be
     exact, and tiered so this check does not claim they carry the invariant's blast radius. */
  const COSMETIC = [
    'scrubpay_ical_cta_dismissed',        // "Not now" on the NurseGrid connect card
    'scrubpay_ics_longreview_dismissed',  // "Not now" on the long-shift repair card
  ];
  const DECLARED = new Set([...LOAD_BEARING, ...COSMETIC]);

  /* (a) presence — unchanged in behaviour, and deliberately a substring test on the whole file:
     it fires even if the derivation below is defeated by a shape it cannot read. */
  const missing = [...DECLARED].filter((k) => !html.includes(k));
  must(!missing.length, `renaming orphans user data / severs analytics joins: ${missing.join(', ')}`);

  /* (b) derivation. Both inline scripts, because the keys are split across them: the boot script
     owns `scrubpayErrors` (ERR_KEY, ~index.html:671) and the Babel block owns the other seven. */
  const inline = [];
  for (let at = html.indexOf('<script'); at !== -1; at = html.indexOf('<script', at + 1)) {
    const tagEnd = html.indexOf('>', at);
    const tag = html.slice(at, tagEnd + 1);
    if (/\ssrc=/.test(tag)) continue;              // the 5 CDN scripts — Invariant 2's business
    const body = html.slice(tagEnd + 1, html.indexOf('</script>', tagEnd));
    inline.push({ tag, body });
  }
  must(inline.length === 2,
    `expected 2 inline scripts (the boot script and the Babel block), found ${inline.length} — ` +
    'this check reads both, so a third would be scanned by nothing');

  const seen = new Set();          // resolved literal keys
  const builders = [];             // BACKUP_KEY(uid) and friends
  const authPurges = [];           // supabase-js's own sb-…auth-token keys
  const unresolved = [];           // anything else: a hole, so it throws
  /* Distinct CALL SITES, keyed on the node's own offset within its script — never a tally of
     visitor invocations. This printed `45 sites` for the eight nights after the derivation
     shipped (2026-11-14) while the file holds exactly 35, because the old walk ran the visitor
     through `Babel.transform(…, presets:['react'])` and a storage call inside a JSX attribute is
     visited TWICE: once in the JSX tree, once again after the transform re-inserts that same
     expression as an argument to `React.createElement`. The ten extra were the ten such calls.
     Keying on position makes the figure independent of how many passes any future walk makes,
     which is the property `test_check_build.mjs` pins rather than the number 35. */
  const siteAt = new Set();

  for (const [idx, { body }] of inline.entries()) {
    /* String literals bound to a name at any scope, which is how every key in this app is
       written (`const STORE_KEY = 'nursingWagePlannerData'`). Collected first so a call site can
       resolve a bare identifier regardless of declaration order. */
    const bound = new Map();
    walk(body, {
      VariableDeclarator(p) {
        if (p.node.id.type !== 'Identifier') return;
        const v = p.node.init;
        if (v && v.type === 'StringLiteral') bound.set(p.node.id.name, v.value);
      },
    });

    walk(body, {
      CallExpression(p) {
        const callee = p.node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.object.type !== 'Identifier') return;
        if (!/^(localStorage|sessionStorage)$/.test(callee.object.name)) return;
        const method = callee.property.name || callee.property.value;
        if (!/^(getItem|setItem|removeItem)$/.test(String(method))) return;
        siteAt.add(`${idx}:${p.node.start}`);
        const arg = p.node.arguments[0];
        if (!arg) { unresolved.push(`${method}() with no key argument`); return; }
        if (arg.type === 'StringLiteral') { seen.add(arg.value); return; }
        if (arg.type === 'Identifier') {
          if (bound.has(arg.name)) { seen.add(bound.get(arg.name)); return; }
          /* An identifier with no string binding is a parameter. Exactly one such site is
             legitimate: `clearAuthStorage` purges supabase-js's OWN persisted auth token by
             scanning for the `sb-` prefix (index.html:~4397). Those keys belong to the client
             library, not to this app, so they are not Invariant 5's to name — but the shape is
             recognised explicitly rather than skipped, so a second dynamic removeItem cannot
             hide behind it. */
          const owner = p.findParent((q) => q.isVariableDeclarator() || q.isFunctionDeclaration());
          const text = owner ? body.slice(owner.node.start, owner.node.end) : '';
          if (text.includes("'sb-'") && text.includes('auth-token')) { authPurges.push(arg.name); return; }
          unresolved.push(`${method}(${arg.name}) — identifier with no string binding`);
          return;
        }
        if (arg.type === 'CallExpression' && arg.callee.type === 'Identifier') {
          builders.push(arg.callee.name);
          return;
        }
        unresolved.push(`${method}(<${arg.type}>)`);
      },
    });
  }

  /* Pass-by-omission guard, the rule check 3 and Invariant 13's clause both follow: a walk that
     resolves nothing must FAIL, not report a clean sweep. 30+ sites exist today. */
  const sites = siteAt.size;
  must(sites >= 25,
    `found only ${sites} localStorage call sites — the walk is reading the wrong thing, and a ` +
    'derivation that sees nothing would pass this check by omission');
  must(!unresolved.length,
    `storage keys this check cannot resolve: ${unresolved.join('; ')} — a key built at runtime is ` +
    'a key nothing can guard, so name it through a constant (or add its shape here on purpose). ' +
    'There is deliberately no fallback: a check that shrugs at what it cannot read is the hole.');

  /* The per-user failed-save backup. Invariant 5 names it `nursingWagePlannerData::<uid>`, and
     until now nothing checked the `::` — change the separator and every signed-in user's backup
     orphans, which is the copy that held their data through the 47-day sync outage (Invariant 4). */
  must(builders.length && builders.every((b) => b === 'BACKUP_KEY'),
    `a storage key is built by a function this check does not know: ${builders.join(', ') || 'none found'}`);
  must(/const BACKUP_KEY\s*=\s*uid\s*=>\s*STORE_KEY\s*\+\s*'::'\s*\+\s*uid/.test(html),
    "the per-user backup key is no longer STORE_KEY + '::' + uid — Invariant 5 names it " +
    "`nursingWagePlannerData::<uid>`, so a changed prefix or separator orphans every signed-in " +
    "user's failed-save backup, silently");

  /* The completeness assertion this check never had. */
  const undeclared = [...seen].filter((k) => !DECLARED.has(k));
  must(!undeclared.length,
    `localStorage keys the app uses and Invariant 5 does not name: ${undeclared.join(', ')} — add ` +
    'each to LOAD_BEARING (a rename orphans data) or to COSMETIC (a rename re-shows a card), and ' +
    'to Invariant 5 in CLAUDE.md if load-bearing. This is the friction, not a bug in the check.');
  const unused = [...DECLARED].filter((k) => !seen.has(k));
  must(!unused.length,
    `declared but never read or written through localStorage: ${unused.join(', ')} — either the ` +
    'key is dead (drop it from both lists) or its call site moved somewhere this walk cannot see');

  return `${seen.size}/${DECLARED.size} derived (${LOAD_BEARING.length} load-bearing, ` +
    `${COSMETIC.length} cosmetic), ${sites} sites, backup key intact`;
});

/* ---- Invariant 6: the .ics self-recognition sentinel ----------------------------------- */
check(6, '@scrubpay .ics sentinel, both halves', () => {
  /* There are TWO export stamps — shifts (~index.html:4781) and day events (~4802) — and this
     check needed only one match until 2026-10-27, so breaking the time-off export alone passed
     all fourteen checks while the label said "both halves". Asserted as an exact count, the way
     the publish set and the SRI count are: a third export site is a deliberate change, so it
     should land here in the same commit rather than silently widen the hole. */
  const stamps = (html.match(/'UID:scrubpay-'\s*\+/g) || []).length;
  must(stamps === 2,
    `expected 2 export sites stamping scrubpay- UIDs (shifts + day events), found ${stamps} — ` +
    'an unstamped export is not self-recognised, so every event it writes re-imports as a duplicate');
  must(html.includes("indexOf('@scrubpay')"), 'import no longer drops its own UIDs — re-import will duplicate every event');
  return `${stamps} export stamps + import drops`;
});

/* ---- Invariant 8/9: the deploy path itself --------------------------------------------- */
check(8, 'Publish set is exactly the intended files', () => {
  must(/cp CNAME _site\//.test(deploy), 'CNAME dropped from the publish set — the site falls off badgebudget.com');
  must(/cp privacy\.html _site\//.test(deploy),
    'privacy.html dropped from the publish set — badgebudget.com/privacy.html would 404, breaking the ' +
    'Google OAuth consent screen and leaving the app with no privacy notice');
  // Anything NOT copied silently 404s on Pages; anything added by accident ships publicly. Both
  // directions matter, so the set is asserted exactly rather than as a minimum.
  must(/cp ops\.html _site\//.test(deploy),
    'ops.html dropped from the publish set — the ops console would 404');
  const expected = ['index.html', 'pdf.worker.min.js', 'privacy.html', 'ops.html', 'CNAME'];
  const copies = [...deploy.matchAll(/^\s*cp (\S+) _site\/$/gm)].map((m) => m[1]);
  must(copies.length === expected.length && expected.every((f) => copies.includes(f)),
    `publish set should be exactly [${expected.join(', ')}], found [${copies.join(', ')}]`);
  return copies.join(', ');
});

/* ---- Invariant 8: ops.html is published, so what it contains is a public question ---------
   It sits on the open internet at a guessable URL. The gate that makes that safe lives in
   Postgres (ops_feedback_inbox raises 42501), but four things about the page itself would
   turn a safe design into a leak, and all four are mechanically checkable.

   The fourth is the HTML-injection clause, and until 2026-11-21 it was the regex
   `!/\.innerHTML\s*=/.test(ops)` while the summary line printed `no innerHTML` and
   CLAUDE.md printed "never assigns innerHTML". The page's own header states the real
   property: "NOTHING HERE IS TRUSTED TO BE SAFE TO RENDER AS HTML. Every value that came out
   of the database was typed by a member of the public into a feedback box." That property is
   "no HTML-injection sink", and the check named one spelling of one of them.

   SIX realistic edits were measured against the old clause before any of this was written, and
   ALL SIX left the gate printing `All 21 mechanical checks passed` (2026-11-21):
     (1) `n.innerHTML += text`      — one character away from the spelling the regex names, and
                                      the single likeliest edit on this page: appending a row.
     (2) `n.outerHTML = text`
     (3) `n.insertAdjacentHTML('beforeend', text)`
     (4) `n['innerHTML'] = text`    — the same setter through a computed property.
     (5) `document.write(text)`
     (6) `Object.assign(n, { innerHTML: text })`
   The blast radius is this invariant's own, arriving by the door the count never covered:
   ops.html is same-origin ON PURPOSE so it can borrow the app's session, so script injected
   here runs in the origin holding `user_data` and the auth token — and its two readers are the
   two admins, i.e. the highest-value session there is. The injected string is attacker-supplied
   by design: anyone on the internet can POST to `feedback`.

   So the clause is a WALK of every inline script, parsed, not grepped. The tempting repair is
   to widen the regex to the other sink words, and that is why one of the GREENS in
   `scripts/test_check_build.mjs` adds a comment naming them: a text grep is RED on today's
   clean page, which already says "never innerHTML" twice in prose. An AST sees code.

   Scope is ops.html, deliberately. index.html:748-749 writes `splash.innerHTML` on purpose —
   the boot watchdog's error screen, with its own `esc()` helper — so this is not a rule the app
   could take, and claiming it for both files would be the same over-reach being fixed here. */
check(8, 'Ops console ships nothing it should not', () => {
  must(/name="robots"[^>]*noindex/.test(ops),
    'ops.html lost its noindex — an admin console in Google results is not an admin console');
  must(!/service_role/.test(ops) && !/"role":"service_role"/.test(ops),
    'ops.html contains a service_role key — that key bypasses RLS entirely and must never ship');
  must(!html.includes('ops.html'),
    'the app links to ops.html — it must stay unreferenced so nurses never discover it exists');

  /* Every property, method and object key that hands a string to the HTML parser. `write` and
     `writeln` are matched on the property name alone rather than on `document.write`: blunt in
     the same direction, and for the same reason, as Invariant 13's CREDENTIAL pattern — a
     false positive here is a line in a failure message asking for a deliberate narrowing, and
     a false negative is public-authored HTML in an admin's session. */
  const SINKS = /^(innerHTML|outerHTML|srcdoc|insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|parseFromString|write|writeln)$/;
  /* Inline only: a `src=` script is the SRI check's subject, not this one. Locating the tags is
     a regex because that is an HTML question; everything inside them is an AST question. A tag
     shape that moves out from under this pattern fails the floor below rather than sweeping
     clean — the rule checks 2, 5 and 13 all take. */
  const inline = [...ops.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  must(inline.length > 0,
    'found no inline <script> in ops.html — the console renders the feedback inbox in plain JS, ' +
    'so either the tag shape moved and this walk is reading nothing, or the renderer left. ' +
    'Either way this clause is answering a question about an empty string');
  const nameOf = (n) => !n ? null
    : n.type === 'Identifier' ? n.name
    : n.type === 'StringLiteral' ? n.value : null;
  const hits = [];
  let assigns = 0;
  for (const src of inline) {
    /* Parsed as PLAIN JavaScript — no `jsx` plugin, deliberately. ops.html loads no Babel (its
       only remote script is supabase-js), so a JSX element in here is not a style choice, it is
       a SyntaxError the two admins' browsers hit at load and the inbox never renders. The gate
       is the only thing that would say so: this page has no test suite of its own, and the
       harness only publishes a copy of it. A parse failure is therefore the finding, not noise,
       so it is rethrown with what it means instead of leaving Babel's bare message in the row. */
    try {
      walk(src, {
      AssignmentExpression(p) {
        if (p.node.left.type !== 'MemberExpression') return;
        const k = nameOf(p.node.left.property);
        if (!k) return;
        assigns++;
        /* ANY operator: `+=` is how a row gets appended, and it is the one the old regex
           missed by a single character. */
        if (SINKS.test(k)) hits.push(`${k} ${p.node.operator} … (assignment)`);
      },
      CallExpression(p) {
        if (p.node.callee.type !== 'MemberExpression') return;
        const k = nameOf(p.node.callee.property);
        if (k && SINKS.test(k)) hits.push(`${k}() (call)`);
      },
      /* Object.assign(n, {innerHTML: s}) and React-style prop bags reach the same setter
         without ever writing a member assignment. */
      ObjectProperty(p) {
        const k = nameOf(p.node.key);
        if (k && SINKS.test(k)) hits.push(`{ ${k}: … } (object key)`);
      },
      /* `n[prop] = s` where `prop` is held in a variable is unresolvable by shape, so the
         NAME is caught instead, wherever it is spelled. Exact and anchored, so a sentence
         mentioning a sink is not a hit — only the bare string that could index into one. */
      StringLiteral(p) {
        if (SINKS.test(p.node.value)) hits.push(`the bare string '${p.node.value}' (computed property)`);
      },
      }, []);
    } catch (e) {
      throw new Error(`ops.html's inline script does not parse as plain JavaScript: ${e.message} — ` +
        'this page loads no Babel, so whatever this is does not run in the admins\' browsers at ' +
        'all and the feedback inbox renders nothing. If a transform step is genuinely wanted here, ' +
        'say so in this check; do not add the plugin to make the message go away');
    }
  }
  must(assigns > 0,
    'the walk resolved no property assignment at all in ops.html — the page sets textContent in ' +
    'el() and in stamp(), so zero means this clause is not reading the renderer and would report ' +
    'a clean sweep over anything');
  must(!hits.length,
    `ops.html hands a string to the HTML parser: ${hits.join('; ')} — every value this page ` +
    'renders was typed by the public into a feedback box, and this page is same-origin with the ' +
    "app's auth session. Render it with textContent, or narrow this list on purpose with a line " +
    'saying why');

  return `noindex, no service_role, unlinked, ${inline.length} inline script` +
    `${inline.length === 1 ? '' : 's'}: no HTML sink among ${assigns} property assignments`;
});

/* ---- Invariant 8: a published page may only link to a published file -------------------
   The check above asserts the publish set is exactly the five files deploy.yml copies. It says
   nothing about whether that set is SUFFICIENT for what the pages reference, and those are
   different questions: `privacy.html` is in the set because Settings links to it, and a link to
   a file the deploy never copies is a 404 that works perfectly everywhere except production.

   The harness makes that gap worse rather than better. `buildScratch` copies pages into the
   scratch tree by name, so a page it copies and deploy.yml does not is reachable in all 922
   smoke assertions and absent from badgebudget.com — two copies of one rule, which is the shape
   this repo keeps getting burned by. Invariant 8's blast list names exactly this for
   privacy.html: a 404 there breaks the Google OAuth consent screen and leaves the app with no
   reachable privacy notice.

   Scope, stated rather than implied: this walks TAG attributes. A URL computed in JavaScript is
   invisible to it — the same blind spot the CSP check has, and the reason the pdf.js worker
   needed a check of its own — so clause (b) fails on a dynamic href/src instead of letting the
   walk go quietly blind. */
check(8, 'Published pages link only to published files', () => {
  const published = [...deploy.matchAll(/^\s*cp (\S+) _site\/$/gm)].map((m) => m[1]);
  const pages = published.filter((f) => f.endsWith('.html'));
  /* Anti-omission: if the derivation above ever yields nothing, every assertion below passes by
     having nothing to walk. The same rule check 13 takes for a renamed serializeState. */
  must(pages.includes('index.html'),
    `the publish set this check walks does not contain index.html (found [${pages.join(', ')}]) — ` +
    'the derivation from deploy.yml broke, so this check is inspecting nothing');

  const offsite = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|$)/i;   // scheme, protocol-relative, fragment, empty
  let refs = 0;
  for (const page of pages) {
    const src = read(page);
    /* (b) a computed attribute cannot be resolved by a tag walk, so it is intended friction:
       write the literal, or publish the target and link it plainly. */
    must(!/\b(?:href|src)\s*=\s*\{/.test(src),
      `${page} builds an href/src dynamically — a tag walk cannot resolve it, so a link to an ` +
      'unpublished page would ship unseen. Write the literal path instead.');
    const attrs = [...src.matchAll(/\b(?:href|src)\s*=\s*"([^"]*)"/g)].map((m) => m[1]);
    /* (c) every published page has at least one href or src today (index many, privacy 3, ops 1).
       Zero means the attribute shape changed under this regex — single quotes, a minifier — and
       a walk that sees nothing must fail rather than report success. */
    must(attrs.length > 0,
      `${page} yields no href/src attributes to this check — the attribute shape changed, so the ` +
      'walk is blind and its silence is not evidence');
    for (const raw of attrs) {
      if (offsite.test(raw)) continue;                    // CDN, data:, mailto:, tel:, #anchor
      const path = raw.split('#')[0].split('?')[0].replace(/^\.?\//, '') || 'index.html';
      refs++;
      /* (a) the one that matters. A link written to a page the deploy never copies 404s in
         production and nowhere else — not locally, not in the harness, not in CI. */
      must(published.includes(path),
        `${page} links to "${raw}", which deploy.yml never copies into _site — it publishes ` +
        `[${published.join(', ')}], so that link 404s on badgebudget.com while working ` +
        'everywhere else. Add it to the publish set (and to this gate\'s expected list) or ' +
        'drop the link.');
    }
  }
  return `${pages.length} pages, ${refs} same-origin refs, all published`;
});

/* ---- Invariant 9: the deploy branch still triggers a deploy -------------------------------
   This check was ONE unanchored `deploy.includes('claude/migrate-to-github-deploy-3F5RD')` over
   the whole workflow file, and it printed the word `present`. The same shape as Invariant 4's
   clause before 2026-11-22: a substring standing in for a structural property, reporting a word
   that reads like a verdict.

   Measured against that clause before any of this was written. FIVE realistic edits that stop
   every deploy left the gate printing `All 21 mechanical checks passed`:

     A. the branch line COMMENTED OUT — `# - claude/migrate-to-github-deploy-3F5RD`. The likeliest
        edit by far: commenting a YAML list entry is how anyone cautiously "removes" one, and the
        comment sitting directly above it in this very file instructs the reader to "Remove it
        from this list once work is merged into main."
     B. `branches:` -> `branches-ignore:`. The name is still there and is now explicitly
        EXCLUDED, so this one does not merely fail to deploy — it inverts the trigger. It is also
        the only case that fails OPEN in the dangerous direction: the gate reports the branch as
        triggering a deploy while the workflow states the opposite.
     C. the `push:` trigger changed to `pull_request:`, branch list untouched — a merge stops
        deploying while every PR still runs the job.
     D. a `paths:` filter added under `push:` that no publish-set file matches.
     E. the whole `on:` block gutted to `workflow_dispatch:`, the branch name surviving in a
        job-level `if: github.ref == …`.

   Only the sixth — deleting the line outright — was caught, which is the one case the old clause
   was written for (Invariant 9's own history: "removing it first stopped all deploys once").

   Blast radius is Invariant 9's own, and this repo has already served it: everything merged after
   the break sits unshipped while looking merged. Its `Detect` is "derivable but unwatched" — the
   signal is an empty Actions tab — and `deploy_watch.mjs` only sees it AFTER a merge has failed
   to ship. This gate is the only thing that reads the triggers themselves.

   So the triggers are READ rather than grepped: the `on:` block is parsed, and the branch must be
   a real sequence entry under `on.push.branches`. A comment is not an entry, `branches-ignore` is
   not `branches`, and `pull_request` is not `push`.

   The FOURTH clause is a property nothing in this repo has ever read. `cancel-in-progress: true`
   on the `pages` concurrency group is what Pat set by hand on 2026-10-09 (`f1aa7a6`, #162) to end
   the four-night Pages stall, and CLAUDE.md -> Deployment records it as "a standing property of
   this repo's deploy path" that is "Invariant 9's blast shape arriving by a different door".
   Flipped back to `false`, one stuck run again blocks every deploy behind it forever — which is
   exactly the 72-hour, nine-commit outage of 2026-10-06..09 — and nothing anywhere would say so.
   It is one word in the file only Pat can edit, held by nobody until now.

   Anything unresolvable THROWS. There is deliberately no substring fallback: a check that shrugs
   at a workflow it cannot read is the hole this replaces, and `on:` written in a form this cannot
   parse must be classified on purpose rather than waved through. */
check(9, 'Deploy branch still triggers a deploy', () => {
  const BRANCH = 'claude/migrate-to-github-deploy-3F5RD';

  /* A minimal block-YAML reader, scoped to the two top-level blocks this check actually reads:
     `on:` and `concurrency:`. Both hold only nested mappings and `- ` scalar sequences. `jobs:`
     is deliberately NOT descended into — it holds sequences of mappings and `run: |` block
     scalars, and this check makes no claim about them, so reading them could only produce false
     accusations about a file it does not otherwise judge.

     Comments are stripped OUTSIDE quotes only, so `group: "pages"` survives and a commented-out
     `# - branch` never becomes an entry — which is break A, the likeliest edit of the five.
     Flow style (`{`/`[`) is reported as unresolvable rather than guessed at. */
  const lines = [];
  deploy.split('\n').forEach((raw, i) => {
    let s = '', q = null;
    for (let c = 0; c < raw.length; c++) {
      const ch = raw[c];
      if (q) { s += ch; if (ch === q) q = null; continue; }
      if (ch === '"' || ch === "'") { q = ch; s += ch; continue; }
      if (ch === '#') break;
      s += ch;
    }
    if (s.trim()) lines.push({ indent: s.match(/^ */)[0].length, text: s.trim(), line: i + 1 });
  });

  /* The region of `lines` belonging to one top-level key, as [start, end). The key is compared
     after its quotes are stripped, because `on` is a YAML 1.1 boolean and linters suggest
     writing it as `"on":` — a spelling that must not read as a missing trigger block. */
  const topLevel = (name) => {
    const at = lines.findIndex((l) => {
      if (l.indent !== 0) return false;
      const m = l.text.match(/^([^:]+):/);
      return !!m && m[1].trim().replace(/^['"]|['"]$/g, '') === name;
    });
    if (at < 0) return null;
    let end = at + 1;
    while (end < lines.length && lines[end].indent > 0) end++;
    return { at, end };
  };

  const parseRegion = (region, what) => {
    let pos = region.at + 1;
    const node = (indent) => {
      if (pos < region.end && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
        const seq = [];
        while (pos < region.end && lines[pos].indent === indent && lines[pos].text.startsWith('- ')) {
          seq.push(lines[pos].text.slice(2).trim().replace(/^['"]|['"]$/g, ''));
          pos++;
        }
        return { seq };
      }
      const map = {};
      while (pos < region.end && lines[pos].indent === indent) {
        const { text: t, line } = lines[pos];
        const m = t.match(/^([^:]+):(.*)$/);
        must(m, `cannot read line ${line} of the deploy workflow's \`${what}\` block as a mapping key: "${t}"`);
        const key = m[1].trim().replace(/^['"]|['"]$/g, '');
        const rest = m[2].trim();
        pos++;
        if (rest) {
          must(!/^[[{]/.test(rest),
            `the deploy workflow writes \`${key}\` in flow style (${rest.slice(0, 40)}) — this check `
            + 'reads block style only, so classify it here deliberately rather than letting it pass');
          map[key] = rest.replace(/^['"]|['"]$/g, '');
        } else if (pos < region.end && lines[pos].indent > indent) {
          map[key] = node(lines[pos].indent);
        } else {
          map[key] = null; // a key with no value, e.g. `workflow_dispatch:`
        }
      }
      return map;
    };
    const out = region.at + 1 < region.end ? node(lines[region.at + 1].indent) : null;
    must(pos === region.end,
      `the deploy workflow's \`${what}\` block has content this check could not place (line `
      + `${lines[pos] && lines[pos].line}) — an unparsed region could hold the push triggers, so `
      + 'this fails rather than guessing');
    return out;
  };

  /* Anti-vacuity: `on:` must be found at top level — bare or quoted, since YAML 1.1 reads a bare
     `on` as the boolean true and linters suggest quoting it. Its ABSENCE fails rather than
     sweeping clean. */
  const onRegion = topLevel('on');
  must(onRegion, 'the deploy workflow has no top-level `on:` key at all — nothing can be said '
    + 'about what triggers a deploy, so this fails rather than passing by omission');
  const on = parseRegion(onRegion, 'on');
  must(on && typeof on === 'object' && !on.seq,
    'the deploy workflow has no readable `on:` block mapping — without one nothing can be said '
    + 'about what triggers a deploy, so this fails rather than passing by omission');

  const push = on.push;
  must(push !== undefined,
    'the deploy workflow has no `push:` trigger — a merge to the deploy branch would no longer '
    + 'deploy anything, which is Invariant 9 exactly: everything merged sits unshipped while '
    + 'looking merged');

  /* `push:` with no body means "every branch", which does include this one. */
  let where = 'every branch (push: carries no branch filter)';
  if (push !== null) {
    must(!push.seq, 'the deploy workflow\'s `push:` trigger is a sequence, not a mapping — unreadable here');
    must(push['branches-ignore'] === undefined,
      'the deploy workflow uses `branches-ignore:` under `push:` — the deploy branch being NAMED '
      + 'there is the opposite of it triggering a deploy, and the old substring check reported '
      + 'exactly that case as "present"');
    const branches = push.branches;
    must(branches && branches.seq,
      'the deploy workflow\'s `push.branches` is not a readable list of branches');
    must(branches.seq.includes(BRANCH),
      `the de facto default branch is not a \`push.branches\` entry — this stops ALL deploys. `
      + `Found [${branches.seq.join(', ')}]. A COMMENTED-OUT entry is not an entry: Invariant 9 `
      + `says add \`main\` to the triggers BEFORE removing this branch, never in the same commit`);
    must(push.paths === undefined && push['paths-ignore'] === undefined,
      'the deploy workflow\'s `push:` trigger has gained a paths filter — a publish-set file that '
      + 'does not match it stops shipping silently. Adding one is deliberate friction: classify '
      + 'it here on purpose, the same way the publish set and the storage-key set are');
    where = `push.branches [${branches.seq.join(', ')}]`;
  }

  /* The structural half of the 2026-10-06..09 Pages stall: 72 hours, nine merged commits
     unshipped, because one orphaned run held the `pages` concurrency group and `false` let it
     hold the group forever. Read by nothing until now. */
  const concRegion = topLevel('concurrency');
  must(concRegion, 'the deploy workflow has no top-level `concurrency:` key — the `pages` group '
    + 'and its cancel-in-progress setting are what bound how long a stuck run blocks every deploy '
    + 'behind it, and this check will not infer a default');
  const conc = parseRegion(concRegion, 'concurrency');
  must(conc && typeof conc === 'object' && !conc.seq,
    'the deploy workflow has no readable `concurrency:` block — the `pages` group and its '
    + 'cancel-in-progress setting are what bound how long a stuck run blocks every deploy behind it');
  must(String(conc['cancel-in-progress']) === 'true',
    'the `pages` concurrency group is back to cancel-in-progress: false — one run that cannot '
    + 'start then blocks every deploy behind it FOREVER, which is the 2026-10-06..09 stall: 72 '
    + 'hours, nine merged green commits unshipped, cleared only by the owner cancelling the run '
    + 'by hand. The owner set it true on 2026-10-09 (f1aa7a6, #162)');

  return `${BRANCH} in ${where}; cancel-in-progress: true`;
});

/* ---- the analytics contract: telemetry that only ever passes proves nothing -------------
   Not numbered invariants, but load-bearing the same way. Both were broken for months in ways
   nothing could see: the exit row did not exist, and the test harness was quietly writing
   production rows. Each failure mode is silent by construction, so each gets a gate. */
/* ---- the unload telemetry: four mechanisms, read rather than grepped -------------------------
   This is the only channel that says anything at all about a visit that ENDS. `app_open` says
   she arrived; `session_end` says how far she got; the unload `client_error` flush is the only
   route the ring buffer takes on a device that never loads again, and every public device to
   date is a one-visit device. The 2026-11-25 groom read a `session_end {n:3}` from a device with
   no other row in the table — the keepalive beacon survived a 2-second bounce and the three
   ordinary `track()` fetches did not. That asymmetry IS this check's subject.

   Until 2026-11-26 the check was four unanchored regexes over the whole 580KB file and its label
   printed four property-words — `session_end + keepalive + unload error flush + ob_step 0`, the
   same shape Invariant 1's clause carried until the night before. Measured against it before
   anything was written, SEVEN of eight realistic breaks left the gate printing
   `All 21 mechanical checks passed`, and ALL THREE behaviour-neutral edits turned it RED:

     green  endSession never CALLED from the unload flush (the declaration and the 'session_end'
            literal both still matched; the exit row is simply never sent — and it is the one row
            that survives a bounce)
     green  `return;` at the top of endSession — the Invariant-1 break (b) shape, one line
     green  beaconSaveUserData loses keepalive, the match surviving in beaconInsert. TWO senders
            share one regex, so either could lose it alone. This one is the 2026-10-03 AbortError
            restored on her actual DATA, not on telemetry
     green  beaconInsert loses keepalive, the match surviving in beaconSaveUserData
     green  flushClientErrors stops honouring `viaBeacon` and sends through track() — an ordinary
            fetch inside an unload handler, i.e. the exact bug the parameter exists to fix, with
            the call site `flushClientErrors(uid, true)` the old regex pinned left untouched
     green  markObStep compares `n > 0` instead of `n > obMax.current` — step 0, the stage this
            funnel was rebuilt for on 2026-09-16, can never fire again while `useRef(-1)` stands
     green  the pagehide/visibilitychange listeners are never registered at all: nothing flushes
            on unload, telemetry AND data, and all four regexes still matched
     red    'session_end' renamed with the old name left in a comment — caught, but by the
            INVENTORY row, not by this one. A break that fails the wrong row is not a win.

   And the three false positives, each of which a linter or a reviewer suggests: renaming the
   flush handler's local `uid` to `userId`, hoisting the `-1` ref sentinel to a named constant,
   and annotating the positional boolean as `flushClientErrors(uid, /* viaBeacon *\/ true)`. The
   red half matters as much as the green half: a check that accuses an ordinary edit is a check
   someone deletes a clause from.

   Read, not grepped, and each property asserted where it lives:

   (a) THE FLUSH IS REGISTERED. The unload handler is identified by its `pagehide` registration,
       never by its name, so a flush that exists and is never wired up fails here.
   (b) IT REACHES BOTH SENDERS. `endSession` must be reachable from it, and `flushClientErrors`
       must be CALLED FROM IT with a literal `true` — a call site elsewhere in the file cannot
       satisfy it.
   (c) EVERY RAW FETCH IT REACHES CARRIES `keepalive`. Derived from reachability rather than
       declared, so a third unload sender added later is covered the day it lands. Deliberately
       scoped to raw `fetch`: the `saveToSupabase` fallback on this same path goes through
       supabase-js and is NOT keepalive on purpose.
   (d) `viaBeacon` STILL GATES THE BEACON. The parameter must be the test of a conditional whose
       consequent sends through `beaconInsert`, so neutering the body fails even with the call
       site intact.
   (e) `session_end` IS THE NAME, AND IT IS REACHED. The literal must be the name handed to
       `eventRow` inside `endSession`, and no unconditional `return` may precede the send.
   (f) STEP 0 CAN STILL FIRE. Anchored on the `track('ob_step')` call: its guard must compare
       against the ref's `.current`, and the ref's initial value — resolved THROUGH a constant
       binding, which is what makes the hoisting edit green — must be below zero.

   Anything unresolvable THROWS. There is no regex fallback, because a check that shrugs at a
   mechanism it cannot read is the hole being replaced. No live defect was found: all four
   mechanisms are intact today, so this is a regression guard like Invariant 1's rewrite, §54 and
   §62 — not a save. */
check('events', 'Unload telemetry intact', () => {
  const inline = inlineScripts();
  must(inline.length === 2,
    `expected 2 inline scripts, found ${inline.length} — this check reads the app script by index`);
  const app = inline[1].body;

  /* One traversal for the whole check: grab the Program root from the shared tree and walk it
     with a plain recursive finder from here on. Five separate `walk()` calls would each re-visit
     a 512KB tree to answer a question about one function. */
  let program = null;
  walk(app, { Program(p) { program = p.node; } });
  must(program, 'the app script yielded no Program node — this walk resolved nothing, so it '
    + 'cannot report the unload telemetry as intact');

  const SKIP = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'comments',
    'extra', 'tokens', 'errors']);
  const nodesIn = (root, pred, out = []) => {
    if (!root || typeof root !== 'object') return out;
    if (Array.isArray(root)) { for (const n of root) nodesIn(n, pred, out); return out; }
    if (typeof root.type === 'string' && pred(root)) out.push(root);
    for (const k of Object.keys(root)) {
      if (SKIP.has(k)) continue;
      const v = root[k];
      if (v && typeof v === 'object') nodesIn(v, pred, out);
    }
    return out;
  };
  const within = (n, r) => n.start >= r.start && n.end <= r.end;
  const rangeOf = (n) => ({ start: n.start, end: n.end });
  const isCallTo = (n, name) => n.type === 'CallExpression'
    && n.callee.type === 'Identifier' && n.callee.name === name;

  /* Every function reachable by name: declarations and `const f = function/arrow`. */
  const fns = new Map();
  for (const n of nodesIn(program, (x) => x.type === 'FunctionDeclaration' && x.id)) fns.set(n.id.name, n);
  for (const n of nodesIn(program, (x) => x.type === 'VariableDeclarator'
    && x.id.type === 'Identifier' && x.init
    && (x.init.type === 'FunctionExpression' || x.init.type === 'ArrowFunctionExpression'))) {
    if (!fns.has(n.id.name)) fns.set(n.id.name, n.init);
  }
  must(fns.size > 50, `only ${fns.size} named functions resolved in the app script — this walk is `
    + 'reading the wrong thing, so every clause below would pass by having nothing to inspect');

  const allCalls = nodesIn(program, (x) => x.type === 'CallExpression');
  const callsIn = (r) => allCalls.filter((c) => within(c, r));
  const namedCallsIn = (r) => callsIn(r)
    .filter((c) => c.callee.type === 'Identifier').map((c) => c.callee.name);

  /* ---- (a) the flush is REGISTERED on pagehide ------------------------------------------- */
  const registered = [];
  for (const c of allCalls) {
    const ce = c.callee;
    if (!(ce.type === 'MemberExpression' && ce.property.type === 'Identifier'
      && ce.property.name === 'addEventListener')) continue;
    const ev = c.arguments[0];
    if (!(ev && ev.type === 'StringLiteral' && ev.value === 'pagehide')) continue;
    const h = c.arguments[1];
    if (h && h.type === 'Identifier' && fns.has(h.name)) registered.push(h.name);
  }
  must(registered.length === 1,
    `expected exactly 1 resolvable pagehide handler, found ${registered.length} — nothing flushes `
    + 'on unload (telemetry AND her data), or there are now two and this check cannot say which '
    + 'one carries the exit row');
  const [flushName] = registered;
  const flushRange = rangeOf(fns.get(flushName));

  /* ---- (b) it reaches endSession, and calls flushClientErrors(_, true) ITSELF -------------
     Reachability is hop-bounded from the flush. `endSession` is a direct call today; the bound
     is 3 so an extracted helper does not turn this into a false positive. */
  const reachable = (() => {
    const seen = new Set();
    let frontier = namedCallsIn(flushRange);
    for (let hop = 0; hop < 3 && frontier.length; hop += 1) {
      const next = [];
      for (const n of frontier) {
        if (seen.has(n)) continue;
        seen.add(n);
        const f = fns.get(n);
        if (f) next.push(...namedCallsIn(rangeOf(f)));
      }
      frontier = next;
    }
    return seen;
  })();
  must(reachable.has('endSession'),
    'the unload flush no longer reaches endSession — the exit row is never sent, so every '
    + 'abandonment collapses back to "somewhere after app_open", and on a short bounce the '
    + 'keepalive exit row is the ONLY row that survives at all');
  const errFlushes = callsIn(flushRange).filter((c) => isCallTo(c, 'flushClientErrors'));
  must(errFlushes.length === 1,
    `the unload flush makes ${errFlushes.length} flushClientErrors() calls, expected 1 — the error `
    + 'buffer would report only on a NEXT load, and no public device has ever had one');
  const viaArg = errFlushes[0].arguments[1];
  must(viaArg && viaArg.type === 'BooleanLiteral' && viaArg.value === true,
    'the unload flushClientErrors() call no longer passes the beacon flag — its batch would go '
    + `through an ordinary fetch that the discarded document cancels (got ${(viaArg || {}).type || 'no second argument'})`);

  /* ---- (c) every raw fetch the flush reaches carries keepalive ---------------------------- */
  const keepaliveOf = (fetchCall) => {
    const opts = fetchCall.arguments[1];
    if (!opts || opts.type !== 'ObjectExpression') return null;
    for (const p of opts.properties) {
      if (p.type !== 'ObjectProperty') continue;
      const k = p.key.type === 'Identifier' ? p.key.name
        : (p.key.type === 'StringLiteral' ? p.key.value : null);
      if (k === 'keepalive') return p.value.type === 'BooleanLiteral' ? p.value.value : null;
    }
    return false;
  };
  const senders = [];
  for (const name of reachable) {
    const f = fns.get(name);
    if (!f) continue;
    for (const c of callsIn(rangeOf(f))) {
      if (!isCallTo(c, 'fetch')) continue;
      senders.push({ name, keepalive: keepaliveOf(c) });
    }
  }
  must(senders.length >= 2,
    `only ${senders.length} raw fetch() call(s) found on the unload path, expected at least 2 `
    + '(the events beacon and the user_data flush) — this clause resolved almost nothing, so it '
    + 'cannot report keepalive as intact');
  const bare = senders.filter((s) => s.keepalive !== true);
  must(!bare.length,
    `${bare.length} of ${senders.length} unload fetch() call(s) do not carry keepalive:true `
    + `(${bare.map((s) => s.name).join(', ')}) — an ordinary fetch started in a pagehide handler is `
    + 'cancelled as the document is discarded, which is the AbortError already sitting in '
    + 'production client_error rows from 2026-10-03');

  /* ---- (d) viaBeacon still gates the beacon ---------------------------------------------- */
  const fce = fns.get('flushClientErrors');
  must(fce, 'flushClientErrors is gone — a rename must fail here rather than turn this clause '
    + 'into a pass by omission');
  const viaParam = fce.params[1];
  must(viaParam && viaParam.type === 'Identifier',
    'flushClientErrors no longer takes a second parameter, so the call site above is passing a '
    + 'flag nothing reads');
  const gated = nodesIn(fce, (n) => (n.type === 'IfStatement' || n.type === 'ConditionalExpression')
    && nodesIn(n.test, (t) => t.type === 'Identifier' && t.name === viaParam.name).length
    && nodesIn(n.type === 'IfStatement' ? n.consequent : n.consequent,
      (t) => isCallTo(t, 'beaconInsert')).length);
  must(gated.length >= 1,
    `flushClientErrors no longer branches on \`${viaParam.name}\` to send through beaconInsert — the `
    + 'unload batch goes out on an ordinary fetch that the discarded document cancels, whatever '
    + 'the call site still passes');

  /* ---- (e) session_end is the name, and the send is reached ------------------------------- */
  const es = fns.get('endSession');
  must(es, 'endSession is gone — a rename must fail here rather than leave this clause nothing '
    + 'to inspect');
  const sends = nodesIn(es, (n) => isCallTo(n, 'beaconInsert')
    && nodesIn(n, (t) => isCallTo(t, 'eventRow') && t.arguments[0]
      && t.arguments[0].type === 'StringLiteral' && t.arguments[0].value === 'session_end').length);
  must(sends.length === 1,
    `endSession makes ${sends.length} beaconInsert() call(s) carrying eventRow('session_end', …), `
    + "expected 1 — the event name is what every query in docs/ and scripts/ reads, so a rename "
    + 'orphans every row already in the table');
  /* An unconditional `return` among the statements PRECEDING the send makes it unreachable —
     the Invariant-1 break (b) shape. The real function's two early returns are consequents of
     `if`s, so they are never direct siblings. */
  const send = sends[0];
  const blocked = nodesIn(es, (n) => n.type === 'BlockStatement' && within(send, rangeOf(n)))
    .some((b) => b.body.some((s) => s.type === 'ReturnStatement' && s.end <= send.start));
  must(!blocked,
    'endSession returns unconditionally before it sends the exit row — the function is still '
    + 'there, still called, and writes nothing');

  /* ---- (f) ob_step 0 can still fire ------------------------------------------------------ */
  const obCalls = allCalls.filter((c) => isCallTo(c, 'track') && c.arguments[0]
    && c.arguments[0].type === 'StringLiteral' && c.arguments[0].value === 'ob_step');
  must(obCalls.length === 1,
    `found ${obCalls.length} track('ob_step') call(s), expected 1 — the onboarding funnel's only `
    + 'stage event is gone or duplicated, and this clause has nothing to anchor on');
  const guards = nodesIn(program, (n) => n.type === 'IfStatement' && within(obCalls[0], rangeOf(n)))
    .sort((a, b) => (b.start - a.start))               // innermost first
    .map((n) => nodesIn(n.test, (t) => t.type === 'BinaryExpression' && t.operator === '>')
      .concat(n.test.type === 'BinaryExpression' && n.test.operator === '>' ? [n.test] : []))
    .find((cmp) => cmp.length);
  must(guards && guards.length,
    "the track('ob_step') call is no longer behind a `>` comparison — markObStep fires on every "
    + 'step change, so back-navigation and "Edit my setup" double-count and the rows stop reading '
    + 'as a funnel');
  const rhs = guards[0].right;
  must(rhs.type === 'MemberExpression' && rhs.property.type === 'Identifier'
    && rhs.property.name === 'current' && rhs.object.type === 'Identifier',
    'the ob_step guard no longer compares against a ref\'s .current — a literal floor makes '
    + 'step 0 (the welcome screen, the most common exit in the data) the one stage that can '
    + `never fire, which is the 2026-09-16 defect verbatim (right side is ${rhs.type})`);
  const refName = rhs.object.name;
  const nums = new Map();
  for (const d of nodesIn(program, (x) => x.type === 'VariableDeclarator'
    && x.id.type === 'Identifier' && x.init)) {
    const i = d.init;
    if (i.type === 'NumericLiteral') nums.set(d.id.name, i.value);
    else if (i.type === 'UnaryExpression' && i.operator === '-' && i.argument.type === 'NumericLiteral') {
      nums.set(d.id.name, -i.argument.value);
    }
  }
  const refDecl = nodesIn(program, (x) => x.type === 'VariableDeclarator'
    && x.id.type === 'Identifier' && x.id.name === refName
    && x.init && isCallTo(x.init, 'useRef'))[0];
  must(refDecl, `the ob_step guard reads \`${refName}.current\` but \`${refName}\` is not a useRef() `
    + 'binding this check can find, so its initial value cannot be established');
  const seedNode = refDecl.init.arguments[0];
  let seed = null;
  if (!seedNode) seed = null;
  else if (seedNode.type === 'NumericLiteral') seed = seedNode.value;
  else if (seedNode.type === 'UnaryExpression' && seedNode.operator === '-'
    && seedNode.argument.type === 'NumericLiteral') seed = -seedNode.argument.value;
  else if (seedNode.type === 'Identifier' && nums.has(seedNode.name)) seed = nums.get(seedNode.name);
  must(seed !== null && seed < 0,
    `\`${refName}\` is seeded with ${seed === null ? `an expression this check cannot read (${(seedNode || {}).type || 'nothing'})` : seed}, `
    + 'not a negative sentinel — goObStep(0) compares n > ref.current, so a seed of 0 makes the '
    + 'WELCOME step the one stage of the funnel that can never fire (fixed 2026-09-16; every '
    + 'ob_step row before that starts at 1)');

  return `pagehide→${flushName}: endSession + flushClientErrors(…,true), ${senders.length} raw `
    + `fetch(es) all keepalive, viaBeacon gates beaconInsert, ob_step floor ${refName}.current=${seed}`;
});

/* ---- the harness cannot write to production ------------------------------------------------
   This is the one property in this repo whose violation has ALREADY happened and is still being
   paid for. Until 2026-09-16 the scratch copy rewrote only the five CDN <script> tags, which
   left `createClient(SUPABASE_URL, …)` pointing at the real project. In the sandbox that failed
   silently; on a GitHub Actions runner the network is open and `ci.yml` runs the smoke suite on
   every push and pull_request, so every CI run inserted real `app_open` / `setup_completed` /
   `shift_saved` rows into production `events` under a fresh anon_id. 291 rows, 251 of them
   carrying Playwright's impossible `iPhone OS 15_0` + `Version/18.0` pair: a test suite was the
   app's largest "user" by two orders of magnitude, and CLAUDE.md still records every activation
   figure since 2026-09-07 as inflated by exactly that cohort.

   The check that held it was TWO UNANCHORED REGEXES over the whole file plus two literal
   call-site string matches, and its label printed the property-word `scratch copies point at
   .invalid`. Measured against that clause before this was written, SEVEN realistic edits left
   the gate printing `All 21 mechanical checks passed`:

     (a) `neutralizeSupabase` neutered to `return html;` on its first line — the identity-function
         shape, one line, the thing anyone reaches for while debugging a scratch copy, and it
         restores the 2026-09-07 defect verbatim. Every regex still matched; the constant was
         still declared; both call sites were still there.
     (b) the host swap dropped from the returned expression, the `connect-src` widening kept.
     (c) `NEUTRAL_SUPABASE_HOST` repointed at `https://mnnlgcxnvodjwlhhiphq.supabase.co` — green
         because `/\.invalid'/` matched a DIFFERENT line, the `EXPECTED_NETWORK` list 100 lines
         further down. A whole-file regex cannot tell which occurrence it is standing on.
     (d) the scratch page written BEFORE it is neutralised (the two statements transposed) — the
         call site the old clause pinned was still present, character for character, and the
         bytes on disk were the production ones.
     (e) `buildOpsScratch` stops calling it, the call left behind as a comment — `includes()`
         over the whole file, so a comment satisfied it. Invariant 1's break (c) one file over.
     (f) the `Supabase host not found` throw removed, so a moved host silently no-ops.
     (g) the `no connect-src in the meta CSP` throw removed, so the widening silently no-ops and
         every assertion about what the app SENDS stops being able to fire.

   And it was wrong in the other direction too, which is the half that gets a check weakened by
   whoever meets it: renaming the constant, and renaming the local `html` to `doc` inside
   `buildOpsScratch`, both turned it RED with nothing about the behaviour changed.

   Read from the module's AST now: five properties plus three anti-vacuity floors, eight `must()`s
   and ten deliberate breaks in `scripts/test_check_build.mjs`. The neutraliser is identified by WHAT IT DOES
   — a string replacement whose source resolves to a `*.supabase.co` URL and whose replacement
   resolves to a host under `.invalid` (RFC 2606, which can never resolve) — never by its name,
   so (b) and (c) have nothing to hide behind and a rename is free. That replacement must be
   REACHABLE, which is what (a) breaks. Both self-guards must still throw. And the pages are
   derived from the WRITES: every `writeFileSync` of an `.html` file must be handed a value the
   neutraliser produced earlier in the same function, so (d) and (e) fail, a third scratch page
   is covered the day it lands, and the variable is resolved by binding rather than by the name
   `html`. `tests/harness.mjs` is an ES module, so this is the gate's first `sourceType:'module'`
   parse — parses 3 → 4, walks 24 → 25.

   Anything unresolvable THROWS. No live defect was found: both pages are neutralised today, so
   this is a regression guard like Invariant 1's rewrite, §54 and §62 — except that unlike those
   three, the regression it guards is one this repo has already shipped once. */
check('events', 'Harness cannot write to production', () => {
  const h = read('tests/harness.mjs');
  let program = null;
  /* Rethrown with what it MEANS rather than left as Babel's bare parser message: a harness that
     does not parse runs no assertions at all, and this check has to say so rather than shrug. */
  try { walk(h, { Program(p) { program = p.node; } }, [], 'module'); } catch (e) {
    throw new Error(`tests/harness.mjs does not parse as an ES module (${String(e.message).split('\n')[0]})`
      + ' — the smoke suite cannot run in this state, so this check can say nothing about whether'
      + ' the scratch copies are offline, and fails rather than passing by omission');
  }
  must(program, 'tests/harness.mjs yielded no Program node — this walk resolved nothing, so it '
    + 'cannot report the scratch copies as offline');

  const SKIP = new Set(['loc', 'leadingComments', 'trailingComments', 'innerComments', 'comments',
    'extra', 'tokens', 'errors']);
  const nodesIn = (root, pred, out = []) => {
    if (!root || typeof root !== 'object') return out;
    if (Array.isArray(root)) { for (const n of root) nodesIn(n, pred, out); return out; }
    if (typeof root.type === 'string' && pred(root)) out.push(root);
    for (const k of Object.keys(root)) {
      if (SKIP.has(k)) continue;
      const v = root[k];
      if (v && typeof v === 'object') nodesIn(v, pred, out);
    }
    return out;
  };
  const within = (n, r) => n.start >= r.start && n.end <= r.end;
  const rangeOf = (n) => ({ start: n.start, end: n.end });

  /* Module-scope string bindings, so every clause below can read a constant instead of its name.
     This is what makes renaming NEUTRAL_SUPABASE_HOST a behaviour-neutral edit again. */
  const strs = new Map();
  for (const d of nodesIn(program, (x) => x.type === 'VariableDeclarator'
    && x.id.type === 'Identifier' && x.init && x.init.type === 'StringLiteral')) {
    strs.set(d.id.name, d.init.value);
  }
  const strOf = (n) => {
    if (!n) return null;
    if (n.type === 'StringLiteral') return n.value;
    if (n.type === 'Identifier') return strs.has(n.name) ? strs.get(n.name) : null;
    if (n.type === 'TemplateLiteral' && !n.expressions.length) {
      return n.quasis.map((q) => q.value.cooked).join('');
    }
    return null;
  };
  const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };
  /* The project URL the app ships, in the shape `createClient` is handed it. Matched on the whole
     value, so a path or a query cannot sneak past it. */
  const PROD_HOST = /^https?:\/\/[a-z0-9-]+\.supabase\.co\/?$/i;
  /* Every string this node could be standing for: literals, template literals with no
     substitutions, resolvable identifiers, and regex patterns (the connect-src guard is a
     RegExpLiteral, not a string). */
  const textIn = (n) => nodesIn(n, (x) => x.type === 'StringLiteral' || x.type === 'Identifier'
    || x.type === 'TemplateLiteral' || x.type === 'RegExpLiteral')
    .map((x) => (x.type === 'RegExpLiteral' ? x.pattern : strOf(x)))
    .filter((v) => typeof v === 'string');

  /* Every function reachable by name: declarations and `const f = function/arrow`. */
  const fns = new Map();
  for (const n of nodesIn(program, (x) => x.type === 'FunctionDeclaration' && x.id)) fns.set(n.id.name, n);
  for (const n of nodesIn(program, (x) => x.type === 'VariableDeclarator'
    && x.id.type === 'Identifier' && x.init
    && (x.init.type === 'FunctionExpression' || x.init.type === 'ArrowFunctionExpression'))) {
    if (!fns.has(n.id.name)) fns.set(n.id.name, n.init);
  }
  must(fns.size >= 8, `only ${fns.size} named functions resolved in tests/harness.mjs — this walk `
    + 'is reading the wrong thing, so every clause below would pass by having nothing to inspect');

  /* ---- (a) the neutraliser, found by what it DOES ----------------------------------------
     `s.split(FROM).join(TO)` and `s.replace(FROM, TO)` / `.replaceAll(…)` are all accepted: the
     claim is that the production host is swapped for an unresolvable one, not that it is spelled
     with any particular method. */
  const swapsIn = (node) => {
    const out = [];
    for (const c of nodesIn(node, (x) => x.type === 'CallExpression'
      && x.callee.type === 'MemberExpression' && x.callee.property.type === 'Identifier')) {
      const m = c.callee.property.name;
      const inner = c.callee.object;
      if (m === 'join' && inner.type === 'CallExpression'
        && inner.callee.type === 'MemberExpression'
        && inner.callee.property.type === 'Identifier'
        && inner.callee.property.name === 'split') {
        out.push({ node: c, from: strOf(inner.arguments[0]), to: strOf(c.arguments[0]) });
      } else if (m === 'replace' || m === 'replaceAll') {
        out.push({ node: c, from: strOf(c.arguments[0]), to: strOf(c.arguments[1]) });
      }
    }
    return out;
  };
  const isNeutralising = (s) => s.from && PROD_HOST.test(s.from)
    && s.to && String(hostOf(s.to)).endsWith('.invalid');

  const found = [];
  for (const [name, f] of fns) {
    const hits = swapsIn(f).filter(isNeutralising);
    if (hits.length) found.push({ name, fn: f, swap: hits[0] });
  }
  must(found.length === 1,
    `expected exactly 1 function in tests/harness.mjs that swaps the production Supabase host for `
    + `a .invalid one, found ${found.length}${found.length ? ` (${found.map((x) => x.name).join(', ')})` : ''} `
    + '— with no such rewrite the scratch copy talks to the real project, and CI inserts real rows '
    + 'into production events on every push, exactly as it silently did until 2026-09-16');
  const { name: neutName, fn: neutFn, swap } = found[0];

  /* ---- (b) that rewrite is REACHABLE ----------------------------------------------------
     `return html;` on the function's first line leaves the swap in the tree and dead. This is
     the Invariant-1 break (b) shape, and here it is the single cheapest way to repoint the whole
     suite at production. */
  const deadBefore = nodesIn(neutFn, (n) => n.type === 'BlockStatement' && within(swap.node, rangeOf(n)))
    .some((b) => b.body.some((s) => s.type === 'ReturnStatement' && s.end <= swap.node.start));
  must(!deadBefore,
    `${neutName}() returns unconditionally before it swaps the host — the function is still there, `
    + 'still called from both builders, and hands back the production bytes unchanged');

  /* ---- (c) + (d) the two self-guards that make the rewrite falsifiable -------------------
     Without them a moved host or a renamed CSP directive turns the rewrite into a silent no-op,
     which is precisely how this went unnoticed for nine days of CI runs the first time. */
  const guards = nodesIn(neutFn, (n) => n.type === 'IfStatement'
    && nodesIn(n.consequent, (t) => t.type === 'ThrowStatement').length);
  must(guards.some((g) => textIn(g.test).some((v) => PROD_HOST.test(v))),
    `${neutName}() no longer throws when the production Supabase host is absent — a moved or `
    + 'renamed host makes the rewrite a no-op that reports success, and the scratch copy is back '
    + 'on production with nothing saying so');
  must(guards.some((g) => textIn(g.test).some((v) => v.includes('connect-src'))),
    `${neutName}() no longer throws when the meta CSP has no connect-src — the widening below it `
    + 'silently no-ops, every telemetry request is killed by CSP before it reaches the network, '
    + 'and so before Playwright can intercept it: every assertion about what the app SENDS stops '
    + 'being able to fire, while passing');

  /* ---- (e) every scratch page written is neutralised FIRST -------------------------------
     Derived from the writes, not from two pinned call sites: a third scratch page is covered the
     day it lands, and the page variable is resolved by its binding rather than by the name
     `html`. `copyFileSync` is deliberately out of scope — privacy.html is copied verbatim
     because it is self-contained and names no Supabase host at all. */
  const writes = nodesIn(program, (n) => n.type === 'CallExpression'
    && n.callee.type === 'Identifier' && n.callee.name === 'writeFileSync'
    && nodesIn(n.arguments[0], (a) => a.type === 'StringLiteral' && /\.html$/i.test(a.value)).length);
  must(writes.length >= 2,
    `found ${writes.length} writeFileSync() call(s) for an .html scratch page, expected at least 2 `
    + '(index.html and ops.html) — this clause resolved almost nothing, so it cannot report the '
    + 'pages as neutralised');

  const unprotected = [];
  for (const w of writes) {
    const page = (nodesIn(w.arguments[0], (a) => a.type === 'StringLiteral'
      && /\.html$/i.test(a.value))[0] || {}).value;
    const src = w.arguments[1];
    /* Inline `writeFileSync(…, neutralize(html, …))` is fine on its own terms. */
    if (src && src.type === 'CallExpression' && src.callee.type === 'Identifier'
      && src.callee.name === neutName) continue;
    if (!src || src.type !== 'Identifier') {
      unprotected.push(`${page} (written from a ${(src || {}).type || 'missing'} this check cannot resolve)`);
      continue;
    }
    const owner = [...fns.values()].filter((f) => within(w, rangeOf(f)))
      .sort((a, b) => (b.start - a.start))[0];
    if (!owner) { unprotected.push(`${page} (written outside any named function)`); continue; }
    const assigned = nodesIn(owner, (n) => (n.type === 'AssignmentExpression'
        && n.left.type === 'Identifier' && n.left.name === src.name
        && n.right.type === 'CallExpression' && n.right.callee.type === 'Identifier'
        && n.right.callee.name === neutName)
      || (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.id.name === src.name
        && n.init && n.init.type === 'CallExpression' && n.init.callee.type === 'Identifier'
        && n.init.callee.name === neutName))
      .filter((n) => n.end <= w.start);
    if (!assigned.length) unprotected.push(page);
  }
  must(!unprotected.length,
    `${unprotected.length} scratch page(s) are written without ${neutName}() having run on the `
    + `value first: ${unprotected.join(', ')} — those bytes still carry the production Supabase `
    + 'host, so the suite writes real rows into production events on every CI run');

  return `${neutName}() ${swap.from} → ${hostOf(swap.to)}, both self-guards throw, `
    + `${writes.length} scratch page(s) neutralised before they are written`;
});

/* ---- the event inventory can still see every name ----------------------------------------
   `scripts/dashboard_snapshot.mjs` answers one question — which instrumented event has NEVER
   fired, i.e. which shipped feature nobody has touched — and it answers it from `index.html`,
   not from Postgres. On 2026-11-09 it was found to be structurally blind to four call shapes,
   so the telemetry of the two newest money features (the raise, #187; dated pay items, #191)
   could never appear in `dead_events` however long nobody used them. The fix was an AST walk,
   pinned by `scripts/test_dashboard_snapshot.mjs` — 44 assertions, nine measured breaks, one of
   which runs the old regex and requires it to come back short.

   **CI does not run that suite.** BACKLOG.md's own words for it: "it is the only thing standing
   between the inventory and a silent return to the regex." This row is that guard moved behind
   the gate CI does run. It is not an invariant and does not claim to be — it is the one property
   whose failure mode is a tool that answers the adoption question with a confident short list.

   Three clauses:

   (a) it RESOLVES. A tracking call whose name cannot be worked out statically throws by design,
       so a new unresolvable shape goes red on the PR rather than on the next night's snapshot.
   (b) every write to `events` is a row built by `eventRow`. The inventory walks four callees, so
       a row assembled inline — `insert({name:'foo', …})` — reaches the table carrying a name the
       inventory can never list. That is the 11-09 defect in a new costume, it is silent, and
       nothing else in this repo looks for it. Both write paths must also be FOUND: a renamed one
       must fail rather than pass by having nothing left to inspect (checks 2, 3 and 13's rule).
   (c) the eight names only an AST can resolve are still in the list. A revert to
       `/track\('([a-z_]+)'/` loses exactly these eight and nothing else, so "simplify this back
       to a grep" goes red here. */
check('events', 'Event inventory sees every name that reaches events', () => {
  /* (a) */
  let sites;
  try {
    sites = trackCallSites(html);
  } catch (e) {
    throw new Error(`the event inventory cannot resolve index.html: ${e.message}`);
  }

  /* (b) Two writers reach the table and no more: supabase-js inside `track`, and the raw
     keepalive POST inside `beaconInsert` (the only sender that survives the tab going away).
     Both are fed by `eventRow`, which exists so the two row shapes cannot drift. Asserted as a
     shape rather than grepped, because the failing edit is an ordinary-looking one. */
  const open = html.indexOf('<script type="text/babel" data-presets="react">');
  const start = html.indexOf('>', open) + 1;
  const src = html.slice(start, html.indexOf('</script>', start));
  const builtByEventRow = (n) => {
    if (!n) return false;
    if (n.type === 'CallExpression') return n.callee && n.callee.type === 'Identifier' && n.callee.name === 'eventRow';
    if (n.type === 'ArrayExpression') return n.elements.length > 0 && n.elements.every(builtByEventRow);
    return false;
  };
  let supaWrites = 0, beaconWrites = 0;
  const inline = [];
  walk(src, {
    CallExpression(p) {
      const c = p.node.callee, where = `line ${(p.node.loc && p.node.loc.start.line) || '?'}`;
      /* supabase.from('events').insert(row) */
      const isSupa = c && c.type === 'MemberExpression' && c.property.name === 'insert'
        && c.object && c.object.type === 'CallExpression'
        && c.object.callee && c.object.callee.type === 'MemberExpression'
        && c.object.callee.property.name === 'from'
        && c.object.arguments.length === 1
        && (c.object.arguments[0].value === 'events');
      const isBeacon = c && c.type === 'Identifier' && c.name === 'beaconInsert';
      if (!isSupa && !isBeacon) return;
      if (isSupa) supaWrites += 1; else beaconWrites += 1;
      if (!builtByEventRow(p.node.arguments[0])) {
        inline.push(`${isSupa ? "from('events').insert" : 'beaconInsert'} at ${where} (${(p.node.arguments[0] || {}).type || 'no argument'})`);
      }
    },
  });
  must(supaWrites > 0,
    "no supabase.from('events').insert(…) call was found — the app's main analytics writer was "
    + 'renamed or moved, so this clause is inspecting nothing and a row built outside eventRow '
    + 'would pass by omission');
  must(beaconWrites > 0,
    'no beaconInsert(…) call was found — the unload sender is the only route session_end takes, '
    + 'and it is exactly the path the 2026-11-09 inventory bug hid behind');
  must(!inline.length,
    `an events row is assembled outside eventRow (${inline.join('; ')}) — every name the app can `
    + 'file has to pass through one of the four callees the inventory walks, or dead_events '
    + 'reports a shipped feature as uninstrumented while it is quietly firing');

  /* (c) One name per shape the 2026-11-09 walk was built to see. Four ride `trackOb` or
     `eventRow` rather than `track`; four are spelled as the consequent/alternate of a ternary.
     A bare-literal grep produces the other 55 and misses precisely these. Refactoring one of
     these call sites into a plain literal fails this on purpose: say so here in the same commit,
     the way the roster below takes a new check. */
  const AST_ONLY = ['ob_view', 'ob_answer', 'ob_back', 'session_end',
    'rate_change_added', 'rate_change_removed', 'pay_item_added', 'pay_item_removed'];
  const lost = AST_ONLY.filter((n) => !sites.names.includes(n));
  must(!lost.length,
    `the inventory no longer sees ${lost.join(', ')} — these are the names a bare `
    + "/track\\('([a-z_]+)'/ cannot produce, so losing them is the signature of the scan being "
    + 'simplified back to a grep, which is the 2026-11-09 defect itself');

  return `${sites.names.length} names, ${sites.forwarders} forwarders, ${sites.calls} calls, all rows via eventRow`;
});

/* ---- the harness tests the code the app actually ships -----------------------------------
   `tests/harness.mjs` holds the five CDN pins a SECOND time, in two tables that must agree with
   each other and with `index.html`, and nothing had ever compared any of the three:

     PKGS  — what `npm install` fetches into the scratch tree (`react@18.2.0`, `pdfjs-dist@3.11.174`…)
     MAP   — CDN url -> path inside node_modules, used to rewrite the five <script> tags in the
             scratch copy because the sandbox blocks unpkg/cdnjs/jsdelivr

   The file's own header already states the rule — "Versions here are pinned to exactly what
   index.html loads. If you bump a CDN pin, bump it here too or the harness stops testing the code
   that ships" — and, like the parser-title promise check 13 took over on 2026-10-29 and the
   `isEvalSupported` promise check 2 took over on 2026-10-31, it was a comment held by nobody.

   Three of the four assertions below guard a failure that is SILENT, and the quietest is the one
   the local paths create. A MAP target carries no version (`react/umd/react.production.min.js`,
   `pdfjs-dist/build/pdf.min.js`) — what sits at that path is whatever PKGS installed. So bump the
   url and not the package and the scratch copy serves a DIFFERENT BUILD than production ships,
   every assertion in the 883-assertion suite still passes, and nothing anywhere says so. The suite
   reads green while testing code the app does not run.

   The fourth is the one that reaches the network. A sixth CDN <script> added to index.html and not
   to MAP is left pointing at the real CDN in the scratch copy, with its `integrity` attribute
   stripped by the blanket rewrite — on a GitHub Actions runner, where the network is open, that is
   the rig fetching a third-party script at test time. `check('events', 'Harness cannot write to
   production')` exists for the sibling case, and the 2026-09-16 incident it records (291 real
   `app_open` rows inserted into production `events` by CI) is what a harness quietly reaching the
   internet costs.

   One claim the 2026-10-31 backlog note got WRONG, corrected here rather than built on: it said a
   bumped pin leaves the scratch copy on the real CDN url. It does not — `buildScratch` throws
   `CDN pin moved, harness is stale` when a MAP source is absent from index.html, which is the
   forward direction already enforced. What it is enforced AS is the problem: a throw inside
   `buildScratch` aborts the suite before `chromium.launch`, and this repo's own rule is that an
   aborted run is not a failed assertion — the gate reads un-run rather than red, which is exactly
   why `tests/smoke.mjs` §53 was added on 2026-10-25. Asserting it here makes it a red gate row on
   a PR instead of a stack trace in a log nobody reads. */
check('harness', 'Harness tests the pins the app ships', () => {
  const h = read('tests/harness.mjs');

  /* Anti-omission, the rule checks 2 and 13 both take: a renamed or deleted table must FAIL here,
     never turn this into a pass by having nothing left to compare. */
  const pkgsBlock = /export const PKGS = \[([\s\S]*?)\n\];/.exec(h);
  must(pkgsBlock, 'could not find the PKGS table in tests/harness.mjs — the list of packages the '
    + 'scratch tree installs is what every version assertion below is read against');
  const pkgs = [...pkgsBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  must(pkgs.length >= 5, `PKGS lists only ${pkgs.length} packages — index.html loads five CDN `
    + 'scripts plus the Playwright driver, so this table has lost entries');

  const mapBlock = /\nconst MAP = \[([\s\S]*?)\n\];/.exec(h);
  must(mapBlock, 'could not find the MAP table in tests/harness.mjs — the CDN-url-to-node_modules '
    + 'rewrite is how the scratch copy loads the pinned libraries at all');
  const map = [...mapBlock[1].matchAll(/\['(https:\/\/[^']+)',\s*'([^']+)'\]/g)]
    .map((m) => ({ url: m[1], local: m[2] }));
  must(map.length === 5, `MAP holds ${map.length} rows; index.html loads 5 remote scripts`);

  /* PKGS pins by name@version, and a scoped name carries its own @ — split at the last one. */
  const pinnedPkg = new Map(pkgs.map((p) => {
    const at = p.lastIndexOf('@');
    return [p.slice(0, at), p.slice(at + 1)];
  }));

  for (const { url, local } of map) {
    /* (1) forward direction: the url the rewrite looks for is really in index.html. Enforced at
       runtime today only as a throw that aborts the suite. */
    must(html.includes(url),
      `tests/harness.mjs rewrites '${url}', which index.html no longer loads — a CDN pin was `
      + 'bumped without bumping the harness. buildScratch() throws on this, which ABORTS the '
      + 'smoke suite rather than failing an assertion, so the gate reads un-run instead of red');

    /* (2) the version in the url and the version PKGS installs are the same number. The local
       path has no version in it, so a disagreement is invisible: the suite serves a different
       build than production and passes. The package name comes from the LOCAL path because the
       cdnjs url does not carry it (`pdf.js` is published to npm as `pdfjs-dist`). */
    const ver = /(?:@|\/)(\d+\.\d+\.\d+[^/@]*)(?:\/|$)/.exec(url);
    must(ver, `cannot read a version out of the pinned url '${url}', so the harness's copy of `
      + 'that pin cannot be compared to it');
    const pkg = local.startsWith('@') ? local.split('/').slice(0, 2).join('/') : local.split('/')[0];
    must(pinnedPkg.has(pkg),
      `MAP rewrites '${url}' to node_modules/${local}, but PKGS never installs '${pkg}' — the `
      + 'scratch copy will 404 that script and every test will fail for the wrong reason');
    must(pinnedPkg.get(pkg) === ver[1],
      `index.html pins ${pkg} ${ver[1]} but the harness installs ${pkg}@${pinnedPkg.get(pkg)} — `
      + 'the MAP target carries no version, so the scratch copy silently serves the installed '
      + 'build. The whole smoke suite would pass while testing code the app does not ship');
  }

  /* (3) ops.html is the second page the harness builds, and buildOpsScratch finds its row by
     substring, so the supabase-js pin has to be present there too. */
  const supa = map.find((r) => r.url.includes('supabase-js'));
  must(supa && ops.includes(supa.url),
    'the supabase-js pin in tests/harness.mjs is not the one ops.html loads — buildOpsScratch '
    + 'throws, and the ops-console gate assertions never run');

  /* (4) no remote script escapes the rewrite. buildScratch counts how many rewrites it MADE
     (`n < MAP.length`), which cannot see a sixth script that was never in MAP: that tag keeps its
     real CDN url, loses its integrity attribute to the blanket strip, and is fetched from the
     public internet on any runner whose network is open. */
  const tags = [...html.matchAll(/<script[^>]+src="(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  const unmapped = tags.filter((u) => !map.some((r) => r.url === u));
  must(!unmapped.length,
    `index.html loads ${unmapped.length} remote script(s) the harness does not rewrite `
    + `(${unmapped.join(', ')}) — the scratch copy keeps the real CDN url with its integrity `
    + 'attribute stripped, so the test rig fetches a third-party script from the open internet');

  return `${map.length} pins agree with index.html and PKGS`;
});

/* The MCP gateway imports the wage math from a module generated out of index.html's @core
   regions (scripts/extract_core.mjs). A stale copy would price shifts with old math while every
   in-browser probe stayed green, so the committed module must equal a fresh extraction, and the
   regions must not reach outside themselves (window, localStorage, supabase…). */
check('core', 'Extracted core in sync with index.html', () => {
  const { module, regions, exports } = buildCore(html);
  let committed = '';
  try { committed = readFileSync(CORE_OUT, 'utf8'); } catch (_) {}
  must(committed === module,
    'supabase/functions/_shared/badgebudget-core.mjs is stale — run: node scripts/extract_core.mjs');
  must(['periodPaycheck', 'computeNet', 'shiftGross', 'sanitizeData'].every(n => exports.includes(n)),
    'the core no longer exports the functions the gateway prices with');
  return `${regions.length} regions, ${exports.length} exports`;
});

/* ---- personas: starting values, never pay rules (onboarding v2, 2026-10-10) --------------
   CLAUDE.md -> Beyond nurses: "A persona sets starting values and which cards show. It is never
   read by the pay math." The moment one wage function branches on a persona, two nurses with
   identical shifts and rates get different paychecks for reasons no Settings screen shows. So
   every wage-core definition is walked as an AST and may not name a persona, a work status, a
   union answer, a funnel answer or the preset table. Each name must also be FOUND: a renamed
   function that silently drops out of this list would turn the check into a pass by omission. */
check(3, 'Pay math never reads the persona', () => {
  const open = html.indexOf('<script type="text/babel" data-presets="react">');
  const start = html.indexOf('>', open) + 1;
  const src = html.slice(start, html.indexOf('</script>', start));
  const WAGE = ['shiftGross', 'hourlyRate', 'shiftGrossCents', 'hourlyRateCents', 'paidHoursOf',
    'straightTimeCents', 'workPeriodRule', 'workPeriodChunks', 'overtimePremiumCents', 'groupHoursByJob', 'makeJob',
    'computeNet', 'periodPaycheck', 'keepRatioOf', 'keepRatio', 'calc', 'statOf', 'ptoStatOf',
    'sampleNet', 'patternMetrics', 'patternCellToShift', 'patternCellShiftType', 'firstActiveShiftType',
    'toCents', 'fromCents', 'roundCents', 'BONUS', 'BONUS_LABEL',
    'otMultOf', 'minHoursOf', 'minimumTopUpCents',
    'sanitizeRateChanges', 'rateEntryOn', 'rateOn',
    'sanitizePayItems', 'payItemOccursOn', 'payItemOccurrences', 'payItemCents'];
  /* Two patterns, because the case matters for one of them: `ob` + capital is the funnel's own
     namespace (obSeedOpts, obExtrasOn, OB_SCREENS…) and must not match `Object`. */
  /* payEvent (court / call-back / report, session 3, 2026-10-11) is the same kind of thing: a label
     she picks, never a pay rule. The minimum's HOURS are the pay; "court pays differently" would be
     a branch no Settings screen shows. */
  /* A dated pay item's `label` (session 4, 2026-10-20) likewise: "Longevity" and "Bonus" pay what
     their amount says. Case-sensitive and exact, so BONUS_LABEL (a table name) is not a hit. */
  const FORBIDDEN_I = /persona|preset|payEvent|PAY_EVENT/i, FORBIDDEN_CS = /^(workStatus|union|obShift|obPay|label)$|^ob[A-Z]|^OB_/;
  const FORBIDDEN = { test: (x) => FORBIDDEN_I.test(x) || FORBIDDEN_CS.test(x) };
  const found = new Set(), hits = [];
  const isFn = (n) => n && /Function|Arrow/.test(n.type);
  const scan = (name, path) => {
    found.add(name);
    path.traverse({
      /* sanitizePayItems is the one wage name that must touch `label`: it validates and trims it. */
      Identifier(p) { if (FORBIDDEN.test(p.node.name) && !(name === 'sanitizePayItems' && p.node.name === 'label')) hits.push(`${name} -> ${p.node.name}`); },
      StringLiteral(p) { if (/^(healthcare|other|court|callback|report)$/.test(p.node.value) || FORBIDDEN.test(p.node.value)) hits.push(`${name} -> '${p.node.value}'`); },
    });
  };
  walk(src, {
    FunctionDeclaration(p) { if (WAGE.includes(p.node.id && p.node.id.name)) scan(p.node.id.name, p); },
    VariableDeclarator(p) { if (p.node.id.type === 'Identifier' && WAGE.includes(p.node.id.name)) scan(p.node.id.name, p); },
    ObjectProperty(p) {
      const k = p.node.key && (p.node.key.name || p.node.key.value);
      if (WAGE.includes(k) && isFn(p.node.value)) scan(k, p);
    },
  });
  const missing = WAGE.filter((n) => !found.has(n));
  must(!missing.length, `wage-core definitions not found (renamed? update this list): ${missing.join(', ')}`);
  must(!hits.length, `the pay math reads the persona — a persona may only set starting values: ${hits.join('; ')}`);
  return `${WAGE.length} wage definitions, none names a persona, a pay-event label or a pay-item label`;
});

/* ---- Invariant 13: the iCal feed URL is a bearer credential -----------------------------
   CLAUDE.md: "The iCal feed URL is a bearer credential. It lives only in `ical_subscriptions`
   (owner-only RLS, no `anon` grants), is absent from `serializeState` so it never enters the
   `user_data` blob (which is exported, mirrored to localStorage and echoed by the sync poll),
   never goes into `events`, and is never logged by `ical-proxy`." Its Detect trailer is `none`,
   and says why: a leak is silent by construction — nothing observable changes when a bearer
   credential escapes, and the only revocation is the calendar provider reissuing the feed. So
   until now the whole invariant was carried by whoever happened to read the diff.

   Three of its clauses are mechanically checkable and all three are gated here. Two are not —
   the table's RLS and grants, which live in Postgres, and the absence from `events`, which is
   now carried at runtime by `redactUrlPaths` at the one choke point every row passes through
   (2026-10-28) rather than by anything a machine reads here. So 13 stays in the UNCHECKED
   roll-call below with that qualifier, the way 3 already does. A check that let a reader believe
   the invariant was covered would be worse than no check at all. */
check(13, 'iCal feed URL: out of the blob, the log and the parser', () => {
  /* (a) The blob. `serializeState` is the single serializer — the save effect, the .json export
     and the unload flush all call it — so a feed field among its keys IS the leak: that object is
     written to a downloadable file, mirrored into localStorage and echoed back by the 15s sync
     poll. Read as an AST and asserted as a shape rather than grepped: a new field is fine, a feed
     field is not, and a `serializeState` this check cannot find must FAIL rather than pass by
     omission (check 3's rule, for the same reason).
     `tests/smoke.mjs` §33 scans the outgoing keepalive body for the same pattern at runtime. That
     covers one path with real bytes; this covers every path from the one place they share. */
  const open = html.indexOf('<script type="text/babel" data-presets="react">');
  const start = html.indexOf('>', open) + 1;
  const src = html.slice(start, html.indexOf('</script>', start));
  /* Deliberately blunt, and deliberately the same pattern §33 uses, plus `feed` because this side
     reads field NAMES: `feedUrl` would hold the credential while matching none of the rest. The
     bluntness is the point — index.html:~1527 records the same trade when `syncManualOnly` was
     named to avoid tripping it. A future field whose name merely contains "ical" (a `medical*`
     premium is the realistic one) trips this: rename the field, or narrow this on purpose with a
     line saying why. Do not delete the guard to make a name read nicer. */
  const CREDENTIAL = /ical|webcal|feed|basic\.ics/i;
  let keys = null;
  walk(src, {
    VariableDeclarator(p) {
      if (!(p.node.id.type === 'Identifier' && p.node.id.name === 'serializeState')) return;
      const found = [];
      p.traverse({ ObjectProperty(q) {
        const k = q.node.key && (q.node.key.name || q.node.key.value);
        if (k) found.push(String(k));
      } });
      keys = found;
    },
  });
  must(keys && keys.length > 5,
    'serializeState was not found as a variable holding an object literal — if the single ' +
    'serializer moved or was renamed, this check is reading nothing and Invariant 13 just lost ' +
    'its only mechanical guard');
  const leaked = keys.filter((k) => CREDENTIAL.test(k));
  must(!leaked.length,
    `serializeState carries a feed field (${leaked.join(', ')}) — the user_data blob is exported ` +
    'to a file, mirrored to localStorage and echoed by the sync poll, so this is the credential ' +
    'leaving the one table it is allowed to live in');

  /* (b) The proxy log. `ical-proxy` is handed the raw feed URL on every sync, and its own header
     promises "It is NEVER logged" — assert that instead of trusting it. ANY logging call fails,
     not just one that visibly formats the URL: the next edit to this file is the likeliest one to
     add a log, because the first-call `422 not_a_calendar` fault is still unexplained
     (BACKLOG.md → P2) and a debug line is the obvious way to reach for it. The function's edge
     log is also the thing two separate grooms have had to read to diagnose a sync, so a URL
     landing there is a credential sitting in a log somebody opens on purpose. */
  const logs = proxy.match(/\bconsole\s*\.\s*[A-Za-z]+/g) || [];
  must(!logs.length,
    `ical-proxy logs (${logs.join(', ')}) — it is handed the feed URL on every sync and that URL ` +
    'is a bearer credential: anyone holding it reads her whole calendar until the provider ' +
    'reissues the feed');

  /* (c) The parser. Invariant 13's last sentence: "The parser stores dates, times, hours and
     UIDs — never titles. It *reads* `SUMMARY` once, at parse time, to set the boolean
     `offHint` (time off vs. shift), and keeps nothing else from it." index.html:~1145 makes the
     same promise in prose — "The title is read HERE and only here, reduced to this one boolean,
     and never stored or sent anywhere" — and nothing held it.
     The blast path is the one (a) guards, reached from the other end: a parsed event becomes a
     shift, a shift goes into the `user_data` blob, and the blob is exported to a file, mirrored
     to localStorage and echoed by the 15s poll. A title is not the feed URL, but it is calendar
     content from a credentialed fetch, and it is the field most likely to be added by accident —
     a "show her what the feed called it" card is an obvious feature, and the parser is the file
     sync work edits (the time-off title default landed 2026-10-03, the timezone conversion
     2026-09-28). Four assertions, each a different way the clause dies. */
  const TEXT_PROPS = /^(SUMMARY|DESCRIPTION|LOCATION|COMMENT|CATEGORIES|CONTACT|ATTENDEE|ORGANIZER)$/;
  /* The per-event shape. A new key here is fine and must be added on purpose — the same intended
     friction the roster check applies to the check count. */
  const EVENT_KEYS = ['dateKey', 'start', 'hours', 'uid', 'offHint'];
  let sawParser = false, sawOff = false;
  const extraKeys = [], loose = [], returns = [];
  walk(src, {
    FunctionDeclaration(p) {
      const name = p.node.id && p.node.id.name;
      if (name === 'parseICSSchedule') {
        sawParser = true;
        p.traverse({
          /* Every object literal handed to a .push() inside the parser is a candidate event. */
          CallExpression(q) {
            const callee = q.node.callee;
            if (!(callee.type === 'MemberExpression' && callee.property.name === 'push')) return;
            const arg = q.node.arguments[0];
            if (!arg || arg.type !== 'ObjectExpression') return;
            for (const prop of arg.properties) {
              const k = prop.key && (prop.key.name || prop.key.value);
              if (k && !EVENT_KEYS.includes(String(k))) extraKeys.push(String(k));
            }
          },
          /* A text-bearing VEVENT property may only be read as an argument to icsLooksOff.
             Hoisting it into a local first — `const t = props.SUMMARY.value` — is exactly how
             it starts being kept, so that shape must fail even before anything stores it. */
          MemberExpression(q) {
            const k = q.node.property && (q.node.property.name || q.node.property.value);
            if (!k || !TEXT_PROPS.test(String(k))) return;
            const inOff = q.findParent((a) => a.isCallExpression()
              && a.node.callee.type === 'Identifier' && a.node.callee.name === 'icsLooksOff');
            if (!inOff) loose.push(String(k));
          },
        });
      }
      if (name === 'icsLooksOff') {
        sawOff = true;
        /* `offHint` IS stored, so the one thing that keeps (b) honest is this function
           returning a boolean. `return title` or `return props.SUMMARY.value` would put the
           title into every parsed event while matching the key whitelist exactly. Allowed node
           types are the boolean-valued ones; a future helper call (`isOffTitle(t)`) trips this
           on purpose — widen it with a line saying why, do not delete it. */
        p.traverse({ ReturnStatement(q) {
          const a = q.node.argument;
          if (!a) return;
          const okType = a.type === 'BooleanLiteral' || a.type === 'UnaryExpression'
            || a.type === 'LogicalExpression' || a.type === 'BinaryExpression'
            || (a.type === 'CallExpression' && a.callee && a.callee.type === 'MemberExpression'
                && a.callee.property.name === 'test');
          if (!okType) returns.push(a.type);
        } });
      }
    },
  });
  must(sawParser, 'parseICSSchedule was not found — the .ics parser is where a feed\'s titles ' +
    'enter the app, so a renamed or moved parser turns this clause into a pass by omission ' +
    '(check 3\'s rule, and (a)\'s)');
  must(sawOff, 'icsLooksOff was not found — the title is read there and nowhere else, so this ' +
    'clause is reading nothing');
  must(!extraKeys.length,
    `the parsed .ics event carries fields Invariant 13 does not allow (${[...new Set(extraKeys)].join(', ')}) — ` +
    'a parsed event becomes a shift and a shift goes into the user_data blob, which is exported ' +
    'to a file, mirrored to localStorage and echoed by the sync poll. Add the key to EVENT_KEYS ' +
    'in this check if it is genuinely not calendar text');
  must(!loose.length,
    `a text-bearing VEVENT property (${[...new Set(loose)].join(', ')}) is read in the parser outside ` +
    'icsLooksOff — the title may only ever be reduced to that one boolean, never hoisted into a ' +
    'local, logged or stored');
  must(!returns.length,
    `icsLooksOff returns something that is not boolean-valued (${returns.join(', ')}) — offHint IS ` +
    'stored on every parsed event, so a non-boolean return carries the feed\'s title into the ' +
    'blob while passing the field whitelist above');

  return `${keys.length} blob fields, none a feed; proxy logs nothing; parser keeps ${EVENT_KEYS.length} fields, no title`;
});

/* ---- operating-committee caps (docs/leadership.md) -------------------------------------- */
check('cos', 'Operating-committee caps', () => {
  const v = cosViolations(ROOT);
  if (v.length) throw new Error(v.join('; '));
  return '≤3 threads, ≤3 decisions, ≤5 per seat queue, brief ≤40 lines';
});

/* ---- the gate's own roster ---------------------------------------------------------------
   Everything above holds an invariant. Nothing held THIS FILE. Delete a `check()` call and the
   suite prints "All 14 mechanical checks passed" instead of 15, exits 0, and the PR goes green:
   the invariant that check was holding is now held by nobody and no signal anywhere says so.
   That is Invariant 4's shape aimed at the gate, and it is why the count is declared here and
   compared rather than merely printed.

   Adding a check means adding its label to this list in the same commit. That is the intended
   friction — the number was unwatched, so it may only move on purpose.

   `scripts/test_check_build.mjs` holds the same roster and, unlike this check, proves the gate
   actually FAILS on a broken tree (one deliberate break per check, and one per clause where a
   check holds several). A self-check cannot
   establish its own teeth; that suite is what does. */
check('gate', 'Every check this gate claims is still here', () => {
  const self = read('scripts/check_build.mjs');
  const LABELS = ['JSX block parses', 'Boot hardening intact', 'SRI on every CDN script the publish set loads',
    'CSP covers every host the pages load',
    'pdf.js worker matches its pinned library',
    'Every write to user_data carries a conflict target', 'Storage keys unrenamed',
    '@scrubpay .ics sentinel, both halves', 'Publish set is exactly the intended files',
    'Ops console ships nothing it should not',
    'Published pages link only to published files',
    'Deploy branch still triggers a deploy',
    'Unload telemetry intact', 'Harness cannot write to production',
    'Event inventory sees every name that reaches events',
    'Harness tests the pins the app ships',
    'Extracted core in sync with index.html', 'Pay math never reads the persona',
    'iCal feed URL: out of the blob, the log and the parser', 'Operating-committee caps',
    'Every check this gate claims is still here'];
  const absent = LABELS.filter((l) => !self.includes(`, '${l}', () =>`) && !self.includes(`, "${l}", () =>`));
  must(!absent.length,
    `the gate no longer contains checks it claims: ${absent.join('; ')} — either a check was ` +
    'deleted (the invariant it held is now unguarded) or renamed without updating this roster');
  /* Counted from declarations at column 0, which is how every check in this file is written. */
  const declared = (self.match(/^check\(/gm) || []).length;
  must(declared === LABELS.length,
    `this file declares ${declared} checks but the roster lists ${LABELS.length} — a check was ` +
    'added or removed without updating the roster, so "All N passed" is no longer a number ' +
    'anything compares');
  return `${declared} checks, all declared`;
});

/* ---- report ---------------------------------------------------------------------------- */
const pad = (s, n) => String(s).padEnd(n);
console.log('\nBadgeBudget build gate\n');
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${pad('[' + r.invariant + ']', 9)} ${pad(r.label, 42)} ${r.detail}`);
}
console.log('\n  UNCHECKED (human-held): 3 wage-core (only its persona rule is gated), 7 swap salt (deployed SQL), 10 fetch-before-branch,\n                          11 protected branches, 12 URL forwarding off, 13 iCal feed URL (blob + proxy log + parser titles gated; RLS and events are not)\n');

const failed = results.filter(r => !r.ok);
if (failed.length) {
  console.error(`${failed.length} of ${results.length} checks FAILED — do not deploy.\n`);
  process.exit(1);
}
console.log(`All ${results.length} mechanical checks passed.`);
/* Printed so the shared-AST cache is ASSERTED and not merely claimed: ten of the checks above
   are walks and they share this many parses between them. `test_check_build.mjs` pins it, so
   losing the cache (back to one parse per walk) fails that suite instead of just getting slow
   again — which is how the 8-minute meta-test happened in the first place. */
console.log(`${parses} AST parse(s) shared by ${walks} walk(s).\n`);
