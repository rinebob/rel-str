/**
 * @topic #984 — ST Firestore Reorg (task #1010)
 *
 * st-runs jobs TTL coverage:
 * - cleanupStRunJobs drains `…/runs/{runId}/jobs/{SYM}` docs older than
 *   the TTL (default 7d) by enumerating run docs per ST root and
 *   querying each run's jobs subcollection for `createdAt < cutoff`.
 * - Per-run scoping — not `collectionGroup('jobs')` — is deliberate:
 *   the group has no `createdAt` index (prod FAILED_PRECONDITION) and
 *   ~1.07M foreign members (rs-backfill/rs-realtime/spread) that would
 *   permanently occupy an oldest-first scan window. The collection
 *   path IS the scope; foreign docs can never be returned.
 * - `isStRunJobPath` survives as the audit's path classifier — tests
 *   pin its contract, but it is not consulted on the delete path.
 * - Per-invocation delete cap bounds the pre-purge backlog inside the
 *   function timeout; the one-shot purge script drains the backlog.
 * - Reader safety is structural, not tested here: evalRunCompletion
 *   reads run-doc counters (never the subcollection) and auto-paper
 *   reads jobs only for the just-completed run — both far inside the
 *   TTL window.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isStRunJobPath,
  purgeOldRunJobs,
  purgeOldRunJobsForRoot,
  ST_RUN_JOB_ROOTS,
} from '../../functions/src/common/st-run-jobs-ttl';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC_ROOT = join(REPO_ROOT, 'functions', 'src');

describe('isStRunJobPath — census path classifier', () => {
  it('rejects job docs under the retired legacy runs root (#1159)', () => {
    assert.equal(isStRunJobPath('savant-trader/data/runs/r1/jobs/AAPL'), false);
  });

  it('accepts job docs under the canonical st-runs root', () => {
    assert.equal(isStRunJobPath('st-runs/r1/jobs/AAPL'), true);
  });

  it('rejects spread-runs jobs — different domain', () => {
    assert.equal(isStRunJobPath('spread-runs/r1/jobs/AAPL'), false);
  });

  it('rejects rs-domain jobs — different domain, no TTL', () => {
    assert.equal(isStRunJobPath('system/rs-realtime-runs/runs/r1/jobs/j1'), false);
    assert.equal(isStRunJobPath('system/rs-backfill-runs/runs/r1/jobs/j1'), false);
  });

  it('rejects other subcollections under the runs root', () => {
    assert.equal(isStRunJobPath('st-runs/r1/signals/AAPL'), false);
    assert.equal(isStRunJobPath('st-runs/r1/notes/AAPL'), false);
  });

  it('rejects run docs themselves, prefix siblings, and nested paths', () => {
    assert.equal(isStRunJobPath('savant-trader/data/runs/r1'), false);
    assert.equal(isStRunJobPath('st-runs-old/r1/jobs/AAPL'), false);
    assert.equal(isStRunJobPath('savant-trader/data/runs-extra/r1/jobs/A'), false);
    assert.equal(isStRunJobPath('st-runs/r1/jobs/A/deep'), false);
    assert.equal(isStRunJobPath('savant-trader/data/occurrence-decisions/d1'), false);
  });
});

describe('ST_RUN_JOB_ROOTS', () => {
  it('covers exactly the canonical st-runs root', () => {
    // #1159: legacy savant-trader/data/runs leg dropped — that root is
    // deleted wholesale rather than TTL-drained.
    assert.deepEqual([...ST_RUN_JOB_ROOTS], ['st-runs']);
  });
});

// ── purgeOldRunJobsForRoot — structural fake firestore ──────────────────

interface FakeDoc { ref: { path: string } }
interface FakeSnap { docs: FakeDoc[]; size: number; empty: boolean }

interface RecordedWhere { field: string; op: string; value: unknown }

/** The function's own first-param type — structural stand-ins are
 *  bridged at ONE factory cast instead of per-call `as never`. */
type FsLike = Parameters<typeof purgeOldRunJobsForRoot>[0];
function fakeRunDoc(root: string, runId: string, jobs: FakeDoc[]) {
  const jobsState = { wheres: [] as RecordedWhere[], selects: 0 };
  const jobsQuery: Record<string, unknown> = {};
  const snap: FakeSnap = { docs: jobs, size: jobs.length, empty: jobs.length === 0 };
  jobsQuery.where = (field: string, op: string, value: unknown) => {
    jobsState.wheres.push({ field, op, value });
    return jobsQuery;
  };
  jobsQuery.select = () => { jobsState.selects++; return jobsQuery; };
  jobsQuery.get = async () => snap;
  return {
    ref: {
      path: `${root}/${runId}`,
      collection: (name: string) => {
        assert.equal(name, 'jobs');
        return jobsQuery;
      },
    },
    _jobsState: jobsState,
  };
}

function fakeFirestore(
  runsByRoot: Map<string, ReturnType<typeof fakeRunDoc>[]>,
): { firestore: FsLike; state: { collections: string[]; runSelects: number; deleted: string[]; commits: number } } {
  const state = {
    collections: [] as string[],
    runSelects: 0,
    deleted: [] as string[],
    commits: 0,
  };
  const fake = {
    collection: (root: string) => {
      state.collections.push(root);
      const q: Record<string, unknown> = {};
      const docs = (runsByRoot.get(root) ?? []).map((r) => ({ ref: r.ref }));
      q.select = () => { state.runSelects++; return q; };
      q.get = async () => ({ docs, size: docs.length, empty: docs.length === 0 });
      return q;
    },
    batch: () => ({
      delete: (ref: { path: string }) => { state.deleted.push(ref.path); },
      commit: async () => { state.commits++; },
    }),
  };
  return { firestore: fake as unknown as FsLike, state };
}

