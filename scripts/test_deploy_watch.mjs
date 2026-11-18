#!/usr/bin/env node
/* Tests for the deploy watch. Run: node scripts/test_deploy_watch.mjs
 *
 * Pure logic only — no network, no git, no token — so this runs in the CI gate beside the
 * groom-seed and silence-watch suites. The live probes in deploy_watch.mjs are a thin wrapper
 * over these functions.
 *
 * The load-bearing cases are the ones that encode a mistake this repo actually made or nearly
 * made: the ~162-byte github.io redirect body that "passes" every content check pointed at it,
 * reporting green for a build that could not be placed at all, and printing one commit's subject
 * beside another commit's sha.
 */
import { sha256, matchCommit, classifyFile, classifyDeploy, render, parseRef, applyRefFreshness, WATCHED, BYTE_ONLY } from './deploy_watch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const URL_INDEX = 'https://badgebudget.com/index.html';
const URL_PRIV = 'https://badgebudget.com/privacy.html';

/* A body shaped like the real deployed index.html: past the 50,000-character floor, 5 SRI pins. */
const appBody = (tag) => 'x'.repeat(400000) + tag + 'integrity="sha384-a"'.repeat(5);
const HEAD_BODY = appBody('HEAD');
const PREV_BODY = appBody('PREV');
const OLD_BODY = appBody('OLD');

const HISTORY = [
  { sha: 'aaaaaaaaaaaaaaaa', date: '2026-10-07', subject: 'fix(sync): the newest one', blobSha256: sha256(HEAD_BODY) },
  { sha: 'bbbbbbbbbbbbbbbb', date: '2026-10-05', subject: 'fix(sync): the unload save rides keepalive', blobSha256: sha256(PREV_BODY) },
  { sha: 'cccccccccccccccc', date: '2026-10-04', subject: 'fix(calendar): phantom hours', blobSha256: sha256(OLD_BODY) },
];
const file = (over = {}) => classifyFile({ path: 'index.html', url: URL_INDEX, status: 200, body: HEAD_BODY, history: HISTORY, scanned: HISTORY.length, ...over });

// 1. the publish set this watches is Invariant 8's five files minus CNAME, which has its own
//    probe. Four since 2026-11-18: `pdf.worker.min.js` had been left out for being "a megabyte
//    that has never changed", which is the same sentence as "nothing has ever read a byte of the
//    copy real users execute".
ok('scope: watches all four hashable published files',
  WATCHED.length === 4
  && ['index.html', 'privacy.html', 'ops.html', 'pdf.worker.min.js'].every((p) => WATCHED.includes(p)),
  WATCHED.join(', '));

// 2. sha256 is the whole mechanism — deploy.yml copies the publish set verbatim, so the served
//    file is byte-for-byte a git blob, and a match needs no marker string to be conclusive.
ok('sha256: identical content hashes identically', sha256('abc') === sha256('abc'));
ok('sha256: one changed character changes the hash', sha256('abc') !== sha256('abd'));

// 3. matchCommit places the served bytes in history
ok('match: head blob is 0 behind', matchCommit(sha256(HEAD_BODY), HISTORY)?.behind === 0);
ok('match: a two-old blob is 2 behind', matchCommit(sha256(OLD_BODY), HISTORY)?.behind === 2);
ok('match: and it names the commit it matched', matchCommit(sha256(PREV_BODY), HISTORY)?.commit?.sha === 'bbbbbbbbbbbbbbbb');
ok('match: an unknown blob matches nothing', matchCommit(sha256('something else'), HISTORY) === null);
ok('match: an empty history matches nothing', matchCommit(sha256(HEAD_BODY), []) === null);
ok('match: a null hash matches nothing', matchCommit(null, HISTORY) === null);

// 4. LIVE — the only green there is, and it is proven rather than inferred
const live = file();
ok('file: head bytes are LIVE', live.verdict === 'LIVE');
ok('file: LIVE names the commit being served', String(live.detail).includes('aaaaaaa'), live.detail);
ok('file: LIVE is 0 behind', live?.behind === 0);

