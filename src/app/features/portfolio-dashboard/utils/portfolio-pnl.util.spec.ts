import {
  computePnL,
  isStopLossProtecting,
  computeProtectedSymbols,
  computeEntryDates,
  isUpdatableStopOrder,
  updatableStopsBySymbol,
  protectiveStopsBySymbol,
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

  it('returns false when order type is not a stop type and has no stop price', () => {
    const order = makeOrder({ type: 'limit', side: 'sell', symbol: 'AAPL', stopPrice: null });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns true when market sell order has a stop price (Robinhood stop order)', () => {
    const order = makeOrder({ type: 'market', side: 'sell', symbol: 'AAPL', stopPrice: 150.00 });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(true);
  });

  it('returns true when limit sell order has a stop price (Robinhood stop-limit)', () => {
    const order = makeOrder({ type: 'limit', side: 'sell', symbol: 'AAPL', stopPrice: 150.00 });
    const positions = [makePosition({ symbol: 'AAPL', quantity: 100 })];

    expect(isStopLossProtecting(order, positions)).toBe(true);
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

  it('returns false when the position is short — a sell stop does not protect it', () => {
    const order = makeOrder({ type: 'stop_market', side: 'sell', symbol: 'AAPL' });
    const positions = [makePosition({ symbol: 'AAPL', quantity: -100 })];

    expect(isStopLossProtecting(order, positions)).toBe(false);
  });

  it('returns false for unknown order type with no stop price', () => {
    const order = makeOrder({ type: 'unknown', side: 'sell', symbol: 'AAPL', stopPrice: null });
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
      makeOrder({ orderId: '3', type: 'limit', side: 'sell', symbol: 'GOOG', stopPrice: null }),
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
      makeOrder({ orderId: '1', type: 'market', side: 'sell', symbol: 'AAPL', stopPrice: null }),
      makeOrder({ orderId: '2', type: 'limit', side: 'sell', symbol: 'NVDA', stopPrice: null }),
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

  it('detects market sell orders with stop prices as protective (Robinhood stop orders)', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'market', side: 'sell', symbol: 'AAPL', stopPrice: 150.00 }),
      makeOrder({ orderId: '2', type: 'market', side: 'sell', symbol: 'NVDA', stopPrice: null }),
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

// ---------------------------------------------------------------------------
// computeEntryDates
// ---------------------------------------------------------------------------

describe('computeEntryDates', () => {
  it('returns the earliest createdAt among filled orders for a symbol', () => {
    const orders = [
      makeOrder({ orderId: '1', side: 'buy', state: 'filled', createdAt: '2026-03-10T14:00:00Z' }),
      makeOrder({ orderId: '2', side: 'buy', state: 'filled', createdAt: '2026-01-15T10:00:00Z' }),
      makeOrder({ orderId: '3', side: 'buy', state: 'filled', createdAt: '2026-02-20T09:00:00Z' }),
    ];

    const result = computeEntryDates(orders);

    expect(result.get('buy:AAPL')).toBe('2026-01-15T10:00:00Z');
  });

  it('prefers the earliest execution timestamp over createdAt', () => {
    const orders = [
      makeOrder({
        orderId: '1',
        side: 'buy',
        state: 'filled',
        createdAt: '2026-01-15T10:00:00Z',
        executions: [
          { price: 150, quantity: 50, timestamp: '2026-01-16T15:00:00Z' },
          { price: 149, quantity: 50, timestamp: '2026-01-15T14:30:00Z' },
        ],
      }),
    ];

    const result = computeEntryDates(orders);

    expect(result.get('buy:AAPL')).toBe('2026-01-15T14:30:00Z');
  });

  it('keys sell-side fills separately for short positions', () => {
    const orders = [
      makeOrder({ orderId: '1', side: 'buy', state: 'filled', createdAt: '2026-01-15T10:00:00Z' }),
      makeOrder({ orderId: '2', side: 'sell', state: 'filled', createdAt: '2026-02-01T10:00:00Z' }),
    ];

    const result = computeEntryDates(orders);

    expect(result.get('buy:AAPL')).toBe('2026-01-15T10:00:00Z');
    expect(result.get('sell:AAPL')).toBe('2026-02-01T10:00:00Z');
  });

  it('includes partially_filled orders and skips non-executed states', () => {
    const orders = [
      makeOrder({ orderId: '1', side: 'buy', state: 'confirmed', createdAt: '2026-01-01T10:00:00Z' }),
      makeOrder({ orderId: '2', side: 'buy', state: 'cancelled', createdAt: '2026-01-02T10:00:00Z' }),
      makeOrder({ orderId: '3', side: 'buy', state: 'partially_filled', createdAt: '2026-01-20T10:00:00Z' }),
    ];

    const result = computeEntryDates(orders);

    expect(result.get('buy:AAPL')).toBe('2026-01-20T10:00:00Z');
  });

  it('returns no entry when orders have no timestamp or symbol', () => {
    const orders = [
      makeOrder({ orderId: '1', side: 'buy', state: 'filled', createdAt: null }),
      makeOrder({ orderId: '2', side: 'buy', state: 'filled', symbol: null }),
    ];

    const result = computeEntryDates(orders);

    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isUpdatableStopOrder / updatableStopsBySymbol (#888)
// ---------------------------------------------------------------------------

describe('isUpdatableStopOrder', () => {
  it('is true for a live stop_market sell', () => {
    expect(isUpdatableStopOrder(makeOrder({ type: 'stop_market' }))).toBe(true);
  });

  it('is true for a market-typed sell carrying a stopPrice', () => {
    expect(isUpdatableStopOrder(makeOrder({ type: 'market', stopPrice: 150 }))).toBe(true);
  });

  it('is false for stop_limit — updating would silently downgrade it to stop-market', () => {
    expect(isUpdatableStopOrder(makeOrder({ type: 'stop_limit' }))).toBe(false);
  });

  it('is false for a limit-typed order carrying a stopPrice — RH returns stop-limits that way', () => {
    expect(
      isUpdatableStopOrder(makeOrder({ type: 'limit', price: 144, stopPrice: 145 })),
    ).toBe(false);
    expect(
      isUpdatableStopOrder(makeOrder({ type: 'limit', stopPrice: 145 })),
    ).toBe(false);
  });

  it('is false for an option order — updateEquityStopOrder is equity-only', () => {
    expect(isUpdatableStopOrder(makeOrder({ instrumentType: 'option' }))).toBe(false);
  });

  it('is false for a buy-side stop, a terminal stop, and a plain sell with no stopPrice', () => {
    expect(isUpdatableStopOrder(makeOrder({ side: 'buy' }))).toBe(false);
    expect(isUpdatableStopOrder(makeOrder({ state: 'cancelled' }))).toBe(false);
    expect(isUpdatableStopOrder(makeOrder({ type: 'limit', stopPrice: null }))).toBe(false);
  });
});

describe('updatableStopsBySymbol', () => {
  it('groups updatable stops under their symbol, preserving order', () => {
    const a1 = makeOrder({ orderId: 'a1', symbol: 'AAPL' });
    const a2 = makeOrder({ orderId: 'a2', symbol: 'AAPL' });
    const m1 = makeOrder({ orderId: 'm1', symbol: 'MSFT' });
    const positions = [makePosition({ symbol: 'AAPL' }), makePosition({ symbol: 'MSFT' })];

    const result = updatableStopsBySymbol([a1, m1, a2], positions);

    expect(result.get('AAPL')).toEqual([a1, a2]);
    expect(result.get('MSFT')).toEqual([m1]);
    expect(result.size).toBe(2);
  });

  it('excludes stops whose symbol has no held position', () => {
    const orders = [
      makeOrder({ orderId: 'a1', symbol: 'AAPL' }),
      makeOrder({ orderId: 'z1', symbol: 'ZZZZ' }),
    ];

    const result = updatableStopsBySymbol(orders, [makePosition({ symbol: 'AAPL' })]);

    expect(result.has('ZZZZ')).toBe(false);
    expect(result.get('AAPL')?.length).toBe(1);
  });

  it('excludes zero-quantity positions and stop_limit/option orders from every group', () => {
    const orders = [
      makeOrder({ orderId: 'a1', symbol: 'AAPL' }),
      makeOrder({ orderId: 'a2', symbol: 'AAPL', type: 'stop_limit' }),
      makeOrder({ orderId: 'a3', symbol: 'AAPL', instrumentType: 'option' }),
      makeOrder({ orderId: 'q1', symbol: 'QQQ' }),
    ];
    const positions = [makePosition({ symbol: 'AAPL' }), makePosition({ symbol: 'QQQ', quantity: 0 })];

    const result = updatableStopsBySymbol(orders, positions);

    expect(result.get('AAPL')?.map((o) => o.orderId)).toEqual(['a1']);
    expect(result.has('QQQ')).toBe(false);
  });

  it('returns an empty map when nothing qualifies', () => {
    expect(updatableStopsBySymbol([], [makePosition()])).toEqual(new Map());
    expect(
      updatableStopsBySymbol([makeOrder({ type: 'stop_limit' })], [makePosition()]),
    ).toEqual(new Map());
  });
});

// ---------------------------------------------------------------------------
// protectiveStopsBySymbol (#1414) — display stop order per symbol
// ---------------------------------------------------------------------------

describe('protectiveStopsBySymbol', () => {
  it('maps the live stop order under its symbol — stop_market and stop_limit both', () => {
    const orders = [
      makeOrder({ orderId: 'sm', type: 'stop_market', symbol: 'AAPL', stopPrice: 145 }),
      makeOrder({ orderId: 'sl', type: 'stop_limit', symbol: 'NVDA', stopPrice: 88 }),
    ];
    const positions = [
      makePosition({ symbol: 'AAPL' }),
      makePosition({ symbol: 'NVDA', quantity: 25 }),
    ];

    const result = protectiveStopsBySymbol(orders, positions);

    expect(result.get('AAPL')?.orderId).toBe('sm');
    expect(result.get('NVDA')?.orderId).toBe('sl');
  });

  it('includes market-typed sells carrying a stopPrice (RH stop order shape)', () => {
    const orders = [
      makeOrder({ orderId: 'm', type: 'market', symbol: 'AAPL', stopPrice: 145 }),
    ];

    const result = protectiveStopsBySymbol(orders, [makePosition()]);

    expect(result.get('AAPL')?.orderId).toBe('m');
  });

  it('picks the highest stopPrice when a symbol has multiple stops — the first to trigger', () => {
    const orders = [
      makeOrder({ orderId: 'low', type: 'stop_market', symbol: 'AAPL', stopPrice: 140 }),
      makeOrder({ orderId: 'high', type: 'stop_limit', symbol: 'AAPL', stopPrice: 148 }),
      makeOrder({ orderId: 'mid', type: 'stop_market', symbol: 'AAPL', stopPrice: 145 }),
    ];

    const result = protectiveStopsBySymbol(orders, [makePosition()]);

    expect(result.get('AAPL')?.orderId).toBe('high');
  });

  it('excludes terminal stops, buy-side stops, and symbols with no long position', () => {
    const orders = [
      makeOrder({ orderId: 'term', symbol: 'AAPL', state: 'cancelled' }),
      makeOrder({ orderId: 'buy', symbol: 'MSFT', side: 'buy' }),
      makeOrder({ orderId: 'noPos', symbol: 'TSLA' }),
      makeOrder({ orderId: 'short', symbol: 'AMD' }),
    ];
    const positions = [
      makePosition({ symbol: 'AAPL' }),
      makePosition({ symbol: 'MSFT' }),
      makePosition({ symbol: 'AMD', quantity: -50 }),
    ];

    const result = protectiveStopsBySymbol(orders, positions);

    expect(result.size).toBe(0);
  });

  it('returns an empty map for empty input', () => {
    expect(protectiveStopsBySymbol([], []).size).toBe(0);
  });
});

describe('computeProtectedSymbols — long-only rule (#1414)', () => {
  it('does not mark a shorted symbol protected by a sell stop — the row stays actionable', () => {
    const orders = [
      makeOrder({ orderId: '1', type: 'stop_market', side: 'sell', symbol: 'AMD' }),
    ];
    const positions = [makePosition({ symbol: 'AMD', quantity: -50 })];

    expect(computeProtectedSymbols(orders, positions).size).toBe(0);
  });
});
