/// <reference types="jest" />
/**
 * Tests for the plotted-set slice of OptionsContractViewerStore
 * (plotted-contracts-feature.ts). Seam: OptionsContractService and
 * LocalBarReadService are mocked; the real store is used so plotted state,
 * progress, and rendered-series computeds react to real loads.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError, Subject, delay } from 'rxjs';

import { OptionsContractViewerStore } from './options-contract-viewer.store';
import { OptionsContractService } from '../services/options-contract.service';
import { LocalBarReadService } from '../../../core/services/local-bar-read.service';
import { getMarketDatePT } from '../../../core/common/pt-date-utils';
import type { PlottedEntry } from '@options-contract/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../core/models/partner.types';
import type { OhlcBar } from '../../../core/models/market-data.types';

const QQQ_PUT = 'QQQ260619P00470000';
const QQQ_CALL = 'QQQ260619C00475000';

function entry(contractId: string, openDate: string | null = null): PlottedEntry {
  return { contractId, openDate };
}

const bar = (d: string, c = 100): OhlcBar => ({ d, o: c, h: c, l: c, c, v: 0 });

/** N consecutive daily bar-dates starting at `start` (test fixtures don't
 *  need trading-calendar realism — a bar row is a "session" here). */
const days = (start: string, n: number): OhlcBar[] =>
  Array.from({ length: n }, (_, i) =>
    bar(new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)),
  );

function contractResponse(
  contractID: string,
  dates: string[],
): PartnerHistoricalOptionsContractV2Response {
  return {
    ok: true,
    symbol: 'QQQ',
    contractID,
    expiration: '2026-06-19',
    type: 'put',
    strike: '470.00',
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    series: dates.map((date) => ({ date, mark: '1.23' })),
  };
}

interface Setup {
  store: InstanceType<typeof OptionsContractViewerStore>;
  optionsService: { getHistoricalOptionsContract$: jest.Mock };
  barService: { getDailyBarsForRange$: jest.Mock };
}

function setup(getHistorical?: jest.Mock, bars: OhlcBar[] = []): Setup {
  const optionsService = {
    getHistoricalOptionsContract$:
      getHistorical ?? jest.fn((_s: string, cid: string) => of(contractResponse(cid, ['2026-06-01', '2026-06-02']))),
  };
  const barService = { getDailyBarsForRange$: jest.fn(() => of(bars)) };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: OptionsContractService, useValue: optionsService },
      { provide: LocalBarReadService, useValue: barService },
      OptionsContractViewerStore,
    ],
  });
  return { store: TestBed.inject(OptionsContractViewerStore), optionsService, barService };
}