// 5. BEHIND — the case this file exists for. Seven merged commits sat unshipped behind a
//    `waiting` Pages job from 2026-10-06 and nothing in the repo noticed.
const behind = file({ body: PREV_BODY });
ok('file: older bytes are BEHIND', behind.verdict === 'BEHIND');
ok('file: BEHIND counts the unshipped changes', behind?.behind === 1, behind.detail);
ok('file: BEHIND names the LIVE commit, not just the head', String(behind.detail).includes('bbbbbbb'));
ok('file: BEHIND also names the head it is measured against', String(behind.detail).includes('aaaaaaa'));

// 5a. the subject must sit beside the sha it belongs to. An earlier draft printed the live
//     commit's subject right after the HEAD sha, which reads as though the newest change were
//     already out — the confident-but-false shape that has burned this repo three times.
const subjAt = String(behind.detail).indexOf('the unload save rides keepalive');
ok('file: BEHIND prints the live subject beside the LIVE sha',
  subjAt > -1 && subjAt > String(behind.detail).indexOf('bbbbbbb') && subjAt < String(behind.detail).indexOf('aaaaaaa'),
  behind.detail);

const far = file({ body: OLD_BODY });
ok('file: two behind says two', far?.behind === 2 && /2 later changes/.test(String(far.detail)), far.detail);
ok('file: one behind is singular', /1 later change\b/.test(String(behind.detail)), behind.detail);

// 6. NOT_THE_APP — the ~162-byte redirect stub, which passes any grep ever pointed at it
const stub = file({ body: 'x'.repeat(162) });
ok('file: a 162-byte body is NOT_THE_APP', stub.verdict === 'NOT_THE_APP');
ok('file: and it says the body is not the app', /redirect stub/.test(String(stub.detail)), stub.detail);

// 6a. the github.io guard is INHERITED from silence_watch rather than copied. Two copies of that
//     rule is how one of them gets relaxed and nobody notices.
const ghio = file({ url: 'https://patrick222-dotcom.github.io/705-v1/index.html' });
ok('file: github.io is refused even when the bytes match head', ghio.verdict === 'NOT_THE_APP', ghio.detail);

ok('file: a 404 is NOT_THE_APP', file({ status: 404, body: 'nope' }).verdict === 'NOT_THE_APP');
ok('file: a 500 is NOT_THE_APP', file({ status: 500, body: 'nope' }).verdict === 'NOT_THE_APP');

// 7. UNREACHABLE — the fetch never happened, which establishes nothing either way
const dead = file({ body: undefined, fetchError: 'getaddrinfo ENOTFOUND' });
ok('file: a failed fetch is UNREACHABLE', dead.verdict === 'UNREACHABLE');
ok('file: and it carries the error', String(dead.detail).includes('ENOTFOUND'));

// 8. UNKNOWN_BUILD — a plausible app body that matches no commit in the window. Never green.
const unk = file({ body: appBody('NOT-IN-HISTORY') });
ok('file: an unplaceable build is UNKNOWN_BUILD', unk.verdict === 'UNKNOWN_BUILD');
ok('file: UNKNOWN_BUILD says how far it looked', /matches no commit in the last 3/.test(String(unk.detail)), unk.detail);
ok('file: an empty history makes head bytes unplaceable, not live',
  file({ history: [], scanned: 0 }).verdict === 'UNKNOWN_BUILD');

// 9. the small published files are NOT held to index.html's 50,000-character floor. They are a
//    few KB each, so reusing that guard would report NOT_THE_APP for them on every single run.
const privHistory = [{ sha: 'dddddddddddddddd', date: '2026-09-24', subject: 'privacy', blobSha256: sha256('<html>privacy</html>') }];
const priv = classifyFile({ path: 'privacy.html', url: URL_PRIV, status: 200, body: '<html>privacy</html>', history: privHistory, scanned: 1 });
ok('file: a 20-character privacy.html matching head is LIVE', priv.verdict === 'LIVE', priv.detail);
const privEmpty = classifyFile({ path: 'privacy.html', url: URL_PRIV, status: 200, body: '', history: privHistory, scanned: 1 });
ok('file: but an EMPTY privacy.html is NOT_THE_APP', privEmpty.verdict === 'NOT_THE_APP', privEmpty.detail);

