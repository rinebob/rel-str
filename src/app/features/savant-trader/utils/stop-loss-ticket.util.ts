import {
  EquityOrderTicket,
  InstrumentType,
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
} from '../services/order-ticket.types';

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
  now = new Date(),
): EquityOrderTicket {
  return buildStopLossTicketBase(
    { type: 'stop_loss', id: entry.id },
    symbol,
    quantity,
    stopPrice,
    accountNumber,
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
  now = new Date(),
): EquityOrderTicket {
  return buildStopLossTicketBase(
    { type: 'stop_loss', id: symbol },
    symbol,
    quantity,
    stopPrice,
    accountNumber,
    now,
  );
}

/** Shared base for stop-loss ticket builders. Only sourceRef differs between variants. */
function buildStopLossTicketBase(
  sourceRef: { type: string; id: string },
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
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
    timeInForce: 'gtc',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    quantity,
    stopPrice: stopPrice.toFixed(2),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