/** Flush the async worker pool (native awaits can't be fakeAsync'd). */
async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe('plotted contracts feature', () => {
  it('starts empty in lifetime window, not multi-mode', () => {
    const { store } = setup();
    expect(store.plottedContracts()).toEqual({});
    expect(store.plottedLoadProgress()).toBeNull();
    expect(store.displayWindow()).toBe('lifetime');
    expect(store.hoveredContractId()).toBeNull();
    expect(store.isMultiMode()).toBe(false);
  });

  it('loads each unique entry and marks it loaded', async () => {
    const { store, optionsService } = setup();
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15'), entry(QQQ_CALL)]);
    await flush();

    expect(optionsService.getHistoricalOptionsContract$).toHaveBeenCalledTimes(2);
    expect(optionsService.getHistoricalOptionsContract$).toHaveBeenCalledWith('QQQ', QQQ_PUT, undefined);
    const plotted = store.plottedContracts();
    expect(plotted[QQQ_PUT].status).toBe('loaded');
    expect(plotted[QQQ_PUT].entry.openDate).toBe('2026-06-15');
    expect(plotted[QQQ_CALL].status).toBe('loaded');
    expect(store.plottedLoadProgress()).toBeNull();
    expect(store.isMultiMode()).toBe(true);
  });

  it('does not refetch a contract already plotted, but keeps the earliest open date', async () => {
    const { store, optionsService } = setup();
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
    await flush();
    store.loadPlotted([entry(QQQ_PUT, '2026-06-10'), entry(QQQ_CALL)]);
    await flush();

    expect(optionsService.getHistoricalOptionsContract$).toHaveBeenCalledTimes(2);
    expect(store.plottedContracts()[QQQ_PUT].entry.openDate).toBe('2026-06-10');
    expect(Object.keys(store.plottedContracts())).toHaveLength(2);
  });

  it('stores the entry markerDates supplied by the parser', async () => {
    const { store } = setup();
    store.loadPlotted([{ contractId: QQQ_PUT, openDate: '2026-06-01', markerDates: ['2026-06-01', '2026-06-05'] }]);
    await flush();

    expect(store.plottedContracts()[QQQ_PUT].entry.markerDates).toEqual(['2026-06-01', '2026-06-05']);
  });

  it('a kept contract takes the new list\'s pick days — the list is authoritative', async () => {
    const { store } = setup();
    store.loadPlotted([{ contractId: QQQ_PUT, openDate: '2026-06-01', markerDates: ['2026-06-01', '2026-06-05'] }]);
    await flush();
    store.loadPlotted([{ contractId: QQQ_PUT, openDate: '2026-06-10', markerDates: ['2026-06-10'] }]);
    await flush();

    // The second list claims only 06-10 — the earlier pick days drop off the
    // span marker rather than lingering as ghost vertices. The loaded record
    // (data + status) survives the metadata swap.
    const c = store.plottedContracts()[QQQ_PUT];
    expect(c.entry.openDate).toBe('2026-06-10');
    expect(c.entry.markerDates).toEqual(['2026-06-10']);
    expect(c.status).toBe('loaded');
    expect(c.data?.contractID).toBe(QQQ_PUT);
  });

  it('unions markerDates when the same entry list supplies a contract twice', async () => {
    const { store, optionsService } = setup();
    store.loadPlotted([
      { contractId: QQQ_PUT, openDate: '2026-06-01', markerDates: ['2026-06-01'] },
      { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
    ]);
    await flush();

    // One contract, one fetch — both dates survive as marker vertices.
    expect(Object.keys(store.plottedContracts())).toEqual([QQQ_PUT]);
    expect(optionsService.getHistoricalOptionsContract$).toHaveBeenCalledTimes(1);
    const e = store.plottedContracts()[QQQ_PUT].entry;
    expect(e.openDate).toBe('2026-06-01');
    expect(e.markerDates).toEqual(['2026-06-01', '2026-06-05']);
  });

  it('derives markerDates from openDate for entries that omit them', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15'), entry(QQQ_CALL)]);
    await flush();

    expect(store.plottedContracts()[QQQ_PUT].entry.markerDates).toEqual(['2026-06-15']);
    expect(store.plottedContracts()[QQQ_CALL].entry.markerDates).toEqual([]);
  });

  it('removes contracts absent from the new list without refetching kept ones', async () => {
    const { store, optionsService } = setup();
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15'), entry(QQQ_CALL)]);
    await flush();

    store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
    await flush();

    expect(Object.keys(store.plottedContracts())).toEqual([QQQ_PUT]);
    expect(store.plottedContracts()[QQQ_PUT].status).toBe('loaded');
    expect(optionsService.getHistoricalOptionsContract$).toHaveBeenCalledTimes(2);
    expect(store.isMultiMode()).toBe(false);
  });

  it('clears a hovered contract removed by the new list', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();
    store.setHoveredContract(QQQ_CALL);

    store.loadPlotted([entry(QQQ_PUT)]);
    await flush();

    expect(store.hoveredContractId()).toBeNull();
  });

  it('a fresh set load resets the pin', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();
    store.togglePinnedContract(QQQ_CALL);

    store.loadPlotted([entry(QQQ_PUT)]);
    await flush();

    expect(store.pinnedContractId()).toBeNull();
    expect(store.highlightedContractId()).toBeNull();
  });

  it('removePlotted clears a pin on the removed contract', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();
    store.togglePinnedContract(QQQ_PUT);

    store.removePlotted(QQQ_PUT);

    expect(store.pinnedContractId()).toBeNull();
    expect(store.highlightedContractId()).toBeNull();
  });

  it('a focused drill-down suppresses hover/pin dimming — pin survives for the return', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();
    store.togglePinnedContract(QQQ_PUT);
    store.setHoveredContract(QQQ_CALL);

    store.focusPlotted(QQQ_CALL);
    await flush();

    // The focus gate overrides both — a stale pin/hover must not dim the
    // contract in its own single view. The pin stays for the set's return.
    expect(store.highlightedContractId()).toBeNull();
    expect(store.pinnedContractId()).toBe(QQQ_PUT);
  });

  it('a contract that fails mid-load releases its pin — error chips cannot be unpinned by click', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      cid === QQQ_PUT
        ? throwError(() => new Error('nope'))
        : of(contractResponse(cid, ['2026-06-01'])),
    );
    const { store } = setup(getHistorical);
    void store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    // Mid-flight pin on the loading chip — legitimate (its span marker
    // already renders) but the failure must release it.
    store.togglePinnedContract(QQQ_PUT);
    store.setHoveredContract(QQQ_PUT);
    await flush();

    expect(store.plottedContracts()[QQQ_PUT].status).toBe('error');
    expect(store.pinnedContractId()).toBeNull();
    expect(store.hoveredContractId()).toBeNull();
    expect(store.highlightedContractId()).toBeNull();
  });

  it('keeps successfully loaded contracts when others fail', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      cid === QQQ_CALL
        ? throwError(() => new Error('not found'))
        : of(contractResponse(cid, ['2026-06-01'])),
    );
    const { store } = setup(getHistorical);
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();

    expect(store.plottedContracts()[QQQ_PUT].status).toBe('loaded');
    expect(store.plottedContracts()[QQQ_CALL].status).toBe('error');
    expect(store.plottedContracts()[QQQ_CALL].error).toBe('not found');
    expect(store.plottedLoadProgress()).toBeNull();
  });

  it('removePlotted drops a contract without touching the others', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();

    store.removePlotted(QQQ_PUT);
    expect(Object.keys(store.plottedContracts())).toEqual([QQQ_CALL]);
    expect(store.isMultiMode()).toBe(false);
  });

  it('clearPlotted empties the set and clears hover', async () => {
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    await flush();
    store.setHoveredContract(QQQ_PUT);

    store.clearPlotted();
    expect(store.plottedContracts()).toEqual({});
    expect(store.hoveredContractId()).toBeNull();
  });

  it('toggles the display window and hover state', () => {
    const { store } = setup();
    store.setDisplayWindow('lifetime');
    expect(store.displayWindow()).toBe('lifetime');
    store.setHoveredContract(QQQ_PUT);
    expect(store.hoveredContractId()).toBe(QQQ_PUT);
    store.setHoveredContract(null);
    expect(store.hoveredContractId()).toBeNull();
  });

  it('renderedSeries clips at the open date in position mode', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      of(contractResponse(cid, ['2026-06-01', '2026-06-10', '2026-06-15', '2026-06-20'])),
    );
    const { store } = setup(getHistorical);
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15'), entry(QQQ_CALL)]);
    await flush();
    store.setDisplayWindow('position');

    const rendered = store.renderedSeries();
    expect(rendered[QQQ_PUT].map((o) => o.date)).toEqual(['2026-06-15', '2026-06-20']);
    // Bare-ID contract has no open date — rendered in full even in position mode.
    expect(rendered[QQQ_CALL]).toHaveLength(4);
  });

  it('renderedSeries returns full observations in lifetime mode', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      of(contractResponse(cid, ['2026-06-01', '2026-06-15'])),
    );
    const { store } = setup(getHistorical);
    store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
    await flush();
    store.setDisplayWindow('lifetime');

    expect(store.renderedSeries()[QQQ_PUT]).toHaveLength(2);
  });

  it('does not resurrect a contract removed while its fetch was in flight', async () => {
    const subject = new Subject<PartnerHistoricalOptionsContractV2Response>();
    const { store } = setup(jest.fn(() => subject.asObservable()));

    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    expect(store.plottedContracts()[QQQ_PUT].status).toBe('loading');

    store.removePlotted(QQQ_PUT);
    subject.next(contractResponse(QQQ_PUT, ['2026-06-01']));
    await flush();

    expect(store.plottedContracts()[QQQ_PUT]).toBeUndefined();
  });

  it('does not resurrect contracts cleared while fetches were in flight', async () => {
    const subject = new Subject<PartnerHistoricalOptionsContractV2Response>();
    const { store } = setup(jest.fn(() => subject.asObservable()));

    store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
    store.clearPlotted();
    subject.next(contractResponse(QQQ_PUT, ['2026-06-01']));
    await flush();

    expect(store.plottedContracts()).toEqual({});
    expect(store.plottedLoadProgress()).toBeNull();
  });

  it('re-queues a contract that previously failed', async () => {
    const getHistorical = jest
      .fn()
      .mockImplementationOnce(() => throwError(() => new Error('down')))
      .mockImplementation((_s: string, cid: string) =>
        of(contractResponse(cid, ['2026-06-01'])),
      );
    const { store } = setup(getHistorical);

    store.loadPlotted([entry(QQQ_PUT)]);
    await flush();
    expect(store.plottedContracts()[QQQ_PUT].status).toBe('error');

    store.loadPlotted([entry(QQQ_PUT)]);
    await flush();
    expect(store.plottedContracts()[QQQ_PUT].status).toBe('loaded');
    expect(getHistorical).toHaveBeenCalledTimes(2);
  });

  it('allDates unions rendered dates with marker endpoints', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      of(contractResponse(cid, ['2026-06-01', '2026-06-10'])),
    );
    const { store } = setup(getHistorical);
    // The series ends 2026-06-10; the marker's expiration endpoint extends the
    // union to 2026-06-19 (parsed from the OCC ID).
    store.loadPlotted([entry(QQQ_PUT, '2026-06-01')]);
    await flush();

    expect(store.allDates()).toEqual(['2026-06-01', '2026-06-10', '2026-06-19']);
  });

  it('allDates covers loading contracts — the chart emits their markers mid-fetch', async () => {
    // Never flushed — the contract stays 'loading' but its marker endpoints
    // (openDate + expiration) are already known.
    const { store } = setup(jest.fn(() => of(contractResponse(QQQ_PUT, []))));
    store.loadPlotted([entry(QQQ_PUT, '2026-06-01')]);

    expect(store.plottedContracts()[QQQ_PUT].status).toBe('loading');
    expect(store.allDates()).toEqual(['2026-06-01', '2026-06-19']);
    await flush();
  });

  it('allDates contributes no marker endpoints for bare-ID contracts', async () => {
    // Bare IDs emit no span marker — no openDate to anchor it — so only the
    // rendered dates union.
    const { store } = setup();
    store.loadPlotted([entry(QQQ_PUT)]);
    await flush();

    expect(store.allDates()).toEqual(['2026-06-01', '2026-06-02']);
  });

  describe('underlyingWindow', () => {
    it('is null when no plotted contract carries a marker date', async () => {
      const { store } = setup(undefined, days('2026-06-01', 10));
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT)]);
      await flush();

      expect(store.underlyingWindow()).toBeNull();
    });

    it('is null when no underlying bars are loaded', async () => {
      const { store } = setup();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-01')]);
      await flush();

      expect(store.underlyingWindow()).toBeNull();
    });

    it('starts 50 sessions before the earliest marker date', async () => {
      // 106 sessions precede the 2026-06-15 marker; the window's left edge
      // lands on the 50th-from-last (index 106-50=56 → 2026-04-26) and the
      // right edge on the last loaded bar (2026-06-28).
      const { store } = setup(undefined, days('2026-03-01', 120));
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      expect(store.underlyingWindow()).toEqual({ from: '2026-04-26', to: '2026-06-28' });
    });

    it('clamps to the first bar when fewer than 50 sessions precede the marker', async () => {
      const { store } = setup(undefined, days('2026-06-10', 10));
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      expect(store.underlyingWindow()).toEqual({ from: '2026-06-10', to: '2026-06-19' });
    });

    it('allDates unions the windowed underlying dates before the contract domain', async () => {
      const { store } = setup(undefined, days('2026-05-20', 30));
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      // Only 26 sessions precede the marker → window clamps at the first
      // bar (05-20); the union runs through the last bar (06-18) and the
      // contract's expiration endpoint (06-19).
      const all = store.allDates();
      expect(all[0]).toBe('2026-05-20');
      expect(all[all.length - 1]).toBe('2026-06-19');
      expect(all).toHaveLength(31);
    });

    it('clip-to-entry cannot shrink the underlying axis context', async () => {
      const { store } = setup(
        jest.fn((_s: string, cid: string) =>
          of(contractResponse(cid, ['2026-06-01', '2026-06-15', '2026-06-16'])),
        ),
        days('2026-05-20', 30),
      );
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      store.setDisplayWindow('position');

      // Contract obs clip to >= openDate, but the underlying window derives
      // from marker dates — its dates stay in the axis and its bars don't move.
      const all = store.allDates();
      expect(all[0]).toBe('2026-05-20');
      expect(store.underlyingBars()).toHaveLength(30);
      expect(store.renderedSeries()[QQQ_PUT].map((o) => o.date)).toEqual(['2026-06-15', '2026-06-16']);
    });

    it('widens the underlying fetch when a dated set loads over a contract-scoped range', async () => {
      const { store, barService } = setup();
      // A contract load records the narrow [start, endDate] request — the
      // coverage judge is the requested range, not the bar dates.
      store.loadContract(QQQ_PUT);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      // Pick ~5 months before the requested window → the ~70d prefix
      // (2025-10-27) lands before it → refetch with the earlier start.
      store.loadPlotted([entry(QQQ_PUT, '2026-01-05')]);
      await flush();

      expect(barService.getDailyBarsForRange$).toHaveBeenCalledWith(
        'QQQ', '2025-10-27', expect.any(String),
      );
    });

    it('does not refetch underlying bars already covering the context window', async () => {
      // The ~2-year loadUnderlyingBars request already spans the pick's
      // prefix and today — covered regardless of what bars came back, so
      // a dated load costs no extra fetch (this is also what makes the
      // coverage check weekend/holiday-safe: it judges the request, not
      // whether bars reached today's calendar date).
      const { store, barService } = setup(undefined, days('2026-01-01', 400));
      store.loadUnderlyingBars('QQQ');
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      expect(barService.getDailyBarsForRange$).not.toHaveBeenCalled();
    });

    it('addPadDays never narrows the underlying on either edge while a dated set is loaded', async () => {
      const { store, barService } = setup();
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
      ]);
      await flush();
      store.focusPlotted(QQQ_PUT); // addPadDays needs a loaded contractData
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.addPadDays(3);

      // The contract's own padded range is [~05-29, 06-05], but the set's
      // context claims the ~70d prefix AND today's tail — stale
      // contractData.endDate must not truncate the right edge either.
      expect(barService.getDailyBarsForRange$).toHaveBeenLastCalledWith(
        'QQQ', '2026-03-27', getMarketDatePT(),
      );
    });

    it('resetPadDays also clamps the underlying fetch at the context window', async () => {
      const { store, barService } = setup();
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
      ]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.resetPadDays();

      // Reset means "no extra pad", not "drop the set's context" — the
      // fetch spans [~70d prefix, today], not the contract's own range.
      expect(barService.getDailyBarsForRange$).toHaveBeenLastCalledWith(
        'QQQ', '2026-03-27', getMarketDatePT(),
      );
    });

    it('restores the right edge when the last request stopped short of today', async () => {
      // The contract's [2024-01-01, 2024-03-01] request covered the left
      // edge deeply but ended months before today.
      const getHistorical = jest.fn((_s: string, cid: string) =>
        of(contractResponse(cid, ['2024-01-01', '2024-03-01'])),
      );
      const { store, barService } = setup(getHistorical);
      store.loadContract(QQQ_PUT);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.loadPlotted([entry(QQQ_PUT, '2024-05-05')]);
      await flush();

      // Tail-restore refetches from the previous request's deeper left
      // edge (keeps the history it already asked for) through today —
      // not from the ~70d prefix (2024-02-25), which would drop January.
      expect(barService.getDailyBarsForRange$).toHaveBeenLastCalledWith(
        'QQQ', '2024-01-01', expect.any(String),
      );
    });

    it('a failed underlying fetch keeps the previous bars', async () => {
      const { store, barService } = setup(undefined, days('2026-01-01', 100));
      store.loadUnderlyingBars('QQQ');
      await flush();
      expect(store.underlyingBars()).toHaveLength(100);

      barService.getDailyBarsForRange$.mockReturnValue(
        throwError(() => new Error('network down')),
      );
      store.loadUnderlyingBarsFrom('QQQ', '2025-01-01');
      await flush();

      // A transient failure must not destroy the plotted context — stale
      // bars beat an empty chart.
      expect(store.underlyingBars()).toHaveLength(100);
    });

    it('collapses to null when a dated set is replaced by a bare-id set', async () => {
      const { store } = setup(undefined, days('2026-01-01', 200));
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();
      expect(store.underlyingWindow()).not.toBeNull();

      store.loadPlotted([entry(QQQ_PUT)]);
      await flush();

      expect(store.underlyingWindow()).toBeNull();
      expect(store.plottedContracts()[QQQ_PUT].entry.markerDates).toEqual([]);
    });

    it('a failed contract load leaves the plotted set\'s underlying bars intact', async () => {
      const { store, barService } = setup(
        jest.fn((_s: string, cid: string) =>
          cid === QQQ_CALL
            ? throwError(() => new Error('no data'))
            : of(contractResponse(cid, ['2026-06-01', '2026-06-02'])),
        ),
        days('2026-01-01', 400),
      );
      store.loadUnderlyingBars('QQQ');
      await flush();
      store.loadPlotted([entry(QQQ_PUT, '2026-06-15')]);
      await flush();

      store.loadContract(QQQ_CALL);
      await flush();

      // The underlying is the set's context — a failed single-contract
      // load must not wipe it, and coverage (prefix + tail) is already
      // satisfied so nothing refetches.
      expect(store.underlyingBars()).toHaveLength(400);
      expect(store.error()).toBe('no data');
    });
  });

  describe('chartFocusContractId', () => {
    it('focusPlotted loads the contract into the single path and sets focus', async () => {
      const { store } = setup();
      store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
      await flush();

      store.focusPlotted(QQQ_PUT);
      await flush();

      expect(store.chartFocusContractId()).toBe(QQQ_PUT);
      expect(store.contractData()?.contractID).toBe(QQQ_PUT);
      expect(store.plottedContracts()[QQQ_PUT].status).toBe('loaded');
    });

    it('widens the focused contract\'s underlying fetch to its pick-day context', async () => {
      const { store, barService } = setup();
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
        { contractId: QQQ_CALL, openDate: null },
      ]);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.focusPlotted(QQQ_PUT);
      await flush();

      // Earliest pick (06-05) − 70d = 03-27 — before the contract's own
      // start (06-01) — so the underlying fetch extends to cover it on the
      // left AND clamps the tail at today: drill-down never narrows the
      // context window on either edge.
      expect(barService.getDailyBarsForRange$).toHaveBeenCalledWith('QQQ', '2026-03-27', getMarketDatePT());
    });

    it('a plain loadContract also becomes the focus', async () => {
      const { store } = setup();
      store.loadContract(QQQ_CALL);
      await flush();

      expect(store.chartFocusContractId()).toBe(QQQ_CALL);
      expect(store.contractData()?.contractID).toBe(QQQ_CALL);
    });

    it('clearChartFocus needs no refetch — the drill-down fetch already spans the context', async () => {
      const { store, barService } = setup();
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
        { contractId: QQQ_CALL, openDate: null },
      ]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.clearChartFocus();

      // The focused load clamped to the context window on both edges, so
      // returning to the set finds coverage already satisfied.
      expect(barService.getDailyBarsForRange$).not.toHaveBeenCalled();
    });

    it('clearChartFocus restores the set context after a foreign-contract load', async () => {
      // A different-underlying contract can be focused over a dated set —
      // its fetch records a foreign-symbol range that cannot cover the
      // set's context.
      const getHistorical = jest.fn((_s: string, cid: string) =>
        of({
          ...contractResponse(cid, ['2026-06-01', '2026-06-02']),
          symbol: cid.startsWith('SPY') ? 'SPY' : 'QQQ',
        }),
      );
      const { store, barService } = setup(getHistorical);
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
      ]);
      await flush();
      store.loadContract('SPY260619P00500000');
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.clearChartFocus();

      // Restore fetches the SET's symbol — never the focused contract's.
      expect(barService.getDailyBarsForRange$).toHaveBeenLastCalledWith(
        'QQQ', '2026-03-27', getMarketDatePT(),
      );
    });

    it('a failed foreign contract load restores the set\'s underlying, not the failed symbol', async () => {
      const getHistorical = jest.fn((_s: string, cid: string) =>
        cid.startsWith('SPY')
          ? of({ ...contractResponse(cid, ['2026-06-01', '2026-06-02']), symbol: 'SPY' })
          : throwError(() => new Error('no data')),
      );
      const { store, barService } = setup(getHistorical);
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
      ]);
      await flush();
      // Foreign range replaces the set's recorded fetch.
      store.loadContract('SPY260619P00500000');
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      store.loadContract(QQQ_CALL); // fails
      await flush();

      // The error path re-covers the QQQ set's window — it must not fetch
      // the failed contract's own symbol.
      expect(barService.getDailyBarsForRange$).toHaveBeenLastCalledWith(
        'QQQ', '2026-03-27', getMarketDatePT(),
      );
    });

    it('clearChartFocus returns the view to the plotted set', async () => {
      const { store } = setup();
      store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();

      store.clearChartFocus();
      expect(store.chartFocusContractId()).toBeNull();
    });

    it('removePlotted clears focus when the focused contract is removed', async () => {
      const { store } = setup();
      store.loadPlotted([entry(QQQ_PUT), entry(QQQ_CALL)]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();

      store.removePlotted(QQQ_PUT);
      expect(store.chartFocusContractId()).toBeNull();
    });

    it('removePlotted on the focused chip needs no restore — the focused fetch already covers', async () => {
      const { store, barService } = setup();
      store.loadPlotted([
        { contractId: QQQ_PUT, openDate: '2026-06-05', markerDates: ['2026-06-05'] },
        { contractId: QQQ_CALL, openDate: '2026-06-08', markerDates: ['2026-06-08'] },
      ]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();
      barService.getDailyBarsForRange$.mockClear();

      // Removing the focused chip lands back on the set. The focused
      // fetch was clamped to [06-05's prefix, today], which already runs
      // deeper than the remaining earliest pick's prefix (06-08 → 03-30)
      // — nothing to restore.
      store.removePlotted(QQQ_PUT);

      expect(barService.getDailyBarsForRange$).not.toHaveBeenCalled();
    });

    it('a failed single-contract load releases focus — the set stays reachable', async () => {
      // QA S6: a bad-strike paste dispatched to loadContract claimed
      // chartFocusContractId, then 500'd — and the old code never released
      // it, leaving the view focused on a contract with no data while the
      // plotted set sat stranded. Focus claims on intent, releases on error.
      const getHistorical = jest.fn((_s: string, cid: string) =>
        cid === QQQ_CALL
          ? throwError(() => new Error('INTERNAL'))
          : of(contractResponse(cid, ['2026-06-01', '2026-06-02'])),
      );
      const { store } = setup(getHistorical);
      store.loadPlotted([entry(QQQ_PUT)]);
      await flush();

      store.loadContract(QQQ_CALL); // claims focus on intent…
      await flush(); // …then the fetch fails and releases it

      expect(store.error()).toBe('INTERNAL');
      expect(store.chartFocusContractId()).toBeNull();
      expect(store.contractData()).toBeNull();
      expect(store.plottedContracts()[QQQ_PUT].status).toBe('loaded');
    });

    it('a failed load releases the failed claim without reviving the prior contract', async () => {
      const getHistorical = jest.fn((_s: string, cid: string) =>
        cid === QQQ_CALL
          ? throwError(() => new Error('INTERNAL'))
          : of(contractResponse(cid, ['2026-06-01', '2026-06-02'])),
      );
      const { store } = setup(getHistorical);
      store.loadContract(QQQ_PUT); // success → focused
      await flush();

      store.loadContract(QQQ_CALL); // fails — the old pane doesn't resurrect
      await flush();

      expect(store.error()).toBe('INTERNAL');
      expect(store.chartFocusContractId()).toBeNull();
      expect(store.contractData()).toBeNull();
    });

    it('a newer load keeps focus when an older in-flight load fails', async () => {
      const getHistorical = jest.fn((_s: string, cid: string) =>
        cid === QQQ_PUT
          ? throwError(() => new Error('INTERNAL')).pipe(delay(0))
          : of(contractResponse(cid, ['2026-06-01', '2026-06-02'])),
      );
      const { store } = setup(getHistorical);

      store.loadContract(QQQ_PUT);  // error is scheduled, not yet delivered
      store.loadContract(QQQ_CALL); // supersedes and claims focus first
      await flush();

      // QQQ_PUT's late error must not clear QQQ_CALL's focus.
      expect(store.chartFocusContractId()).toBe(QQQ_CALL);
    });

    it('clearPlotted resets focus along with the set', async () => {
      const { store } = setup();
      store.loadPlotted([entry(QQQ_PUT)]);
      await flush();
      store.focusPlotted(QQQ_PUT);
      await flush();

      store.clearPlotted();
      expect(store.chartFocusContractId()).toBeNull();
    });
  });
});
