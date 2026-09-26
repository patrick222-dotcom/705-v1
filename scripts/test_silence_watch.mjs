#!/usr/bin/env node
/* Tests for the silence watch. Run: node scripts/test_silence_watch.mjs
 *
 * Pure logic only — no network, no token, so this runs in the CI gate alongside the groom-seed
 * suite. The live probes in silence_watch.mjs are a thin wrapper over these functions.
 *
 * The load-bearing cases are the ones that encode a mistake this repo actually made: the
 * 162-byte github.io redirect body that "passes" every content check ever pointed at it, and
 * reporting green when the telemetry side could not be read at all.
 */
import { classify, siteVerdict, hoursSince, urlIsGradeable, render } from './silence_watch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const NOW = new Date('2026-09-26T08:00:00Z');
const goodBody = 'x'.repeat(400000) + 'integrity="sha384-a"'.repeat(5);
const healthySite = siteVerdict({ url: 'https://badgebudget.com/index.html', status: 200, body: goodBody });
const healthyPolicy = { ok: true, detail: 'events_insert {anon,authenticated}' };

// 1. the URL guard: github.io can never be graded, because it 301s to an empty body
ok('url: badgebudget.com is gradeable', urlIsGradeable('https://badgebudget.com/index.html').ok);
ok('url: github.io is refused outright',
  urlIsGradeable('https://patrick222-dotcom.github.io/705-v1/index.html').ok === false,
  'the 301 body passes any content check, so grading it is worse than not checking');
ok('url: http is refused', urlIsGradeable('http://badgebudget.com/index.html').ok === false);
ok('url: garbage is refused', urlIsGradeable('not a url').ok === false);

// 2. site verdict: the real deployed shape passes
ok('site: 200 + long body + 5 SRI scripts is healthy', healthySite.ok, `${healthySite.bytes} bytes, ${healthySite.sri} SRI`);

// 3. site verdict: the 162-byte redirect stub is caught — THE case this file exists for
const stub = siteVerdict({ url: 'https://badgebudget.com/index.html', status: 200, body: 'x'.repeat(162) });
ok('site: a 162-byte body is not the app', stub.ok === false);
ok('site: and it says which check failed',
  stub.checks.some((c) => !c.ok && c.name.includes('redirect stub')));

// 3b. the size floor has to hold on its own. A short body that DOES carry 5 SRI tags — a
//     truncated response, or a stub built to look right — must fail on size, not be rescued by
//     the SRI check standing next to it. Without this, lowering the floor breaks nothing visible.
const truncated = siteVerdict({ url: 'https://badgebudget.com/index.html', status: 200, body: 'integrity="sha384-a"'.repeat(5) });
ok('site: a short body with 5 SRI tags still fails on size alone',
  truncated.checks.find((c) => c.name.includes('redirect stub')).ok === false);

// 4. site verdict: a build with the wrong number of SRI scripts is not the app either
const unpinned = siteVerdict({ url: 'https://badgebudget.com/index.html', status: 200, body: 'y'.repeat(400000) });
ok('site: 0 SRI scripts fails the pin check', unpinned.ok === false && unpinned.sri === 0);
ok('site: non-200 fails', siteVerdict({ url: 'https://badgebudget.com/index.html', status: 503, body: goodBody }).ok === false);

// 5. hoursSince accepts both the ISO and the Postgres space-separated shapes
ok('age: parses Postgres "2026-09-26 00:37:41.57+00"',
  Math.abs(hoursSince('2026-09-26 00:37:41.5765+00', NOW) - 7.37) < 0.05,
  String(hoursSince('2026-09-26 00:37:41.5765+00', NOW)));
ok('age: parses ISO', Math.abs(hoursSince('2026-09-26T00:00:00Z', NOW) - 8) < 0.01);
ok('age: no rows -> null', hoursSince(null, NOW) === null);
ok('age: unparseable -> null', hoursSince('never', NOW) === null);

// 6. FRESH: an event inside the window settles it, health probes not needed
const fresh = classify({ latestEventAt: '2026-09-26 00:37:41+00', now: NOW, staleHours: 48, site: null, insertPolicy: null });
ok('verdict: a recent event is FRESH', fresh.verdict === 'FRESH');
ok('verdict: FRESH exits 0', fresh.exitCode === 0);
ok('verdict: FRESH needs no site probe', fresh.site === null, 'a fresh event already answers the question');

