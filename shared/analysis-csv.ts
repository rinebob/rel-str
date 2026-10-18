/**
 * @topic #553 — Paper Trading Infra · Thread #1059 Trade Analysis & Forensics
 *         (task #1074)
 *
 * Deterministic CSV codec for trade-analysis datasets.
 *
 * Contract (SHARED IMPL §3):
 * - `serializeDataset` produces byte-identical output for the same row set
 *   regardless of input order — rows are stable-sorted by `tradeId` with a
 *   codepoint comparison (NOT localeCompare — locale collation is not
 *   byte-deterministic across environments).
 * - Header row = `ANALYSIS_COLUMNS` order (or a caller-supplied subset).
 * - RFC-4180 quoting: a cell containing `,` `"` `\n` or `\r` is wrapped in
 *   double quotes; embedded quotes double.
 * - Numbers emit the shortest round-trip representation (`String(v)`):
 *   integers bare (`36`), fractions lossless (`119.465`). The prototype's
 *   2-decimal padding is display cosmetics — real fills carry 3–4 decimal
 *   prices and >2dp P&L, so the dataset stays lossless and view layers
 *   own presentation.
 * - `null`/`undefined`/non-finite → empty cell. Never the string
 *   "undefined"/"null"/"NaN" — empty is the only absent marker.
 * - Rows are LF-joined with a trailing LF (POSIX-terminated file).
 * - `COLUMN_TYPES` is the manifest-derived coercion map the FE uses to
 *   type papaparse output; papaparse itself stays FE-only.
 */

import {
  ANALYSIS_COLUMNS,
  type AnalysisColumnDef,
  type AnalysisColumnKind,
  type TradeAnalysisRow,
} from './analysis-dataset-contracts';

/** Manifest-derived coercion map: row key → declared column kind. */
export const COLUMN_TYPES = Object.freeze(
  Object.fromEntries(ANALYSIS_COLUMNS.map((c) => [c.key, c.kind])),
) as Record<keyof TradeAnalysisRow & string, AnalysisColumnKind>;

/** Codepoint sort — byte-deterministic, locale-independent. */
const byTradeId = (a: TradeAnalysisRow, b: TradeAnalysisRow): number =>
  a.tradeId < b.tradeId ? -1 : a.tradeId > b.tradeId ? 1 : 0;

function rawCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  return String(value);
}

function csvCell(value: unknown): string {
  const raw = rawCell(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/**
 * Serialize analysis rows to CSV text. Deterministic: same rows →
 * byte-identical output (stable tradeId sort), so dataset diffs are
 * meaningful.
 */
export function serializeDataset(
  rows: readonly TradeAnalysisRow[],
  columns: readonly AnalysisColumnDef[] = ANALYSIS_COLUMNS,
): string {
  const header = columns.map((c) => c.key).join(',');
  const lines = [...rows]
    .sort(byTradeId)
    .map((row) => columns.map((c) => csvCell(row[c.key])).join(','));
  return [header, ...lines].join('\n') + '\n';
}
