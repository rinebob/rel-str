import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SymbolHistoryStore } from './symbol-history.store';
import { SignalService } from '../services/signal.service';
import { LocalBarReadService, type OhlcBar } from '../../../core/services/local-bar-read.service';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import type { StSignalItem } from '../services/types';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const makeSignal = (overrides: Partial<StSignalItem> = {}): StSignalItem => ({
  id: '2026-10-02',
  symbol: 'AAPL',
  barDate: '2026-10-02',
  marketDate: '2026-10-03',
  runId: 'run-1',
  timeframe: SignalTimeframe.DAILY,
  direction: SignalDirection.LONG,
  signalType: 'D_ST_TREND_RIDER_V1_LONG',
  status: SignalStatus.CONFIRMED,
  indicators: {},
  ...overrides,
});

const bar = (d: string, c: number): OhlcBar => ({ d, o: c - 1, h: c + 1, l: c - 2, c });

describe('SymbolHistoryStore — run-scoped close-price enrichment', () => {
  let signalService: { getSymbolSignalsForRun: jest.Mock; getSymbolSignalHistoryFromHistory: jest.Mock };
  let barRead: { getDailyBarsForRange$: jest.Mock; getWeeklyBars$: jest.Mock };
  let store: InstanceType<typeof SymbolHistoryStore>;

  const setup = (signals: StSignalItem[]) => {
    signalService = {
      getSymbolSignalsForRun: jest.fn(() => of(signals)),
      getSymbolSignalHistoryFromHistory: jest.fn(() => of([])),
    };
    barRead = {
      getDailyBarsForRange$: jest.fn(() => of([])),
      getWeeklyBars$: jest.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SignalService, useValue: signalService },
        { provide: LocalBarReadService, useValue: barRead },
      ],
    });
    store = TestBed.inject(SymbolHistoryStore);
  };

  it('fills closePrice from the firing daily bar when the backend did not write close', async () => {
    setup([makeSignal({ barDate: '2026-10-02' })]);
    barRead.getDailyBarsForRange$.mockReturnValue(of([bar('2026-10-02', 213.44)]));

    store.loadSignalHistoryForRun('AAPL', 'run-1');
    await flush();

    const cached = store.signalHistoryCache()['AAPL::run-1'];
    expect(cached[0].closePrice).toBe(213.44);
    expect(barRead.getDailyBarsForRange$).toHaveBeenCalledWith('AAPL', '2026-10-02', '2026-10-02');
  });

  it('reads weekly bars for weekly signals', async () => {
    setup([makeSignal({ timeframe: SignalTimeframe.WEEKLY, barDate: '2026-09-29' })]);
    barRead.getWeeklyBars$.mockReturnValue(of([bar('2026-09-29', 187.5)]));

    store.loadSignalHistoryForRun('AAPL', 'run-1');
    await flush();

    expect(store.signalHistoryCache()['AAPL::run-1'][0].closePrice).toBe(187.5);
    expect(barRead.getDailyBarsForRange$).not.toHaveBeenCalled();
  });

  it('skips all bar reads when every signal is already priced', async () => {
    setup([makeSignal({ closePrice: 100 })]);

    store.loadSignalHistoryForRun('AAPL', 'run-1');
    await flush();

    expect(store.signalHistoryCache()['AAPL::run-1'][0].closePrice).toBe(100);
    expect(barRead.getDailyBarsForRange$).not.toHaveBeenCalled();
    expect(barRead.getWeeklyBars$).not.toHaveBeenCalled();
  });

  it('still caches signals when the bar read fails', async () => {
    setup([makeSignal()]);
    barRead.getDailyBarsForRange$.mockReturnValue(throwError(() => new Error('boom')));

    store.loadSignalHistoryForRun('AAPL', 'run-1');
    await flush();

    expect(store.signalHistoryCache()['AAPL::run-1']).toHaveLength(1);
  });
});
