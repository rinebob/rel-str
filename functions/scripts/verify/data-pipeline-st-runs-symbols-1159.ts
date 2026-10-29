/**
 * RETIRED — the legacy savant-trader/data/symbols evidence this relay
 * verified against was archived + deleted at #1019 ship (see
 * functions/scripts/output/legacy-archive-1013/). Unregistered from
 * run-all; kept for reference.
 *
 * Parity relay — #1159 legacy runs/symbols → st-runs/st-symbols cutover.
 *
 * Read-only verification that the canonical roots carry full coverage of
 * the legacy roots they replace:
 *
 *   - every `savant-trader/data/runs/{runId}` doc exists verbatim in
 *     `st-runs/{runId}` (field-level deep equality), and every job under
 *     `…/runs/{runId}/jobs` exists verbatim under `st-runs/{runId}/jobs`
 *   - every `savant-trader/data/symbols/{SYM}` top-level doc exists
 *     verbatim in `st-symbols/{SYM}` — run-ids/signal-history
 *     subcollections are NOT compared (they stay live on the legacy
 *     parent until #1019; their counts are reported as context)
 *   - blocked/live roots are inventoried so the relay doubles as the
 *     "nothing else moved" check
 *
 * Bulk reads: each leg loads the canonical collection (or per-run jobs
 * collection) once and diffs in memory — per-doc existence reads are
 * too slow over ~1k symbol docs + ~7k job docs.
 *
 * Exit 1 on any FAIL line (missing canonical doc, field diff, an empty
 * legacy root — a zero-evidence pass — or a blocked root that went empty
 * unexpectedly).
 *
 * ORDERING: run BEFORE the `savant-trader/data/runs` wholesale delete —
 * post-delete the run/jobs legs fail on the empty-legacy floor rather
 * than passing vacuously.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-runs-symbols-1159.ts
 *
 * Requires Application Default Credentials (read-only).
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_RUNS_ROOT,
  ST_SYMBOLS_ROOT,
  ST_JOBS_SUBCOLLECTION_NAME,
} from '../../src/common/st-collections';
import { deepEqual } from '../../src/order-tickets/legacy-order-intents';

const LEGACY_RUNS_ROOT = 'savant-trader/data/runs';
const LEGACY_SYMBOLS_ROOT = 'savant-trader/data/symbols';

const BLOCKED_ROOTS = [
  // Still live — legacy parent hosts run-ids/signal-history until #1019.
  'savant-trader/data/symbols',
  // Deferred to #1160.
  'paper-trading/cohorts/items',
  'paper-trading/analysis-datasets/items',
  'paper-trading/analysis-slices/items',
  // Live auth — permanent.
  'rh-agent-credentials',
] as const;

interface CheckResult {
  label: string;
  ok: boolean;
  detail: string;
}

function docDataEquals(
  incoming: Record<string, unknown>,
  existing: FirebaseFirestore.DocumentData | undefined,
): boolean {
  if (!existing) return false;
  return Object.entries(incoming).every(([k, v]) => deepEqual(existing[k], v))
    && Object.keys(existing).every((k) => Object.hasOwn(incoming, k));
}

type DocMap = Map<string, FirebaseFirestore.DocumentData>;

async function loadCollectionMap(
  col: FirebaseFirestore.CollectionReference,
): Promise<DocMap> {
  const snap = await col.get();
  return new Map(snap.docs.map((d) => [d.id, d.data()]));
}

async function checkRuns(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const legacy = await db.collection(LEGACY_RUNS_ROOT).get();
  const canonicalCol = db.collection(ST_RUNS_ROOT);
  const canonical = await loadCollectionMap(canonicalCol);

  let missing = 0;
  let diffs = 0;
  let jobsLegacy = 0;
  let jobsMissing = 0;
  let jobsDiffs = 0;
  const diffLines: string[] = [];

  for (const runDoc of legacy.docs) {
    const c = canonical.get(runDoc.id);
    if (!c) {
      missing++;
      diffLines.push(`run ${runDoc.id}: missing in st-runs`);
    } else if (!docDataEquals(runDoc.data(), c)) {
      diffs++;
      diffLines.push(`run ${runDoc.id}: field diff vs st-runs`);
    }
    const [legacyJobs, canonicalJobs] = await Promise.all([
      runDoc.ref.collection(ST_JOBS_SUBCOLLECTION_NAME).get(),
      canonicalCol.doc(runDoc.id).collection(ST_JOBS_SUBCOLLECTION_NAME).get(),
    ]);
    const canonicalJobMap: DocMap = new Map(canonicalJobs.docs.map((d) => [d.id, d.data()]));
    let runJobsMissing = 0;
    let runJobsDiffs = 0;
    for (const job of legacyJobs.docs) {
      jobsLegacy++;
      const cj = canonicalJobMap.get(job.id);
      if (!cj) { jobsMissing++; runJobsMissing++; }
      else if (!docDataEquals(job.data(), cj)) { jobsDiffs++; runJobsDiffs++; }
    }
    if (runJobsMissing > 0 || runJobsDiffs > 0) {
      diffLines.push(`run ${runDoc.id}: jobs missing=${runJobsMissing} diffs=${runJobsDiffs}`);
    }
  }

  // Empty-legacy floors: a zero-evidence pass (wrong env, emptied root,
  // post-wholesale-delete) must FAIL, not pass vacuously.
  out.push({
    label: 'st-runs run docs',
    ok: legacy.size > 0 && missing === 0 && diffs === 0,
    detail: `legacy=${legacy.size} canonical=${canonical.size} missing=${missing} diffs=${diffs}`,
  });
  out.push({
    label: 'st-runs jobs',
    ok: jobsLegacy > 0 && jobsMissing === 0 && jobsDiffs === 0,
    detail: `legacyJobs=${jobsLegacy} missing=${jobsMissing} diffs=${jobsDiffs}`,
  });
  for (const l of diffLines.slice(0, 20)) {
    out.push({ label: `  ↳ ${l}`, ok: false, detail: '' });
  }
  return out;
}

async function checkSymbols(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const legacy = await db.collection(LEGACY_SYMBOLS_ROOT).get();
  const canonicalCol = db.collection(ST_SYMBOLS_ROOT);
  const canonical = await loadCollectionMap(canonicalCol);

  let missing = 0;
  let diffs = 0;
  const diffLines: string[] = [];

  for (const symDoc of legacy.docs) {
    const c = canonical.get(symDoc.id);
    if (!c) {
      missing++;
      diffLines.push(`symbol ${symDoc.id}: missing in st-symbols`);
    } else if (!docDataEquals(symDoc.data(), c)) {
      diffs++;
      diffLines.push(`symbol ${symDoc.id}: field diff vs st-symbols`);
    }
  }

  out.push({
    label: 'st-symbols docs',
    ok: legacy.size > 0 && missing === 0 && diffs === 0,
    detail: `legacy=${legacy.size} canonical=${canonical.size} missing=${missing} diffs=${diffs}`,
  });
  for (const l of diffLines.slice(0, 20)) {
    out.push({ label: `  ↳ ${l}`, ok: false, detail: '' });
  }

  // Context only — subcollection counts stay on the legacy parent until
  // #1019 cuts readers to st-signals.
  let runIds = 0;
  let signalHistory = 0;
  for (const symDoc of legacy.docs.slice(0, 50)) {
    runIds += (await symDoc.ref.collection('run-ids').select().get()).size;
    signalHistory += (await symDoc.ref.collection('signal-history').select().get()).size;
  }
  out.push({
    label: 'legacy subcollections (context, first 50 symbols)',
    ok: true,
    detail: `run-ids=${runIds} signal-history=${signalHistory} — still live on legacy parent until #1019`,
  });
  return out;
}

async function checkBlockedRoots(): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const path of BLOCKED_ROOTS) {
    const snap = await db.collection(path).select().get();
    out.push({
      label: `blocked ${path}`,
      ok: snap.size > 0,
      detail: `docs=${snap.size} (must stay populated until its owning task)`,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const results: CheckResult[] = [
    ...(await checkRuns()),
    ...(await checkSymbols()),
    ...(await checkBlockedRoots()),
  ];

  let failures = 0;
  for (const r of results) {
    if (r.detail) {
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label} — ${r.detail}`);
    } else {
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.label}`);
    }
    if (!r.ok) failures++;
  }
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('relay failed:', err);
  process.exit(1);
});
