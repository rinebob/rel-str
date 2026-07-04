/**
 * Zone Signal Backtest + Filter Evaluator
 *
 * Reads rs-bars from Firestore, replays the ST-Zone strategy across full
 * history for every symbol, and measures forward-return quality with and
 * without candidate filters.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/backtest-zone-filters.ts
 *
 * Optional env vars:
 *   LIMIT          - max symbols to process (default: all)
 *   FORWARD_BARS   - bars to look ahead for outcome (default: 10)
 *   MIN_BARS       - min daily bars required (default: 100)
 *   SIGNAL_TYPE    - D_V1 | D_V2 | W_V1 | W_V2 | ALL (default: ALL)
 *   PROJECT        - Firebase project ID (default: rel-str)
 */

import 'dotenv/config';
import type { OhlcBar } from '../src/rh-agent-cloud-function/rh-agent-types';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { computeStTrendBands, computeStZone, computeStZoneV2, computeStTrendStrength } from '../src/indicators/index';
import type { OHLCV } from '../src/indicators/index';

// ============================================================================
// Config
// ============================================================================

const LIMIT        = process.env.LIMIT        ? parseInt(process.env.LIMIT,        10) : 0;
const FORWARD_BARS = process.env.FORWARD_BARS ? parseInt(process.env.FORWARD_BARS, 10) : 10;
const MIN_BARS     = process.env.MIN_BARS     ? parseInt(process.env.MIN_BARS,     10) : 100;
const SIGNAL_TYPE  = (process.env.SIGNAL_TYPE || 'ALL').toUpperCase();

// ============================================================================
// Firestore bootstrap
// ============================================================================

const PROJECT_ID = process.env.PROJECT || 'rel-str';
if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// ============================================================================
// Shared types
// ============================================================================

interface RsBarsDoc {
  symbol: string;
  daily: OhlcBar[];
  weekly: OhlcBar[];
  monthly: OhlcBar[];
}

interface Signal {
  symbol:    string;
  barIndex:  number;
  barDate:   string;
  direction: 'LONG' | 'SHORT';
  signalKey: string; // e.g. D_V1, D_V2, W_V1, W_V2
  // Indicator snapshot at signal bar
  zoneValue:       number;
  prevZone:        number;
  htfZone:         number;
  htfAlignment:    'with-trend' | 'counter-trend' | 'neutral'; // htfZone agrees / opposes / is zero
  adx:             number;
  diHist:          number;
  zoneRunLength:   number; // bars prevZone was held before this transition (depth of pullback)
}

interface Outcome {
  signal:     Signal;
  fwdReturn:  number;   // % return at FORWARD_BARS bars
  isWin:      boolean;  // long: fwdReturn > 0 / short: fwdReturn < 0
}

// ============================================================================
// Helpers
// ============================================================================

function toOhlcv(bars: OhlcBar[]): OHLCV[] {
  return bars.map(b => ({
    open: b.o, high: b.h, low: b.l, close: b.c,
    volume: b.v ?? 0,
    date: b.d,
  }));
}

/**
 * Map HTF zone (weekly/monthly) values to LTF bar indices.
 * Returns the last HTF zone value for each LTF bar, aligned by date string.
 */
function buildHtfZoneMap(ltfBars: OHLCV[], htfZone: number[], htfBars: OHLCV[]): number[] {
  const result = new Array<number>(ltfBars.length).fill(0);

  // Build date → zone lookup for HTF bars
  const htfMap = new Map<string, number>();
  for (let i = 0; i < htfBars.length; i++) {
    const d = (htfBars[i] as any).date ?? '';
    if (d) htfMap.set(d, htfZone[i]);
  }

  // For each LTF bar, find the most recent HTF date on or before it
  let lastHtf = 0;
  for (let i = 0; i < ltfBars.length; i++) {
    const d = (ltfBars[i] as any).date ?? '';
    if (htfMap.has(d)) lastHtf = htfMap.get(d)!;
    result[i] = lastHtf;
  }
  return result;
}

// ============================================================================
// Signal extraction (full history scan)
// ============================================================================

