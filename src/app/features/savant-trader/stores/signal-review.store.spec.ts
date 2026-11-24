/**
 * Unit tests for SignalReviewStore — queue load, bundle select with the
 * monotonic-seq stale-response guard, the symbol-keyed bundle record, and
 * the keep-last-good error rule. Service methods are stubbed with
 * Subjects so in-flight sequencing is deterministic; async methods flush
 * by awaiting the store method's own promise.
 */

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { SignalReviewStore } from './signal-review.store';
import { SignalReviewService } from '../services/signal-review.service';
import { TradeSide } from '@common';
import type {
  GetSignalReviewBundleResponse,
  GetSignalReviewQueueResponse,
  SignalReviewOccurrence,
  SignalReviewQueueRow,
} from '@paper-trading/contracts';

const row = (over: Partial<SignalReviewQueueRow> = {}): SignalReviewQueueRow => ({
  symbol: 'AAPL',
  lastDailySignalDate: '2026-11-14',
  ...over,
});

const occ = (over: Partial<SignalReviewOccurrence> = {}): SignalReviewOccurrence => ({
  occurrenceId: 'AAPL_2026-11-14_D_ST_TREND_RIDER_V2_LONG',
  symbol: 'AAPL',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  signalBarDate: '2026-11-14',
  signalTimeframe: 'D',
  direction: TradeSide.LONG,
  signalStatus: 'CONFIRMED',
  signalIndicators: {},
  sourceRunId: 'run-1',
  checked: false,
  ...over,
});

const bundle = (symbol: string, over: Partial<GetSignalReviewBundleResponse> = {}): GetSignalReviewBundleResponse => ({
  symbol,
  previousOpenedAt: null,
  openedAt: '2026-11-17T15:00:00.000Z',
  occurrences: [occ({ symbol })],
  ...over,
});

