#!/usr/bin/env node
/* Is what is MERGED actually LIVE?
 *
 *   node scripts/deploy_watch.mjs              # human-readable verdict
 *   node scripts/deploy_watch.mjs --json       # one JSON object, for the groom to paste
 *   node scripts/deploy_watch.mjs --limit 60   # how far back to walk when identifying the live build
 *
 * Why this exists, and it is not hypothetical. On 2026-10-06 PR #150 squash-merged green and
 * Pages run 168 went to `status:"waiting"` and stopped. `concurrency: group:"pages"` then held
 * every later run behind it, so runs 169-173 cancelled and 174 queued with no jobs. As of this
 * file being written, SEVEN merged, green commits are unshipped and badgebudget.com has served
 * the bytes of commit 41d2549 since 2026-10-05. Nothing in this repo noticed: the merges were
 * green, the Actions tab looked busy, and the only thing that caught it was a human remembering
 * to curl the live site for a string they happened to know was new.
 *
 * That is Invariant 9's `Detect` line word for word — "deploys stop while pushes keep
 * succeeding, so nothing fails loudly" — and Invariant 8's too. Three nightlies in a row have
 * now hand-run the same check, which is the same bar that produced silence_watch.mjs.
 *
 * What makes it automatable is that `deploy.yml` copies the publish set VERBATIM (`cp index.html
 * _site/`), so the served file is byte-for-byte a git blob. A sha256 match is therefore a
 * complete answer and needs no marker: the old ritual (grep the live body for a string unique to
 * tonight's change) only works when you know what changed, cannot speak at all for a night that
 * shipped no new string, and silently "passes" against the ~162-byte github.io redirect body.
 * Hashing compares everything and can identify WHICH commit is live, not just that it is wrong.
 *
 * Scope: the three HTML files of Invariant 8's publish set. `pdf.worker.min.js` is a megabyte
 * and has never changed; `CNAME` is checked for presence only, because it is the one whose
 * absence is a total outage rather than a stale page.
 *
 * It fetches the deploy ref itself before judging anything against it, and says so in the report.
 * It did not always: see `applyRefFreshness` for the 2026-10-11 run that printed `LIVE` while
 * badgebudget.com was serving the pre-merge commit, because the local clone was behind origin.
 *
 * Needs network, so like tests/equality.mjs and silence_watch.mjs's live probes it is NOT part
 * of the CI gate. Its pure logic is, via scripts/test_deploy_watch.mjs.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/* The github.io guard lives in silence_watch.mjs and is imported rather than copied. Two copies
   of that rule is exactly how one of them gets relaxed and nobody notices — the same reasoning
   the comment above `eventRow` in index.html gives for its two senders sharing a row shape. */
import { urlIsGradeable, siteVerdict } from './silence_watch.mjs';

const SITE_ORIGIN = process.env.DEPLOY_WATCH_ORIGIN || 'https://badgebudget.com';
const DEPLOY_REF = process.env.DEPLOY_WATCH_REF || 'origin/claude/migrate-to-github-deploy-3F5RD';
const DEFAULT_LIMIT = 40;

/* The HTML third of the publish set (Invariant 8). `index.html` additionally gets the full
   silence_watch shape guard on a mismatch, because it is the only one with a known floor and a
   known SRI count; the other two are graded on "200 and not empty" and then on the hash. */
export const WATCHED = ['index.html', 'privacy.html', 'ops.html'];

/* ---------------------------------------------------------------- pure logic (unit-tested) */

export function sha256(text) {
  return createHash('sha256').update(typeof text === 'string' ? Buffer.from(text, 'utf8') : text).digest('hex');
}

/* Walk newest-first and return where the served bytes actually came from. `history` entries are
   { sha, date, subject, blobSha256 } for the commits that TOUCHED this path, head first. */
export function matchCommit(liveSha, history) {
  if (!liveSha || !Array.isArray(history)) return null;
  for (let i = 0; i < history.length; i++) {
    if (history[i] && history[i].blobSha256 === liveSha) return { behind: i, commit: history[i] };
  }
  return null;
}

