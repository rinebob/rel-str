import {
  EquityMarketHours,
  EquityOrderTicket,
  EquityTimeInForce,
  InstrumentType,
  OrderTicket,
  OrderTicketSourceRef,
  OrderTicketStatus,
  OrderSource,
} from '../services/order-ticket.types';

/** Order params a stop ticket must carry through from the caller — omitted
 *  fields fall back to the historical defaults (GTC / regular hours). */
export interface StopOrderParams {
  timeInForce?: EquityTimeInForce;
  marketHours?: EquityMarketHours;
}

function formatTicketTimestamp(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now).reduce<Record<string, string>>((values, part) => {
    values[part.type] = part.value;
    return values;
  }, {});
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return `${parts.year}${parts.month}${parts.day}-${parts.weekday.toUpperCase()}-${hour}${parts.minute}PT`;
}

function buildStopLossId(symbol: string, now: Date): string {
  return `${symbol.toUpperCase()}-STOP_LOSS-${formatTicketTimestamp(now)}`;
}

export function buildFractionalCloseTicket(
  entry: OrderTicket,
  symbol: string,
  quantity: string,
  accountNumber: string,
  now = new Date(),
): EquityOrderTicket {
  return {
    id: `${symbol.toUpperCase()}-CLOSE_FRACTIONAL-${formatTicketTimestamp(now)}`,
    refId: crypto.randomUUID(),
    source: OrderSource.POSITION_MANAGEMENT,
    sourceRef: { type: 'fractional_close', id: entry.id },
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side: 'sell',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    quantity,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function buildStopLossTicket(
  entry: OrderTicket,
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
  params: StopOrderParams = {},
  now = new Date(),
): EquityOrderTicket {
  return buildStopLossTicketBase(
    { type: 'stop_loss', id: entry.id },
    symbol,
    quantity,
    stopPrice,
    accountNumber,
    params,
    now,
  );
}

/**
 * Build a stop-loss ticket for a portfolio position (no entry order ticket required).
 *
 * Mirrors buildStopLossTicket() but uses the position symbol as the sourceRef id,
 * since the stop-loss is protecting a position rather than an entry order.
 */
export function buildPositionStopLossTicket(
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
  params: StopOrderParams = {},
  now = new Date(),
): EquityOrderTicket {
  return buildStopLossTicketBase(
    { type: 'stop_loss', id: symbol },
    symbol,
    quantity,
    stopPrice,
    accountNumber,
    params,
    now,
  );
}

/**
 * Build the replacement ticket for an Update Stop operation — the sourceRef
 * records the cancelled order's id so provenance points at what was replaced,
 * not the position symbol (that link is preserved on `symbol`).
 *
 * Invariant: update tickets are submit-and-discard — `updateEquityStopOrder`
 * sends them straight to the broker; they are never staged into the
 * order-ticket pipeline. `sourceRef.type === 'stop_loss'` predicates
 * (order-ticket.component.ts) intentionally do not match 'stop_loss_update'.
 */
export function buildStopLossUpdateTicket(
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
  replacedOrderId: string,
  params: StopOrderParams = {},
  now = new Date(),
): EquityOrderTicket {
  return buildStopLossTicketBase(
    { type: 'stop_loss_update', id: replacedOrderId },
    symbol,
    quantity,
    stopPrice,
    accountNumber,
    params,
    now,
  );
}

/** Shared base for stop-loss ticket builders. Only sourceRef differs between variants. */
function buildStopLossTicketBase(
  sourceRef: OrderTicketSourceRef,
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
  params: StopOrderParams,
  now: Date,
): EquityOrderTicket {
  return {
    id: buildStopLossId(symbol, now),
    refId: crypto.randomUUID(),
    source: OrderSource.POSITION_MANAGEMENT,
    sourceRef,
    status: OrderTicketStatus.STAGED,
    accountNumber,
    side: 'sell',
    orderType: 'stop_loss',
    timeInForce: params.timeInForce ?? 'gtc',
    marketHours: params.marketHours ?? 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    quantity,
    stopPrice: stopPrice.toFixed(2),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
