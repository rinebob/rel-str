import {
  computePnL,
  isStopLossProtecting,
  computeProtectedSymbols,
  computeEntryDates,
  isUpdatableStopOrder,
  updatableStopsBySymbol,
  protectiveStopsBySymbol,
  computeStopUpdateCandidates,
} from './portfolio-pnl.util';
import { BrokerOrder, EquityPosition } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { PositionPeak } from './position-peak.util';

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

// ---------------------------------------------------------------------------
// computeStopUpdateCandidates (#890) — Stop Audit peak-exposure ratchet
// ---------------------------------------------------------------------------

describe('computeStopUpdateCandidates', () => {
  const makePeak = (
    lifetimePrice: number | null,
    sinceLastFillPrice: number | null = null,
  ): PositionPeak => ({
    symbol: 'AAPL',
    entryDate: '2026-01-05',
    lastFillDate: '2026-01-05',
    lifetime: lifetimePrice === null ? null : { price: lifetimePrice, date: '2026-02-10' },
    sinceLastFill:
      sinceLastFillPrice === null ? null : { price: sinceLastFillPrice, date: '2026-02-20' },
  });

  it('marks a stop for update when its exposure exceeds the giveback', () => {
    // peak 200, giveback 8% → floor 184 > current stop 145 → tighten.
    const order = makeOrder({ orderId: 's1', symbol: 'AAPL', stopPrice: 145 });
    const positions = [{ ...makePosition({ symbol: 'AAPL' }), currentPrice: 190 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, 8);

    expect(c.order).toBe(order);
    expect(c.symbol).toBe('AAPL');
    expect(c.currentStopPrice).toBe(145);
    expect(c.peakPrice).toBe(200);
    expect(c.exposurePct).toBeCloseTo(27.5, 1);
    expect(c.computedStopPrice).toBe(184);
    expect(c.disposition).toBe('update');
  });

  it('marks within-policy when the stop is already at or above the giveback floor', () => {
    // peak 200, giveback 8% → floor 184 < current stop 190 → compliant.
    const order = makeOrder({ stopPrice: 190 });
    const positions = [{ ...makePosition(), currentPrice: 195 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, 8);

    expect(c.computedStopPrice).toBe(184);
    expect(c.exposurePct).toBe(5);
    expect(c.disposition).toBe('within-policy');
  });

  it('marks within-policy at the exact boundary — computed equals current, no churn', () => {
    // peak 200, giveback 8% → floor 184 = current stop → no-op avoided.
    const order = makeOrder({ stopPrice: 184 });
    const positions = [{ ...makePosition(), currentPrice: 190 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, 8);

    expect(c.computedStopPrice).toBe(184);
    expect(c.disposition).toBe('within-policy');
  });

  it('compares at cent precision — a sub-cent edge is not an update', () => {
    // peak 161.116, giveback 10% → floor 145.0044 → rounds to 145.00,
    // the ticket's effective price — equal to the resting 145.00.
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 150 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(161.116) }, 10);

    expect(c.computedStopPrice).toBe(145);
    expect(c.disposition).toBe('within-policy');
  });

  it('anchors to lifetime peak, not sinceLastFill — a lower post-add peak does not relax the audit', () => {
    // lifetime 300, sinceLastFill 200, giveback 8% → floor must be
    // computed off 300 (276), not 200 (184). A stop at 250 is exposed
    // only when measured against the lifetime peak.
    const order = makeOrder({ stopPrice: 250 });
    const positions = [{ ...makePosition(), currentPrice: 280 }];
    const peak = makePeak(300, 200);

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: peak }, 8);

    expect(c.peakPrice).toBe(300);
    expect(c.computedStopPrice).toBe(276);
    expect(c.disposition).toBe('update');
  });

  it('emits one candidate per updatable stop, including a same-symbol ladder', () => {
    const s1 = makeOrder({ orderId: 's1', symbol: 'AAPL', stopPrice: 140 });
    const s2 = makeOrder({ orderId: 's2', symbol: 'AAPL', stopPrice: 150 });
    const m1 = makeOrder({ orderId: 'm1', symbol: 'MSFT', stopPrice: 400 });
    const positions = [
      { ...makePosition({ symbol: 'AAPL' }), currentPrice: 200 },
      { ...makePosition({ symbol: 'MSFT' }), currentPrice: 420 },
    ];
    const peaks = {
      AAPL: makePeak(200),
      MSFT: { ...makePeak(410), symbol: 'MSFT' },
    };

    const result = computeStopUpdateCandidates(positions, [s1, s2, m1], peaks, 10);

    expect(result.map((c) => c.order.orderId)).toEqual(['s1', 's2', 'm1']);
    // MSFT floor 410 × 0.9 = 369 < resting 400 → within policy.
    expect(result[2].computedStopPrice).toBe(369);
    expect(result[2].disposition).toBe('within-policy');
  });

  it('excludes non-updatable orders and stops on symbols with no held position', () => {
    const limit = makeOrder({ orderId: 'sl', type: 'stop_limit' });
    const orphan = makeOrder({ orderId: 'z1', symbol: 'ZZZZ' });
    const positions = [{ ...makePosition(), currentPrice: 200 }];

    const result = computeStopUpdateCandidates(positions, [limit, orphan], { AAPL: makePeak(200) }, 8);

    expect(result).toEqual([]);
  });

  it('marks skip-no-peak when no peak is derivable for the symbol', () => {
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 200 }];

    const [c] = computeStopUpdateCandidates(positions, [order], {}, 8);

    expect(c.peakPrice).toBeNull();
    expect(c.exposurePct).toBeNull();
    expect(c.computedStopPrice).toBeNull();
    expect(c.disposition).toBe('skip-no-peak');
  });

  it('marks skip-no-peak when the peak record exists but lifetime is underived', () => {
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 200 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(null) }, 8);

    expect(c.disposition).toBe('skip-no-peak');
  });

  it('marks skip-no-price when the order carries no stopPrice (stop_market with a bare trigger)', () => {
    const order = makeOrder({ stopPrice: null });
    const positions = [{ ...makePosition(), currentPrice: 200 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, 8);

    expect(c.currentStopPrice).toBeNull();
    expect(c.exposurePct).toBeNull();
    expect(c.disposition).toBe('skip-no-price');
  });

  it('marks skip-above-market when the floor sits at/above the mark — the position already blew through the giveback', () => {
    // peak 200, giveback 8% → floor 184, but mark has fallen to 175:
    // a sell-stop at 184 triggers immediately on placement — the batch
    // leaves it for a manual decision instead of firing it.
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 175 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, 8);

    expect(c.computedStopPrice).toBe(184);
    expect(c.disposition).toBe('skip-above-market');
  });

  it('clamps a negative giveback to zero — floor becomes the peak, never above it', () => {
    // Contract-level defense: −5% unclamped would compute peak × 1.05 —
    // a stop ABOVE the recorded peak. Clamped to 0 the floor is the peak.
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 210 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(200) }, -5);

    expect(c.computedStopPrice).toBe(200);
    expect(c.disposition).toBe('update');
  });

  it('marks skip-no-peak on a non-finite peak price — not the mislabeled no-price skip', () => {
    const order = makeOrder({ stopPrice: 145 });
    const positions = [{ ...makePosition(), currentPrice: 200 }];

    const [c] = computeStopUpdateCandidates(positions, [order], { AAPL: makePeak(Infinity) }, 8);

    expect(c.peakPrice).toBeNull();
    expect(c.exposurePct).toBeNull();
    expect(c.disposition).toBe('skip-no-peak');
  });
});
