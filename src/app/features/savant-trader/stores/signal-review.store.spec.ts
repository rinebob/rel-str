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
import { PaperTradeStatus } from '@paper-trading/contracts';
import type {
  DeletePaperTradesResponse,
  GeneratePaperSignalTradesResponse,
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
  let mint$: Subject<GeneratePaperSignalTradesResponse>;
  let del$: Subject<DeletePaperTradesResponse>;
  let service: {
    getSignalReviewQueue$: jest.Mock;
    getSignalReviewBundle$: jest.Mock;
    generatePaperSignalTrades$: jest.Mock;
    deletePaperTrades$: jest.Mock;
  };

  beforeEach(() => {
    queue$ = new Subject<GetSignalReviewQueueResponse>();
    bundle$ = new Subject<GetSignalReviewBundleResponse>();
    mint$ = new Subject<GeneratePaperSignalTradesResponse>();
    del$ = new Subject<DeletePaperTradesResponse>();
    service = {
      getSignalReviewQueue$: jest.fn(() => queue$.asObservable()),
      getSignalReviewBundle$: jest.fn(() => bundle$.asObservable()),
      generatePaperSignalTrades$: jest.fn(() => mint$.asObservable()),
      deletePaperTrades$: jest.fn(() => del$.asObservable()),
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

    it('a queue response cannot revert a propagated open stamp — the dot stays cleared', async () => {
      // ngOnInit fires loadQueue + selectSymbol in parallel; the queue
      // response carries the pre-open stamp and must not overwrite the
      // propagated openedAt (or the new-signal dot would resurrect).
      service.getSignalReviewQueue$.mockReturnValueOnce(queue$.asObservable());
      const q = store.loadQueue();
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { openedAt: '2026-11-17T15:00:00.000Z' }));
      bundle$.complete();
      await p;

      queue$.next({ rows: [row({ symbol: 'AAPL', lastDailySignalDate: '2026-11-14', lastOpenedAt: '2026-11-13' })] });
      queue$.complete();
      await q;
      expect(store.queueRows()[0].lastOpenedAt).toBe('2026-11-17T15:00:00.000Z');
      expect(store.pickerRows()[0].hasNewSignal).toBe(false);
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
      expect(service.getSignalReviewBundle$).toHaveBeenCalledWith('AAPL');
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

    it('clears this symbol\'s row errors on a fresh bundle — the join is newer', async () => {
      const target = occ({ occurrenceId: 'AAPL_2026-11-14_T1' });
      const p1 = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p1;

      const fail$ = new Subject<GeneratePaperSignalTradesResponse>();
      service.generatePaperSignalTrades$.mockReturnValueOnce(fail$.asObservable());
      const t = store.toggle(target.occurrenceId);
      fail$.next({ results: [{ signalId: 'x', status: 'error', error: 'no stored bars' }] });
      fail$.complete();
      await t;
      expect(store.rowErrors()[target.occurrenceId]).toBe('no stored bars');

      const again$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(again$.asObservable());
      const p2 = store.selectSymbol('AAPL');
      again$.next(bundle('AAPL', { occurrences: [target] }));
      again$.complete();
      await p2;
      expect(store.rowErrors()[target.occurrenceId]).toBeUndefined();
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

  describe('dividerIndex', () => {
    const seeded = async (
      previousOpenedAt: string | null,
      barDates: string[],
    ): Promise<void> => {
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', {
        previousOpenedAt,
        occurrences: barDates.map((d, i) =>
          occ({ occurrenceId: `AAPL_${d}_T${i}`, signalBarDate: d })),
      }));
      bundle$.complete();
      await p;
    };

    it('null previousOpenedAt → every row is new (index = row count)', async () => {
      await seeded(null, ['2026-11-14', '2026-11-13']);
      expect(store.dividerIndex()).toBe(2);
    });

    it('splits at the first row whose barDate is not newer than the stamp', async () => {
      await seeded('2026-11-13T12:00:00.000Z', ['2026-11-14', '2026-11-12', '2026-11-10']);
      expect(store.dividerIndex()).toBe(1);
    });

    it('same-calendar-day rows are NOT new — the bare date sorts before the ISO stamp', async () => {
      await seeded('2026-11-14T10:00:00.000Z', ['2026-11-14', '2026-11-13']);
      expect(store.dividerIndex()).toBe(0);
    });

    it('all rows older than the stamp → index 0 (no new section)', async () => {
      await seeded('2026-11-20T00:00:00.000Z', ['2026-11-14', '2026-11-13']);
      expect(store.dividerIndex()).toBe(0);
    });

    it('no bundle → index 0', () => {
      expect(store.dividerIndex()).toBe(0);
    });
  });

  describe('toggle — check (mint)', () => {
    const seededOcc = async (
      over: Partial<SignalReviewOccurrence> = {},
    ): Promise<SignalReviewOccurrence> => {
      const target = occ(over);
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p;
      return target;
    };

    it('mints via generatePaperSignalTrades$ with the signalPick literal', async () => {
      const target = await seededOcc();
      const p = store.toggle(target.occurrenceId);
      expect(service.generatePaperSignalTrades$).toHaveBeenCalledWith({
        items: [{
          symbol: 'AAPL',
          signalBarDate: '2026-11-14',
          signalType: 'D_ST_TREND_RIDER_V2_LONG',
        }],
      });
      expect(store.togglePending()[target.occurrenceId]).toBe(true);
      mint$.next({ results: [{ signalId: 'AAPL_D_ST_TREND_RIDER_V2_LONG_2026-11-14', tradeId: 't-1', status: 'created' }] });
      mint$.complete();
      await p;
      const row = store.bundle()!.occurrences[0];
      expect(row.checked).toBe(true);
      expect(row.tradeId).toBe('t-1');
      expect(store.togglePending()[target.occurrenceId]).toBeUndefined();
    });

    it('deduped joins — the row still flips checked with the returned tradeId', async () => {
      const target = await seededOcc();
      const p = store.toggle(target.occurrenceId);
      mint$.next({ results: [{ signalId: 'x', tradeId: 't-existing', status: 'deduped' }] });
      mint$.complete();
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(true);
      expect(store.bundle()!.occurrences[0].tradeId).toBe('t-existing');
    });

    it('item error → row stays unchecked + rowErrors carries the reason', async () => {
      const target = await seededOcc();
      const p = store.toggle(target.occurrenceId);
      mint$.next({ results: [{ signalId: 'x', status: 'error', error: 'no stored bars for 2026-11-14' }] });
      mint$.complete();
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(false);
      expect(store.rowErrors()[target.occurrenceId]).toBe('no stored bars for 2026-11-14');
      expect(store.togglePending()[target.occurrenceId]).toBeUndefined();
    });

    it('transport failure → row stays unchecked + rowErrors carries the message', async () => {
      const target = await seededOcc();
      const p = store.toggle(target.occurrenceId);
      mint$.error(new Error('mint blew up'));
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(false);
      expect(store.rowErrors()[target.occurrenceId]).toBe('mint blew up');
    });
  });

  describe('toggle — uncheck (delete)', () => {
    const checkedOcc = {
      checked: true,
      tradeId: 't-42',
      tradeStatus: PaperTradeStatus.OPEN,
    };

    const seedChecked = async (
      over: Partial<SignalReviewOccurrence> = {},
    ): Promise<SignalReviewOccurrence> => {
      const target = occ({ ...checkedOcc, ...over });
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p;
      return target;
    };

    it('deletes via deletePaperTrades$ — deleted unchecks + drops tradeId', async () => {
      const target = await seedChecked();
      const p = store.toggle(target.occurrenceId);
      expect(service.deletePaperTrades$).toHaveBeenCalledWith({ tradeIds: ['t-42'] });
      del$.next({ deleted: ['t-42'], notFound: [], failed: [] });
      del$.complete();
      await p;
      const row = store.bundle()!.occurrences[0];
      expect(row.checked).toBe(false);
      expect(row.tradeId).toBeUndefined();
      expect(row.tradeStatus).toBeUndefined();
      expect(store.togglePending()[target.occurrenceId]).toBeUndefined();
    });

    it('notFound unchecks — already gone is a join-state success', async () => {
      const target = await seedChecked();
      const p = store.toggle(target.occurrenceId);
      del$.next({ deleted: [], notFound: ['t-42'], failed: [] });
      del$.complete();
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(false);
      expect(store.bundle()!.occurrences[0].tradeId).toBeUndefined();
    });

    it('failed → stays checked + the refusal reason is surfaced', async () => {
      const target = await seedChecked();
      const p = store.toggle(target.occurrenceId);
      del$.next({ deleted: [], notFound: [], failed: [{ tradeId: 't-42', error: 'cohort membership — not signal-scoped' }] });
      del$.complete();
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(true);
      expect(store.rowErrors()[target.occurrenceId]).toBe('cohort membership — not signal-scoped');
      expect(store.togglePending()[target.occurrenceId]).toBeUndefined();
    });

    it('transport failure → stays checked + rowErrors carries the message', async () => {
      const target = await seedChecked();
      const p = store.toggle(target.occurrenceId);
      del$.error(new Error('delete blew up'));
      await p;
      expect(store.bundle()!.occurrences[0].checked).toBe(true);
      expect(store.rowErrors()[target.occurrenceId]).toBe('delete blew up');
    });
  });

  describe('toggle — guards + concurrency', () => {
    const seedTwo = async (): Promise<SignalReviewOccurrence[]> => {
      const rows = [
        occ({ occurrenceId: 'AAPL_2026-11-14_T1', signalBarDate: '2026-11-14' }),
        occ({ occurrenceId: 'AAPL_2026-11-13_T2', signalBarDate: '2026-11-13' }),
      ];
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: rows }));
      bundle$.complete();
      await p;
      return rows;
    };

    it('ignores a toggle while the row is already pending', async () => {
      const [a] = await seedTwo();
      void store.toggle(a.occurrenceId);
      expect(service.generatePaperSignalTrades$).toHaveBeenCalledTimes(1);
      await store.toggle(a.occurrenceId); // second tap while in-flight
      expect(service.generatePaperSignalTrades$).toHaveBeenCalledTimes(1);
      mint$.next({ results: [{ signalId: 'x', tradeId: 't-1', status: 'created' }] });
      mint$.complete();
    });

    it('concurrent toggles on different rows are independent', async () => {
      const [a, b] = await seedTwo();
      const mintA$ = new Subject<GeneratePaperSignalTradesResponse>();
      const mintB$ = new Subject<GeneratePaperSignalTradesResponse>();
      service.generatePaperSignalTrades$
        .mockReturnValueOnce(mintA$.asObservable())
        .mockReturnValueOnce(mintB$.asObservable());
      const pa = store.toggle(a.occurrenceId);
      const pb = store.toggle(b.occurrenceId);
      expect(store.togglePending()[a.occurrenceId]).toBe(true);
      expect(store.togglePending()[b.occurrenceId]).toBe(true);

      // B's item error lands first — A's in-flight mint is unaffected
      mintB$.next({ results: [{ signalId: 'x', status: 'error', error: 'b failed' }] });
      mintB$.complete();
      await pb;
      expect(store.rowErrors()[b.occurrenceId]).toBe('b failed');
      expect(store.togglePending()[a.occurrenceId]).toBe(true);

      mintA$.next({ results: [{ signalId: 'x', tradeId: 't-a', status: 'created' }] });
      mintA$.complete();
      await pa;
      expect(store.bundle()!.occurrences[0].checked).toBe(true);
      expect(store.bundle()!.occurrences[1].checked).toBe(false);
    });

    it('does not recompute previousOpenedAt — the divider survives a toggle', async () => {
      const target = occ({ signalBarDate: '2026-11-14' });
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', {
        previousOpenedAt: '2026-11-13T12:00:00.000Z',
        occurrences: [target, occ({ occurrenceId: 'old', signalBarDate: '2026-11-12' })],
      }));
      bundle$.complete();
      await p;
      expect(store.dividerIndex()).toBe(1);

      const tp = store.toggle(target.occurrenceId);
      mint$.next({ results: [{ signalId: 'x', tradeId: 't-1', status: 'created' }] });
      mint$.complete();
      await tp;
      expect(store.bundle()!.previousOpenedAt).toBe('2026-11-13T12:00:00.000Z');
      expect(store.dividerIndex()).toBe(1);
    });

    it('survives the select×toggle interleave — a stale join cannot resurrect the row', async () => {
      const target = occ({ occurrenceId: 'AAPL_2026-11-14_T1' });
      const p1 = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p1;

      // Toggle → mint in-flight; user re-selects the symbol. The bundle
      // read predates the commit and will return checked:false.
      const tp = store.toggle(target.occurrenceId);
      const again$ = new Subject<GetSignalReviewBundleResponse>();
      service.getSignalReviewBundle$.mockReturnValueOnce(again$.asObservable());
      const p2 = store.selectSymbol('AAPL');

      // Mint resolves first — its patch lands on the doomed bundle…
      mint$.next({ results: [{ signalId: 'x', tradeId: 't-1', status: 'created' }] });
      mint$.complete();
      await tp;
      // …then the stale join arrives. The confirmed overlay must win.
      again$.next(bundle('AAPL', {
        occurrences: [occ({ occurrenceId: 'AAPL_2026-11-14_T1' })], // join still says unchecked
      }));
      again$.complete();
      await p2;
      const row = store.bundle()!.occurrences[0];
      expect(row.checked).toBe(true);
      expect(row.tradeId).toBe('t-1');
    });

    it('ignores a toggle for an id the bundle does not carry', async () => {
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL'));
      bundle$.complete();
      await p;
      await store.toggle('MSFT_2026-11-14_T9'); // a stale emit from another symbol
      expect(service.generatePaperSignalTrades$).not.toHaveBeenCalled();
      expect(service.deletePaperTrades$).not.toHaveBeenCalled();
    });

    it('a mint success without tradeId stays unchecked + honest error', async () => {
      const target = occ();
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p;
      const tp = store.toggle(target.occurrenceId);
      mint$.next({ results: [{ signalId: 'x', status: 'created' }] }); // contract violation: no tradeId
      mint$.complete();
      await tp;
      expect(store.bundle()!.occurrences[0].checked).toBe(false);
      expect(store.rowErrors()[target.occurrenceId]).toBe('mint result missing tradeId');
    });

    it('clears the row error on a successful retry', async () => {
      const target = occ();
      const p = store.selectSymbol('AAPL');
      bundle$.next(bundle('AAPL', { occurrences: [target] }));
      bundle$.complete();
      await p;

      const fail$ = new Subject<GeneratePaperSignalTradesResponse>();
      service.generatePaperSignalTrades$.mockReturnValueOnce(fail$.asObservable());
      const p1 = store.toggle(target.occurrenceId);
      fail$.next({ results: [{ signalId: 'x', status: 'error', error: 'first try failed' }] });
      fail$.complete();
      await p1;
      expect(store.rowErrors()[target.occurrenceId]).toBe('first try failed');

      const p2 = store.toggle(target.occurrenceId);
      mint$.next({ results: [{ signalId: 'x', tradeId: 't-1', status: 'created' }] });
      mint$.complete();
      await p2;
      expect(store.rowErrors()[target.occurrenceId]).toBeUndefined();
      expect(store.bundle()!.occurrences[0].checked).toBe(true);
    });
  });
});
