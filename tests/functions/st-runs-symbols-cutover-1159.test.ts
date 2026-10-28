/**
 * @topic #984 — ST Firestore Reorg (task #1159)
 *
 * Split-boundary pin — the #1159 cutover repoints DOC-LEVEL traffic to
 * st-runs / st-symbols while run-ids / signal-history subcollection reads
 * deliberately stay on the legacy `savant-trader/data/symbols` parent
 * until #1019 cuts them to st-signals.
 *
 * This test pins that boundary on the surfaces where both roots appear
 * in the same file — a drift in either direction (a doc-level read
 * reverting to the legacy parent, or a subcollection leg moving early)
 * is the class of regression a behavioral mock can't see.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('st-runs/st-symbols cutover boundary (#1159)', () => {
  it('auto-paper ingest reads jobs off st-runs, run-ids off the legacy parent', () => {
    const src = read('functions/src/paper-trading/passes/auto-paper-ingest-pass.ts');
    assert.match(src, /ST_RUNS_ROOT/, 'jobs leg must read st-runs');
    assert.match(src, /ST_SYMBOLS_COLLECTION/, 'run-ids leg stays on the legacy parent until #1019');
  });

  it('signal-date-writer splits gate fields (st-symbols) from subcollections (legacy)', () => {
    const src = read('functions/src/st-cloud-function/signal-date-writer.ts');
    assert.match(src, /ST_SYMBOLS_ROOT/, 'gate-field writes must land on st-symbols');
    assert.match(src, /ST_SYMBOLS_COLLECTION/, 'run-ids/signal-history writes stay on the legacy parent until #1019');
  });

  it('run.service reads run docs from st-runs', () => {
    const src = read('src/app/features/savant-trader/services/run.service.ts');
    assert.match(src, /ST_RUNS_ROOT/);
    assert.doesNotMatch(src, /Collection\.ST_RUNS/);
  });

  it('signal.service doc reads use st-symbols; subcollection reads stay legacy', () => {
    const src = read('src/app/features/savant-trader/services/signal.service.ts');
    assert.match(src, /ST_SYMBOLS_ROOT/, 'doc-level symbol reads must use st-symbols');
    assert.match(src, /Collection\.ST_SYMBOLS/, 'run-ids/signal-history reads stay on the legacy parent until #1019');
  });

  it('TTL root list sweeps only st-runs', () => {
    const src = read('functions/src/common/st-run-jobs-ttl.ts');
    assert.match(src, /ST_RUN_JOB_ROOTS = \[ST_RUNS_ROOT\]/);
  });
});