describe('SignalReviewStore', () => {
  let store: InstanceType<typeof SignalReviewStore>;
  let queue$: Subject<GetSignalReviewQueueResponse>;
  let bundle$: Subject<GetSignalReviewBundleResponse>;
  let service: {
    getSignalReviewQueue$: jest.Mock;
    getSignalReviewBundle$: jest.Mock;
  };

  beforeEach(() => {
    queue$ = new Subject<GetSignalReviewQueueResponse>();
    bundle$ = new Subject<GetSignalReviewBundleResponse>();
    service = {
      getSignalReviewQueue$: jest.fn(() => queue$.asObservable()),
      getSignalReviewBundle$: jest.fn(() => bundle$.asObservable()),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: SignalReviewService, useValue: service }],
    });
    store = TestBed.inject(SignalReviewStore);
  });

  describe('loadQueue', () => {
    it('stores rows on success and clears loading', async () => {
      const p = store.loadQueue();
      expect(store.queueLoading()).toBe(true);
      queue$.next({ rows: [row(), row({ symbol: 'MSFT' })] });
      queue$.complete();
      await p;
      expect(store.queueLoading()).toBe(false);
      expect(store.queueError()).toBeNull();
      expect(store.queueRows().map((r) => r.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('keeps prior rows and reports the error on failure', async () => {
      const ok$ = new Subject<GetSignalReviewQueueResponse>();
      service.getSignalReviewQueue$.mockReturnValueOnce(ok$.asObservable());
      const p1 = store.loadQueue();
      ok$.next({ rows: [row()] });
      ok$.complete();
      await p1;

      const p2 = store.loadQueue();
      queue$.error(new Error('queue blew up'));
      await p2;
      expect(store.queueRows()).toHaveLength(1); // last-good preserved
      expect(store.queueError()).toBe('queue blew up');
    });
  });

  describe('pickerRows (new-signal dot)', () => {
    it('flags lastDailySignalDate > lastOpenedAt and never-opened symbols', async () => {
      const p = store.loadQueue();
      queue$.next({
        rows: [
          row({ symbol: 'NEW1', lastDailySignalDate: '2026-11-14', lastOpenedAt: '2026-11-13' }),
          row({ symbol: 'OLD1', lastDailySignalDate: '2026-11-12', lastOpenedAt: '2026-11-13' }),
          row({ symbol: 'NEVER', lastDailySignalDate: '2026-11-10' }), // no lastOpenedAt
          // same-calendar-day boundary — the ISO stamp sorts after the
          // bare date, so a signal dated the day of the last open is not "new"
          row({ symbol: 'SAMEDAY', lastDailySignalDate: '2026-11-14', lastOpenedAt: '2026-11-14T10:00:00Z' }),
        ],
      });
      queue$.complete();
      await p;
      const flagged = store.pickerRows().filter((r) => r.hasNewSignal).map((r) => r.symbol);
      expect(flagged).toEqual(['NEW1', 'NEVER']);
    });
  });

  describe('selectSymbol', () => {
    it('stores the bundle + stamps on success', async () => {
      const p = store.selectSymbol('AAPL');
      expect(store.selectedSymbol()).toBe('AAPL');
      expect(store.bundleLoading()).toBe(true);
      bundle$.next(bundle('AAPL', { previousOpenedAt: '2026-11-15T00:00:00.000Z' }));
      bundle$.complete();
      await p;
      expect(store.bundleLoading()).toBe(false);
      const b = store.bundle();
      expect(b?.symbol).toBe('AAPL');
      expect(b?.previousOpenedAt).toBe('2026-11-15T00:00:00.000Z');
      expect(b?.openedAt).toBe('2026-11-17T15:00:00.000Z');
      expect(b?.occurrences).toHaveLength(1);
    });

    it('clears the new-signal dot — the read stamped lastOpenedAt server-side', async () => {
      const q = store.loadQueue();
      queue$.next({
        rows: [row({ symbol: 'AAPL', lastDailySignalDate: '2026-11-14', lastOpenedAt: '2026-11-13' })],
      });
      queue$.complete();
      await q;
      expect(store.pickerRows()[0].hasNewSignal).toBe(true);

      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { openedAt: '2026-11-17T15:00:00.000Z' }));
      bundle$.complete();
      await p;
      // the queue row carries the fresh stamp → the dot is gone without a refetch
      expect(store.queueRows()[0].lastOpenedAt).toBe('2026-11-17T15:00:00.000Z');
      expect(store.pickerRows()[0].hasNewSignal).toBe(false);
    });

    it('re-fires on re-select — the read stamps lastOpenedAt server-side', async () => {
      const p1 = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL'));
      bundle$.complete();
      await p1;
      const calls = service.getSignalReviewBundle$.mock.calls.length;
      void store.selectSymbol('AAPL');
      expect(service.getSignalReviewBundle$.mock.calls.length).toBe(calls + 1);
    });

    it('discards a stale response — newer select owns the slot', async () => {
      const slow$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(slow$.asObservable());
      const p1 = store.selectSymbol('AAPL'); // will resolve late
      const fast$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(fast$.asObservable());
      const p2 = store.selectSymbol('MSFT');

      fast$.next(bundle('MSFT'));
      fast$.complete();
      await p2;
      expect(store.selectedSymbol()).toBe('MSFT');
      expect(store.bundle()?.symbol).toBe('MSFT');

      slow$.next(bundle('AAPL')); // stale response arrives late
      slow$.complete();
      await p1;
      expect(store.selectedSymbol()).toBe('MSFT');
      expect(store.bundle()?.symbol).toBe('MSFT'); // not overwritten
    });

    it('discards a stale error — a superseded fetch cannot set bundleError', async () => {
      const slow$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(slow$.asObservable());
      const p1 = store.selectSymbol('AAPL');
      const fast$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(fast$.asObservable());
      const p2 = store.selectSymbol('MSFT');

      fast$.next(bundle('MSFT'));
      fast$.complete();
      await p2;
      expect(store.selectedSymbol()).toBe('MSFT');

      slow$.error(new Error('stale failure')); // arrives after MSFT owned the slot
      await expect(p1).resolves.toBeUndefined();
      expect(store.bundleError()).toBeNull();
      expect(store.bundleLoading()).toBe(false);
      expect(store.bundle()?.symbol).toBe('MSFT');
    });

    it('a failed select keeps the prior bundle keyed to its own symbol — never mislabeled', async () => {
      const ok$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(ok$.asObservable());
      const p1 = store.selectSymbol('AAPL');
      ok$.next(bundle('AAPL'));
      ok$.complete();
      await p1;
      expect(store.bundle()?.symbol).toBe('AAPL');

      const p2 = store.selectSymbol('MSFT');
      bundle$.error(new Error('bundle blew up'));
      await p2;
      expect(store.selectedSymbol()).toBe('MSFT');
      expect(store.bundleError()).toBe('bundle blew up');
      // kept state is still AAPL's, keyed — the template gate refuses to
      // render it under MSFT's header
      expect(store.bundle()?.symbol).toBe('AAPL');
      expect(store.bundle()?.occurrences).toHaveLength(1);
      expect(store.bundleLoading()).toBe(false);
    });
  });
});
