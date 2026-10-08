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
import { sha256, matchCommit, classifyFile, classifyDeploy, render, WATCHED } from './deploy_watch.mjs';

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

// 1. the publish set this watches is the HTML third of Invariant 8's five files
ok('scope: watches index.html, privacy.html and ops.html',
  WATCHED.length === 3 && ['index.html', 'privacy.html', 'ops.html'].every((p) => WATCHED.includes(p)),
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

console.log(`\n==== deploy_watch tests: ${pass} passed / ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
