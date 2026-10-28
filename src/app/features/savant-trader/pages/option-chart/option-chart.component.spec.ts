/// <reference types="jest" />
/**
 * Store → chart projection tests for OptionChartComponent. The component is
 * instantiated but never rendered — the specs exercise plottedChartSeries and
 * chartAxisLabels (the wiring between OptionsContractViewerStore and
 * OptionsContractChartComponent) with the real store and mocked services.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';

import { OptionChartComponent } from './option-chart.component';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { plottedSeriesColor } from '../../components/options-contract-chart/options-contract-chart-series.builder';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../../core/models/partner.types';

const QQQ_PUT = 'QQQ260619P00470000';
const QQQ_CALL = 'QQQ260619C00475000';

function contractResponse(
  contractID: string,
  dates: string[],
  strike = '470.00',
): PartnerHistoricalOptionsContractV2Response {
  return {
    ok: true,
    symbol: 'QQQ',
    contractID,
    expiration: '2026-06-19',
    type: 'put',
    strike,
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    series: dates.map((date) => ({ date, mark: '1.23' })),
  };
}

function setup(getHistorical?: jest.Mock, dialogResult = true): Setup {
  const optionsService = {
    getHistoricalOptionsContract$:
      getHistorical ?? jest.fn((_s: string, cid: string) => of(contractResponse(cid, ['2026-06-01', '2026-06-10']))),
  };
  const barService = { getDailyBarsForRange$: jest.fn(() => of([])) };
  const dialog = {
    open: jest.fn(() => ({ afterClosed: () => of(dialogResult) })),
    openDialogs: [] as unknown[],
  };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: OptionsContractService, useValue: optionsService },
      { provide: LocalBarReadService, useValue: barService },
      { provide: MatDialog, useValue: dialog },
    ],
  });

  const store = TestBed.inject(OptionsContractViewerStore);
  // Instantiated outside a view — ngOnInit never runs; specs only read computeds.
  const component = TestBed.runInInjectionContext(() => new OptionChartComponent());
  return { store, component, dialog };
}

interface Setup {
  store: InstanceType<typeof OptionsContractViewerStore>;
  component: OptionChartComponent;
  dialog: { open: jest.Mock };
}

async function flush(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe('OptionChartComponent — chart projection', () => {
  it('returns no series when nothing is loaded', () => {
    const { component } = setup();
    expect(component.plottedChartSeries()).toEqual([]);
    expect(component.chartAxisLabels()).toEqual([]);
  });

  it('wraps a single loaded contract as a 1-element series with a readable label', async () => {
    const { store, component } = setup();
    store.loadContract(QQQ_PUT);
    await flush();

    const series = component.plottedChartSeries();
    expect(series).toHaveLength(1);
    expect(series[0].contractId).toBe(QQQ_PUT);
    expect(series[0].label).toBe('470P 2026-06-19');
    expect(series[0].strike).toBe(470);
    expect(series[0].expiration).toBe('2026-06-19');
    expect(series[0].openDate).toBeNull();
    expect(series[0].points.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-10']);
  });

  it('single-contract axis carries the rendered dates — the chart unions marker endpoints itself', async () => {
    const { store, component } = setup();
    store.loadContract(QQQ_PUT);
    await flush();

    expect(component.chartAxisLabels()).toEqual(['2026-06-01', '2026-06-10']);
  });

  it('projects every non-error plotted contract with clip-filtered points', async () => {
    const getHistorical = jest.fn((_s: string, cid: string) =>
      of(contractResponse(cid, ['2026-06-01', '2026-06-10', '2026-06-15'])),
    );
    const { store, component } = setup(getHistorical);
    await store.loadPlotted([
      { contractId: QQQ_PUT, openDate: '2026-06-10' },
      { contractId: QQQ_CALL, openDate: null },
    ]);
    store.setDisplayWindow('position');

    const series = component.plottedChartSeries();
    expect(series.map((s) => s.contractId)).toEqual([QQQ_PUT, QQQ_CALL]);
    // Position window clips the dated contract; the bare one renders in full.
    expect(series[0].points.map((p) => p.date)).toEqual(['2026-06-10', '2026-06-15']);
    expect(series[1].points.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-10', '2026-06-15']);
    expect(series[0].openDate).toBe('2026-06-10');
    expect(series[1].openDate).toBeNull();
    // Axis union = rendered dates + marker endpoints (open dates + expirations).
    expect(component.chartAxisLabels()).toEqual([
      '2026-06-01', '2026-06-10', '2026-06-15', '2026-06-19',
    ]);
  });

  it('keeps a loading contract in the series so pane gating does not flicker', async () => {
    const { store, component } = setup(jest.fn(() => of(contractResponse('x', []))));
    store.loadPlotted([
      { contractId: QQQ_PUT, openDate: null },
      { contractId: QQQ_CALL, openDate: null },
    ]);
    // Not flushed — both still 'loading'.
    expect(component.plottedChartSeries()).toHaveLength(2);
    expect(component.plottedChartSeries()[0].points).toEqual([]);
    await flush();
  });

  it('focusPlotted switches the projection to the focused single contract keeping its openDate', async () => {
    const { store, component } = setup();
    await store.loadPlotted([
      { contractId: QQQ_PUT, openDate: '2026-06-05' },
      { contractId: QQQ_CALL, openDate: null },
    ]);

    store.focusPlotted(QQQ_PUT);
    await flush();

    const series = component.plottedChartSeries();
    expect(series).toHaveLength(1);
    expect(series[0].contractId).toBe(QQQ_PUT);
    expect(series[0].openDate).toBe('2026-06-05');
    // Drill-down shows the full fetched series, not the clipped window.
    expect(series[0].points.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-10']);
    // Focused view uses the contract's own axis — the chart unions the
    // marker endpoints (openDate + expiration) into it internally.
    expect(component.chartAxisLabels()).toEqual(['2026-06-01', '2026-06-10']);
  });

  it('clearChartFocus returns the projection to the whole set', async () => {
    const { store, component } = setup();
    await store.loadPlotted([
      { contractId: QQQ_PUT, openDate: null },
      { contractId: QQQ_CALL, openDate: null },
    ]);

    store.focusPlotted(QQQ_PUT);
    await flush();
    expect(component.plottedChartSeries()).toHaveLength(1);

    store.clearChartFocus();
    expect(component.plottedChartSeries()).toHaveLength(2);
  });

  it('a plain contract load while a set is plotted takes over the chart', async () => {
    const { store, component } = setup();
    await store.loadPlotted([
      { contractId: QQQ_PUT, openDate: null },
      { contractId: QQQ_CALL, openDate: null },
    ]);
    expect(component.plottedChartSeries()).toHaveLength(2);

    store.loadContract('QQQ260717C00500000');
    await flush();

    const series = component.plottedChartSeries();
    expect(series).toHaveLength(1);
    expect(series[0].contractId).toBe('QQQ260717C00500000');
    // The set itself is untouched — clearing focus returns to it.
    store.clearChartFocus();
    expect(component.plottedChartSeries()).toHaveLength(2);
  });

  describe('pair-list input', () => {
    it('a single bare OCC input loads through the existing single-contract path', async () => {
      const { store, component } = setup();
      component.occIdInput = QQQ_PUT;
      component.onLoad();
      await flush();

      expect(store.contractData()?.contractID).toBe(QQQ_PUT);
      expect(store.plottedContracts()).toEqual({});
      expect(component.rejectedEntries()).toEqual([]);
    });

    it('multi-line pair input loads the plotted set', async () => {
      const { store, component } = setup();
      component.occIdInput = `2026-06-10,${QQQ_PUT}\n${QQQ_CALL}`;
      component.onLoad();
      await flush();

      expect(store.plottedContracts()[QQQ_PUT]?.entry.openDate).toBe('2026-06-10');
      expect(store.plottedContracts()[QQQ_CALL]?.status).toBe('loaded');
      expect(component.showPlottedSet()).toBe(true);
    });

    it('rejected tokens surface in rejectedEntries; valid entries still load', async () => {
      const { store, component } = setup();
      component.occIdInput = `2026-06-10,${QQQ_PUT}\nbogus\n06/15/2026,${QQQ_CALL}`;
      component.onLoad();
      await flush();

      const rejected = component.rejectedEntries();
      expect(rejected).toHaveLength(2);
      expect(rejected.map((r) => r.reason)).toEqual(['invalid-contract', 'invalid-date']);
      expect(store.plottedContracts()[QQQ_PUT]?.status).toBe('loaded');
      expect(store.plottedContracts()[QQQ_CALL]).toBeUndefined();
    });

    it('all-rejected input makes no fetch calls', async () => {
      const getHistorical = jest.fn();
      const { store, component } = setup(getHistorical);
      component.occIdInput = 'garbage\nalso-garbage';
      component.onLoad();
      await flush();

      expect(getHistorical).not.toHaveBeenCalled();
      expect(store.plottedContracts()).toEqual({});
      expect(component.rejectedEntries()).toHaveLength(2);
    });

    it('rejectedEntries clears on the next load', async () => {
      const { component } = setup();
      component.occIdInput = 'bogus';
      component.onLoad();
      await flush();
      expect(component.rejectedEntries()).toHaveLength(1);

      component.occIdInput = QQQ_PUT;
      component.onLoad();
      await flush();
      expect(component.rejectedEntries()).toEqual([]);
    });

    it('more than 50 entries confirms before loading', async () => {
      const { store, component, dialog } = setup(undefined, true);
      // Distinct strikes — dedupe would otherwise collapse the list to one.
      const ids = Array.from(
        { length: 51 },
        (_, i) => `QQQ260619P00${String(470 + i).padStart(5, '0')}0`,
      );
      component.occIdInput = ids.join('\n');
      await component.onLoad();
      await flush();

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(Object.keys(store.plottedContracts())).toHaveLength(51);
    });

    it('declining the >50 warning skips the load', async () => {
      const getHistorical = jest.fn((_s: string, cid: string) => of(contractResponse(cid, ['2026-06-01'])));
      const { store, component, dialog } = setup(getHistorical, false);
      const ids = Array.from(
        { length: 51 },
        (_, i) => `QQQ260619P00${String(470 + i).padStart(5, '0')}0`,
      );
      component.occIdInput = ids.join('\n');
      await component.onLoad();
      await flush();

      expect(dialog.open).toHaveBeenCalledTimes(1);
      expect(store.plottedContracts()).toEqual({});
    });

    it('a pasted set after a single-contract load replaces the focused view', async () => {
      const { store, component } = setup();
      component.occIdInput = QQQ_PUT;
      await component.onLoad();
      await flush();
      // loadContract sets the focus flag — the set load must clear it or the
      // chart keeps showing the old contract under the new chips.
      expect(store.chartFocusContractId()).toBe(QQQ_PUT);

      component.occIdInput = `2026-06-10,${QQQ_PUT}\n${QQQ_CALL}`;
      await component.onLoad();
      await flush();

      expect(store.chartFocusContractId()).toBeNull();
      expect(component.showPlottedSet()).toBe(true);
      expect(component.plottedChartSeries().map((s) => s.contractId)).toEqual([QQQ_PUT, QQQ_CALL]);
    });
  });

  describe('plotted chips', () => {
    it('chip color matches the series palette index of its contract', async () => {
      const { store, component } = setup();
      await store.loadPlotted([
        { contractId: QQQ_PUT, openDate: null },
        { contractId: QQQ_CALL, openDate: null },
      ]);

      const chips = component.chipContracts();
      expect(component.chipColor(chips[0])).toBe(plottedSeriesColor(0));
      expect(component.chipColor(chips[1])).toBe(plottedSeriesColor(1));
    });

    it('entering a chip highlights its line while keeping the whole set; leaving clears it', async () => {
      const { store, component } = setup();
      await store.loadPlotted([
        { contractId: QQQ_PUT, openDate: null },
        { contractId: QQQ_CALL, openDate: null },
      ]);

      component.onChipEnter(component.chipContracts()[0]);
      expect(store.hoveredContractId()).toBe(QQQ_PUT);
      // Emphasis is visual only — every plotted contract stays rendered.
      expect(component.plottedChartSeries()).toHaveLength(2);

      component.onChipLeave();
      expect(store.hoveredContractId()).toBeNull();
    });

    it('an error chip has no line to highlight', async () => {
      const getHistorical = jest.fn((_s: string, cid: string) =>
        cid === QQQ_PUT
          ? throwError(() => new Error('no data'))
          : of(contractResponse(cid, ['2026-06-01', '2026-06-10'])),
      );
      const { store, component } = setup(getHistorical);
      await store.loadPlotted([
        { contractId: QQQ_PUT, openDate: null },
        { contractId: QQQ_CALL, openDate: null },
      ]);

      const errChip = component.chipContracts().find((c) => c.status === 'error')!;
      component.onChipEnter(errChip);
      expect(store.hoveredContractId()).toBeNull();
    });

    it('chip remove drops the contract from the set', async () => {
      const { store, component } = setup();
      await store.loadPlotted([
        { contractId: QQQ_PUT, openDate: null },
        { contractId: QQQ_CALL, openDate: null },
      ]);

      component.onChipRemove(component.chipContracts()[0]);
      expect(store.plottedContracts()[QQQ_PUT]).toBeUndefined();
      expect(store.plottedContracts()[QQQ_CALL]).toBeTruthy();
    });
  });
});