const CUTOFF = new Date('2026-01-01T00:00:00Z');

describe('purgeOldRunJobsForRoot', () => {
  it('enumerates run refs and deletes each run\'s old jobs', async () => {
    const run = fakeRunDoc('st-runs', 'r1', [
      { ref: { path: 'st-runs/r1/jobs/AAPL' } },
      { ref: { path: 'st-runs/r1/jobs/TSLA' } },
    ]);
    const { firestore, state } = fakeFirestore(new Map([['st-runs', [run]]]));
    const res = await purgeOldRunJobsForRoot(
      firestore, 'st-runs', { cutoff: CUTOFF, maxDelete: 100 });
    assert.deepEqual(res, { runsScanned: 1, jobsMatched: 2, deleted: 2 });
    assert.deepEqual(state.deleted, ['st-runs/r1/jobs/AAPL', 'st-runs/r1/jobs/TSLA']);
    assert.equal(state.commits, 1);
  });

  it('queries jobs with the createdAt < cutoff predicate', async () => {
    const run = fakeRunDoc('st-runs', 'r1', [{ ref: { path: 'st-runs/r1/jobs/A' } }]);
    const { firestore } = fakeFirestore(new Map([['st-runs', [run]]]));
    await purgeOldRunJobsForRoot(
      firestore, 'st-runs', { cutoff: CUTOFF, maxDelete: 10 });
    assert.deepEqual(run._jobsState.wheres, [
      { field: 'createdAt', op: '<', value: CUTOFF },
    ]);
  });

  it('never touches foreign roots — scope is structural', async () => {
    const { firestore, state } = fakeFirestore(
      new Map([['savant-trader/data/runs', []]]));
    await purgeOldRunJobsForRoot(
      firestore, 'savant-trader/data/runs',
      { cutoff: CUTOFF, maxDelete: 10 });
    assert.deepEqual(state.collections, ['savant-trader/data/runs']);
  });

  it('chunks deletes at the batch size', async () => {
    const run = fakeRunDoc('st-runs', 'r1',
      Array.from({ length: 5 }, (_, i) => ({ ref: { path: `st-runs/r1/jobs/S${i}` } })));
    const { firestore, state } = fakeFirestore(new Map([['st-runs', [run]]]));
    const res = await purgeOldRunJobsForRoot(
      firestore, 'st-runs',
      { cutoff: CUTOFF, maxDelete: 10, batchSize: 2 });
    assert.equal(res.deleted, 5);
    assert.equal(state.commits, 3);
  });

  it('honors maxDelete across runs', async () => {
    const mk = (id: string, n: number) =>
      fakeRunDoc('st-runs', id,
        Array.from({ length: n }, (_, i) => ({ ref: { path: `st-runs/${id}/jobs/S${i}` } })));
    const { firestore, state } = fakeFirestore(
      new Map([['st-runs', [mk('r1', 3), mk('r2', 3)]]]));
    const res = await purgeOldRunJobsForRoot(
      firestore, 'st-runs', { cutoff: CUTOFF, maxDelete: 4 });
    assert.equal(res.deleted, 4);
    assert.equal(state.deleted.length, 4);
  });

  it('commits nothing when no jobs match', async () => {
    const run = fakeRunDoc('st-runs', 'r1', []);
    const { firestore, state } = fakeFirestore(new Map([['st-runs', [run]]]));
    const res = await purgeOldRunJobsForRoot(
      firestore, 'st-runs', { cutoff: CUTOFF, maxDelete: 10 });
    assert.equal(res.deleted, 0);
    assert.equal(state.commits, 0);
  });
});

describe('purgeOldRunJobs — all roots', () => {
  it('iterates only the canonical root and never touches foreign roots', async () => {
    const mk = (root: string, id: string) =>
      fakeRunDoc(root, id, [{ ref: { path: `${root}/${id}/jobs/A` } }]);
    const { firestore, state } = fakeFirestore(new Map([
      ['st-runs', [mk('st-runs', 'r1')]],
      ['savant-trader/data/runs', [mk('savant-trader/data/runs', 'r2')]],
    ]));
    const res = await purgeOldRunJobs(
      firestore, { cutoff: CUTOFF, maxDelete: 1 });
    assert.equal(res.deleted, 1);
    assert.deepEqual(state.deleted, ['st-runs/r1/jobs/A']);
    assert.equal(res.runsScanned, 1);
  });
});

describe('scheduler registration', () => {
  it('cleanupStRunJobs is exported from index.ts', () => {
    const index = readFileSync(join(SRC_ROOT, 'index.ts'), 'utf8');
    assert.match(index, /^export \{[^}]*cleanupStRunJobs[^}]*\}/m);
  });

  it('the sweeper is a thin onSchedule trigger over the shared core', () => {
    const src = readFileSync(
      join(SRC_ROOT, 'scheduled', 'cleanup-st-run-jobs.ts'), 'utf8');
    assert.match(src, /onSchedule\(/);
    assert.match(src, /timeZone:\s*'Etc\/UTC'/);
    assert.match(src, /region:\s*'us-central1'/);
    assert.match(src, /purgeOldRunJobs\(db/);
    // trigger carries no query logic — the core owns it (strip
    // comments first: the header explains the design by name)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(code, /collectionGroup|collection\(ST_JOBS/);
  });
});
