#!/usr/bin/env node
// Claude Code SessionStart hook: puts the operating committee's 3 threads in front of every new
// session (docs/leadership.md → Capturing off-plan work, net 3). Stdout becomes session context.
//
// Pat starts fresh sessions on new ideas; that is expected. What this prevents is the work
// vanishing from the plan — the MCP gateway sat for weeks because nothing connected the sessions
// that touched it to anything Pat reads. Never blocks: a missing now.md prints nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let now;
try { now = readFileSync(join(ROOT, 'docs/cos/now.md'), 'utf8'); } catch { process.exit(0); }

const threads = [...now.matchAll(/^### (T\d+) `([^`]+)` — (.+)$/gm)].map((m) => `${m[1]} \`${m[2]}\` — ${m[3]}`);
if (!threads.length) process.exit(0);

process.stdout.write(`Operating committee (docs/leadership.md). The ${threads.length} live threads:
${threads.map((t) => `  - ${t}`).join('\n')}
If this session's work belongs to one, end each commit message with a \`Thread: <id>\` trailer.
If it belongs to none, that is fine — before finishing, add one line to docs/cos/inbox.md under
"## Open" (format is in that file) so the chief of staff can bring it into the plan.
`);
