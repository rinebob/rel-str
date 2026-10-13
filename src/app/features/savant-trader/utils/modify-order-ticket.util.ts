import {
  EquityOrderTicket,
  EquityMarketHours,
  EquityTimeInForce,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/**
 * Build the replacement EquityOrderTicket for a Modify (cancel + re-place)
 * on an open equity limit order.
 *
 * Fresh refId — RH burns a cancelled order's ref_id (#717). Quantity is the
 * unfilled remainder (quantity − cumulativeQuantity): a partially-filled
 * order re-places only what's still open. TIF/market-hours carry over from
 * the broker order when they map onto the ticket's canonical unions.
 */
export function buildModifyOrderTicket(
  order: BrokerOrder,
  newLimitPrice: number,
  now = new Date(),
): EquityOrderTicket {
  const remaining = (order.quantity ?? 0) - (order.cumulativeQuantity ?? 0);
  const tif: EquityTimeInForce =
    order.timeInForce === 'gtc' || order.timeInForce === 'gfd' ? order.timeInForce : 'gfd';
  const hours: EquityMarketHours =
    order.marketHours === 'extended_hours' || order.marketHours === 'all_day_hours'
      ? order.marketHours
      : 'regular_hours';
  return {
    id: `${(order.symbol ?? 'ORDER').toUpperCase()}-MODIFY-${now.toISOString()}`,
    refId: crypto.randomUUID(),
    source: OrderSource.MANUAL,
    sourceRef: { type: 'order_modify', id: order.orderId },
    status: OrderTicketStatus.STAGED,
    accountNumber: order.accountNumber,
    side: order.side === 'sell' ? 'sell' : 'buy',
    orderType: 'limit',
    timeInForce: tif,
    marketHours: hours,
    instrumentType: InstrumentType.EQUITY,
    symbol: order.symbol ?? '',
    quantity: String(Math.max(remaining, 0)),
    limitPrice: newLimitPrice.toFixed(2),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
