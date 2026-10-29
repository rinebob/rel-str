import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { RhChartService, equityWireBarToOhlc } from './rh-chart.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { BarsInterval } from '../../../core/models/partner.types';
import type { EquityHistoricalBar, EquityHistoricalsResult } from '@robinhood-mcp/contracts';

describe('equityWireBarToOhlc', () => {
  const wire: EquityHistoricalBar = {
    begins_at: '2026-10-27T00:00:00Z',
    open_price: '120.5',
    close_price: '121.0',
    high_price: '122.3',
    low_price: '119.8',
    volume: 412300,
    session: 'reg',
    interpolated: true,
  };

  it('maps wire strings to OhlcBar numbers; begins_at → d date', () => {
    expect(equityWireBarToOhlc(wire)).toEqual({
      d: '2026-10-27',
      o: 120.5,
      h: 122.3,
      l: 119.8,
      c: 121.0,
      v: 412300,
    });
  });

  it('keeps interpolated bars (chart gap-fill decision, #1259)', () => {
    // The flag is dropped — the BAR is kept. A synthesized bar is better
    // than a chart gap for ephemeral charts.
    expect(equityWireBarToOhlc({ ...wire, interpolated: true }).c).toBe(121.0);
  });
});

describe('RhChartService', () => {
  let service: RhChartService;
  let clientMock: { getEquityHistoricals: jest.Mock };

  const result = (symbol: string, interval: string, beginsAts: string[]): EquityHistoricalsResult => ({
    data: {
      results: [
        {
          symbol,
          interval,
          bounds: 'regular',
          bars: beginsAts.map((b) => ({
            begins_at: b,
            open_price: '10',
            close_price: '11',
            high_price: '12',
            low_price: '9',
            volume: 100,
            session: 'reg',
          })),
        },
      ],
    },
  });

  beforeEach(() => {
    clientMock = { getEquityHistoricals: jest.fn() };
    clientMock.getEquityHistoricals.mockImplementation((symbols: string[], interval: string) =>
      Promise.resolve(result(symbols[0], interval, ['2026-10-27T00:00:00Z', '2026-10-28T00:00:00Z'])),
    );
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RhChartService,
        { provide: RobinhoodMcpClient, useValue: clientMock },
      ],
    });
    service = TestBed.inject(RhChartService);
  });

  it('fires day/week/month calls for the symbol over a ~10y span', async () => {
    await firstValueFrom(service.loadBars$('LAMR'));

    expect(clientMock.getEquityHistoricals).toHaveBeenCalledTimes(3);
    const intervals = clientMock.getEquityHistoricals.mock.calls.map((c) => c[1]);
    expect(intervals).toEqual(['day', 'week', 'month']);
    for (const call of clientMock.getEquityHistoricals.mock.calls) {
      expect(call[0]).toEqual(['LAMR']);
      // ~10y lookback, RFC3339, no end_time (server defaults to now).
      const ms = Date.now() - Date.parse(call[2]);
      expect(ms).toBeGreaterThan(9 * 365.25 * 24 * 3600 * 1000);
      expect(ms).toBeLessThan(11 * 365.25 * 24 * 3600 * 1000);
      expect(call[3]).toBeUndefined();
    }
  });

  it('returns the three-interval shape with version "" so indicators stay unloaded', async () => {
    const out = await firstValueFrom(service.loadBars$('LAMR'));

    expect(out.version).toBe('');
    expect(out.daily.interval).toBe(BarsInterval.DAILY);
    expect(out.weekly.interval).toBe(BarsInterval.WEEKLY);
    expect(out.monthly.interval).toBe(BarsInterval.MONTHLY);
    expect(out.daily.symbol).toBe('LAMR');
    expect(out.daily.bars).toHaveLength(2);
    expect(out.daily.bars[0]).toMatchObject({ date: '2026-10-27', open: 10, close: 11, high: 12, low: 9, volume: 100 });
    expect(out.daily.dateRange).toEqual({ from: '2026-10-27', to: '2026-10-28' });
  });

  it('sorts out-of-order wire bars ascending — insurance against server reordering', async () => {
    clientMock.getEquityHistoricals.mockImplementation((symbols: string[], interval: string) =>
      Promise.resolve(
        result(symbols[0], interval, ['2026-10-28T00:00:00Z', '2026-10-26T00:00:00Z', '2026-10-27T00:00:00Z']),
      ),
    );

    const out = await firstValueFrom(service.loadBars$('LAMR'));

    expect(out.daily.bars.map((b) => b.date)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
    expect(out.daily.dateRange).toEqual({ from: '2026-10-26', to: '2026-10-28' });
  });

  it('warns (but does not throw) when the wire omits the requested symbol', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    clientMock.getEquityHistoricals.mockResolvedValue(result('OTHER', 'day', []));

    const out = await firstValueFrom(service.loadBars$('LAMR'));

    expect(out.daily.bars).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LAMR'), ['OTHER']);
    warn.mockRestore();
  });

  it('yields empty datasets when the symbol is absent from results', async () => {
    clientMock.getEquityHistoricals.mockResolvedValue(result('OTHER', 'day', []));

    const out = await firstValueFrom(service.loadBars$('LAMR'));

    expect(out.daily.bars).toEqual([]);
    expect(out.daily.dateRange).toEqual({ from: '', to: '' });
    expect(out.version).toBe('');
  });

  it('propagates client rejections — ephemeral charts surface errors, no silent blank', async () => {
    clientMock.getEquityHistoricals.mockRejectedValue(new Error('mcp down'));

    await expect(firstValueFrom(service.loadBars$('LAMR'))).rejects.toThrow('mcp down');
  });
});
