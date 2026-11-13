#!/usr/bin/env node
/* Is production's ACCESS posture still what the invariants claim it is?
 *
 *   node scripts/access_watch.mjs            # human-readable verdict
 *   node scripts/access_watch.mjs --json     # one JSON object, for the groom to paste
 *
 * Why this exists, and it is the most specific "Detect: none" in CLAUDE.md.
 *
 * Invariant 13 says the iCal feed URL "lives only in `ical_subscriptions` (owner-only RLS, no
 * `anon` grants)". Three of its five clauses got a mechanical gate between 2026-10-26 and
 * 2026-10-29 and one more got a runtime redaction on 10-28. The RLS clause got nothing, and its
 * own `Verify` line says why it could not: *"`rls_audit.js` — **not in git**, so currently
 * unreproducible"*. So the clause that decides whether a bearer credential is readable by the
 * public anon key that ships inside `index.html` has been held, for its entire life, by a file
 * nobody can run. The same is true of two written-down claims next to it: `ops_admins` has "RLS
 * with **zero policies** by design", and "the `ops_*` functions must never appear in the
 * advisor's `anon`-executable list".
 *
 * A leak here is silent by construction — Invariant 13's own `Blast` line — so there is no
 * symptom to notice and nothing to grep. The only thing that can be read is the catalog.
 *
 * WHAT THIS ESTABLISHES, AND WHAT IT DOES NOT. It reads `pg_class`, `pg_policies` and `pg_proc`.
 * That is enough to settle *grants* outright (a privilege either is in the ACL or is not) and
 * enough to settle the SHAPE of a policy. It is NOT a probe: it never connects as `anon`, so a
 * policy that is owner-gated in shape and wrong in logic passes here. `scripts/ops_gate_probe.sql`
 * is the thing that exercises the gate, and this does not replace it — CLAUDE.md's warning that
 * "the SQL editor's default session is a superuser and both obvious probes lie" is about that
 * file and still applies. Read this as "nothing has been loosened", not "the gate works".
 *
 * Two asymmetries are load-bearing and are the reason this is not a grep:
 *
 *   (a) A NULL `relacl` on a table means DEFAULT privileges, which is owner-only — so a table
 *       with no ACL row is TIGHT. A NULL `proacl` on a FUNCTION means the opposite: Postgres
 *       grants `EXECUTE` to `PUBLIC` by default, and `anon` is in `PUBLIC`. So an `ops_*`
 *       function created without an explicit `revoke execute ... from public` is anon-callable
 *       the moment it exists, with nothing in the diff that looks wrong. Null is tight for one
 *       and loose for the other, which is exactly the kind of thing a human checking by eye gets
 *       backwards once.
 *   (b) A grant to `PUBLIC` reaches `anon` without naming it. Every rule below therefore asks
 *       for the role's privileges UNION `PUBLIC`'s, because `grant select on ical_subscriptions
 *       to public` is the edit that passes a search for the word "anon".
 *
 * A subject that is MISSING from the catalog is UNKNOWN, never TIGHT. A renamed table must not
 * turn its own rule into a pass by omission — the same rule `check_build.mjs`'s `[13]` check
 * takes when it fails on not being able to FIND `serializeState`.
 *
 * Needs network and `SUPABASE_ACCESS_TOKEN`, so like `silence_watch.mjs`'s live probes and
 * `deploy_watch.mjs` it is NOT part of the CI gate. Its pure logic is, via `tests/smoke.mjs` §59
 * — deliberately there rather than in a `scripts/test_access_watch.mjs` of its own, because this
 * repo already has two suites waiting fifteen nights on a one-line workflow edit no agent session
 * can make, and a third would be a third.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'mnnlgcxnvodjwlhhiphq';

/* ---------------------------------------------------------------- pure logic (unit-tested) */

/* Postgres ACL privilege letters. Only the ones that can appear on a table or a function are
   listed; an unknown letter is kept as itself rather than dropped, so a future server that adds
   one cannot silently shrink a privilege set into looking harmless. */
const PRIV_LETTERS = {
  r: 'SELECT', w: 'UPDATE', a: 'INSERT', d: 'DELETE', D: 'TRUNCATE',
  x: 'REFERENCES', t: 'TRIGGER', m: 'MAINTAIN', X: 'EXECUTE',
  U: 'USAGE', C: 'CREATE', T: 'TEMPORARY', c: 'CONNECT', s: 'SET', A: 'ALTER SYSTEM',
};

