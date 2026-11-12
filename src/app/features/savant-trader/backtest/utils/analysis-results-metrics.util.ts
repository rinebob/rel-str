/**
 * Analysis-results row metrics (#1431) — pure derivations over
 * `AnalysisTradeRecord`s shared by the results store's two surfaces:
 * `winLossOf` feeds the aggregate W/L column, `tradeRowMetrics` feeds
 * the event row's display cells. Extracted from
 * `analysis-results.store.ts` (file-size guideline) — same convention
 * as `utils/analysis-results-emit.util.ts`.
 */
import { parseOccContractId } from '@options-contract/contracts';
import { TradeSide } from '@common';
import type { AnalysisTradeRecord } from '@options-analysis/contracts';

/** The mark a resolved record settles at — `exitPrice` for an exit,
 *  `intrinsicAtExpiry` for an expiry; null while unresolved
 *  (open/error). One narrowing shared by W/L and the Δ-mark cell. */
export function terminalMarkOf(t: AnalysisTradeRecord): number | null {
  if (t.outcome === 'exit') return t.exitPrice;
  if (t.outcome === 'expired') return t.intrinsicAtExpiry;
  return null;
}

/** Wins/losses over a doc's resolved records under its template's side
 *  (#1431 item 8). SHORT wins when the terminal mark is below entryMark
 *  (premium kept beats the buy-back/assignment cost), LONG inverts.
 *  That prices partial-ITM expiries correctly — a short put assigned
 *  $0.50 against $2.50 collected is a win, not the binary-ITM loss.
 *  Breakeven, open and error records count as neither. */
export function winLossOf(
  trades: AnalysisTradeRecord[],
  side: TradeSide | undefined,
): { wins: number; losses: number } | null {
  if (!side) return null;
  let wins = 0;
  let losses = 0;
  for (const t of trades) {
    const terminal = terminalMarkOf(t);
    if (terminal === null) continue; // open/error — unresolved, neither
    const better = terminal < t.entryMark;
    const worse = terminal > t.entryMark;
    if (better === worse) continue; // breakeven — neither
    if (side === TradeSide.SHORT ? better : worse) wins++;
    else losses++;
  }
  return { wins, losses };
}

/** Per-record display metrics — derived once in the store so the event
 *  row renders with zero outcome narrowing in the template. */
export interface TradeRowMetrics {
  /** Outcome cell text — e.g. `exit 2026-02-20 @ 0.50`, `still open`. */
  outcomeText: string;
  /** The record's terminal mark for the Exit-mark column — the written
   *  `terminalMark` when present (v2; covers open rows' last-bar mark),
   *  else the settled mark derived for resolved outcomes so pre-v2 docs
   *  still show exit/expiry values. Null → '—' (error, v1 open). */
  exitMark: number | null;
  /** Terminal mark − entryMark + % (null → '—' for open/error; pct
   *  null on a zero/negative premium). */
  priceChange: { delta: number; pct: number | null } | null;
  /** MAE as % of entry premium (null for error/zero-premium rows). */
  maePct: number | null;
  /** CSP capital/ROC — null for non-SHORT templates or unparseable OCC. */
  capitalRoc: { capital: number; rocPct: number } | null;
}

/** All per-record display metrics in one narrowing pass (#1431 items
 *  6/7/10). `side` gates capital/ROC: the `strike × 100` convention is
 *  the SHORT (CSP) frame; a future debit template needs its own capital
 *  model, so it renders '—' until one exists. */
export function tradeRowMetrics(
  t: AnalysisTradeRecord,
  side: TradeSide | undefined,
): TradeRowMetrics {
  const terminal = terminalMarkOf(t);
  // Open/error carry no resolved mark — priceChange '—'; error rows also
  // mask daysHeld/excursions in the template (placeholders, not data).
  const delta = terminal === null ? null : terminal - t.entryMark;
  const parsed = side === TradeSide.SHORT ? parseOccContractId(t.contractId) : null;
  return {
    exitMark: t.terminalMark ?? terminal,
    outcomeText:
      t.outcome === 'exit'
        ? `exit ${t.exitDate} @ ${t.exitPrice.toFixed(2)}`
        : t.outcome === 'expired'
          ? `expired ${t.expiredItm ? 'ITM' : 'OTM'} · ${t.assignmentDistancePct.toFixed(2)}% away`
          : t.outcome === 'open'
            ? `still open · as of ${t.lastBarDate}`
            : `error: ${t.error}`,
    priceChange:
      delta === null
        ? null
        : { delta, pct: t.entryMark > 0 ? (delta / t.entryMark) * 100 : null },
    maePct:
      t.outcome === 'error' || t.entryMark <= 0
        ? null
        : (t.mae.value / t.entryMark) * 100,
    capitalRoc:
      parsed && parsed.strike > 0
        ? { capital: parsed.strike * 100, rocPct: (t.entryMark / parsed.strike) * 100 }
        : null,
  };
}
