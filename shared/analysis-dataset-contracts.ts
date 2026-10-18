/**
 * @topic #553 — Paper Trading Infra · Thread #1059 Trade Analysis & Forensics
 *         (task #1073)
 *
 * Shared contracts for the CSV-native trade-analysis pipeline. Everything
 * the BE dataset generator and the FE workbench must agree on lives here:
 * the row schema, the ordered column manifest, dataset-index and slice
 * shapes, and the analysis-cohort flag.
 *
 * Conventions:
 * - One row per trade covering its complete lifecycle.
 * - Percent fields are PERCENT UNITS, not fractions: `tradeRetPct: 6.51`
 *   means +6.51%, never 0.0651.
 * - Dates are ISO `YYYY-MM-DD` (market dates, not timestamps); timestamps
 *   (`generatedAt`, `createdAt`) are full ISO 8601.
 * - Absent fields are `null` — every row carries every manifest key so the
 *   manifest ⇄ schema bijection holds exactly.
 * - `ind.*` fields are the raw stamped signal-indicator snapshot (keys are
 *   the detector's own names: `zoneV1`, `zoneV2`, `zoneV1Prev`,
 *   `zoneV2Prev`, `windowV2`, `delta` for the daily Trend Rider). `null`
 *   when the signal type doesn't stamp that key (e.g. a V1 signal leaves
 *   `ind.zoneV2` null).
 * - `strength.*` fields are computed at generation time from the symbol's
 *   daily bars (trend-strength DI/ADX family) — never stamped on the trade.
 */

import { TradeSide } from './common';
import {
  PaperTradingKind,
  PaperTradeStatus,
  type PaperTradingDocBase,
} from './paper-trading-contracts';
import type { StSignalStatus } from './st-signals';

// ── Analysis cohort flag ────────────────────────────────────────────────────

/**
 * The population the analyzer answers for: signal-origin equity trades.
 * Option-expression fan-outs and manual trades are written with
 * `EXCLUDED` rather than dropped — they stay in the dataset for provenance
 * but views/slices filter them out.
 */
export enum AnalysisCohort {
  SIGNAL_EQUITY = 'signal-equity',
  EXCLUDED = 'excluded',
}
export const ANALYSIS_COHORTS: readonly AnalysisCohort[] = Object.values(
  AnalysisCohort,
);

/** Which pipeline produced the row — a live-ledger snapshot or a replay. */
export type AnalysisRowSource = 'live' | 'replay';
export const ANALYSIS_ROW_SOURCES: readonly AnalysisRowSource[] = [
  'live',
  'replay',
];

/** Where excursion (MFE/MAE) values came from. */
export type ExcursionSource = 'marks' | 'replay';
export const EXCURSION_SOURCES: readonly ExcursionSource[] = [
  'marks',
  'replay',
];

// ── Row schema ──────────────────────────────────────────────────────────────

/**
 * One analysis row — flat, keyed by the exact CSV column names
 * (`ind.zoneV2`, `strength.adx` are literal keys). `ANALYSIS_COLUMNS` is
 * the ordered manifest over these keys; the spec suite pins the bijection.
 */
export interface TradeAnalysisRow {
  // ── identity / provenance ──
  /** Dataset this row belongs to — lets slices span datasets. */
  datasetId: string;
  /** Paper-trade doc id (replay rows get deterministic `synth-` ids). */
  tradeId: string;
  signalId: string | null;
  signalType: string | null;
  cohortId: string | null;
  positionGroupId: string | null;
  symbol: string;
  direction: TradeSide;
  /** 'EQ' | 'CSP' | 'BCS' | … — the expression trade's code. */
  expression: string;
  /** Symbol list that admitted the signal into capture (e.g. 'PRIMARY'). */
  captureList: string | null;
  sector: string | null;
  industry: string | null;
  /** Symbol market-cap tier (from `trade.marketCapTier`). */
  capTier: string | null;
  /** 'live' = snapshot of the paper ledger; 'replay' = regenerated. */
  source: AnalysisRowSource;
  analysisCohort: AnalysisCohort;
  /** Final lifecycle status at generation time. */
  status: PaperTradeStatus;
  /** 'INTERIM' | 'CONFIRMED' — signal status at capture. */
  signalStatus: StSignalStatus | null;

