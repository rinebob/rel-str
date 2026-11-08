/**
 * PositionPeakService specs (#1413) — paginated fills walk + batched
 * historicals composition.
 */
import { TestBed } from '@angular/core/testing';
import { PositionPeakService } from './position-peak.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import {
  BrokerOrder,
  EquityPosition,
  EquityOrdersPage,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { EquityHistoricalsResult } from '@robinhood-mcp/contracts';

describe('PositionPeakService', () => {
  let service: PositionPeakService;
  let client: jest.Mocked<
    Pick<RobinhoodMcpClient, 'equityOrdersPageSpec' | 'executeBatch' | 'getEquityHistoricals'>
  >;

  const pos = (symbol: string, quantity: number): EquityPosition => ({
    symbol,
    quantity,
    averageBuyPrice: 100,
    sharesHeldForSells: 0,
  });

  const filledOrder = (symbol: string, side: 'buy' | 'sell', qty: number, ts: string): BrokerOrder => ({
    orderId: `o-${ts}`,
    accountNumber: 'A1',
    instrumentType: 'equity',
    symbol,
    side,
    type: 'market',
    state: 'filled',
    quantity: qty,
    cumulativeQuantity: qty,
    price: null,
    stopPrice: null,
    averageFillPrice: null,
    createdAt: ts,
    executions: [{ price: 100, quantity: qty, timestamp: ts }],
  });

  const page = (orders: BrokerOrder[], next: string | null = null): EquityOrdersPage => ({
    orders,
    next,
  });

  const hist = (symbol: string, bars: { begins_at: string; high_price: string }[]): EquityHistoricalsResult => ({
    data: {
      results: [
        {
          symbol,
          interval: 'day',
          bounds: 'regular',
          bars: bars.map((b) => ({
            ...b,
            open_price: '0',
            close_price: '0',
            low_price: '0',
            volume: 0,
            session: 'reg',
          })),
        },
      ],
    },
  });

  /** executeBatch mock keyed by the spec's args — returns a page per
   *  (symbol, cursor) lookup the spec provides. */
  function mockPages(pagesByKey: Map<string, EquityOrdersPage>): void {
    client.equityOrdersPageSpec.mockImplementation((accountNumber, opts) => ({
      tool: 'get_equity_orders',
      args: { account_number: accountNumber, symbol: opts?.symbol, cursor: opts?.cursor },
      parse: (r: unknown) => r as EquityOrdersPage,
    }));
    client.executeBatch.mockImplementation(async (specs) =>
      (specs as { args: { symbol?: string; cursor?: string } }[]).map((s) => {
        const key = `${s.args.symbol}::${s.args.cursor ?? ''}`;
        const value = pagesByKey.get(key);
        return value === undefined
          ? { status: 'rejected' as const, reason: new Error(`no page for ${key}`) }
          : { status: 'fulfilled' as const, value };
      }),
    );
  }

  beforeEach(() => {
    client = {
      equityOrdersPageSpec: jest.fn(),
      executeBatch: jest.fn(),
      getEquityHistoricals: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: RobinhoodMcpClient, useValue: client }],
    });
    service = TestBed.inject(PositionPeakService);
  });

  it('single position — page-1 fills resolve entry, peaks from day bars', async () => {
    mockPages(
      new Map([
        ['QQQ::', page([filledOrder('QQQ', 'buy', 10, '2026-01-10T10:00:00Z')])],
      ]),
    );
    client.getEquityHistoricals.mockResolvedValue(
      hist('QQQ', [
        { begins_at: '2026-01-10T00:00:00Z', high_price: '100.00' },
        { begins_at: '2026-02-01T00:00:00Z', high_price: '120.50' },
      ]),
    );

    const peaks = await service.derivePeaks('A1', [pos('QQQ', 10)]);

    expect(peaks['QQQ'].entryDate).toBe('2026-01-10T10:00:00Z');
    expect(peaks['QQQ'].lifetime).toEqual({ price: 120.5, date: '2026-02-01T00:00:00Z' });
    expect(peaks['QQQ'].sinceLastFill).toEqual(peaks['QQQ'].lifetime);
  });

  it('paginates per symbol until the walk crosses zero (QQQ case)', async () => {
    mockPages(
      new Map([
        // Page 1: only sells in the window — cumulative never reaches +0.312
        ['QQQ::', page([filledOrder('QQQ', 'sell', 10, '2025-12-01T10:00:00Z')], 'C2')],
        // Page 2: buy10 + buy0.312 (the adds that the Dec sell walked back to)
        [
          'QQQ::C2',
          page([
            filledOrder('QQQ', 'buy', 0.312, '2025-07-15T10:00:00Z'),
            filledOrder('QQQ', 'buy', 10, '2025-06-01T10:00:00Z'),
          ]),
        ],
      ]),
    );
    client.getEquityHistoricals.mockResolvedValue(
      hist('QQQ', [{ begins_at: '2025-06-01T00:00:00Z', high_price: '500.00' }]),
    );

    const peaks = await service.derivePeaks('A1', [pos('QQQ', 0.312)]);

    expect(peaks['QQQ'].entryDate).toBe('2025-06-01T10:00:00Z');
    expect(peaks['QQQ'].lastFillDate).toBe('2025-12-01T10:00:00Z');
    expect(client.executeBatch).toHaveBeenCalledTimes(2);
  });

  it('exhausted history → entryDate null, but sinceLastFill still derives', async () => {
    mockPages(
      new Map([
        ['GPRO::', page([filledOrder('GPRO', 'sell', 5, '2026-01-01T10:00:00Z')])],
      ]),
    );
    client.getEquityHistoricals.mockResolvedValue(
      hist('GPRO', [{ begins_at: '2026-01-01T00:00:00Z', high_price: '9.99' }]),
    );

    const peaks = await service.derivePeaks('A1', [pos('GPRO', 10)]);

    expect(peaks['GPRO'].entryDate).toBeNull();
    expect(peaks['GPRO'].lifetime).toBeNull();
    expect(peaks['GPRO'].lastFillDate).toBe('2026-01-01T10:00:00Z');
    expect(peaks['GPRO'].sinceLastFill).toEqual({ price: 9.99, date: '2026-01-01T00:00:00Z' });
  });

  it('zero fills → all nulls, no historicals call for that symbol', async () => {
    mockPages(new Map([['GPRO::', page([])]]));
    client.getEquityHistoricals.mockResolvedValue(hist('GPRO', []));

    const peaks = await service.derivePeaks('A1', [pos('GPRO', 1)]);

    expect(peaks['GPRO']).toEqual({
      symbol: 'GPRO',
      entryDate: null,
      lastFillDate: null,
      lifetime: null,
      sinceLastFill: null,
    });
  });

  it('skips zero-quantity positions without any fills call', async () => {
    mockPages(new Map());
    const peaks = await service.derivePeaks('A1', [pos('QQQ', 0)]);
    expect(peaks['QQQ']).toBeUndefined();
    expect(client.executeBatch).not.toHaveBeenCalled();
  });

  it('historicals requests are batched in chunks of 10 symbols', async () => {
    const positions = Array.from({ length: 11 }, (_, i) => pos(`S${i}`, 5));
    const pages = new Map(
      positions.map((p) => [`${p.symbol}::`, page([filledOrder(p.symbol, 'buy', 5, '2026-01-01T10:00:00Z')])]),
    );
    mockPages(pages);
    client.getEquityHistoricals.mockResolvedValue(hist('S0', []));

    await service.derivePeaks('A1', positions);

    const calls = client.getEquityHistoricals.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toHaveLength(10);
    expect(calls[1][0]).toHaveLength(1);
    expect(calls[0][1]).toBe('day');
  });

    it('chunks each fills round at the 20-call batch limit', async () => {
      const positions = Array.from({ length: 21 }, (_, i) => pos(`S${i}`, 5));
      const pages = new Map(
        positions.map((p) => [`${p.symbol}::`, page([filledOrder(p.symbol, 'buy', 5, '2026-01-01T10:00:00Z')])]),
      );
      mockPages(pages);
      client.getEquityHistoricals.mockResolvedValue(hist('S0', []));

      await service.derivePeaks('A1', positions);

      // Round 1 splits into 20 + 1 — executeBatch rejects over-limit calls.
      const calls = client.executeBatch.mock.calls;
      expect(calls.length).toBe(2);
      expect((calls[0][0] as unknown[]).length).toBe(20);
      expect((calls[1][0] as unknown[]).length).toBe(1);
    });

    it('a failed page marks the symbol underivable without failing the rest', async () => {
    mockPages(
      new Map([['OK::', page([filledOrder('OK', 'buy', 5, '2026-01-01T10:00:00Z')])]]),
    );
    client.getEquityHistoricals.mockResolvedValue(
      hist('OK', [{ begins_at: '2026-01-01T00:00:00Z', high_price: '50.00' }]),
    );

    const peaks = await service.derivePeaks('A1', [pos('OK', 5), pos('BROKEN', 5)]);

    expect(peaks['OK'].entryDate).toBe('2026-01-01T10:00:00Z');
    expect(peaks['BROKEN'].entryDate).toBeNull();
  });
});
