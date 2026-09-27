#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash): runs before any `git push` an agent issues.
//
// Two checks, both fail-closed (exit 2 blocks the push and shows stderr to the agent):
//   1. Invariant 10 — the branch being pushed contains the tip of the deploy branch. A stale
//      checkout merges green while quietly reverting other people's commits; this was prose
//      the agent had to remember, and UNCHECKED in check_build.mjs.
//   2. The mechanical gate — scripts/check_build.mjs, the same one CI's `gate` job runs, so a
//      red push is caught here instead of costing a CI cycle.
//
// Anything that is not a `git push` passes through untouched. A branch deletion is let through:
// there is nothing on it to gate. This runs only in agent sessions — a human's terminal push
// is not seen by it, and CI stays the binding gate.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEPLOY = 'claude/migrate-to-github-deploy-3F5RD';

let input;
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
const cmd = input?.tool_input?.command ?? '';
if (!/(^|[;&|(\s])git\s+push\b/.test(cmd)) process.exit(0);
if (/\s(--delete|-d)\b/.test(cmd)) process.exit(0);

const run = (c) => execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const block = (msg) => { process.stderr.write(`pre-push gate: ${msg}\n`); process.exit(2); };

// 1. Invariant 10. Fetch first; a fetch failure blocks rather than checking a stale ref,
//    because checking against a stale ref is exactly the failure this exists to catch.
try { run(`git fetch -q origin ${DEPLOY}`); }
catch (e) { block(`could not fetch origin/${DEPLOY} to check Invariant 10 (${String(e.stderr || e.message).trim().split('\n')[0]}). Retry once the network is back.`); }
try { run(`git merge-base --is-ancestor origin/${DEPLOY} HEAD`); }
catch { block(`HEAD does not contain origin/${DEPLOY} (Invariant 10). Merge it in first: git merge origin/${DEPLOY}`); }

// 2. The mechanical gate. Its own output names the failing check and the fix.
try { run('node scripts/check_build.mjs'); }
catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').filter((l) => /✗|FAILED|run:/.test(l)).join('\n');
  block(`scripts/check_build.mjs failed:\n${out || e.message}`);
}
process.exit(0);
