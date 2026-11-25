/**
 * #1727 — SHARED Task: shared signal-engine verify script (Thread #1665, Topic #261).
 *
 * Empirical check that the hoisted shared engine (`shared/st-signal-detect.ts`
 * + `shared/st-signal-filter.ts`) produces identical emitted/suppressed sets
 * through BOTH emit paths on a real symbol's stored bars:
 *
 *   Path A — BE emitter: `detectAllStTrendRiderSignals` /
 *            `detectAllZoneZeroCrossSignals` (signal-detection.ts), the
 *            wrappers the strategy + indicator-computation paths call.
 *   Path B — raw detector + partition: `detectZoneUptickCandidates` /
 *            `detectZoneZeroCrossCandidates` → `partitionByIbs` — exactly
 *            what the FE emitter (st-trend-rider-dots.indicator.ts) does.
 *
 * Asserts per version × timeframe × family (uptick | zero-cross):
 *   - emitted (index|direction) sets are identical A vs B — the BE wrapper
 *     is a pure emit-mapper over the same partition, not a second engine
 *   - emitted ∪ suppressed == candidates (partition completeness)
 *   - emitted ∩ suppressed == ∅
 *   - suppressed ⊆ candidates \ emitted — the filter only removes
 *   - raw candidates carry no `ibs` before the partition runs (the
 *     detector is filter-agnostic — the field is attached by
 *     partitionByIbs, never set inside detect)
 *   - both paths' emitted signals agree on index/direction AND ibs
 *     attachment (the ZoneSignal record carries indicators.ibs that
 *     equals the partitioned candidate's ibs — no emit-time drift)
 *
 * READ-ONLY: reads `symbol-data/{symbol}` via the production data loader;
 * no writes. Requires the usual ADC/Firestore env like other live scripts.
 *
 *   npx tsx scripts/verify/indicator-lib-shared-engine-1727.ts [--symbol=SPY] [--now=ISO-date]
 */

import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import { computeStTrendBands } from '@st/trend-bands';
import { computeStZone } from '@st/zone';
import { computeStZoneV2 } from '@st/zone-v2';
import {
  detectZoneUptickCandidates,
  detectZoneZeroCrossCandidates,
  type ZoneSignalCandidate,
} from '@st/signal-detect';
import { partitionByIbs, type IbsFilterContext } from '@st/signal-filter';
import {
  detectAllStTrendRiderSignals,
  detectAllZoneZeroCrossSignals,
  type ZoneSignal,
} from '../../src/st-cloud-function/strategies/signal-detection';
import type { OHLCV } from '@st/trend-bands';
import type { OhlcBar } from '../../src/common/market-data-types';
import { StSignalDirection } from '../../src/st-cloud-function/signals';

// Mirrors st-trend-rider.strategy.ts metadata.minBarsRequired.
const MIN_BARS = 45;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

function usage(msg: string): never {
  console.error(`ERROR ${msg}`);
  console.error('usage: npx tsx scripts/verify/indicator-lib-shared-engine-1727.ts [--symbol=SPY] [--now=ISO-date]');
  process.exit(2);
}

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=');
    return [k, v ?? true];
  }),
);
const SYMBOL = String(args.symbol ?? 'SPY').toUpperCase();
if (!/^[A-Z0-9.\-]{1,12}$/.test(SYMBOL)) usage(`--symbol must be a ticker (got '${args.symbol}')`);
const NOW = args.now !== undefined ? new Date(String(args.now)) : undefined;
if (args.now !== undefined && Number.isNaN(NOW!.getTime())) usage(`--now must be a parseable date (got '${args.now}')`);
const filter: IbsFilterContext = { ...(NOW !== undefined ? { now: NOW } : {}) };

// Mirrors st-trend-rider.strategy.ts normalizeBars (raw OhlcBar → OHLCV),
// including the ?? 0 / ?? '' fallbacks for malformed stored bars.
type NormBar = OHLCV & { date: string };
function normalizeBars(bars: OhlcBar[]): NormBar[] {
  return bars.map(b => ({
    open: b.o ?? 0, high: b.h ?? 0, low: b.l ?? 0, close: b.c ?? 0,
    volume: b.v ?? 0, date: b.d ?? '',
  }));
}

