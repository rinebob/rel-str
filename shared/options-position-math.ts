/**
 * @topic #137 — Strategy Manager (task #1710)
 *
 * Signed net-mark + uniform P&L for multi-leg option positions — the live
 * lifecycle contract every mark/settle/analysis pass shares.
 *
 * Sign space = LIQUIDATION VALUE: a LONG leg contributes `+mark` (what you'd
 * sell it for), a SHORT leg contributes `−mark` (what you'd pay to close).
 * A credit spread therefore marks NEGATIVE (a liability) and a debit spread
 * POSITIVE (an asset). This is the sign-inverse of the backtest's
 * cost-to-close space (`options-analysis/position-net.ts` `signFor`) — same
 * Σ(sign × mark × multiplier × qty) shape, opposite pole. Consumers that
 * feed the exit evaluators keep their space; live position valuation uses
 * this one.
 *
 * Uniform P&L — one formula, no posture branching:
 *
 *   unrealizedPnl = signedEntryPremium + netMark
 *                 = netMark − entryNetMark
 *
 *   credit: +C + (−V) = C − V   profit as the spread cheapens
 *   debit:  −D + (+V) = V − D   profit as the spread widens
 *
 * Missing marks: any leg without a mark makes the position UNPRICEABLE —
 * the helpers return `undefined`. A caller must never zero-fill a missing
 * mark (same INNER-join rule as `position-net.ts`: a hole must not
 * fabricate a net value).
 *
 * Pure — no Firestore, no providers. Importable by functions and the
 * Angular app.
 */

import { TradeSide } from './common';
import { PaperTradeStatus } from './paper-trading-contracts';

const DEFAULT_MULTIPLIER = 100;
const DEFAULT_QUANTITY = 1;

/** Liquidation-value sign: a long leg is an asset (+1), a short leg a
 *  liability (−1). */
export const legValueSign = (side: TradeSide): 1 | -1 =>
  side === TradeSide.SHORT ? -1 : 1;

/** One leg's contribution to a net mark — `mark` is the per-contract
 *  price (`lastMark` for current value, `entryMark` for entry value). */
export interface NetMarkLegInput {
  side: TradeSide;
  mark: number | undefined;
  /** Contract multiplier — options default 100, share legs pass 1. */
  multiplier?: number;
  quantity?: number;
}

/** Signed net value of the position's legs in dollars — `undefined` if any
 *  leg mark is missing (unpriceable, never fabricated). */
export function netMarkValue(
  legs: readonly NetMarkLegInput[],
): number | undefined {
  if (legs.length === 0) return undefined;
  let net = 0;
  for (const l of legs) {
    if (l.mark === undefined) return undefined;
    net +=
      legValueSign(l.side) *
      l.mark *
      (l.multiplier ?? DEFAULT_MULTIPLIER) *
      (l.quantity ?? DEFAULT_QUANTITY);
  }
  return net;
}

/** The position's signed liquidation value AT ENTRY — same space as
 *  `netMarkValue`, computed from entry marks. Negative for credit
 *  structures (a liability from day one), positive for debits. */
export function entryNetMark(
  legs: readonly NetMarkLegInput[],
): number | undefined {
  return netMarkValue(legs);
}

/** Signed cash flow at open: positive when the position took premium IN
 *  (credit), negative when it PAID (debit). The negation of
 *  `entryNetMark` — receiving cash for a liability, paying for an asset. */
export function signedEntryPremium(
  legs: readonly NetMarkLegInput[],
): number | undefined {
  const entry = entryNetMark(legs);
  return entry === undefined ? undefined : -entry;
}

/** The one P&L formula — `signedEntryPremium + netMark` for every posture.
 *  Equivalent to `netMark − entryNetMark`: the change in the position's
 *  liquidation value since open. */
export function unrealizedPnl(
  entryPremium: number,
  netMark: number,
): number {
  return entryPremium + netMark;
}

// ── Lifecycle selection contract ────────────────────────────────────────────

/** Minimal leg shape the selection predicate needs — `PaperTradeLeg.kind`
 *  satisfies this structurally. */
interface LegKindCarrier {
  kind?: string;
}

/** Minimal trade shape — `PaperTrade` satisfies this structurally. */
interface TradeShape {
  status?: string;
  legs?: readonly LegKindCarrier[];
}

/** Does the trade carry at least one option leg? THE lifecycle-pass
 *  selection predicate — era-agnostic (legacy + manage docs share the
 *  `PaperTrade` shape), source-agnostic (strategy + signal option trades),
 *  runState-agnostic. Signal STOCK trades (share legs only) are excluded;
 *  a mixed stock+option position counts — its option legs mark here while
 *  the stock leg stays on the signal passes. */
export function hasOptionLegs(trade: TradeShape): boolean {
  return trade.legs?.some((l) => l.kind === 'option') ?? false;
}

/** The composed selection contract a lifecycle pass iterates:
 *  `status == OPEN` AND the trade carries option legs. Terminal positions
 *  (CLOSED/EXPIRED/ASSIGNED/CANCELLED) and stock-only trades are out. */
export function isOpenOptionPosition(trade: TradeShape): boolean {
  return trade.status === PaperTradeStatus.OPEN && hasOptionLegs(trade);
}
