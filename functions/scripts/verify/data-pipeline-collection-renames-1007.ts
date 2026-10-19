/**
 * Read-only parity audit for #1007 — collection renames to canonical
 * st- roots. Checks every family's source docs exist at the destination
 * and destination content matches, with soak-direction-aware severity:
 *
 *   paper-trading/{accounts,trades,stats,raw-quotes} → st-paper-trading
 *     Cutover — legacy is frozen after migration, canonical keeps being
 *     written (marks, fills, stats recomputes). Invariant: canonical is
 *     never behind legacy.
 *     FAIL: legacy-only doc, or divergence where canonical is NOT newer
 *           (legacy ≥ canonical timestamp, or untimestamped = stale
 *           canonical — a real copy miss or regression).
 *     WARN: divergence where dest.updatedAt > src.updatedAt (expected
 *           post-cutover write); canonical-only doc (post-cutover create).
 *
 *   portfolio/{buckets,attributions} → st-portfolio  (legacy→canon mirror)
 *     FE still writes legacy; the mirror copies asynchronously.
 *     WARN: legacy-only doc or divergence — mirror lag, expected in soak.
 *     WARN: canonical-only doc (FE can't write canonical — flag anyway).
 *
 *   st-backtest-{runs,permutations} → backtest-*  (canon→legacy mirror)
 *     BE writes canonical; the mirror merge-shadows to legacy for FE
 *     readers. Legacy docs may carry FE-owned fields the canonical side
 *     lacks (archived/qualityDesignation/updatedAt — see firestore.rules)
 *     — those are stripped before comparison.
 *     WARN: canonical-only doc or remaining divergence — mirror lag.
 *     FAIL: legacy-only doc — nothing writes legacy directly, so a
 *           legacy-only doc means the copy migration missed it.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-collection-renames-1007.ts
 *   npx tsx scripts/verify/data-pipeline-collection-renames-1007.ts --family trades
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_PORTFOLIO_ANCHORS,
  StPortfolioKind,
  stPaperTradingItemsPath,
  stPortfolioItemsPath,
} from '../../src/common/st-collections';
import {
  PaperTradingKind,
  paperTradingItemsPath,
} from '@paper-trading/ids';
import {
  LEGACY_BACKTEST_PERMUTATIONS_ROOT,
  LEGACY_BACKTEST_RUNS_ROOT,
} from '../../src/st-cloud-function/backtest/backtest-mirror';
import { LEGACY_PORTFOLIO_ROOT } from '../../src/portfolio/portfolio-mirror';
import { deepEqual } from '../../src/order-tickets/legacy-order-intents';

type Direction = 'cutover' | 'legacy-to-canon' | 'canon-to-legacy';

const legacyPortfolioItemsPath = (kind: StPortfolioKind) =>
  `${LEGACY_PORTFOLIO_ROOT}/${ST_PORTFOLIO_ANCHORS[kind]}/items`;

/** Fields FE may write on legacy backtest-runs (firestore.rules) — the
 *  merge-mirror preserves them; canonical never carries them. Stripped
 *  before comparison. */
const BACKTEST_FE_OWNED = new Set(['archived', 'qualityDesignation', 'updatedAt']);

const FAMILIES: Record<string, { source: string; dest: string; dir: Direction; feOwned?: boolean }> = {
  accounts:                { source: paperTradingItemsPath(PaperTradingKind.ACCOUNT),    dest: stPaperTradingItemsPath(PaperTradingKind.ACCOUNT),    dir: 'cutover' },
  trades:                  { source: paperTradingItemsPath(PaperTradingKind.TRADE),      dest: stPaperTradingItemsPath(PaperTradingKind.TRADE),      dir: 'cutover' },
  stats:                   { source: paperTradingItemsPath(PaperTradingKind.STATS),      dest: stPaperTradingItemsPath(PaperTradingKind.STATS),      dir: 'cutover' },
  'raw-quotes':            { source: paperTradingItemsPath(PaperTradingKind.RAW_QUOTE),  dest: stPaperTradingItemsPath(PaperTradingKind.RAW_QUOTE),  dir: 'cutover' },
  buckets:                 { source: legacyPortfolioItemsPath(StPortfolioKind.BUCKET),       dest: stPortfolioItemsPath(StPortfolioKind.BUCKET),       dir: 'legacy-to-canon' },
  attributions:            { source: legacyPortfolioItemsPath(StPortfolioKind.ATTRIBUTION),  dest: stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION),  dir: 'legacy-to-canon' },
  'backtest-runs':         { source: LEGACY_BACKTEST_RUNS_ROOT,                          dest: ST_BACKTEST_RUNS_ROOT,                        dir: 'canon-to-legacy', feOwned: true },
  'backtest-permutations': { source: LEGACY_BACKTEST_PERMUTATIONS_ROOT,                  dest: ST_BACKTEST_PERMUTATIONS_ROOT,                  dir: 'canon-to-legacy' },
};