/* `anon=aDxtm/postgres` -> { grantee:'anon', privs:['INSERT','TRUNCATE',...] }.
   An empty grantee is PUBLIC, which is how Postgres writes `=r/postgres`. A trailing `*` is the
   grant option and is not itself a privilege. */
export function parseAclItem(item) {
  const s = String(item || '').trim();
  if (!s) return null;
  const slash = s.lastIndexOf('/');
  const lhs = slash === -1 ? s : s.slice(0, slash);
  const eq = lhs.indexOf('=');
  if (eq === -1) return null;
  const rawGrantee = lhs.slice(0, eq).replace(/^"|"$/g, '');
  const letters = lhs.slice(eq + 1);
  const privs = [];
  for (const ch of letters) {
    if (ch === '*') continue;
    privs.push(PRIV_LETTERS[ch] || `UNKNOWN(${ch})`);
  }
  return { grantee: rawGrantee === '' ? 'PUBLIC' : rawGrantee, privs };
}

/* The ACL as the probe hands it over: an array, a ' | '-joined string, or null/undefined for
   "no ACL row at all". Returns [] for the last case — the CALLER decides what null means, because
   it means owner-only for a table and PUBLIC EXECUTE for a function (asymmetry (a) above). */
export function parseAcl(acl) {
  if (acl === null || acl === undefined || acl === '') return [];
  const items = Array.isArray(acl) ? acl : String(acl).split('|');
  return items.map(parseAclItem).filter(Boolean);
}

/* Everything `role` can do, counting what it inherits from PUBLIC (asymmetry (b) above). */
export function effectivePrivs(acl, role) {
  const out = new Set();
  for (const e of parseAcl(acl)) {
    if (e.grantee === role || e.grantee === 'PUBLIC') for (const p of e.privs) out.add(p);
  }
  return out;
}

/* Is this policy expression gated on the row's owner? Production writes it as
   `(( SELECT auth.uid() AS uid) = user_id)`, and older ones as `(auth.uid() = user_id)`.
   Both halves are required: `auth.uid() is not null` names the function and gates nothing, and a
   bare `user_id = user_id` is a tautology. A `true` qual fails for want of auth.uid(). */
export function exprIsOwnerGated(expr) {
  if (expr === null || expr === undefined) return false;
  const s = String(expr);
  return /auth\s*\.\s*uid\s*\(\s*\)/i.test(s) && /\buser_id\b/.test(s);
}

/* A policy is owner-gated when EVERY expression it carries is. A policy with a `qual` that is
   owner-gated and a `with_check` of `true` would let a signed-in user write a row owned by
   somebody else, so an un-gated `with_check` is not excused by a gated `qual`. An INSERT policy
   legitimately has no `qual` at all, hence the null-skip rather than a null-fail. */
export function policyIsOwnerGated(p) {
  const parts = [p.qual, p.with_check ?? p.withCheck].filter((x) => x !== null && x !== undefined);
  if (!parts.length) return false;
  return parts.every(exprIsOwnerGated);
}

const WRITE_CMDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/* The four commands this table's policies must cover, each owner-gated. `ALL` counts for all
   four, which is how a single `for all` policy is written. */
function ownerOnlyTableRules(tableName, catalog, out) {
  const table = (catalog.tables || []).find((t) => t.name === tableName);
  if (!table) {
    out.push({ name: `${tableName}: exists (for its policies)`, unknown: true,
      detail: 'not in the catalog — a renamed table must not pass this rule by omission' });
    return;
  }
  out.push({ name: `${tableName}: RLS enabled`, ok: table.rlsEnabled === true,
    detail: table.rlsEnabled === true ? 'row security on' : 'ROW SECURITY IS OFF' });

  const policies = (catalog.policies || []).filter((p) => p.table === tableName);
  if (!policies.length) {
    out.push({ name: `${tableName}: owner-gated policies`, ok: false,
      detail: 'no policies at all — with RLS on nobody reads it, with RLS off everybody does' });
    return;
  }
  const bad = policies.filter((p) => !policyIsOwnerGated(p));
  const covered = new Set();
  for (const p of policies) {
    if (!policyIsOwnerGated(p)) continue;
    if (String(p.cmd).toUpperCase() === 'ALL') for (const c of WRITE_CMDS) covered.add(c);
    else covered.add(String(p.cmd).toUpperCase());
  }
  const missing = WRITE_CMDS.filter((c) => !covered.has(c));
  out.push({
    name: `${tableName}: every policy is auth.uid() = user_id`,
    ok: bad.length === 0,
    detail: bad.length === 0
      ? `${policies.length} policies, all owner-gated`
      : `NOT owner-gated: ${bad.map((p) => `${p.name} (${p.cmd})`).join(', ')}`,
  });
  out.push({
    name: `${tableName}: all four commands covered`,
    ok: missing.length === 0,
    detail: missing.length === 0 ? WRITE_CMDS.join('/') : `no owner-gated policy for ${missing.join(', ')}`,
  });
}

