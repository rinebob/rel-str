/**
 * #1678 — BE Task: IBS filter verify script (Thread #1665, Topic #261).
 *
 * Empirical check on the IBS filter (#1677) against a real symbol's stored
 * bars — the same `symbol-data` docs the production run loads. For each
 * version × timeframe the script computes zones with the production path
 * (computeStTrendBands → computeStZone / computeStZoneV2) and runs
 * `detectAllStTrendRiderSignals` twice — unfiltered (param omitted) and
 * gated (default `{}` or `--threshold=T`) — then prints candidates /
 * emitted / suppressed / suppression % and asserts the invariants:
 *
 *   - emitted signals satisfy their bound — LONG → ibs ≥ T, SHORT →
 *     ibs ≤ 1−T — with a FINITE ibs required on every signal whose index
 *     is not the last (developing) bar; ibs may only be null when the
 *     bar is too young for availability (computeIbs → undefined)
 *   - every suppressed candidate carried a finite ibs that violated its
 *     bound (filter never removes a passing/null-ibs candidate)
 *   - recorded indicators.ibs equals an independent computeIbs recompute
 *     on the signal's own bar (no record-vs-decide drift)
 *   - emitted ⊆ candidates (the filter only removes; never invents)
 *   - `indicators.ibs` recorded (number|null) on every emitted signal
 *
 * The PRD's rough estimate was ~10–25% of signals suppressed — the table
 * prints the actual per-cell rate for judgment (informational, not gated).
 *
 * `now` defaults to the wall clock — like production — so the developing
 * last bar's IBS availability varies by run time (pre-12:00 ET daily,
 * Mon–Tue weekly). `--now=ISO` pins it for deterministic runs.
 *
 * READ-ONLY: reads `symbol-data/{symbol}` via the production data loader;
 * no writes. Requires the usual ADC/Firestore env like other live scripts.
 *
 *   npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts [--symbol=SPY] [--threshold=0.5] [--now=2026-11-21T18:00:00Z]
 */