const fails: string[] = [];
const warns: string[] = [];

function isoTs(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function stripOwned(d: Record<string, unknown>): Record<string, unknown> {
  const out = { ...d };
  for (const k of BACKTEST_FE_OWNED) delete out[k];
  return out;
}

async function auditFamily(key: string, f: { source: string; dest: string; dir: Direction; feOwned?: boolean }): Promise<void> {
  const [srcSnap, dstSnap] = await Promise.all([
    db.collection(f.source).get(),
    db.collection(f.dest).get(),
  ]);
  const srcById = new Map(srcSnap.docs.map((d) => [d.id, d.data()]));
  const dstById = new Map(dstSnap.docs.map((d) => [d.id, d.data()]));

  let srcOnly = 0, dstOnly = 0, diverged = 0;
  for (const [id, data] of srcById) {
    const dst = dstById.get(id);
    if (!dst) {
      srcOnly++;
      // legacy→canon: missing dest is mirror lag → WARN.
      // cutover / canon→legacy: the destination collection should hold a
      // counterpart (frozen legacy was fully copied; nothing writes
      // legacy directly) → FAIL.
      (f.dir === 'legacy-to-canon' ? warns : fails).push(
        `${key}/${id}: source-only doc (no canonical counterpart)`,
      );
    } else {
      // Strip symmetrically — `updatedAt` is dual-owned (BE mirror
      // re-stamps it, FE may write it per the rules carve-out), so a
      // one-sided strip would key-mismatch every doc into WARN noise.
      // `archived`/`qualityDesignation` only ever live on legacy —
      // stripping both sides is equivalent there too.
      const srcData = f.feOwned ? stripOwned(data) : data;
      const dstData = f.feOwned ? stripOwned(dst) : dst;
      if (!deepEqual(dstData, srcData)) {
        diverged++;
        if (f.dir === 'cutover') {
          // Canonical newer = the expected post-cutover write. Anything
          // else means canonical fell behind the frozen legacy copy.
          const srcTs = isoTs(data.updatedAt);
          const dstTs = isoTs(dst.updatedAt);
          if (dstTs !== undefined && (srcTs === undefined || dstTs > srcTs)) {
            warns.push(`${key}/${id}: canonical newer than frozen legacy (post-cutover write — expected)`);
          } else {
            fails.push(`${key}/${id}: diverged and canonical not newer (src.updatedAt=${srcTs ?? '?'} dest.updatedAt=${dstTs ?? '?'}) — stale canonical`);
          }
        } else {
          warns.push(`${key}/${id}: content divergence (soak drift or in-flight write)`);
        }
      }
    }
  }
  for (const id of dstById.keys()) {
    if (!srcById.has(id)) {
      dstOnly++;
      warns.push(`${key}/${id}: dest-only doc (post-${f.dir === 'cutover' ? 'cutover' : 'migration'} write or drift)`);
    }
  }
  console.log(
    `  ${key}: src ${srcSnap.size} → dest ${dstSnap.size} | src-only ${srcOnly}, dest-only ${dstOnly}, diverged ${diverged}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
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
  console.log('#1007 collection-rename parity audit\n');
  for (const [k, f] of Object.entries(FAMILIES)) {
    if (!family || family === k) await auditFamily(k, f);
  }
  console.log('\n— audit —');
  for (const s of fails) console.log(`  ✖ ${s}`);
  for (const s of warns) console.log(`  ⚠ ${s}`);
  console.log(`\n${fails.length} FAIL, ${warns.length} WARN`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
