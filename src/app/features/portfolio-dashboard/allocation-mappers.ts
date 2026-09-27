/**
 * MCP → allocation-domain mappers (Blueprint #582 / task #586).
 *
 * `shared/portfolio-allocation-utils.ts` consumes normalized
 * AllocationPositionInput/AllocationFillInput — the RobinhoodMcpClient
 * returns typed but broker-shaped data, so this file is the single place
 * that owns the mapping rules:
 *
 *  - instrumentId = symbol for equities, RH instrument UUID for options
 *    (the equity surface exposes no UUID).
 *  - marketValue/costBasis are signed; option values carry the ×100
 *    contract multiplier.
 *  - Orders expand legs[]×executions[] into per-instrument fills;
 *    positionEffect flows through from option legs and is inferred for
 *    equity sells bounded by the position's sharesHeldForSells (IMPL §4).
 *
 * Pure functions — no Angular, no service dependencies.
 */

import type {
  BrokerOrder,
  EquityPosition,
  EquityQuote,
  OptionPosition,
  OptionQuote,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type {
  AllocationFillInput,
  AllocationPositionInput,
} from '@portfolio-allocation/utils';

const OPTION_MULTIPLIER = 100;

/** States whose fills count toward realized/unrealized activity. */
const FILL_STATES = new Set(['filled', 'partially_filled']);

/**
 * Robinhood positions → allocation inputs. A missing quote yields a NaN
 * marketValue that flows through here and is then dropped by the util's
 * `isWellFormedPosition` guard at rollup time — skip-not-crash.
 */
export function toPositionInputs(
  equities: EquityPosition[],
  options: OptionPosition[],
  equityQuotes: Map<string, EquityQuote>,
  optionQuotes: Map<string, OptionQuote>,
): AllocationPositionInput[] {
  const out: AllocationPositionInput[] = [];

  for (const e of equities) {
    const qty = e.quantity ?? Number.NaN;
    const mark = equityQuotes.get(e.symbol)?.lastTradePrice;
    out.push({
      instrumentId: e.symbol,
      quantity: qty,
      marketValue: qty * (mark ?? Number.NaN),
      costBasis: qty * (e.averageBuyPrice ?? Number.NaN),
    });
  }

  for (const o of options) {
    const qty = o.quantity ?? Number.NaN;
    const mark = optionQuotes.get(o.instrumentId)?.lastTradePrice;
    out.push({
      instrumentId: o.instrumentId,
      quantity: qty,
      marketValue: qty * (mark ?? Number.NaN) * OPTION_MULTIPLIER,
      costBasis: qty * (o.averageCost ?? Number.NaN) * OPTION_MULTIPLIER,
    });
  }

  return out;
}

/**
 * Broker orders → per-instrument fills. Only filled/partially-filled
 * orders contribute. Option orders expand per-leg (each leg is a distinct
 * instrumentId); a leg-less option order can't be attributed (chain symbol
 * is not a contract identity) and is skipped.
 *
 * Fill granularity: executions[] when present (per-fill timestamps), else
 * one order-level fill at averageFillPrice/createdAt. For multi-leg option
 * orders the leg carries the contract quantity; per-leg execution prices
 * aren't surfaced by the MCP — the order's averageFillPrice stands in
 * (documented approximation).
 *
 * positionEffect: option legs carry it. Equity sells infer 'close' when
 * the account holds enough sharesHeldForSells to cover the fill — the
 * truncated-history guard (a close whose open fell outside the history
 * window must not fabricate a short lot).
 */
export function toFillInputs(
  orders: BrokerOrder[],
  equityPositions: Map<string, EquityPosition>,
): AllocationFillInput[] {
  const fills: AllocationFillInput[] = [];

  for (const o of orders) {
    if (!FILL_STATES.has(o.state)) continue;

    if (o.instrumentType === 'equity') {
      if (!o.symbol) continue;
      const effect = inferEquityEffect(o, equityPositions);
      // All-or-nothing per-order execution expansion: if ANY execution is
      // malformed (missing qty/price) fall back to the order-level fill —
      // emitting a subset would silently understate realized P&L.
      const execs = o.executions?.length
        && o.executions.every((e) => e.quantity != null && e.price != null)
        ? o.executions
        : undefined;
      if (execs?.length) {
        for (const e of execs) {
          const filledAt = e.timestamp ?? o.createdAt;
          if (!filledAt) continue; // no timestamp → the fill would be dropped downstream anyway
          fills.push({
            instrumentId: o.symbol,
            side: o.side,
            positionEffect: o.side === 'sell' ? effect : undefined,
            quantity: e.quantity as number,
            price: e.price as number,
            multiplier: 1,
            filledAt,
          });
        }
      } else {
        const qty = o.cumulativeQuantity ?? o.quantity;
        const price = o.averageFillPrice ?? o.price;
        if (qty == null || price == null || !o.createdAt) continue;
        fills.push({
          instrumentId: o.symbol,
          side: o.side,
          positionEffect: o.side === 'sell' ? effect : undefined,
          quantity: qty,
          price,
          multiplier: 1,
          filledAt: o.createdAt,
        });
      }
    } else {
      // Option order — per-leg fills at the order's average fill price.
      const price = o.averageFillPrice ?? o.price;
      const at = o.executions?.find((e) => e.timestamp)?.timestamp ?? o.createdAt;
      if (price == null || !at) continue;
      for (const leg of o.legs ?? []) {
        if (!leg.optionId || leg.quantity == null || !leg.side) continue;
        fills.push({
          instrumentId: leg.optionId,
          side: leg.side,
          positionEffect: leg.positionEffect ?? undefined,
          quantity: leg.quantity,
          price,
          multiplier: OPTION_MULTIPLIER,
          filledAt: at,
        });
      }
    }
  }

  return fills;
}

/** Sell fills bounded by the position's sellable share count are closes.
 *  Fidelity bound: this compares a historical order to TODAY's holdings —
 *  sell-then-rebuy sequences can misclassify in either direction. The
 *  bound is intentional (IMPL §4): missing inference is recoverable via
 *  post-hoc attribution; over-fabricating close flags risks phantom shorts. */
function inferEquityEffect(
  order: BrokerOrder,
  positions: Map<string, EquityPosition>,
): 'open' | 'close' | undefined {
  if (order.side !== 'sell' || !order.symbol) return undefined;
  const pos = positions.get(order.symbol);
  if (!pos) return undefined;
  const heldForSells = pos.sharesHeldForSells ?? pos.quantity;
  const sellQty = order.cumulativeQuantity ?? order.quantity ?? 0;
  return heldForSells != null && sellQty > 0 && sellQty <= heldForSells ? 'close' : undefined;
}
