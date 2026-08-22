#!/usr/bin/env node
/* Tests for the Phase-1 groom_seed wiring. Run: node scripts/test_groom_seed.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze, validateInsight, renderBlock, applyBlock, stripManagedBlock, sourceTag } from './groom_seed.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(ROOT, 'docs', 'reddit_seed.json'), 'utf8'));
const backlogRaw = readFileSync(join(ROOT, 'BACKLOG.md'), 'utf8');
const knownText = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8') + '\n' + stripManagedBlock(backlogRaw);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const byId = (arr, id) => arr.find(r => r.id === id);

// 1. schema: every real seed insight validates
const schemaErrs = seed.insights.flatMap(validateInsight);
ok('schema: all seed insights valid', schemaErrs.length === 0, schemaErrs.join('; '));

// 2. schema: validator catches a broken insight
const brokenErrs = validateInsight({ id: 'Bad_ID', signal: 'huge', source: 'twitter', keywords: [] }, 0);
ok('schema: validator rejects bad signal/source/id/keywords', brokenErrs.length >= 4, `${brokenErrs.length} errors`);

const results = analyze(seed, knownText);

// 3. determinism: same inputs -> identical results
ok('determinism: analyze is stable across runs',
  JSON.stringify(results) === JSON.stringify(analyze(seed, knownText)));

// 4. dedup: already-shipped areas are marked covered (not re-surfaced)
ok('dedup: nursegrid import marked covered (ics import shipped)', byId(results, 'nursegrid-schedule-reentry').status === 'covered');
ok('dedup: differential stacking marked covered (overtime×diff shipped)', byId(results, 'differential-stacking-confusion').status === 'covered');
ok('dedup: swap-partner-discovery marked covered (swap board shipped)', byId(results, 'swap-partner-discovery').status === 'covered');

// 5. genuine new gaps surface as candidates
ok('candidate: swap manager-approval bottleneck surfaces', byId(results, 'swap-manager-approval-bottleneck').status === 'candidate');
ok('candidate: a genuinely-new owner theme surfaces', byId(results, 'missed-break-auto-deduction-pay-loss').status === 'candidate');

// 5b. KNOWN DEFECT (see BACKLOG "groom dedupe erodes deferred themes"): a theme merely *narrated*
// in the Done log as deferred is counted as covered and silently drops out of the candidate set.
// Pinned here so the day someone fixes dedupe, this flips and they see why it mattered.
ok('known defect: deferred-but-unbuilt theme is wrongly marked covered',
  byId(results, 'self-schedule-fairness').status === 'covered',
  'self-schedule-fairness is NOT built — it matched Done-log prose about deferring it');

// 6. priority mapping from signal
ok('priority: loud -> P1', byId(results, 'take-home-vs-gross').priority === 'P1');
ok('priority: recurring -> P2', byId(results, 'self-schedule-fairness').priority === 'P2');
ok('priority: occasional -> P3', byId(results, 'pto-denials-blackouts').priority === 'P3');

// 7. every candidate carries provenance (source tag) in its rendered line
const candidates = results.filter(r => r.status === 'candidate');
const block = renderBlock(candidates);
ok('provenance: every candidate line is source-tagged', candidates.length > 0 && candidates.every(c => block.includes('source:' + sourceTag(c.source))));

// 7b. source tags: 'seed' keeps its legacy reddit- prefix; already-prefixed sources are not doubled
ok('sourceTag: seed -> reddit-seed', sourceTag('seed') === 'reddit-seed');
ok('sourceTag: reddit-owner not double-prefixed', sourceTag('reddit-owner') === 'reddit-owner');
ok('sourceTag: reddit-live not double-prefixed', sourceTag('reddit-live') === 'reddit-live');

// 7c. owner-gathered intake: reddit-owner is a valid source and its provenance survives to the block
ok('intake: reddit-owner passes schema validation',
  validateInsight({ id: 'x-y', theme: 't', category: 'tools', signal: 'recurring', paraphrase: 'p', mapped_feature: 'new', keywords: ['calendar sync'], confidence: 'high', source: 'reddit-owner' }, 0).length === 0);
const ownerCands = candidates.filter(c => c.source === 'reddit-owner');
ok('intake: owner-gathered insights reached the candidate set', ownerCands.length > 0, `${ownerCands.length} owner candidates`);
ok('intake: owner candidates cite what was observed',
  ownerCands.length > 0 && ownerCands.every(c => block.includes('observed: ' + c.observed)));

// 8. idempotent apply: applying twice yields identical output, block appears exactly once
const fakeBacklog = '# Backlog\n\n## Queue\n\n### P1\n- [ ] existing item\n\n## Done (log)\n- old\n';
const once = applyBlock(fakeBacklog, block);
const twice = applyBlock(once, block);
const count = s => (s.match(/GROOM_SEED:BEGIN/g) || []).length;
ok('apply: idempotent (second apply == first)', once === twice);
ok('apply: managed block present exactly once', count(twice) === 1, `count=${count(twice)}`);
ok('apply: hand-authored content preserved', twice.includes('existing item') && twice.includes('## Done (log)'));

// 9. cross-run idempotency: analyzing the KNOWN corpus with our own block already applied must not
// erode candidates (the managed block is stripped before dedup). Simulate a prior --apply.
const withBlock = applyBlock(stripManagedBlock(backlogRaw), block);
const knownAfterApply = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8') + '\n' + stripManagedBlock(withBlock);
const resultsAfter = analyze(seed, knownAfterApply);
ok('cross-run: candidate count stable after our block is in BACKLOG',
  resultsAfter.filter(r => r.status === 'candidate').length === candidates.length,
  `before=${candidates.length} after=${resultsAfter.filter(r => r.status === 'candidate').length}`);

console.log(`\n==== groom_seed tests: ${pass} passed / ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
