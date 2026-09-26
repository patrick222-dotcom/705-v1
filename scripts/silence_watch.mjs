#!/usr/bin/env node
/* Is the app silent because nobody came, or because telemetry is broken?
 *
 *   node scripts/silence_watch.mjs            # human-readable verdict
 *   node scripts/silence_watch.mjs --json     # one JSON object, for the groom to paste
 *   node scripts/silence_watch.mjs --stale-hours 24
 *
 * Why this exists. The groom found two consecutive days with zero `events` rows on 2026-09-23,
 * -09-25 and -09-26, and each time had to establish BY HAND that the site was up, that the bytes
 * served were the deployed ones, and that the insert policy was intact — before it could write
 * "no visitors" rather than "telemetry broken". Those two facts look identical from the database
 * side, and telling them apart is exactly the gap Invariant 4 is about: a 47-day sync outage ran
 * because nothing watched for a silence it was already producing. Three hand-runs of the same
 * check is the definition of something to automate.
 *
 * It REPORTS, it does not alarm. At four events a day any threshold would be noise, so the
 * threshold question (BACKLOG: "the threshold is a judgement call at this traffic level") is
 * deliberately left unanswered: a quiet day is reported as quiet-and-healthy, and only a silence
 * that comes WITH a failed health check is an error exit. That is the one combination a human
 * has to look at.
 *
 * Needs network (badgebudget.com + the Supabase Management API) and `SUPABASE_ACCESS_TOKEN`, so
 * like tests/equality.mjs it is NOT part of the CI gate. Its pure logic is, via
 * scripts/test_silence_watch.mjs.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'mnnlgcxnvodjwlhhiphq';
const SITE_URL = process.env.SILENCE_WATCH_URL || 'https://badgebudget.com/index.html';
const DEFAULT_STALE_HOURS = 48;

/* The deployed index.html is ~420KB. The retired github.io URL 301s to a ~162-byte empty body,
   so anything short means the check is pointed at the redirect and would "pass" against nothing
   — the exact mistake that let the old nightly "verify" every deploy it ever made without once
   seeing one. Keep this floor in step with tests/equality.mjs. */
const MIN_BODY_BYTES = 50000;
const EXPECTED_SRI = 5;

/* ---------------------------------------------------------------- pure logic (unit-tested) */

/* A host that 301s away can never fail a content check, so refuse to grade one at all rather
   than reporting a green that means nothing. */
export function urlIsGradeable(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { ok: false, detail: `not a URL: ${url}` }; }
  if (host.endsWith('github.io')) {
    return { ok: false, detail: `${host} 301s to an empty body — a content check against it can never fail` };
  }
  if (!/^https:/.test(url)) return { ok: false, detail: `not https: ${url}` };
  return { ok: true, detail: host };
}

