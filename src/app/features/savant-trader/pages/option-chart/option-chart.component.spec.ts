/// <reference types="jest" />
/**
 * Store → chart projection tests for OptionChartComponent. The component is
 * instantiated but never rendered — the specs exercise plottedChartSeries and
 * chartAxisLabels (the wiring between OptionsContractViewerStore and
 * OptionsContractChartComponent) with the real store and mocked services.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { OptionChartComponent } from './option-chart.component';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
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

interface Setup {
  store: InstanceType<typeof OptionsContractViewerStore>;
  component: OptionChartComponent;
}

function setup(getHistorical?: jest.Mock): Setup {
  const optionsService = {
    getHistoricalOptionsContract$:
      getHistorical ?? jest.fn((_s: string, cid: string) => of(contractResponse(cid, ['2026-06-01', '2026-06-10']))),
  };
  const barService = { getDailyBarsForRange$: jest.fn(() => of([])) };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: OptionsContractService, useValue: optionsService },
      { provide: LocalBarReadService, useValue: barService },
    ],
  });

  const store = TestBed.inject(OptionsContractViewerStore);
  // Instantiated outside a view — ngOnInit never runs; specs only read computeds.
  const component = TestBed.runInInjectionContext(() => new OptionChartComponent());
  return { store, component };
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
});