// 10. the overall verdict is the worst file, and the exit code follows the verdict
const allLive = classifyDeploy([live, priv]);
ok('deploy: every file live is LIVE', allLive.verdict === 'LIVE');
ok('deploy: LIVE exits 0', allLive.exitCode === 0);

const oneBehind = classifyDeploy([live, behind, priv]);
ok('deploy: one behind file makes the whole deploy BEHIND', oneBehind.verdict === 'BEHIND');
ok('deploy: BEHIND exits 1', oneBehind.exitCode === 1);
ok('deploy: and the reason names the file', String(oneBehind.reason).startsWith('index.html:'), oneBehind.reason);

ok('deploy: NOT_THE_APP outranks BEHIND', classifyDeploy([behind, stub]).verdict === 'NOT_THE_APP');
ok('deploy: BEHIND outranks UNKNOWN_BUILD', classifyDeploy([unk, behind]).verdict === 'BEHIND');
ok('deploy: UNREACHABLE outranks UNKNOWN_BUILD', classifyDeploy([unk, dead]).verdict === 'UNREACHABLE');

// 10a. an unplaceable build must NOT exit 0. An unreadable check is not a passing check — the
//      same rule silence_watch's UNKNOWN encodes.
const unknownOnly = classifyDeploy([unk]);
ok('deploy: UNKNOWN_BUILD exits 2, not 0', unknownOnly.exitCode === 2, `exit ${unknownOnly.exitCode}`);
ok('deploy: UNREACHABLE exits 2, not 0', classifyDeploy([dead]).exitCode === 2);
ok('deploy: NOT_THE_APP exits 1', classifyDeploy([stub]).exitCode === 1);
ok('deploy: checking nothing is UNKNOWN_BUILD, never LIVE', classifyDeploy([]).verdict === 'UNKNOWN_BUILD');

// 10b. more than one file behind is counted, because "index.html is stale" and "the whole
//      publish set is stale" are different problems.
const privBehind = { path: 'privacy.html', verdict: 'BEHIND', detail: 'serving ddddddd', behind: 1 };
ok('deploy: a second behind file is counted in the reason',
  /1 other published file\b/.test(classifyDeploy([behind, privBehind]).reason),
  classifyDeploy([behind, privBehind]).reason);

// 11. CNAME: Invariant 8's loudest failure — without it the site leaves badgebudget.com entirely.
//     It can only ever make the verdict worse.
const noCname = classifyDeploy([live, priv], { ok: false, detail: 'HTTP 404' });
ok('deploy: a missing CNAME turns an all-live deploy into NOT_THE_APP', noCname.verdict === 'NOT_THE_APP');
ok('deploy: and the reason says CNAME', String(noCname.reason).startsWith('CNAME:'), noCname.reason);
ok('deploy: a present CNAME leaves the verdict alone',
  classifyDeploy([live, priv], { ok: true, detail: 'serves "badgebudget.com"' }).verdict === 'LIVE');
ok('deploy: a missing CNAME never downgrades a worse verdict',
  classifyDeploy([stub], { ok: false, detail: 'HTTP 404' }).verdict === 'NOT_THE_APP');

// 12. the rendered report states the verdict and every file it looked at
const text = render(oneBehind);
ok('render: leads with the verdict', String(text).startsWith('deploy-watch: BEHIND'), text.split('\n')[0]);
ok('render: lists every file checked', ['index.html', 'privacy.html'].every((p) => text.includes(p)));
ok('render: marks a live file ok', /\[ok\] privacy\.html/.test(text));
ok('render: marks a behind file FAIL', /\[FAIL\] index\.html/.test(text));

// 12a. three marks, not two: an unplaceable or unreachable file is neither proven live nor
//      proven wrong, and flattening it to FAIL overstates what the check established.
const mixed = render(classifyDeploy([unk, dead]));
ok('render: marks an unplaceable file ?? rather than FAIL', /\[\?\?\] index\.html/.test(mixed), mixed);
ok('render: never marks an unplaceable file ok', !/\[ok\]/.test(mixed));
ok('render: includes the CNAME line when one was probed',
  String(render(noCname)).includes('CNAME — HTTP 404'));

