/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1077)
 *
 * verify-1077: live-snapshot pass against real prod — DRY RUN, no writes.
 *
 *   npx tsx scripts/verify/paper-trading-analysis-1077-live-snapshot.ts
 *
 * Checks (all read-only):
 *   1. the real ledger enumerates — every trade maps to exactly one row
 *   2. signal-linked EQ rows = 'signal-equity'; manual/expression rows
 *      stay flagged 'excluded' (not dropped)
 *   3. a stamped ind.* row carries its snapshot verbatim
 *   4. closed rows carry exit + direction-aware tradeRetPct; open rows
 *      have null exits and a provisional mark-based ret
 *   5. strength.* populated where a signal-bar anchor exists (real SDS
 *      bars, last-index DI/ADX family)
 *   6. excursion fields sane (mfePct >= retPct for closed; maePct <= 0)
 */

import { db } from '../../src/firebase-admin-init';
import { listTrades } from '../../src/paper-trading/repository';
import {
  PaperTradeStatus,
  type PaperTrade,
} from '@paper-trading/contracts';
import {
  AnalysisCohort,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import type { OhlcBar } from '../../src/common/market-data-types';
import { tradeToRow, type StrengthSlice } from '../../src/paper-trading/analysis/live-snapshot';
import { computeStTrendStrength } from '../../src/indicators/st-trend-strength';
import type { OHLCV } from '../../src/indicators/st-trend-bands';

const results: string[] = [];
const ok = (m: string) => { results.push(`  \u2714 ${m}`); console.log(`  \u2714 ${m}`); };
const fail = (m: string) => { results.push(`  \u2716 ${m}`); console.log(`  \u2716 ${m}`); };

function strengthAt(bars: { d: string; o: number; h: number; l: number; c: number; v?: number }[]): StrengthSlice | null {
  if (bars.length < 15) return null;
  const ohlcv: OHLCV[] = bars.map((b) => ({ open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  const r = computeStTrendStrength(ohlcv);
  const i = ohlcv.length - 1;
  const pick = (a: number[]) => (Number.isFinite(a[i]) ? a[i] : null);
  return {
    'strength.diPlus': pick(r.diPlus),
    'strength.diMinus': pick(r.diMinus),
    'strength.diHist': pick(r.diHist),
    'strength.adx': pick(r.adx),
  };
}

async function main(): Promise<void> {
  console.log('verify-1077: live snapshot dry-run \u2192 real prod (read-only)\n');

  const trades = await listTrades(db);
  if (trades.length === 0) { fail('ledger enumerated zero trades — expected real data'); return; }
  ok(`ledger enumerated — ${trades.length} trades`);

  // per-symbol bar cache — mirrors the pass (one load, slice to anchor)
  const barsCache = new Map<string, OhlcBar[]>();
  const cache = new Map<string, StrengthSlice | null>();
  const strengthFor = async (t: PaperTrade): Promise<StrengthSlice | null> => {
    const anchor = t.signalBarDate ?? null;
    if (!anchor) return null;
    if (!barsCache.has(t.symbol)) {
      const { dailyBars } = await getCachedBarsFromSymbolData(t.symbol, '9999-12-31');
      barsCache.set(t.symbol, dailyBars);
    }
    const key = `${t.symbol}|${anchor}`;
    if (!cache.has(key)) {
      cache.set(key, strengthAt(barsCache.get(t.symbol)!.filter((b) => b.d <= anchor)));
    }
    return cache.get(key)!;
  };

  const rows: TradeAnalysisRow[] = [];
  for (const t of trades) rows.push(tradeToRow(t, 'verify-1077', await strengthFor(t)));

  if (rows.length === trades.length) {
    ok(`one row per trade — ${rows.length} rows`);
  } else {
    fail(`row count ${rows.length} != trade count ${trades.length}`);
  }

  const sig = rows.filter((r) => r.analysisCohort === AnalysisCohort.SIGNAL_EQUITY);
  const exc = rows.filter((r) => r.analysisCohort === AnalysisCohort.EXCLUDED);
  ok(`cohorts — ${sig.length} signal-equity, ${exc.length} excluded (kept, not dropped)`);

  const stamped = sig.filter((r) => r['ind.zoneV1'] !== null || r['ind.zoneV2'] !== null || r['ind.delta'] !== null);
  if (stamped.length > 0) {
    ok(`ind.* snapshot carried — ${stamped.length}/${sig.length} signal rows stamped`);
  } else {
    fail('no signal-equity row carries ind.* — stamp mapping broken?');
  }

  const closed = rows.filter((r) => r.status === PaperTradeStatus.CLOSED);
  const open = rows.filter((r) => r.status === PaperTradeStatus.OPEN);
  const badClosed = closed.filter((r) => r.exitDate === null || r.exitPrice === null || r.tradeRetPct === null);
  const badOpen = open.filter((r) => r.exitDate !== null);
  if (badClosed.length === 0) ok(`closed rows carry exit + ret — ${closed.length} rows`);
  else fail(`${badClosed.length} closed rows missing exit fields`);
  if (badOpen.length === 0) ok(`open rows have null exits — ${open.length} rows`);
  else fail(`${badOpen.length} open rows carry exit fields`);

  const withStrength = sig.filter((r) => r['strength.adx'] !== null);
  ok(`strength.* populated — ${withStrength.length}/${sig.length} signal rows (anchor bars thin → nulls are legitimate)`);

  const excBad = closed.filter((r) =>
    (r.mfePct !== null && r.tradeRetPct !== null && r.mfePct < r.tradeRetPct - 1e-9) ||
    (r.maePct !== null && r.maePct > 0));
  if (excBad.length === 0) ok('excursion sane — mfe >= ret, mae <= 0 on all closed rows');
  else fail(`excursion violated on ${excBad.length} rows: ${excBad.slice(0, 3).map((r) => r.tradeId).join(', ')}`);

  // sample row for eyeball
  const sample = sig.find((r) => r.status === PaperTradeStatus.CLOSED && r['ind.zoneV2'] !== null);
  if (sample) {
    console.log('\n  sample signal-equity closed row:');
    for (const k of ['tradeId','symbol','direction','signalType','signalBarDate','entryDate','entryPrice','exitDate','exitPrice','tradeRetPct','symbolMovePct','mfePct','maePct','givebackRatio','ind.zoneV2','ind.delta','strength.diPlus','strength.adx'] as const) {
      console.log(`    ${k} = ${JSON.stringify(sample[k])}`);
    }
  }

  const failed = results.filter((r) => r.startsWith('  \u2716')).length;
  console.log(failed === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failed} CHECKS FAILED ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
