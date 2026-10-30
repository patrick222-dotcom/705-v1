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
     to constrain. Its favicon is a data: URI and its only links are a mailto: and "/". */
  const remote = (read('privacy.html').match(/\b(?:src|href)="https?:\/\/[^"]+"/g) || []);
  must(!remote.length,
    `privacy.html is published with no CSP because it is self-contained, and it now references ` +
    `${remote.length} remote URL(s): ${remote[0]} — either drop it or give that page a CSP`);

  return `${gated} tag hosts permitted, privacy.html self-contained`;
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
    'scrubpay_pending_invite', 'scrubpayErrors', 'scrubpay_events_pending'];
  const missing = keys.filter(k => !html.includes(k));
  must(!missing.length, `renaming orphans user data / severs analytics joins: ${missing.join(', ')}`);
  return `${keys.length}/${keys.length} intact`;
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
   Postgres (ops_feedback_inbox raises 42501), but three things about the page itself would
   turn a safe design into a leak, and all three are mechanically checkable. */
check(8, 'Ops console ships nothing it should not', () => {
  must(/name="robots"[^>]*noindex/.test(ops),
    'ops.html lost its noindex — an admin console in Google results is not an admin console');
  must(!/service_role/.test(ops) && !/"role":"service_role"/.test(ops),
    'ops.html contains a service_role key — that key bypasses RLS entirely and must never ship');
  must(!/\.innerHTML\s*=/.test(ops),
    'ops.html assigns innerHTML — every string it renders was typed by the public into a feedback box');
  must(!html.includes('ops.html'),
    'the app links to ops.html — it must stay unreferenced so nurses never discover it exists');
  return 'noindex, no service_role, no innerHTML, unlinked';
});

check(9, 'Deploy branch still triggers a deploy', () => {
  must(deploy.includes('claude/migrate-to-github-deploy-3F5RD'),
    'the de facto default branch was removed from the push triggers — this stops ALL deploys');
  return 'claude/migrate-to-github-deploy-3F5RD present';
});

/* ---- the analytics contract: telemetry that only ever passes proves nothing -------------
   Not numbered invariants, but load-bearing the same way. Both were broken for months in ways
   nothing could see: the exit row did not exist, and the test harness was quietly writing
   production rows. Each failure mode is silent by construction, so each gets a gate. */
