#!/usr/bin/env node
/* Tests for the ops-dashboard snapshot's instrumented-event inventory.
 * Run: node scripts/test_dashboard_snapshot.mjs
 *
 * Pure logic — no network, no database, no browser — so this runs in the CI gate beside the
 * groom-seed, silence-watch and deploy-watch suites.
 *
 * Why it exists. `instrumentedEvents()` is the whole basis of the dashboard's `dead_events`
 * list, i.e. "which shipped feature has nobody touched". Until 2026-11-09 it was the regex
 * /track\('([a-z_]+)'/, which could only see a name spelled as a bare literal immediately after
 * `track(` — and the app had grown four shapes it could not see. Eight names were missing, and
 * production `events` proves both directions of the cost: `ob_view` (79 rows), `ob_answer` (27),
 * `ob_back` (1) and `session_end` (148) had all fired from outside the list, while
 * `rate_change_added` / `rate_change_removed` / `pay_item_added` / `pay_item_removed` have zero
 * rows and so were exactly what `dead_events` exists to print — the telemetry of the raise and
 * of dated pay items, the two newest money features.
 *
 * So the load-bearing cases here are not the happy paths. They are (a) the four real shapes,
 * asserted against the REAL index.html rather than a fixture, because a fixture cannot regress
 * when the app changes; (b) every way an unresolvable call must THROW, because the failure being
 * fixed was a scan that quietly returned a shorter list; and (c) case 30, which pins the old
 * regex as insufficient, so a later "simplify this back to a grep" fails here instead of
 * silently shrinking the inventory again.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { instrumentedEvents, trackCallSites, build } from './dashboard_snapshot.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
/* A throw is the assertion in half this file, so capture it rather than letting it end the run. */
const threw = (fn) => { try { fn(); return null; } catch (e) { return String(e.message || e); } };
/* And every call that is NOT asserting a throw goes through these, for the reason the harness
   skill gives: an aborted run is not a failed assertion. Measured 2026-11-09 — eight of the nine
   deliberate breaks below originally killed this file on an uncaught throw from a FIXTURE case,
   so the run printed one stack trace and never reached the live cases that matter. A break must
   print FAIL lines. An empty array with `.thrown` attached fails every comparison below while
   keeping the detail readable. */
const inv = (html) => { try { return instrumentedEvents(html); } catch (e) { const a = []; a.thrown = String(e.message || e); return a; } };
const sites = (html) => { try { return trackCallSites(html); } catch (e) { return { names: [], forwarders: -1, calls: -1, thrown: String(e.message || e) }; } };
const built = (raw) => { try { return build(raw); } catch (e) { return { dead_events: [], instrumented_count: -1, instrumented_forwarders: -1, fired_count: -1, thrown: String(e.message || e) }; } };

/* A fixture is the app's own wrapper around an arbitrary body: the walk finds the block by the
   exact opening tag index.html ships, so the fixtures must carry that tag verbatim. */
const page = (body) => `<!doctype html><html><body>
<script type="text/babel" data-presets="react">
${body}
</script></body></html>`;

/* ---- A. the shapes the walk must resolve -------------------------------------------------- */

// 1. the plain case: a bare literal
const lit = inv(page("track('a_b', null, null);"));
ok('literal: track(\'a_b\') is found', lit.join() === 'a_b', lit.thrown || lit.join());

// 2. a ternary contributes BOTH branches — the shape #187 and #191 introduced
const tern = inv(page("track(v==='removed' ? 'x_removed' : 'x_added', {}, null);"));
ok('ternary: both branches are names', tern.join() === 'x_added,x_removed', tern.thrown || tern.join());

// 3. and nesting is recursive, not one level deep
const nested = inv(page("track(a ? 'one' : (b ? 'two' : 'three'), {}, null);"));
ok('ternary: nesting resolves every leaf', nested.join() === 'one,three,two', nested.thrown || nested.join());

// 4. a `||` chain is the other branching shape that could appear
const logical = inv(page("track(a || 'fallback_name', {}, null);"));
ok('logical: a || chain contributes its literal sides', logical.join() === 'fallback_name', logical.thrown || logical.join());

// 5-7. all four callees reach the events table, so all four count
const obCall = inv(page("trackOb('ob_view', {});"));
ok('callee: trackOb() counts — the onboarding whitelist wrapper',
  obCall.join() === 'ob_view', obCall.thrown || obCall.join());