interface SignalExtractionInput {
  symbol:    string;
  ltfOhlcv:  OHLCV[];
  htfOhlcv:  OHLCV[];
  ltfZone:   number[];
  htfZone:   number[];
  adxSeries: number[];
  diHistSeries: number[];
  signalKey: string;   // D_V1, D_V2, W_V1, W_V2
}

function htfAlignmentTag(direction: 'LONG' | 'SHORT', htfZone: number): Signal['htfAlignment'] {
  if (htfZone === 0) return 'neutral';
  if (direction === 'LONG')  return htfZone > 0 ? 'with-trend' : 'counter-trend';
  return htfZone < 0 ? 'with-trend' : 'counter-trend';
}

function extractAllSignals(inp: SignalExtractionInput): Signal[] {
  const { symbol, ltfOhlcv, htfZone, ltfZone, adxSeries, diHistSeries, signalKey } = inp;
  const signals: Signal[] = [];
  const htfMapped = buildHtfZoneMap(ltfOhlcv, htfZone, inp.htfOhlcv);

  // Skip leading zeros (warm-up period)
  let start = 0;
  while (start < ltfZone.length && ltfZone[start] === 0) start++;
  if (start >= ltfZone.length - 1) return signals;

  // State machines — fire once per run, reset on reversal
  let longState:  'READY' | 'FIRED' = 'READY';
  let shortState: 'READY' | 'FIRED' = 'READY';

  // Track how many consecutive bars the zone has been at the current value
  // Used to compute zoneRunLength at signal time
  let runStart = start; // index where the current zone run started

  for (let i = start + 1; i < ltfZone.length; i++) {
    const prevZone = ltfZone[i - 1];
    const currZone = ltfZone[i];
    const delta    = currZone - prevZone;
    const htfNow   = htfMapped[i];
    const adx      = adxSeries[i] ?? 0;
    const diHist   = diHistSeries[i] ?? 0;
    const barDate  = (ltfOhlcv[i] as any).date ?? '';

    // Track run length: how many bars was prevZone held before this bar
    if (i > start + 1 && ltfZone[i - 1] !== ltfZone[i - 2]) {
      runStart = i - 1; // zone changed on previous bar — new run started there
    }
    const zoneRunLength = i - runStart; // bars prevZone was held (including the signal bar itself)

    // --- LONG: any zone uptick ---
    if (delta > 0) {
      if (longState === 'READY') {
        signals.push({
          symbol, barIndex: i, barDate,
          direction: 'LONG', signalKey,
          zoneValue: currZone, prevZone,
          htfZone: htfNow,
          htfAlignment: htfAlignmentTag('LONG', htfNow),
          adx, diHist, zoneRunLength,
        });
        longState = 'FIRED';
      }
      shortState = 'READY'; // any up move resets short state
    } else if (delta < 0) {
      // --- SHORT: any zone downtick ---
      if (shortState === 'READY') {
        signals.push({
          symbol, barIndex: i, barDate,
          direction: 'SHORT', signalKey,
          zoneValue: currZone, prevZone,
          htfZone: htfNow,
          htfAlignment: htfAlignmentTag('SHORT', htfNow),
          adx, diHist, zoneRunLength,
        });
        shortState = 'FIRED';
      }
      longState = 'READY'; // any down move resets long state
    }
    // delta === 0: no change, states unchanged
  }
  return signals;
}

// ============================================================================
// Filter definitions
// ============================================================================

type FilterFn = (s: Signal) => boolean;

const fromOppSide = (s: Signal) =>
  (s.direction === 'LONG'  && s.prevZone < 0) ||
  (s.direction === 'SHORT' && s.prevZone > 0);

