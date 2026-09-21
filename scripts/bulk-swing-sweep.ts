/**
 * Bulk swing seed — one-time sweep (Thread #445).
 *
 * Reads tracked-symbols (or an explicit --symbols list), pulls daily bars
 * from symbol-data/{symbol}/daily/* year shards, computes ZigZag pivots /
 * swings / stats for the fixed 4-config set, and writes
 * st-swing-sets/{symbol}_{paramsId} docs stamped with the owner's uid.
 *
 * Usage:
 *   npx tsx scripts/bulk-swing-sweep.ts --limit 10          # first 10 tracked symbols
 *   npx tsx scripts/bulk-swing-sweep.ts                     # all tracked symbols
 *   npx tsx scripts/bulk-swing-sweep.ts --symbols aapl,msft # explicit list
 *   npx tsx scripts/bulk-swing-sweep.ts --dry-run           # compute only, no writes
 */
import { createRequire } from 'node:module';
import {
  computeZigZagPivots,
  deriveSwings,
  computeSwingStats,
} from '../src/app/features/shared/components/flex-chart/indicators/st-zigzag.engine';
import type {
  ZigZagConfig,
  PriceBar,
} from '../src/app/features/shared/components/flex-chart/indicators/st-zigzag.engine';
import { deriveParamsId } from '../src/app/features/savant-trader/swing-analysis/swing-analysis.types';
import { toDatePt } from '../src/app/features/savant-trader/utils/utils';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'rel-str';
const OWNER_EMAIL = 'rinebob111185@gmail.com';
const SYMBOL_DATA = 'symbol-data';
const SWING_SETS = 'st-swing-sets';

/** The fixed sweep set — dev/left/right triples, both toggles on. */
const CONFIGS: ZigZagConfig[] = [
  { devThreshold: 10, leftDepth: 10, rightDepth: 10, lineColor: '#673ab7' },
  { devThreshold: 5, leftDepth: 5, rightDepth: 5, lineColor: '#1976d2' },
  { devThreshold: 3, leftDepth: 3, rightDepth: 3, lineColor: '#388e3c' },
  { devThreshold: 2, leftDepth: 2, rightDepth: 2, lineColor: '#e65100' },
].map((c) => ({
  ...c,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  showTriggerDots: true,
}));

interface OhlcBarDoc {
  d: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function parseArgs(argv: string[]): { limit: number | null; symbols: string[] | null; dryRun: boolean } {
  const args = { limit: null as number | null, symbols: null as string[] | null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    else if (argv[i] === '--symbols')
      args.symbols = argv[++i].split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

/** tracked-symbols is empty — the app's universe is the callable's cache
 *  doc at app/trackedSymbolsCache.items[].symbol (supported only). */
async function trackedSymbols(db: FirebaseFirestore.Firestore): Promise<string[]> {
  const snap = await db.collection('app').doc('trackedSymbolsCache').get();
  const items = (snap.data()?.items ?? []) as { symbol?: string; supported?: boolean }[];
  const symbols = items
    .filter((it) => it.supported !== false)
    .map((it) => String(it.symbol || '').trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(symbols)].sort();
}

async function loadDailyBars(db: FirebaseFirestore.Firestore, symbol: string): Promise<PriceBar[]> {
  const shards = await db.collection(SYMBOL_DATA).doc(symbol).collection('daily').get();
  const all: OhlcBarDoc[] = [];
  for (const shard of shards.docs) {
    const bars = (shard.data() as { bars?: OhlcBarDoc[] }).bars ?? [];
    all.push(...bars);
  }
  all.sort((a, b) => a.d.localeCompare(b.d));
  return all.map((b) => ({
    date: b.d,
    x: toDatePt(b.d),
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
}

async function main(): Promise<void> {
  const { limit, symbols: explicit, dryRun } = parseArgs(process.argv.slice(2));

  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
  const db = admin.firestore();

  const user = await admin.auth().getUserByEmail(OWNER_EMAIL);
  const userId = user.uid;
  console.log(`owner uid: ${userId}`);

  let symbols = explicit ?? (await trackedSymbols(db));
  if (limit != null) symbols = symbols.slice(0, limit);
  console.log(`sweeping ${symbols.length} symbols x ${CONFIGS.length} configs${dryRun ? ' [DRY RUN]' : ''}`);

  const results: { symbol: string; ok: boolean; detail: string }[] = [];
  for (const symbol of symbols) {
    try {
      const bars = await loadDailyBars(db, symbol);
      if (bars.length === 0) throw new Error('no bars returned');

      const savedAt = new Date().toISOString();
      const writes: string[] = [];
      for (const config of CONFIGS) {
        const { pivots, projection } = computeZigZagPivots(bars, config);
        const swings = deriveSwings(pivots, bars, projection);
        const stats = swings.length > 0 ? computeSwingStats(swings) : null;
        if (!stats) continue; // config produced no swings — skip this doc
        const paramsId = deriveParamsId(config);
        const docId = `${symbol}_${paramsId}`;
        if (!dryRun) {
          await db.collection(SWING_SETS).doc(docId).set({
            symbol,
            paramsId,
            config,
            pivots,
            projection: projection ?? null,
            swings,
            stats,
            savedAt,
            userId,
          });
        }
        writes.push(paramsId);
      }
      if (writes.length === 0) throw new Error('no swings detected');
      results.push({ symbol, ok: true, detail: `${bars.length} bars, ${writes.length} sets` });
      console.log(`ok  ${symbol}  ${bars.length} bars -> ${writes.join(', ')}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ symbol, ok: false, detail: msg });
      console.log(`FAIL ${symbol}  ${msg}`);
    }
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} symbols succeeded`);
  for (const r of results.filter((r) => !r.ok)) console.log(`  FAIL ${r.symbol}: ${r.detail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