const defCall = inv(page("trackDeferred('sign_in_attempted', {});"));
ok('callee: trackDeferred() counts — the pending-events queue',
  defCall.join() === 'sign_in_attempted', defCall.thrown || defCall.join());
const rowCall = inv(page("beaconInsert([eventRow('session_end', p, u)]);"));
ok('callee: eventRow() counts — session_end rides only the keepalive beacon',
  rowCall.join() === 'session_end', rowCall.thrown || rowCall.join());

// 8. a callee that is not one of the four must not contribute, or the list fills with noise
ok('callee: an unrelated function with a string first arg is not an event',
  threw(() => instrumentedEvents(page("notTracking('nope');"))) !== null,
  'an inventory of zero must throw, not return []');

// 9. a member-expression callee is deliberately not matched: the app has none, and matching one
//    would start harvesting names out of unrelated APIs (supabase.from('events') is the warning).
ok('callee: obj.track(\'x\') is not matched — identifier callees only',
  threw(() => instrumentedEvents(page("analytics.track('x_y');"))) !== null);

// 10-11. the relays carry no name of their own; they are counted, never listed
const fwdIdent = sites(page("track('real_one', p, u); function f(){ track(name, p, u); }"));
ok('forwarder: an identifier first arg is counted, not named',
  fwdIdent.names.join() === 'real_one' && fwdIdent.forwarders === 1,
  `${fwdIdent.names.join()} / ${fwdIdent.forwarders}`);
const fwdMember = sites(page("track('real_one', p, u); track(e.name, e.props, u);"));
ok('forwarder: a member-expression first arg is counted, not named',
  fwdMember.names.join() === 'real_one' && fwdMember.forwarders === 1,
  `${fwdMember.names.join()} / ${fwdMember.forwarders}`);

// 12-14. the list's own shape
const shape = sites(page("track('zz_last'); track('aa_first'); track('zz_last');"));
ok('shape: names come back sorted', shape.names.join() === 'aa_first,zz_last', shape.thrown || shape.names.join());
ok('shape: a name fired from two call sites appears once', shape.names.length === 2);
ok('shape: every tracking call site is counted, duplicates included', shape.calls === 3, String(shape.calls));

/* ---- B. the loud failures. Each one is a shape that must stop the snapshot ----------------- */

// 15-16. an unresolvable name must throw, and say where and what
const concat = threw(() => instrumentedEvents(page("track('pre_' + suffix, {}, null);")));
ok('throws: a computed name is refused rather than dropped', concat !== null, String(concat).slice(0, 80));
ok('throws: and the message names the call site and the node type',
  /track\(\) line \d+/.test(String(concat)) && /BinaryExpression/.test(String(concat)), String(concat));
/* ...and in a file that resolved other names too, so the refusal is the resolver's own and not
   the empty-inventory guard below it. Measured: without this, break 4 ("an unresolvable arg
   returns [] instead of throwing") failed only ONE assertion, because a one-call fixture whose
   only name is dropped then trips the zero-names throw and looks like a pass. */
const mixed = threw(() => instrumentedEvents(page("track('fine_one'); track('pre_' + suffix);")));
ok('throws: a computed name is refused even when other names DID resolve',
  /cannot resolve the event name/.test(String(mixed)), String(mixed).slice(0, 70));
ok('throws: a template literal WITH an expression is refused too',
  threw(() => instrumentedEvents(page('track(`pre_${x}`, {}, null);'))) !== null);

// 17. ...and one with no first argument at all
ok('throws: a tracking call with no event name is refused',
  /no event name/.test(String(threw(() => instrumentedEvents(page('track();'))))));

// 18. the Analytics rule is coarse snake_case; a name that breaks it is a bug, not a new style
const shouty = threw(() => instrumentedEvents(page("track('Rate_Change', {}, null);")));
ok('throws: a non-snake_case name is refused', /not a coarse snake_case/.test(String(shouty)), String(shouty).slice(0, 70));

// 19-20. the block itself. An inventory read off a file with no JSX block would be empty, and an
//        empty inventory reads as "nothing is instrumented" — the worst possible quiet answer.
ok('throws: no text/babel block at all',
  /no <script type="text\/babel"/.test(String(threw(() => instrumentedEvents('<html>nothing here</html>')))));
ok('throws: an unterminated text/babel block',
  /unterminated/.test(String(threw(() => instrumentedEvents('<script type="text/babel" data-presets="react">track(\'a_b\');')))));

