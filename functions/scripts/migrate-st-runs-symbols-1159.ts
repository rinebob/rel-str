/**
 * One-shot migration: legacy `savant-trader/data/{runs,symbols}` →
 * canonical `st-runs` / `st-symbols` (task #1159, IMPL-BE §Phase 7
 * deferred roots).
 *
 * Per legacy doc:
 *   - runs: copy the run doc verbatim to `st-runs/{runId}`, then copy
 *     its `jobs` subcollection verbatim to `st-runs/{runId}/jobs/{jobId}`
 *     — the run subtree stays intact for run-history + auto-paper
 *     `createdOpportunity` reads.
 *   - symbols: copy the top-level symbol doc verbatim to
 *     `st-symbols/{SYM}`. `run-ids`/`signal-history` subcollections are
 *     deliberately NOT migrated — they stay live on the legacy parent
 *     until #1019 cuts their readers to st-signals.
 *
 * Bulk reads: each leg loads the canonical collection (or per-run jobs
 * collection) once and diffs in memory — per-doc existence reads were
 * measured far too slow over ~1k symbol docs + ~7k job docs.
 *
 * Ordering (same contract as the earlier root migrations):
 *   1. run this script --apply while writers still target legacy
 *      (post-cutover deploy comes after),
 *   2. deploy functions + FE re-points,
 *   3. re-run this script to straggler-pick any docs written during the
 *      deploy window (idempotent — unchanged docs count as `unchanged`).
 *      Direction guard: when a canonical doc differs AND is newer than
 *      its legacy twin (updateTime), it's post-cutover drift — the doc
 *      is SKIPPED with a WARN, never overwritten. Treat nonzero
 *      `skipped` counts in the straggler pass as expected drift, and
 *      nonzero `updated` counts as a review signal (means the legacy
 *      doc was written AFTER the canonical one — a live legacy writer
 *      still running),
 *   4. run verify/data-pipeline-st-runs-symbols-1159.ts for parity.
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-st-runs-symbols-1159.ts                      # dry-run
 *   npx tsx scripts/migrate-st-runs-symbols-1159.ts --apply              # write
 *   npx tsx scripts/migrate-st-runs-symbols-1159.ts --only runs|symbols  # one leg
 *   npx tsx scripts/migrate-st-runs-symbols-1159.ts --id <docId>         # single doc
 *
 * Requires Application Default Credentials. Run OUTSIDE live-run
 * windows — a one-shot batch shouldn't race a run in progress.
 */
import { db } from '../src/firebase-admin-init';
import {
  ST_RUNS_ROOT,
  ST_SYMBOLS_ROOT,
  ST_JOBS_SUBCOLLECTION_NAME,
} from '../src/common/st-collections';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';

const BATCH_LIMIT = 400;
const LEGACY_RUNS_ROOT = 'savant-trader/data/runs';
const LEGACY_SYMBOLS_ROOT = 'savant-trader/data/symbols';

interface LegStats {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  unchanged: number;
  failed: number;
}

/** Normalized field-level diff — verbatim copies compare equal when every
 *  legacy field deep-equals the canonical value and no canonical-only
 *  keys exist. */
function docDataEquals(
  incoming: Record<string, unknown>,
  existing: FirebaseFirestore.DocumentData | undefined,
): boolean {
  if (!existing) return false;
  return Object.entries(incoming).every(([k, v]) => deepEqual(existing[k], v))
    && Object.keys(existing).every((k) => Object.hasOwn(incoming, k));
}

interface DocEntry {
  data: FirebaseFirestore.DocumentData;
  updateTime?: FirebaseFirestore.Timestamp;
}
type DocMap = Map<string, DocEntry>;

/** Load a whole collection into an id→{data, updateTime} map (one round
 *  trip). updateTime feeds the straggler-pass direction guard — a
 *  canonical doc newer than its legacy twin is post-cutover drift and
 *  must not be overwritten. */