  // ── lifecycle ──
  /** YYYY-MM-DD bar the signal fired on. */
  signalBarDate: string | null;
  entryDate: string | null;
  entryPrice: number | null;
  exitDate: string | null;
  exitPrice: number | null;
  qty: number | null;
  /** Calendar days entry→exit. */
  daysHeld: number | null;
  /** Variant key or rule that closed the trade (e.g. 'trailing-8',
   *  'TIMEOUT'); null while open. */
  exitReason: string | null;

  // ── outcomes ── (percent fields are percent-units)
  /** Direction-aware return: +6.51 on a short that fell 6.51%. */
  tradeRetPct: number | null;
  /** Raw symbol close-to-close change, direction-neutral. */
  symbolMovePct: number | null;
  realizedPnl: number | null;
  capitalRequired: number | null;

  // ── excursion ──
  /** Max favorable excursion, percent-units direction-aware. */
  mfePct: number | null;
  /** Max adverse excursion (≤ 0 for adverse), percent-units. */
  maePct: number | null;
  mfeDate: string | null;
  maeDate: string | null;
  daysToMfe: number | null;
  /** Fraction of MFE surrendered by exit: (mfe − ret)/mfe. */
  givebackRatio: number | null;
  excursionSource: ExcursionSource;

  // ── signal context — stamped snapshot (ind.*) ──
  'ind.delta': number | null;
  'ind.windowV2': number | null;
  'ind.zoneV1': number | null;
  'ind.zoneV1Prev': number | null;
  'ind.zoneV2': number | null;
  'ind.zoneV2Prev': number | null;

  // ── computed context — strength.* from bars at the signal bar ──
  'strength.diPlus': number | null;
  'strength.diMinus': number | null;
  'strength.diHist': number | null;
  'strength.adx': number | null;
}

// ── Column manifest ─────────────────────────────────────────────────────────

export type AnalysisColumnKind = 'string' | 'number' | 'date' | 'enum';

export interface AnalysisColumnDef {
  /** Row key — also the CSV header verbatim. */
  key: keyof TradeAnalysisRow & string;
  label: string;
  kind: AnalysisColumnKind;
  /** Allowed values for `kind: 'enum'` — drives FE filter pickers. */
  enumValues?: readonly string[];
  /** Whether the workbench offers this column in the filter UI. */
  filterable: boolean;
  /** Whether the workbench shows the column by default. */
  defaultVisible: boolean;
}

const col = (
  key: keyof TradeAnalysisRow & string,
  label: string,
  kind: AnalysisColumnKind,
  opts?: Partial<Pick<AnalysisColumnDef, 'enumValues' | 'filterable' | 'defaultVisible'>>,
): AnalysisColumnDef => ({
  key,
  label,
  kind,
  filterable: opts?.filterable ?? true,
  defaultVisible: opts?.defaultVisible ?? true,
  ...(opts?.enumValues ? { enumValues: opts.enumValues } : {}),
});

const PAPER_TRADE_STATUSES: readonly PaperTradeStatus[] =
  Object.values(PaperTradeStatus);
const SIGNAL_STATUSES: readonly StSignalStatus[] = ['INTERIM', 'CONFIRMED'];
/** Whitelist of analyzable signal types — manifest enumValues + callable validation. */
export const SIGNAL_TYPES: readonly string[] = [
  'D_ST_TREND_RIDER_V1_LONG', 'D_ST_TREND_RIDER_V1_SHORT',
  'D_ST_TREND_RIDER_V2_LONG', 'D_ST_TREND_RIDER_V2_SHORT',
];