const FILTERS: Record<string, FilterFn> = {
  // ---- Baseline ----
  'No filter (all signals)':          () => true,
  'With-trend only (current system)': s => s.htfAlignment === 'with-trend',
  'Counter-trend only':               s => s.htfAlignment === 'counter-trend',

  // ---- With-trend sub-filters ----
  'With-trend + Zone depth':          s => s.htfAlignment === 'with-trend' && fromOppSide(s),
  'With-trend + HTF >= ±2':           s => s.htfAlignment === 'with-trend' && Math.abs(s.htfZone) >= 2,
  'With-trend + HTF >= ±2 + Z.depth': s => s.htfAlignment === 'with-trend' && Math.abs(s.htfZone) >= 2 && fromOppSide(s),

  // ---- Counter-trend sub-filters ----
  // Counter-trend needs tighter confirmation since HTF is against you
  'Counter-trend + Zone depth':       s => s.htfAlignment === 'counter-trend' && fromOppSide(s),
  'Counter-trend + run >= 3':         s => s.htfAlignment === 'counter-trend' && s.zoneRunLength >= 3,
  'Counter-trend + run >= 5':         s => s.htfAlignment === 'counter-trend' && s.zoneRunLength >= 5,
  'Counter-trend + Z.depth + run>=3': s => s.htfAlignment === 'counter-trend' && fromOppSide(s) && s.zoneRunLength >= 3,
  'Counter-trend + diHist confirms':  s => s.htfAlignment === 'counter-trend' &&
    ((s.direction === 'LONG' && s.diHist > 0) || (s.direction === 'SHORT' && s.diHist < 0)),

  // ---- Combined: keep both, filter each side optimally ----
  'Best combo (WT:HTF>=2+depth, CT:run>=3)': s =>
    (s.htfAlignment === 'with-trend'     && Math.abs(s.htfZone) >= 2 && fromOppSide(s)) ||
    (s.htfAlignment === 'counter-trend'  && s.zoneRunLength >= 3),
  'Best combo (WT:HTF>=2+depth, CT:run>=5)': s =>
    (s.htfAlignment === 'with-trend'     && Math.abs(s.htfZone) >= 2 && fromOppSide(s)) ||
    (s.htfAlignment === 'counter-trend'  && s.zoneRunLength >= 5),
};

// ============================================================================
// Metrics aggregation
// ============================================================================

interface FilterMetrics {
  signalCount:  number;
  winCount:     number;
  winRate:      number;
  avgFwdReturn: number;
  avgWinReturn: number;
  avgLossReturn: number;
  expectancy:   number;  // winRate * avgWin + (1-winRate) * avgLoss
  retentionPct: number;  // % of original signals kept
}

function computeMetrics(outcomes: Outcome[], totalOriginal: number): FilterMetrics {
  if (outcomes.length === 0) {
    return { signalCount: 0, winCount: 0, winRate: 0, avgFwdReturn: 0,
             avgWinReturn: 0, avgLossReturn: 0, expectancy: 0, retentionPct: 0 };
  }
  const wins   = outcomes.filter(o => o.isWin);
  const losses = outcomes.filter(o => !o.isWin);
  const winRate = wins.length / outcomes.length;
  const avgFwdReturn  = outcomes.reduce((s, o) => s + o.fwdReturn, 0) / outcomes.length;
  const avgWinReturn  = wins.length   > 0 ? wins.reduce(  (s, o) => s + Math.abs(o.fwdReturn), 0) / wins.length   : 0;
  const avgLossReturn = losses.length > 0 ? losses.reduce((s, o) => s + Math.abs(o.fwdReturn), 0) / losses.length : 0;
  const expectancy = winRate * avgWinReturn - (1 - winRate) * avgLossReturn;
  return {
    signalCount:   outcomes.length,
    winCount:      wins.length,
    winRate,
    avgFwdReturn,
    avgWinReturn,
    avgLossReturn,
    expectancy,
    retentionPct: (outcomes.length / totalOriginal) * 100,
  };
}

// ============================================================================
// Per-symbol processing
// ============================================================================

