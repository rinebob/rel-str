/**
 * Tests for MCP → allocation mappers (Blueprint #582 / task #586).
 *
 * Covers the mapping contract: instrument identity (equity=symbol,
 * option=UUID), ×100 option multiplier, legs×executions fill expansion,
 * positionEffect pass-through + equity sell-close inference.
 */

import { toFillInputs, toPositionInputs } from './allocation-mappers';
import type {
  BrokerOrder,
  EquityPosition,
  EquityQuote,
  OptionPosition,
  OptionQuote,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';

const ACCT = '5AC12345';

function equityPos(over: Partial<EquityPosition> = {}): EquityPosition {
  return {
    symbol: 'AAPL',
    quantity: 10,
    averageBuyPrice: 150,
    sharesHeldForSells: 10,
    ...over,
  };
}

function optionPos(over: Partial<OptionPosition> = {}): OptionPosition {
  return {
    instrumentId: 'opt-uuid-1',
    chainSymbol: 'AAPL',
    optionType: 'put',
    strikePrice: 140,
    expirationDate: '2026-10-16',
    quantity: -2,
    averageCost: 3.5,
    ...over,
  };
}

function equityOrder(over: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'eq-1',
    accountNumber: ACCT,
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    state: 'filled',
    quantity: 10,
    cumulativeQuantity: 10,
    price: null,
    stopPrice: null,
    averageFillPrice: 150.1,
    createdAt: '2026-09-20T14:00:00Z',
    ...over,
  };
}

function optionOrder(over: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'ord-multi-1',
    accountNumber: ACCT,
    instrumentType: 'option',
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    state: 'filled',
    quantity: 2,
    cumulativeQuantity: 2,
    price: 0.9,
    stopPrice: null,
    averageFillPrice: 0.88,
    createdAt: '2026-09-21T15:30:00Z',
    ...over,
  };
}

const NO_QUOTES = {
  eq: new Map<string, EquityQuote>(),
  opt: new Map<string, OptionQuote>(),
};

describe('toPositionInputs', () => {
  it('keys equity positions by symbol with live-quote market value', () => {
    const q = new Map<string, EquityQuote>([
      ['AAPL', { symbol: 'AAPL', lastTradePrice: 160, previousClose: 158 }],
    ]);
    const out = toPositionInputs([equityPos()], [], q, NO_QUOTES.opt);
    expect(out).toEqual([
      { instrumentId: 'AAPL', quantity: 10, marketValue: 1600, costBasis: 1500 },
    ]);
  });

  it('keys option positions by instrumentId and applies the x100 multiplier', () => {
    const q = new Map<string, OptionQuote>([
      ['opt-uuid-1', { instrumentId: 'opt-uuid-1', lastTradePrice: 3.0, previousClose: 2.9 }],
    ]);
    const out = toPositionInputs([], [optionPos()], NO_QUOTES.eq, q);
    expect(out).toEqual([
      // -2 contracts × $3.00 × 100 — signed value stays negative for shorts.
      { instrumentId: 'opt-uuid-1', quantity: -2, marketValue: -600, costBasis: -700 },
    ]);
  });

  it('produces NaN marketValue when the quote is missing (filtered downstream)', () => {
    const out = toPositionInputs([equityPos()], [], NO_QUOTES.eq, NO_QUOTES.opt);
    expect(out[0].instrumentId).toBe('AAPL');
    expect(Number.isNaN(out[0].marketValue)).toBe(true);
  });
});

describe('toFillInputs', () => {
  it('expands equity orders to per-execution fills', () => {
    const order = equityOrder({
      executions: [
        { price: 150, quantity: 4, timestamp: '2026-09-20T14:00:01Z' },
        { price: 150.3, quantity: 6, timestamp: '2026-09-20T14:00:02Z' },
      ],
    });
    const fills = toFillInputs([order], new Map());
    expect(fills).toEqual([
      { instrumentId: 'AAPL', side: 'buy', positionEffect: undefined, quantity: 4, price: 150, multiplier: 1, filledAt: '2026-09-20T14:00:01Z' },
      { instrumentId: 'AAPL', side: 'buy', positionEffect: undefined, quantity: 6, price: 150.3, multiplier: 1, filledAt: '2026-09-20T14:00:02Z' },
    ]);
  });

  it('falls back to one order-level fill when executions are absent', () => {
    const fills = toFillInputs([equityOrder()], new Map());
    expect(fills).toEqual([
      { instrumentId: 'AAPL', side: 'buy', positionEffect: undefined, quantity: 10, price: 150.1, multiplier: 1, filledAt: '2026-09-20T14:00:00Z' },
    ]);
  });

  it('skips non-filled states', () => {
    for (const state of ['queued', 'cancelled', 'rejected'] as const) {
      expect(toFillInputs([equityOrder({ state })], new Map())).toEqual([]);
    }
    expect(toFillInputs([equityOrder({ state: 'partially_filled' })], new Map()).length).toBe(1);
  });

  it('expands a two-leg spread into per-instrument fills sharing the order id', () => {
    const order = optionOrder({
      legs: [
        { side: 'buy', optionId: 'uuid-long', quantity: 2, positionEffect: 'open' },
        { side: 'sell', optionId: 'uuid-short', quantity: 2, positionEffect: 'open' },
      ],
    });
    const fills = toFillInputs([order], new Map());
    expect(fills).toEqual([
      { instrumentId: 'uuid-long', side: 'buy', positionEffect: 'open', quantity: 2, price: 0.88, multiplier: 100, filledAt: '2026-09-21T15:30:00Z' },
      { instrumentId: 'uuid-short', side: 'sell', positionEffect: 'open', quantity: 2, price: 0.88, multiplier: 100, filledAt: '2026-09-21T15:30:00Z' },
    ]);
  });

  it('skips an option order without legs — chain symbol is not an instrument id', () => {
    expect(toFillInputs([optionOrder({ legs: undefined })], new Map())).toEqual([]);
  });

  it('skips legs with no optionId', () => {
    const order = optionOrder({
      legs: [{ side: 'buy', optionId: null, quantity: 1, positionEffect: 'open' }],
    });
    expect(toFillInputs([order], new Map())).toEqual([]);
  });

  it('infers positionEffect=close for an equity sell bounded by sharesHeldForSells', () => {
    const positions = new Map([['AAPL', equityPos({ sharesHeldForSells: 10 })]]);
    const fills = toFillInputs(
      [equityOrder({ side: 'sell', quantity: 4, cumulativeQuantity: 4 })],
      positions,
    );
    expect(fills[0].positionEffect).toBe('close');
  });

  it('leaves positionEffect unset when the sell exceeds sellable shares (short-open)', () => {
    const positions = new Map([['AAPL', equityPos({ sharesHeldForSells: 2 })]]);
    const fills = toFillInputs(
      [equityOrder({ side: 'sell', quantity: 10, cumulativeQuantity: 10 })],
      positions,
    );
    expect(fills[0].positionEffect).toBeUndefined();
  });

  it('leaves positionEffect unset when no matching position exists (truncated history → no phantom close)', () => {
    const fills = toFillInputs(
      [equityOrder({ side: 'sell', quantity: 4, cumulativeQuantity: 4 })],
      new Map(),
    );
    expect(fills[0].positionEffect).toBeUndefined();
  });
});
