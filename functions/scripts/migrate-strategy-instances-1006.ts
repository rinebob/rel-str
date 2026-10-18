/**
 * One-shot migration for #1006: legacy strategy-instance docs → canonical
 * `st-strategy-instances` (IMPL-BE §Phase 5).
 *
 * Sources (unioned by doc id; the anchored doc wins a collision — it is the
 * newer-generation Strategy Builder write):
 *   options-strategy-instances/{id}            — legacy root (4 live docs)
 *     {id}/daily-analysis/{date|latest}        — carried verbatim
 *   paper-trading/instances/items/{id}         — anchored (empty as of
 *                                                2026-10-18; kept for
 *                                                completeness — FE writes
 *                                                here until #1014)
 *     {id}/daily-analysis/{...}                — carried verbatim
 *
 * Canonical payload = source fields minus `kind` (the anchor-era
 * discriminator), plus:
 *   mode:           'paper'   — all existing instances are paper
 *   enabled:        true      — kill switch, defaults on
 *   paperAccountId: source value or buildAccountId(userId)
 *   createdAt/updatedAt normalized to ISO strings
 *
 * Legacy docs are NOT deleted — archive/diff/delete is the final reorg phase
 * (#1013). Idempotent: set(merge) with an unchanged-detection pass, so
 * reruns report `unchanged`.
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-strategy-instances-1006.ts [--id <instanceId>]   # dry-run
 *   npx tsx scripts/migrate-strategy-instances-1006.ts --apply [--id ...]    # write
 *
 * Requires Application Default Credentials. Run OUTSIDE live-run windows —
 * this only migrates existing docs; new instances flow through the repo's
 * canonical path directly.
 */
import { db } from '../src/firebase-admin-init';
import {
  buildAccountId,
  PaperTradingKind,
  paperTradingItemsPath,
} from '@paper-trading/ids';
import {
  LEGACY_OPTIONS_STRATEGY_INSTANCES,
  ST_STRATEGY_INSTANCES_ROOT,
} from '../src/common/st-collections';
import { STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION } from '../src/paper-trading/engine/strategy-instance-repository';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';

const BATCH_LIMIT = 400;

const LEGACY_ROOT = LEGACY_OPTIONS_STRATEGY_INSTANCES;
const LEGACY_ANCHOR = paperTradingItemsPath(PaperTradingKind.INSTANCE);
const DAILY_ANALYSIS_SUB = STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION;

interface MigrateStats {
  created: number;
  updated: number;
  unchanged: number;
  malformed: number;
  failed: number;
  analysisCopied: number;
}

function isTimestampLike(v: unknown): v is { toDate(): Date } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { toDate?: unknown }).toDate === 'function'
  );
}

function toIso(v: unknown): string {
  if (typeof v === 'string') return v;
  if (isTimestampLike(v)) return v.toDate().toISOString();
  return new Date().toISOString();
}