const key = (c: { index: number; direction: string }) => `${c.index}|${c.direction}`;
const setOf = (cs: ReadonlyArray<{ index: number; direction: string }>) => new Set(cs.map(key));
const eqSet = <T>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every(x => b.has(x));
const dirOf = (s: ZoneSignal) => (s.action === StSignalDirection.LONG ? 'long' : 'short');
// `ZoneSignal.index` is optional (detectLastBarSignals strips it for the
// last-bar record) — detectAll* leaves it on, and a missing index is itself
// a parity defect worth failing on rather than masking.
const idxOf = (s: ZoneSignal) => s.index ?? -1;

function verifyFamily(
  label: string,
  candidates: ZoneSignalCandidate[],
  beEmitted: ZoneSignal[],
  bars: NormBar[],
  tf: 'D' | 'W',
) {
  const part = partitionByIbs(candidates, bars, tf, filter);
  const beSet = setOf(beEmitted.map(s => ({ index: idxOf(s), direction: dirOf(s) })));
  const partEmitted = setOf(part.emitted);
  const partSuppressed = setOf(part.suppressed);
  const candSet = setOf(candidates);

  check(`${label}: emitted sets identical (BE emitter ≡ detector+partition)`, eqSet(beSet, partEmitted),
    `be=${[...beSet].join(',')} part=${[...partEmitted].join(',')}`);
  check(`${label}: emitted ∪ suppressed == candidates`,
    eqSet(new Set([...partEmitted, ...partSuppressed]), candSet),
    `|e|=${partEmitted.size} |s|=${partSuppressed.size} |c|=${candSet.size}`);
  check(`${label}: emitted ∩ suppressed == ∅`,
    [...partEmitted].every(k => !partSuppressed.has(k)));
  check(`${label}: raw candidates carry no ibs (detector filter-agnostic)`,
    candidates.every(c => (c as { ibs?: unknown }).ibs === undefined));
  // Emit-time drift: the record's indicators.ibs matches the partition's.
  const partByKey = new Map(part.emitted.map(c => [key(c), c.ibs]));
  check(`${label}: emitted record ibs == partition ibs`,
    beEmitted.every(s => partByKey.get(key({ index: idxOf(s), direction: dirOf(s) })) === s.indicators.ibs));
  console.log(`     ${label}: candidates=${candidates.length} emitted=${part.emitted.length} suppressed=${part.suppressed.length}`);
}

async function main() {
  console.log(`— loading ${SYMBOL} via getCachedBarsFromSymbolData (all stored bars) —`);
  const { dailyBars, weeklyBars } = await getCachedBarsFromSymbolData(SYMBOL, '9999-12-31');
  check(`daily bars loaded (${dailyBars.length})`, dailyBars.length >= MIN_BARS, `${dailyBars.length}`);

  for (const [tf, raw] of [['D', dailyBars], ['W', weeklyBars]] as const) {
    if (raw.length < MIN_BARS) {
      console.log(`(skipping ${tf} — ${raw.length} bars < ${MIN_BARS})`);
      continue;
    }
    const ohlcv = normalizeBars(raw);
    const bands = computeStTrendBands(ohlcv);
    for (const version of ['V1', 'V2'] as const) {
      const zone = (version === 'V1' ? computeStZone(ohlcv, bands) : computeStZoneV2(ohlcv, bands)).zone;
      const label = `${tf}/${version}`;

      verifyFamily(
        `${label} uptick`,
        detectZoneUptickCandidates(zone, zone, version, tf),
        detectAllStTrendRiderSignals(zone, zone, ohlcv, version, tf, filter),
        ohlcv, tf,
      );
      verifyFamily(
        `${label} zero-cross`,
        detectZoneZeroCrossCandidates(zone, version, tf),
        detectAllZoneZeroCrossSignals(zone, ohlcv, version, tf, filter),
        ohlcv, tf,
      );
    }
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