// 7. SILENT_BUT_HEALTHY: the two-day gap the groom kept hand-checking
const quiet = classify({ latestEventAt: '2026-09-23 14:57:00+00', now: NOW, staleHours: 48, site: healthySite, insertPolicy: healthyPolicy });
ok('verdict: silence + healthy site = SILENT_BUT_HEALTHY', quiet.verdict === 'SILENT_BUT_HEALTHY');
ok('verdict: SILENT_BUT_HEALTHY exits 0 (reports, does not alarm)', quiet.exitCode === 0);
ok('verdict: and says so in English', /quiet, not broken/.test(quiet.reason));

// 8. SILENT_AND_UNHEALTHY: silence WITH a failed check is the one case for a human
const broken = classify({ latestEventAt: '2026-09-23 14:57:00+00', now: NOW, staleHours: 48, site: stub, insertPolicy: healthyPolicy });
ok('verdict: silence + a redirect stub = SILENT_AND_UNHEALTHY', broken.verdict === 'SILENT_AND_UNHEALTHY');
ok('verdict: SILENT_AND_UNHEALTHY exits 1', broken.exitCode === 1);
ok('verdict: names the failed check in the reason', /redirect stub/.test(broken.reason));

// 8b. a healthy site with a missing INSERT policy is still unhealthy — the app could not write
//     telemetry even if a nurse did arrive, which is precisely "silent because broken".
const noPolicy = classify({ latestEventAt: '2026-09-23 14:57:00+00', now: NOW, staleHours: 48, site: healthySite,
  insertPolicy: { ok: false, detail: 'no INSERT policy on public.events' } });
ok('verdict: no events INSERT policy is unhealthy even with the site up', noPolicy.verdict === 'SILENT_AND_UNHEALTHY');
ok('verdict: and names the policy', /insert policy/i.test(noPolicy.reason));

// 9. UNKNOWN: an unreadable check is never a passing check
const unread = classify({ latestEventAt: null, now: NOW, staleHours: 48, site: healthySite, insertPolicy: healthyPolicy, telemetryError: 'HTTP 401' });
ok('verdict: unreadable telemetry is UNKNOWN, not green', unread.verdict === 'UNKNOWN');
ok('verdict: UNKNOWN exits 2', unread.exitCode === 2);

// 9b. an empty events table is silence, not an error — grade it on health like any other silence
const empty = classify({ latestEventAt: null, now: NOW, staleHours: 48, site: healthySite, insertPolicy: healthyPolicy });
ok('verdict: zero rows + healthy site is SILENT_BUT_HEALTHY', empty.verdict === 'SILENT_BUT_HEALTHY');
ok('verdict: and says there are no events at all', /no events at all/.test(empty.reason));

// 9c. a future timestamp means a broken clock, not freshness — do not report FRESH off it
const future = classify({ latestEventAt: '2026-09-27T00:00:00Z', now: NOW, staleHours: 48, site: healthySite, insertPolicy: healthyPolicy });
ok('verdict: a future event timestamp is UNKNOWN, not FRESH', future.verdict === 'UNKNOWN');

// 10. the threshold is a knob, and moving it moves the verdict — this is the judgement call the
//     backlog deliberately left open, so it must be visible rather than baked in.
const sameAge = { latestEventAt: '2026-09-25T00:00:00Z', now: NOW, site: healthySite, insertPolicy: healthyPolicy };
ok('threshold: 48h window calls a 32h-old event FRESH', classify({ ...sameAge, staleHours: 48 }).verdict === 'FRESH');
ok('threshold: 24h window calls the same event silent',
  classify({ ...sameAge, staleHours: 24 }).verdict === 'SILENT_BUT_HEALTHY');
ok('threshold: the window is reported, not hidden', classify({ ...sameAge, staleHours: 24 }).staleHours === 24);

// 11. the rendered report always states the verdict and every check it ran
const text = render(broken);
ok('render: leads with the verdict', text.startsWith('silence-watch: SILENT_AND_UNHEALTHY'));
ok('render: lists every site check', stub.checks.every((c) => text.includes(c.name)));
ok('render: marks failures FAIL', text.includes('[FAIL]'));

console.log(`\n==== silence_watch tests: ${pass} passed / ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
