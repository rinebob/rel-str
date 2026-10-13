import {
  BrokerOrder,
  EquityQuote,
  OptionQuote,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/**
 * Resolve the live mark for a broker order from the account's quote maps.
 * Equity orders join on `symbol`; a single-leg option order joins on
 * `legs[0].optionId`. Multi-leg orders have no single mark — returns null.
 */
export function orderMark(
  order: BrokerOrder,
  equityQuotes: Map<string, EquityQuote> | null,
  optionQuotes: Map<string, OptionQuote> | null,
): number | null {
  if (order.instrumentType === 'option') {
    const legs = order.legs ?? [];
    if (legs.length !== 1 || !legs[0].optionId) return null;
    return optionQuotes?.get(legs[0].optionId)?.lastTradePrice ?? null;
  }
  if (!order.symbol) return null;
  return equityQuotes?.get(order.symbol)?.lastTradePrice ?? null;
}