function noPrivRule(tableName, role, catalog, out, { only } = {}) {
  const table = (catalog.tables || []).find((t) => t.name === tableName);
  if (!table) {
    out.push({ name: `${tableName}: exists (for its grants)`, unknown: true,
      detail: 'not in the catalog — a renamed table must not pass this rule by omission' });
    return;
  }
  const privs = effectivePrivs(table.acl, role);
  const banned = only ? only.filter((p) => privs.has(p)) : [...privs];
  out.push({
    name: only
      ? `${tableName}: ${role} cannot ${only.join('/')}`
      : `${tableName}: ${role} holds no grant at all`,
    ok: banned.length === 0,
    detail: banned.length === 0
      ? (privs.size ? `holds ${[...privs].sort().join(',')}` : 'no grant')
      : `GRANTED ${banned.sort().join(',')}`,
  });
}

/* Every rule, in one place, so the render and the JSON agree with the exit code by construction. */
export function evaluate(catalog) {
  const out = [];

  /* Invariant 13: the feed URL is a bearer credential and lives only here. */
  ownerOnlyTableRules('ical_subscriptions', catalog, out);
  noPrivRule('ical_subscriptions', 'anon', catalog, out);

  /* Invariant 4's table: one jsonb blob per user, holding her whole pay history. `anon` DOES hold
     table privileges here (Supabase's default grants in `public`), so RLS is the only barrier and
     the shape of those four policies is the whole of the protection. */
  ownerOnlyTableRules('user_data', catalog, out);

  /* Analytics and feedback are insert-only by GRANT as well as by policy. The anon key is public
     — it is on line 831 of the file every visitor downloads — so a SELECT grant here would hand
     any reader every device trail and every feedback message, including the free text she typed.
     TRUNCATE is deliberately NOT in this ban list, and the detail line prints it so the gap is
     visible rather than hidden. `anon` does hold TRUNCATE here and on `user_data` (Supabase's
     default grants in `public`), and TRUNCATE is the one verb RLS does not cover — so the only
     thing between the public anon key and an emptied table is that PostgREST has no route to it.
     That is a real finding, filed in BACKLOG.md with its one-line revoke, but it is a posture
     NOBODY HAS DECIDED YET; a watch that is red on its first night for an unreachable privilege
     is a watch that gets ignored. Add the rule in the same commit that revokes it. */
  noPrivRule('events', 'anon', catalog, out, { only: ['SELECT', 'UPDATE', 'DELETE'] });
  noPrivRule('events', 'authenticated', catalog, out, { only: ['SELECT', 'UPDATE', 'DELETE'] });
  noPrivRule('feedback', 'anon', catalog, out, { only: ['SELECT', 'UPDATE', 'DELETE'] });
  noPrivRule('feedback', 'authenticated', catalog, out, { only: ['SELECT', 'UPDATE', 'DELETE'] });

  /* CLAUDE.md: "`ops_admins` has RLS with zero policies by design — don't 'fix' the advisor INFO
     by adding one." A policy added here is how the ops allow-list becomes readable. */
  const opsAdmins = (catalog.tables || []).find((t) => t.name === 'ops_admins');
  if (!opsAdmins) {
    out.push({ name: 'ops_admins: exists', unknown: true, detail: 'not in the catalog' });
  } else {
    const n = (catalog.policies || []).filter((p) => p.table === 'ops_admins').length;
    out.push({ name: 'ops_admins: still zero policies, by design', ok: n === 0,
      detail: n === 0 ? 'none' : `${n} policy/policies added` });
  }
  noPrivRule('ops_admins', 'anon', catalog, out);
  noPrivRule('ops_admins', 'authenticated', catalog, out);

  /* CLAUDE.md: "The `ops_*` functions must never appear in the advisor's `anon`-executable list."
     They are SECURITY DEFINER, so an anon EXECUTE grant is not a weakened layer — it is the gate
     removed. Asymmetry (a): a function with NO acl is PUBLIC EXECUTE, so absence is the failure. */
  const opsFns = (catalog.functions || []).filter((f) => /^ops_/.test(f.name) || f.name === 'is_ops_admin');
  if (!opsFns.length) {
    out.push({ name: 'ops_* functions: exist', unknown: true,
      detail: 'no ops_* or is_ops_admin function in the catalog — the console has no gate to check' });
  } else {
    const exposed = opsFns.filter((f) => f.acl === null || f.acl === undefined || f.acl === ''
      ? true
      : effectivePrivs(f.acl, 'anon').has('EXECUTE'));
    out.push({
      name: `ops_* functions: not executable by anon (${opsFns.length})`,
      ok: exposed.length === 0,
      detail: exposed.length === 0
        ? opsFns.map((f) => f.name).sort().join(', ')
        : `ANON CAN EXECUTE ${exposed.map((f) => f.name + (f.acl ? '' : ' (no ACL = PUBLIC EXECUTE)')).sort().join(', ')}`,
    });
    const notSecdef = opsFns.filter((f) => f.secdef === false);
    out.push({
      name: 'ops_* functions: still SECURITY DEFINER',
      ok: notSecdef.length === 0,
      detail: notSecdef.length === 0 ? `${opsFns.length}/${opsFns.length}` : `NOT definer: ${notSecdef.map((f) => f.name).join(', ')}`,
    });
  }

  return out;
}

