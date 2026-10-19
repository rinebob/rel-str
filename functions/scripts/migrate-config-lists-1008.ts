/**
 * One-shot copy migration: savant-trader config/list paths → canonical
 * st- roots (task #1008, IMPL-BE Phase 6).
 *
 * Families:
 *   savant-trader/data/trading-config/{docId}  → st-config/{docId}
 *     (FE writes {uid} docs — mirror keeps canonical current;
 *      autoPaper doc seeds the BE-read canonical copy)
 *   savant-trader/data/status/current          → st-config/status
 *     (BE-written singleton — doc id renames 'current' → 'status';
 *      canonical→legacy mirror keeps the FE-readable shadow current)
 *   savant-trader/data/symbol-lists/{docId}    → st-symbol-lists/{docId}
 *     (FE CRUD + BE bare-name NEW dual-write — mirror keeps canonical
 *      current)
 *
 * RUNBOOK — order matters: canonical must be populated before the deploy
 * makes BE reads (`stAutoPaperIngest` listMembers/loadConfig,
 * `getAgentStatus`) depend on it. A deploy-first order leaves
 * canonical empty and silently skips ingest scopes.
 *   1. `npx tsx scripts/migrate-config-lists-1008.ts --apply`
 *      (old code still reads legacy — the copy is free)
 *   2. `firebase deploy --only functions:...` (cutover + mirrors live)
 *   3. Re-run `--apply` for FE writes that landed during the deploy
 *      window — idempotent (divergent dests are skipped, not stomped)
 *   4. `npx tsx scripts/verify/data-pipeline-config-lists-1008.ts`
 *
 * Per source doc: write destination only when missing or identical to
 * source; a dest doc that exists and differs is SKIPPED
 * (`skippedDivergent`) — post-cutover canonical may hold fresher data
 * (mirror-arrived FE writes, the NEW-list dual-write) that a stale
 * legacy snapshot must not regress. `--force` opts into stomping. The
 * prefetch snapshot can't see concurrent writes — run outside live
 * windows (scheduled pass writes to symbol-lists/status) per the
 * runbook, same as every migration in this series.
 *
 * Not moved: savant-trader/data/{symbols,symbol-meta,runs,review-list,
 * occurrence-decisions} — own tasks (#1009/#1010/#1013/#1019 scope).
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-config-lists-1008.ts            # dry-run
 *   npx tsx scripts/migrate-config-lists-1008.ts --apply
 *   npx tsx scripts/migrate-config-lists-1008.ts --apply --family status
 *   npx tsx scripts/migrate-config-lists-1008.ts --apply --force
 *
 *   --apply    perform writes (default dry-run)
 *   --family   one family key: trading-config|status|symbol-lists
 *   --force    overwrite destination docs that exist and differ
 *              (default: skip + warn — never regress live canonical data)
 *
 * Requires Application Default Credentials.
 */
import { db } from '../src/firebase-admin-init';
import {
  AGENT_STATUS_DOC,
  ST_CONFIG_ROOT,
  ST_CONFIG_STATUS_DOC,
  ST_SYMBOL_LISTS_ROOT,
  ST_STATUS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_TRADING_CONFIG_COLLECTION,
} from '../src/common/st-collections';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';

const BATCH_LIMIT = 400;

/** {source collection} → {dest collection}, optional doc-id remap. */
const FAMILIES: Record<string, { source: string; dest: string; destDocId?: (id: string) => string }> = {
  'trading-config': { source: ST_TRADING_CONFIG_COLLECTION, dest: ST_CONFIG_ROOT },
  status:           { source: ST_STATUS_COLLECTION,         dest: ST_CONFIG_ROOT,
    // Only the known singleton remaps 'current'→'status'; a stray doc id
    // carries through rather than colliding on st-config/status.
    destDocId: (id) => (id === AGENT_STATUS_DOC ? ST_CONFIG_STATUS_DOC : id) },
  'symbol-lists':   { source: ST_SYMBOL_LISTS_COLLECTION,   dest: ST_SYMBOL_LISTS_ROOT },
};

interface Stats { copied: number; identical: number; skippedDivergent: number; failed: number }

async function migrateFamily(key: string, apply: boolean, force: boolean): Promise<Stats> {
  const { source, dest, destDocId } = FAMILIES[key];
  const mapId = destDocId ?? ((id: string) => id);
  const stats: Stats = { copied: 0, identical: 0, skippedDivergent: 0, failed: 0 };
  // One read per side — avoids a destRef.get() round-trip per source doc.
  const [srcSnap, destSnap] = await Promise.all([
    db.collection(source).get(),
    db.collection(dest).get(),
  ]);
  const destById = new Map(destSnap.docs.map((d) => [d.id, d.data()]));
  const destCol = db.collection(dest);
  console.log(`\n[${key}] ${source} → ${dest}: ${srcSnap.size} source docs (dest ${destSnap.size})`);

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending === 0) return;
    try {
      await batch.commit();
    } catch (e) {
      stats.copied -= pending;
      stats.failed += pending;
      console.warn(`  batch commit failed (${pending} docs): ${(e as Error).message}`);
    } finally {
      batch = db.batch();
      pending = 0;
    }
  };

  for (const doc of srcSnap.docs) {
    const data = doc.data();
    const targetId = mapId(doc.id);
    const existing = destById.get(targetId);
    if (existing !== undefined && deepEqual(existing, data)) {
      stats.identical++;
      continue;
    }
    if (existing !== undefined && !force) {
      stats.skippedDivergent++;
      console.warn(`  ${doc.id} → ${targetId}: dest exists and differs — skipped (use --force to overwrite)`);
      continue;
    }
    if (apply) {
      // Wholesale set, not merge — reaching here means dest is absent or
      // --force'd; merge would leave divergent dest-only fields behind
      // and the audit's deepEqual would still flag the doc.
      batch.set(destCol.doc(targetId), data);
      if (++pending >= BATCH_LIMIT) await flush();
    }
    stats.copied++;
  }
  await flush();
  console.log(
    `  ${apply ? 'copied' : 'would copy'} ${stats.copied}, identical ${stats.identical}` +
    `, skipped-divergent ${stats.skippedDivergent}, failed ${stats.failed}`,
  );
  return stats;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const famIdx = args.indexOf('--family');
  const family = famIdx >= 0 ? args[famIdx + 1] : undefined;
  if (famIdx >= 0 && (family === undefined || family.startsWith('--'))) {
    console.error('--family requires a value');
    process.exit(2);
  }
  if (family && !FAMILIES[family]) {
    console.error(`unknown --family '${family}'. keys: ${Object.keys(FAMILIES).join(', ')}`);
    process.exit(2);
  }
  console.log(`MODE: ${apply ? 'apply' : 'dry-run (pass --apply to write)'}${force ? ' + --force' : ''}`);
  const keys = family ? [family] : Object.keys(FAMILIES);
  const totals: Stats = { copied: 0, identical: 0, skippedDivergent: 0, failed: 0 };
  for (const k of keys) {
    const s = await migrateFamily(k, apply, force);
    totals.copied += s.copied; totals.identical += s.identical;
    totals.skippedDivergent += s.skippedDivergent; totals.failed += s.failed;
  }
  console.log(
    `\nTOTAL: copied ${totals.copied}, identical ${totals.identical}` +
    `, skipped-divergent ${totals.skippedDivergent}, failed ${totals.failed}`,
  );
  if (totals.failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