/** Best-effort timestamp for a daily-analysis doc — used for newer-wins on rerun. */
function analysisTimestamp(d: Record<string, unknown>): string | undefined {
  const sim = d.overnightDeltaSimulation as { computedAt?: unknown } | undefined;
  const t = sim?.computedAt ?? d.computedAt ?? d.updatedAt;
  return typeof t === 'string' ? t : undefined;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--apply');
  const idArg = process.argv.findIndex((a) => a === '--id');
  const onlyId = idArg >= 0 ? process.argv[idArg + 1] : undefined;
  if (idArg >= 0 && (!onlyId || onlyId.startsWith('--'))) {
    console.error('--id requires a value');
    process.exit(1);
  }

  const legacyRootCol = db.collection(LEGACY_ROOT);
  const anchorCol = db.collection(LEGACY_ANCHOR);
  const canonCol = db.collection(ST_STRATEGY_INSTANCES_ROOT);

  const [rootSnap, anchorSnap] = await Promise.all([
    onlyId ? legacyRootCol.doc(onlyId).get().then((d) => ({ docs: d.exists ? [d] : [] })) : legacyRootCol.get(),
    onlyId ? anchorCol.doc(onlyId).get().then((d) => ({ docs: d.exists ? [d] : [] })) : anchorCol.get(),
  ]);

  // Union by id — the anchored doc wins a collision (newer-generation write).
  interface Src {
    id: string;
    data: Record<string, unknown>;
    sourcePath: string;
    ref: FirebaseFirestore.DocumentReference;
  }
  const sources = new Map<string, Src>();
  for (const d of [...rootSnap.docs, ...anchorSnap.docs]) {
    sources.set(d.id, { id: d.id, data: d.data() as Record<string, unknown>, sourcePath: d.ref.path, ref: d.ref });
  }

  console.log(
    `strategy-instances migration — ${rootSnap.docs.length} legacy-root + ` +
    `${anchorSnap.docs.length} anchored → ${sources.size} unique ` +
    `${dryRun ? '[DRY RUN]' : ''}\n`,
  );

  const stats: MigrateStats = {
    created: 0, updated: 0, unchanged: 0, malformed: 0, failed: 0, analysisCopied: 0,
  };
  const malformedLines: string[] = [];
  const warningLines: string[] = [];

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };
  const enqueue = async (fn: () => void) => {
    fn();
    pending++;
    if (pending >= BATCH_LIMIT) await flush();
  };

  for (const src of sources.values()) {
    try {
      const d = src.data;
      if (typeof d.symbol !== 'string' || !d.symbol.length) {
        stats.malformed++;
        malformedLines.push(`${src.id} (${src.sourcePath}): missing symbol`);
        continue;
      }
      if (typeof d.userId !== 'string' || !d.userId.length) {
        stats.malformed++;
        malformedLines.push(`${src.id} (${src.sourcePath}): missing userId`);
        continue;
      }

      // Strip the anchor-era discriminator; stamp the canonical fields.
      const { kind: _kind, ...rest } = d;
      const canonical: Record<string, unknown> = {
        ...rest,
        mode: 'paper',
        enabled: typeof rest.enabled === 'boolean' ? rest.enabled : true,
        paperAccountId:
          typeof rest.paperAccountId === 'string' && rest.paperAccountId.length > 0
            ? rest.paperAccountId
            : buildAccountId(d.userId),
        createdAt: toIso(d.createdAt),
        // A legacy doc missing updatedAt must not fabricate "now" — that
        // stamp would falsely win the repo's newest-wins merge. Fall back to
        // createdAt (old) so a canonical copy always outranks it.
        updatedAt: toIso(d.updatedAt ?? d.createdAt),
      };
      delete canonical.id; // id lives in the doc path, not the payload

      const existing = (await canonCol.doc(src.id).get()).data();
      if (existing) {
        // Post-migration canonical state is authoritative. A canonical doc
        // newer than the source (post-#1014 FE edit, engine write) is left
        // untouched wholesale — field-level merging would revert edits and
        // reset updatedAt to the stale legacy stamp.
        if (
          typeof canonical.updatedAt === 'string' &&
          toIso(existing.updatedAt) > canonical.updatedAt
        ) {
          stats.unchanged++;
          warningLines.push(
            `${src.id}: canonical doc newer than legacy source — preserved`,
          );
          continue;
        }
        for (const k of ['mode', 'enabled', 'paperAccountId', 'lastFiredAt'] as const) {
          if (existing[k] !== undefined) canonical[k] = existing[k];
        }
      }
      const changed =
        existing == null ||
        Object.entries(canonical).some(([k, v]) => !deepEqual(existing[k], v));
      if (!changed) {
        stats.unchanged++;
      } else if (existing) {
        stats.updated++;
        warningLines.push(`${src.id}: existing canonical doc updated`);
        if (!dryRun) {
          await enqueue(() => batch.set(canonCol.doc(src.id), canonical, { merge: true }));
        }
      } else {
        stats.created++;
        if (!dryRun) {
          await enqueue(() => batch.set(canonCol.doc(src.id), canonical, { merge: true }));
        }
      }

      // Carry the daily-analysis subcollection verbatim — the open pass reads
      // `daily-analysis/latest` to pick the overnight grid point.
      const daSnap = await src.ref.collection(DAILY_ANALYSIS_SUB).get();
      for (const daDoc of daSnap.docs) {
        const daData = daDoc.data();
        const daTarget = canonCol.doc(src.id).collection(DAILY_ANALYSIS_SUB).doc(daDoc.id);
        const daExisting = (await daTarget.get()).data();
        if (daExisting != null) {
          if (deepEqual(daExisting, daData)) {
            continue;
          }
          // Canonical is authoritative post-migration — overwrite only when
          // the legacy doc is provably newer (e.g. the pre-deploy engine ran
          // a nightly sim between migrate and deploy).
          const srcTs = analysisTimestamp(daData);
          const dstTs = analysisTimestamp(daExisting);
          if (!srcTs || !dstTs || srcTs <= dstTs) {
            warningLines.push(
              `${src.id}/daily-analysis/${daDoc.id}: canonical differs and legacy is not newer — kept canonical`,
            );
            continue;
          }
        }
        stats.analysisCopied++;
        if (!dryRun) {
          const payload = daData;
          await enqueue(() => batch.set(daTarget, payload, { merge: true }));
        }
      }
      if (daSnap.size === 0) {
        warningLines.push(`${src.id}: no daily-analysis subcollection on source doc`);
      }
    } catch (err) {
      stats.failed++;
      malformedLines.push(`${src.id}: ${String(err)}`);
    }
  }
  await flush();

  console.log('— results —');
  for (const [k, v] of Object.entries(stats)) console.log(`${k}: ${v}`);
  if (warningLines.length) {
    console.log('\nwarnings:');
    for (const w of warningLines) console.log(`  ⚠ ${w}`);
  }
  if (malformedLines.length) {
    console.log('\nmalformed/failed:');
    for (const m of malformedLines) console.log(`  ✖ ${m}`);
  }
  if (dryRun) console.log('\n[DRY RUN] rerun with --apply to write');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
