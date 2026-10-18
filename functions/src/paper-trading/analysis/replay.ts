/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1078)
 *
 * Replay pass — the 'replay' branch of `analysisDatasetTask` (IMPL §3).
 * For each symbol in scope: SDS daily bars → computeStTrendBands →
 * computeStZone / computeStZoneV2 → detectAllStTrendRiderSignals (the
 * real detector — never a reimplementation) → filter to the run params
 * → walk each signal forward on daily closes under the exit-registry
 * grammar via `evaluateVariant` → one `TradeAnalysisRow` per signal →
 * `writeDataset`.
 *
 * Row semantics:
 * - Lifecycle is **modeled**, not ledger-observed: entry at the signal
 *   bar's close (`entryConvention 'signal-bar-close'` — the only
 *   registered convention), exit at the daily close where the variant
 *   fires. Trades that never trigger stay OPEN with a provisional
 *   return vs the last considered close.
 * - `analysisCohort` is `signal-equity` — replayed rows ARE the modeled
 *   signal cohort; there is no excluded cohort on this path.
 * - `ind.*` carries the detector's own `indicators` map (zone values,
 *   windowV2, delta) — the same shape production stamps on ledger trades.
 * - `strength.*` is `computeStTrendStrength` picked at the signal index
 *   (indicators are causal — index-i values depend only on bars <= i).
 * - Excursion walks intraday extremes (mfe off highs, mae off lows),
 *   direction-aware; `excursionSource: 'replay'`.
 * - `barRange` bounds the data considered: bars > `to` never enter
 *   detection or the walk; signals before `from` are dropped after
 *   detection (full prior history still feeds indicator warmup).
 * - `entryFilters` is provenance-only — validated and carried, not applied.
 *
 * Deps are injected: `listSymbols`/`loadDailyBars`/`detectSignals`/
 * `evaluateExit`/`writeDataset` so specs run hermetic and the
 * registry/detector seams are provable; the task handler wires the
 * real functions.
 */

import { logger } from 'firebase-functions/v2';