// 13. ref freshness — the case this script got WRONG in production on 2026-10-11, 24 seconds
//     after #175 merged: `LIVE … serving 81c1954`, the PRE-merge commit, because the local clone
//     had not fetched the new head and so `history[0]` was not the tip of the deploy branch.
//     A false LIVE is the exact all-clear CLAUDE.md's four-night Pages-stall lesson exists to
//     prevent, and it is worse than the `curl | grep <marker>` ritual it replaced: a marker grep
//     against stale bytes returns 0 and looks like a failure, this returns the word being waited
//     for. The fix is a VERDICT change, not a printed warning.
const FETCH_OK = { ok: true, ref: 'origin/claude/migrate-to-github-deploy-3F5RD' };
const FETCH_DEAD = { ok: false, local: false, ref: 'origin/claude/migrate-to-github-deploy-3F5RD', error: 'fatal: unable to access' };
const FETCH_LOCAL = { ok: false, local: true, ref: 'HEAD' };

ok('ref: a remote ref splits into remote and branch',
  parseRef('origin/claude/migrate-to-github-deploy-3F5RD').remote === 'origin'
  && parseRef('origin/claude/migrate-to-github-deploy-3F5RD').branch === 'claude/migrate-to-github-deploy-3F5RD');
ok('ref: a branch name containing slashes keeps all of them',
  parseRef('upstream/a/b/c').branch === 'a/b/c', parseRef('upstream/a/b/c').branch);
ok('ref: a ref with no slash is local, with nothing to fetch', parseRef('HEAD').local === true);
ok('ref: a trailing slash is not a branch', parseRef('origin/').local === true);
ok('ref: an empty ref is local', parseRef('').local === true);

// 13a. a successful fetch leaves every verdict exactly as it was
ok('freshness: a fetched ref leaves LIVE alone', applyRefFreshness([live], FETCH_OK)[0].verdict === 'LIVE');
ok('freshness: no fetch info at all leaves LIVE alone (pure callers, unit tests)',
  applyRefFreshness([live], undefined)[0].verdict === 'LIVE');

// 13b. the bug itself: bytes matching a head the script cannot prove is the tip
const staleLive = applyRefFreshness([live], FETCH_DEAD)[0];
ok('freshness: LIVE degrades to UNKNOWN_BUILD when the ref could not be fetched',
  staleLive.verdict === 'UNKNOWN_BUILD', staleLive.verdict);
ok('freshness: and it is flagged as the stale-ref case specifically', staleLive.staleRef === true);
ok('freshness: the detail says a newer commit may be unshipped',
  /newer commit may already be\s+merged and unshipped/.test(String(staleLive.detail)), staleLive.detail);
ok('freshness: the detail carries the fetch error', String(staleLive.detail).includes('unable to access'));
/* Phrased against the stale wording and the sha TOGETHER. `includes('aaaaaaa')` alone passes on
   the undegraded LIVE detail too, so it would have been unfalsifiable — the trap this repo's
   negative-test rule exists to catch, found by break A while negative-testing this section. */
ok('freshness: the detail still names the commit the bytes DID match',
  /match local head aaaaaaa/.test(String(staleLive.detail)), staleLive.detail);
ok('freshness: a local ref degrades too, and says so rather than naming a network error',
  applyRefFreshness([live], FETCH_LOCAL)[0].verdict === 'UNKNOWN_BUILD'
  && /is local/.test(String(applyRefFreshness([live], FETCH_LOCAL)[0].detail)),
  applyRefFreshness([live], FETCH_LOCAL)[0].detail);

// 13c. only LIVE moves. BEHIND, NOT_THE_APP and UNREACHABLE are already true under a stale ref —
//      bytes matching an older blob are stale whether or not a newer commit exists — and a stale
//      ref can only make BEHIND's unshipped count too low, never invent one.
ok('freshness: BEHIND is untouched by a failed fetch',
  applyRefFreshness([behind], FETCH_DEAD)[0].verdict === 'BEHIND');
