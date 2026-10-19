/**
 * One-shot copy migration: legacy collection roots → canonical st- roots
 * (task #1007, IMPL-BE Phase 6).
 *
 * Families:
 *   paper-trading/{accounts,trades,stats,raw-quotes}/items/{id}
 *     → st-paper-trading/{anchor}/items/{id}     (BE-only consumers — cutover,
 *                                               no soak mirror)
 *   portfolio/{buckets,attributions}/items/{id}
 *     → st-portfolio/{anchor}/items/{id}         (FE writes legacy — mirror
 *                                               keeps canonical current)
 *   backtest-runs/{id} / backtest-permutations/{id}
 *     → st-backtest-runs/{id} / st-backtest-permutations/{id}
 *                                               (FE reads legacy — mirror
 *                                               keeps legacy current)
 *
 * RUNBOOK — deploy order matters:
 *   1. `firebase deploy --only functions` (cutover + mirrors go live —
 *      legacy freezes for the cutover families, mirrors cover the rest)
 *   2. `npx tsx scripts/migrate-collection-renames-1007.ts --apply`
 *   3. `npx tsx scripts/verify/data-pipeline-collection-renames-1007.ts`
 *      — a `src-only` FAIL means re-run step 2 for that family.
 *
 * Per source doc: write destination with set(merge) only when the dest
 * is missing or identical-check fails AND the dest doesn't already hold
 * diverging live data. A dest doc that exists and differs is SKIPPED
 * (`skippedDivergent`) — post-deploy, canonical may be ahead of the
 * frozen legacy copy, and overwriting it would regress live fields
 * (marks, fills, stats). `--force` opts into stomping if a deliberate
 * re-copy is ever needed. The prefetch snapshot can't see concurrent
 * writes — run outside live windows (noon fill pass, nightly settlement)
 * per the runbook, same as every migration in this series.
 *
 * Not moved: paper-trading/{instances,cohorts,analysis-*} — instances
 * bridges until #1014, cohorts drain to st-position-groups (#1004),
 * analysis-* keeps its own rename task.
 *
 * Usage (from functions/):
 *   npx tsx scripts/migrate-collection-renames-1007.ts            # dry-run
 *   npx tsx scripts/migrate-collection-renames-1007.ts --apply
 *   npx tsx scripts/migrate-collection-renames-1007.ts --apply --family trades
 *   npx tsx scripts/migrate-collection-renames-1007.ts --apply --force   # overwrite differing dests
 *
 *   --apply    perform writes (default dry-run)
 *   --family   one family key: accounts|trades|stats|raw-quotes|
 *              buckets|attributions|backtest-runs|backtest-permutations
 *   --force    overwrite destination docs that exist and differ
 *              (default: skip + warn — never regress live canonical data)
 *
 * Requires Application Default Credentials.
 */
import { db } from '../src/firebase-admin-init';
import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_PORTFOLIO_ANCHORS,
  StPortfolioKind,
  stPaperTradingItemsPath,
  stPortfolioItemsPath,
} from '../src/common/st-collections';
import {
  PaperTradingKind,
  paperTradingItemsPath,
} from '@paper-trading/ids';
import {
  LEGACY_BACKTEST_PERMUTATIONS_ROOT,
  LEGACY_BACKTEST_RUNS_ROOT,
} from '../src/st-cloud-function/backtest/backtest-mirror';
import { LEGACY_PORTFOLIO_ROOT } from '../src/portfolio/portfolio-mirror';
import { deepEqual } from '../src/order-tickets/legacy-order-intents';

const BATCH_LIMIT = 400;

/** Legacy anchored-items path for a portfolio kind — anchors share names
 *  across the rename (`buckets` → `buckets`), only the root changes. */
const legacyPortfolioItemsPath = (kind: StPortfolioKind) =>
  `${LEGACY_PORTFOLIO_ROOT}/${ST_PORTFOLIO_ANCHORS[kind]}/items`;

/** {source items collection} → {destination items collection}. */
const FAMILIES: Record<string, { source: string; dest: string }> = {
  accounts:                { source: paperTradingItemsPath(PaperTradingKind.ACCOUNT),    dest: stPaperTradingItemsPath(PaperTradingKind.ACCOUNT) },
  trades:                  { source: paperTradingItemsPath(PaperTradingKind.TRADE),      dest: stPaperTradingItemsPath(PaperTradingKind.TRADE) },
  stats:                   { source: paperTradingItemsPath(PaperTradingKind.STATS),      dest: stPaperTradingItemsPath(PaperTradingKind.STATS) },
  'raw-quotes':            { source: paperTradingItemsPath(PaperTradingKind.RAW_QUOTE),  dest: stPaperTradingItemsPath(PaperTradingKind.RAW_QUOTE) },
  buckets:                 { source: legacyPortfolioItemsPath(StPortfolioKind.BUCKET),       dest: stPortfolioItemsPath(StPortfolioKind.BUCKET) },
  attributions:            { source: legacyPortfolioItemsPath(StPortfolioKind.ATTRIBUTION),  dest: stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION) },
  'backtest-runs':         { source: LEGACY_BACKTEST_RUNS_ROOT,                          dest: ST_BACKTEST_RUNS_ROOT },
  'backtest-permutations': { source: LEGACY_BACKTEST_PERMUTATIONS_ROOT,                  dest: ST_BACKTEST_PERMUTATIONS_ROOT },
};

interface Stats { copied: number; identical: number; skippedDivergent: number; failed: number }

async function migrateFamily(key: string, apply: boolean, force: boolean): Promise<Stats> {
  const { source, dest } = FAMILIES[key];
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
      // A failed commit loses up to `pending` writes — move them out of
      // `copied` into `failed` so the summary can't double-count.
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
    const existing = destById.get(doc.id);
    if (existing !== undefined && deepEqual(existing, data)) {
      stats.identical++;
      continue;
    }
    if (existing !== undefined && !force) {
      stats.skippedDivergent++;
      console.warn(`  ${doc.id}: dest exists and differs — skipped (use --force to overwrite)`);
      continue;
    }
    if (apply) {
      batch.set(destCol.doc(doc.id), data, { merge: true });
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