/* Did we get the app, or something shaped like the app? Same two guards equality.mjs uses. */
export function siteVerdict({ url, status, body }) {
  const checks = [];
  const gradeable = urlIsGradeable(url);
  checks.push({ name: 'url is gradeable', ok: gradeable.ok, detail: gradeable.detail });

  checks.push({ name: 'HTTP 200', ok: status === 200, detail: `HTTP ${status}` });

  const bytes = typeof body === 'string' ? body.length : 0;
  checks.push({
    name: 'served the app, not a redirect stub',
    ok: bytes >= MIN_BODY_BYTES,
    detail: `${bytes.toLocaleString('en-US')} bytes (floor ${MIN_BODY_BYTES.toLocaleString('en-US')})`,
  });

  const sri = (typeof body === 'string' ? body.match(/integrity="sha384-/g) || [] : []).length;
  checks.push({
    name: `${EXPECTED_SRI} SRI-pinned scripts`,
    ok: sri === EXPECTED_SRI,
    detail: `${sri} found`,
  });

  return { ok: checks.every((c) => c.ok), checks, bytes, sri };
}

/* Hours between the newest event row and now. null when there is no row or no readable date.
   Postgres hands back `2026-09-26 00:37:41.5765+00` — a space instead of the T, and a bare
   two-digit offset that Date.parse rejects outright. Normalize both rather than making every
   caller remember, because the failure mode is a null age, which reads as "no events at all". */
export function hoursSince(latestIso, now) {
  if (!latestIso) return null;
  const t = Date.parse(latestIso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / 3_600_000;
}

/* The whole point: one of four verdicts, and it always says WHICH side it could establish.
 *   FRESH                — an event arrived inside the window. Nothing to look at.
 *   SILENT_BUT_HEALTHY   — nothing arrived, but the site is provably serving the deployed bytes
 *                          and the insert policy is intact. "No visitors", not "telemetry broken".
 *   SILENT_AND_UNHEALTHY — nothing arrived AND a health check failed. The one case for a human.
 *   UNKNOWN              — the telemetry side could not be read at all. Never report green here;
 *                          an unreadable check is not a passing check.
 */
export function classify({ latestEventAt, now, staleHours = DEFAULT_STALE_HOURS, site, insertPolicy, telemetryError }) {
  if (telemetryError) {
    return { verdict: 'UNKNOWN', exitCode: 2, ageHours: null, staleHours, site, insertPolicy,
      reason: `could not read events: ${telemetryError}` };
  }
  const ageHours = hoursSince(latestEventAt, now);
  if (ageHours !== null && ageHours < 0) {
    return { verdict: 'UNKNOWN', exitCode: 2, ageHours, staleHours, site, insertPolicy,
      reason: `newest event is ${Math.abs(ageHours).toFixed(1)}h in the future — clock or timezone is wrong` };
  }
  if (ageHours !== null && ageHours <= staleHours) {
    return { verdict: 'FRESH', exitCode: 0, ageHours, staleHours, site, insertPolicy,
      reason: `newest event is ${ageHours.toFixed(1)}h old (window ${staleHours}h)` };
  }

  const age = ageHours === null ? 'no events at all' : `${ageHours.toFixed(1)}h old (window ${staleHours}h)`;
  const healthy = site?.ok === true && insertPolicy?.ok === true;
  if (healthy) {
    return { verdict: 'SILENT_BUT_HEALTHY', exitCode: 0, ageHours, staleHours, site, insertPolicy,
      reason: `newest event is ${age}, but the site serves ${site.bytes.toLocaleString('en-US')} bytes with ${site.sri} SRI scripts and the events insert policy is intact — quiet, not broken` };
  }
  const broken = [
    ...(site?.checks || []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`),
    ...(insertPolicy?.ok === false ? [`events insert policy: ${insertPolicy.detail}`] : []),
  ];
  return { verdict: 'SILENT_AND_UNHEALTHY', exitCode: 1, ageHours, staleHours, site, insertPolicy,
    reason: `newest event is ${age} AND ${broken.length ? broken.join('; ') : 'health could not be established'}` };
}

export function render(r) {
  const lines = [
    `silence-watch: ${r.verdict}`,
    `  ${r.reason}`,
  ];
  for (const c of r.site?.checks || []) lines.push(`  [${c.ok ? 'ok' : 'FAIL'}] ${c.name} — ${c.detail}`);
  if (r.insertPolicy) lines.push(`  [${r.insertPolicy.ok ? 'ok' : 'FAIL'}] events insert policy — ${r.insertPolicy.detail}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------------------- live probes */

async function sql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function probeSite(url) {
  const bust = url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now();
  try {
    const res = await fetch(bust);
    return siteVerdict({ url, status: res.status, body: await res.text() });
  } catch (e) {
    return { ok: false, bytes: 0, sri: 0, checks: [{ name: 'reachable', ok: false, detail: String(e.message || e) }] };
  }
}

/* Read-only on purpose. Inserting a probe row would prove the path end to end, but the harness
   already wrote 291 junk rows into production analytics once (CLAUDE.md, 2026-09-16) and this
   script runs every night — so it reads the policy rather than exercising it. */
async function probeInsertPolicy() {
  try {
    const rows = await sql(
      `select policyname, roles::text as roles from pg_policies
       where schemaname='public' and tablename='events' and cmd='INSERT'`,
    );
    const list = Array.isArray(rows) ? rows : rows?.result || [];
    if (!list.length) return { ok: false, detail: 'no INSERT policy on public.events — the app cannot write telemetry' };
    return { ok: true, detail: list.map((p) => `${p.policyname} ${p.roles}`).join(', ') };
  } catch (e) {
    return { ok: false, detail: String(e.message || e) };
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const si = argv.indexOf('--stale-hours');
  const staleHours = si !== -1 && argv[si + 1] ? Number(argv[si + 1]) : DEFAULT_STALE_HOURS;

  let latestEventAt = null, telemetryError = null, totalRows = null;
  try {
    const rows = await sql('select max(created_at)::text as latest, count(*)::int as rows from public.events');
    const row = (Array.isArray(rows) ? rows : rows?.result || [])[0] || {};
    latestEventAt = row.latest ?? null;
    totalRows = row.rows ?? null;
  } catch (e) {
    telemetryError = String(e.message || e);
  }

  /* Only pay for the site probe when it can change the answer — a fresh event already settles it. */
  const needsHealth = telemetryError !== null || hoursSince(latestEventAt, new Date()) === null
    || hoursSince(latestEventAt, new Date()) > staleHours;
  const site = needsHealth ? await probeSite(SITE_URL) : null;
  const insertPolicy = needsHealth ? await probeInsertPolicy() : null;

  const result = { ...classify({ latestEventAt, now: new Date(), staleHours, site, insertPolicy, telemetryError }),
    latestEventAt, totalRows, url: SITE_URL, checkedAt: new Date().toISOString() };

  console.log(asJson ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