ok('freshness: NOT_THE_APP is untouched by a failed fetch',
  applyRefFreshness([stub], FETCH_DEAD)[0].verdict === 'NOT_THE_APP');
ok('freshness: UNREACHABLE is untouched by a failed fetch',
  applyRefFreshness([dead], FETCH_DEAD)[0].verdict === 'UNREACHABLE');
ok('freshness: an already-UNKNOWN_BUILD file keeps its own reason, not the stale-ref one',
  applyRefFreshness([unk], FETCH_DEAD)[0].staleRef === undefined);

// 13d. the guard lives INSIDE classifyDeploy so a caller cannot forget it — the false LIVE was a
//      missing step, and a fix that depends on remembering a step is the same bug twice.
const staleDeploy = classifyDeploy([live, priv], { ok: true, detail: 'serves "badgebudget.com"' }, FETCH_DEAD);
ok('deploy: a failed fetch makes an all-live deploy UNKNOWN_BUILD, not LIVE',
  staleDeploy.verdict === 'UNKNOWN_BUILD', staleDeploy.verdict);
ok('deploy: and it does NOT exit 0', staleDeploy.exitCode === 2, `exit ${staleDeploy.exitCode}`);
ok('deploy: a fetched ref still reaches LIVE and exits 0',
  classifyDeploy([live, priv], { ok: true, detail: 'ok' }, FETCH_OK).verdict === 'LIVE'
  && classifyDeploy([live, priv], { ok: true, detail: 'ok' }, FETCH_OK).exitCode === 0);
ok('deploy: applying the guard twice is a no-op',
  classifyDeploy(applyRefFreshness([live], FETCH_DEAD), null, FETCH_DEAD).verdict === 'UNKNOWN_BUILD');
ok('deploy: a failed fetch never downgrades a real BEHIND',
  classifyDeploy([behind, live], null, FETCH_DEAD).verdict === 'BEHIND');
ok('deploy: a missing CNAME still outranks a stale ref',
  classifyDeploy([live], { ok: false, detail: 'HTTP 404' }, FETCH_DEAD).verdict === 'NOT_THE_APP');

