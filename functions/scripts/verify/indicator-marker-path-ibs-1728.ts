/**
 * #1728 — BE Task: marker-path real-OHLC IBS partition verify script
 * (Thread #1665, Topic #261).
 *
 * Empirical check that the chart-marker path in `computeSymbolIndicatorSeries`
 * partitions zone candidates by real bar IBS — not the zero-filled stub the
 * pre-#1728 code used. For each version × timeframe (D/W) the script compares
 * the emitted marker set against the strategy path's emitted set computed on
 * the SAME bars, and asserts the partition invariants:
 *
 *   - emitted (index|signalType) sets == strategy-path emitted sets — the
 *     spec-pinned parity contract: chart dots show exactly the signals the
 *     strategy emits
 *   - suppressed ⊆ candidates \ emitted and every suppressed marker carries
 *     a FINITE ibs that violated its direction bound — a marker may only be
 *     suppressed by a real filter decision, never by a stub
 *   - emitted markers with a finite ibs satisfy their bound (undefined-ibs
 *     pass-through is legal; it can't be suppressed)
 *   - markers carry their bar's real ibs — NOT uniformly null/0.5, which is
 *     the signature the old zero-OHLC stub would leave
 *   - doc shape: dotMarkers.zoneV* = { emitted: [], suppressed: [] };
 *     signals.zoneV* index set == emitted index set
 *   - alignment: marker.d === bars[marker.index].d (index i addresses both)
 *
 * READ-ONLY: reads `symbol-data/{symbol}` via the production data loader;
 * no writes. Requires the usual ADC/Firestore env like other live scripts.
 *
 *   npx tsx scripts/verify/indicator-marker-path-ibs-1728.ts [--symbol=SPY] [--now=ISO-date]
 */

import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import { computeSymbolIndicatorSeries } from '../../src/st-cloud-function/indicator-computation';
import { computeStTrendBands } from '@st/trend-bands';
import { computeStZone } from '@st/zone';
import { computeStZoneV2 } from '@st/zone-v2';
import {
  detectAllStTrendRiderSignals,
  detectAllZoneZeroCrossSignals,
} from '../../src/st-cloud-function/strategies/signal-detection';
import type { OHLCV } from '@st/trend-bands';
import type { OhlcBar } from '../../src/common/market-data-types';
import type { IbsFilterContext } from '@st/signal-filter';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const eq = a.indexOf('=');
    return eq < 0 ? [a.slice(2), true] : [a.slice(2, eq), a.slice(eq + 1)];
  }),
);
const symbol = (args.symbol as string) || 'SPY';
const nowArg = args.now as string | undefined;
const ibsCtx: IbsFilterContext | undefined = nowArg ? { now: new Date(nowArg) } : undefined;

function barsToOhlcv(bars: OhlcBar[]): OHLCV[] {
  return bars.map(b => ({ open: b.o, high: b.h, low: b.l, close: b.c, date: b.d }));
}

