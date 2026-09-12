import {
  computePnL,
  isStopLossProtecting,
  computeProtectedSymbols,
} from './portfolio-pnl.util';
import { BrokerOrder, EquityPosition } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'order-1',
    accountNumber: '123456789',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'sell',
    type: 'stop_market',
    state: 'confirmed',
    quantity: 100,
    cumulativeQuantity: 0,
    price: null,
    stopPrice: 145,
    averageFillPrice: null,
    createdAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function makePosition(overrides: Partial<EquityPosition> = {}): EquityPosition {
  return {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150,
    sharesHeldForSells: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computePnL
// ---------------------------------------------------------------------------

describe('computePnL', () => {
  it('computes positive PnL for a long position when price rises', () => {
    const result = computePnL(150, 155, 100, false);

    expect(result.pnl).toBe(500);
    expect(result.pnlPercent).toBeCloseTo(3.33, 1);
  });

  it('computes negative PnL for a long position when price falls', () => {
    const result = computePnL(150, 145, 100, false);

    expect(result.pnl).toBe(-500);
    expect(result.pnlPercent).toBeCloseTo(-3.33, 1);
  });

  it('inverts the formula for a short position when price rises', () => {
    const result = computePnL(150, 155, 100, true);

    expect(result.pnl).toBe(-500);
    expect(result.pnlPercent).toBeCloseTo(-3.33, 1);
  });

  it('inverts the formula for a short position when price falls', () => {
    const result = computePnL(150, 145, 100, true);

    expect(result.pnl).toBe(500);
    expect(result.pnlPercent).toBeCloseTo(3.33, 1);
  });

  it('returns null PnL when current price is null', () => {
    const result = computePnL(150, null, 100, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when cost basis is zero', () => {
    const result = computePnL(0, 155, 100, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when quantity is zero', () => {
    const result = computePnL(150, 155, 0, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when cost basis is null', () => {
    const result = computePnL(null, 155, 100, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when quantity is null', () => {
    const result = computePnL(150, 155, null, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('computes PnL for fractional quantities', () => {
    const result = computePnL(100, 110, 2.5, false);

    expect(result.pnl).toBe(25);
    expect(result.pnlPercent).toBeCloseTo(10, 1);
  });

  it('computes PnL when current price is zero', () => {
    const result = computePnL(150, 0, 100, false);

    expect(result.pnl).toBe(-15000);
    expect(result.pnlPercent).toBeCloseTo(-100, 1);
  });

  it('returns null PnL when cost basis is NaN', () => {
    const result = computePnL(NaN, 155, 100, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when current price is Infinity', () => {
    const result = computePnL(150, Infinity, 100, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });

  it('returns null PnL when quantity is NaN', () => {
    const result = computePnL(150, 155, NaN, false);

    expect(result.pnl).toBeNull();
    expect(result.pnlPercent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isStopLossProtecting
// ---------------------------------------------------------------------------

describe('isStopLossProtecting', () => {
  it('returns true when stop_market sell order matches a long position by symbol', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(true);
  });

  it('returns true when stop_limit sell order matches a long position by symbol', () => {
    const order = makeOrder({ type: 'stop_limit', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(true);
  });

  it('returns false when order type is not a stop type', () => {
    const order = makeOrder({ type: 'limit', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when order side is buy (buy stop does not protect a long)', () => {
    const order = makeOrder({ type: 'stop_market', side: 'buy', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when symbol does not match any position', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'MSFT' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when positions array is empty', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL' });

    expect(isStopLossProtecting(order, [])).toBe(false);
  });

  it('returns false when order symbol is null', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: null });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when position quantity is zero or null', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 0 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false for unknown order type', () => {
    const order = makeOrder({ type: 'unknown', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when stop order is filled (terminal state)', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'filled' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when stop order is cancelled (terminal state)', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'cancelled' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false when stop order is rejected (terminal state)', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'rejected' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeProtectedSymbols
// ---------------------------------------------------------------------------

describe('computeProtectedSymbols', () => {
  it('returns the set of symbols protected by stop-loss orders', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL' }),
      makeOrder({ orderId: '2', type: 'stop_limit', side: 'sell', symbol: 'NVDA' }),
      makeOrder({ orderId: '3', type: 'limit', side: 'sell', symbol: 'GOOG' }),
    ];
    const positions = [
      makePosition({ symbol: 'AAPL', quantity: 100 }),
      makePosition({ symbol: 'NVDA', quantity: 50 }),
      makePosition({ symbol: 'GOOG', quantity: 25 }),
    ];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(2);
    expect(result.has('AAPL')).toBe(true);
    expect(result.has('NVDA')).toBe(true);
    expect(result.has('GOOG')).toBe(false);
  });

  it('returns empty set when no orders are stop-loss orders', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'market', side: 'sell', symbol: 'AAPL' }),
      makeOrder({ orderId: '2', type: 'limit', side: 'sell', symbol: 'NVDA' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('returns empty set when no positions match stop-loss order symbols', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL' }),
    ];
    const positions = [makePosition({ symbol: 'NVDA', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('returns empty set for empty orders and positions', () => {
    const result = computeProtectedSymbols([], []);

    expect(result.size).toBe(0);
  });

  it('handles multiple orders for the same symbol without duplicates', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL' }),
      makeOrder({ orderId: '2', type: 'stop_limit', side: 'sell', symbol: 'AAPL' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(1);
    expect(result.has('AAPL')).toBe(true);
  });

  it('does not include symbols where the position quantity is zero', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 0 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('does not include symbols where the position quantity is null', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: null })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('does not include symbols from buy-side stop orders', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'buy', symbol: 'AAPL' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('does not include symbols from orders with null symbol', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: null }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('excludes filled stop orders (terminal state)', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'filled' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('excludes cancelled stop orders (terminal state)', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'cancelled' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(0);
  });

  it('includes confirmed stop orders alongside terminal ones', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AAPL', state: 'confirmed' }),
      makeOrder({ orderId: '2', type: 'stop_market', side: 'sell', symbol: 'NVDA', state: 'filled' }),
    ];
    const positions = [
      makePosition({ symbol: 'AAPL', quantity: 100 }),
      makePosition({ symbol: 'NVDA', quantity: 50 }),
    ];

    const result = computeProtectedSymbols(orders, positions);

    expect(result.size).toBe(1);
    expect(result.has('AAPL')).toBe(true);
    expect(result.has('NVDA')).toBe(false);
  });
});