/**
 * Ordered column manifest — the single source of truth for CSV header
 * order (BE serializer), FE table columns, and filter-type dispatch.
 * Order follows the validated prototype CSV with provenance columns
 * prepended.
 */
export const ANALYSIS_COLUMNS: readonly AnalysisColumnDef[] = [
  // identity / provenance
  col('datasetId', 'Dataset', 'string', { defaultVisible: false }),
  col('tradeId', 'Trade', 'string'),
  col('signalId', 'Signal', 'string', { defaultVisible: false }),
  col('signalType', 'Signal Type', 'enum', { enumValues: SIGNAL_TYPES }),
  col('cohortId', 'Cohort', 'string', { defaultVisible: false }),
  col('positionGroupId', 'Position Group', 'string', { defaultVisible: false }),
  col('symbol', 'Symbol', 'string'),
  col('direction', 'Dir', 'enum', { enumValues: [TradeSide.LONG, TradeSide.SHORT] }),
  col('expression', 'Expr', 'string'),
  col('captureList', 'List', 'string'),
  col('sector', 'Sector', 'string'),
  col('industry', 'Industry', 'string'),
  col('capTier', 'Cap Tier', 'string'),
  col('source', 'Source', 'enum', { enumValues: ANALYSIS_ROW_SOURCES }),
  col('analysisCohort', 'Analysis Cohort', 'enum', { enumValues: ANALYSIS_COHORTS }),
  col('status', 'Status', 'enum', { enumValues: PAPER_TRADE_STATUSES }),
  col('signalStatus', 'Signal Status', 'enum', { enumValues: SIGNAL_STATUSES }),
  // lifecycle
  col('signalBarDate', 'Signal Bar', 'date'),
  col('entryDate', 'Entry', 'date'),
  col('entryPrice', 'Entry $', 'number', { filterable: false }),
  col('exitDate', 'Exit', 'date'),
  col('exitPrice', 'Exit $', 'number', { filterable: false }),
  col('qty', 'Qty', 'number', { filterable: false }),
  col('daysHeld', 'Days Held', 'number'),
  col('exitReason', 'Exit Reason', 'string'),
  // outcomes
  col('tradeRetPct', 'Trade Ret %', 'number'),
  col('symbolMovePct', 'Symbol Δ %', 'number'),
  col('realizedPnl', 'Realized $', 'number'),
  col('capitalRequired', 'Capital Req $', 'number', { filterable: false }),
  // excursion
  col('mfePct', 'MFE %', 'number'),
  col('maePct', 'MAE %', 'number'),
  col('mfeDate', 'MFE Date', 'date', { defaultVisible: false }),
  col('maeDate', 'MAE Date', 'date', { defaultVisible: false }),
  col('daysToMfe', 'Days→MFE', 'number', { defaultVisible: false }),
  col('givebackRatio', 'Giveback', 'number'),
  col('excursionSource', 'Excursion Src', 'enum', { enumValues: EXCURSION_SOURCES }),
  // signal context (stamped)
  col('ind.delta', 'Δ zone', 'number'),
  col('ind.windowV2', 'Window V2', 'number'),
  col('ind.zoneV1', 'Zone V1', 'number'),
  col('ind.zoneV1Prev', 'Zone V1 Prev', 'number', { defaultVisible: false }),
  col('ind.zoneV2', 'Zone V2', 'number'),
  col('ind.zoneV2Prev', 'Zone V2 Prev', 'number', { defaultVisible: false }),
  // computed context (from bars)
  col('strength.diPlus', 'DI+', 'number'),
  col('strength.diMinus', 'DI−', 'number'),
  col('strength.diHist', 'DI Hist', 'number'),
  col('strength.adx', 'ADX', 'number'),
];

// ── Dataset index ───────────────────────────────────────────────────────────

export type AnalysisDatasetOrigin = 'live' | 'replay';
export type AnalysisDatasetStatus = 'generating' | 'ready' | 'failed';