/* One file, one verdict:
 *   LIVE          — the served bytes hash to the head commit's blob. Proven, not inferred.
 *   BEHIND        — they hash to an OLDER commit's blob. Says which one and how far back.
 *   NOT_THE_APP   — not a 200, or a body that fails the shape guard (the redirect stub, a 404).
 *   UNKNOWN_BUILD — a plausible body that matches no commit in the scanned window. NOT green:
 *                   an unplaceable build is a check that could not be established, same as
 *                   silence_watch's UNKNOWN. A shallow clone does this, and so does a hand-edit
 *                   deployed out of band — the two need a human to tell apart.
 *   UNREACHABLE   — the fetch itself failed.
 */
export function classifyFile({ path, url, status, body, fetchError, history, scanned }) {
  const head = Array.isArray(history) && history.length ? history[0] : null;

  if (fetchError) {
    return { path, verdict: 'UNREACHABLE', detail: `fetch failed: ${fetchError}`, liveSha: null, head };
  }

  const gradeable = urlIsGradeable(url);
  if (!gradeable.ok) {
    return { path, verdict: 'NOT_THE_APP', detail: gradeable.detail, liveSha: null, head };
  }

  const liveSha = typeof body === 'string' ? sha256(body) : null;

  /* Hash first, shape second. A match subsumes every shape check there is — a 162-byte stub
     cannot hash to a 468KB blob — so the floors only ever have to explain a mismatch. */
  const hit = matchCommit(liveSha, history);
  if (hit && hit.behind === 0) {
    return { path, verdict: 'LIVE', detail: `serving ${head.sha.slice(0, 7)} (${head.date})`, liveSha, head, behind: 0 };
  }

  if (status !== 200) {
    return { path, verdict: 'NOT_THE_APP', detail: `HTTP ${status}`, liveSha, head };
  }
  const shape = path === 'index.html'
    ? siteVerdict({ url, status, body })
    : { ok: typeof body === 'string' && body.length > 0, checks: [], chars: (body || '').length, sri: 0 };
  if (!shape.ok) {
    const why = (shape.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('; ')
      || 'empty body';
    return { path, verdict: 'NOT_THE_APP', detail: why, liveSha, head, shape };
  }

  if (hit) {
    const c = hit.commit;
    /* Name the subject against the sha it belongs to. An earlier draft printed the LIVE
       commit's subject immediately after the HEAD commit's sha, which reads as though the
       newest change were already out — the confident-but-false shape this repo keeps paying
       for. The two shas are labelled separately now. */
    return {
      path, verdict: 'BEHIND', liveSha, head, behind: hit.behind,
      detail: `serving ${c.sha.slice(0, 7)} (${c.date}) "${String(c.subject).slice(0, 60)}" — `
        + `${hit.behind} later change${hit.behind === 1 ? '' : 's'} to ${path} `
        + `${hit.behind === 1 ? 'is' : 'are'} unshipped, newest ${head.sha.slice(0, 7)}`,
      liveCommit: c,
    };
  }

  return {
    path, verdict: 'UNKNOWN_BUILD', liveSha, head,
    detail: `body is plausible (${(body || '').length.toLocaleString('en-US')} characters) but matches no commit `
      + `in the last ${scanned ?? 0} that touched ${path} — cannot say which build this is`,
  };
}

/* `origin/claude/migrate-to-github-deploy-3F5RD` → the remote to fetch and the branch on it.
   A ref with no `/` is a local ref: there is no remote to refresh it from, which is a fact about
   what can be PROVEN and not an error, so it gets its own reason rather than being reported as a
   network failure. */
export function parseRef(ref) {
  const s = String(ref || '');
  const slash = s.indexOf('/');
  if (slash < 1 || slash === s.length - 1) return { remote: null, branch: null, local: true };
  return { remote: s.slice(0, slash), branch: s.slice(slash + 1), local: false };
}

/* The whole reason this exists: on 2026-10-11 the watch printed `LIVE … serving 81c1954`
 * twenty-four seconds after a merge, naming the PRE-merge commit. It was telling the truth about
 * the bytes and the wrong thing about the question — the served `index.html` really did hash to a
 * blob it knew, but the local clone had not fetched the new head, so `history[0]` was not the tip
 * of the deploy branch at all.
 *
 * That is worse than the ritual it replaced. A `curl | grep <marker>` against stale bytes returns
 * 0 and looks like a failure; this returns the one word the operator is waiting for, and
 * CLAUDE.md's four-night Pages-stall lesson is *treat every merge as unshipped until the watch
 * says LIVE*. A false LIVE is exactly the all-clear that lesson exists to prevent.
 *
 * So LIVE carries a precondition, not just a hash match: the ref it was measured against has to
 * BE the tip. When the fetch could not establish that, the verdict degrades to UNKNOWN_BUILD —
 * which this file already treats as not-green, for the same reason silence_watch's UNKNOWN is
 * not-green: a check that could not be established is not a check that passed. Deliberately a
 * verdict change and not a printed warning; the verdict word is the part that gets read.
 *
 * Only LIVE is affected. BEHIND, NOT_THE_APP and UNREACHABLE are already true under a stale ref —
 * bytes that match an older blob are stale whether or not a newer commit exists — and a stale ref
 * can only make BEHIND's unshipped count too LOW, never invent one. */
export function applyRefFreshness(files, fetched) {
  const list = Array.isArray(files) ? files : [];
  /* Normalized up front so every read below is null-safe. Not defensive habit: a version that
     read `fetched.local` directly turned a deliberate break into a THROWN suite rather than a
     failed assertion, and a break that crashes the runner negative-tests nothing. */
  const f = fetched || {};
  if (f.ok !== false) return list;
  const why = f.local
    ? `the deploy ref is local (${f.ref || 'no remote'}), so it cannot be shown to be the tip`
    : `the deploy ref could not be refreshed (${f.error || 'fetch failed'})`;
  return list.map((f) => {
    if (!f || f.verdict !== 'LIVE') return f;
    const head = f.head ? `${String(f.head.sha).slice(0, 7)} (${f.head.date})` : 'the local head';
    return {
      ...f,
      verdict: 'UNKNOWN_BUILD',
      staleRef: true,
      detail: `served bytes match local head ${head}, but ${why} — a newer commit may already be `
        + `merged and unshipped, so this cannot be called live`,
    };
  });
}

/* Worst file wins. The ordering is the point: BEHIND outranks UNKNOWN_BUILD because "we know it
   is wrong" is more actionable than "we could not tell", and NOT_THE_APP outranks both. */
const RANK = { LIVE: 0, UNKNOWN_BUILD: 1, UNREACHABLE: 2, BEHIND: 3, NOT_THE_APP: 4 };
const EXIT = { LIVE: 0, UNKNOWN_BUILD: 2, UNREACHABLE: 2, BEHIND: 1, NOT_THE_APP: 1 };

export function classifyDeploy(files, cname, fetched) {
  /* The freshness guard runs HERE rather than in the caller so it cannot be forgotten by one.
     It is idempotent — after one pass no file is LIVE, so a second application is a no-op. */
  const list = applyRefFreshness(Array.isArray(files) ? files.slice() : [], fetched);
  if (!list.length) {
    return { verdict: 'UNKNOWN_BUILD', exitCode: 2, files: [], cname, fetched, reason: 'no files were checked' };
  }
  let worst = list[0];
  for (const f of list) if (RANK[f.verdict] > RANK[worst.verdict]) worst = f;

  /* A missing CNAME is Invariant 8's loudest failure (the site leaves badgebudget.com entirely),
     but it can only ever make the verdict worse, never better — so it is folded in here rather
     than being allowed to turn a BEHIND into something milder. */
  let verdict = worst.verdict;
  let reason = `${worst.path}: ${worst.detail}`;
  if (cname && cname.ok === false && RANK.NOT_THE_APP > RANK[verdict]) {
    verdict = 'NOT_THE_APP';
    reason = `CNAME: ${cname.detail}`;
  }

  const behind = list.filter((f) => f.verdict === 'BEHIND');
  if (verdict === 'BEHIND' && behind.length > 1) {
    reason += ` (and ${behind.length - 1} other published file${behind.length === 2 ? '' : 's'} behind too)`;
  }
  return { verdict, exitCode: EXIT[verdict], files: list, cname, fetched, reason };
}

export function render(r) {
  const lines = [`deploy-watch: ${r.verdict}`, `  ${r.reason}`];
  /* Three marks, not two: an unplaceable or unreachable file is neither proven live nor proven
     wrong, and flattening it to FAIL would overstate what the check established. */
  const MARK = { LIVE: 'ok', BEHIND: 'FAIL', NOT_THE_APP: 'FAIL', UNKNOWN_BUILD: '??', UNREACHABLE: '??' };
  for (const f of r.files || []) lines.push(`  [${MARK[f.verdict] || '??'}] ${f.path} — ${f.detail}`);
  if (r.cname) lines.push(`  [${r.cname.ok ? 'ok' : 'FAIL'}] CNAME — ${r.cname.detail}`);
  /* A failed fetch is `??`, not FAIL: nothing about the deploy was proven wrong, the question
     simply could not be answered. The line is printed on success too, because "which ref was
     this measured against, and was it current" is the one thing the 2026-10-11 false LIVE
     needed someone to know. */
  const fx = r.fetched || null;
  if (fx) {
    lines.push(fx.ok
      ? `  [ok] deploy ref — fetched ${fx.ref} before judging`
      : `  [??] deploy ref — NOT refreshed: ${fx.local ? 'local ref, no remote to fetch' : fx.error}`);
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------------------- live probes */

async function probeFile(origin, path) {
  const url = `${origin}/${path}`;
  try {
    const res = await fetch(`${url}?cb=${Date.now()}`);
    return { url, status: res.status, body: await res.text() };
  } catch (e) {
    return { url, fetchError: String(e.message || e) };
  }
}

async function probeCname(origin) {
  try {
    const res = await fetch(`${origin}/CNAME?cb=${Date.now()}`);
    const body = (await res.text()).trim();
    const want = new URL(origin).hostname;
    if (res.status !== 200) return { ok: false, detail: `HTTP ${res.status} — Pages reads the custom domain from this file` };
    return { ok: body === want, detail: res.status === 200 ? `serves "${body}"${body === want ? '' : ` (expected "${want}")`}` : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, detail: String(e.message || e) };
  }
}

/* Refresh the deploy ref before anything is judged against it. Invariant 10's rule ("fetch before
   touching the deploy branch", fresh checkouts seen 14 commits behind) applied to the read side:
   this script's whole answer is "are the served bytes the tip", and it cannot know the tip from a
   clone it has not refreshed. Cheap — one ref, and the script already needs network. */
function gitFetchRef(ref) {
  const { remote, branch, local } = parseRef(ref);
  if (local) return { ok: false, local: true, ref };
  try {
    execFileSync('git', ['fetch', remote, branch], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, ref };
  } catch (e) {
    return { ok: false, local: false, ref, error: String(e.stderr || e.message || e).trim().split('\n').pop() };
  }
}

/* Only the commits that actually touched this path, head first — on a 5,800-line single-file app
   that is most of them for index.html and a handful for the other two, which is why the walk is
   per-path rather than over the branch log. */
function gitHistory(path, ref, limit) {
  let log;
  try {
    log = execFileSync('git', ['log', `-n${limit}`, '--format=%H%x09%cI%x09%s', ref, '--', path], { encoding: 'utf8' });
  } catch (e) {
    return { history: [], error: String(e.message || e).split('\n')[0] };
  }
  const history = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [sha, date, ...rest] = line.split('\t');
    let blob;
    try {
      blob = execFileSync('git', ['show', `${sha}:${path}`], { maxBuffer: 1 << 28 });
    } catch { continue; }
    history.push({ sha, date: date.slice(0, 10), subject: rest.join('\t'), blobSha256: sha256(blob) });
  }
  return { history, error: null };
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const li = argv.indexOf('--limit');
  const limit = li !== -1 && argv[li + 1] ? Number(argv[li + 1]) : DEFAULT_LIMIT;

  /* Once, before the per-file loop — every file is placed against the same ref, so refreshing it
     per path would be three fetches to answer one question. */
  const fetched = gitFetchRef(DEPLOY_REF);

  const files = [];
  for (const path of WATCHED) {
    const probe = await probeFile(SITE_ORIGIN, path);
    const { history } = gitHistory(path, DEPLOY_REF, limit);
    files.push(classifyFile({ path, ...probe, history, scanned: history.length }));
  }
  const cname = await probeCname(SITE_ORIGIN);

  const result = { ...classifyDeploy(files, cname, fetched), origin: SITE_ORIGIN, ref: DEPLOY_REF, checkedAt: new Date().toISOString() };
  console.log(asJson ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
