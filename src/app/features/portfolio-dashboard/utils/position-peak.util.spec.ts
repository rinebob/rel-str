/**
 * position-peak.util specs — holding-period detection + peak derivation (#1413).
 */
import {
  currentHoldingPeriod,
  fillsFromOrders,
  peakSince,
} from './position-peak.util';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { EquityHistoricalBar } from '@robinhood-mcp/contracts';

function order(partial: Partial<BrokerOrder>): BrokerOrder {
  return {
    orderId: 'o1',
    accountNumber: 'A1',
    instrumentType: 'equity',
    symbol: 'QQQ',
    side: 'buy',
    type: 'market',
    state: 'filled',
    quantity: null,
    cumulativeQuantity: null,
    price: null,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: null,
    ...partial,
  };
}

function bar(begins_at: string, high: string): EquityHistoricalBar {
  return {
    begins_at,
    open_price: '0',
    close_price: '0',
    high_price: high,
    low_price: '0',
    volume: 0,
    session: 'reg',
  };
}

describe('fillsFromOrders', () => {
  it('flattens executions across orders and sorts newest-first', () => {
    const fills = fillsFromOrders([
      order({
        side: 'buy',
        executions: [
          { price: 10, quantity: 5, timestamp: '2026-01-01T10:00:00Z' },
          { price: 10, quantity: 5, timestamp: '2026-03-01T10:00:00Z' },
        ],
      }),
      order({
        side: 'sell',
        executions: [{ price: 12, quantity: 3, timestamp: '2026-02-01T10:00:00Z' }],
      }),
    ]);
    expect(fills.map((f) => f.timestamp)).toEqual([
      '2026-03-01T10:00:00Z',
      '2026-02-01T10:00:00Z',
      '2026-01-01T10:00:00Z',
    ]);
    expect(fills.map((f) => f.side)).toEqual(['buy', 'sell', 'buy']);
  });

  it('skips executions missing quantity or timestamp', () => {
    const fills = fillsFromOrders([
      order({
        executions: [
          { price: 10, quantity: null, timestamp: '2026-01-01T10:00:00Z' },
          { price: 10, quantity: 5, timestamp: null },
          { price: 10, quantity: 5, timestamp: '2026-01-02T10:00:00Z' },
        ],
      }),
    ]);
    expect(fills).toHaveLength(1);
  });
});

describe('currentHoldingPeriod', () => {
  const buy = (q: number, t: string) => ({ side: 'buy' as const, quantity: q, timestamp: t });
  const sell = (q: number, t: string) => ({ side: 'sell' as const, quantity: q, timestamp: t });

  it('single buy — entry is that fill', () => {
    const hp = currentHoldingPeriod(10, [buy(10, '2026-01-01T10:00:00Z')]);
    expect(hp).toEqual({
      entryDate: '2026-01-01T10:00:00Z',
      lastFillDate: '2026-01-01T10:00:00Z',
    });
  });

  it('multi-add — entry is the FIRST fill, lastFill is the newest', () => {
    const hp = currentHoldingPeriod(15, [
      buy(5, '2026-03-01T10:00:00Z'),
      buy(10, '2026-01-01T10:00:00Z'),
    ]);
    expect(hp?.entryDate).toBe('2026-01-01T10:00:00Z');
    expect(hp?.lastFillDate).toBe('2026-03-01T10:00:00Z');
  });

  it('partial sell — walk continues past the sell to the opening buy', () => {
    const hp = currentHoldingPeriod(10, [
      buy(5, '2026-03-01T10:00:00Z'),
      sell(5, '2026-02-01T10:00:00Z'),
      buy(10, '2026-01-01T10:00:00Z'),
    ]);
    expect(hp?.entryDate).toBe('2026-01-01T10:00:00Z');
  });

  it('full-exit-then-rebuy — entry is the REBUY, not the original lot', () => {
    const hp = currentHoldingPeriod(5, [
      buy(5, '2026-04-01T10:00:00Z'),
      sell(10, '2026-03-01T10:00:00Z'),
      buy(10, '2026-01-01T10:00:00Z'),
    ]);
    expect(hp?.entryDate).toBe('2026-04-01T10:00:00Z');
  });

  it('entry underivable when window never crosses zero (entry predates fills)', () => {
    const hp = currentHoldingPeriod(10, [sell(5, '2026-02-01T10:00:00Z')]);
    expect(hp?.entryDate).toBeNull();
    expect(hp?.lastFillDate).toBe('2026-02-01T10:00:00Z');
  });

  it('no fills → null', () => {
    expect(currentHoldingPeriod(10, [])).toBeNull();
  });

  it('short position — sell opens the period', () => {
    const hp = currentHoldingPeriod(-5, [sell(5, '2026-01-01T10:00:00Z')]);
    expect(hp?.entryDate).toBe('2026-01-01T10:00:00Z');
  });
});

describe('peakSince', () => {
  it('max high over bars at-or-after the since day, with its date', () => {
    const peak = peakSince(
      [
        bar('2026-01-01T00:00:00Z', '100.50'),
        bar('2026-01-02T00:00:00Z', '112.25'),
        bar('2026-01-03T00:00:00Z', '105.00'),
      ],
      '2026-01-01T10:00:00Z',
    );
    expect(peak).toEqual({ price: 112.25, date: '2026-01-02T00:00:00Z' });
  });

  it('entry-day bar counts even when the fill was intraday (day granularity)', () => {
    const peak = peakSince([bar('2026-01-01T00:00:00Z', '110.00')], '2026-01-01T11:00:00Z');
    expect(peak?.price).toBe(110);
  });

  it('excludes bars before the since day', () => {
    const peak = peakSince(
      [
        bar('2026-01-01T00:00:00Z', '200.00'),
        bar('2026-02-01T00:00:00Z', '90.00'),
      ],
      '2026-02-01T10:00:00Z',
    );
    expect(peak?.price).toBe(90);
  });

  it('null when no bars in range', () => {
    expect(peakSince([bar('2026-01-01T00:00:00Z', '100')], '2026-02-01T00:00:00Z')).toBeNull();
    expect(peakSince([], '2026-01-01T00:00:00Z')).toBeNull();
  });
});
