/**
 * One-shot migration: legacy `paper-trading/analysis-datasets|analysis-slices`
 * anchors → canonical `st-paper-trading/analysis-datasets|analysis-slices`
 * (task #1158; BE twin #1160).
 *
 * Per legacy doc:
 *   - datasets: copy the index doc verbatim to
 *     `st-paper-trading/analysis-datasets/items/{id}`, then copy its
 *     `chunks` subcollection verbatim — the workbench's CSV mirror read
 *     (analysis.service readDatasetCsv) depends on it.
 *   - slices: copy the doc verbatim to
 *     `st-paper-trading/analysis-slices/items/{id}`.
 *
 * GCS payloads (`analysis-datasets/{id}.csv`, `analysis-slices/{id}.json`
 * in Storage) are NOT moved — the gcsPath field inside each doc keeps
 * pointing at the existing object; only the Firestore index docs migrate.
 *
 * Ordering contract — the deploy window is write-sensitive:
 *   1. run this script --apply while writers still target legacy
 *      (post-cutover deploy comes after),
 *   2. deploy firestore:rules + functions FIRST, then the FE build —
 *      rules must precede FE or slice saves/dataset deletes 403; an
 *      in-flight dataset generation spanning the functions deploy can
 *      split-brain (legacy index doc + partial canonical chunks), so
 *      quiesce generation for the window,
 *   3. hands off the analysis workbench between deploy and legacy
 *      delete: a canonical-side delete followed by a naive straggler
 *      re-copy would resurrect it, and a tag edit deadlocks the parity
 *      gate,
 *   4. re-run this script --apply --no-create to straggler-pick docs
 *      written to legacy during the deploy window. --no-create updates
 *      existing twins only — it never resurrects a doc deleted on
 *      canonical (reports it WARN instead; doc-granular — missing
 *      chunks under an existing twin still copy, which is what picks
 *      up straggler chunks from in-flight generation). Direction
 *      guard: when a canonical doc differs AND is newer than its
 *      legacy twin
 *      (updateTime), it's post-cutover drift — the doc and its
 *      subcollections are SKIPPED with a WARN, never overwritten,
 *   5. run verify/data-pipeline-analysis-anchors-1158.ts for parity,
 *   6. archive + delete the legacy anchors (ship-time, approval-gated).
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-analysis-anchors-1158.ts                    # dry-run
 *   npx tsx scripts/migrate-analysis-anchors-1158.ts --apply            # write
 *   npx tsx scripts/migrate-analysis-anchors-1158.ts --apply --no-create  # straggler pass
 *   npx tsx scripts/migrate-analysis-anchors-1158.ts --only datasets|slices
 *
 * Requires Application Default Credentials. Tiny surface (single-digit
 * doc counts at cutover) — no batching or window-safety concerns.
 */
import { db } from '../src/firebase-admin-init';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';

const LEGACY_ROOT = 'paper-trading';
const ST_ROOT = 'st-paper-trading';

const LEGS = {
  datasets: {
    anchor: 'analysis-datasets',
    subcollections: ['chunks'],
  },
  slices: {
    anchor: 'analysis-slices',
    subcollections: [] as string[],
  },
} as const;

type LegName = keyof typeof LEGS;

interface LegStats {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  unchanged: number;
  failed: number;
  subDocs: number;
}