check('events', 'Unload telemetry intact', () => {
  must(/'session_end'/.test(html) && /function endSession\(/.test(html),
    'session_end is gone — every abandonment collapses back to "somewhere after app_open"');
  must(/keepalive: true/.test(html),
    'the unload sender lost keepalive — an ordinary fetch is cancelled when the tab goes away, '
    + 'which is the AbortError already sitting in production client_error rows');
  must(/flushClientErrors\(uid, true\)/.test(html),
    'the error buffer no longer flushes on unload — it would report only on a NEXT load, and no '
    + 'public device has ever had one');
  must(/const obMax = useRef\(-1\);/.test(html),
    'obMax is back to 0 — goObStep(0) compares n > obMax.current, so the welcome stage stops firing');
  return 'session_end + keepalive + unload error flush + ob_step 0';
});

check('events', 'Harness cannot write to production', () => {
  const h = read('tests/harness.mjs');
  must(/NEUTRAL_SUPABASE_HOST/.test(h) && /\.invalid'/.test(h),
    'the scratch copy no longer neutralises the Supabase host — CI smoke runs will insert real '
    + 'rows into production events, exactly as they silently did until 2026-09-16');
  must(/neutralizeSupabase\(html, 'index\.html'\)/.test(h)
    && /neutralizeSupabase\(html, 'ops\.html'\)/.test(h),
    'a scratch page is built without neutralising its Supabase host');
  return 'scratch copies point at .invalid';
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
  const Babel = require('@babel/standalone');
  const open = html.indexOf('<script type="text/babel" data-presets="react">');
  const start = html.indexOf('>', open) + 1;
  const src = html.slice(start, html.indexOf('</script>', start));
  const WAGE = ['shiftGross', 'hourlyRate', 'shiftGrossCents', 'hourlyRateCents', 'paidHoursOf',
    'straightTimeCents', 'workPeriodRule', 'workPeriodChunks', 'overtimePremiumCents', 'groupHoursByJob', 'makeJob',
    'computeNet', 'periodPaycheck', 'keepRatioOf', 'keepRatio', 'calc', 'statOf', 'ptoStatOf',
    'sampleNet', 'patternMetrics', 'patternCellToShift', 'patternCellShiftType', 'firstActiveShiftType',
    'toCents', 'fromCents', 'roundCents', 'BONUS', 'BONUS_LABEL',
    'otMultOf', 'minHoursOf', 'minimumTopUpCents',
    'sanitizeRateChanges', 'rateEntryOn', 'rateOn'];
  /* Two patterns, because the case matters for one of them: `ob` + capital is the funnel's own
     namespace (obSeedOpts, obExtrasOn, OB_SCREENS…) and must not match `Object`. */
  /* payEvent (court / call-back / report, session 3, 2026-10-11) is the same kind of thing: a label
     she picks, never a pay rule. The minimum's HOURS are the pay; "court pays differently" would be
     a branch no Settings screen shows. */
  const FORBIDDEN_I = /persona|preset|payEvent|PAY_EVENT/i, FORBIDDEN_CS = /^(workStatus|union|obShift|obPay)$|^ob[A-Z]|^OB_/;
  const FORBIDDEN = { test: (x) => FORBIDDEN_I.test(x) || FORBIDDEN_CS.test(x) };
  const found = new Set(), hits = [];
  const isFn = (n) => n && /Function|Arrow/.test(n.type);
  const scan = (name, path) => {
    found.add(name);
    path.traverse({
      Identifier(p) { if (FORBIDDEN.test(p.node.name)) hits.push(`${name} -> ${p.node.name}`); },
      StringLiteral(p) { if (/^(healthcare|other|court|callback|report)$/.test(p.node.value) || FORBIDDEN.test(p.node.value)) hits.push(`${name} -> '${p.node.value}'`); },
    });
  };
  Babel.transform(src, { sourceType: 'script', code: false, ast: false, presets: ['react'],
    plugins: [() => ({ visitor: {
      FunctionDeclaration(p) { if (WAGE.includes(p.node.id && p.node.id.name)) scan(p.node.id.name, p); },
      VariableDeclarator(p) { if (p.node.id.type === 'Identifier' && WAGE.includes(p.node.id.name)) scan(p.node.id.name, p); },
      ObjectProperty(p) {
        const k = p.node.key && (p.node.key.name || p.node.key.value);
        if (WAGE.includes(k) && isFn(p.node.value)) scan(k, p);
      },
    } })] });
  const missing = WAGE.filter((n) => !found.has(n));
  must(!missing.length, `wage-core definitions not found (renamed? update this list): ${missing.join(', ')}`);
  must(!hits.length, `the pay math reads the persona — a persona may only set starting values: ${hits.join('; ')}`);
  return `${WAGE.length} wage definitions, none names a persona or a pay-event label`;
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
  const Babel = require('@babel/standalone');
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
  Babel.transform(src, { sourceType: 'script', code: false, ast: false, presets: ['react'],
    plugins: [() => ({ visitor: {
      VariableDeclarator(p) {
        if (!(p.node.id.type === 'Identifier' && p.node.id.name === 'serializeState')) return;
        const found = [];
        p.traverse({ ObjectProperty(q) {
          const k = q.node.key && (q.node.key.name || q.node.key.value);
          if (k) found.push(String(k));
        } });
        keys = found;
      },
    } })] });
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
  Babel.transform(src, { sourceType: 'script', code: false, ast: false, presets: ['react'],
    plugins: [() => ({ visitor: {
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
    } })] });
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
  const LABELS = ['JSX block parses', 'Boot hardening intact', 'SRI on all 5 CDN scripts',
    'CSP covers every host the pages load',
    "saveToSupabase upserts on {onConflict:'user_id'}", 'Storage keys unrenamed',
    '@scrubpay .ics sentinel, both halves', 'Publish set is exactly the intended files',
    'Ops console ships nothing it should not', 'Deploy branch still triggers a deploy',
    'Unload telemetry intact', 'Harness cannot write to production',
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
console.log(`All ${results.length} mechanical checks passed.\n`);