// 21. and a syntactically fine block that instruments nothing
ok('throws: zero event names found',
  /no event names at all/.test(String(threw(() => instrumentedEvents(page('const x = 1;'))))));

/* ---- C. against the REAL index.html — the regression this file exists to catch ------------- */

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const live = sites(html);

// 22-24. the four shapes, each one a name the old regex could not see
for (const n of ['rate_change_added', 'rate_change_removed']) {
  ok(`live: ${n} is in the inventory (ternary, #187 2026-10-20)`, live.names.includes(n));
}
for (const n of ['pay_item_added', 'pay_item_removed']) {
  ok(`live: ${n} is in the inventory (ternary, #191 2026-11-01)`, live.names.includes(n));
}
for (const n of ['ob_view', 'ob_answer', 'ob_back']) {
  ok(`live: ${n} is in the inventory (trackOb, #167 2026-10-10)`, live.names.includes(n));
}
ok('live: session_end is in the inventory (eventRow, the keepalive beacon)', live.names.includes('session_end'));

// 25. the floor. Deliberately >= and not ==: a feature that adds an event must not fail this,
//     but losing one must. The eight names above are what the old regex was short by.
ok('live: the inventory holds at least 63 names', live.names.length >= 63, live.thrown || String(live.names.length));

// 26. no relay identifier may have been harvested as if it were an event name
ok('live: no forwarder identifier leaked into the names',
  !['name', 'props', 'userId', 'e', 'rows'].some((n) => live.names.includes(n)),
  live.names.filter((n) => ['name', 'props', 'userId', 'e', 'rows'].includes(n)).join());

// 27. every live name obeys the Analytics rule, checked off the real file rather than a fixture
ok('live: every name in the app is coarse snake_case',
  live.names.every((n) => /^[a-z][a-z0-9_]*$/.test(n)),
  live.names.filter((n) => !/^[a-z][a-z0-9_]*$/.test(n)).join());

// 28. three relays: trackOb -> track, the deferred queue -> track, track -> eventRow. If this
//     moves, a new routing layer was added — the one change that can hide a name from the list.
ok('live: exactly 3 forwarder call sites', live.forwarders === 3, String(live.forwarders));

// 29. the public wrapper and the detailed one must not drift apart
ok('live: instrumentedEvents() is trackCallSites().names',
  inv(html).join() === live.names.join());

// 30. THE REGRESSION PIN. The old implementation, run here on purpose: it must come back SHORT.
//     This is what makes "simplify it back to a grep" fail loudly instead of silently dropping
//     eight names again. If the app ever legitimately has no non-literal call site, this fails
//     and the right fix is to delete this case with a line saying so — not to widen it.
const legacy = [...new Set([...html.matchAll(/track\('([a-z_]+)'/g)].map((m) => m[1]))];
const missedByRegex = live.names.filter((n) => !legacy.includes(n));
ok('regex: the old grep is still provably insufficient — do not go back to it',
  missedByRegex.length >= 8, `misses ${missedByRegex.length}: ${missedByRegex.join(', ')}`);
ok('regex: and the names it misses are the four shapes, not arbitrary ones',
  ['rate_change_added', 'pay_item_added', 'ob_view', 'session_end'].every((n) => missedByRegex.includes(n)),
  missedByRegex.join(', '));

/* ---- D. build(): the inventory reaching the snapshot --------------------------------------- */

const snap = built({ adoption: [{ name: 'ob_view', n: 79 }, { name: 'app_open', n: 758 }] });

// 31-33. dead_events is the output the whole inventory exists to produce
ok('build: a never-fired name lands in dead_events',
  snap.dead_events.includes('rate_change_added') && snap.dead_events.includes('pay_item_added'));
ok('build: a name that HAS fired does not', !snap.dead_events.includes('ob_view'));
ok('build: fired_count counts a name the old regex could not see',
  snap.fired_count === 2, String(snap.fired_count));
ok('build: instrumented_count matches the inventory',
  snap.instrumented_count === live.names.length, `${snap.instrumented_count} vs ${live.names.length}`);
ok('build: the forwarder count rides along, so a new relay layer is visible',
  snap.instrumented_forwarders === 3, String(snap.instrumented_forwarders));
ok('build: the snapshot keeps the SQL fields it was handed',
  Array.isArray(snap.adoption) && snap.adoption.length === 2);

console.log(`\n==== dashboard_snapshot tests: ${pass} passed / ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
