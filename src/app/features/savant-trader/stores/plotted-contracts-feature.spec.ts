/// <reference types="jest" />
/**
 * Tests for the plotted-set slice of OptionsContractViewerStore
 * (plotted-contracts-feature.ts). Seam: OptionsContractService and
 * LocalBarReadService are mocked; the real store is used so plotted state,
 * progress, and rendered-series computeds react to real loads.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of, throwError, Subject } from 'rxjs';

import { OptionsContractViewerStore } from './options-contract-viewer.store';
import { OptionsContractService } from '../services/options-contract.service';
import { LocalBarReadService } from '../../../core/services/local-bar-read.service';
import type { PlottedEntry } from '@options-contract/contracts';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../core/models/partner.types';

const QQQ_PUT = 'QQQ260619P00470000';
const QQQ_CALL = 'QQQ260619C00475000';

function entry(contractId: string, openDate: string | null = null): PlottedEntry {
  return { contractId, openDate };
}

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
}

function setup(getHistorical?: jest.Mock): Setup {
  const optionsService = {
    getHistoricalOptionsContract$:
      getHistorical ?? jest.fn((_s: string, cid: string) => of(contractResponse(cid, ['2026-06-01', '2026-06-02']))),
  };
  const barService = { getDailyBarsForRange$: jest.fn(() => of([])) };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: OptionsContractService, useValue: optionsService },
      { provide: LocalBarReadService, useValue: barService },
      OptionsContractViewerStore,
    ],
  });
  return { store: TestBed.inject(OptionsContractViewerStore), optionsService };
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

    it('a plain loadContract also becomes the focus', async () => {
      const { store } = setup();
      store.loadContract(QQQ_CALL);
      await flush();

      expect(store.chartFocusContractId()).toBe(QQQ_CALL);
      expect(store.contractData()?.contractID).toBe(QQQ_CALL);
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