import { PaperTradeStatus, type PaperTrade, type VariantRun } from '@paper-trading/contracts';
import { TradeSide } from '@common';
import { EQUITY_TRADE_DESC } from '@paper-trading/ids';
import {
  AnalysisCohort,
  type AnalysisRunParams,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { computeStTrendBands, type OHLCV } from '../../indicators/st-trend-bands';
import { computeStZone } from '../../indicators/st-zone';
import { computeStZoneV2 } from '../../indicators/st-zone-v2';
import { computeStTrendStrength } from '../../indicators/st-trend-strength';
import {
  detectAllStTrendRiderSignals,
  type ZoneSignal,
} from '../../st-cloud-function/strategies/signal-detection';
import {
  evaluateVariant,
  type VariantEvalCtx,
  type VariantEvalResult,
} from '../exits/registry';
import type { OhlcBar } from '../../common/market-data-types';
import { getCachedBarsFromSymbolData } from '../../st-cloud-function/data-loader';
import { db } from '../../firebase-admin-init';
import { datasetWriterDeps, writeDataset } from './dataset-writer';
import { getStorage } from 'firebase-admin/storage';
import type { StrengthSlice } from './live-snapshot';

export interface ReplayDeps {
  /** Symbols to scan when `params.symbolScope` is empty (SDS universe). */
  listSymbols(): Promise<string[]>;
  /** Daily bars for `symbol` — full history; empty/missing → skip symbol. */
  loadDailyBars(symbol: string): Promise<OhlcBar[]>;
  /** The real detector — injected so specs can spy on the seam. */
  detectSignals(
    ltfZone: number[],
    windowV2: number[],
    ltfBars: OHLCV[],
    version: 'V1' | 'V2',
    timeframe: 'D' | 'W',
  ): ZoneSignal[];
  /** The exit-registry evaluator — injected for the same seam proof. */
  evaluateExit(ctx: VariantEvalCtx): VariantEvalResult;
  writeDataset(rows: TradeAnalysisRow[], datasetId: string): Promise<void>;
}

const DAY_MS = 86_400_000;
const calDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 'V2L' | 'V1S' — the synthetic-id tag from a Trend Rider signal type. */
const sideTag = (signalType: string): string =>
  signalType.replace('D_ST_TREND_RIDER_', '')
    .replace('_LONG', 'L')
    .replace('_SHORT', 'S');

/**
 * Walk one detected signal forward on daily closes under the run's exit
 * grammar and build the modeled analysis row. `bars` is already sliced to
 * `d <= params.barRange.to` by the pass — a trade that never triggers
 * stays OPEN with a provisional return vs the last considered close.
 */
export function replaySignalToRow(
  sig: ZoneSignal,
  symbol: string,
  bars: OhlcBar[],
  strength: StrengthSlice | null,
  params: AnalysisRunParams,
  datasetId: string,
  evaluateExit: (ctx: VariantEvalCtx) => VariantEvalResult = evaluateVariant,
): TradeAnalysisRow {
  const i0 = sig.index ?? 0;
  const signalBarDate = bars[i0].d;
  const isShort = sig.signalType.endsWith('_SHORT');
  const sign: 1 | -1 = isShort ? -1 : 1;
  const entryPrice = bars[i0].c;

  // Minimal trade/run shells — evaluateVariant reads fills[entry].price,
  // order.side, and mutates run.workingState (water mark ratchet).
  const trade = {
    fills: [{ role: 'entry', date: signalBarDate, price: entryPrice }],
    order: { side: isShort ? TradeSide.SHORT : TradeSide.LONG },
  } as unknown as PaperTrade;
  const run: VariantRun = {
    variantKey: params.exitRule,
    governing: true,
    state: 'ACTIVE',
    workingState: {},
  };

  let exit: { d: string; px: number } | null = null;
  // Seed on the first walk bar — a trade that never exceeds entry records
  // a negative mfePct, matching the live path's marks convention (the
  // least-bad observation), rather than flooring at 0.
  let mfeFrac: number | null = null;
  let maeFrac: number | null = null;
  let mfeDate: string | null = null;
  let maeDate: string | null = null;
  for (let i = i0 + 1; i < bars.length; i++) {
    const b = bars[i];
    // Excursion from intraday extremes — favorable off h (long) / l
    // (short), adverse off l / h. The exit bar's extremes count (same as
    // the live path including the exit-day mark).
    const fav = (isShort ? entryPrice - b.l : b.h - entryPrice) / entryPrice;
    const adv = (isShort ? entryPrice - b.h : b.l - entryPrice) / entryPrice;
    if (mfeFrac === null || fav > mfeFrac) { mfeFrac = fav; mfeDate = b.d; }
    if (maeFrac === null || adv < maeFrac) { maeFrac = adv; maeDate = b.d; }

    const res = evaluateExit({
      trade,
      mark: b.c,
      underlyingClose: b.c,
      date: b.d,
      daysHeld: calDays(signalBarDate, b.d),
      run,
    });
    if (res.workingState) Object.assign(run.workingState, res.workingState);
    if (res.trigger) {
      exit = { d: b.d, px: b.c };
      break;
    }
  }

  const obsPrice = exit?.px ?? bars[bars.length - 1].c;
  const retPct = sign * ((obsPrice - entryPrice) / entryPrice) * 100;
  const symPct = ((obsPrice - entryPrice) / entryPrice) * 100;
  const mfePct = mfeDate !== null ? mfeFrac! * 100 : null;
  const maePct = maeDate !== null ? maeFrac! * 100 : null;
  const ind = sig.indicators ?? {};

  return {
    datasetId,
    tradeId: `replay-${symbol}-${signalBarDate.replaceAll('-', '')}-${sideTag(sig.signalType)}`,
    signalId: null,
    signalType: sig.signalType,
    cohortId: null,
    positionGroupId: null,
    symbol,
    direction: isShort ? TradeSide.SHORT : TradeSide.LONG,
    expression: EQUITY_TRADE_DESC,
    captureList: null,
    sector: null,
    industry: null,
    capTier: null,
    source: 'replay',
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: exit ? PaperTradeStatus.CLOSED : PaperTradeStatus.OPEN,
    signalStatus: null,

    signalBarDate,
    entryDate: signalBarDate,
    entryPrice,
    exitDate: exit?.d ?? null,
    exitPrice: exit?.px ?? null,
    qty: null,
    daysHeld: exit ? calDays(signalBarDate, exit.d) : null,
    exitReason: exit ? params.exitRule : null,

    tradeRetPct: retPct,
    symbolMovePct: symPct,
    realizedPnl: null,
    capitalRequired: null,

    mfePct,
    maePct,
    mfeDate,
    maeDate,
    daysToMfe: mfeDate ? calDays(signalBarDate, mfeDate) : null,
    givebackRatio:
      exit && mfePct !== null && mfePct > 0
        ? (mfePct - retPct) / mfePct
        : null,
    excursionSource: 'replay',

    'ind.delta': num(ind['delta']),
    'ind.windowV2': num(ind['windowV2']),
    'ind.zoneV1': num(ind['zoneV1']),
    'ind.zoneV1Prev': num(ind['zoneV1Prev']),
    'ind.zoneV2': num(ind['zoneV2']),
    'ind.zoneV2Prev': num(ind['zoneV2Prev']),

    ...(strength ?? {
      'strength.diPlus': null,
      'strength.diMinus': null,
      'strength.diHist': null,
      'strength.adx': null,
    }),
  };
}

/**
 * Run the replay pass: per symbol, detect on `d <= barRange.to` bars
 * (full prior history feeds indicator warmup), keep signals with
 * `signalBarDate >= barRange.from` ∩ `signalTypes`, walk each under
 * `params.exitRule`, write once at end. Throws propagate — the task
 * handler owns the failed-transition for pre-writer errors.
 */
export async function runReplay(
  params: AnalysisRunParams,
  datasetId: string,
  deps: ReplayDeps,
): Promise<number> {
  const symbols = params.symbolScope.length
    ? params.symbolScope
    : await deps.listSymbols();
  const types = new Set(params.signalTypes);
  const rows: TradeAnalysisRow[] = [];

  for (const symbol of symbols) {
    const all = await deps.loadDailyBars(symbol);
    const bars = all.filter((b) => b.d <= params.barRange.to);
    if (!bars.length) {
      logger.warn('analysis_replay_no_bars', { datasetId, symbol });
      continue;
    }
    const ohlcv: OHLCV[] = bars.map((b) => ({
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? 0,
    }));
    const bands = computeStTrendBands(ohlcv);
    const zoneV1 = computeStZone(ohlcv, bands).zone;
    const zoneV2 = computeStZoneV2(ohlcv, bands).zone;
    const strength = computeStTrendStrength(ohlcv);
    const strengthAt = (i: number): StrengthSlice => {
      const pick = (arr: number[]) => (Number.isFinite(arr[i]) ? arr[i] : null);
      return {
        'strength.diPlus': pick(strength.diPlus),
        'strength.diMinus': pick(strength.diMinus),
        'strength.diHist': pick(strength.diHist),
        'strength.adx': pick(strength.adx),
      };
    };

    // Same-timeframe zone doubles as the window context — production's
    // generateZoneSignals passes `windowV2 = zone` the same way.
    const detected = [
      ...deps.detectSignals(zoneV1, zoneV1, ohlcv, 'V1', 'D'),
      ...deps.detectSignals(zoneV2, zoneV2, ohlcv, 'V2', 'D'),
    ];
    const signals = detected
      .filter((sig) => {
        const i = sig.index ?? -1;
        if (i < 0 || i >= bars.length) return false;
        if (types.size && !types.has(sig.signalType)) return false;
        return bars[i].d >= params.barRange.from;
      })
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    for (const sig of signals) {
      rows.push(replaySignalToRow(
        sig, symbol, bars, strengthAt(sig.index ?? 0),
        params, datasetId, deps.evaluateExit,
      ));
    }
    logger.info('analysis_replay_symbol', {
      datasetId, symbol, signals: signals.length, rows: rows.length,
    });
  }

  logger.info('analysis_replay_rows', { datasetId, rows: rows.length });
  await deps.writeDataset(rows, datasetId);
  return rows.length;
}

/** Real seams for the task handler — db/storage resolve lazily so specs
 *  can construct deps without an initialized app. */
export function replayDeps(): ReplayDeps {
  return {
    listSymbols: async () =>
      (await db.collection('symbol-data').listDocuments()).map((d) => d.id),
    loadDailyBars: async (symbol) =>
      (await getCachedBarsFromSymbolData(symbol, '9999-12-31')).dailyBars,
    detectSignals: detectAllStTrendRiderSignals,
    evaluateExit: evaluateVariant,
    writeDataset: (rows, datasetId) =>
      writeDataset(rows, datasetId, datasetWriterDeps(db, getStorage().bucket())),
  };
}
