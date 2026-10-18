/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1077)
 *
 * Live-snapshot pass — the 'live' branch of `analysisDatasetTask`
 * (IMPL §3). Enumerates `paper-trading/trades/items`, maps each trade to
 * a `TradeAnalysisRow`, hands the rows to `writeDataset`.
 *
 * Row semantics:
 * - Lifecycle/outcomes are ledger-observed: entry/exit fills, marks,
 *   realizedPnl — nothing is modeled (that's the replay path's job).
 * - `analysisCohort` — signal-linked equity rows (`expression 'EQ'` with
 *   a signal identity) are `signal-equity`; manual trades and
 *   option-expression rows (premium-basis %, a different denominator)
 *   stay in the file flagged `excluded`.
 * - `ind.*` copies the stamped `signalIndicators` snapshot verbatim —
 *   never recomputed.
 * - `strength.*` is computed here from daily bars at the signal bar
 *   (`computeStTrendStrength`), cached per symbol+anchor-date.
 * - Excursion walks the marks map (basis `mark ?? underlyingClose`),
 *   direction-aware; `excursionSource: 'marks'`.
 * - Open/PENDING trades keep null exit fields; `tradeRetPct` for OPEN
 *   uses the latest mark (provisional — views compute on CLOSED anyway).
 *
 * Deps are injected: `listTrades`/`loadDailyBars`/`writeDataset` so specs
 * run hermetic; the task handler wires the real seams.
 */

import { logger } from 'firebase-functions/v2';
import type { Firestore } from 'firebase-admin/firestore';