function processSymbol(doc: RsBarsDoc): { signals: Signal[]; outcomes: Outcome[] } {
  const { symbol, daily, weekly, monthly } = doc;

  if (!daily || daily.length < MIN_BARS) return { signals: [], outcomes: [] };

  const dailyOhlcv   = toOhlcv(daily);
  const weeklyOhlcv  = weekly?.length ? toOhlcv(weekly)  : [];
  const monthlyOhlcv = monthly?.length ? toOhlcv(monthly) : [];

  // Compute bands once for each timeframe
  const dailyBands   = computeStTrendBands(dailyOhlcv);
  const weeklyBands  = weeklyOhlcv.length  ? computeStTrendBands(weeklyOhlcv)  : null;
  const monthlyBands = monthlyOhlcv.length ? computeStTrendBands(monthlyOhlcv) : null;

  // Compute zones
  const dailyZoneV1  = computeStZone(dailyOhlcv,   dailyBands).zone;
  const dailyZoneV2  = computeStZoneV2(dailyOhlcv, dailyBands).zone;
  const weeklyZoneV2 = weeklyBands  ? computeStZoneV2(weeklyOhlcv,  weeklyBands).zone  : [];
  const weeklyZoneV1 = weeklyBands  ? computeStZone(weeklyOhlcv,    weeklyBands).zone  : [];
  const monthlyZoneV2 = monthlyBands ? computeStZoneV2(monthlyOhlcv, monthlyBands).zone : [];

  // Compute trend strength for ADX + diHist
  const dailyStrength  = computeStTrendStrength(dailyOhlcv);
  const weeklyStrength = weeklyOhlcv.length ? computeStTrendStrength(weeklyOhlcv) : null;

  const allSignals: Signal[] = [];

  // Daily V1 signals (HTF = weekly V2)
  if ((SIGNAL_TYPE === 'ALL' || SIGNAL_TYPE === 'D_V1') && weeklyZoneV2.length > 0) {
    allSignals.push(...extractAllSignals({
      symbol,
      ltfOhlcv: dailyOhlcv,
      htfOhlcv: weeklyOhlcv,
      ltfZone: dailyZoneV1,
      htfZone: weeklyZoneV2,
      adxSeries: dailyStrength.adx,
      diHistSeries: dailyStrength.diHist,
      signalKey: 'D_V1',
    }));
  }

  // Daily V2 signals (HTF = weekly V2)
  if ((SIGNAL_TYPE === 'ALL' || SIGNAL_TYPE === 'D_V2') && weeklyZoneV2.length > 0) {
    allSignals.push(...extractAllSignals({
      symbol,
      ltfOhlcv: dailyOhlcv,
      htfOhlcv: weeklyOhlcv,
      ltfZone: dailyZoneV2,
      htfZone: weeklyZoneV2,
      adxSeries: dailyStrength.adx,
      diHistSeries: dailyStrength.diHist,
      signalKey: 'D_V2',
    }));
  }

  // Weekly V1 signals (HTF = monthly V2)
  if ((SIGNAL_TYPE === 'ALL' || SIGNAL_TYPE === 'W_V1') && weeklyStrength && weeklyZoneV1.length > 0 && monthlyZoneV2.length > 0) {
    allSignals.push(...extractAllSignals({
      symbol,
      ltfOhlcv: weeklyOhlcv,
      htfOhlcv: monthlyOhlcv,
      ltfZone: weeklyZoneV1,
      htfZone: monthlyZoneV2,
      adxSeries: weeklyStrength.adx,
      diHistSeries: weeklyStrength.diHist,
      signalKey: 'W_V1',
    }));
  }

  // Weekly V2 signals (HTF = monthly V2)
  if ((SIGNAL_TYPE === 'ALL' || SIGNAL_TYPE === 'W_V2') && weeklyStrength && weeklyZoneV2.length > 0 && monthlyZoneV2.length > 0) {
    allSignals.push(...extractAllSignals({
      symbol,
      ltfOhlcv: weeklyOhlcv,
      htfOhlcv: monthlyOhlcv,
      ltfZone: weeklyZoneV2,
      htfZone: monthlyZoneV2,
      adxSeries: weeklyStrength.adx,
      diHistSeries: weeklyStrength.diHist,
      signalKey: 'W_V2',
    }));
  }

  // Measure forward returns for each signal (use corresponding ltf bars)
  const outcomes = allSignals.map(sig => {
    const bars = sig.signalKey.startsWith('D') ? daily : weekly;
    const entry  = bars[sig.barIndex];
    const exitIdx = Math.min(sig.barIndex + FORWARD_BARS, bars.length - 1);
    const exit    = bars[exitIdx];
    const fwdReturn = ((exit.c - entry.c) / entry.c) * 100;
    const isWin = sig.direction === 'LONG' ? fwdReturn > 0 : fwdReturn < 0;
    return { signal: sig, fwdReturn, isWin };
  });

  return { signals: allSignals, outcomes };
}

