/**
 * ScannerChartStore spec (#1098/#1308) — per-symbol dedupe + session cache
 * + settled-error no-refetch + clearError retry seam for the untracked
 * popup's daily bars. The client is mocked at the getEquityHistoricals
 * seam — the canonical #1259 path owns the wire args and result gating;
 * these specs pin the store's contract, not the MCP call shape.
 */
import { TestBed } from '@angular/core/testing';
import { ScannerChartStore } from './scanner-chart.store';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { RobinhoodMcpError } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  ToolExecutionErrorCategory,
  type EquityHistoricalsResult,
} from '@robinhood-mcp/contracts';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const okResult = (symbol: string, closes = 3): EquityHistoricalsResult => ({
  data: {
    results: [
      {
        symbol,
        interval: 'day',
        bounds: 'regular',
        bars: Array.from({ length: closes }, (_, i) => ({
          begins_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
          open_price: '100',
          close_price: `${100 + i}`,
          high_price: '105',
          low_price: '95',
          volume: 1000,
          session: 'reg',
        })),
      },
    ],
  },
});

describe('ScannerChartStore', () => {
  let store: InstanceType<typeof ScannerChartStore>;
  let client: { getEquityHistoricals: jest.Mock };

  beforeEach(() => {
    client = { getEquityHistoricals: jest.fn() };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ScannerChartStore,
        { provide: RobinhoodMcpClient, useValue: client },
      ],
    });
    store = TestBed.inject(ScannerChartStore);
  });

  it('ensureBars fetches one day-interval range and caches the PriceBars', async () => {
    client.getEquityHistoricals.mockResolvedValue(okResult('XYZ'));
    store.ensureBars('xyz');
    expect(client.getEquityHistoricals).toHaveBeenCalledTimes(1);
    const [symbols, interval, startTime] =
      client.getEquityHistoricals.mock.calls[0];
    expect(symbols).toEqual(['XYZ']);
    expect(interval).toBe('day');
    expect(startTime).toEqual(expect.any(String));
    await flush();
    expect(store.bars()['XYZ']).toHaveLength(3);
    expect(store.bars()['XYZ'][0].close).toBe(100);
    expect(store.loading()['XYZ']).toBe(false);
  });

  it('dedupes in-flight calls — a second ensureBars while loading is a no-op', async () => {
    let resolve!: (v: EquityHistoricalsResult) => void;
    client.getEquityHistoricals.mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    store.ensureBars('AAPL');
    store.ensureBars('AAPL');
    expect(client.getEquityHistoricals).toHaveBeenCalledTimes(1);
    resolve(okResult('AAPL'));
    await flush();
  });

  it('a second ensureBars after success hits the cache — no refetch', async () => {
    client.getEquityHistoricals.mockResolvedValue(okResult('MSFT'));
    store.ensureBars('MSFT');
    await flush();
    store.ensureBars('MSFT');
    expect(client.getEquityHistoricals).toHaveBeenCalledTimes(1);
  });

  it('a rejected fetch records the error and does NOT refetch on retry', async () => {
    client.getEquityHistoricals.mockRejectedValue(
      new Error('service unavailable'),
    );
    store.ensureBars('FAIL');
    await flush();
    expect(store.error()['FAIL']?.message).toBe('service unavailable');
    expect(store.error()['FAIL']?.auth).toBe(false);
    expect(store.bars()['FAIL']).toBeUndefined();
    store.ensureBars('FAIL');
    expect(client.getEquityHistoricals).toHaveBeenCalledTimes(1);
  });

  it('AUTH-category rejection flags auth so the popup shows Re-authorize', async () => {
    client.getEquityHistoricals.mockRejectedValue(
      new RobinhoodMcpError(
        'credentials expired',
        'get_equity_historicals',
        ToolExecutionErrorCategory.AUTH,
      ),
    );
    store.ensureBars('TKEN');
    await flush();
    expect(store.error()['TKEN']?.auth).toBe(true);
  });

  it('clearError re-arms the slot — the Re-authorize retry seam', async () => {
    client.getEquityHistoricals.mockRejectedValueOnce(
      new Error('first failure'),
    );
    store.ensureBars('RETRY');
    await flush();
    expect(store.error()['RETRY']?.message).toBe('first failure');
    client.getEquityHistoricals.mockResolvedValue(okResult('RETRY'));
    store.clearError('RETRY');
    expect(store.error()['RETRY']).toBeUndefined();
    store.ensureBars('RETRY');
    expect(client.getEquityHistoricals).toHaveBeenCalledTimes(2);
    await flush();
    expect(store.bars()['RETRY']).toHaveLength(3);
    expect(store.error()['RETRY']).toBeNull();
  });

  it('blank / whitespace symbols are a no-op — no fetch', () => {
    store.ensureBars('   ');
    store.ensureBars('');
    expect(client.getEquityHistoricals).not.toHaveBeenCalled();
  });

  it('results absent for the symbol → empty bars array (no data ≠ error)', async () => {
    client.getEquityHistoricals.mockResolvedValue({
      data: { results: [] },
    });
    store.ensureBars('NONE');
    await flush();
    expect(store.bars()['NONE']).toEqual([]);
    expect(store.error()['NONE']).toBeNull();
  });
});