/**
 * Index doc at `paper-trading/analysis-datasets/items/{id}` — the FE
 * dataset library lists these; the CSV payload lives in GCS at
 * `gcsPath`. `status` transitions `generating` → `ready` | `failed`.
 */
export interface AnalysisDatasetDoc extends PaperTradingDocBase {
  kind: PaperTradingKind.ANALYSIS_DATASET;
  origin: AnalysisDatasetOrigin;
  status: AnalysisDatasetStatus;
  /** Set when status flips to 'ready'. */
  rowCount?: number;
  /** Symbols included; empty array = every symbol in scope. */
  symbolScope: string[];
  /** Signal types included; empty array = all. */
  signalTypes: string[];
  /** Exit rule applied (e.g. 'trailing-8'). */
  exitRule: string;
  /** Bar range covered, ISO dates. */
  barRange: { from: string; to: string };
  /** How entryPrice/entryDate were derived (e.g. 'signal-bar-close'). */
  entryConvention: string;
  /** Run-config entry filters — provenance-only today. */
  entryFilters?: Record<string, unknown>;
  /** ISO timestamp when generation finished (or failed). */
  generatedAt: string;
  /** GCS object path — `analysis-datasets/{id}.csv`. */
  gcsPath: string;
  tags: string[];
  notes?: string;
  /** Failure detail when status='failed'. */
  error?: string;
}

// ── Slices ──────────────────────────────────────────────────────────────────

/**
 * A saved filter predicate against a manifest column. Serializes to JSON
 * on `analysis-slices` docs; a predicate naming a column the loaded
 * dataset lacks is skipped client-side with a notice.
 */
export type SliceFilter =
  | { column: keyof TradeAnalysisRow & string; op: 'in'; value: (string | number)[] }
  | { column: keyof TradeAnalysisRow & string; op: 'range'; value: { min?: number; max?: number } }
  | { column: keyof TradeAnalysisRow & string; op: 'dateRange'; value: { from?: string; to?: string } };

/** Saved named view at `paper-trading/analysis-slices/items/{id}`. */
export interface AnalysisSlice extends PaperTradingDocBase {
  kind: PaperTradingKind.ANALYSIS_SLICE;
  name: string;
  note?: string;
  filters: SliceFilter[];
}

// ── Generation request/response (generateTradeDataset, task #1076) ─────────

/**
 * How entry price/date are derived at generation time. Only
 * `signal-bar-close` exists today (PRD: extensible) — the whitelist keeps
 * typos from silently minting uninterpretable provenance.
 */
export type AnalysisEntryConvention = 'signal-bar-close';
export const ENTRY_CONVENTIONS: readonly AnalysisEntryConvention[] = [
  'signal-bar-close',
];

/**
 * The run-config params — stored verbatim on the index doc as provenance
 * and forwarded to `analysisDatasetTask` as the generation recipe.
 */
export interface AnalysisRunParams {
  origin: AnalysisDatasetOrigin;
  /** Symbols in scope; empty = every symbol in scope for the origin. */
  symbolScope: string[];
  /** Signal types included; empty = all. */
  signalTypes: string[];
  /** Exit rule in the exit-registry grammar (`trailing-{pct}`,
   *  `time-{N}d`, `initial-stop-{pct}`). Validated BE-side by the
   *  registry parser, not here — shared stays grammar-free. */
  exitRule: string;
  /** ISO `YYYY-MM-DD` bounds on the data considered. */
  barRange: { from: string; to: string };
  entryConvention: AnalysisEntryConvention;
  /** Provenance-only today — reserved for replay-side entry gating. */
  entryFilters?: Record<string, unknown>;
}

/** `generateTradeDataset` request — validates then enqueues generation. */
export type GenerateTradeDatasetRequest = AnalysisRunParams;

export interface GenerateTradeDatasetResponse {
  datasetId: string;
}

/** Cloud Task payload consumed by `analysisDatasetTask` (#1077/#1078). */
export interface AnalysisDatasetTaskPayload {
  datasetId: string;
  params: AnalysisRunParams;
}
