/// <reference types="jest" />
/**
 * Unit-seam specs for the page-scoped coordination services extracted
 * from OptionChartComponent (#1392). Behavior-level coverage still lives
 * in option-chart{,-list,-generator}.spec.ts (the component facade is
 * unchanged); these pin the new seams directly: the page context's
 * symbol orchestration, the catalog's builder/filter seams, and the
 * load/generator handoffs.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';

import { DsDialogService } from '../../../../shared/ds/ds-dialog';
import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListService } from '../../services/contract-list.service';
import { OptionsContractService } from '../../services/options-contract.service';
import { ContractAvailabilityService } from '../../services/contract-availability.service';
import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import type { ContractListPickRow, ContractListRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import { OPTION_CHART_PAGE_PROVIDERS } from './option-chart-page.providers';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartCatalogService } from './option-chart-catalog.service';
import { OptionChartLoadService } from './option-chart-load.service';
import { OptionChartListService } from './option-chart-list.service';
import { OptionChartReplayService } from './option-chart-replay.service';
import { OptionChartGeneratorService } from './option-chart-generator.service';

const pickRow = (entryDate: string, contractId: string): ContractListPickRow => ({
  kind: 'pick',
  entryDate,
  contractId,
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
});

const listDoc = (over: Partial<OptionsContractListUi> = {}): OptionsContractListUi => ({
  listId: 'svc-doc',
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  status: 'success',
  rows: [pickRow('2026-06-10', 'QQQ260619P00470000')] as ContractListRow[],
  pickDocMeta: {
    coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
    gridVersion: 1,
    pickCount: 1,
    missCount: 0,
    firstDate: '2026-06-10',
    lastDate: '2026-06-10',
  },
  generatedAtIso: '2026-06-16T10:00:00Z',
  ...over,
});

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      ...OPTION_CHART_PAGE_PROVIDERS,
      {
        provide: OptionsContractService,
        useValue: {
          getHistoricalOptionsContract$: jest.fn(),
          getContractIndex$: jest.fn(() => of({ expirations: [], strikes: [] })),
          getContractCatalogSummary$: jest.fn(() => of(null)),
          queryContractCatalog$: jest.fn(() => of({ contracts: [], count: 0 })),
        },
      },
      { provide: ContractAvailabilityService, useValue: { queryContractAvailability$: jest.fn() } },
      { provide: ContractListService, useValue: { getList$: jest.fn(() => of(null)), recentLists$: jest.fn(() => of([])) } },
      { provide: OptionsReplayRunsService, useValue: { watchRuns: jest.fn(() => of([])), watchContractList: jest.fn(() => of(null)) } },
      { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
      { provide: DsDialogService, useValue: { open: jest.fn(() => ({ afterClosed: () => of(undefined) })), openDialogs: [] } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})) } },
      { provide: Router, useValue: { navigate: jest.fn() } },
    ],
  });
  return {
    page: TestBed.inject(OptionChartPageService),
    catalog: TestBed.inject(OptionChartCatalogService),
    load: TestBed.inject(OptionChartLoadService),
    list: TestBed.inject(OptionChartListService),
    replay: TestBed.inject(OptionChartReplayService),
    gen: TestBed.inject(OptionChartGeneratorService),
    store: TestBed.inject(OptionsContractViewerStore),
    genStore: TestBed.inject(OptionGroupGeneratorStore),
    listStore: TestBed.inject(ContractListSessionStore),
  };
}

describe('OptionChartPageService — symbol switch orchestration', () => {
  beforeEach(() => localStorage.clear());

  it('swaps the symbol, clears the input + list error, and reloads symbol data', () => {
    const { page, store, genStore, listStore } = setup();
    page.occIdInput = 'QQQ260619P00470000';
    page.listError.set('stale error');
    const index = jest.spyOn(store, 'loadContractIndex');
    const summary = jest.spyOn(store, 'loadCatalogSummary');
    const bars = jest.spyOn(store, 'loadUnderlyingBars');

    page.onSymbolChange('SPY');

    expect(page.symbol()).toBe('SPY');
    expect(page.occIdInput).toBe('');
    expect(page.listError()).toBeNull();
    expect(index).toHaveBeenCalledWith('SPY');
    expect(summary).toHaveBeenCalledWith('SPY');
    expect(bars).toHaveBeenCalledWith('SPY');
    // gen/list stores swap their per-symbol blobs — both expose symbol().
    expect(genStore.symbol()).toBe('SPY');
    expect(listStore.symbol()).toBe('SPY');
  });

  it('initSession seeds the catalog builder and swaps store symbols', () => {
    const { page, store, genStore, listStore } = setup();
    page.type.set('call');
    const builder = jest.spyOn(store, 'setCatalogBuilder');

    page.initSession();

    expect(builder).toHaveBeenCalledWith({ symbol: 'QQQ', type: 'C' });
    expect(genStore.symbol()).toBe('QQQ');
    expect(listStore.symbol()).toBe('QQQ');
  });
});

describe('OptionChartCatalogService — builder + chart filter', () => {
  beforeEach(() => localStorage.clear());

  it('builtOccId is empty for type=both and a real OCC id for a call', () => {
    const { page, catalog, store } = setup();
    store.setExpiration('2026-06-19');
    store.setStrike(470);

    expect(catalog.builtOccId()).toBe('');

    page.type.set('call');
    expect(catalog.builtOccId()).toBe('QQQ260619C00470000');
  });

  it('onFilterToChart is a no-op without chart extents and applies them when bound', () => {
    const { page, catalog, store } = setup();
    const filters = jest.spyOn(store, 'setCatalogFilters');

    catalog.onFilterToChart(); // no hook — nothing happens
    expect(filters).not.toHaveBeenCalled();

    page.chartExtents = () => ({
      startDate: '2026-01-05',
      endDate: '2026-03-20',
      priceLow: 440.4,
      priceHigh: 470.6,
    });
    catalog.onFilterToChart();

    expect(catalog.expMin()).toBe('2026-01-05');
    expect(catalog.strikeMin()).toBe(440);
    expect(catalog.strikeMax()).toBe(471);
    expect(filters).toHaveBeenCalledWith(
      expect.objectContaining({ expirationGte: '2026-01-05', expirationLte: '2026-03-20' }),
    );
  });
});

describe('OptionChartLoadService — emit seam', () => {
  beforeEach(() => localStorage.clear());

  it('rejectionReasonLabel names the page symbol for wrong-underlying', () => {
    const { page, load } = setup();
    expect(load.rejectionReasonLabel('wrong-underlying')).toBe('not a QQQ contract');
    page.symbol.set('SPY');
    expect(load.rejectionReasonLabel('wrong-underlying')).toBe('not a SPY contract');
  });

  it('a send while the >50 confirm is pending drops — no stacked dialog, no queued load', async () => {
    const { load, store } = setup();
    const dialog = TestBed.inject(DsDialogService) as unknown as { open: jest.Mock };
    const pending = new Subject<boolean>();
    dialog.open.mockReturnValue({ afterClosed: () => pending.asObservable() });
    const loadPlotted = jest.spyOn(store, 'loadPlotted').mockResolvedValue(undefined);
    const lines = Array.from(
      { length: 51 },
      (_, i) => `2026-06-10,QQQ260619P0047${String(i).padStart(3, '0')}0`,
    );

    load.emitLinesToChart(lines); // opens the >50 confirm and awaits it
    load.emitLinesToChart(lines); // dropped — confirm still pending

    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(loadPlotted).not.toHaveBeenCalled();

    pending.next(true);
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(loadPlotted).toHaveBeenCalledTimes(1);
    expect(loadPlotted.mock.calls[0][0]).toHaveLength(51);
  });
});

describe('OptionChartReplayService — runs dropdown', () => {
  beforeEach(() => localStorage.clear());

  it('a dead runs stream surfaces a named error instead of failing silently', () => {
    const { replay } = setup();
    (TestBed.inject(OptionsReplayRunsService).watchRuns as jest.Mock)
      .mockReturnValue(throwError(() => new Error('dead stream')));

    replay.bindRuns();

    expect(replay.replayError()).toBe('Could not load replay runs');
    expect(replay.replayRuns()).toEqual([]);
  });
});

describe('OptionChartListService / OptionChartGeneratorService — page scoping', () => {
  beforeEach(() => localStorage.clear());

  it('a doc applied through the list service lands on the shared session store', () => {
    const { list, listStore } = setup();
    // Instance identity — the AC's page-scoping pin: the store the
    // service writes IS the one TestBed (and the picker dialog, via the
    // element injector) resolves, so the doc lands on the shared session.
    // initSession normally sets the session symbol first — mirror that
    // precondition so the doc isn't rejected as a foreign symbol.
    listStore.setSymbol('QQQ');
    const apply = jest.spyOn(listStore, 'loadListDoc');
    const doc = listDoc();

    list.onContractListDoc(doc);

    expect(apply).toHaveBeenCalledWith(doc);
    expect(listStore.status()).toBe('ready');
    expect(listStore.activeList()?.listId).toBe('svc-doc');
  });

  it('clearStudyRange clears the alive-range bound and disarms the brush', () => {
    const { gen, genStore } = setup();
    gen.brushArmed.set(true);
    const applyRange = jest.spyOn(genStore, 'applyRange');

    gen.clearStudyRange();

    expect(applyRange).toHaveBeenCalledWith(null);
    expect(gen.brushArmed()).toBe(false);
  });
});