async function loadCollectionMap(
  col: FirebaseFirestore.CollectionReference,
): Promise<DocMap> {
  const snap = await col.get();
  return new Map(snap.docs.map((d) => [d.id, { data: d.data(), updateTime: d.updateTime }]));
}

/** Classify + queue a verbatim copy for one legacy doc. Plain set (no
 *  merge): the canonical doc must mirror the legacy doc exactly — merge
 *  would leave canonical-only residue that breaks field parity.
 *
 *  Direction guard: on the post-deploy straggler pass a DIFFERING doc
 *  can be canonical-newer (post-cutover writer drift — e.g. run status
 *  advancing in st-runs). Legacy must never overwrite that state, so
 *  when canonical.updateTime > legacy.updateTime the doc is skipped,
 *  not updated. */
function stageCopy(
  id: string,
  data: Record<string, unknown>,
  incomingUpdateTime: FirebaseFirestore.Timestamp | undefined,
  canonical: DocMap,
  dstRef: FirebaseFirestore.DocumentReference,
  dryRun: boolean,
  stats: LegStats,
  warnings: string[],
  batch: FirebaseFirestore.WriteBatch,
): boolean {
  const existing = canonical.get(id);
  if (!existing) {
    stats.created++;
  } else if (docDataEquals(data, existing.data)) {
    stats.unchanged++;
    return false;
  } else if (
    existing.updateTime && incomingUpdateTime
    && existing.updateTime.toMillis() > incomingUpdateTime.toMillis()
  ) {
    stats.skipped++;
    warnings.push(`${dstRef.path}: canonical newer — skipped (post-cutover drift)`);
    return false;
  } else {
    stats.updated++;
    warnings.push(`${dstRef.path}: canonical differs — ${dryRun ? 'would overwrite' : 'overwritten'}`);
  }
  if (dryRun) return false;
  batch.set(dstRef, data);
  return true;
}