import {
  PaperTradeStatus,
  type PaperFill,
  type PaperMark,
  type PaperTrade,
} from '@paper-trading/contracts';
import { TradeSide } from '@common';
import { EQUITY_TRADE_DESC } from '@paper-trading/ids';
import {
  AnalysisCohort,
  type AnalysisRunParams,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import { computeStTrendStrength } from '../../indicators/st-trend-strength';
import type { OHLCV } from '../../indicators/st-trend-bands';
import type { OhlcBar } from '../../common/market-data-types';
import { getCachedBarsFromSymbolData } from '../../st-cloud-function/data-loader';
import { listTrades } from '../repository';
import { db } from '../../firebase-admin-init';
import { datasetWriterDeps, writeDataset } from './dataset-writer';
import { getStorage } from 'firebase-admin/storage';

export interface LiveSnapshotDeps {
  listTrades(): Promise<PaperTrade[]>;
  /** Daily bars for `symbol` on or before `asOf` (YYYY-MM-DD). */
  loadDailyBars(symbol: string, asOf: string): Promise<OhlcBar[]>;
  writeDataset(rows: TradeAnalysisRow[], datasetId: string): Promise<void>;
}

/** strength.* slice at a bar index — null-filled when bars are thin. */
export interface StrengthSlice {
  'strength.diPlus': number | null;
  'strength.diMinus': number | null;
  'strength.diHist': number | null;
  'strength.adx': number | null;
}

const NULL_STRENGTH: StrengthSlice = {
  'strength.diPlus': null,
  'strength.diMinus': null,
  'strength.diHist': null,
  'strength.adx': null,
};

const DAY_MS = 86_400_000;
const calDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** A fill date is 'YYYY-MM-DD' or an ISO timestamp — normalize to the day. */
const fillDay = (f: PaperFill): string => f.date.slice(0, 10);

/** Earliest entry fill — single selection rule shared by the scope filter
 *  and the row mapper so a non-date-ordered fills array can't disagree. */
const entryFillOf = (t: PaperTrade): PaperFill | null =>
  t.fills.filter((f) => f.role === 'entry')
    .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** 'signal-equity' rows are the analysis cohort; everything else stays flagged. */
function cohortOf(t: PaperTrade): AnalysisCohort {
  const signalLinked =
    t.signalType != null || t.signalId != null || t.ticket?.signalId != null;
  return t.expression === EQUITY_TRADE_DESC && signalLinked
    ? AnalysisCohort.SIGNAL_EQUITY
    : AnalysisCohort.EXCLUDED;
}

interface Excursion {
  mfePct: number | null;
  maePct: number | null;
  mfeDate: string | null;
  maeDate: string | null;
  daysToMfe: number | null;
}

/** Walk marks ≥ entryDate (≤ exitDate when closed); basis = mark ?? underlyingClose. */
function excursionFromMarks(
  marks: Record<string, PaperMark>,
  entryDate: string,
  entryPrice: number,
  exitDate: string | null,
  sign: 1 | -1,
): Excursion {
  const dates = Object.keys(marks)
    .sort()
    .filter((d) => d >= entryDate && (exitDate === null || d <= exitDate));
  let mfe: { price: number; date: string } | null = null;
  let mae: { price: number; date: string } | null = null;
  for (const d of dates) {
    const m = marks[d];
    const price = m.mark ?? m.underlyingClose;
    if (price === undefined) continue;
    // direction-aware: for a short, lower is more favorable
    if (!mfe || sign * (price - mfe.price) > 0) mfe = { price, date: d };
    if (!mae || sign * (price - mae.price) < 0) mae = { price, date: d };
  }
  return {
    mfePct: mfe ? sign * ((mfe.price - entryPrice) / entryPrice) * 100 : null,
    maePct: mae ? sign * ((mae.price - entryPrice) / entryPrice) * 100 : null,
    mfeDate: mfe?.date ?? null,
    maeDate: mae?.date ?? null,
    daysToMfe: mfe ? calDays(entryDate, mfe.date) : null,
  };
}

/**
 * Map one ledger trade → analysis row. `strength` is computed by the pass
 * (per symbol+anchor cache) — the mapper stays pure.
 */
export function tradeToRow(
  t: PaperTrade,
  datasetId: string,
  strength: StrengthSlice | null,
): TradeAnalysisRow {
  const sign: 1 | -1 = t.order.side === TradeSide.SHORT ? -1 : 1;
  const entry = entryFillOf(t);
  const exit = t.fills.filter((f) => f.role === 'exit').sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null;
  const entryDate = entry ? fillDay(entry) : null;
  const exitDate = exit ? fillDay(exit) : null;

  // Provisional mark for still-open trades — the snapshot is ledger-observed.
  let lastMark: { date: string; price: number } | null = null;
  if (!exitDate && entryDate) {
    for (const d of Object.keys(t.marks).sort()) {
      const p = t.marks[d].mark ?? t.marks[d].underlyingClose;
      if (p !== undefined && d >= entryDate) lastMark = { date: d, price: p };
    }
  }

  const obsPrice = exit?.price ?? lastMark?.price ?? null;
  const retPct =
    entry && obsPrice !== null
      ? sign * ((obsPrice - entry.price) / entry.price) * 100
      : null;
  const symPct =
    entry && obsPrice !== null
      ? ((obsPrice - entry.price) / entry.price) * 100
      : null;
  const exc =
    entryDate && entry
      ? excursionFromMarks(t.marks, entryDate, entry.price, exitDate, sign)
      : { mfePct: null, maePct: null, mfeDate: null, maeDate: null, daysToMfe: null };
  const isTerminal =
    t.status === PaperTradeStatus.CLOSED || t.status === PaperTradeStatus.EXPIRED;
  const ind = t.signalIndicators ?? {};

  return {
    datasetId,
    tradeId: t.id,
    signalId: t.signalId ?? t.ticket?.signalId ?? null,
    signalType: t.signalType ?? null,
    cohortId: t.cohortId ?? null,
    positionGroupId: t.positionGroupId ?? null,
    symbol: t.symbol,
    direction: t.order.side,
    expression: t.expression,
    captureList: t.captureList ?? null,
    sector: t.sector ?? null,
    industry: t.industry ?? null,
    capTier: t.marketCapTier ?? null,
    source: 'live',
    analysisCohort: cohortOf(t),
    status: t.status,
    signalStatus: t.signalStatus ?? null,

    signalBarDate: t.signalBarDate ?? null,
    entryDate,
    entryPrice: entry?.price ?? null,
    exitDate,
    exitPrice: exit?.price ?? null,
    qty: entry?.quantity ?? t.order.quantity ?? null,
    daysHeld: entryDate && exitDate ? calDays(entryDate, exitDate) : null,
    exitReason: isTerminal ? t.governingVariant : null,

    tradeRetPct: retPct,
    symbolMovePct: symPct,
    realizedPnl: t.realizedPnl ?? null,
    capitalRequired: t.capitalRequired ?? null,

    ...exc,
    givebackRatio:
      isTerminal && exc.mfePct !== null && exc.mfePct > 0 && retPct !== null
        ? (exc.mfePct - retPct) / exc.mfePct
        : null,
    excursionSource: 'marks',

    'ind.delta': num(ind['delta']),
    'ind.windowV2': num(ind['windowV2']),
    'ind.zoneV1': num(ind['zoneV1']),
    'ind.zoneV1Prev': num(ind['zoneV1Prev']),
    'ind.zoneV2': num(ind['zoneV2']),
    'ind.zoneV2Prev': num(ind['zoneV2Prev']),

    ...(strength ?? NULL_STRENGTH),
  };
}

/** Bars → OHLCV → last-index strength slice; thin/empty bar sets → nulls. */
function strengthAt(bars: OhlcBar[]): StrengthSlice | null {
  if (bars.length < 15) return null;
  const ohlcv: OHLCV[] = bars.map((b) => ({
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
  }));
  const r = computeStTrendStrength(ohlcv);
  const i = ohlcv.length - 1;
  const pick = (arr: number[]) => (Number.isFinite(arr[i]) ? arr[i] : null);
  return {
    'strength.diPlus': pick(r.diPlus),
    'strength.diMinus': pick(r.diMinus),
    'strength.diHist': pick(r.diHist),
    'strength.adx': pick(r.adx),
  };
}

/**
 * Run the live snapshot: enumerate the ledger, filter to scope, map rows,
 * write the dataset. Throws propagate — the task handler owns the
 * failed-transition for pre-writer errors.
 */
export async function runLiveSnapshot(
  params: AnalysisRunParams,
  datasetId: string,
  deps: LiveSnapshotDeps,
): Promise<number> {
  const trades = await deps.listTrades();
  const scope = new Set(params.symbolScope);
  const types = new Set(params.signalTypes);
  const inScope = trades.filter((t) => {
    if (scope.size && !scope.has(t.symbol)) return false;
    if (types.size && (!t.signalType || !types.has(t.signalType))) return false;
    // barRange bounds the trade's market window — signal bar when stamped,
    // else the entry fill date; a trade with no date at all stays unbounded.
    const anchor = t.signalBarDate ??
      (entryFillOf(t)?.date.slice(0, 10) ?? null);
    if (anchor && (anchor < params.barRange.from || anchor > params.barRange.to)) return false;
    return true;
  });

  // strength.* — anchored at the signal bar (entry === signal bar under
  // 'signal-bar-close'). Bars load once per symbol (a symbol with many
  // signal dates would otherwise re-read its full history per anchor);
  // the slice-to-anchor + strength compute memoize per symbol|date.
  const barsCache = new Map<string, OhlcBar[]>();
  const strengthCache = new Map<string, StrengthSlice | null>();
  const barsFor = async (symbol: string): Promise<OhlcBar[]> => {
    if (!barsCache.has(symbol)) {
      barsCache.set(symbol, await deps.loadDailyBars(symbol, '9999-12-31'));
    }
    return barsCache.get(symbol)!;
  };
  const strengthFor = async (t: PaperTrade): Promise<StrengthSlice | null> => {
    const anchor = t.signalBarDate ?? null;
    if (!anchor) return null;
    const key = `${t.symbol}|${anchor}`;
    if (!strengthCache.has(key)) {
      const bars = (await barsFor(t.symbol)).filter((b) => b.d <= anchor);
      strengthCache.set(key, strengthAt(bars));
    }
    return strengthCache.get(key)!;
  };

  const rows: TradeAnalysisRow[] = [];
  for (const t of inScope) {
    rows.push(tradeToRow(t, datasetId, await strengthFor(t)));
  }
  logger.info('analysis_live_snapshot_rows', {
    datasetId,
    scanned: trades.length,
    rows: rows.length,
  });
  await deps.writeDataset(rows, datasetId);
  return rows.length;
}

/** Real seams for the task handler. */
export function liveSnapshotDeps(firestoreDb: Firestore = db): LiveSnapshotDeps {
  const writer = datasetWriterDeps(
    firestoreDb,
    getStorage().bucket(),
  );
  return {
    listTrades: () => listTrades(firestoreDb),
    loadDailyBars: async (symbol, asOf) =>
      (await getCachedBarsFromSymbolData(symbol, asOf)).dailyBars,
    writeDataset: (rows, datasetId) => writeDataset(rows, datasetId, writer),
  };
}