/* LOOSE outranks UNKNOWN: a confirmed loosening is a thing to act on now, and saying "could not
   establish" over the top of it would bury the one line that matters. UNKNOWN is never green —
   same rule `deploy_watch`'s UNKNOWN_BUILD and `silence_watch`'s UNKNOWN encode. */
export function classify({ catalog, error }) {
  if (error) {
    return { verdict: 'UNREACHABLE', exitCode: 2, rules: [],
      reason: `could not read the catalog: ${error}` };
  }
  const rules = evaluate(catalog || {});
  const loose = rules.filter((r) => r.ok === false);
  const unknown = rules.filter((r) => r.unknown === true);
  if (loose.length) {
    return { verdict: 'LOOSE', exitCode: 1, rules,
      reason: `${loose.length} of ${rules.length} access rules are broken: ${loose.map((r) => r.name).join('; ')}` };
  }
  if (unknown.length) {
    return { verdict: 'UNKNOWN', exitCode: 2, rules,
      reason: `${unknown.length} of ${rules.length} access rules could not be established: ${unknown.map((r) => r.name).join('; ')}` };
  }
  return { verdict: 'TIGHT', exitCode: 0, rules,
    reason: `all ${rules.length} access rules hold — read from the catalog, not probed as anon` };
}

export function render(r) {
  const lines = [`access-watch: ${r.verdict}`, `  ${r.reason}`];
  for (const rule of r.rules || []) {
    const tag = rule.unknown ? '????' : rule.ok ? 'ok' : 'LOOSE';
    lines.push(`  [${tag}] ${rule.name} — ${rule.detail}`);
  }
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
  const json = await res.json();
  return Array.isArray(json) ? json : json?.result || [];
}

/* Read-only, three statements, no DDL and no probe row. `silence_watch` records why that matters:
   the harness once wrote 291 junk rows into production analytics, and this runs every night. */
async function readCatalog() {
  const tables = await sql(`
    select c.relname as name, c.relrowsecurity as rls_enabled,
           array_to_string(c.relacl, ' | ') as acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`);
  const policies = await sql(`
    select tablename as table, policyname as name, cmd, roles::text as roles, qual, with_check
    from pg_policies where schemaname = 'public'`);
  const functions = await sql(`
    select p.proname as name, array_to_string(p.proacl, ' | ') as acl, p.prosecdef as secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'`);
  return {
    tables: tables.map((t) => ({ name: t.name, rlsEnabled: t.rls_enabled === true, acl: t.acl ?? null })),
    policies: policies.map((p) => ({ table: p.table, name: p.name, cmd: p.cmd, roles: p.roles,
      qual: p.qual ?? null, with_check: p.with_check ?? null })),
    functions: functions.map((f) => ({ name: f.name, acl: f.acl ?? null, secdef: f.secdef === true })),
  };
}

async function main() {
  const asJson = process.argv.slice(2).includes('--json');
  let catalog = null, error = null;
  try { catalog = await readCatalog(); } catch (e) { error = String(e.message || e); }
  const result = { ...classify({ catalog, error }), checkedAt: new Date().toISOString(), project: PROJECT_REF };
  console.log(asJson ? JSON.stringify(result, null, 2) : render(result));
  process.exit(result.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