function stats(): LegStats {
  return { scanned: 0, created: 0, updated: 0, skipped: 0, unchanged: 0, failed: 0, subDocs: 0 };
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

/** First divergent key for the clobber WARN — same semantics as the
 *  relay's parity check. */
function firstDiff(
  incoming: Record<string, unknown>,
  existing: FirebaseFirestore.DocumentData,
): string {
  for (const [k, v] of Object.entries(incoming)) {
    if (!deepEqual(existing[k], v)) return k;
  }
  const extra = Object.keys(existing).find((k) => !Object.hasOwn(incoming, k));
  return extra !== undefined ? `+${extra}` : '(none)';
}

/** Copy one doc (and its declared subcollections) verbatim. Direction
 *  guard: a canonical doc that DIFFERS and is canonical-newer is
 *  post-cutover drift — skipped, never overwritten. --no-create adds a
 *  second guard: no canonical twin → WARN-skip so a post-cutover delete
 *  is never resurrected by a straggler pass. */
async function copyDoc(
  legacyPath: string,
  stPath: string,
  subs: readonly string[],
  s: LegStats,
  apply: boolean,
  noCreate: boolean,
): Promise<void> {
  const legacySnap = await db.doc(legacyPath).get();
  if (!legacySnap.exists) {
    console.error(`  ${legacyPath} vanished mid-run — skipped`);
    s.failed++;
    return;
  }
  const stRef = db.doc(stPath);
  const stSnap = await stRef.get();
  const data = legacySnap.data()!;

  if (!stSnap.exists && noCreate) {
    console.warn(`  WARN ${stPath} has no canonical twin — --no-create, skipped (post-cutover delete or missed doc)`);
    s.skipped++;
    return;
  }
  if (stSnap.exists && docDataEquals(data, stSnap.data())) {
    s.unchanged++;
  } else if (
    stSnap.exists &&
    stSnap.updateTime && legacySnap.updateTime &&
    stSnap.updateTime.toMillis() > legacySnap.updateTime.toMillis()
  ) {
    console.warn(`  WARN ${stPath} differs and is canonical-newer — post-cutover drift, skipped`);
    s.skipped++;
    return;
  } else {
    if (stSnap.exists) {
      console.warn(`  WARN ${stPath} ${apply ? 'overwritten' : 'would overwrite'} (legacy newer) — first diff: ${firstDiff(data, stSnap.data()!)}`);
    }
    if (apply) {
      try {
        await stRef.set(data);
        stSnap.exists ? s.updated++ : s.created++;
      } catch (e) {
        console.error(`  FAIL write ${stPath}: ${e}`);
        s.failed++;
        return;
      }
    } else {
      stSnap.exists ? s.updated++ : s.created++;
    }
  }

  for (const sub of subs) {
    const legacySub = await db.collection(`${legacyPath}/${sub}`).get();
    for (const subDoc of legacySub.docs) {
      s.subDocs++;
      if (!apply) continue;
      const stSubRef = db.doc(`${stPath}/${sub}/${subDoc.id}`);
      try {
        const existing = await stSubRef.get();
        if (existing.exists && docDataEquals(subDoc.data(), existing.data())) continue;
        if (
          existing.exists &&
          existing.updateTime && subDoc.updateTime &&
          existing.updateTime.toMillis() > subDoc.updateTime.toMillis()
        ) {
          console.warn(`  WARN ${stSubRef.path} differs and is canonical-newer — drift, skipped`);
          continue;
        }
        await stSubRef.set(subDoc.data());
      } catch (e) {
        console.error(`  FAIL write ${stSubRef.path}: ${e}`);
        s.failed++;
      }
    }
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const noCreate = process.argv.includes('--no-create');
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? (process.argv[onlyIdx + 1] as LegName | undefined) : undefined;
  if (onlyIdx >= 0 && (only === undefined || !Object.hasOwn(LEGS, only))) {
    console.error(`--only must be one of: ${Object.keys(LEGS).join(', ')}`);
    process.exit(1);
  }

  console.log(apply ? 'APPLY — writing canonical docs' : 'DRY-RUN — pass --apply to write\n');
  const would = apply ? '' : 'would-';
  let anyFailed = false;

  for (const [name, leg] of Object.entries(LEGS) as [LegName, (typeof LEGS)[LegName]][]) {
    if (only && name !== only) continue;
    const s = stats();
    const legacyCol = `${LEGACY_ROOT}/${leg.anchor}/items`;
    const stCol = `${ST_ROOT}/${leg.anchor}/items`;
    const snap = await db.collection(legacyCol).get();
    s.scanned = snap.size;
    console.log(`${name}: ${snap.size} legacy doc(s) at ${legacyCol}`);

    for (const doc of snap.docs) {
      await copyDoc(doc.ref.path, `${stCol}/${doc.id}`, leg.subcollections, s, apply, noCreate);
    }

    console.log(
      `  scanned=${s.scanned} ${would}created=${s.created} ${would}updated=${s.updated} ` +
      `skipped=${s.skipped} unchanged=${s.unchanged} failed=${s.failed} subDocs=${s.subDocs}`,
    );
    if (s.failed > 0) anyFailed = true;
  }
  if (anyFailed) process.exitCode = 1;

  console.log(apply
    ? '\nDone. Re-run --apply --no-create after the cutover deploy to straggler-pick drift, then run the parity relay.'
    : '\nDry-run complete — nothing was written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