async function main() {
  console.log(`#1728 marker-path IBS partition — ${symbol}${nowArg ? ` (now=${nowArg})` : ''}`);

  const { dailyBars, weeklyBars, monthlyBars } = await getCachedBarsFromSymbolData(symbol, '9999-12-31');
  console.log(`bars: ${dailyBars.length} D / ${weeklyBars.length} W / ${monthlyBars.length} M`);

  const res = computeSymbolIndicatorSeries(symbol, dailyBars, weeklyBars, monthlyBars, ibsCtx);

  const legs: { iv: 'daily' | 'weekly'; tf: 'D' | 'W'; bars: OhlcBar[] }[] = [
    { iv: 'daily', tf: 'D', bars: dailyBars },
    { iv: 'weekly', tf: 'W', bars: weeklyBars },
  ];

  console.log('\nversion | tf | emitted | suppressed | suppressed%');
  console.log('--------|----|---------|------------|-------------');

  for (const { iv, tf, bars } of legs) {
    const interval = res.intervals[iv];
    const ohlcv = barsToOhlcv(bars);
    // Recompute zones the way the strategy path does, for the parity check.
    const bandOut = computeStTrendBands(ohlcv);

    for (const version of ['V1', 'V2'] as const) {
      const key = version === 'V1' ? 'zoneV1' : 'zoneV2';
      const set = interval?.dotMarkers?.[key];
      const emitted = set?.emitted ?? [];
      const suppressed = set?.suppressed ?? [];
      const total = emitted.length + suppressed.length;
      const pct = total === 0 ? 'n/a' : ((suppressed.length / total) * 100).toFixed(1) + '%';
      console.log(`${version}    | ${tf}  | ${String(emitted.length).padStart(7)} | ${String(suppressed.length).padStart(10)} | ${pct}`);

      // ── Shape ──
      check(`${iv}.${key} dotMarkers is {emitted, suppressed} arrays`,
        !!set && Array.isArray(set.emitted) && Array.isArray(set.suppressed));

      // signals.zoneV* = the emitted set (suppressed are never "signals")
      const sigIdx = (interval?.signals?.[key] ?? []).map(s => s.index).sort((a, b) => a - b);
      const emitIdx = emitted.map(m => m.index).sort((a, b) => a - b);
      check(`${iv}.${key} signals index set == emitted index set`,
        JSON.stringify(sigIdx) === JSON.stringify(emitIdx), `signals=${JSON.stringify(sigIdx)} emitted=${JSON.stringify(emitIdx)}`);

      // ── Parity: emitted == strategy-path emitted on the same bars ──
      const zones = (version === 'V1' ? computeStZone(ohlcv, bandOut) : computeStZoneV2(ohlcv, bandOut)).zone;
      const zoneNums = zones.map(z => (Number.isFinite(z) ? z : NaN));
      const strat = [
        ...detectAllStTrendRiderSignals(zoneNums, zoneNums, ohlcv, version, tf, ibsCtx ?? {}),
        ...detectAllZoneZeroCrossSignals(zoneNums, ohlcv, version, tf, ibsCtx ?? {}),
      ].map(s => `${s.index}|${s.signalType}`).sort();
      const mine = emitted.map(m => `${m.index}|${m.signalType}`).sort();
      check(`${iv}.${key} emitted == strategy-path emitted`, JSON.stringify(mine) === JSON.stringify(strat),
        `marker=${JSON.stringify(mine)} strategy=${JSON.stringify(strat)}`);

      // ── Partition invariants ──
      check(`${iv}.${key} every suppressed marker has a finite ibs violating its bound`,
        suppressed.every(m => typeof m.ibs === 'number' &&
          (m.direction === 'long' ? m.ibs < 0.5 : m.ibs > 0.5 + Number.EPSILON)));

      check(`${iv}.${key} emitted markers with finite ibs satisfy their bound`,
        emitted.every(m => m.ibs == null || typeof m.ibs !== 'number' ||
          (m.direction === 'long' ? m.ibs >= 0.5 : m.ibs <= 0.5 + Number.EPSILON)));

      // ── Real-OHLC signature: ibs is not the stub's uniform null/0.5 ──
      const ibsVals = emitted.map(m => m.ibs).filter((v): v is number => typeof v === 'number');
      const distinct = new Set(ibsVals.map(v => v.toFixed(4)));
      check(`${iv}.${key} emitted markers carry real ibs (not the zero-stub uniform 0.5/null)`,
        emitted.length === 0 || distinct.size > 1 || (ibsVals.length > 0 && [...distinct][0] !== '0.5000'),
        `${emitted.length} emitted, distinct ibs: ${[...distinct].join(',') || 'none'}`);

      // ── Alignment: marker.d === bars[marker.index].d ──
      check(`${iv}.${key} marker.d === bars[marker.index].d`,
        [...emitted, ...suppressed].every(m => bars[m.index]?.d === m.d));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('verify failed:', err); process.exit(1); });