async function migrateRuns(dryRun: boolean, onlyId: string | undefined): Promise<LegStats> {
  const stats: LegStats = { scanned: 0, created: 0, updated: 0, skipped: 0, unchanged: 0, failed: 0 };
  const warnings: string[] = [];
  const canonicalRuns = await loadCollectionMap(db.collection(ST_RUNS_ROOT));
  const legacyCol = db.collection(LEGACY_RUNS_ROOT);
  const runsCol = db.collection(ST_RUNS_ROOT);
  const snap = onlyId
    ? { docs: [await legacyCol.doc(onlyId).get()].filter((d) => d.exists) }
    : await legacyCol.get();
  if (onlyId && snap.docs.length === 0) {
    console.log(`  runs: ${onlyId} not found in ${LEGACY_RUNS_ROOT}`);
    return stats;
  }

  let jobsScanned = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };

  for (const runDoc of snap.docs) {
    stats.scanned++;
    try {
      if (stageCopy(runDoc.id, runDoc.data(), runDoc.updateTime, canonicalRuns, runsCol.doc(runDoc.id), dryRun, stats, warnings, batch)) pending++;
      if (pending >= BATCH_LIMIT) await flush();

      const [legacyJobs, canonicalJobs] = await Promise.all([
        runDoc.ref.collection(ST_JOBS_SUBCOLLECTION_NAME).get(),
        runsCol.doc(runDoc.id).collection(ST_JOBS_SUBCOLLECTION_NAME).get(),
      ]);
      const canonicalJobMap: DocMap = new Map(
        canonicalJobs.docs.map((d) => [d.id, { data: d.data(), updateTime: d.updateTime }]),
      );
      const jobTargetCol = runsCol.doc(runDoc.id).collection(ST_JOBS_SUBCOLLECTION_NAME);
      for (const job of legacyJobs.docs) {
        jobsScanned++;
        if (stageCopy(job.id, job.data(), job.updateTime, canonicalJobMap, jobTargetCol.doc(job.id), dryRun, stats, warnings, batch)) pending++;
        if (pending >= BATCH_LIMIT) await flush();
      }
    } catch (err) {
      stats.failed++;
      warnings.push(`${runDoc.id}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
    if (stats.scanned % 25 === 0) {
      console.log(`  runs progress — ${stats.scanned}/${snap.docs.length} (${jobsScanned} jobs scanned)`);
    }
  }
  await flush();
  console.log(`  runs: ${stats.scanned} docs, ${jobsScanned} job docs`);
  for (const w of warnings.slice(0, 30)) console.log(`    WARN ${w}`);
  return stats;
}

async function migrateSymbols(dryRun: boolean, onlyId: string | undefined): Promise<LegStats> {
  const stats: LegStats = { scanned: 0, created: 0, updated: 0, skipped: 0, unchanged: 0, failed: 0 };
  const warnings: string[] = [];
  const canonicalSymbols = await loadCollectionMap(db.collection(ST_SYMBOLS_ROOT));
  const legacyCol = db.collection(LEGACY_SYMBOLS_ROOT);
  const symbolsCol = db.collection(ST_SYMBOLS_ROOT);
  const snap = onlyId
    ? { docs: [await legacyCol.doc(onlyId).get()].filter((d) => d.exists) }
    : await legacyCol.get();
  if (onlyId && snap.docs.length === 0) {
    console.log(`  symbols: ${onlyId} not found in ${LEGACY_SYMBOLS_ROOT}`);
    return stats;
  }

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };

  for (const symDoc of snap.docs) {
    stats.scanned++;
    try {
      // Top-level doc only — run-ids/signal-history subcollections stay
      // live on the legacy parent until #1019.
      if (stageCopy(symDoc.id, symDoc.data(), symDoc.updateTime, canonicalSymbols, symbolsCol.doc(symDoc.id), dryRun, stats, warnings, batch)) pending++;
      if (pending >= BATCH_LIMIT) await flush();
    } catch (err) {
      stats.failed++;
      warnings.push(`${symDoc.id}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await flush();
  console.log(`  symbols: ${stats.scanned} docs (top-level only — subcollections stay legacy until #1019)`);
  for (const w of warnings.slice(0, 30)) console.log(`    WARN ${w}`);
  return stats;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  const onlyIdx = process.argv.findIndex((a) => a === '--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined;
  if (only !== undefined && only !== 'runs' && only !== 'symbols') {
    console.error("--only must be 'runs' or 'symbols'");
    process.exit(1);
  }
  const idIdx = process.argv.findIndex((a) => a === '--id');
  const onlyId = idIdx >= 0 ? process.argv[idIdx + 1] : undefined;
  if (idIdx >= 0 && (!onlyId || onlyId.startsWith('--'))) {
    console.error('--id requires a value');
    process.exit(1);
  }
  if (onlyId && !only) {
    console.error('--id requires --only runs|symbols');
    process.exit(1);
  }

  console.log(`st-runs/st-symbols migration — #1159${dryRun ? ' [DRY RUN]' : ''}\n`);

  const totals = { failed: 0 };
  if (!only || only === 'runs') {
    const s = await migrateRuns(dryRun, onlyId);
    console.log(
      `  runs TOTAL (run+job docs) — ${dryRun ? 'would create' : 'created'}=${s.created} ` +
      `updated=${s.updated} skipped=${s.skipped} unchanged=${s.unchanged} failed=${s.failed}\n`,
    );
    totals.failed += s.failed;
  }
  if (!only || only === 'symbols') {
    const s = await migrateSymbols(dryRun, onlyId);
    console.log(
      `  symbols TOTAL — ${dryRun ? 'would create' : 'created'}=${s.created} ` +
      `updated=${s.updated} skipped=${s.skipped} unchanged=${s.unchanged} failed=${s.failed}\n`,
    );
    totals.failed += s.failed;
  }
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