// ============================================================================
// Print results table
// ============================================================================

function printTable(title: string, rows: Record<string, FilterMetrics>): void {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(100));
  const header = [
    'Filter'.padEnd(45),
    'Signals'.padStart(8),
    'Wins'.padStart(7),
    'WinRate'.padStart(9),
    'AvgRet%'.padStart(9),
    'AvgWin%'.padStart(9),
    'AvgLoss%'.padStart(10),
    'Expectancy'.padStart(12),
    'Retained%'.padStart(11),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(100));

  for (const [name, m] of Object.entries(rows)) {
    const row = [
      name.padEnd(45),
      String(m.signalCount).padStart(8),
      String(m.winCount).padStart(7),
      `${(m.winRate * 100).toFixed(1)}%`.padStart(9),
      `${m.avgFwdReturn.toFixed(2)}%`.padStart(9),
      `${m.avgWinReturn.toFixed(2)}%`.padStart(9),
      `${m.avgLossReturn.toFixed(2)}%`.padStart(10),
      `${m.expectancy.toFixed(2)}%`.padStart(12),
      `${m.retentionPct.toFixed(1)}%`.padStart(11),
    ].join(' ');
    console.log(row);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log(`\nZone Signal Backtest`);
  console.log(`Forward bars: ${FORWARD_BARS} | Min bars: ${MIN_BARS} | Signal type: ${SIGNAL_TYPE}`);
  console.log(`Loading rs-bars from Firestore...`);

  // Fetch all rs-bars docs
  let query = db.collection('rs-bars') as FirebaseFirestore.Query;
  if (LIMIT > 0) query = query.limit(LIMIT);
  const snap = await query.get();
  console.log(`Loaded ${snap.size} symbol docs.`);

  const allOutcomes: Outcome[] = [];
  let processedCount = 0;
  let skippedCount   = 0;

  // Per-signal-key buckets for breakdown
  const outcomesByKey: Record<string, Outcome[]> = {};
  const signalKeys = ['D_V1', 'D_V2', 'W_V1', 'W_V2'];
  for (const k of signalKeys) outcomesByKey[k] = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as RsBarsDoc;
    if (!data.symbol) continue;

    try {
      const { outcomes } = processSymbol(data);
      if (outcomes.length === 0) { skippedCount++; continue; }
      allOutcomes.push(...outcomes);
      for (const o of outcomes) {
        outcomesByKey[o.signal.signalKey]?.push(o);
      }
      processedCount++;
    } catch (err: any) {
      // Skip silently — indicator warm-up can cause rare edge cases
      skippedCount++;
    }
  }

  console.log(`Processed: ${processedCount} symbols | Skipped (< ${MIN_BARS} bars or error): ${skippedCount}`);
  console.log(`Total raw signals: ${allOutcomes.length}`);

  if (allOutcomes.length === 0) {
    console.log('\nNo signals found. Check MIN_BARS, LIMIT, and Firestore data.');
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Overall results across all signal types
  // -------------------------------------------------------------------------
  const originalCount = allOutcomes.length;
  const overallRows: Record<string, FilterMetrics> = {};
  for (const [name, fn] of Object.entries(FILTERS)) {
    const filtered = allOutcomes.filter(o => fn(o.signal));
    overallRows[name] = computeMetrics(filtered, originalCount);
  }
  printTable(`ALL SIGNALS — ${FORWARD_BARS}-bar forward return (${processedCount} symbols)`, overallRows);

  // -------------------------------------------------------------------------
  // Per signal key breakdown
  // -------------------------------------------------------------------------
  for (const k of signalKeys) {
    const bucket = outcomesByKey[k];
    if (bucket.length === 0) continue;

    const bucketRows: Record<string, FilterMetrics> = {};
    for (const [name, fn] of Object.entries(FILTERS)) {
      const filtered = bucket.filter(o => fn(o.signal));
      bucketRows[name] = computeMetrics(filtered, bucket.length);
    }
    printTable(`${k} SIGNALS (${bucket.length} total, ${FORWARD_BARS}-bar forward)`, bucketRows);
  }

  // -------------------------------------------------------------------------
  // Direction breakdown (LONG vs SHORT)
  // -------------------------------------------------------------------------
  for (const dir of ['LONG', 'SHORT'] as const) {
    const bucket = allOutcomes.filter(o => o.signal.direction === dir);
    if (bucket.length === 0) continue;

    const bucketRows: Record<string, FilterMetrics> = {};
    for (const [name, fn] of Object.entries(FILTERS)) {
      const filtered = bucket.filter(o => fn(o.signal));
      bucketRows[name] = computeMetrics(filtered, bucket.length);
    }
    printTable(`${dir} SIGNALS (${bucket.length} total, ${FORWARD_BARS}-bar forward)`, bucketRows);
  }

  // -------------------------------------------------------------------------
  // Counter-trend signal summary (the missed opportunities)
  // -------------------------------------------------------------------------
  const ctLongs  = allOutcomes.filter(o => o.signal.direction === 'LONG'  && o.signal.htfAlignment === 'counter-trend');
  const ctShorts = allOutcomes.filter(o => o.signal.direction === 'SHORT' && o.signal.htfAlignment === 'counter-trend');
  if (ctLongs.length > 0 || ctShorts.length > 0) {
    console.log(`\n${'='.repeat(100)}`);
    console.log('  COUNTER-TREND SIGNAL QUALITY (excluded by current system)');
    console.log('='.repeat(100));
    console.log(`  Counter-trend LONG  (${ctLongs.length} signals):  win rate ${ctLongs.length ? ((ctLongs.filter(o=>o.isWin).length/ctLongs.length)*100).toFixed(1) : 'n/a'}%  avg return ${ctLongs.length ? (ctLongs.reduce((s,o)=>s+o.fwdReturn,0)/ctLongs.length).toFixed(2) : 'n/a'}%`);
    console.log(`  Counter-trend SHORT (${ctShorts.length} signals): win rate ${ctShorts.length ? ((ctShorts.filter(o=>o.isWin).length/ctShorts.length)*100).toFixed(1) : 'n/a'}%  avg return ${ctShorts.length ? (ctShorts.reduce((s,o)=>s+o.fwdReturn,0)/ctShorts.length).toFixed(2) : 'n/a'}%`);
  }

  // -------------------------------------------------------------------------
  // Worst false positives — with-trend longs that lost > 5%
  // -------------------------------------------------------------------------
  const badLongs = allOutcomes
    .filter(o => o.signal.direction === 'LONG' && o.signal.htfAlignment === 'with-trend' && o.fwdReturn < -5)
    .sort((a, b) => a.fwdReturn - b.fwdReturn)
    .slice(0, 10);

  if (badLongs.length > 0) {
    console.log(`\n${'='.repeat(100)}`);
    console.log('  WORST WITH-TREND LONG FALSE POSITIVES (lost > 5%)');
    console.log('='.repeat(100));
    console.log('Symbol     Date        Key   Align         prev→cur  HTFzone  ADX    diHist  Run  FwdRet%');
    console.log('-'.repeat(100));
    for (const o of badLongs) {
      const s = o.signal;
      console.log(
        `${s.symbol.padEnd(10)} ${s.barDate.padEnd(12)} ${s.signalKey.padEnd(6)}` +
        ` ${s.htfAlignment.padEnd(14)}` +
        ` ${String(s.prevZone).padStart(3)}→${String(s.zoneValue).padEnd(4)}` +
        ` ${String(s.htfZone).padStart(8)}  ${s.adx.toFixed(1).padStart(6)}` +
        ` ${s.diHist.toFixed(1).padStart(7)}` +
        ` ${String(s.zoneRunLength).padStart(4)}` +
        ` ${o.fwdReturn.toFixed(2).padStart(8)}%`
      );
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
