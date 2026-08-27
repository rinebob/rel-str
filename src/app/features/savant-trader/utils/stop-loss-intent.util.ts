import {
  EquityOrderIntent,
  InstrumentType,
  OrderIntent,
  OrderIntentStatus,
  OrderSource,
} from '../services/order-intent.types';

export function buildStopLossIntent(
  entry: OrderIntent,
  symbol: string,
  quantity: string,
  stopPrice: number,
  accountNumber: string,
  now = new Date(),
): EquityOrderIntent {
  return {
    id: `${entry.id}-SL`,
    refId: crypto.randomUUID(),
    source: OrderSource.POSITION_MANAGEMENT,
    sourceRef: { type: 'stop_loss', id: entry.id },
    status: OrderIntentStatus.STAGED,
    accountNumber,
    side: 'sell',
    orderType: 'stop_market',
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