// 13e. the report has to SAY which ref it measured against and whether it was current — that is
//      the one thing the 2026-10-11 run needed its reader to know, and it printed it nowhere.
const okText = render(classifyDeploy([live, priv], { ok: true, detail: 'ok' }, FETCH_OK));
ok('render: a fetched ref is reported as fetched', /\[ok\] deploy ref — fetched origin\//.test(okText), okText);
const staleText = render(staleDeploy);
ok('render: an unfetched ref is reported', /\[\?\?\] deploy ref — NOT refreshed/.test(staleText), staleText);
ok('render: an unfetched ref is ?? and never ok', !/\[ok\] deploy ref/.test(staleText));
ok('render: a stale-ref run never leads with LIVE', !staleText.startsWith('deploy-watch: LIVE'), staleText.split('\n')[0]);
ok('render: a local ref says there is no remote to fetch',
  /no remote to fetch/.test(render(classifyDeploy([live], null, FETCH_LOCAL))));
ok('render: omits the ref line entirely when no fetch was attempted', !/deploy ref/.test(render(oneBehind)));

// 14. truncated history — the artefact eight consecutive grooms had to explain away in prose.
//     Containers for this repo clone shallow (Invariant 10), and a shallow boundary commit is
//     parentless in the local graph, so `git log -- <path>` reports it as the commit that ADDED
//     the file. For `privacy.html` and `ops.html` — unchanged since 2026-09-24, with every real
//     change below the boundary — the walk returns one entry and the watch printed it as "serving
//     <that commit>", a figure that drifted every night with the clone depth.
//
//     Two halves, and they are tested separately because they fail separately: the VERDICT must
//     not move (the newest commit the walk can see carries the tip's blob either way, so the
//     bytes really are current, and downgrading a normal clone shape nightly would be crying
//     wolf), and the ATTRIBUTION must stop naming a boundary commit as the one that last changed
//     the file.
const BOUNDARY = [{ sha: 'ddddddddddddddd1', date: '2026-10-09', subject: 'fix(sync): the import card', blobSha256: sha256(HEAD_BODY) }];
const truncLive = classifyFile({
  path: 'privacy.html', url: URL_PRIV, status: 200, body: HEAD_BODY,
  history: BOUNDARY, scanned: 1, truncatedAt: 'ddddddddddddddd1',
});
ok('truncated: a match on the shallow boundary is STILL LIVE', truncLive.verdict === 'LIVE', truncLive.verdict);
ok('truncated: and it still reports 0 behind', truncLive.behind === 0);
ok('truncated: it does NOT name the boundary as the commit being served',
  !/serving ddddddd/.test(String(truncLive.detail)), truncLive.detail);
ok('truncated: it says the history stops there and names what it cannot say',
  /stops at ddddddd/.test(String(truncLive.detail)) && /cannot be named/.test(String(truncLive.detail)),
  truncLive.detail);
ok('truncated: it still says the bytes are current', /current bytes of privacy\.html/.test(String(truncLive.detail)));
ok('truncated: the file carries the flag for a reader that reads the object, not the string',
  truncLive.truncated === true);

// 14a. the SAME history with no boundary reported must keep naming its commit — otherwise the
//      fix would have replaced one false statement with a vaguer one on every file, including
//      `index.html`, whose history sits above the boundary and whose commit name is the single
//      most-read figure this script prints.
const untruncLive = classifyFile({
  path: 'privacy.html', url: URL_PRIV, status: 200, body: HEAD_BODY,
  history: BOUNDARY, scanned: 1, truncatedAt: null,
});
ok('truncated: with no boundary, LIVE names its commit exactly as before',
  untruncLive.verdict === 'LIVE' && /serving ddddddd \(2026-10-09\)/.test(String(untruncLive.detail)),
  untruncLive.detail);
ok('truncated: and carries no truncation flag', untruncLive.truncated === undefined);
ok('truncated: a boundary that is not the matched commit changes nothing',
  /serving aaaaaaa \(2026-10-07\)/.test(String(file({ truncatedAt: 'ddddddddddddddd1' }).detail)),
  file({ truncatedAt: 'ddddddddddddddd1' }).detail);

// 14b. BEHIND through the same door. A match on the boundary means the served bytes are no NEWER
//      than that commit; they may be older, because the commits before it are not in the clone.
//      The unshipped count is still exact — every later change is inside the window — so the
//      count stays and only the "serving <sha>" claim is bounded.
const truncBehind = classifyFile({
  path: 'index.html', url: URL_INDEX, status: 200, body: PREV_BODY,
  history: HISTORY, scanned: HISTORY.length, truncatedAt: 'bbbbbbbbbbbbbbbb',
});
ok('truncated: a BEHIND match on the boundary is still BEHIND', truncBehind.verdict === 'BEHIND');
ok('truncated: BEHIND bounds the claim instead of asserting the commit',
  /no newer than bbbbbbb/.test(String(truncBehind.detail)) && !/serving bbbbbbb \(/.test(String(truncBehind.detail)),
  truncBehind.detail);
ok('truncated: BEHIND still counts the unshipped changes exactly',
  truncBehind.behind === 1 && /1 later change to index\.html is unshipped/.test(String(truncBehind.detail)),
  truncBehind.detail);

// 14c. and the whole-deploy verdict is unaffected, which is the point of keeping it LIVE — a
//      shallow clone is the NORMAL shape here, so a run in one must still exit 0.
const truncDeploy = classifyDeploy([file(), truncLive], { ok: true, detail: 'ok' }, FETCH_OK);
ok('truncated: a run in a shallow clone still reaches LIVE and exits 0',
  truncDeploy.verdict === 'LIVE' && truncDeploy.exitCode === 0,
  `${truncDeploy.verdict} exit ${truncDeploy.exitCode}`);
ok('truncated: and the rendered report marks the truncated file [ok], not FAIL',
  /\[ok\] privacy\.html — serving the current bytes/.test(render(truncDeploy)), render(truncDeploy));

// 15. the sixth script, and the first nightly read of the bytes real users execute.
//     `pdf.worker.min.js` is 65% of the executable weight this site serves and the only part of
//     it with no integrity mechanism at all — SRI cannot cover a worker, the gate's CSP walk
//     cannot see a string assigned to `GlobalWorkerOptions.workerSrc`, and the CSP declares no
//     `worker-src` so `default-src 'self'` grades the ORIGIN and not the content. tests/smoke.mjs
//     §62 closed the repo half on 2026-11-17 and said in as many words that it never fetches
//     badgebudget.com; this is the live half, and it is the code that parses the one input this
//     app takes from outside itself.
ok('worker: it is read as bytes and never decoded', BYTE_ONLY.has('pdf.worker.min.js'));
ok('worker: and it is the ONLY byte-only path — the HTML files are still graded as text',
  BYTE_ONLY.size === 1, [...BYTE_ONLY].join(', '));

const URL_WORKER = 'https://badgebudget.com/pdf.worker.min.js';
/* Megabyte-shaped, and deliberately NOT valid-UTF8-clean: see 15b. */
const WORKER_BYTES = Buffer.concat([Buffer.from('/* pdf.js 3.11.174 */'), Buffer.alloc(1_000_000, 0x61), Buffer.from([0xff, 0xfe])]);
const WORKER_HISTORY = [{ sha: 'eeeeeeeeeeeeeee1', date: '2026-10-11', subject: 'chore: vendor pdf.js 3.11.174', blobSha256: sha256(WORKER_BYTES) }];
const worker = (over = {}) => classifyFile({
  path: 'pdf.worker.min.js', url: URL_WORKER, status: 200, bytes: WORKER_BYTES,
  history: WORKER_HISTORY, scanned: 1, ...over,
});

const wLive = worker();
ok('worker: bytes matching the committed blob are LIVE', wLive.verdict === 'LIVE', wLive.detail);
ok('worker: and 0 behind', wLive.behind === 0);

/* 15a. one byte in a megabyte. The realistic breaks §62 names are all of this shape — a
   hand-copy out of pdfjs-dist's `legacy/build/` to chase an old-browser bug, a pin bumped from a
   different channel than the file, a partial upload — and none of them touch the two substrings
   the gate reads, so the hash is the only thing that can speak. */
const tampered = Buffer.from(WORKER_BYTES); tampered[500_000] ^= 0x01;
const wTamper = worker({ bytes: tampered });
ok('worker: flipping ONE byte in a megabyte is no longer placeable', wTamper.verdict === 'UNKNOWN_BUILD', wTamper.verdict);
ok('worker: and that does NOT exit 0', classifyDeploy([wTamper], null, FETCH_OK).exitCode === 2);
ok('worker: the unplaceable detail reports BYTES, not characters — they differ by 31 on the real file',
  /1,000,023 bytes/.test(String(wTamper.detail)), wTamper.detail);

/* 15b. the load-bearing one, and the defect it encodes. Until 2026-11-18 every file was hashed
   from `await res.text()`, so the comparison was never of the served bytes — it was of a
   re-encoding of a decode of them. For anything that is not valid UTF-8 that round trip is
   LOSSY, and the re-encode can only ever miss a blob it should have matched: a permanent false
   UNKNOWN_BUILD on a file that is in fact live. These two bytes are what makes this fixture
   decode-unstable, and the assertion is that the bytes won. */
ok('worker: the fixture really is decode-unstable, or the next assertion proves nothing',
  sha256(Buffer.from(WORKER_BYTES.toString('utf8'), 'utf8')) !== sha256(WORKER_BYTES));
ok('worker: the hash is of the BYTES, not of a re-encoded decode of them',
  worker().liveSha === sha256(WORKER_BYTES));
ok('bytes: when both are supplied the bytes win, for every path and not just the worker',
  classifyFile({ path: 'index.html', url: URL_INDEX, status: 200, bytes: WORKER_BYTES, body: HEAD_BODY, history: WORKER_HISTORY, scanned: 1 }).liveSha
  === sha256(WORKER_BYTES));
ok('bytes: a string-only caller still hashes the string, so every pure caller is unchanged',
  file().liveSha === sha256(HEAD_BODY));
ok('bytes: and a string-only caller still reports its size in characters',
  /400,114 characters/.test(String(file({ body: appBody('NOT-IN-HISTORY') }).detail)),
  file({ body: appBody('NOT-IN-HISTORY') }).detail);

/* 15c. the worker is graded like privacy.html and ops.html, not like index.html: "200 and not
   empty", then the hash. Holding a megabyte of minified JS to a 50,000-character floor would
   pass by accident, and to a 5-SRI count would fail every single run. */
const wEmpty = worker({ bytes: Buffer.alloc(0) });
ok('worker: an EMPTY 200 is NOT_THE_APP, not an unplaceable build', wEmpty.verdict === 'NOT_THE_APP', wEmpty.detail);
/* The realistic 404 carries a 404 page, not the file: a 404 whose body still hashed to the
   committed blob would be reported LIVE, because this file grades the hash before the shape and
   a byte-exact match subsumes every shape check there is. */
ok('worker: a size on its shape object is labelled bytes and never chars',
  wEmpty.shape.bytes === 0 && wEmpty.shape.chars === undefined, JSON.stringify(wEmpty.shape));
ok('bytes: and a text file keeps reporting chars on the same object',
  privEmpty.shape.chars === 0 && privEmpty.shape.bytes === undefined, JSON.stringify(privEmpty.shape));
ok('worker: a 404 is NOT_THE_APP — the shape of it dropping out of the publish set',
  worker({ status: 404, bytes: Buffer.from('<!DOCTYPE html><title>404</title>') }).verdict === 'NOT_THE_APP');
ok('worker: a failed fetch is UNREACHABLE and establishes nothing',
  worker({ bytes: undefined, fetchError: 'socket hang up' }).verdict === 'UNREACHABLE');
ok('worker: github.io is refused for it too, even when the bytes match',
  worker({ url: 'https://patrick222-dotcom.github.io/705-v1/pdf.worker.min.js' }).verdict === 'NOT_THE_APP');

/* 15d. the path this file will ACTUALLY take every night. The worker's last real change is
   2026-10-11, below the shallow boundary these containers clone at, so its walk returns one
   entry — the boundary, carrying the tip's blob — exactly like privacy.html and ops.html. The
   verdict must still be LIVE and the attribution must still refuse to name that commit. */
const wTrunc = worker({ truncatedAt: 'eeeeeeeeeeeeeee1' });
ok('worker: a match on the shallow boundary is still LIVE', wTrunc.verdict === 'LIVE', wTrunc.verdict);
ok('worker: and it does not name the boundary as the commit that last changed it',
  !/serving eeeeeee \(/.test(String(wTrunc.detail)) && /cannot be named/.test(String(wTrunc.detail)),
  wTrunc.detail);

/* 15e. and it has to be able to FAIL the run, or adding it was decoration. A stale worker beside
   three current HTML files is the live shape of a pin bumped in index.html with the file left
   behind — which kills the paystub reader outright, because pdf.js compares the two versions
   itself and throws. */
const wBehindHistory = [
  { sha: 'eeeeeeeeeeeeeee2', date: '2026-11-18', subject: 'chore: bump pdf.js', blobSha256: sha256('newer worker') },
  ...WORKER_HISTORY,
];
const wBehind = worker({ history: wBehindHistory, scanned: 2 });
ok('worker: older bytes with a newer blob in history are BEHIND', wBehind.verdict === 'BEHIND', wBehind.detail);
const wDeploy = classifyDeploy([live, priv, wBehind], { ok: true, detail: 'ok' }, FETCH_OK);
ok('worker: a stale worker beside three live HTML files makes the whole deploy BEHIND',
  wDeploy.verdict === 'BEHIND' && wDeploy.exitCode === 1, `${wDeploy.verdict} exit ${wDeploy.exitCode}`);
ok('worker: and the rendered report names it', /\[FAIL\] pdf\.worker\.min\.js/.test(render(wDeploy)), render(wDeploy));

console.log(`\n==== deploy_watch tests: ${pass} passed / ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