import { getCachedBarsFromSymbolData } from '../../src/st-cloud-function/data-loader';
import { computeStTrendBands } from '@st/trend-bands';
import { computeStZone } from '@st/zone';
import { computeStZoneV2 } from '@st/zone-v2';
import { computeIbs } from '@st/ibs';
import {
  detectAllStTrendRiderSignals,
  type IbsFilterContext,
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
let warnings = 0;
function warn(name: string, detail = '') {
  warnings++;
  console.log(`WARN ${name}${detail ? ` — ${detail}` : ''}`);
}
function usage(msg: string): never {
  console.error(`ERROR ${msg}`);
  console.error('usage: npx tsx scripts/verify/ibs-trend-rider-filter-1678.ts [--symbol=SPY] [--threshold=0.5] [--now=ISO-date]');
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
const THRESHOLD = args.threshold !== undefined ? Number(args.threshold) : undefined;
if (THRESHOLD !== undefined && (!Number.isFinite(THRESHOLD) || THRESHOLD < 0 || THRESHOLD > 1)) {
  usage(`--threshold must be a number in [0,1] (got '${args.threshold}')`);
}
const NOW = args.now !== undefined ? new Date(String(args.now)) : undefined;
if (args.now !== undefined && Number.isNaN(NOW!.getTime())) usage(`--now must be a parseable date (got '${args.now}')`);
const filter: IbsFilterContext = {
  ...(THRESHOLD !== undefined ? { threshold: THRESHOLD } : {}),
  ...(NOW !== undefined ? { now: NOW } : {}),
};
const T = THRESHOLD ?? 0.5;

// Mirrors st-trend-rider.strategy.ts normalizeBars (raw OhlcBar → OHLCV),
// including the ?? 0 / ?? '' fallbacks for malformed stored bars.
type NormBar = OHLCV & { date: string };
function normalizeBars(bars: OhlcBar[]): NormBar[] {
  return bars.map(b => ({
    open: b.o ?? 0, high: b.h ?? 0, low: b.l ?? 0, close: b.c ?? 0,
    volume: b.v ?? 0, date: b.d ?? '',
  }));
}

function ibsOf(signal: ZoneSignal): number | null {
  const v = signal.indicators.ibs;
  return typeof v === 'number' ? v : null;
}

function satisfiesBound(s: ZoneSignal, ibs: number): boolean {
  // Exact prod semantics — signal-detection.ts: LONG emits iff ibs >= T;
  // SHORT emits iff ibs <= 1−T + Number.EPSILON.
  return s.action === StSignalDirection.LONG
    ? ibs >= T
    : ibs <= 1 - T + Number.EPSILON;
}

async function main() {
  console.log(`— loading ${SYMBOL} via getCachedBarsFromSymbolData (all stored bars) —`);
  const { dailyBars, weeklyBars } = await getCachedBarsFromSymbolData(SYMBOL, '9999-12-31');
  check(`daily bars loaded (${dailyBars.length})`, dailyBars.length >= MIN_BARS, `${dailyBars.length}`);
  if (weeklyBars.length < MIN_BARS) warn(`weekly bars thin (${weeklyBars.length} < ${MIN_BARS}) — W cells will skip like prod`);

  console.log(`\n— suppression table (T=${T}${NOW ? `, now=${NOW.toISOString()}` : ', now=wall clock'}) —`);
  console.log(`${'cell'.padEnd(8)}${'candidates'.padStart(11)}${'emitted'.padStart(9)}${'suppressed'.padStart(12)}${'suppr%'.padStart(8)}`);
  let anyEmitted = false;
  let totalSuppressed = 0;

  for (const [tf, raw] of [['D', dailyBars], ['W', weeklyBars]] as const) {
    if (raw.length < MIN_BARS) {
      console.log(`${tf}         (skipped — ${raw.length} bars < ${MIN_BARS})`);
      continue;
    }
    const ohlcv = normalizeBars(raw);
    const lastIdx = ohlcv.length - 1;
    const bands = computeStTrendBands(ohlcv);
    for (const version of ['V1', 'V2'] as const) {
      const zone = (version === 'V1' ? computeStZone(ohlcv, bands) : computeStZoneV2(ohlcv, bands)).zone;
      const candidates = detectAllStTrendRiderSignals(zone, zone, ohlcv, version, tf);
      const emitted = detectAllStTrendRiderSignals(zone, zone, ohlcv, version, tf, filter);
      const emittedKeys = new Set(emitted.map(e => `${e.index}|${e.signalType}`));
      const suppressedList = candidates.filter(c => !emittedKeys.has(`${c.index}|${c.signalType}`));
      const suppressed = suppressedList.length;
      totalSuppressed += suppressed;
      const pct = candidates.length ? (100 * suppressed / candidates.length).toFixed(1) : '0.0';
      console.log(`${`${tf}-${version}`.padEnd(8)}${String(candidates.length).padStart(11)}${String(emitted.length).padStart(9)}${String(suppressed).padStart(12)}${`${pct}%`.padStart(8)}`);
      if (emitted.length) anyEmitted = true;

      check(
        `${tf}-${version}: every emitted LONG satisfies ibs ≥ ${T} (finite unless last bar)`,
        emitted.filter(s => s.action === StSignalDirection.LONG)
          .every(s => {
            const v = ibsOf(s);
            return v === null ? s.index === lastIdx : satisfiesBound(s, v);
          }),
      );
      check(
        `${tf}-${version}: every emitted SHORT satisfies ibs ≤ ${(1 - T).toFixed(4)} (finite unless last bar)`,
        emitted.filter(s => s.action === StSignalDirection.SHORT)
          .every(s => {
            const v = ibsOf(s);
            return v === null ? s.index === lastIdx : satisfiesBound(s, v);
          }),
      );
      check(
        `${tf}-${version}: every suppressed candidate had finite ibs violating its bound`,
        suppressedList.every(c => {
          const v = ibsOf(c);
          return v !== null && !satisfiesBound(c, v);
        }),
      );
      check(
        `${tf}-${version}: recorded ibs matches independent computeIbs on the signal's bar`,
        emitted.every(e => {
          const bar = ohlcv[e.index as number];
          return bar !== undefined && ibsOf(e) === (computeIbs(bar, tf, filter) ?? null);
        }),
      );
      check(
        `${tf}-${version}: indicators.ibs recorded (number|null) on emitted signals`,
        emitted.every(s => 'ibs' in s.indicators && (s.indicators.ibs === null || typeof s.indicators.ibs === 'number')),
      );
      check(
        `${tf}-${version}: emitted ⊆ candidates (filter only removes)`,
        emitted.every(e => candidates.some(c => c.index === e.index && c.signalType === e.signalType)),
      );
    }
  }

  check('at least one emitted signal across cells', anyEmitted);
  if (totalSuppressed === 0) warn('filter suppressed nothing across cells — suppression % is 0; confirm the filter engaged');
  console.log(`\n=== ${passed} passed, ${failed} failed${warnings ? `, ${warnings} warnings` : ''} ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(e => { console.error(e); process.exit(1); });
