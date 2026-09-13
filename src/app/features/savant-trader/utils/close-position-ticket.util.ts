import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { EquityPosition } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/**
 * Build an EquityOrderTicket for closing a position.
 *
 * Mirrors the buildStopLossTicket() pattern: generates a refId for idempotency,
 * sets source = POSITION_MANAGEMENT with a position_close sourceRef.
 */
export function buildClosePositionTicket(
  position: EquityPosition,
  orderType: 'market' | 'limit',
  quantity: string,
  accountNumber: string,
  limitPrice?: number,
  now = new Date(),
): EquityOrderTicket {
  return {
    id: `${position.symbol.toUpperCase()}-CLOSE-${now.toISOString()}`,
    refId: crypto.randomUUID(),
    source: OrderSource.POSITION_MANAGEMENT,
    sourceRef: { type: 'position_close', id: position.symbol },
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side: 'sell',
    orderType,
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol: position.symbol,
    quantity,
    ...(limitPrice !== undefined ? { limitPrice: limitPrice.toFixed(2) } : {}),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
