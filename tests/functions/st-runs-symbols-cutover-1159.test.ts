/**
 * @topic #984 — ST Firestore Reorg (tasks #1159/#1019)
 *
 * Completed-cutover pin — #1159 repointed doc-level traffic to
 * st-runs / st-symbols; #1019 finished the job: every signal read moved to
 * st-signals and the writer's run-ids/signal-history legs were removed, so
 * the legacy `savant-trader/data/symbols` parent has ZERO deployed-code
 * consumers (it survives only as the frozen source for historical
 * backfill/verify scripts under functions/scripts/).
 *
 * These assertions pin the end state: a drift in either direction (a
 * doc-level read reverting to a legacy root, or a new subcollection leg
 * appearing in deployed code) is the class of regression a behavioral mock
 * can't see.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Legacy-bound identifiers that must never appear in deployed code. */
const LEGACY_CONSTS = /ST_SYMBOLS_COLLECTION|ST_RUN_IDS_SUBCOLLECTION|ST_SIGNAL_HISTORY_SUBCOLLECTION/;
const LEGACY_SUBCOL_LITERAL = /['"`](run-ids|signal-history)['"`]/;

describe('st-* cutover end state (#1159 doc-level, #1019 signal readers)', () => {
  it('auto-paper ingest reads jobs off st-runs, signals off st-signals', () => {
    const src = read('functions/src/paper-trading/passes/auto-paper-ingest-pass.ts');
    assert.match(src, /ST_RUNS_ROOT/, 'jobs leg must read st-runs');
    assert.match(src, /ST_SIGNALS_ROOT/, 'getSignals leg must read st-signals');
    assert.match(src, /array-contains/, 'run-scoped signal read filters on runIds membership');
    assert.doesNotMatch(src, LEGACY_CONSTS, 'no legacy symbol/subcollection constants');
  });

  it('signal-date-writer writes st-signals + st-symbols only', () => {
    const src = read('functions/src/st-cloud-function/signal-date-writer.ts');
    assert.match(src, /ST_SIGNALS_ROOT/, 'occurrence writes must land on st-signals');
    assert.match(src, /ST_SYMBOLS_ROOT/, 'gate-field writes must land on st-symbols');
    assert.doesNotMatch(src, LEGACY_CONSTS, 'no legacy subcollection writes');
    assert.doesNotMatch(src, LEGACY_SUBCOL_LITERAL, 'no run-ids/signal-history path literals');
  });

  it('dashboard callables read st-signals for both signal surfaces', () => {
    const src = read('functions/src/st-cloud-function/dashboard-callables.ts');
    assert.match(src, /ST_SIGNALS_ROOT/, 'run-scoped + history reads must hit st-signals');
    assert.doesNotMatch(src, LEGACY_CONSTS, 'no legacy collection-group/subcollection reads');
    assert.doesNotMatch(src, /collectionGroup/, 'no collection-group queries remain');
  });

  it('run.service reads run docs from st-runs', () => {
    const src = read('src/app/features/savant-trader/services/run.service.ts');
    assert.match(src, /ST_RUNS_ROOT/);
    assert.doesNotMatch(src, /Collection\.ST_RUNS/);
  });

  it('signal.service reads st-signals; no legacy parent anywhere', () => {
    const src = read('src/app/features/savant-trader/services/signal.service.ts');
    assert.match(src, /ST_SIGNALS_ROOT/, 'signal reads must hit st-signals');
    assert.match(src, /ST_SYMBOLS_ROOT/, 'doc-level symbol reads must use st-symbols');
    assert.doesNotMatch(src, /Collection\.ST_SYMBOLS/, 'retired Collection member must not appear');
    assert.doesNotMatch(src, LEGACY_SUBCOL_LITERAL, 'no run-ids/signal-history path literals');
  });

  it('TTL root list sweeps only st-runs', () => {
    const src = read('functions/src/common/st-run-jobs-ttl.ts');
    assert.match(src, /ST_RUN_JOB_ROOTS = \[ST_RUNS_ROOT\]/);
  });

  it('zero legacy symbol-parent references remain in deployed code', () => {
    const scanRoots = [
      join(REPO_ROOT, 'functions', 'src'),
      join(REPO_ROOT, 'src', 'app'),
    ];
    // st-collections.ts is the declaration site for the retired constants
    // (kept for historical scripts); usage is what's pinned to zero.
    const EXEMPT = new Set(['functions/src/common/st-collections.ts']);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) { walk(p); continue; }
        if (!entry.name.endsWith('.ts')) continue;
        const rel = relative(REPO_ROOT, p).replace(/\\/g, '/');
        if (EXEMPT.has(rel)) continue;
        const src = readFileSync(p, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (LEGACY_CONSTS.test(line) || /Collection\.ST_SYMBOLS\b/.test(line)) {
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          }
        });
      }
    };
    for (const root of scanRoots) walk(root);
    assert.deepEqual(hits, [], 'deployed code must not reference the retired legacy constants/members');
  });
});
